import type { LogLevel } from "../types/config.js";

type ConsoleFn = "log" | "info" | "warn" | "error" | "debug";

const LEVEL_CONSOLE: Record<LogLevel, ConsoleFn> = {
	DEBUG: "debug",
	LOG: "log",
	INFO: "info",
	WARN: "warn",
	ERROR: "error",
};

export interface TaggedLogger {
	debug(...args: unknown[]): void;
	log(...args: unknown[]): void;
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
	group(...args: unknown[]): void;
	groupCollapsed(...args: unknown[]): void;
	groupEnd(): void;
}

class Logger {
	private enabled: Set<LogLevel>;

	constructor(levels: LogLevel[] = ["DEBUG", "LOG", "INFO", "WARN", "ERROR"]) {
		this.enabled = new Set(levels);
	}

	configure(levels: LogLevel[]): void {
		this.enabled = new Set(levels);
	}

	private emit(level: LogLevel, tag: string, ...args: unknown[]): void {
		if (!this.enabled.has(level)) return;
		console[LEVEL_CONSOLE[level]](`[${tag}]`, ...args);
	}

	debug(tag: string, ...args: unknown[]): void { this.emit("DEBUG", tag, ...args); }
	log(tag: string, ...args: unknown[]): void   { this.emit("LOG",   tag, ...args); }
	info(tag: string, ...args: unknown[]): void  { this.emit("INFO",  tag, ...args); }
	warn(tag: string, ...args: unknown[]): void  { this.emit("WARN",  tag, ...args); }
	error(tag: string, ...args: unknown[]): void { this.emit("ERROR", tag, ...args); }

	withTag(tag: string): TaggedLogger {
		return {
			debug: (...args) => this.emit("DEBUG", tag, ...args),
			log:   (...args) => this.emit("LOG",   tag, ...args),
			info:  (...args) => this.emit("INFO",  tag, ...args),
			warn:  (...args) => this.emit("WARN",  tag, ...args),
			error: (...args) => this.emit("ERROR", tag, ...args),
			group: (...args) => console.group(`[${tag}]`, ...args),
			groupCollapsed: (...args) => console.groupCollapsed(`[${tag}]`, ...args),
			groupEnd: () => console.groupEnd(),
		};
	}
}

export const log = new Logger();
