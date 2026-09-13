import { Module, configMerge } from "./module.js";
import { ClientSocket } from "./clientSocket.js";
import { formatTime, fetchClientConfig, fetchUserConfig, fetchConfig } from "./utils.js";
import { getSession, setClient, setClientConfig, setConfigInUse, setFreshRegions, setDefaultModules } from "./clientState.js";
import { Client } from "./client.js";
import { startMirrorClient, initPageManager } from "./clientMirror.js";
import { startDashboardClient } from "./clientDashboard.js";
import { UserService } from "./UserService.js";
import { log } from "./logger.js";
import type { ClientConfig } from "../types/module.js";
import type { PageCommandPayload } from "../types/socket.js";

// MM-compatible window.Log — ported modules call Log.info/warn/error without a tag
const Log = log.withTag("Module");

// Expose base classes and utilities on window for dynamically loaded module JS files
(window as unknown as Record<string, unknown>)["Log"] = Log;
(window as unknown as Record<string, unknown>)["Module"] = Module;
(window as unknown as Record<string, unknown>)["ClientSocket"] = ClientSocket;
(window as unknown as Record<string, unknown>)["configMerge"] = configMerge;
(window as unknown as Record<string, unknown>)["formatTime"] = formatTime;
(window as unknown as Record<string, unknown>)["fetchClientConfig"] = fetchClientConfig;
(window as unknown as Record<string, unknown>)["fetchUserConfig"] = fetchUserConfig;
(window as unknown as Record<string, unknown>)["getSession"] = getSession;

function setupTrackerSocket(tracker: ClientSocket): void {
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
		const win = window as unknown as Record<string, unknown>;
		(win["_pageManager"] as { handleCommand(c: PageCommandPayload): void } | undefined)?.handleCommand(cmd);
	});
}

async function startClient(): Promise<void> {
	try {
		const clientConfig = (await fetchConfig()) as ClientConfig;
		setClientConfig(clientConfig);

		const defaultModulesRes = await fetch("/config/default-modules");
		setDefaultModules(defaultModulesRes.ok ? (await defaultModulesRes.json()) as string[] : []);

		const configInUse = clientConfig.type === "dashboard"
			? await startDashboardClient(clientConfig)
			: await startMirrorClient(clientConfig);

		if (!configInUse) return; // dashboard redirected to login

		setConfigInUse(configInUse);

		const freshRegions = document.getElementById("all-regions")?.innerHTML ?? "";
		setFreshRegions(freshRegions);

		const trackerSocket = new ClientSocket("/", {
			clientName: clientConfig.name,
			clientType: clientConfig.type,
		});
		(window as unknown as Record<string, unknown>)["trackerSocket"] = trackerSocket;
		setupTrackerSocket(trackerSocket);

		const client = new Client();
		setClient(client);
		(window as unknown as Record<string, unknown>)["_client"] = client;

		const userService = new UserService();
		(window as unknown as Record<string, unknown>)["_userService"] = userService;

		await client.init();
		log.info("Client", `Started: ${clientConfig.name} (${client.moduleObjs.length} modules)`);

		if (configInUse.layout && clientConfig.type !== "dashboard") {
			initPageManager(configInUse.layout, client);
		}
	} catch (error) {
		log.error("Client", "Error during startup:", error);
	}
}

startClient();
