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
import type { ModuleDefinition, UserConfig } from "../types/module.js";
import type { ModuleManifest, HelperPermission } from "../types/index.js";

export type UserObj = { path: string; data: UserConfig };
export type ClientModuleMap = Record<
	string,
	{
		defaultModules: ModuleDefinition[];
		usersSpecific: UserObj[];
	}
>;

type LoadedHelper = { helper: Helper; manifest: ModuleManifest | null };

class Core {
	rootDir: string;
	config: ServerConfig;
	moduleHelpers: LoadedHelper[];
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
			console.warn("Warning: No custom server config found");
			this.config = merge({ rootDir: this.rootDir }, defaults);
		}

		this.moduleHelpers = [];
	}

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

	getUsersPerClient(client: string, users: string[]): UserObj[] {
		const db = getDb();
		return users.map((user) => {
			const clientRow = db.select({ modules: userConfigsTable.modules, layout: userConfigsTable.layout })
				.from(userConfigsTable)
				.where(and(eq(userConfigsTable.username, user), eq(userConfigsTable.clientName, client)))
				.get();
			if (clientRow) {
				return { path: "", data: { name: user, modules: this.extractModulesFromRow(clientRow.modules, clientRow.layout) } };
			}
			const globalRow = db.select({ modules: userConfigsTable.modules, layout: userConfigsTable.layout })
				.from(userConfigsTable)
				.where(and(eq(userConfigsTable.username, user), eq(userConfigsTable.clientName, "")))
				.get();
			return {
				path: "",
				data: { name: user, modules: globalRow ? this.extractModulesFromRow(globalRow.modules, globalRow.layout) : [] },
			};
		});
	}

	createModuleArray(): ClientModuleMap {
		console.log("Searching for modules");
		const db = getDb();
		const modulesInMirrors: ClientModuleMap = {};

		for (const client of this.config.clientConfigs) {
			const row = db.select({ defaultModules: clientsTable.defaultModules, layout: clientsTable.layout })
				.from(clientsTable)
				.where(eq(clientsTable.name, client))
				.get();

			if (!row) {
				console.error(`No DB record for client ${client}, skipping`);
				continue;
			}

			let defaultModules: ModuleDefinition[];
			try {
				defaultModules = this.extractModulesFromRow(row.defaultModules, row.layout);
			} catch {
				console.error(`Error parsing defaultModules for ${client}`);
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

	differentModules(): string[] {
		console.log("Finding all unique modules");
		const diffs: string[] = [];

		for (const client in this.allClients) {
			for (const mod of this.allClients[client]!.defaultModules) {
				if (!diffs.includes(mod.module)) diffs.push(mod.module);
			}
			for (const user of this.allClients[client]!.usersSpecific) {
				for (const userMod of user.data.modules) {
					if (!diffs.includes(userMod.module)) diffs.push(userMod.module);
				}
			}
		}

		return diffs;
	}

	loadAndValidateManifest(moduleFolder: string, moduleName: string): ModuleManifest | null {
		const manifestPath = `${moduleFolder}/module.json`;

		let raw: string;
		try {
			raw = fs.readFileSync(manifestPath, "utf8");
		} catch {
			console.warn(`[Security] ${moduleName}: module.json missing — helper will not load`);
			return null;
		}

		let manifest: ModuleManifest;
		try {
			manifest = JSON.parse(raw) as ModuleManifest;
		} catch {
			console.warn(
				`[Security] ${moduleName}: module.json is not valid JSON — helper will not load`,
			);
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
			console.warn(
				`[Security] ${moduleName}: unknown permissions [${unknown.join(", ")}] — rejecting manifest, helper will not load`,
			);
			return null;
		}

		console.log(
			`[Security] ${moduleName}: manifest valid, granted [${declared.join(", ") || "none"}]`,
		);
		return manifest;
	}

	loadModules(): void {
		console.log("Loading modules");
		this.allClients = this.createModuleArray();
		this.diffModules = this.differentModules();

		for (const moduleName of this.diffModules) {
			const moduleFolder = this.config.providedModules.includes(moduleName)
				? `${this.rootDir}/modules/default/${moduleName}`
				: `${this.rootDir}/modules/${moduleName}`;

			const moduleFile = `${moduleFolder}/${moduleName}.js`;

			let manifest: ModuleManifest | null = null;
			if (!this.config.providedModules.includes(moduleName)) {
				manifest = this.loadAndValidateManifest(moduleFolder, moduleName);
				if (!manifest) continue;
			}

			try {
				fs.accessSync(moduleFile, fs.constants.R_OK);
			} catch {
				console.log(`No ${moduleFile} found for module ${moduleName}.`);
			}

			const helperPath = `${moduleFolder}/helper.js`;
			let helperExists = true;
			try {
				fs.accessSync(helperPath, fs.constants.R_OK);
			} catch {
				helperExists = false;
				console.log(`No helper found for module ${moduleName}`);
			}

			if (helperExists) {
				console.log(`Starting helper for module: ${moduleName}`);
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const HelperClass = require(helperPath.slice(0, -3)) as typeof Helper;
				const helper = new HelperClass();

				helper.setName(moduleName);
				helper.setPath(moduleFolder);
				this.moduleHelpers.push({ helper, manifest });
				helper.loaded();
			}
		}
	}

	checkMirrorConfigs(): void {
		console.log("Checking if configs are correct");

		const clients = this.config.clientConfigs;
		for (const client of clients) {
			const folder = path.join(this.rootDir, "configs", client);
			if (!fs.existsSync(folder)) {
				console.error("No folder for defined client in config!");
				const index = this.config.clientConfigs.indexOf(client);
				this.config.clientConfigs.splice(index, 1);
				continue;
			}

			if (!fs.existsSync(path.join(folder, `${client}.js`))) {
				console.log(`Creating .js file for client: ${client}`);
				fs.copyFileSync(
					path.join(this.rootDir, "js/mirror.js"),
					path.join(folder, `${client}.js`),
				);
			}
		}

		const rootConfFolder = path.join(this.rootDir, "configs", this.config.rootConf);
		if (fs.existsSync(rootConfFolder)) {
			if (!fs.existsSync(path.join(rootConfFolder, `${this.config.rootConf}.js`))) {
				console.log(`Creating .js file for client: ${this.config.rootConf}`);
				fs.copyFileSync(
					path.join(this.rootDir, "js/mirror.js"),
					path.join(rootConfFolder, `${this.config.rootConf}.js`),
				);
			}
		}
	}

	async ensureHelperLoaded(moduleName: string): Promise<void> {
		if (this.moduleHelpers.some(({ helper }) => helper.name === moduleName)) return;

		const moduleFolder = this.config.providedModules.includes(moduleName)
			? `${this.rootDir}/modules/default/${moduleName}`
			: `${this.rootDir}/modules/${moduleName}`;

		let manifest: ModuleManifest | null = null;
		if (!this.config.providedModules.includes(moduleName)) {
			manifest = this.loadAndValidateManifest(moduleFolder, moduleName);
			if (!manifest) return;
		}

		const helperPath = `${moduleFolder}/helper.js`;
		try {
			fs.accessSync(helperPath, fs.constants.R_OK);
		} catch {
			return;
		}

		console.log(`Starting helper for module: ${moduleName} (on-demand)`);
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const HelperClass = require(helperPath.slice(0, -3)) as typeof Helper;
		const helper = new HelperClass();
		helper.setName(moduleName);
		helper.setPath(moduleFolder);
		this.moduleHelpers.push({ helper, manifest });
		helper.loaded();

		const hasPermission = (perm: HelperPermission): boolean =>
			manifest === null || manifest.helper.permissions.includes(perm);

		if (hasPermission("express.route")) {
			const router = Router();
			this.expressApp.use(`/${helper.name}`, router);
			helper.setExpressApp(router);
		}
		if (hasPermission("socket.namespace")) {
			const namespace = this.socketio.of(helper.name);
			helper.setSocketIO(namespace);
		}

		try {
			await helper.start();
		} catch (error) {
			console.error(`Error starting on-demand helper for ${moduleName}: ${error}`);
		}
	}

	async start(): Promise<void> {
		fs.mkdirSync(path.join(this.rootDir, "workData"), { recursive: true });
		initDb(path.join(this.rootDir, "workData/mirror.db"));
		this.checkMirrorConfigs();

		// open() seeds the clients table from JSON config files via loadTrackerFile,
		// so loadModules() (which reads defaultModules from DB) must run after.
		this.httpServer = new Server(this.rootDir, this.config);
		const apps = await this.httpServer.open();

		this.expressApp = apps.app;
		this.socketio = apps.io;

		this.httpServer.onModuleNeeded = (name: string) => this.ensureHelperLoaded(name);

		this.loadModules();

		const helperPromises: Promise<void>[] = [];
		for (const { helper, manifest } of this.moduleHelpers) {
			const hasPermission = (perm: HelperPermission): boolean =>
				manifest === null || manifest.helper.permissions.includes(perm);

			if (hasPermission("express.route")) {
				const router = Router();
				this.expressApp.use(`/${helper.name}`, router);
				helper.setExpressApp(router);
			}

			if (hasPermission("socket.namespace")) {
				const namespace = this.socketio.of(helper.name);
				helper.setSocketIO(namespace);
			}

			if (hasPermission("fs.read")) {
			}
			if (hasPermission("fs.write")) {
			}
			if (hasPermission("network.ws")) {
			}
			if (hasPermission("network.http")) {
			}

			try {
				helperPromises.push(helper.start());
			} catch (error) {
				console.error(`Error when starting helper for module ${helper.name}: ${error}`);
			}
		}

		const results = await Promise.allSettled(helperPromises);
		results.forEach((result) => {
			if (result.status === "rejected") console.log(result.reason);
		});
		console.log("All helpers started");
		console.log("Backend has been started");
	}
}

export default Core;
