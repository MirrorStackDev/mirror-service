import type { ClientConfig, ActiveConfig } from "../types/module.js";
import type { SessionInfo } from "../types/index.js";

export type { ActiveConfig };

// Minimal interface for what module.ts needs from Client, avoids circular import
export interface ClientRef {
	updateDom(module: unknown, options?: unknown): void;
	hideModule(module: unknown, speed: number, callback: () => void, options?: unknown): void;
	showModule(module: unknown, speed: number, callback: () => void, options?: unknown): void;
	sendNotification(notification: string, payload: unknown, sender: unknown): void;
	reload(): void;
	moduleObjs: unknown[];
}

let _client: ClientRef | null = null;
let _clientConfig: ClientConfig | null = null;
let _configInUse: ActiveConfig | null = null;
let _freshRegions = "";
let _defaultModules: string[] = [];

export function setClient(c: ClientRef): void {
	_client = c;
}
export function getClient(): ClientRef {
	if (!_client) throw new Error("Client not yet initialized");
	return _client;
}

export function setClientConfig(c: ClientConfig): void {
	_clientConfig = c;
}
export function getClientConfig(): ClientConfig {
	if (!_clientConfig) throw new Error("ClientConfig not initialized");
	return _clientConfig;
}

export function setConfigInUse(c: ActiveConfig): void {
	_configInUse = c;
}
export function getConfigInUse(): ActiveConfig {
	if (!_configInUse) throw new Error("ConfigInUse not initialized");
	return _configInUse;
}

export function setFreshRegions(r: string): void {
	_freshRegions = r;
}
export function getFreshRegions(): string {
	return _freshRegions;
}

export function setDefaultModules(modules: string[]): void {
	_defaultModules = modules;
}
export function getDefaultModules(): string[] {
	return _defaultModules;
}

let _session: SessionInfo | null = null;
export function setSession(s: SessionInfo | null): void {
	_session = s;
}
export function getSession(): SessionInfo | null {
	return _session;
}

