import express from "express";
import { log } from "./logger.js";
import type { RequestHandler } from "express";
import type { Socket, Namespace } from "socket.io";

/**
 * Base class for module server-side helpers.
 *
 * A helper runs in the Node process and backs a single module.
 * Override the lifecycle hooks (`init`, `loaded`, `start`, `stop`) and
 * `socketNotificationReceived` to implement module behaviour.
 * Use `sendSocketNotification` and `registerRoute` to communicate outward.
 */
class Helper {
	name!: string;
	path!: string;
	private expressApp!: express.Router;
	private socketio!: Namespace;

	constructor() {
		this.init();
	}

	/** Called in the constructor — safe for synchronous field setup, no server access yet. */
	init(): void {}

	/** Called by Core after `name` and `path` are set but before `start()`. */
	loaded(): void {}

	/** Async setup hook — open DB connections, start timers, etc. Called once at startup. */
	start(): Promise<void> {
		return Promise.resolve();
	}

	/** Teardown hook — cancel timers, close connections. */
	stop(): void {
		log.debug("Helper", `Stopping: ${this.name}`);
	}

	/**
	 * Receives every socket event emitted by the module's client-side counterpart.
	 * Override this instead of wiring `socketio.on` directly.
	 */
	socketNotificationReceived(notification: string, payload: unknown): void {
		log.debug(`Helper:${this.name}`, `socket notification: ${notification}`, payload);
	}

	/** Broadcasts a notification to all clients connected to this module's namespace. */
	sendSocketNotification(notification: string, payload: unknown): void {
		this.socketio.emit(notification, payload);
	}

	setName(name: string): void {
		this.name = name;
	}

	setPath(path: string): void {
		this.path = path;
	}

	/**
	 * Registers an Express route under the module's own path prefix (`/<moduleName>`).
	 * Only available when the manifest grants `express.route`.
	 */
	registerRoute(
		method: "get" | "post" | "put" | "delete" | "use",
		path: string,
		handler: RequestHandler,
	): void {
		this.expressApp[method](path, handler);
	}

	setExpressApp(app: express.Router): void {
		this.expressApp = app;
		this.expressApp.use(express.static(`${this.path}/public`));
	}

	setSocketIO(socketio: Namespace): void {
		this.socketio = socketio;


		this.socketio.on("connection", (socket: Socket) => {
			// socket.onevent is an internal Socket.IO API used here to intercept
			// all events and re-emit them as "*" for catch-all handling in modules
			const s = socket as unknown as Record<string, unknown>;
			const onevent = s["onevent"] as (packet: { data?: unknown[] }) => void;
			s["onevent"] = function (packet: { data?: unknown[] }) {
				if (packet?.data) {
					const args = packet.data;
					onevent.call(this, packet);
					packet.data = (["*"] as unknown[]).concat(args);
					onevent.call(this, packet);
				}
			};

			(socket as unknown as { on(event: string, cb: (...args: unknown[]) => void): void }).on(
				"*",
				(...args: unknown[]) => {
					const [notification, payload = {}] = args as [string, unknown];
					if (notification !== "*") {
						this.socketNotificationReceived(notification, payload);
					}
				},
			);
		});
	}
}

export default Helper;
