import fs from "node:fs";
import path from "node:path";
import { merge } from "lodash";
import { Router } from "express";
import type { Application } from "express";
import type { Server as SocketIOServer } from "socket.io";

import { eq, and } from "drizzle-orm";
import Server from "./server.js";
import Helper from "./helper.js";
import { initDb, getDb } from "./db/index.js";
import { clients as clientsTable, clientUsers as clientUsersTable, userConfigs as userConfigsTable } from "./db/schema.js";

import type { ServerConfig } from "../types/config.js";
import { log } from "./logger.js";
import type { ModuleDefinition, ActiveConfig } from "../types/module.js";
import type { ModuleManifest, HelperPermission } from "../types/index.js";

export type UserConfig = ActiveConfig;
export type ClientModuleMap = Record<
	string,
	{
		defaultModules: ModuleDefinition[];
		usersSpecific: UserConfig[];
	}
>;

type LoadedHelper = { helper: Helper; manifest: ModuleManifest | null };

// Modules that ship with the codebase and have no module.json — granted all permissions implicitly.
// Keep this list small and only add truly in-house modules here.
const coreModules = new Set([
	"alert", "clock", "dbbutton",
	"clientDisplay", "clientDetailes",
	"personalization", "personalUserSwitcher", "userManager", "profileSettings",
]);

/**
 * Application kernel — owns configuration, module lifecycle, and the HTTP/Socket server.
 *
 * Startup order: `new Core(rootDir)` → `start()`.
 * Everything else (DB, server, helpers) is initialised inside `start()`.
 */
class Core {
	rootDir: string;
	config: ServerConfig;
	moduleHelpers: LoadedHelper[];
	/** Names of modules that live under `modules/default/`. Populated during `start()`. */
	defaultModuleNames: string[] = [];
	allClients!: ClientModuleMap;
	diffModules!: string[];
	httpServer!: Server;
	expressApp!: Application;
	socketio!: SocketIOServer;

	constructor(rootDir: string) {
		this.rootDir = rootDir;

		const defaults = JSON.parse(
			fs.readFileSync(this.rootDir + "/configs/server/defaultServerConfig.json", "utf8"),
		) as ServerConfig;

		const rawConfig = fs.readFileSync(this.rootDir + "/configs/server/serverConfig.json", "utf8");

		if (rawConfig) {
			this.config = merge(
				{ rootDir: this.rootDir },
				defaults,
				JSON.parse(rawConfig) as Partial<ServerConfig>,
			);
		} else {
			this.config = merge({ rootDir: this.rootDir }, defaults);
			log.warn("Core", "No custom serverConfig.json found, using defaults.");
		}
		log.configure(this.config.logLevel);

		this.moduleHelpers = [];
	}

	/**
	 * Merges a flat module list with any modules embedded in a layout.
	 * Layout modules are appended only when not already present in the flat list,
	 * so an explicit flat entry always wins over the layout default.
	 */
	extractModulesFromRow(modulesJson: string, layoutJson: string | null | undefined): ModuleDefinition[] {
		const flat = JSON.parse(modulesJson) as ModuleDefinition[];
		if (!layoutJson) return flat;
		try {
			const layout = JSON.parse(layoutJson) as { pages?: { modules?: ModuleDefinition[] }[]; fixed?: ModuleDefinition[] };
			const fromLayout = [
				...(layout.fixed ?? []),
				...(layout.pages ?? []).flatMap((p) => p.modules ?? []),
			];
			const merged = [...flat];
			for (const m of fromLayout) {
				if (!merged.some((x) => x.module === m.module)) merged.push(m);
			}
			return merged;
		} catch {
			return flat;
		}
	}

	/**
	 * Resolves each user's module config for a specific mirror.
	 * Falls back from client-specific row → global row (clientName `""`) → empty module list.
	 */
	getUsersPerClient(client: string, users: string[]): UserConfig[] {
		const db = getDb();
		return users.map((user) => {
			const clientRow = db.select({ modules: userConfigsTable.modules, layout: userConfigsTable.layout })
				.from(userConfigsTable)
				.where(and(eq(userConfigsTable.username, user), eq(userConfigsTable.clientName, client)))
				.get();
			if (clientRow) {
				return { name: user, modules: this.extractModulesFromRow(clientRow.modules, clientRow.layout) };
			}
			const globalRow = db.select({ modules: userConfigsTable.modules, layout: userConfigsTable.layout })
				.from(userConfigsTable)
				.where(and(eq(userConfigsTable.username, user), eq(userConfigsTable.clientName, "")))
				.get();
			return { name: user, modules: globalRow ? this.extractModulesFromRow(globalRow.modules, globalRow.layout) : [] };
		});
	}
  
	/**
	 * Builds the full module map from the DB — keyed by client name.
	 * Each entry contains the unauthenticated default modules and every assigned user's config.
	 * Clients missing a DB record are skipped with an error log.
	 */
	createModuleArray(): ClientModuleMap {
		const db = getDb();
		const modulesInMirrors: ClientModuleMap = {};

		for (const client of this.config.clientConfigs) {
			const row = db.select({ defaultModules: clientsTable.defaultModules, layout: clientsTable.layout })
				.from(clientsTable)
				.where(eq(clientsTable.name, client))
				.get();

			if (!row) {
				log.error("Core", `No DB record for client ${client}, skipping`);
				continue;
			}

			let defaultModules: ModuleDefinition[];
			try {
				defaultModules = this.extractModulesFromRow(row.defaultModules, row.layout);
			} catch {
				log.error("Core", `Error parsing defaultModules for ${client}`);
				continue;
			}

			const userRows = db.select({ username: clientUsersTable.username })
				.from(clientUsersTable)
				.where(eq(clientUsersTable.clientName, client))
				.all();

			modulesInMirrors[client] = {
				defaultModules,
				usersSpecific: this.getUsersPerClient(client, userRows.map((r) => r.username)),
			};
		}

		return modulesInMirrors;
	}

	scanDefaultModules(): string[] {
		const defaultDir = path.join(this.rootDir, "modules", "default");
		try {
			return fs.readdirSync(defaultDir).filter((name) =>
				fs.statSync(path.join(defaultDir, name)).isDirectory(),
			);
		} catch {
			return [];
		}
	}

	/** Deduplicates all module names referenced across every client and user config. */
	differentModules(): string[] {
		const diffs: string[] = [];

		for (const client in this.allClients) {
			for (const mod of this.allClients[client]!.defaultModules) {
				if (!diffs.includes(mod.module)) diffs.push(mod.module);
			}
			for (const user of this.allClients[client]!.usersSpecific) {
				for (const userMod of user.modules) {
					if (!diffs.includes(userMod.module)) diffs.push(userMod.module);
				}
			}
		}

		return diffs;
	}

	/**
	 * Security gate for third-party helpers — reads and validates `module.json`.
	 * Returns `null` (blocking the helper from loading) if the manifest is missing,
	 * malformed, or declares any permission not in the known allowlist.
	 */
	loadAndValidateManifest(moduleFolder: string, moduleName: string): ModuleManifest | null {
		const manifestPath = `${moduleFolder}/module.json`;

		let raw: string;
		try {
			raw = fs.readFileSync(manifestPath, "utf8");
		} catch {
			log.warn("Security", `${moduleName}: module.json missing — helper will not load`);
			return null;
		}

		let manifest: ModuleManifest;
		try {
			manifest = JSON.parse(raw) as ModuleManifest;
		} catch {
			log.warn("Security", `${moduleName}: module.json is not valid JSON — helper will not load`);
			return null;
		}

		const knownPermissions = new Set<HelperPermission>([
			"express.route",
			"socket.namespace",
			"fs.read",
			"fs.write",
			"network.http",
			"network.ws",
		]);

		const declared = manifest.helper?.permissions ?? [];
		const unknown = declared.filter((p) => !knownPermissions.has(p));

		if (unknown.length > 0) {
			log.warn("Security", `${moduleName}: unknown permissions [${unknown.join(", ")}] — rejecting manifest`);
			return null;
		}

		log.info("Security", `${moduleName}: granted [${declared.join(", ") || "none"}]`);
		return manifest;
	}

	private moduleFolder(moduleName: string): string {
		return this.defaultModuleNames.includes(moduleName)
			? `${this.rootDir}/modules/default/${moduleName}`
			: `${this.rootDir}/modules/${moduleName}`;
	}

	private loadHelper(moduleName: string): LoadedHelper | null {
		const folder = this.moduleFolder(moduleName);

		let manifest: ModuleManifest | null = null;
		if (!coreModules.has(moduleName)) {
			manifest = this.loadAndValidateManifest(folder, moduleName);
			if (!manifest) return null;
		}

		const helperPath = `${folder}/helper.js`;
		try {
			fs.accessSync(helperPath, fs.constants.R_OK);
		} catch {
			return null;
		}

		log.info("Core", `Starting helper: ${moduleName}`);
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const HelperClass = require(helperPath.slice(0, -3)) as typeof Helper;
		const helper = new HelperClass();
		helper.setName(moduleName);
		helper.setPath(folder);
		const loaded: LoadedHelper = { helper, manifest };
		this.moduleHelpers.push(loaded);
		helper.loaded();
		return loaded;
	}

	private wireHelper({ helper, manifest }: LoadedHelper): void {
		const has = (perm: HelperPermission): boolean =>
			manifest === null || manifest.helper.permissions.includes(perm);

		if (has("express.route")) {
			const router = Router();
			this.expressApp.use(`/${helper.name}`, router);
			helper.setExpressApp(router);
		}
		if (has("socket.namespace")) {
			const namespace = this.socketio.of(helper.name);
			helper.setSocketIO(namespace);
		}
	}

	/**
	 * Loads helpers for all modules referenced in any client config at startup.
	 * Does NOT wire Express/Socket.IO yet — that happens in `start()` after the server is ready.
	 */
	loadModules(): void {
		this.allClients = this.createModuleArray();
		this.diffModules = this.differentModules();

		for (const moduleName of this.diffModules) {
			try {
				fs.accessSync(`${this.moduleFolder(moduleName)}/${moduleName}.js`, fs.constants.R_OK);
			} catch {
				log.debug("Core", `No module file found for ${moduleName}`);
			}
			this.loadHelper(moduleName);
		}
	}

	/**
	 * Ensures every client listed in config has a `configs/<name>/` folder and an entry JS file.
	 * Clients without a folder are removed from `config.clientConfigs` so the rest of startup
	 * doesn't have to handle missing directories.
	 */
	bootstrapClientConfigs(): void {

		const clients = this.config.clientConfigs;
		for (const client of clients) {
			const folder = path.join(this.rootDir, "configs", client);
			if (!fs.existsSync(folder)) {
				log.error("Core", `No folder found for client '${client}'. Removing from config`);
				const index = this.config.clientConfigs.indexOf(client);
				this.config.clientConfigs.splice(index, 1);
				continue;
			}

			if (!fs.existsSync(path.join(folder, `${client}.js`))) {
				log.info("Core", `Creating entry JS for client: ${client}`);
				fs.copyFileSync(
					path.join(this.rootDir, "js/mirror.js"),
					path.join(folder, `${client}.js`),
				);
			}
		}

		const rootConfFolder = path.join(this.rootDir, "configs", this.config.rootConf);
		if (fs.existsSync(rootConfFolder)) {
			if (!fs.existsSync(path.join(rootConfFolder, `${this.config.rootConf}.js`))) {
				log.info("Core", `Creating entry JS for root: ${this.config.rootConf}`);
				fs.copyFileSync(
					path.join(this.rootDir, "js/mirror.js"),
					path.join(rootConfFolder, `${this.config.rootConf}.js`),
				);
			}
		}
	}

	/**
	 * Loads, wires, and starts a helper on demand — called when a mirror requests a module
	 * that wasn't active at startup. No-op if the helper is already running.
	 */
	async ensureHelperLoaded(moduleName: string): Promise<void> {
		if (this.moduleHelpers.some(({ helper }) => helper.name === moduleName)) return;

		const loaded = this.loadHelper(moduleName);
		if (!loaded) return;

		this.wireHelper(loaded);
		try {
			await loaded.helper.start();
		} catch (error) {
			log.error("Core", `Error starting helper ${moduleName}:`, error);
		}
	}

	async start(): Promise<void> {
		fs.mkdirSync(path.join(this.rootDir, "workData"), { recursive: true });
		initDb(path.join(this.rootDir, "workData/mirror.db"));
		this.bootstrapClientConfigs();

		this.httpServer = new Server(this.rootDir, this.config);
		const apps = await this.httpServer.open();

		this.expressApp = apps.app;
		this.socketio = apps.io;

		this.defaultModuleNames = this.scanDefaultModules();
		this.httpServer.defaultModuleNames = this.defaultModuleNames;
		this.httpServer.onModuleNeeded = (name: string) => this.ensureHelperLoaded(name);

		this.loadModules();

		const helperPromises: Promise<void>[] = [];
		for (const loaded of this.moduleHelpers) {
			this.wireHelper(loaded);
			try {
				helperPromises.push(loaded.helper.start());
			} catch (error) {
				log.error("Core", `Error starting helper ${loaded.helper.name}:`, error);
			}
		}

		const results = await Promise.allSettled(helperPromises);
		results.forEach((result) => {
			if (result.status === "rejected") log.error("Core", result.reason);
		});
		log.info("Core", `Ready — ${this.moduleHelpers.length} helper(s) on port ${this.config.port}`);
	}
}

export default Core;
