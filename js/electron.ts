import { app as eleApp, BrowserWindow, screen } from "electron";
import fs from "node:fs";

import type { ElectronConfig } from "../types/config.js";
import { log } from "./logger.js";

// Config
let config: ElectronConfig;

if (process.env["config"]) {
	config = JSON.parse(process.env["config"]) as ElectronConfig;
} else {
	if (!fs.existsSync("configs/electron/eleDefaults.json")) {
		log.error("Electron", "No default config found!");
		process.exit(1);
	}
	const defaults = JSON.parse(
		fs.readFileSync("configs/electron/eleDefaults.json", "utf8"),
	) as ElectronConfig;
	let overrides: Partial<ElectronConfig> = {};
	if (fs.existsSync("configs/electron/eleConfig.json")) {
		overrides = JSON.parse(
			fs.readFileSync("configs/electron/eleConfig.json", "utf8"),
		) as Partial<ElectronConfig>;
	}
	config = Object.assign({}, defaults, overrides);
}

if (process.env["ELECTRON_ENABLE_GPU"] !== "1" || !config.gpu) {
	eleApp.disableHardwareAcceleration();
}

let mainWindow: BrowserWindow | null;

function createWindow(): void {
	let electronSize = { width: 800, height: 600 };
	try {
		electronSize = screen.getPrimaryDisplay().workAreaSize;
	} catch {
		log.warn("Electron", "Could not get display size, using defaults.");
	}

	const switchesDefaults = ["autoplay-policy", "no-user-gesture-required"];
	const allSwitches = new Set([...switchesDefaults, ...(config.electronSwitches ?? [])]);
	for (const sw of allSwitches) {
		eleApp.commandLine.appendSwitch(sw);
	}

	const electronOptionsDefaults: Electron.BrowserWindowConstructorOptions = {
		width: electronSize.width,
		height: electronSize.height,
		x: 0,
		y: 0,
		darkTheme: true,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			zoomFactor: config.zoom,
		},
		backgroundColor: "#000000",
	};

	const electronOptions = Object.assign(
		{},
		electronOptionsDefaults,
		config.electronOptions ?? {},
	) as Electron.BrowserWindowConstructorOptions;

	mainWindow = new BrowserWindow(electronOptions);

	const prefix = config.https ? "https://" : "http://";
	const isUnroutable =
		config.address === "undefined" || config.address === "" || config.address === "0.0.0.0";
	const address = isUnroutable ? "localhost" : config.address;

	mainWindow.loadURL(`${prefix}${address}:${config.port}/${config.clientName}`);

	mainWindow.webContents.on("dom-ready", () => {
		mainWindow?.webContents.sendInputEvent({ type: "mouseMove", x: 0, y: 0 });
	});

	mainWindow.on("closed", () => {
		mainWindow = null;
	});

	mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
		let curHeaders = details.responseHeaders ?? {};

		if (config.ignoreXOriginHeader) {
			curHeaders = Object.fromEntries(
				Object.entries(curHeaders).filter(([key]) => !/x-frame-options/i.test(key)),
			);
		}

		if (config.ignoreContentSecurityPolicy) {
			curHeaders = Object.fromEntries(
				Object.entries(curHeaders).filter(([key]) => !/content-security-policy/i.test(key)),
			);
		}

		callback({ responseHeaders: curHeaders });
	});

	mainWindow.once("ready-to-show", () => {
		mainWindow?.show();
	});
}

eleApp.on("window-all-closed", () => {
	if (process.env["JEST_WORKER_ID"] !== undefined) {
		eleApp.quit();
	} else {
		createWindow();
	}
});

eleApp.on("activate", () => {
	if (mainWindow === null) createWindow();
});

eleApp.on("before-quit", async (event) => {
	log.info("Electron", "Shutting down server.");
	event.preventDefault();
	process.exit(0);
});

eleApp.on("certificate-error", (event, _webContents, _url, _error, _certificate, callback) => {
	event.preventDefault();
	callback(true);
});

eleApp.whenReady().then(() => {
	log.info("Electron", "Launching client viewer.");
	createWindow();
});
