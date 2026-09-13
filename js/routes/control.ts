import type { Application } from "express";
import { eq } from "drizzle-orm";
import type { Socket as SocketIOSocket } from "socket.io";
import { AuthService } from "../authService.js";
import { getDb } from "../db/index.js";
import { clients as clientsTable } from "../db/schema.js";
import type { ServerConfig } from "../../types/config.js";
import type ClientTracker from "../clientTracker.js";
import { requireApiKeyOrAdmin } from "./helpers.js";

export function registerControlRoutes(
	app: Application,
	auth: AuthService,
	config: ServerConfig,
	clientMap: Map<string, SocketIOSocket>,
	getTrackedClients: () => ClientTracker[],
): void {
	const serviceAuth = requireApiKeyOrAdmin(auth, config);

	/**
	 * @openapi
	 * /clients/{client}/user:
	 *   post:
	 *     summary: Switch the active user on a mirror — accepts admin session or X-Api-Key header
	 *     tags: [Control]
	 *     security:
	 *       - cookie: []
	 *       - apiKey: []
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
	 *               username: { type: string, description: "Username to switch to, or 'default' to clear" }
	 *             required: [username]
	 *     responses:
	 *       200:
	 *         description: User switched
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Ok' }
	 *       400:
	 *         description: Missing username
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 *       404:
	 *         description: Client or user not found
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.post("/clients/:client/user", serviceAuth, (req, res) => {
		const clientName = req.params["client"] as string;
		const { username } = req.body as { username?: string };

		if (!username) { res.status(400).json({ error: "username required" }); return; }

		const db = getDb();
		const clientRow = db.select({ name: clientsTable.name })
			.from(clientsTable).where(eq(clientsTable.name, clientName)).get();
		if (!clientRow) { res.status(404).json({ error: "Client not found" }); return; }

		const user = username === "default" ? "default" : username;

		if (user !== "default") {
			const known = auth.listAccounts().some((a) => a.username === user);
			if (!known) { res.status(404).json({ error: "User not found" }); return; }
		}

		const tracked = getTrackedClients().find((c) => c.name === clientName);
		if (tracked) tracked.user = user;
		db.update(clientsTable).set({ currentUser: user })
			.where(eq(clientsTable.name, clientName)).run();

		clientMap.get(clientName)?.emit("CHANGE_USER_Y", { client: clientName, user });
		res.json({ ok: true });
	});

	/**
	 * @openapi
	 * /clients/{client}/presence:
	 *   post:
	 *     summary: Signal user presence to a mirror — modules can react to wake/sleep the display
	 *     tags: [Control]
	 *     security:
	 *       - cookie: []
	 *       - apiKey: []
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
	 *               active: { type: boolean, description: "true = someone present, false = nobody" }
	 *             required: [active]
	 *     responses:
	 *       200:
	 *         description: Presence signal sent
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Ok' }
	 *       400:
	 *         description: Missing or invalid active field
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 *       404:
	 *         description: Client not found
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.post("/clients/:client/presence", serviceAuth, (req, res) => {
		const clientName = req.params["client"] as string;
		const { active } = req.body as { active?: unknown };

		if (typeof active !== "boolean") { res.status(400).json({ error: "active (boolean) required" }); return; }

		const db = getDb();
		const clientRow = db.select({ name: clientsTable.name })
			.from(clientsTable).where(eq(clientsTable.name, clientName)).get();
		if (!clientRow) { res.status(404).json({ error: "Client not found" }); return; }

		clientMap.get(clientName)?.emit("PRESENCE", { active });
		res.json({ ok: true });
	});
}
