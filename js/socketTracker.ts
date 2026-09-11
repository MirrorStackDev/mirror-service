import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { Server as SocketIOServer, Socket as SocketIOSocket } from "socket.io";
import ClientTracker from "./clientTracker.js";
import { AuthService, COOKIE_NAME } from "./authService.js";
import { getDb } from "./db/index.js";
import { clients as clientsTable } from "./db/schema.js";
import type { ServerConfig } from "../types/config.js"; // used by loadTrackerFile only
import type { ModuleSocketPayload, UserSocketPayload, CursorSocketPayload } from "../types/socket.js";
import { resolveLayout } from "./routes/helpers.js";
import { log } from "./logger.js";

export function loadTrackerFile(config: ServerConfig, rootDir: string): ClientTracker[] {
	const db = getDb();
	const allClientNames = [...config.clientConfigs, config.rootConf];

	for (const name of allClientNames) {
		const existing = db.select({ name: clientsTable.name })
			.from(clientsTable).where(eq(clientsTable.name, name)).get();
		if (!existing) {
			let clientType = name === config.rootConf ? "dashboard" : "mirror";
			let defaultModules = "[]";
			let userSwitchMode = "SAVE";
			const cfgPath = path.join(rootDir, "configs", name, `${name}.json`);
			try {
				const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as {
					type?: string;
					userSwitchMode?: string;
					defaultModules?: unknown[];
				};
				if (raw.type) clientType = raw.type as "mirror" | "dashboard";
				if (raw.userSwitchMode) userSwitchMode = raw.userSwitchMode;
				if (raw.defaultModules) defaultModules = JSON.stringify(raw.defaultModules);
			} catch { /* no config file, use defaults */ }
			db.insert(clientsTable).values({ name, type: clientType, defaultModules, userSwitchMode }).run();
		}
	}

	const rows = db.select().from(clientsTable).all();
	return rows.map(
		(row) => new ClientTracker(
			row.name,
			row.type as "mirror" | "dashboard",
			row.lastOnline ? new Date(row.lastOnline) : null,
			null,
			"offline",
			[],
			row.currentUser,
		),
	);
}

export function setupTrackerSocket(
	io: SocketIOServer,
	auth: AuthService,
	clientMap: Map<string, SocketIOSocket>,
	getTrackedClients: () => ClientTracker[],
	pushToRoot: () => void,
): void {
	io.on("connection", (socket: SocketIOSocket) => {
		const rawClientName = socket.handshake.query.clientName;
		const clientName = Array.isArray(rawClientName) ? rawClientName[0] : (rawClientName ?? "");
		const clientIp =
			(socket.handshake.headers["x-forwarded-for"] as string) || socket.handshake.address;

		clientMap.set(clientName, socket);
		const db = getDb();
		let beats = 0;

		const client = getTrackedClients().find((c) => c.name === clientName);
		if (!client) {
			log.warn("Server", `Unknown client connected: ${clientName} — disconnecting`);
			socket.disconnect();
			return;
		}

		client.lastOnline = new Date();
		client.connectedAt = new Date();
		client.status = "online";
		log.info("Server", `Client connected: ${clientName}`);
		if (!client.connections.find((c) => c.ip === clientIp)) {
			client.connections.push({ ip: clientIp, connectedAt: client.connectedAt });
		}

		db.update(clientsTable).set({
			status: "online",
			lastOnline: client.lastOnline?.getTime() ?? null,
			connectedAt: client.connectedAt?.getTime() ?? null,
			connections: JSON.stringify(client.connections),
		}).where(eq(clientsTable.name, client.name)).run();

		const layoutRow = db.select({ layout: clientsTable.layout, defaultModules: clientsTable.defaultModules })
			.from(clientsTable).where(eq(clientsTable.name, clientName)).get();
		if (layoutRow) socket.emit("LAYOUT", resolveLayout(layoutRow));

		pushToRoot();

		let missedHeartbeats = 0;
		let heartbeatTimer: ReturnType<typeof setTimeout>;

		const checkHeartbeat = () => {
			if (client.status === "online") {
				missedHeartbeats += 1;
				if (missedHeartbeats >= 4) {
					log.warn("Server", `Client ${client.name} unresponsive — disconnecting`);
					socket.disconnect();
					return;
				}
				heartbeatTimer = setTimeout(checkHeartbeat, 10000);
			}
		};

		heartbeatTimer = setTimeout(checkHeartbeat, 10000);

		socket.on("heartbeat", () => {
			client.lastOnline = new Date();
			missedHeartbeats = 0;
			beats += 1;
			if (beats === 3) {
				db.update(clientsTable).set({
					lastOnline: client.lastOnline?.getTime() ?? null,
				}).where(eq(clientsTable.name, client.name)).run();
				beats = 0;
			}
		});

		socket.on("retrieveTrackers", () => {
			if (client.name === "root") socket.emit("trackersData", getTrackedClients());
		});

		socket.on("HIDE_MODULE_X", (payload: ModuleSocketPayload) => {
			log.debug("Server", "HIDE_MODULE_X", payload);
			clientMap.get(payload.client)?.emit("HIDE_MODULE_Y", payload);
		});

		socket.on("SHOW_MODULE_X", (payload: ModuleSocketPayload) => {
			log.debug("Server", "SHOW_MODULE_X", payload);
			clientMap.get(payload.client)?.emit("SHOW_MODULE_Y", payload);
		});

		socket.on("SUSPEND_MODULE_X", (payload: ModuleSocketPayload) => {
			log.debug("Server", "SUSPEND_MODULE_X", payload);
			clientMap.get(payload.client)?.emit("SUSPEND_MODULE_Y", payload);
		});

		socket.on("RESUME_MODULE_X", (payload: ModuleSocketPayload) => {
			log.debug("Server", "RESUME_MODULE_X", payload);
			clientMap.get(payload.client)?.emit("RESUME_MODULE_Y", payload);
		});

		socket.on("TOGGLE_CURSOR_X", (payload: CursorSocketPayload) => {
			clientMap.get(payload.client)?.emit("TOGGLE_CURSOR_Y", payload);
		});

		socket.on("CHANGE_USER_X", (payload: UserSocketPayload) => {
			const token = auth.parseCookie(socket.handshake.headers.cookie, COOKIE_NAME);
			const session = token ? auth.getSession(token) : null;

			if (!session) {
				log.warn("Security", `CHANGE_USER_X rejected — no valid session (client: ${payload.client})`);
				return;
			}

			const user = payload.user === "GLOBAL" ? "GLOBAL" : session.username;

			const editClient = getTrackedClients().find((c) => c.name === payload.client);
			if (editClient) {
				editClient.user = user;
				db.update(clientsTable).set({ currentUser: user })
					.where(eq(clientsTable.name, payload.client)).run();
			}
			clientMap.get(payload.client)?.emit("CHANGE_USER_Y", { client: payload.client, user });
		});

		socket.on("disconnect", () => {
			log.info("Server", `Client disconnected: ${client.name}`);
			const index = client.connections.findIndex((conn) => conn.ip === clientIp);
			if (index !== -1) client.connections.splice(index, 1);
			if (client.connections.length === 0) {
				client.status = "offline";
				clientMap.delete(client.name);
			}
			client.user = "default";
			db.update(clientsTable).set({
				status: "offline",
				connections: JSON.stringify(client.connections),
				currentUser: "default",
			}).where(eq(clientsTable.name, client.name)).run();
			clearTimeout(heartbeatTimer);
			pushToRoot();
		});
	});
}
