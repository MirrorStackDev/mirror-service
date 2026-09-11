import { Module } from "./module.js";
import { ClientSocket } from "./clientSocket.js";
import { UserService } from "./UserService.js";
import { resetDOM, fetchConfig } from "./utils.js";
import {
	setClient,
	setClientConfig,
	getClientConfig,
	setConfigInUse,
	setFreshRegions,
	getConfigInUse,
	setSession,
	type ActiveConfig,
} from "./clientState.js";
import type { SessionInfo } from "../types/index.js";
import type { ClientLayout } from "../types/module.js";
import type { ClientConfig, ModuleInfo, ModulePosition } from "../types/module.js";
import type { ClientPermission, ModuleManifest } from "../types/index.js";
import type { PageCommandPayload } from "../types/socket.js";

export class PageManager {
	readonly layout: ClientLayout;
	currentPage: number;
	private isOnHiddenPage = false;
	private rotationTimer: ReturnType<typeof setInterval> | null = null;
	private client: Client;
	private indicator: HTMLElement | null = null;
	private prevArrow: HTMLElement | null = null;
	private nextArrow: HTMLElement | null = null;

	constructor(layout: ClientLayout, client: Client) {
		this.layout = layout;
		this.client = client;
		this.currentPage = Math.max(0, Math.min(layout.homePage ?? 0, layout.pages.length - 1));
		if (layout.pages.length > 1) {
			this.createIndicator();
			this.createNavArrows();
		}
	}

	private createIndicator(): void {
		const container = document.createElement("div");
		container.id = "page-indicator";
		for (let i = 0; i < this.layout.pages.length; i++) {
			const dot = document.createElement("span");
			dot.className = "page-dot" + (i === this.currentPage ? " active" : "");
			dot.addEventListener("click", () => this.selectPage(i));
			container.appendChild(dot);
		}
		document.body.appendChild(container);
		this.indicator = container;
	}

	private createNavArrows(): void {
		const prev = document.createElement("button");
		prev.id = "page-prev";
		prev.className = "page-nav-arrow";
		prev.textContent = "‹";
		prev.addEventListener("click", () => this.prev());
		document.body.appendChild(prev);
		this.prevArrow = prev;

		const next = document.createElement("button");
		next.id = "page-next";
		next.className = "page-nav-arrow";
		next.textContent = "›";
		next.addEventListener("click", () => this.next());
		document.body.appendChild(next);
		this.nextArrow = next;
	}

	private updateIndicator(): void {
		if (!this.indicator) return;
		this.indicator.querySelectorAll(".page-dot").forEach((dot, i) => {
			dot.classList.toggle("active", i === this.currentPage);
		});
		const hide = this.isOnHiddenPage;
		this.indicator.style.display = hide ? "none" : "";
		if (this.prevArrow) this.prevArrow.style.display = hide ? "none" : "";
		if (this.nextArrow) this.nextArrow.style.display = hide ? "none" : "";
	}

	destroy(): void {
		this.clearTimers();
		this.indicator?.remove();
		this.indicator = null;
		this.prevArrow?.remove();
		this.prevArrow = null;
		this.nextArrow?.remove();
		this.nextArrow = null;
	}

	private infoOf(mod: Module): import("../types/module.js").ModuleInfo | undefined {
		return this.client.modulesInfo.find((m) => m.id === mod.id);
	}

	private isVisible(mod: Module): boolean {
		const key = this.infoOf(mod)?.pageKey ?? "fixed";
		return key === "fixed" || key === this.currentPage;
	}

	apply(fadeMs = 300): void {
		for (const mod of this.client.moduleObjs) {
			if (this.infoOf(mod)?.hiddenOnStartup) continue;
			if (this.isVisible(mod)) {
				this.client.showModule(mod, fadeMs, () => {});
			} else {
				this.client.hideModule(mod, fadeMs, () => {});
			}
		}
		this.updateIndicator();
	}

	selectPage(index: number, fadeMs = 300): void {
		if (this.layout.pages.length === 0) return;
		this.currentPage = ((index % this.layout.pages.length) + this.layout.pages.length) % this.layout.pages.length;
		this.apply(fadeMs);
		this.resetRotation();
	}

	next(): void  { this.selectPage(this.currentPage + 1); }
	prev(): void  { this.selectPage(this.currentPage - 1); }
	home(): void  { this.selectPage(this.layout.homePage ?? 0); }

	showHiddenPage(name: string, fadeMs = 300): void {
		if (!this.layout.hiddenPages?.[name]) return;
		this.isOnHiddenPage = true;
		this.clearTimers();
		for (const mod of this.client.moduleObjs) {
			const info = this.infoOf(mod);
			if (info?.hiddenOnStartup) continue;
			const show = info?.pageKey === `hidden:${name}`;
			if (show) this.client.showModule(mod, fadeMs, () => {});
			else this.client.hideModule(mod, fadeMs, () => {});
		}
		this.updateIndicator();
	}

	leaveHiddenPage(fadeMs = 300): void {
		this.isOnHiddenPage = false;
		this.apply(fadeMs);
		this.resetRotation();
	}

	handleCommand(cmd: PageCommandPayload): void {
		switch (cmd.action) {
			case "select":        if (cmd.page !== undefined) this.selectPage(cmd.page); break;
			case "next":          this.next(); break;
			case "prev":          this.prev(); break;
			case "home":          this.home(); break;
			case "showHidden":    if (cmd.name) this.showHiddenPage(cmd.name); break;
			case "leaveHidden":   this.leaveHiddenPage(); break;
			case "pauseRotation": this.pauseRotation(); break;
			case "resumeRotation": this.startRotation(); break;
		}
	}

	startRotation(): void { this.resetRotation(); }
	pauseRotation(): void { this.clearTimers(); }

	private clearTimers(): void {
		if (this.rotationTimer !== null) { clearInterval(this.rotationTimer); this.rotationTimer = null; }
	}

	private resetRotation(): void {
		this.clearTimers();
		if (this.isOnHiddenPage) return;
		const ms = this.layout.pages[this.currentPage]?.rotationMs ?? this.layout.rotationMs ?? 0;
		if (ms > 0) this.rotationTimer = setInterval(() => this.next(), ms);
	}
}

export class Client {
	moduleObjs: Module[] = [];
	modulesInfo: ModuleInfo[] = [];
	loadedModules: string[] = [];
	loadedScripts: Set<string> = new Set();
	users: string[] = [];

	readonly defModules = [
		"clock",
		"dbbutton",
		"clientDisplay",
		"clientDetailes",
		"alert",
		"userManager",
		"personalization",
		"calendar",
		"weather",
	];

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
					console.error("Error loading style:", url);
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
				console.error("Error loading script:", url);
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
			const folder = this.defModules.includes(moduleName)
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
				console.warn(`[Security] ${moduleInfo.name}: module.json missing — module will not load`);
				return null;
			}
			manifest = (await res.json()) as ModuleManifest;
		} catch {
			console.warn(
				`[Security] ${moduleInfo.name}: failed to fetch module.json — module will not load`,
			);
			return null;
		}

		const declared = manifest.client?.permissions ?? [];
		const unknown = declared.filter((p) => !knownPermissions.has(p));
		if (unknown.length > 0) {
			console.warn(
				`[Security] ${moduleInfo.name}: unknown client permissions [${unknown.join(", ")}] — module will not load`,
			);
			return null;
		}

		console.log(
			`[Security] ${moduleInfo.name}: client permissions granted [${declared.join(", ") || "none"}]`,
		);
		return declared;
	}

	async loadModule(moduleInfo: ModuleInfo): Promise<void> {
		let permissions: ClientPermission[] = [];
		if (!this.defModules.includes(moduleInfo.name)) {
			const granted = await this.fetchManifest(moduleInfo);
			if (granted === null) return;
			permissions = granted;
		}

		const url = moduleInfo.folder + moduleInfo.file;
		await this.loadFile(url, "module");

		const ModuleClass = (window as unknown as Record<string, new () => Module>)[moduleInfo.name];
		if (!ModuleClass) {
			console.error(`Module class not found on window: ${moduleInfo.name}`);
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
		console.log(`Module loaded: ${module.name}`);
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
			.catch((err) => console.error(err));
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

export function setupTrackerSocket(tracker: ClientSocket): void {
	tracker.socket.on("connect", () => {
		setInterval(() => {
			tracker.socket.emit("heartbeat");
		}, 10000);
	});

	tracker.socket.on("HIDE_MODULE_Y", (payload: { id: string }) => {
		const client = (window as unknown as Record<string, Client>)["_client"];
		client?.findModuleByID(payload.id)?.hide(300);
	});

	tracker.socket.on("SHOW_MODULE_Y", (payload: { id: string }) => {
		const client = (window as unknown as Record<string, Client>)["_client"];
		client?.findModuleByID(payload.id)?.show(300);
	});

	tracker.socket.on("SUSPEND_MODULE_Y", (payload: { id: string }) => {
		const client = (window as unknown as Record<string, Client>)["_client"];
		client?.findModuleByID(payload.id)?.suspend();
	});

	tracker.socket.on("RESUME_MODULE_Y", (payload: { id: string }) => {
		const client = (window as unknown as Record<string, Client>)["_client"];
		client?.findModuleByID(payload.id)?.resume();
	});

	tracker.socket.on("CHANGE_USER_Y", (payload: { user: string }) => {
		const userService = (window as unknown as Record<string, UserService>)["_userService"];
		userService?.changeUser(payload.user);
	});

	tracker.socket.on("TOGGLE_CURSOR_Y", (payload: { visible: boolean }) => {
		document.documentElement.style.cursor = payload.visible ? "default" : "";
	});

	tracker.socket.on("PAGE_COMMAND", (cmd: PageCommandPayload) => {
		const pm = (window as unknown as Record<string, unknown>)["_pageManager"] as PageManager | undefined;
		pm?.handleCommand(cmd);
	});
}

export function createPanelNav(session: SessionInfo): void {
	const nav = document.createElement("nav");
	nav.id = "panel-nav";

	const title = document.createElement("span");
	title.id = "panel-nav-title";
	title.textContent = "HA-Mirrors";

	const right = document.createElement("div");
	right.id = "panel-nav-right";

	const userSpan = document.createElement("span");
	userSpan.id = "panel-nav-user";
	userSpan.textContent = session.displayName;

	const logoutBtn = document.createElement("button");
	logoutBtn.id = "panel-nav-logout";
	logoutBtn.textContent = "Log out";
	logoutBtn.addEventListener("click", async () => {
		await fetch("/auth/logout", { method: "POST" });
		window.location.href = "/login";
	});

	right.appendChild(userSpan);
	right.appendChild(logoutBtn);
	nav.appendChild(title);
	nav.appendChild(right);
	document.body.insertBefore(nav, document.body.firstChild);
}

export async function startClient(): Promise<void> {
	try {
		const clientConfig = (await fetchConfig()) as ClientConfig;
		setClientConfig(clientConfig);

		let layout: ClientLayout | undefined;
		let initialModules = clientConfig.defaultModules;

		if (clientConfig.type === "dashboard") {
			const sessionRes = await fetch("/auth/me");
			if (!sessionRes.ok) {
				window.location.href = "/login";
				return;
			}
			const session = (await sessionRes.json()) as SessionInfo;
			setSession(session);
			createPanelNav(session);

			if (session.role !== "admin") {
				initialModules = [{ module: "personalization", position: "middle_center" as const, config: {} }];
			}
			// admin: initialModules stays as clientConfig.defaultModules
		} else {
			// Mirrors only: fetch paged layout from server
			try {
				const layoutRes = await fetch(`/${clientConfig.name}/layout`);
				if (layoutRes.ok) layout = (await layoutRes.json()) as ClientLayout;
			} catch {
				console.warn("Could not fetch layout, falling back to defaultModules");
			}
		}

		const configInUse: ActiveConfig = { name: clientConfig.name, modules: initialModules, layout };
		setConfigInUse(configInUse);

		const freshRegions = document.getElementById("all-regions")?.innerHTML ?? "";
		setFreshRegions(freshRegions);

		const trackerSocket = new ClientSocket("/", {
			clientName: clientConfig.name,
			clientType: "mirror",
		});
		(window as unknown as Record<string, unknown>)["trackerSocket"] = trackerSocket;
		setupTrackerSocket(trackerSocket);

		const client = new Client();
		setClient(client);
		(window as unknown as Record<string, unknown>)["_client"] = client;

		const userService = new UserService();
		(window as unknown as Record<string, unknown>)["_userService"] = userService;

		await client.init();

		// Initialise page manager after all modules are loaded and in the DOM
		if (layout) {
			const pm = new PageManager(layout, client);
			(window as unknown as Record<string, unknown>)["_pageManager"] = pm;
			pm.apply(0); // instant on startup — no fade before first paint
			pm.startRotation();
		}
	} catch (error) {
		console.error("Error during client startup:", error);
	}
}
