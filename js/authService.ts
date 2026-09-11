import crypto from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { log } from "./logger.js";
import type { Db } from "./db/index.js";
import { accounts as accountsTable, sessions as sessionsTable, userConfigs as userConfigsTable } from "./db/schema.js";
import type { Session, SessionInfo, UserRole } from "../types/auth.js";

export const COOKIE_NAME = "hms-session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Handles account management and session lifecycle.
 * Sessions are stored in SQLite and mirrored in an in-memory cache for fast token lookups.
 * Expired sessions are purged from both on construction and on access.
 */
export class AuthService {
	private db: Db;
	private sessionCache = new Map<string, Session>();

	constructor(db: Db) {
		this.db = db;
		this.ensureAccounts();
		this.loadSessions();
	}

	private hashPassword(password: string, salt: string): string {
		return crypto.scryptSync(password, salt, 64).toString("hex");
	}

	private ensureAccounts(): void {
		const existing = this.db.select().from(accountsTable).limit(1).all();
		if (existing.length > 0) return;

		const salt = crypto.randomBytes(16).toString("hex");
		this.db.insert(accountsTable).values({
			username: "admin",
			displayName: "Admin",
			role: "admin",
			passwordHash: this.hashPassword("admin", salt),
			salt,
		}).run();
		log.warn("Auth", "No accounts found. Created default admin/admin — change the password immediately.");
	}

	private loadSessions(): void {
		const now = Date.now();
		this.db.delete(sessionsTable).where(lt(sessionsTable.expiresAt, now)).run();
		const rows = this.db.select().from(sessionsTable).all();
		for (const row of rows) {
			this.sessionCache.set(row.token, row as Session);
		}
		log.info("Auth", `Loaded ${this.sessionCache.size} active session(s).`);
	}

	/** Returns a new session on success, `null` on bad credentials (never throws). */
	login(username: string, password: string): Session | null {
		const account = this.db
			.select()
			.from(accountsTable)
			.where(eq(accountsTable.username, username))
			.get();
		if (!account || this.hashPassword(password, account.salt) !== account.passwordHash) {
			log.warn("Auth", `Login failed: ${username}`);
			return null;
		}

		const session: Session = {
			token: crypto.randomUUID(),
			username: account.username,
			displayName: account.displayName,
			role: account.role as UserRole,
			expiresAt: Date.now() + SESSION_TTL_MS,
		};
		this.sessionCache.set(session.token, session);
		this.db.insert(sessionsTable).values(session).run();
		log.info("Auth", `Login: ${username} (${account.role})`);
		return session;
	}

	/** Validates a token and returns public session info, or `null` if missing or expired. */
	getSession(token: string): SessionInfo | null {
		const session = this.sessionCache.get(token);
		if (!session) return null;
		if (session.expiresAt < Date.now()) {
			this.sessionCache.delete(token);
			this.db.delete(sessionsTable).where(eq(sessionsTable.token, token)).run();
			return null;
		}
		return { username: session.username, displayName: session.displayName, role: session.role };
	}

	logout(token: string): void {
		this.sessionCache.delete(token);
		this.db.delete(sessionsTable).where(eq(sessionsTable.token, token)).run();
	}

	listAccounts(): { username: string; displayName: string; role: string }[] {
		return this.db
			.select({
				username: accountsTable.username,
				displayName: accountsTable.displayName,
				role: accountsTable.role,
			})
			.from(accountsTable)
			.all();
	}

	/** @throws if the username is already taken. */
	createAccount(username: string, displayName: string, role: UserRole, password: string): void {
		const existing = this.db
			.select()
			.from(accountsTable)
			.where(eq(accountsTable.username, username))
			.get();
		if (existing) throw new Error(`User '${username}' already exists`);

		const salt = crypto.randomBytes(16).toString("hex");
		this.db.insert(accountsTable).values({
			username,
			displayName,
			role,
			passwordHash: this.hashPassword(password, salt),
			salt,
		}).run();
	}

	/** @throws if the user does not exist. */
	updateAccount(
		username: string,
		updates: { displayName?: string; role?: UserRole; password?: string },
	): void {
		const account = this.db
			.select()
			.from(accountsTable)
			.where(eq(accountsTable.username, username))
			.get();
		if (!account) throw new Error(`User '${username}' not found`);

		const values: { displayName?: string; role?: string; salt?: string; passwordHash?: string } = {};
		if (updates.displayName !== undefined) values.displayName = updates.displayName;
		if (updates.role !== undefined) values.role = updates.role;
		if (updates.password) {
			values.salt = crypto.randomBytes(16).toString("hex");
			values.passwordHash = this.hashPassword(updates.password, values.salt);
		}
		if (Object.keys(values).length > 0) {
			this.db.update(accountsTable).set(values).where(eq(accountsTable.username, username)).run();
		}
	}

	/**
	 * Deletes an account and invalidates all its active sessions.
	 * @throws if the user does not exist.
	 */
	deleteAccount(username: string): void {
		const account = this.db
			.select()
			.from(accountsTable)
			.where(eq(accountsTable.username, username))
			.get();
		if (!account) throw new Error(`User '${username}' not found`);

		for (const [token, session] of this.sessionCache) {
			if (session.username === username) this.sessionCache.delete(token);
		}
		// ON DELETE CASCADE in the schema removes the account's sessions from the DB
		this.db.delete(accountsTable).where(eq(accountsTable.username, username)).run();
	}

	parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
		return cookieHeader
			?.split(";")
			.map((c) => c.trim().split("="))
			.find(([k]) => k === name)?.[1];
	}
}
