import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import { Server as SocketIOServer, Socket as SocketIOSocket } from "socket.io";

import { eq, and } from "drizzle-orm";
import ClientTracker from "./clientTracker.js";
import { AuthService, COOKIE_NAME } from "./authService.js";
import { getDb } from "./db/index.js";
import { clients as clientsTable, clientUsers as clientUsersTable, userConfigs as userConfigsTable } from "./db/schema.js";
import type { ServerConfig } from "../types/config.js";
import type { ClientLayout, ModuleDefinition } from "../types/module.js";
import type {
	ModuleSocketPayload,
	UserSocketPayload,
	CursorSocketPayload,
} from "../types/socket.js";

function resolveLayout(row: { layout: string | null; defaultModules: string }): ClientLayout {
	if (row.layout) return JSON.parse(row.layout) as ClientLayout;
	return {
		pages: [{ modules: JSON.parse(row.defaultModules) as ModuleDefinition[] }],
		fixed: [],
	};
}

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
			this.onModuleNeeded(name).catch((err) => console.error(`Failed to load helper ${name}: ${err}`));
		}
	}

	private rowToConfig(row: { modules: string; layout: string | null }, name: string): object {
		const base: Record<string, unknown> = { name, modules: JSON.parse(row.modules) as unknown[] };
		if (row.layout) base.layout = JSON.parse(row.layout) as unknown;
		return base;
	}

	/**
	 * Every configured mirror needs to have it's own html landing page, if one does not have it, it generates here from template
	 **/
	newHtml(confName: string): void {
		const mirrorName = confName + ".js";
		fs.readFile(path.join(this.rootDir, "index.html"), "utf8", (err, data) => {
			if (err) {
				console.log(err.message);
				return;
			}

			const clientCssLink = fs.existsSync(path.join(this.rootDir, "css", `${confName}.css`))
				? `<link rel="stylesheet" type="text/css" href="/css/${confName}.css" />`
				: "";

			const newFile = data
				.replace("#CLIENTCONFIG#", mirrorName)
				.replace("#CLIENTSTYLE#", clientCssLink);

			fs.writeFile(
				path.join(this.rootDir, "configs", confName, "index.html"),
				newFile,
				"utf8",
				(writeErr) => {
					if (writeErr) console.log(writeErr.message);
				},
			);
		});
	}

	/**
	 * Endpoints accessible by authenticated regular user
	 **/
	userEndpoints(): void {
		const requireAuth = (
			req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		): void => {
			const token = this.auth.parseCookie(req.headers.cookie, COOKIE_NAME);
			if (!token) {
				res.status(401).json({ error: "Not authenticated" });
				return;
			}
			const session = this.auth.getSession(token);
			if (!session) {
				res.status(401).json({ error: "Session expired" });
				return;
			}
			(req as express.Request & { sessionInfo: typeof session }).sessionInfo = session;
			next();
		};


		const readUserConfig = (username: string, clientName?: string): object => {
			const db = getDb();
			if (clientName) {
				const row = db.select().from(userConfigsTable)
					.where(and(eq(userConfigsTable.username, username), eq(userConfigsTable.clientName, clientName)))
					.get();
				if (row) return this.rowToConfig(row, username);
			}
			const globalRow = db.select().from(userConfigsTable)
				.where(and(eq(userConfigsTable.username, username), eq(userConfigsTable.clientName, "")))
				.get();
			if (globalRow) return this.rowToConfig(globalRow, username);
			return { name: username, modules: [] };
		};

		const writeUserConfig = (username: string, modules: unknown[], clientName?: string): void => {
			const db = getDb();
			const clientNameVal = clientName ?? "";
			db.insert(userConfigsTable)
				.values({ username, clientName: clientNameVal, modules: JSON.stringify(modules), layout: null })
				.onConflictDoUpdate({
					target: [userConfigsTable.username, userConfigsTable.clientName],
					set: { modules: JSON.stringify(modules), layout: null },
				})
				.run();
		};

		const writeUserLayout = (username: string, layout: unknown, clientName: string): void => {
			const db = getDb();
			db.insert(userConfigsTable)
				.values({ username, clientName, modules: "[]", layout: JSON.stringify(layout) })
				.onConflictDoUpdate({
					target: [userConfigsTable.username, userConfigsTable.clientName],
					set: { layout: JSON.stringify(layout) },
				})
				.run();
		};

		// returns logged in users general config
		this.app.get("/user/config", requireAuth, (req, res) => {
			const { username } = (req as express.Request & { sessionInfo: { username: string } })
				.sessionInfo;
			try {
				res.json(readUserConfig(username));
			} catch {
				res.status(500).json({ error: "Failed to read config" });
			}
		});

		// returns logged in users config for a specific mirrror
		this.app.get("/user/config/:client", requireAuth, (req, res) => {
			const { username } = (req as express.Request & { sessionInfo: { username: string } })
				.sessionInfo;
			const clientName = req.params["client"] as string;
			try {
				res.json(readUserConfig(username, clientName));
			} catch {
				res.status(500).json({ error: "Failed to read config" });
			}
		});

		// returns all client names that logged in user is part of (part of clientConfigs variable of a specific mirror config)
		this.app.get("/user/clients", requireAuth, (req, res) => {
			const { username } = (req as express.Request & { sessionInfo: { username: string } })
				.sessionInfo;
			const db = getDb();
			const rows = db.select({ clientName: clientUsersTable.clientName })
				.from(clientUsersTable)
				.where(eq(clientUsersTable.username, username))
				.all();
			const assigned = rows
				.map((r) => r.clientName)
				.filter((name) => this.config.clientConfigs.includes(name));
			res.json(assigned);
		});

		// returns all module names that logged in user is able to use
		// its divided by admin only and the rest
		this.app.get("/user/modules/available", requireAuth, (_req, res) => {
			const adminOnly = new Set([
				"alert",
				"clientDetailes",
				"clientDisplay",
				"userManager",
				"personalization",
			]);

			const modulesDir = path.join(this.rootDir, "modules");

			let defaultModules: string[] = [];
			try {
				const defaultDir = path.join(modulesDir, "default");
				defaultModules = fs.readdirSync(defaultDir).filter((name) => {
					if (adminOnly.has(name)) return false;
					return fs.statSync(path.join(defaultDir, name)).isDirectory();
				});
			} catch {
				/* no default modules dir */
			}

			let thirdParty: string[] = [];
			try {
				thirdParty = fs.readdirSync(modulesDir).filter((name) => {
					if (name === "default") return false;
					return fs.statSync(path.join(modulesDir, name)).isDirectory();
				});
			} catch {
				/* no modules dir */
			}

			res.json([...defaultModules, ...thirdParty]);
		});

		// returns a module's manifest (module.json) so the client can read its config schema
		this.app.get("/modules/manifest/:name", (req, res) => {
			const { name } = req.params as { name: string };
			const candidates = [
				path.join(this.rootDir, "modules", "default", name, "module.json"),
				path.join(this.rootDir, "modules", name, "module.json"),
			];
			for (const p of candidates) {
				if (fs.existsSync(p)) {
					try {
						res.json(JSON.parse(fs.readFileSync(p, "utf8")) as object);
					} catch {
						res.status(500).json({ error: "Failed to read manifest" });
					}
					return;
				}
			}
			res.json({});
		});

		// set users general config (flat modules or paged layout)
		this.app.put("/user/config", requireAuth, (req, res) => {
			const { username } = (req as express.Request & { sessionInfo: { username: string } })
				.sessionInfo;
			const body = req.body as { modules?: unknown; layout?: unknown };
			try {
				if (body.layout !== undefined) {
					if (!body.layout || typeof body.layout !== "object" || !Array.isArray((body.layout as Record<string, unknown>).pages)) {
						res.status(400).json({ error: "layout must be a ClientLayout object with a pages array" });
						return;
					}
					writeUserLayout(username, body.layout, "");
				} else {
					if (!Array.isArray(body.modules)) {
						res.status(400).json({ error: "modules must be an array" });
						return;
					}
					writeUserConfig(username, body.modules as unknown[]);
				}
				res.json({ ok: true });
				this.triggerHelperLoads(body);
			} catch {
				res.status(500).json({ error: "Failed to save config" });
			}
		});

		// set users config on a specific client (flat modules or paged layout)
		this.app.put("/user/config/:client", requireAuth, (req, res) => {
			const { username } = (req as express.Request & { sessionInfo: { username: string } })
				.sessionInfo;
			const clientName = req.params["client"] as string;
			const body = req.body as { modules?: unknown; layout?: unknown };
			try {
				if (body.layout !== undefined) {
					if (!body.layout || typeof body.layout !== "object" || !Array.isArray((body.layout as Record<string, unknown>).pages)) {
						res.status(400).json({ error: "layout must be a ClientLayout object with a pages array" });
						return;
					}
					writeUserLayout(username, body.layout, clientName);
				} else {
					if (!Array.isArray(body.modules)) {
						res.status(400).json({ error: "modules must be an array" });
						return;
					}
					writeUserConfig(username, body.modules as unknown[], clientName);
				}
				res.json({ ok: true });
				this.triggerHelperLoads(body);
			} catch {
				res.status(500).json({ error: "Failed to save config" });
			}
		});

		// Send a page command to a connected client.
		// Allowed when: admin role, OR mirror is in default mode, OR requester is the mirror's active user.
		this.app.post("/clients/:client/page-command", requireAuth, (req, res) => {
			const session = (req as express.Request & { sessionInfo: { username: string; role: string } }).sessionInfo;
			const clientName = req.params["client"] as string;
			const db = getDb();

			const exists = db.select({ name: clientsTable.name })
				.from(clientsTable).where(eq(clientsTable.name, clientName)).get();
			if (!exists) { res.status(404).json({ error: "Client not found" }); return; }

			// Permission: admin always allowed; otherwise check the mirror's live current user
			const trackedClient = this.trackedClients.find((c) => c.name === clientName);
			const currentUser = trackedClient?.user ?? "default";

			if (
				session.role !== "admin" &&
				currentUser !== "default" &&
				session.username !== currentUser
			) {
				res.status(403).json({ error: "Not authorized to control this client" });
				return;
			}

			const socket = this.clientMap.get(clientName);
			if (!socket) { res.status(503).json({ error: "Client not connected" }); return; }

			const VALID_ACTIONS = new Set([
				"select", "next", "prev", "home",
				"showHidden", "leaveHidden",
				"pauseRotation", "resumeRotation",
			]);
			const body = req.body as { action?: string; page?: unknown; name?: unknown };

			if (!body.action || !VALID_ACTIONS.has(body.action)) {
				res.status(400).json({ error: `action must be one of: ${[...VALID_ACTIONS].join(", ")}` });
				return;
			}
			if (body.action === "select" && (typeof body.page !== "number" || !Number.isInteger(body.page))) {
				res.status(400).json({ error: "select requires an integer 'page' field" });
				return;
			}
			if (body.action === "showHidden" && typeof body.name !== "string") {
				res.status(400).json({ error: "showHidden requires a string 'name' field" });
				return;
			}

			socket.emit("PAGE_COMMAND", {
				action: body.action,
				...(body.action === "select" ? { page: body.page as number } : {}),
				...(body.action === "showHidden" ? { name: body.name as string } : {}),
			});
			res.json({ ok: true });
		});
	}

	adminEndpoints(): void {
		const requireAdmin = (
			req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		): void => {
			const token = this.auth.parseCookie(req.headers.cookie, COOKIE_NAME);
			if (!token) {
				res.status(401).json({ error: "Not authenticated" });
				return;
			}
			const session = this.auth.getSession(token);
			if (!session) {
				res.status(401).json({ error: "Session expired" });
				return;
			}
			if (session.role !== "admin") {
				res.status(403).json({ error: "Admin required" });
				return;
			}
			next();
		};

		// list all users
		this.app.get("/admin/users", requireAdmin, (_req, res) => {
			res.json(this.auth.listAccounts());
		});

		// create a new user
		this.app.post("/admin/users", requireAdmin, (req, res) => {
			const { username, displayName, role, password } = req.body as Record<string, string>;
			if (!username || !displayName || !role || !password) {
				res.status(400).json({ error: "All fields required" });
				return;
			}
			try {
				this.auth.createAccount(username, displayName, role as "admin" | "user", password);
				getDb().insert(userConfigsTable)
					.values({ username, clientName: "", modules: "[]" })
					.onConflictDoNothing()
					.run();
				res.status(201).json({ ok: true });
			} catch (e) {
				res.status(409).json({ error: (e as Error).message });
			}
		});

		// update users info
		this.app.patch("/admin/users/:username", requireAdmin, (req, res) => {
			try {
				this.auth.updateAccount(
					req.params["username"] as string,
					req.body as { displayName?: string; role?: "admin" | "user"; password?: string },
				);
				res.json({ ok: true });
			} catch (e) {
				res.status(404).json({ error: (e as Error).message });
			}
		});

		// deletes a user
		this.app.delete("/admin/users/:username", requireAdmin, (req, res) => {
			const username = req.params["username"] as string;
			try {
				this.auth.deleteAccount(username);
				res.json({ ok: true });
			} catch (e) {
				res.status(404).json({ error: (e as Error).message });
			}
		});

		// return clients and users who has a specific config on that client
		this.app.get("/admin/clients", requireAdmin, (_req, res) => {
			const db = getDb();
			const clients = this.config.clientConfigs.map((name) => {
				const rows = db.select({ username: clientUsersTable.username })
					.from(clientUsersTable)
					.where(eq(clientUsersTable.clientName, name))
					.all();
				return { name, users: rows.map((r) => r.username) };
			});
			res.json(clients);
		});

		// replace the full users list on a client
		this.app.put("/admin/clients/:client/users", requireAdmin, (req, res) => {
			const clientName = req.params["client"] as string;
			if (!this.config.clientConfigs.includes(clientName)) {
				res.status(404).json({ error: "Client not found" });
				return;
			}
			const { users } = req.body as { users?: string[] };
			if (!Array.isArray(users)) {
				res.status(400).json({ error: "users must be an array" });
				return;
			}
			const db = getDb();
			db.delete(clientUsersTable).where(eq(clientUsersTable.clientName, clientName)).run();
			for (const username of users) {
				db.insert(clientUsersTable).values({ clientName, username }).run();
			}
			res.json({ ok: true });
		});

		// get a single client's config (type, userSwitchMode, defaultModules, layout)
		this.app.get("/admin/clients/:client/config", requireAdmin, (req, res) => {
			const clientName = req.params["client"] as string;
			const db = getDb();
			const row = db.select({
				name: clientsTable.name,
				type: clientsTable.type,
				userSwitchMode: clientsTable.userSwitchMode,
				defaultModules: clientsTable.defaultModules,
				layout: clientsTable.layout,
			}).from(clientsTable).where(eq(clientsTable.name, clientName)).get();

			if (!row) {
				res.status(404).json({ error: "Client not found" });
				return;
			}

			res.json({
				name: row.name,
				type: row.type,
				userSwitchMode: row.userSwitchMode,
				defaultModules: JSON.parse(row.defaultModules) as unknown[],
				layout: row.layout ? JSON.parse(row.layout) as ClientLayout : null,
			});
		});

		// update a single client's config (partial — only supplied fields are changed)
		this.app.put("/admin/clients/:client/config", requireAdmin, (req, res) => {
			const clientName = req.params["client"] as string;
			const db = getDb();

			const existing = db.select({ name: clientsTable.name })
				.from(clientsTable).where(eq(clientsTable.name, clientName)).get();
			if (!existing) {
				res.status(404).json({ error: "Client not found" });
				return;
			}

			const body = req.body as {
				type?: string;
				userSwitchMode?: string;
				defaultModules?: unknown[];
				layout?: ClientLayout | null;
			};

			if (body.type !== undefined && body.type !== "mirror" && body.type !== "dashboard") {
				res.status(400).json({ error: "type must be 'mirror' or 'dashboard'" });
				return;
			}
			if (body.userSwitchMode !== undefined && body.userSwitchMode !== "SAVE" && body.userSwitchMode !== "DELETE") {
				res.status(400).json({ error: "userSwitchMode must be 'SAVE' or 'DELETE'" });
				return;
			}
			if (body.defaultModules !== undefined && !Array.isArray(body.defaultModules)) {
				res.status(400).json({ error: "defaultModules must be an array" });
				return;
			}
			if (body.layout !== undefined && body.layout !== null && typeof body.layout !== "object") {
				res.status(400).json({ error: "layout must be an object or null" });
				return;
			}
			if (body.layout !== null && body.layout !== undefined) {
				if (!Array.isArray(body.layout.pages) || !Array.isArray(body.layout.fixed)) {
					res.status(400).json({ error: "layout must have pages (array) and fixed (array)" });
					return;
				}
			}

			const patch: { type?: string; userSwitchMode?: string; defaultModules?: string; layout?: string | null } = {};
			if (body.type !== undefined) patch.type = body.type;
			if (body.userSwitchMode !== undefined) patch.userSwitchMode = body.userSwitchMode;
			if (body.defaultModules !== undefined) patch.defaultModules = JSON.stringify(body.defaultModules);
			if (body.layout !== undefined) patch.layout = body.layout === null ? null : JSON.stringify(body.layout);

			if (Object.keys(patch).length === 0) {
				res.status(400).json({ error: "No valid fields provided" });
				return;
			}

			db.update(clientsTable).set(patch).where(eq(clientsTable.name, clientName)).run();
			res.json({ ok: true });
		});

	}

	userServiceEndpoints(): void {
		// Serve the effective layout for a client — from DB layout column if set,
		// otherwise synthesised from the legacy defaultModules column.
		this.app.get("/:client/layout", (req, res) => {
			const clientName = req.params["client"] as string;
			const db = getDb();
			const row = db.select({ layout: clientsTable.layout, defaultModules: clientsTable.defaultModules })
				.from(clientsTable).where(eq(clientsTable.name, clientName)).get();
			if (!row) { res.status(404).json({ error: "Client not found" }); return; }
			res.json(resolveLayout(row));
		});

		this.app.post("/get-user/:userName", (req, res) => {
			const userName = req.params.userName;
			let clientName = "";

			req.on("data", (chunk) => {
				clientName += chunk.toString();
			});

			req.on("end", () => {
				const db = getDb();
				if (clientName) {
					const row = db.select().from(userConfigsTable)
						.where(and(eq(userConfigsTable.username, userName), eq(userConfigsTable.clientName, clientName)))
						.get();
					if (row) { res.json(this.rowToConfig(row, userName)); return; }
				}
				const globalRow = db.select().from(userConfigsTable)
					.where(and(eq(userConfigsTable.username, userName), eq(userConfigsTable.clientName, "")))
					.get();
				if (globalRow) { res.json(this.rowToConfig(globalRow, userName)); return; }
				res.status(404).json({ error: "User config not found" });
			});
		});
	}

	loadTrackerFile(): void {
		const db = getDb();
		const allClientNames = [...this.config.clientConfigs, this.config.rootConf];

		for (const name of allClientNames) {
			const existing = db
				.select({ name: clientsTable.name })
				.from(clientsTable)
				.where(eq(clientsTable.name, name))
				.get();
			if (!existing) {
				let clientType = name === this.config.rootConf ? "dashboard" : "mirror";
				let defaultModules = "[]";
				let userSwitchMode = "SAVE";
				const cfgPath = path.join(this.rootDir, "configs", name, `${name}.json`);
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
		this.trackedClients = rows.map(
			(row) =>
				new ClientTracker(
					row.name,
					row.type as "mirror" | "dashboard",
					row.lastOnline ? new Date(row.lastOnline) : null,
					null,
					"offline",
					[],
					row.currentUser,
				),
		);
		console.log("Client tracker data loaded from DB.");
	}

	pushTrackersToRoot(): void {
		this.clientMap.get(this.config.rootConf)?.emit("trackersData", this.trackedClients);
	}

	trackerSetup(): void {
		this.io.on("connection", (socket: SocketIOSocket) => {
			const rawClientName = socket.handshake.query.clientName;
			const clientName = Array.isArray(rawClientName) ? rawClientName[0] : (rawClientName ?? "");
			const clientIp =
				(socket.handshake.headers["x-forwarded-for"] as string) || socket.handshake.address;

			this.clientMap.set(clientName, socket);
			const db = getDb();
			let beats = 0;

			const client = this.trackedClients.find((c) => c.name === clientName);
			if (!client) {
				console.error(`Unknown client connected: ${clientName}`);
				socket.disconnect();
				return;
			}

			client.lastOnline = new Date();
			client.connectedAt = new Date();
			client.status = "online";
			if (!client.connections.find((c) => c.ip === clientIp)) {
				client.connections.push({
					ip: clientIp,
					connectedAt: client.connectedAt,
				});
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

			this.pushTrackersToRoot();

			let missedHeartbeats = 0;
      let heartbeatTimer: ReturnType<typeof setTimeout>;

			const checkHeartbeat = () => {
				if (client.status === "online") {
					missedHeartbeats += 1;
					if (missedHeartbeats >= 4) {
						console.log(`Client ${client.name} is unresponsive. Disconnecting...`);
						socket.disconnect();
						return;
					}
					heartbeatTimer = setTimeout(checkHeartbeat, 10000);
				}
			};

			heartbeatTimer = setTimeout(checkHeartbeat, 10000);

			socket.on("heartbeat", () => {
				client.lastOnline = new Date();
				console.log(`Heartbeat received from ${client.name}`);
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
				if (client.name === "root") {
					console.log("Root requested client tracker data");
					socket.emit("trackersData", this.trackedClients);
				}
			});

			socket.on("HIDE_MODULE_X", (payload: ModuleSocketPayload) => {
				console.log(payload);
				this.clientMap.get(payload.client)?.emit("HIDE_MODULE_Y", payload);
			});

			socket.on("SHOW_MODULE_X", (payload: ModuleSocketPayload) => {
				console.log(payload);
				this.clientMap.get(payload.client)?.emit("SHOW_MODULE_Y", payload);
			});

			socket.on("SUSPEND_MODULE_X", (payload: ModuleSocketPayload) => {
				console.log(payload);
				this.clientMap.get(payload.client)?.emit("SUSPEND_MODULE_Y", payload);
			});

			socket.on("RESUME_MODULE_X", (payload: ModuleSocketPayload) => {
				console.log(payload);
				this.clientMap.get(payload.client)?.emit("RESUME_MODULE_Y", payload);
			});

			socket.on("TOGGLE_CURSOR_X", (payload: CursorSocketPayload) => {
				this.clientMap.get(payload.client)?.emit("TOGGLE_CURSOR_Y", payload);
			});

			socket.on("CHANGE_USER_X", (payload: UserSocketPayload) => {
				const token = this.auth.parseCookie(socket.handshake.headers.cookie, COOKIE_NAME);
				const session = token ? this.auth.getSession(token) : null;

				if (!session) {
					console.warn(
						`[Security] CHANGE_USER_X rejected — no valid session on socket (client: ${payload.client})`,
					);
					return;
				}

				// payload.user is only ever trusted for the GLOBAL branch. For anything
				// else, the acting identity comes from the session tied to this socket
				// connection, never from the payload — so a module sending a spoofed
				// username can only ever assign the session's own user, never someone else's.
				const user = payload.user === "GLOBAL" ? "GLOBAL" : session.username;

				const editClient = this.trackedClients.find((c) => c.name === payload.client);
				if (editClient) {
					editClient.user = user;
					db.update(clientsTable).set({ currentUser: user })
						.where(eq(clientsTable.name, payload.client)).run();
				}
				this.clientMap.get(payload.client)?.emit("CHANGE_USER_Y", { client: payload.client, user });
			});

			socket.on("disconnect", () => {
				console.log(`Client disconnected from server: ${client.name}`);
				const index = client.connections.findIndex((conn) => conn.ip === clientIp);
				if (index !== -1) {
					client.connections.splice(index, 1);
				}
				if (client.connections.length === 0) {
					client.status = "offline";
					this.clientMap.delete(client.name);
				}
				client.user = "default";
				db.update(clientsTable).set({
					status: "offline",
					connections: JSON.stringify(client.connections),
					currentUser: "default",
				}).where(eq(clientsTable.name, client.name)).run();
				clearTimeout(heartbeatTimer);
				this.pushTrackersToRoot();
			});
		});
	}

	authEndpoints(): void {
		const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

		this.app.get("/login", (_req, res) => {
			res.sendFile(path.resolve(this.rootDir, "public/login.html"));
		});

		this.app.post("/auth/login", (req, res) => {
			const { username, password } = req.body as { username?: string; password?: string };
			if (!username || !password) {
				res.status(400).json({ error: "Username and password required" });
				return;
			}
			const session = this.auth.login(username, password);
			if (!session) {
				res.status(401).json({ error: "Invalid credentials" });
				return;
			}
			res.setHeader(
				"Set-Cookie",
				`${COOKIE_NAME}=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE}`,
			);
			res.json({
				username: session.username,
				displayName: session.displayName,
				role: session.role,
			});
		});

		this.app.post("/auth/logout", (req, res) => {
			const token = this.auth.parseCookie(req.headers.cookie, COOKIE_NAME);
			if (token) this.auth.logout(token);
			res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
			res.json({ ok: true });
		});

		this.app.get("/auth/me", (req, res) => {
			const token = this.auth.parseCookie(req.headers.cookie, COOKIE_NAME);
			if (!token) {
				res.status(401).json({ error: "Not authenticated" });
				return;
			}
			const session = this.auth.getSession(token);
			if (!session) {
				res.status(401).json({ error: "Session expired" });
				return;
			}
			res.json(session);
		});
	}

	open(): Promise<{ app: express.Application; io: SocketIOServer }> {
		return new Promise((resolve) => {
			console.log("Starting express server");
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
				// Also mount at /root/ so fetchConfig() can resolve root.json consistently with other clients
				this.app.use("/" + this.config.rootConf, express.static(rootBase));
			}

			this.app.use("/configs", express.static(path.join(this.rootDir, "configs")));
			this.app.use("/modules", express.static(path.join(this.rootDir, "modules")));
			this.app.use("/css", express.static(path.join(this.rootDir, "css")));
			this.app.use("/js", express.static(path.join(this.rootDir, "dist/client")));

			this.userServiceEndpoints();

			this.server.on("listening", () => resolve({ app: this.app, io: this.io }));
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
