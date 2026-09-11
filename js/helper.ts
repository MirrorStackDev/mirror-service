import express from "express";
import { log } from "./logger.js";
import type { RequestHandler } from "express";
import type { Socket, Namespace } from "socket.io";

class Helper {
	name!: string;
	path!: string;
	private expressApp!: express.Router;
	private socketio!: Namespace;

	constructor() {
		this.init();
	}

	init(): void {}

	loaded(): void {}

	start(): Promise<void> {
		return Promise.resolve();
	}

	stop(): void {
		log.debug("Helper", `Stopping: ${this.name}`);
	}

	socketNotificationReceived(notification: string, payload: unknown): void {
		log.debug(`Helper:${this.name}`, `socket notification: ${notification}`, payload);
	}

	sendSocketNotification(notification: string, payload: unknown): void {
		this.socketio.emit(notification, payload);
	}

	setName(name: string): void {
		this.name = name;
	}

	setPath(path: string): void {
		this.path = path;
	}

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
