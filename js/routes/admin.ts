import type { Application } from "express";
import { eq } from "drizzle-orm";
import { AuthService } from "../authService.js";
import { getDb } from "../db/index.js";
import { clients as clientsTable, clientUsers as clientUsersTable, userConfigs as userConfigsTable } from "../db/schema.js";
import type { ServerConfig } from "../../types/config.js";
import type { ClientLayout } from "../../types/module.js";
import { requireAdmin } from "./helpers.js";

export function registerAdminRoutes(app: Application, auth: AuthService, config: ServerConfig): void {
	const admin = requireAdmin(auth);

	/**
	 * @openapi
	 * /admin/users:
	 *   get:
	 *     summary: List all user accounts
	 *     tags: [Admin]
	 *     security:
	 *       - cookie: []
	 *     responses:
	 *       200:
	 *         description: Array of accounts
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items: { $ref: '#/components/schemas/Account' }
	 *       401:
	 *         description: Not authenticated
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 *       403:
	 *         description: Admin role required
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.get("/admin/users", admin, (_req, res) => {
		res.json(auth.listAccounts());
	});

	/**
	 * @openapi
	 * /admin/users:
	 *   post:
	 *     summary: Create a new user account
	 *     tags: [Admin]
	 *     security:
	 *       - cookie: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             properties:
	 *               username: { type: string }
	 *               displayName: { type: string }
	 *               role: { type: string, enum: [admin, user] }
	 *               password: { type: string }
	 *             required: [username, displayName, role, password]
	 *     responses:
	 *       201:
	 *         description: Account created
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Ok' }
	 *       400:
	 *         description: Missing fields
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 *       409:
	 *         description: Username already taken
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.post("/admin/users", admin, (req, res) => {
		const { username, displayName, role, password } = req.body as Record<string, string>;
		if (!username || !displayName || !role || !password) {
			res.status(400).json({ error: "All fields required" });
			return;
		}
		try {
			auth.createAccount(username, displayName, role as "admin" | "user", password);
			getDb().insert(userConfigsTable)
				.values({ username, clientName: "", modules: "[]" })
				.onConflictDoNothing()
				.run();
			res.status(201).json({ ok: true });
		} catch (e) {
			res.status(409).json({ error: (e as Error).message });
		}
	});

	/**
	 * @openapi
	 * /admin/users/{username}:
	 *   patch:
	 *     summary: Update a user's display name, role, or password
	 *     tags: [Admin]
	 *     security:
	 *       - cookie: []
	 *     parameters:
	 *       - in: path
	 *         name: username
	 *         required: true
	 *         schema: { type: string }
	 *     requestBody:
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             properties:
	 *               displayName: { type: string }
	 *               role: { type: string, enum: [admin, user] }
	 *               password: { type: string }
	 *     responses:
	 *       200:
	 *         description: Updated
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Ok' }
	 *       404:
	 *         description: User not found
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.patch("/admin/users/:username", admin, (req, res) => {
		try {
			auth.updateAccount(
				req.params["username"] as string,
				req.body as { displayName?: string; role?: "admin" | "user"; password?: string },
			);
			res.json({ ok: true });
		} catch (e) {
			res.status(404).json({ error: (e as Error).message });
		}
	});

	/**
	 * @openapi
	 * /admin/users/{username}:
	 *   delete:
	 *     summary: Delete a user account
	 *     tags: [Admin]
	 *     security:
	 *       - cookie: []
	 *     parameters:
	 *       - in: path
	 *         name: username
	 *         required: true
	 *         schema: { type: string }
	 *     responses:
	 *       200:
	 *         description: Deleted
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Ok' }
	 *       404:
	 *         description: User not found
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.delete("/admin/users/:username", admin, (req, res) => {
		const username = req.params["username"] as string;
		try {
			auth.deleteAccount(username);
			res.json({ ok: true });
		} catch (e) {
			res.status(404).json({ error: (e as Error).message });
		}
	});

	/**
	 * @openapi
	 * /admin/clients:
	 *   get:
	 *     summary: List all mirrors and their assigned users
	 *     tags: [Admin]
	 *     security:
	 *       - cookie: []
	 *     responses:
	 *       200:
	 *         description: Array of clients with their user lists
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 type: object
	 *                 properties:
	 *                   name: { type: string }
	 *                   users: { type: array, items: { type: string } }
	 */
	app.get("/admin/clients", admin, (_req, res) => {
		const db = getDb();
		const clients = config.clientConfigs.map((name) => {
			const rows = db.select({ username: clientUsersTable.username })
				.from(clientUsersTable)
				.where(eq(clientUsersTable.clientName, name))
				.all();
			return { name, users: rows.map((r) => r.username) };
		});
		res.json(clients);
	});

	/**
	 * @openapi
	 * /admin/clients/{client}/users:
	 *   put:
	 *     summary: Replace the full list of users assigned to a mirror
	 *     tags: [Admin]
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
	 *               users: { type: array, items: { type: string } }
	 *             required: [users]
	 *     responses:
	 *       200:
	 *         description: Users updated
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Ok' }
	 *       404:
	 *         description: Client not found
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.put("/admin/clients/:client/users", admin, (req, res) => {
		const clientName = req.params["client"] as string;
		if (!config.clientConfigs.includes(clientName)) {
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

	/**
	 * @openapi
	 * /admin/clients/{client}/config:
	 *   get:
	 *     summary: Get a mirror's full configuration
	 *     tags: [Admin]
	 *     security:
	 *       - cookie: []
	 *     parameters:
	 *       - in: path
	 *         name: client
	 *         required: true
	 *         schema: { type: string }
	 *     responses:
	 *       200:
	 *         description: Client configuration
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/ClientInfo' }
	 *       404:
	 *         description: Client not found
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.get("/admin/clients/:client/config", admin, (req, res) => {
		const clientName = req.params["client"] as string;
		const db = getDb();
		const row = db.select({
			name: clientsTable.name,
			type: clientsTable.type,
			userSwitchMode: clientsTable.userSwitchMode,
			defaultModules: clientsTable.defaultModules,
			layout: clientsTable.layout,
			showNav: clientsTable.showNav,
		}).from(clientsTable).where(eq(clientsTable.name, clientName)).get();

		if (!row) { res.status(404).json({ error: "Client not found" }); return; }

		res.json({
			name: row.name,
			type: row.type,
			userSwitchMode: row.userSwitchMode,
			defaultModules: JSON.parse(row.defaultModules) as unknown[],
			layout: row.layout ? JSON.parse(row.layout) as ClientLayout : null,
			showNav: row.showNav,
		});
	});

	/**
	 * @openapi
	 * /admin/clients/{client}/config:
	 *   put:
	 *     summary: Update a mirror's configuration (partial — only supplied fields are changed)
	 *     tags: [Admin]
	 *     security:
	 *       - cookie: []
	 *     parameters:
	 *       - in: path
	 *         name: client
	 *         required: true
	 *         schema: { type: string }
	 *     requestBody:
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             properties:
	 *               type: { type: string, enum: [mirror, dashboard] }
	 *               userSwitchMode: { type: string, enum: [SAVE, DELETE] }
	 *               defaultModules: { type: array, items: { $ref: '#/components/schemas/ModuleDefinition' } }
	 *               layout: { oneOf: [{ $ref: '#/components/schemas/ClientLayout' }, { type: 'null' }] }
	 *     responses:
	 *       200:
	 *         description: Updated
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Ok' }
	 *       400:
	 *         description: Invalid field value or no fields provided
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 *       404:
	 *         description: Client not found
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.put("/admin/clients/:client/config", admin, (req, res) => {
		const clientName = req.params["client"] as string;
		const db = getDb();

		const existing = db.select({ name: clientsTable.name })
			.from(clientsTable).where(eq(clientsTable.name, clientName)).get();
		if (!existing) { res.status(404).json({ error: "Client not found" }); return; }

		const body = req.body as {
			type?: string;
			userSwitchMode?: string;
			defaultModules?: unknown[];
			layout?: ClientLayout | null;
			showNav?: boolean;
		};

		if (body.type !== undefined && body.type !== "mirror" && body.type !== "dashboard") {
			res.status(400).json({ error: "type must be 'mirror' or 'dashboard'" }); return;
		}
		if (body.userSwitchMode !== undefined && body.userSwitchMode !== "SAVE" && body.userSwitchMode !== "DELETE") {
			res.status(400).json({ error: "userSwitchMode must be 'SAVE' or 'DELETE'" }); return;
		}
		if (body.defaultModules !== undefined && !Array.isArray(body.defaultModules)) {
			res.status(400).json({ error: "defaultModules must be an array" }); return;
		}
		if (body.layout !== undefined && body.layout !== null && typeof body.layout !== "object") {
			res.status(400).json({ error: "layout must be an object or null" }); return;
		}
		if (body.layout !== null && body.layout !== undefined) {
			if (!Array.isArray(body.layout.pages) || !Array.isArray(body.layout.fixed)) {
				res.status(400).json({ error: "layout must have pages (array) and fixed (array)" }); return;
			}
		}
		if (body.showNav !== undefined && typeof body.showNav !== "boolean") {
			res.status(400).json({ error: "showNav must be a boolean" }); return;
		}

		const patch: { type?: string; userSwitchMode?: string; defaultModules?: string; layout?: string | null; showNav?: boolean } = {};
		if (body.type !== undefined) patch.type = body.type;
		if (body.userSwitchMode !== undefined) patch.userSwitchMode = body.userSwitchMode;
		if (body.defaultModules !== undefined) patch.defaultModules = JSON.stringify(body.defaultModules);
		if (body.layout !== undefined) patch.layout = body.layout === null ? null : JSON.stringify(body.layout);
		if (body.showNav !== undefined) patch.showNav = body.showNav;

		if (Object.keys(patch).length === 0) {
			res.status(400).json({ error: "No valid fields provided" }); return;
		}

		db.update(clientsTable).set(patch).where(eq(clientsTable.name, clientName)).run();
		res.json({ ok: true });
	});
}
