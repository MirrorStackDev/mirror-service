import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { eq, and } from "drizzle-orm";

import Server from "../server.js";
import { AuthService, COOKIE_NAME } from "../authService.js";
import { initDb } from "../db/index.js";
import type { Db } from "../db/index.js";
import { clients as clientsTable, clientUsers as clientUsersTable, userConfigs as userConfigsTable } from "../db/schema.js";
import type { ServerConfig } from "../../types/config.js";

function buildConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
	const base: ServerConfig = {
		port: 0,
		address: "127.0.0.1",
		ipWhitelist: [],
		ipBlackList: [],
		https: false,
		httpHeaders: {
			contentSecurityPolicy: false,
			crossOriginOpenerPolicy: false,
			crossOriginEmbedderPolicy: false,
			crossOriginResourcePolicy: false,
			originAgentCluster: false,
		},
		checkServerInterval: 0,
		userSwitchMode: "SAVE",
		logLevel: [],
		reloadAfterServerRestart: false,
		language: "en",
		timeFormat: 24,
		units: "metric",
		zoom: 1,
		customCss: "",
		rootConf: "root",
		clientConfigs: ["bathroom"],
	};
	return { ...base, ...overrides };
}

function makeServer(rootDir: string, db: Db, config: ServerConfig = buildConfig()): Server {
	const srv = new Server(rootDir, config);
	srv.app = express();
	srv.app.use(express.json());
	srv.auth = new AuthService(db);
	return srv;
}

function sessionCookie(auth: AuthService, username: string, password: string): string {
	const session = auth.login(username, password)!;
	return `${COOKIE_NAME}=${session.token}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// loadTrackerFile
// ─────────────────────────────────────────────────────────────────────────────

describe("Server.loadTrackerFile", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "dalamirror-tracker-"));
		initDb(":memory:");
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("seeds configured clients into DB if absent and loads them as offline", () => {
		const srv = new Server(rootDir, buildConfig()); // clientConfigs: ["bathroom"], rootConf: "root"
		srv.loadTrackerFile();

		expect(srv.trackedClients).toHaveLength(2);
		const names = srv.trackedClients.map((t) => t.name);
		expect(names).toEqual(expect.arrayContaining(["bathroom", "root"]));
		expect(srv.trackedClients.every((t) => t.status === "offline")).toBe(true);
		expect(srv.trackedClients.every((t) => t.connections.length === 0)).toBe(true);
	});

	it("does not duplicate a client already in DB", () => {
		const db = initDb(":memory:");
		db.insert(clientsTable).values({ name: "bathroom", type: "mirror" }).run();

		const srv = new Server(rootDir, buildConfig());
		srv.loadTrackerFile();

		const rows = db.select().from(clientsTable).where(eq(clientsTable.name, "bathroom")).all();
		expect(rows).toHaveLength(1);
	});

	it("resets status to offline and connections to [] but preserves currentUser from DB", () => {
		const db = initDb(":memory:");
		db.insert(clientsTable).values({
			name: "bathroom",
			type: "mirror",
			status: "online",
			currentUser: "dala",
			connections: JSON.stringify([{ ip: "10.0.0.1", connectedAt: new Date().toISOString() }]),
			lastOnline: Date.now(),
		}).run();

		const srv = new Server(rootDir, buildConfig());
		srv.loadTrackerFile();

		const t = srv.trackedClients.find((c) => c.name === "bathroom");
		expect(t?.status).toBe("offline");
		expect(t?.connections).toEqual([]);
		expect(t?.user).toBe("dala");
	});

	it("preserves lastOnline from DB as a Date instance", () => {
		const db = initDb(":memory:");
		const ts = new Date("2026-06-01T12:00:00.000Z").getTime();
		db.insert(clientsTable).values({ name: "bathroom", type: "mirror", lastOnline: ts }).run();

		const srv = new Server(rootDir, buildConfig());
		srv.loadTrackerFile();

		const t = srv.trackedClients.find((c) => c.name === "bathroom");
		expect(t?.lastOnline).toBeInstanceOf(Date);
		expect(t?.lastOnline?.toISOString()).toBe("2026-06-01T12:00:00.000Z");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// userEndpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("Server.userEndpoints", () => {
	let rootDir: string;
	let db: Db;
	let srv: Server;
	let adminCookie: string;

	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "dalamirror-user-ep-"));
		db = initDb(":memory:");
		srv = makeServer(rootDir, db);
		srv.auth.createAccount("alice", "Alice", "user", "pass1");
		srv.userEndpoints();

		adminCookie = sessionCookie(srv.auth, "admin", "admin");
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("returns 401 on all GET routes without a session cookie", async () => {
		for (const route of ["/user/config", "/user/config/bathroom", "/user/clients", "/user/modules/available"]) {
			const res = await request(srv.app).get(route);
			expect(res.status).toBe(401);
		}
	});

	it("returns 401 on PUT routes without a session cookie", async () => {
		const r1 = await request(srv.app).put("/user/config").send({ modules: [] });
		expect(r1.status).toBe(401);
		const r2 = await request(srv.app).put("/user/config/bathroom").send({ modules: [] });
		expect(r2.status).toBe(401);
	});

	describe("GET /user/config", () => {
		it("returns the global user config when it exists", async () => {
			const modules = [{ module: "clock", position: "top_left" }];
			db.insert(userConfigsTable).values({ username: "admin", clientName: "", modules: JSON.stringify(modules) }).run();

			const res = await request(srv.app).get("/user/config").set("Cookie", adminCookie);
			expect(res.status).toBe(200);
			expect(res.body).toEqual({ name: "admin", modules });
		});

		it("returns an empty-modules fallback when no config row exists", async () => {
			const res = await request(srv.app).get("/user/config").set("Cookie", adminCookie);
			expect(res.status).toBe(200);
			expect(res.body).toEqual({ name: "admin", modules: [] });
		});
	});

	describe("GET /user/config/:client", () => {
		it("returns the client-specific config when it exists", async () => {
			const modules = [{ module: "clock" }];
			db.insert(userConfigsTable).values({ username: "admin", clientName: "bathroom", modules: JSON.stringify(modules) }).run();

			const res = await request(srv.app).get("/user/config/bathroom").set("Cookie", adminCookie);
			expect(res.status).toBe(200);
			expect(res.body).toEqual({ name: "admin", modules });
		});

		it("falls back to the global config when no client-specific row exists", async () => {
			const modules = [{ module: "clock" }];
			db.insert(userConfigsTable).values({ username: "admin", clientName: "", modules: JSON.stringify(modules) }).run();

			const res = await request(srv.app).get("/user/config/bathroom").set("Cookie", adminCookie);
			expect(res.status).toBe(200);
			expect(res.body).toEqual({ name: "admin", modules });
		});

		it("returns the empty-modules fallback when neither row exists", async () => {
			const res = await request(srv.app).get("/user/config/bathroom").set("Cookie", adminCookie);
			expect(res.status).toBe(200);
			expect(res.body).toEqual({ name: "admin", modules: [] });
		});
	});

	describe("GET /user/clients", () => {
		it("lists clients where the logged-in user appears in client_users", async () => {
			db.insert(clientsTable).values({ name: "bathroom", type: "mirror" }).run();
			db.insert(clientUsersTable).values({ clientName: "bathroom", username: "admin" }).run();
			db.insert(clientUsersTable).values({ clientName: "bathroom", username: "alice" }).run();

			const res = await request(srv.app).get("/user/clients").set("Cookie", adminCookie);
			expect(res.status).toBe(200);
			expect(res.body).toContain("bathroom");
		});

		it("excludes clients where the user is not listed", async () => {
			db.insert(clientsTable).values({ name: "bathroom", type: "mirror" }).run();
			db.insert(clientUsersTable).values({ clientName: "bathroom", username: "alice" }).run();

			const res = await request(srv.app).get("/user/clients").set("Cookie", adminCookie);
			expect(res.status).toBe(200);
			expect(res.body).not.toContain("bathroom");
		});
	});

	describe("GET /user/modules/available", () => {
		it("returns the default user-accessible modules", async () => {
			const res = await request(srv.app)
				.get("/user/modules/available")
				.set("Cookie", adminCookie);
			expect(res.status).toBe(200);
			expect(res.body).toContain("clock");
			expect(res.body).toContain("dbbutton");
		});

		it("excludes admin-only modules", async () => {
			const res = await request(srv.app)
				.get("/user/modules/available")
				.set("Cookie", adminCookie);
			expect(res.status).toBe(200);
			for (const m of ["alert", "clientDisplay", "clientDetailes", "userManager", "personalization"]) {
				expect(res.body).not.toContain(m);
			}
		});

		it("includes third-party module directories found under rootDir/modules", async () => {
			fs.mkdirSync(path.join(rootDir, "modules/mymodule"), { recursive: true });

			const res = await request(srv.app)
				.get("/user/modules/available")
				.set("Cookie", adminCookie);
			expect(res.status).toBe(200);
			expect(res.body).toContain("mymodule");
		});

		it("excludes the 'default' subdirectory from third-party results", async () => {
			fs.mkdirSync(path.join(rootDir, "modules/default"), { recursive: true });

			const res = await request(srv.app)
				.get("/user/modules/available")
				.set("Cookie", adminCookie);
			expect(res.status).toBe(200);
			expect(res.body).not.toContain("default");
		});
	});

	describe("PUT /user/config", () => {
		it("saves the global user config to DB and returns ok", async () => {
			const modules = [{ module: "clock", position: "top_left" }];
			const res = await request(srv.app)
				.put("/user/config")
				.set("Cookie", adminCookie)
				.send({ modules });

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ ok: true });

			const row = db.select().from(userConfigsTable)
				.where(and(eq(userConfigsTable.username, "admin"), eq(userConfigsTable.clientName, "")))
				.get();
			expect(JSON.parse(row!.modules)).toEqual(modules);
		});

		it("returns 400 when modules is not an array", async () => {
			const res = await request(srv.app)
				.put("/user/config")
				.set("Cookie", adminCookie)
				.send({ modules: "not-an-array" });
			expect(res.status).toBe(400);
		});
	});

	describe("PUT /user/config/:client", () => {
		it("saves a client-specific config to DB and returns ok", async () => {
			const modules = [{ module: "clock" }];
			const res = await request(srv.app)
				.put("/user/config/bathroom")
				.set("Cookie", adminCookie)
				.send({ modules });

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ ok: true });

			const row = db.select().from(userConfigsTable)
				.where(and(eq(userConfigsTable.username, "admin"), eq(userConfigsTable.clientName, "bathroom")))
				.get();
			expect(JSON.parse(row!.modules)).toEqual(modules);
		});

		it("returns 400 when modules is not an array", async () => {
			const res = await request(srv.app)
				.put("/user/config/bathroom")
				.set("Cookie", adminCookie)
				.send({ modules: 42 });
			expect(res.status).toBe(400);
		});
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// adminEndpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("Server.adminEndpoints", () => {
	let rootDir: string;
	let db: Db;
	let srv: Server;
	let adminCookie: string;
	let userCookie: string;

	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "dalamirror-admin-ep-"));

		db = initDb(":memory:");
		srv = makeServer(rootDir, db);
		srv.auth.createAccount("alice", "Alice", "user", "pass1");
		db.insert(clientsTable).values({ name: "bathroom", type: "mirror" }).run();
		db.insert(clientUsersTable).values({ clientName: "bathroom", username: "alice" }).run();
		srv.adminEndpoints();

		adminCookie = sessionCookie(srv.auth, "admin", "admin");
		userCookie = sessionCookie(srv.auth, "alice", "pass1");
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("returns 401 without a session cookie", async () => {
		const res = await request(srv.app).get("/admin/users");
		expect(res.status).toBe(401);
	});

	it("returns 403 for a non-admin user", async () => {
		const res = await request(srv.app).get("/admin/users").set("Cookie", userCookie);
		expect(res.status).toBe(403);
	});

	describe("GET /admin/users", () => {
		it("lists all accounts without sensitive fields", async () => {
			const res = await request(srv.app).get("/admin/users").set("Cookie", adminCookie);
			expect(res.status).toBe(200);
			expect(res.body).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ username: "admin", role: "admin" }),
					expect.objectContaining({ username: "alice", role: "user" }),
				]),
			);
			for (const account of res.body as object[]) {
				expect(account).not.toHaveProperty("passwordHash");
				expect(account).not.toHaveProperty("salt");
			}
		});
	});

	describe("POST /admin/users", () => {
		it("creates a new account and seeds an empty global user_config row", async () => {
			const res = await request(srv.app)
				.post("/admin/users")
				.set("Cookie", adminCookie)
				.send({ username: "bob", displayName: "Bob", role: "user", password: "bobpass" });

			expect(res.status).toBe(201);
			expect(srv.auth.login("bob", "bobpass")).not.toBeNull();

			const row = db.select().from(userConfigsTable)
				.where(and(eq(userConfigsTable.username, "bob"), eq(userConfigsTable.clientName, "")))
				.get();
			expect(row).not.toBeNull();
			expect(JSON.parse(row!.modules)).toEqual([]);
		});

		it("returns 400 when required fields are missing", async () => {
			const res = await request(srv.app)
				.post("/admin/users")
				.set("Cookie", adminCookie)
				.send({ username: "bob", displayName: "Bob" }); // missing role + password
			expect(res.status).toBe(400);
		});

		it("returns 409 on a duplicate username", async () => {
			const res = await request(srv.app)
				.post("/admin/users")
				.set("Cookie", adminCookie)
				.send({ username: "alice", displayName: "Alice 2", role: "user", password: "x" });
			expect(res.status).toBe(409);
		});
	});

	describe("PATCH /admin/users/:username", () => {
		it("updates the display name", async () => {
			const res = await request(srv.app)
				.patch("/admin/users/alice")
				.set("Cookie", adminCookie)
				.send({ displayName: "Alice Updated" });

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ ok: true });
			expect(srv.auth.listAccounts().find((a) => a.username === "alice")?.displayName).toBe(
				"Alice Updated",
			);
		});

		it("updates the password so the old one stops working", async () => {
			await request(srv.app)
				.patch("/admin/users/alice")
				.set("Cookie", adminCookie)
				.send({ password: "newpass" });

			expect(srv.auth.login("alice", "pass1")).toBeNull();
			expect(srv.auth.login("alice", "newpass")).not.toBeNull();
		});

		it("returns 404 for an unknown user", async () => {
			const res = await request(srv.app)
				.patch("/admin/users/nobody")
				.set("Cookie", adminCookie)
				.send({ displayName: "x" });
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /admin/users/:username", () => {
		it("removes the account and cascade-removes the user from client_users", async () => {
			const res = await request(srv.app)
				.delete("/admin/users/alice")
				.set("Cookie", adminCookie);

			expect(res.status).toBe(200);
			expect(srv.auth.listAccounts().find((a) => a.username === "alice")).toBeUndefined();

			const rows = db.select().from(clientUsersTable)
				.where(eq(clientUsersTable.username, "alice")).all();
			expect(rows).toHaveLength(0);
		});

		it("returns 404 for an unknown user", async () => {
			const res = await request(srv.app)
				.delete("/admin/users/nobody")
				.set("Cookie", adminCookie);
			expect(res.status).toBe(404);
		});
	});

	describe("GET /admin/clients", () => {
		it("returns all configured clients with their users lists", async () => {
			const res = await request(srv.app).get("/admin/clients").set("Cookie", adminCookie);
			expect(res.status).toBe(200);
			expect(res.body).toEqual([{ name: "bathroom", users: ["alice"] }]);
		});
	});

	describe("PUT /admin/clients/:client/users", () => {
		it("replaces the users list in client_users", async () => {
			const res = await request(srv.app)
				.put("/admin/clients/bathroom/users")
				.set("Cookie", adminCookie)
				.send({ users: ["admin", "alice"] });

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ ok: true });

			const rows = db.select({ username: clientUsersTable.username })
				.from(clientUsersTable)
				.where(eq(clientUsersTable.clientName, "bathroom"))
				.all();
			expect(rows.map((r) => r.username)).toEqual(expect.arrayContaining(["admin", "alice"]));
			expect(rows).toHaveLength(2);
		});

		it("returns 404 for a client not in clientConfigs", async () => {
			const res = await request(srv.app)
				.put("/admin/clients/unknown/users")
				.set("Cookie", adminCookie)
				.send({ users: [] });
			expect(res.status).toBe(404);
		});

		it("returns 400 when users is not an array", async () => {
			const res = await request(srv.app)
				.put("/admin/clients/bathroom/users")
				.set("Cookie", adminCookie)
				.send({ users: "bad" });
			expect(res.status).toBe(400);
		});
	});

	describe("GET /admin/clients/:client/config", () => {
		it("returns the client config when the client exists in DB", async () => {
			const modules = [{ module: "clock", position: "top_left" }];
			db.update(clientsTable).set({
				type: "mirror",
				userSwitchMode: "DELETE",
				defaultModules: JSON.stringify(modules),
			}).where(eq(clientsTable.name, "bathroom")).run();

			const res = await request(srv.app)
				.get("/admin/clients/bathroom/config")
				.set("Cookie", adminCookie);

			expect(res.status).toBe(200);
			expect(res.body).toEqual({
				name: "bathroom",
				type: "mirror",
				userSwitchMode: "DELETE",
				defaultModules: modules,
				layout: null,
			});
		});

		it("returns 404 when the client has no DB row", async () => {
			const res = await request(srv.app)
				.get("/admin/clients/nonexistent/config")
				.set("Cookie", adminCookie);
			expect(res.status).toBe(404);
		});

		it("returns 401 without a session cookie", async () => {
			const res = await request(srv.app).get("/admin/clients/bathroom/config");
			expect(res.status).toBe(401);
		});
	});

	describe("PUT /admin/clients/:client/config", () => {
		it("updates defaultModules and returns ok", async () => {
			const modules = [{ module: "clock" }];
			const res = await request(srv.app)
				.put("/admin/clients/bathroom/config")
				.set("Cookie", adminCookie)
				.send({ defaultModules: modules });

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ ok: true });

			const row = db.select({ defaultModules: clientsTable.defaultModules })
				.from(clientsTable).where(eq(clientsTable.name, "bathroom")).get();
			expect(JSON.parse(row!.defaultModules)).toEqual(modules);
		});

		it("updates type and userSwitchMode independently", async () => {
			await request(srv.app)
				.put("/admin/clients/bathroom/config")
				.set("Cookie", adminCookie)
				.send({ type: "dashboard", userSwitchMode: "DELETE" });

			const row = db.select({ type: clientsTable.type, userSwitchMode: clientsTable.userSwitchMode })
				.from(clientsTable).where(eq(clientsTable.name, "bathroom")).get();
			expect(row!.type).toBe("dashboard");
			expect(row!.userSwitchMode).toBe("DELETE");
		});

		it("returns 404 when the client has no DB row", async () => {
			const res = await request(srv.app)
				.put("/admin/clients/nonexistent/config")
				.set("Cookie", adminCookie)
				.send({ type: "mirror" });
			expect(res.status).toBe(404);
		});

		it("returns 400 for an invalid type value", async () => {
			const res = await request(srv.app)
				.put("/admin/clients/bathroom/config")
				.set("Cookie", adminCookie)
				.send({ type: "spaceship" });
			expect(res.status).toBe(400);
		});

		it("returns 400 for an invalid userSwitchMode value", async () => {
			const res = await request(srv.app)
				.put("/admin/clients/bathroom/config")
				.set("Cookie", adminCookie)
				.send({ userSwitchMode: "KEEP" });
			expect(res.status).toBe(400);
		});

		it("returns 400 when defaultModules is not an array", async () => {
			const res = await request(srv.app)
				.put("/admin/clients/bathroom/config")
				.set("Cookie", adminCookie)
				.send({ defaultModules: "not-an-array" });
			expect(res.status).toBe(400);
		});

		it("returns 400 when no valid fields are provided", async () => {
			const res = await request(srv.app)
				.put("/admin/clients/bathroom/config")
				.set("Cookie", adminCookie)
				.send({});
			expect(res.status).toBe(400);
		});

		it("returns 401 without a session cookie", async () => {
			const res = await request(srv.app)
				.put("/admin/clients/bathroom/config")
				.send({ type: "mirror" });
			expect(res.status).toBe(401);
		});
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// userServiceEndpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("Server.userServiceEndpoints", () => {
	let rootDir: string;
	let db: Db;
	let srv: Server;

	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "dalamirror-usersvc-"));
		db = initDb(":memory:");
		srv = makeServer(rootDir, db);
		srv.auth.createAccount("dala", "Dala", "user", "hunter2"); // needed for user_configs FK
		srv.userServiceEndpoints();
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("returns the client-specific user config when it exists", async () => {
		const modules = [{ module: "clock" }];
		db.insert(userConfigsTable).values({ username: "dala", clientName: "bathroom", modules: JSON.stringify(modules) }).run();

		const res = await request(srv.app)
			.post("/get-user/dala")
			.set("Content-Type", "text/plain")
			.send("bathroom");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ name: "dala", modules });
	});

	it("falls back to the global user config when no client-specific one exists", async () => {
		db.insert(userConfigsTable).values({ username: "dala", clientName: "", modules: "[]" }).run();

		const res = await request(srv.app)
			.post("/get-user/dala")
			.set("Content-Type", "text/plain")
			.send("bathroom");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ name: "dala", modules: [] });
	});

	it("prefers the client-specific config over the global one", async () => {
		const clientModules = [{ module: "clock" }];
		db.insert(userConfigsTable).values({ username: "dala", clientName: "bathroom", modules: JSON.stringify(clientModules) }).run();
		db.insert(userConfigsTable).values({ username: "dala", clientName: "", modules: "[]" }).run();

		const res = await request(srv.app)
			.post("/get-user/dala")
			.set("Content-Type", "text/plain")
			.send("bathroom");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ name: "dala", modules: clientModules });
	});

	it("returns 404 when neither config row exists", async () => {
		const res = await request(srv.app)
			.post("/get-user/dala")
			.set("Content-Type", "text/plain")
			.send("bathroom");

		expect(res.status).toBe(404);
	});
});
