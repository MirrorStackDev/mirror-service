import fs from "node:fs";
import path from "node:path";
import type { Application } from "express";
import { eq, and } from "drizzle-orm";
import { AuthService } from "../authService.js";
import { getDb } from "../db/index.js";
import { clients as clientsTable, clientUsers as clientUsersTable, userConfigs as userConfigsTable } from "../db/schema.js";
import type { ServerConfig } from "../../types/config.js";
import type ClientTracker from "../clientTracker.js";
import type { Socket as SocketIOSocket } from "socket.io";
import { requireAuth, resolveLayout } from "./helpers.js";

function rowToConfig(row: { modules: string; layout: string | null }, name: string): object {
	const base: Record<string, unknown> = { name, modules: JSON.parse(row.modules) as unknown[] };
	if (row.layout) base.layout = JSON.parse(row.layout) as unknown;
	return base;
}

function readUserConfig(username: string, clientName?: string): object {
	const db = getDb();
	if (clientName) {
		const row = db.select().from(userConfigsTable)
			.where(and(eq(userConfigsTable.username, username), eq(userConfigsTable.clientName, clientName)))
			.get();
		if (row) return rowToConfig(row, username);
	}
	const globalRow = db.select().from(userConfigsTable)
		.where(and(eq(userConfigsTable.username, username), eq(userConfigsTable.clientName, "")))
		.get();
	if (globalRow) return rowToConfig(globalRow, username);
	return { name: username, modules: [] };
}

function writeUserConfig(username: string, modules: unknown[], clientName?: string): void {
	const db = getDb();
	const clientNameVal = clientName ?? "";
	db.insert(userConfigsTable)
		.values({ username, clientName: clientNameVal, modules: JSON.stringify(modules), layout: null })
		.onConflictDoUpdate({
			target: [userConfigsTable.username, userConfigsTable.clientName],
			set: { modules: JSON.stringify(modules), layout: null },
		})
		.run();
}

function writeUserLayout(username: string, layout: unknown, clientName: string): void {
	const db = getDb();
	db.insert(userConfigsTable)
		.values({ username, clientName, modules: "[]", layout: JSON.stringify(layout) })
		.onConflictDoUpdate({
			target: [userConfigsTable.username, userConfigsTable.clientName],
			set: { layout: JSON.stringify(layout) },
		})
		.run();
}

export function registerUserRoutes(
	app: Application,
	auth: AuthService,
	config: ServerConfig,
	clientMap: Map<string, SocketIOSocket>,
	getTrackedClients: () => ClientTracker[],
	triggerHelperLoads: (body: { modules?: unknown; layout?: unknown }) => void,
	rootDir: string,
): void {
	const authed = requireAuth(auth);

	/**
	 * @openapi
	 * /user/config:
	 *   get:
	 *     summary: Returns the logged-in user's global module config (not mirror-specific)
	 *     tags: [User]
	 *     security:
	 *       - cookie: []
	 *     responses:
	 *       200:
	 *         description: User config
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/UserConfig' }
	 *       401:
	 *         description: Not authenticated
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.get("/user/config", authed, (req, res) => {
		const { username } = (req as typeof req & { sessionInfo: { username: string } }).sessionInfo;
		try { res.json(readUserConfig(username)); }
		catch { res.status(500).json({ error: "Failed to read config" }); }
	});

	/**
	 * @openapi
	 * /user/config/{client}:
	 *   get:
	 *     summary: Returns the logged-in user's config for a specific mirror, falls back to global if none set
	 *     tags: [User]
	 *     security:
	 *       - cookie: []
	 *     parameters:
	 *       - in: path
	 *         name: client
	 *         required: true
	 *         schema: { type: string }
	 *     responses:
	 *       200:
	 *         description: User config for the mirror
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/UserConfig' }
	 *       401:
	 *         description: Not authenticated
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.get("/user/config/:client", authed, (req, res) => {
		const { username } = (req as typeof req & { sessionInfo: { username: string } }).sessionInfo;
		const clientName = req.params["client"] as string;
		try { res.json(readUserConfig(username, clientName)); }
		catch { res.status(500).json({ error: "Failed to read config" }); }
	});

	/**
	 * @openapi
	 * /user/clients:
	 *   get:
	 *     summary: Returns mirrors the logged-in user is assigned to, filtered to currently active clients
	 *     tags: [User]
	 *     security:
	 *       - cookie: []
	 *     responses:
	 *       200:
	 *         description: Array of mirror names
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items: { type: string }
	 *       401:
	 *         description: Not authenticated
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.get("/user/clients", authed, (req, res) => {
		const { username } = (req as typeof req & { sessionInfo: { username: string } }).sessionInfo;
		const db = getDb();
		const rows = db.select({ clientName: clientUsersTable.clientName })
			.from(clientUsersTable)
			.where(eq(clientUsersTable.username, username))
			.all();
		const assigned = rows
			.map((r) => r.clientName)
			.filter((name) => config.clientConfigs.includes(name));
		res.json(assigned);
	});

	/**
	 * @openapi
	 * /user/modules/available:
	 *   get:
	 *     summary: Returns all modules available to regular users — excludes admin-only modules
	 *     tags: [User]
	 *     security:
	 *       - cookie: []
	 *     responses:
	 *       200:
	 *         description: Array of module names
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items: { type: string }
	 *       401:
	 *         description: Not authenticated
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.get("/user/modules/available", authed, (_req, res) => {
		const adminOnly = new Set([
			"alert", "clientDetailes", "clientDisplay", "userManager", "personalization",
		]);
		const modulesDir = path.join(rootDir, "modules");
		let defaultModules: string[] = [];
		try {
			const defaultDir = path.join(modulesDir, "default");
			defaultModules = fs.readdirSync(defaultDir).filter((name) => {
				if (adminOnly.has(name)) return false;
				return fs.statSync(path.join(defaultDir, name)).isDirectory();
			});
		} catch { /* no default modules dir */ }

		let thirdParty: string[] = [];
		try {
			thirdParty = fs.readdirSync(modulesDir).filter((name) => {
				if (name === "default") return false;
				return fs.statSync(path.join(modulesDir, name)).isDirectory();
			});
		} catch { /* no modules dir */ }

		res.json([...defaultModules, ...thirdParty]);
	});

	/**
	 * @openapi
	 * /modules/manifest/{name}:
	 *   get:
	 *     summary: Returns a module's manifest (module.json) — checks default/ first, then third-party
	 *     tags: [User]
	 *     parameters:
	 *       - in: path
	 *         name: name
	 *         required: true
	 *         schema: { type: string }
	 *     responses:
	 *       200:
	 *         description: Manifest object, or empty object if not found
	 *         content:
	 *           application/json:
	 *             schema: { type: object }
	 */
	app.get("/modules/manifest/:name", (req, res) => {
		const { name } = req.params as { name: string };
		const candidates = [
			path.join(rootDir, "modules", "default", name, "module.json"),
			path.join(rootDir, "modules", name, "module.json"),
		];
		for (const p of candidates) {
			if (fs.existsSync(p)) {
				try { res.json(JSON.parse(fs.readFileSync(p, "utf8")) as object); }
				catch { res.status(500).json({ error: "Failed to read manifest" }); }
				return;
			}
		}
		res.json({});
	});

	/**
	 * @openapi
	 * /user/config:
	 *   put:
	 *     summary: Saves the logged-in user's global config — accepts flat modules array or paged layout object
	 *     tags: [User]
	 *     security:
	 *       - cookie: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             oneOf:
	 *               - type: object
	 *                 properties:
	 *                   modules: { type: array, items: { $ref: '#/components/schemas/ModuleDefinition' } }
	 *                 required: [modules]
	 *               - type: object
	 *                 properties:
	 *                   layout: { $ref: '#/components/schemas/ClientLayout' }
	 *                 required: [layout]
	 *     responses:
	 *       200:
	 *         description: Saved
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Ok' }
	 *       400:
	 *         description: Invalid body
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.put("/user/config", authed, (req, res) => {
		const { username } = (req as typeof req & { sessionInfo: { username: string } }).sessionInfo;
		const body = req.body as { modules?: unknown; layout?: unknown };
		try {
			if (body.layout !== undefined) {
				if (!body.layout || typeof body.layout !== "object" || !Array.isArray((body.layout as Record<string, unknown>).pages)) {
					res.status(400).json({ error: "layout must be a ClientLayout object with a pages array" }); return;
				}
				writeUserLayout(username, body.layout, "");
			} else {
				if (!Array.isArray(body.modules)) {
					res.status(400).json({ error: "modules must be an array" }); return;
				}
				writeUserConfig(username, body.modules as unknown[]);
			}
			res.json({ ok: true });
			triggerHelperLoads(body);
		} catch {
			res.status(500).json({ error: "Failed to save config" });
		}
	});

	/**
	 * @openapi
	 * /user/config/{client}:
	 *   put:
	 *     summary: Saves the logged-in user's config for a specific mirror — accepts flat modules array or paged layout object
	 *     tags: [User]
	 *     security:
	 *       - cookie: []
	 *     parameters:
	 *       - in: path
	 *         name: client
	 *         required: true
	 *         schema: { type: string }
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             oneOf:
	 *               - type: object
	 *                 properties:
	 *                   modules: { type: array, items: { $ref: '#/components/schemas/ModuleDefinition' } }
	 *                 required: [modules]
	 *               - type: object
	 *                 properties:
	 *                   layout: { $ref: '#/components/schemas/ClientLayout' }
	 *                 required: [layout]
	 *     responses:
	 *       200:
	 *         description: Saved
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Ok' }
	 *       400:
	 *         description: Invalid body
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.put("/user/config/:client", authed, (req, res) => {
		const { username } = (req as typeof req & { sessionInfo: { username: string } }).sessionInfo;
		const clientName = req.params["client"] as string;
		const body = req.body as { modules?: unknown; layout?: unknown };
		try {
			if (body.layout !== undefined) {
				if (!body.layout || typeof body.layout !== "object" || !Array.isArray((body.layout as Record<string, unknown>).pages)) {
					res.status(400).json({ error: "layout must be a ClientLayout object with a pages array" }); return;
				}
				writeUserLayout(username, body.layout, clientName);
			} else {
				if (!Array.isArray(body.modules)) {
					res.status(400).json({ error: "modules must be an array" }); return;
				}
				writeUserConfig(username, body.modules as unknown[], clientName);
			}
			res.json({ ok: true });
			triggerHelperLoads(body);
		} catch {
			res.status(500).json({ error: "Failed to save config" });
		}
	});

	/**
	 * @openapi
	 * /clients/{client}/page-command:
	 *   post:
	 *     summary: Sends a page navigation command to a connected mirror — admin always allowed, otherwise only the mirror's current user
	 *     tags: [User]
	 *     security:
	 *       - cookie: []
	 *     parameters:
	 *       - in: path
	 *         name: client
	 *         required: true
	 *         schema: { type: string }
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             properties:
	 *               action:
	 *                 type: string
	 *                 enum: [select, next, prev, home, showHidden, leaveHidden, pauseRotation, resumeRotation]
	 *               page:
	 *                 type: integer
	 *                 description: Required when action is 'select'
	 *               name:
	 *                 type: string
	 *                 description: Required when action is 'showHidden'
	 *             required: [action]
	 *     responses:
	 *       200:
	 *         description: Command sent
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Ok' }
	 *       403:
	 *         description: Not authorized to control this mirror
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 *       503:
	 *         description: Mirror not connected
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.post("/clients/:client/page-command", authed, (req, res) => {
		const session = (req as typeof req & { sessionInfo: { username: string; role: string } }).sessionInfo;
		const clientName = req.params["client"] as string;
		const db = getDb();

		const exists = db.select({ name: clientsTable.name })
			.from(clientsTable).where(eq(clientsTable.name, clientName)).get();
		if (!exists) { res.status(404).json({ error: "Client not found" }); return; }

		const trackedClient = getTrackedClients().find((c) => c.name === clientName);
		const currentUser = trackedClient?.user ?? "default";

		if (session.role !== "admin" && currentUser !== "default" && session.username !== currentUser) {
			res.status(403).json({ error: "Not authorized to control this client" }); return;
		}

		const socket = clientMap.get(clientName);
		if (!socket) { res.status(503).json({ error: "Client not connected" }); return; }

		const VALID_ACTIONS = new Set([
			"select", "next", "prev", "home",
			"showHidden", "leaveHidden",
			"pauseRotation", "resumeRotation",
		]);
		const body = req.body as { action?: string; page?: unknown; name?: unknown };

		if (!body.action || !VALID_ACTIONS.has(body.action)) {
			res.status(400).json({ error: `action must be one of: ${[...VALID_ACTIONS].join(", ")}` }); return;
		}
		if (body.action === "select" && (typeof body.page !== "number" || !Number.isInteger(body.page))) {
			res.status(400).json({ error: "select requires an integer 'page' field" }); return;
		}
		if (body.action === "showHidden" && typeof body.name !== "string") {
			res.status(400).json({ error: "showHidden requires a string 'name' field" }); return;
		}

		socket.emit("PAGE_COMMAND", {
			action: body.action,
			...(body.action === "select" ? { page: body.page as number } : {}),
			...(body.action === "showHidden" ? { name: body.name as string } : {}),
		});
		res.json({ ok: true });
	});

	/**
	 * @openapi
	 * /user/profile:
	 *   get:
	 *     summary: Returns the logged-in user's profile (username, displayName)
	 *     tags: [User]
	 *     security:
	 *       - cookie: []
	 *     responses:
	 *       200:
	 *         description: User profile
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 username: { type: string }
	 *                 displayName: { type: string }
	 *               required: [username, displayName]
	 *       401:
	 *         description: Not authenticated
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.get("/user/profile", authed, (req, res) => {
		const session = (req as typeof req & { sessionInfo: { username: string; displayName: string } }).sessionInfo;
		res.json({ username: session.username, displayName: session.displayName });
	});

	/**
	 * @openapi
	 * /user/profile:
	 *   put:
	 *     summary: Update the logged-in user's display name and/or password
	 *     tags: [User]
	 *     security:
	 *       - cookie: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             properties:
	 *               displayName: { type: string }
	 *               password: { type: string }
	 *               currentPassword: { type: string }
	 *     responses:
	 *       200:
	 *         description: Profile updated
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Ok' }
	 *       400:
	 *         description: Validation error
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 *       401:
	 *         description: Not authenticated or wrong current password
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.put("/user/profile", authed, (req, res) => {
		const session = (req as typeof req & { sessionInfo: { username: string } }).sessionInfo;
		const { displayName, password, currentPassword } = req.body as {
			displayName?: string;
			password?: string;
			currentPassword?: string;
		};

		if (password) {
			if (!currentPassword) { res.status(400).json({ error: "Current password required to set a new password" }); return; }
			const valid = auth.login(session!.username, currentPassword);
			if (!valid) { res.status(401).json({ error: "Current password is incorrect" }); return; }
		}

		if (!displayName && !password) { res.status(400).json({ error: "Nothing to update" }); return; }

		auth.updateAccount(session!.username, { displayName, password });
		res.json({ ok: true });
	});
}

export function registerServiceRoutes(app: Application, getDefaultModuleNames: () => string[]): void {
	/**
	 * @openapi
	 * /config/default-modules:
	 *   get:
	 *     summary: Returns the list of built-in default module names known to the server
	 *     tags: [Service]
	 *     responses:
	 *       200:
	 *         description: Array of module names
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items: { type: string }
	 */
	app.get("/config/default-modules", (_req, res) => {
		res.json(getDefaultModuleNames());
	});

	/**
	 * @openapi
	 * /{client}/layout:
	 *   get:
	 *     summary: Returns the effective layout for a mirror — from DB if set, otherwise synthesised from defaultModules
	 *     tags: [Service]
	 *     parameters:
	 *       - in: path
	 *         name: client
	 *         required: true
	 *         schema: { type: string }
	 *     responses:
	 *       200:
	 *         description: Client layout
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/ClientLayout' }
	 *       404:
	 *         description: Client not found
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.get("/:client/layout", (req, res) => {
		const clientName = req.params["client"] as string;
		const db = getDb();
		const row = db.select({ layout: clientsTable.layout, defaultModules: clientsTable.defaultModules })
			.from(clientsTable).where(eq(clientsTable.name, clientName)).get();
		if (!row) { res.status(404).json({ error: "Client not found" }); return; }
		res.json(resolveLayout(row));
	});

	/**
	 * @openapi
	 * /get-user/{userName}:
	 *   post:
	 *     summary: Returns a user's config for the posting mirror — mirror name sent as plain-text body, falls back to global
	 *     tags: [Service]
	 *     parameters:
	 *       - in: path
	 *         name: userName
	 *         required: true
	 *         schema: { type: string }
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         text/plain:
	 *           schema:
	 *             type: string
	 *             description: The mirror's client name
	 *     responses:
	 *       200:
	 *         description: User config for the given mirror
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/UserConfig' }
	 *       404:
	 *         description: No config found for this user
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.post("/get-user/:userName", (req, res) => {
		const userName = req.params.userName;
		let clientName = "";

		req.on("data", (chunk) => { clientName += chunk.toString(); });
		req.on("end", () => {
			const db = getDb();
			if (clientName) {
				const row = db.select().from(userConfigsTable)
					.where(and(eq(userConfigsTable.username, userName), eq(userConfigsTable.clientName, clientName)))
					.get();
				if (row) { res.json(rowToConfig(row, userName)); return; }
			}
			const globalRow = db.select().from(userConfigsTable)
				.where(and(eq(userConfigsTable.username, userName), eq(userConfigsTable.clientName, "")))
				.get();
			if (globalRow) { res.json(rowToConfig(globalRow, userName)); return; }
			res.status(404).json({ error: "User config not found" });
		});
	});
}

