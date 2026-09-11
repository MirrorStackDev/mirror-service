import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import { Server as SocketIOServer, Socket as SocketIOSocket } from "socket.io";

import ClientTracker from "./clientTracker.js";
import { AuthService } from "./authService.js";
import { getDb } from "./db/index.js";
import type { ServerConfig } from "../types/config.js";
import { log } from "./logger.js";
import type { ClientLayout, ModuleDefinition } from "../types/module.js";

import { registerAuthRoutes } from "./routes/auth.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerUserRoutes, registerServiceRoutes } from "./routes/user.js";
import { loadTrackerFile, setupTrackerSocket } from "./socketTracker.js";
import { registerDocsRoute } from "./routes/openapi.js";

class Server {
	rootDir: string;
	app: express.Application;
	port: number | string;
	serverSockets: Set<net.Socket>;
	server: http.Server | https.Server | null;
	config: ServerConfig;
	clientMap: Map<string, SocketIOSocket>;
	trackedClients: ClientTracker[];
	io!: SocketIOServer;
	auth!: AuthService;

	onModuleNeeded?: (moduleName: string) => Promise<void>;
	defaultModuleNames: string[] = [];

	constructor(rootDir: string, config: ServerConfig) {
		this.rootDir = rootDir;
		this.app = express();
		this.port = config.port || 8080;
		this.serverSockets = new Set();
		this.server = null;
		this.config = config;
		this.clientMap = new Map();
		this.trackedClients = [];
	}

	private triggerHelperLoads(body: { modules?: unknown; layout?: unknown }): void {
		if (!this.onModuleNeeded) return;
		const names: string[] = [];
		if (Array.isArray(body.modules)) {
			for (const m of body.modules as ModuleDefinition[]) {
				if (m.module && !names.includes(m.module)) names.push(m.module);
			}
		} else if (body.layout && typeof body.layout === "object") {
			const layout = body.layout as ClientLayout;
			const all = [...(layout.fixed ?? []), ...(layout.pages ?? []).flatMap((p) => p.modules ?? [])];
			for (const m of all) {
				if (m.module && !names.includes(m.module)) names.push(m.module);
			}
		}
		for (const name of names) {
			this.onModuleNeeded(name).catch((err) => log.error("Server", `Failed to load helper ${name}:`, err));
		}
	}

	newHtml(confName: string): void {
		const mirrorName = confName + ".js";
		fs.readFile(path.join(this.rootDir, "index.html"), "utf8", (err, data) => {
			if (err) { log.error("Server", "Failed to read index.html:", err.message); return; }

			const clientCssLink = fs.existsSync(path.join(this.rootDir, "css", `${confName}.css`))
				? `<link rel="stylesheet" type="text/css" href="/css/${confName}.css" />`
				: "";

			const newFile = data
				.replace("#CLIENTCONFIG#", mirrorName)
				.replace("#CLIENTSTYLE#", clientCssLink);

			fs.writeFile(
				path.join(this.rootDir, "configs", confName, "index.html"),
				newFile, "utf8",
				(writeErr) => { if (writeErr) log.error("Server", "Failed to write HTML:", writeErr.message); },
			);
		});
	}

	pushTrackersToRoot(): void {
		this.clientMap.get(this.config.rootConf)?.emit("trackersData", this.trackedClients);
	}

	authEndpoints(): void {
		registerAuthRoutes(this.app, this.auth, this.rootDir);
	}

	userEndpoints(): void {
		registerUserRoutes(
			this.app, this.auth, this.config,
			this.clientMap,
			() => this.trackedClients,
			(body) => this.triggerHelperLoads(body),
			this.rootDir,
		);
	}

	adminEndpoints(): void {
		registerAdminRoutes(this.app, this.auth, this.config);
	}

	userServiceEndpoints(): void {
		registerServiceRoutes(this.app, () => this.defaultModuleNames);
	}

	loadTrackerFile(): void {
		this.trackedClients = loadTrackerFile(this.config, this.rootDir);
	}

	trackerSetup(): void {
		setupTrackerSocket(
			this.io, this.auth,
			this.clientMap,
			() => this.trackedClients,
			() => this.pushTrackersToRoot(),
		);
	}

	open(): Promise<{ app: express.Application; io: SocketIOServer }> {
		return new Promise((resolve) => {
			if (this.config.https) {
				const options = {
					key: fs.readFileSync(this.config.httpsPrivateKey!),
					cert: fs.readFileSync(this.config.httpsCertificate!),
				};
				this.server = https.createServer(options, this.app);
			} else {
				this.server = http.createServer(this.app);
			}

			this.io = new SocketIOServer(this.server, {
				cors: { origin: /.*$/, credentials: true },
			});

			this.app.use(express.json());
			this.auth = new AuthService(getDb());

			this.authEndpoints();
			this.userEndpoints();
			this.adminEndpoints();

			this.app.use(
				helmet({
					contentSecurityPolicy: this.config.httpHeaders.contentSecurityPolicy || false,
					crossOriginOpenerPolicy: this.config.httpHeaders.crossOriginOpenerPolicy || false,
					crossOriginEmbedderPolicy: this.config.httpHeaders.crossOriginEmbedderPolicy || false,
					crossOriginResourcePolicy: this.config.httpHeaders.crossOriginResourcePolicy || false,
					originAgentCluster: this.config.httpHeaders.originAgentCluster || false,
				}),
			);

			this.loadTrackerFile();
			this.trackerSetup();

			this.server.on("connection", (socket: net.Socket) => {
				this.serverSockets.add(socket);
				socket.on("close", () => this.serverSockets.delete(socket));
			});

			this.server.listen(Number(this.port), this.config.address || "0.0.0.0");

			for (const conf of this.config.clientConfigs) {
				const confBase = path.join(this.rootDir, "configs", conf);
				if (fs.existsSync(path.join(confBase, `${conf}.js`))) {
					if (!fs.existsSync(path.join(confBase, "index.html"))) this.newHtml(conf);
					this.app.use("/" + conf, express.static(confBase));
				}
			}

			const rootBase = path.join(this.rootDir, "configs", this.config.rootConf);
			if (fs.existsSync(path.join(rootBase, `${this.config.rootConf}.js`))) {
				if (!fs.existsSync(path.join(rootBase, "index.html"))) this.newHtml(this.config.rootConf);
				this.app.use("/", express.static(rootBase));
				this.app.use("/" + this.config.rootConf, express.static(rootBase));
			}

			this.app.use("/configs", express.static(path.join(this.rootDir, "configs")));
			this.app.use("/modules", express.static(path.join(this.rootDir, "modules")));
			this.app.use("/css", express.static(path.join(this.rootDir, "css")));
			this.app.use("/js", express.static(path.join(this.rootDir, "dist/client")));
			this.app.use("/fonts/roboto", express.static(path.join(this.rootDir, "node_modules/@fontsource/roboto")));
			this.app.use("/fonts/roboto-condensed", express.static(path.join(this.rootDir, "node_modules/@fontsource/roboto-condensed")));

			this.userServiceEndpoints();
			registerDocsRoute(this.app);

			this.server.on("listening", () => {
				log.info("Server", `Listening on ${this.config.address || "0.0.0.0"}:${this.port}`);
				resolve({ app: this.app, io: this.io });
			});
		});
	}

	close(): Promise<void> {
		return new Promise((resolve) => {
			for (const socket of this.serverSockets.values()) socket.destroy();
			this.server!.close(() => resolve());
		});
	}
}

export default Server;
