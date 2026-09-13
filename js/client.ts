import { Module } from "./module.js";
import { log } from "./logger.js";
import { resetDOM } from "./utils.js";
import { getClientConfig, getConfigInUse, getDefaultModules } from "./clientState.js";
import { PageManager } from "./clientMirror.js";
import type { ModuleInfo, ModulePosition } from "../types/module.js";
import type { ClientPermission, ModuleManifest } from "../types/index.js";

/**
 * Core browser runtime — manages module loading, DOM rendering, and inter-module notifications.
 * Type-specific boot logic (auth, layout, nav) lives in `clientDashboard.ts` / `clientMirror.ts`.
 */
export class Client {
	moduleObjs: Module[] = [];
	modulesInfo: ModuleInfo[] = [];
	loadedModules: string[] = [];
	loadedScripts: Set<string> = new Set();
	users: string[] = [];

	readonly modulePositions: ModulePosition[] = [
		"top_bar",
		"top_left",
		"top_center",
		"top_right",
		"upper_third",
		"middle_center",
		"lower_third",
		"bottom_left",
		"bottom_center",
		"bottom_right",
		"bottom_bar",
		"fullscreen_above",
		"fullscreen_below",
	];

	selectPosition(position: ModulePosition): Element | null {
		const posClasses = position.replace("_", " ");
		const posDiv = document.getElementsByClassName(posClasses);
		if (posDiv.length > 0) {
			const wrapper = posDiv[0].getElementsByClassName("container");
			if (wrapper.length > 0) return wrapper[0];
		}
		return null;
	}

	updateWrapperStates(): void {
		for (const position of this.modulePositions) {
			const wrapper = this.selectPosition(position);
			if (!wrapper) continue;
			const moduleWrappers = wrapper.getElementsByClassName("module");
			let showWrapper = false;
			for (const mw of Array.from(moduleWrappers)) {
				const style = (mw as HTMLElement).style.position;
				if (style === "" || style === "static") {
					showWrapper = true;
					break;
				}
			}
			(wrapper as HTMLElement).style.display = showWrapper ? "block" : "none";
		}
	}

	hideModule(module: Module, speed: number, callback: () => void, _options: unknown = {}): void {
		const moduleWrapper = document.getElementById(module.id);
		if (moduleWrapper) {
			moduleWrapper.style.transition = `opacity ${speed / 1000}s`;
			moduleWrapper.style.opacity = "0";
			moduleWrapper.classList.add("hidden");
			module.showHideTimer = setTimeout(() => {
				moduleWrapper.style.position = "fixed";
				this.updateWrapperStates();
				callback();
			}, speed);
		} else {
			callback();
		}
	}

	showModule(module: Module, speed: number, callback: () => void, _options: unknown = {}): void {
		const moduleWrapper = document.getElementById(module.id);
		if (moduleWrapper) {
			moduleWrapper.style.transition = `opacity ${speed / 1000}s`;
			moduleWrapper.style.position = "static";
			moduleWrapper.classList.remove("hidden");
			this.updateWrapperStates();
			void moduleWrapper.parentElement?.parentElement?.offsetHeight; // force reflow
			moduleWrapper.style.opacity = "1";
			module.showHideTimer = setTimeout(callback, speed);
		} else {
			callback();
		}
	}

	async loadFile(url: string, type: "module" | "script" | "style"): Promise<void> {
		if (type === "style") {
			return new Promise((resolve) => {
				const link = document.createElement("link");
				link.rel = "stylesheet";
				link.type = "text/css";
				link.href = url;
				link.onload = () => resolve();
				link.onerror = () => {
					log.error("Client", "Error loading style:", url);
					resolve();
				};
				document.head.appendChild(link);
			});
		}

		if (type === "module" && this.loadedModules.includes(url)) return;
		if (type === "script" && this.loadedScripts.has(url)) return;

		return new Promise((resolve) => {
			const script = document.createElement("script");
			script.type = "text/javascript";
			script.src = url;
			script.onload = () => resolve();
			script.onerror = () => {
				log.error("Client", "Error loading script:", url);
				resolve();
			};
			document.body.appendChild(script);
			if (type === "module") this.loadedModules.push(url);
			if (type === "script") this.loadedScripts.add(url);
		});
	}

	loadModulesInfo(): void {
		const configInUse = getConfigInUse();
		const layout = configInUse.layout;

		// Collect (moduleConfig, pageKey) pairs from layout or fall back to flat module list
		const entries: { moduleConfig: import("../types/module.js").ModuleDefinition; pageKey: number | "fixed" | string }[] = [];

		if (layout) {
			for (const mod of layout.fixed) {
				entries.push({ moduleConfig: mod, pageKey: "fixed" });
			}
			layout.pages.forEach((page, pageIndex) => {
				for (const mod of page.modules) {
					entries.push({ moduleConfig: mod, pageKey: pageIndex });
				}
			});
			for (const [name, mods] of Object.entries(layout.hiddenPages ?? {})) {
				for (const mod of mods) {
					entries.push({ moduleConfig: mod, pageKey: `hidden:${name}` });
				}
			}
		} else {
			for (const mod of configInUse.modules) {
				entries.push({ moduleConfig: mod, pageKey: "fixed" });
			}
		}

		entries.forEach(({ moduleConfig, pageKey }, index) => {
			const moduleName = moduleConfig.module;
			const folder = getDefaultModules().includes(moduleName)
				? `/modules/default/${moduleName}/`
				: `/modules/${moduleName}/`;

			this.modulesInfo.push({
				index,
				id: `${moduleName}_${index}`,
				name: moduleName,
				folder,
				file: moduleName + ".js",
				position: moduleConfig.position ?? "middle_center",
				hiddenOnStartup: moduleConfig.hiddenOnStartup,
				hidden: moduleConfig.hiddenOnStartup,
				header: moduleConfig.header,
				config: moduleConfig.config ?? {},
				classes: moduleConfig.classes ? `${moduleConfig.classes} ${moduleName}` : moduleName,
				pageKey,
			});
		});
	}

	resolveScriptUrl(script: string, moduleFolder: string): string {
		if (script.startsWith("http") || script.startsWith("/")) return script;
		if (script.includes("/")) return moduleFolder + "node_modules/" + script;
		// bare filename like "moment.js" — resolve as a same-named package folder
		const packageName = script.replace(/\.js$/, "");
		return moduleFolder + "node_modules/" + packageName + "/" + script;
	}

	async fetchManifest(moduleInfo: ModuleInfo): Promise<ClientPermission[] | null> {
		const knownPermissions = new Set<ClientPermission>([
			"geo.location",
			"notifications.send",
			"camera",
			"microphone",
			"network.http",
			"network.ws",
			"user.name",
			"user.switch",
		]);

		let manifest: ModuleManifest;
		try {
			const res = await fetch(moduleInfo.folder + "module.json");
			if (!res.ok) {
				log.warn("Security", `${moduleInfo.name}: module.json missing — module will not load`);
				return null;
			}
			manifest = (await res.json()) as ModuleManifest;
		} catch {
			log.warn("Security", `${moduleInfo.name}: failed to fetch module.json — module will not load`);
			return null;
		}

		const declared = manifest.client?.permissions ?? [];
		const unknown = declared.filter((p) => !knownPermissions.has(p));
		if (unknown.length > 0) {
			log.warn("Security", `${moduleInfo.name}: unknown client permissions [${unknown.join(", ")}] — module will not load`);
			return null;
		}

		log.info("Security", `${moduleInfo.name}: client permissions granted [${declared.join(", ") || "none"}]`);
		return declared;
	}

	async loadModule(moduleInfo: ModuleInfo): Promise<void> {
		let permissions: ClientPermission[] = [];
		if (!getDefaultModules().includes(moduleInfo.name)) {
			const granted = await this.fetchManifest(moduleInfo);
			if (granted === null) return;
			permissions = granted;
		}

		const url = moduleInfo.folder + moduleInfo.file;
		await this.loadFile(url, "module");

		const ModuleClass = (window as unknown as Record<string, new () => Module>)[moduleInfo.name];
		if (!ModuleClass) {
			log.error("Client", `Module class not found on window: ${moduleInfo.name}`);
			return;
		}
		const module = new ModuleClass();
		module.setData(moduleInfo);
		module.setPermissions(permissions);

		for (const script of module.getScripts()) {
			await this.loadFile(this.resolveScriptUrl(script, moduleInfo.folder), "script");
		}

		for (const style of module.getStyles()) {
			const styleUrl =
				style.startsWith("http") || style.startsWith("/") ? style : moduleInfo.folder + style;
			await this.loadFile(styleUrl, "style");
		}
		this.moduleObjs.push(module);
		log.info("Client", `Module loaded: ${module.name}`);
	}

	async loadModules(): Promise<void> {
		this.loadModulesInfo();
		for (const moduleInfo of this.modulesInfo) {
			await this.loadModule(moduleInfo);
		}
	}

	async createDomObjects(): Promise<void> {
		for (const moduleObj of this.moduleObjs) {
			const newWrapper = await moduleObj.createDom();
			if (newWrapper) {
				const configClasses = Array.isArray(moduleObj.config?.["classes"])
					? (moduleObj.config["classes"] as string[]).join(" ")
					: "";
				newWrapper.className = [moduleObj.classes, configClasses, "module"]
					.filter(Boolean)
					.join(" ");
				newWrapper.id = moduleObj.id;
				this.selectPosition(moduleObj.position)?.appendChild(newWrapper);
			}
		}
	}

	moduleNeedsUpdate(module: Module, newContent: HTMLElement): boolean {
		const moduleWrapper = document.getElementById(module.id);
		if (!moduleWrapper) return false;
		const temp = document.createElement("div");
		temp.appendChild(newContent);
		return temp.innerHTML !== moduleWrapper.innerHTML;
	}

	updateModuleContent(module: Module, newContent?: HTMLElement): void {
		const moduleWrapper = document.getElementById(module.id);
		if (!moduleWrapper) return;
		moduleWrapper.innerHTML = "";
		if (newContent) moduleWrapper.appendChild(newContent);
	}

	updateDom(module: Module, _updateOptions: unknown = null): void {
		let contentPromise = module.createDom();
		if (!(contentPromise instanceof Promise)) {
			contentPromise = Promise.resolve(contentPromise);
		}
		contentPromise
			.then((newContent) => {
				if (!module.hidden && this.moduleNeedsUpdate(module, newContent)) {
					this.updateModuleContent(module, newContent);
				}
			})
			.catch((err) => log.error("Client", err));
	}

	sendNotification(notification: string, payload: unknown, sender: Module, sendTo?: Module): void {
		for (const module of this.moduleObjs) {
			if (module !== sender && (!sendTo || module === sendTo)) {
				module.notificationReceived(notification, payload, sender);
			}
		}
	}

	findModuleByID(moduleID: string): Module | undefined {
		return this.moduleObjs.find((m) => m.id === moduleID);
	}

	async startModules(): Promise<void> {
		for (const module of this.moduleObjs) {
			await module.start();
		}
		this.sendNotification("ALL_MODULES_STARTED", "", {} as Module);
	}

	async init(): Promise<void> {
		await this.loadModules();
		await this.createDomObjects();
		await this.startModules();
	}

	async reload(): Promise<void> {
		const win = window as unknown as Record<string, unknown>;
		(win["_pageManager"] as PageManager | undefined)?.destroy();
		delete win["_pageManager"];

		this.modulesInfo = [];
		for (const module of this.moduleObjs) module.suspend();
		this.moduleObjs = [];
		resetDOM();
		await this.init();

		const layout = getConfigInUse().layout;
		if (layout && getClientConfig().type !== "dashboard") {
			const pm = new PageManager(layout, this);
			win["_pageManager"] = pm;
			pm.apply(0);
			pm.startRotation();
		}
	}
}
