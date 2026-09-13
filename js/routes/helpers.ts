import type { Request, Response, NextFunction } from "express";
import type { ClientLayout, ModuleDefinition } from "../../types/module.js";
import { AuthService, COOKIE_NAME } from "../authService.js";
import type { ServerConfig } from "../../types/config.js";

export function resolveLayout(row: { layout: string | null; defaultModules: string }): ClientLayout {
	if (row.layout) return JSON.parse(row.layout) as ClientLayout;
	return {
		pages: [{ modules: JSON.parse(row.defaultModules) as ModuleDefinition[] }],
		fixed: [],
	};
}

export function requireAuth(auth: AuthService) {
	return (req: Request, res: Response, next: NextFunction): void => {
		const token = auth.parseCookie(req.headers.cookie, COOKIE_NAME);
		if (!token) { res.status(401).json({ error: "Not authenticated" }); return; }
		const session = auth.getSession(token);
		if (!session) { res.status(401).json({ error: "Session expired" }); return; }
		(req as Request & { sessionInfo: typeof session }).sessionInfo = session;
		next();
	};
}

export function requireAdmin(auth: AuthService) {
	return (req: Request, res: Response, next: NextFunction): void => {
		const token = auth.parseCookie(req.headers.cookie, COOKIE_NAME);
		if (!token) { res.status(401).json({ error: "Not authenticated" }); return; }
		const session = auth.getSession(token);
		if (!session) { res.status(401).json({ error: "Session expired" }); return; }
		if (session.role !== "admin") { res.status(403).json({ error: "Admin required" }); return; }
		next();
	};
}

/** Accepts an X-Api-Key header matching config.apiKey, or a valid admin session cookie. */
export function requireApiKeyOrAdmin(auth: AuthService, config: ServerConfig) {
	return (req: Request, res: Response, next: NextFunction): void => {
		const key = req.headers["x-api-key"];
		if (config.apiKey && key === config.apiKey) { next(); return; }
		const token = auth.parseCookie(req.headers.cookie, COOKIE_NAME);
		if (!token) { res.status(401).json({ error: "API key or admin session required" }); return; }
		const session = auth.getSession(token);
		if (!session) { res.status(401).json({ error: "Session expired" }); return; }
		if (session.role !== "admin") { res.status(403).json({ error: "API key or admin session required" }); return; }
		next();
	};
}
