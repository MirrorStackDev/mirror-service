import path from "node:path";
import type { Application } from "express";
import { AuthService, COOKIE_NAME } from "../authService.js";

const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

export function registerAuthRoutes(app: Application, auth: AuthService, rootDir: string): void {
	app.get("/login", (_req, res) => {
		res.sendFile(path.resolve(rootDir, "public/login.html"));
	});

	/**
	 * @openapi
	 * /auth/login:
	 *   post:
	 *     summary: Log in and receive a session cookie
	 *     tags: [Auth]
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             properties:
	 *               username: { type: string }
	 *               password: { type: string }
	 *             required: [username, password]
	 *     responses:
	 *       200:
	 *         description: Logged in — sets authToken cookie
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 username: { type: string }
	 *                 displayName: { type: string }
	 *                 role: { type: string, enum: [admin, user] }
	 *       400:
	 *         description: Missing username or password
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 *       401:
	 *         description: Invalid credentials
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.post("/auth/login", (req, res) => {
		const { username, password } = req.body as { username?: string; password?: string };
		if (!username || !password) {
			res.status(400).json({ error: "Username and password required" });
			return;
		}
		const session = auth.login(username, password);
		if (!session) {
			res.status(401).json({ error: "Invalid credentials" });
			return;
		}
		res.setHeader(
			"Set-Cookie",
			`${COOKIE_NAME}=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE}`,
		);
		res.json({ username: session.username, displayName: session.displayName, role: session.role });
	});

	/**
	 * @openapi
	 * /auth/logout:
	 *   post:
	 *     summary: Log out and clear the session cookie
	 *     tags: [Auth]
	 *     security:
	 *       - cookie: []
	 *     responses:
	 *       200:
	 *         description: Logged out
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Ok' }
	 */
	app.post("/auth/logout", (req, res) => {
		const token = auth.parseCookie(req.headers.cookie, COOKIE_NAME);
		if (token) auth.logout(token);
		res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
		res.json({ ok: true });
	});

	/**
	 * @openapi
	 * /auth/me:
	 *   get:
	 *     summary: Return the current session's user info
	 *     tags: [Auth]
	 *     security:
	 *       - cookie: []
	 *     responses:
	 *       200:
	 *         description: Active session info
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Session' }
	 *       401:
	 *         description: Not authenticated or session expired
	 *         content:
	 *           application/json:
	 *             schema: { $ref: '#/components/schemas/Error' }
	 */
	app.get("/auth/me", (req, res) => {
		const token = auth.parseCookie(req.headers.cookie, COOKIE_NAME);
		if (!token) { res.status(401).json({ error: "Not authenticated" }); return; }
		const session = auth.getSession(token);
		if (!session) { res.status(401).json({ error: "Session expired" }); return; }
		res.json(session);
	});
}
