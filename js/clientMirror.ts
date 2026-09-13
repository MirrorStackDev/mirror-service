import { log } from "./logger.js";
import type { Client } from "./client.js";
import type { ClientConfig, ClientLayout, ActiveConfig } from "../types/module.js";
import type { PageCommandPayload } from "../types/socket.js";

/** Manages a paged layout — page selection, rotation timer, dot indicator, and nav arrows. */
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

	private infoOf(mod: import("./module.js").Module): import("../types/module.js").ModuleInfo | undefined {
		return this.client.modulesInfo.find((m) => m.id === mod.id);
	}

	private isVisible(mod: import("./module.js").Module): boolean {
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
			case "select":         if (cmd.page !== undefined) this.selectPage(cmd.page); break;
			case "next":           this.next(); break;
			case "prev":           this.prev(); break;
			case "home":           this.home(); break;
			case "showHidden":     if (cmd.name) this.showHiddenPage(cmd.name); break;
			case "leaveHidden":    this.leaveHiddenPage(); break;
			case "pauseRotation":  this.pauseRotation(); break;
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

/**
 * Mirror boot sequence — fetches the paged layout from the server and returns
 * the initial `ActiveConfig`. Falls back to flat `defaultModules` if no layout is set.
 */
export async function startMirrorClient(clientConfig: ClientConfig): Promise<ActiveConfig> {
	let layout: ClientLayout | undefined;
	try {
		const layoutRes = await fetch(`/${clientConfig.name}/layout`);
		if (layoutRes.ok) layout = (await layoutRes.json()) as ClientLayout;
	} catch {
		log.warn("Client", "Could not fetch layout, falling back to defaultModules");
	}
	return { name: clientConfig.name, modules: clientConfig.defaultModules, layout };
}

/** Creates and activates the PageManager after all modules are loaded into the DOM. */
export function initPageManager(layout: ClientLayout, client: Client): void {
	const pm = new PageManager(layout, client);
	(window as unknown as Record<string, unknown>)["_pageManager"] = pm;
	pm.apply(0);
	pm.startRotation();
}
