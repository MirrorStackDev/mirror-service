import { ClientSocket } from "./clientSocket.js";
import { getClient, getDefaultModules } from "./clientState.js";
import { log } from "./logger.js";
import type { ModulePosition, ModuleInfo } from "../types/module.js";
import type { ClientPermission } from "../types/index.js";

export class Module {
	config: Record<string, unknown> = {};
	data: Record<string, unknown> = {};
	name: string = "";
	id: string = "";
	index: number = 0;
	hidden: boolean = false;
	position: ModulePosition = "middle_center";
	classes: string = "";
	socket?: ClientSocket;
	showHideTimer?: ReturnType<typeof setTimeout>;
	mInfo?: ModuleInfo;
	private permissions: Set<ClientPermission> = new Set();

	constructor() {
		// Calls defaults() which subclasses override to set this.defaults = { ... }.
		// The method intentionally shadows itself with a plain object on the instance.
		// JS module files (clock.js etc.) rely on this pattern and cannot be changed.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(this as any).defaults();
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	defaults(): void {
		(this as any).defaults = {};
	}

	getScripts(): string[] {
		return [];
	}

	getStyles(): string[] {
		return [];
	}

	async start(): Promise<void> {}

	getTemplate(): string {
		return "";
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getTemplateData(): Record<string, any> {
		return {};
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	nunjucksEnvironment(): any {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const self = this as any;
		if (!self._nunjucksEnvironment) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const nj = (window as any).nunjucks;
			if (!nj) throw new Error(`[${this.name}] nunjucks not loaded — add it to getScripts()`);
			self._nunjucksEnvironment = new nj.Environment(
				new nj.WebLoader(this.data["path"] as string, { async: true, useCache: true }),
				{ autoescape: true },
			);
		}
		return self._nunjucksEnvironment;
	}

	createDom(): HTMLElement | Promise<HTMLElement> {
		const template = this.getTemplate();
		if (template) {
			return new Promise((resolve) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				this.nunjucksEnvironment().render(template, this.getTemplateData(), (err: Error | null, result: string) => {
					const wrapper = document.createElement("div");
					if (err) {
						log.error(this.name, "Template render error:", err);
						wrapper.innerHTML = `<span class="dimmed">Template error: ${err.message}</span>`;
					} else {
						wrapper.innerHTML = result ?? "";
					}
					resolve(wrapper);
				});
			});
		}
		return document.createElement("div");
	}

	notificationReceived(notification: string, _payload: unknown, sender?: Module): void {
		if (sender) {
			log.debug(this.name, `notification from ${sender.name}: ${notification}`);
		} else {
			log.debug(this.name, `system notification: ${notification}`);
		}
	}

	socketNotificationReceived(notification: string, payload: unknown): void {
		log.debug(this.name, `socket notification: ${notification}`, payload);
	}

	suspend(): void {}

	resume(): void {}

	loadDependencies(): void {
		const dependenciesURL: string[] = [];
		const stylesURL: string[] = [];

		const urlPrefix = getDefaultModules().includes(this.name)
			? "/node_modules/"
			: `/modules/${this.name}/node_modules/`;

		for (const url of dependenciesURL) {
			// client.loadFile would be called here when implemented
			void urlPrefix;
			void url;
		}
		for (const url of stylesURL) {
			void url;
		}
	}

	createSocket(): void {
		if (!this.socket) {
			this.socket = new ClientSocket(this.name);
		}
		this.socket.setNotificationCallback((notification, payload) => {
			this.socketNotificationReceived(notification, payload);
		});
	}

	updateDom(updateOptions: unknown = {}): void {
		getClient().updateDom(this, updateOptions);
	}

	sendSocketNotification(notification: string, payload: unknown): void {
		log.debug(this.name, `sendSocketNotification: ${notification}`, payload);
		this.createSocket();
		this.socket?.sendNotification(notification, payload);
	}

	sendNotification(notification: string, payload: unknown): void {
		getClient().sendNotification(notification, payload, this);
	}

	hide(
		speed: number,
		callback?: (() => void) | object,
		options: Record<string, unknown> = {},
	): void {
		let usedCallback: () => void = () => {};
		let usedOptions = options;

		if (typeof callback === "function") {
			usedCallback = callback as () => void;
		} else if (typeof callback === "object") {
			log.error(this.name, "Parameter mismatch in module.hide: callback is not optional");
			usedOptions = callback as Record<string, unknown>;
		}

		getClient().hideModule(
			this,
			speed,
			() => {
				this.suspend();
				usedCallback();
			},
			usedOptions,
		);
	}

	show(
		speed: number,
		callback?: (() => void) | object,
		options: Record<string, unknown> = {},
	): void {
		let usedCallback: () => void = () => {};
		let usedOptions = options;

		if (typeof callback === "function") {
			usedCallback = callback as () => void;
		} else if (typeof callback === "object") {
			log.error(this.name, "Parameter mismatch in module.show: callback is not optional");
			usedOptions = callback as Record<string, unknown>;
		}

		getClient().showModule(
			this,
			speed,
			() => {
				this.resume();
				usedCallback();
			},
			usedOptions,
		);
	}

	file(filename: string): string {
		return (this.data["path"] as string) + filename;
	}

	setPermissions(perms: ClientPermission[]): void {
		this.permissions = new Set(perms);
	}

	hasPermission(perm: ClientPermission): boolean {
		return this.permissions.has(perm);
	}

	setConfig(config: Record<string, unknown>): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		this.config = configMerge({}, (this as any).defaults as Record<string, unknown>, config);
	}

	setData(moduleInfo: ModuleInfo): void {
		this.data = {};
		this.mInfo = moduleInfo;
		this.name = moduleInfo.name;
		this.id = moduleInfo.id;
		this.index = moduleInfo.index;
		this.hidden = moduleInfo.hiddenOnStartup ?? false;
		this.position = moduleInfo.position;
		this.classes = moduleInfo.classes;
		this.data["path"] = moduleInfo.folder;

		this.setConfig(moduleInfo.config ?? {});
	}
}

export function configMerge(
	result: Record<string, unknown>,
	...sources: Record<string, unknown>[]
): Record<string, unknown> {
	for (const item of sources) {
		for (const key in item) {
			if (Object.prototype.hasOwnProperty.call(item, key)) {
				const resultVal = result[key];
				const itemVal = item[key];
				if (
					typeof resultVal === "object" &&
					resultVal !== null &&
					!Array.isArray(resultVal) &&
					typeof itemVal === "object" &&
					itemVal !== null
				) {
					result[key] = configMerge(
						{},
						resultVal as Record<string, unknown>,
						itemVal as Record<string, unknown>,
					);
				} else {
					result[key] = itemVal;
				}
			}
		}
	}
	return result;
}
