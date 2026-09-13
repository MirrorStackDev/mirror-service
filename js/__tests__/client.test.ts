/**
 * @jest-environment jsdom
 */
import { Client } from "../client.js";
import { Module } from "../module.js";

jest.mock("../clientState.js", () => ({
	getConfigInUse: jest.fn(),
	getDefaultModules: jest.fn().mockReturnValue(["clock", "alert"]),
	getClientConfig: jest.fn(),
	setClient: jest.fn(),
	setClientConfig: jest.fn(),
	setConfigInUse: jest.fn(),
	setFreshRegions: jest.fn(),
	setSession: jest.fn(),
	getSession: jest.fn().mockReturnValue(null),
	getFreshRegions: jest.fn().mockReturnValue(""),
	getClient: jest.fn(),
}));

jest.mock("../clientSocket.js", () => ({
	ClientSocket: jest.fn().mockImplementation(() => ({
		socket: { on: jest.fn(), emit: jest.fn() },
		setNotificationCallback: jest.fn(),
		sendNotification: jest.fn(),
	})),
}));

jest.mock("../UserService.js", () => ({
	UserService: jest.fn().mockImplementation(() => ({ changeUser: jest.fn() })),
}));

jest.mock("../utils.js", () => ({
	resetDOM: jest.fn(),
	fetchConfig: jest.fn(),
	fetchClientConfig: jest.fn(),
	fetchUserConfig: jest.fn(),
	formatTime: jest.fn(),
}));

function makeModule(id: string): Module {
	const m = new Module();
	m.id = id;
	return m;
}

describe("Client", () => {
	describe("resolveScriptUrl", () => {
		let client: Client;
		beforeEach(() => {
			client = new Client();
		});

		it("returns http/https URLs unchanged", () => {
			expect(client.resolveScriptUrl("https://cdn.example.com/lib.js", "/folder/")).toBe("https://cdn.example.com/lib.js");
		});

		it("returns absolute / paths unchanged", () => {
			expect(client.resolveScriptUrl("/vendor/lib.js", "/folder/")).toBe("/vendor/lib.js");
		});

		it("resolves paths with / as node_modules subpath", () => {
			expect(client.resolveScriptUrl("moment/moment.js", "/modules/clock/")).toBe("/modules/clock/node_modules/moment/moment.js");
		});

		it("resolves bare filename as packageName/filename in node_modules", () => {
			expect(client.resolveScriptUrl("moment.js", "/modules/clock/")).toBe("/modules/clock/node_modules/moment/moment.js");
		});
	});

	describe("findModuleByID", () => {
		it("returns undefined when no modules are loaded", () => {
			expect(new Client().findModuleByID("clock_0")).toBeUndefined();
		});

		it("returns the module with matching id", () => {
			const client = new Client();
			const m = makeModule("clock_0");
			client.moduleObjs.push(m);
			expect(client.findModuleByID("clock_0")).toBe(m);
		});

		it("returns undefined for a non-existent id", () => {
			const client = new Client();
			client.moduleObjs.push(makeModule("clock_0"));
			expect(client.findModuleByID("weather_1")).toBeUndefined();
		});
	});

	describe("sendNotification", () => {
		it("calls notificationReceived on all modules except the sender", () => {
			const client = new Client();
			const m1 = makeModule("a");
			const m2 = makeModule("b");
			const m3 = makeModule("c");
			m1.notificationReceived = jest.fn();
			m2.notificationReceived = jest.fn();
			m3.notificationReceived = jest.fn();
			client.moduleObjs.push(m1, m2, m3);

			client.sendNotification("TEST", { data: 1 }, m2);

			expect(m1.notificationReceived).toHaveBeenCalledWith("TEST", { data: 1 }, m2);
			expect(m2.notificationReceived).not.toHaveBeenCalled();
			expect(m3.notificationReceived).toHaveBeenCalledWith("TEST", { data: 1 }, m2);
		});

		it("targets a specific module when sendTo is provided", () => {
			const client = new Client();
			const m1 = makeModule("a");
			const m2 = makeModule("b");
			m1.notificationReceived = jest.fn();
			m2.notificationReceived = jest.fn();
			client.moduleObjs.push(m1, m2);

			client.sendNotification("TEST", {}, {} as Module, m1);

			expect(m1.notificationReceived).toHaveBeenCalled();
			expect(m2.notificationReceived).not.toHaveBeenCalled();
		});
	});

	describe("loadModulesInfo", () => {
		it("builds modulesInfo from configInUse modules", () => {
			const { getConfigInUse } = require("../clientState.js") as { getConfigInUse: jest.Mock };
			getConfigInUse.mockReturnValue({
				name: "bathroom",
				modules: [
					{ module: "clock", position: "top_left", hiddenOnStartup: false, header: "Time", config: {}, classes: "" },
					{ module: "weather", position: "top_right", hiddenOnStartup: true, header: "Weather", config: { units: "metric" }, classes: "w" },
				],
			});

			const client = new Client();
			client.loadModulesInfo();

			expect(client.modulesInfo).toHaveLength(2);
			expect(client.modulesInfo[0]).toMatchObject({ name: "clock", id: "clock_0", folder: "/modules/default/clock/" });
			expect(client.modulesInfo[1]).toMatchObject({ name: "weather", id: "weather_1", folder: "/modules/weather/", hidden: true });
		});

		it("routes built-in modules to /modules/default/", () => {
			const { getConfigInUse } = require("../clientState.js") as { getConfigInUse: jest.Mock };
			getConfigInUse.mockReturnValue({
				name: "bathroom",
				modules: [{ module: "alert", position: "top_bar", hiddenOnStartup: false, config: {}, classes: "" }],
			});

			const client = new Client();
			client.loadModulesInfo();

			expect(client.modulesInfo[0]?.folder).toBe("/modules/default/alert/");
		});

		it("routes non-default modules to /modules/", () => {
			const { getConfigInUse } = require("../clientState.js") as { getConfigInUse: jest.Mock };
			getConfigInUse.mockReturnValue({
				name: "bathroom",
				modules: [{ module: "myPlugin", position: "top_left", hiddenOnStartup: false, config: {}, classes: "" }],
			});

			const client = new Client();
			client.loadModulesInfo();

			expect(client.modulesInfo[0]?.folder).toBe("/modules/myPlugin/");
		});

		it("uses middle_center as default position when none given", () => {
			const { getConfigInUse } = require("../clientState.js") as { getConfigInUse: jest.Mock };
			getConfigInUse.mockReturnValue({
				name: "bathroom",
				modules: [{ module: "clock", hiddenOnStartup: false, config: {}, classes: "" }],
			});

			const client = new Client();
			client.loadModulesInfo();

			expect(client.modulesInfo[0]?.position).toBe("middle_center");
		});
	});

	describe("selectPosition (DOM)", () => {
		beforeEach(() => {
			document.body.innerHTML = `
				<div id="all-regions">
					<div class="top left"><div class="container"></div></div>
					<div class="top center"><div class="container"></div></div>
					<div class="bottom right"><div class="container"></div></div>
				</div>
			`;
		});

		it("returns the container element for a position present in the DOM", () => {
			const result = new Client().selectPosition("top_left");
			expect(result).not.toBeNull();
			expect(result?.className).toBe("container");
		});

		it("returns null for a position not present in the DOM", () => {
			expect(new Client().selectPosition("fullscreen_above")).toBeNull();
		});
	});

	describe("moduleNeedsUpdate (DOM)", () => {
		it("returns false when module wrapper does not exist", () => {
			document.body.innerHTML = "";
			const m = makeModule("nonexistent");
			expect(new Client().moduleNeedsUpdate(m, document.createElement("div"))).toBe(false);
		});

		it("returns true when new content differs from current wrapper content", () => {
			document.body.innerHTML = '<div id="clock_0"><span>old</span></div>';
			const m = makeModule("clock_0");
			const newContent = document.createElement("span");
			newContent.textContent = "new";
			expect(new Client().moduleNeedsUpdate(m, newContent)).toBe(true);
		});

		it("returns false when new content matches current wrapper content", () => {
			document.body.innerHTML = '<div id="clock_0"><span>same</span></div>';
			const m = makeModule("clock_0");
			const newContent = document.createElement("span");
			newContent.textContent = "same";
			expect(new Client().moduleNeedsUpdate(m, newContent)).toBe(false);
		});
	});

	describe("updateModuleContent (DOM)", () => {
		it("replaces wrapper content with the new element", () => {
			document.body.innerHTML = '<div id="clock_0"><span>old</span></div>';
			const m = makeModule("clock_0");
			const newContent = document.createElement("p");
			newContent.textContent = "new";
			new Client().updateModuleContent(m, newContent);
			expect(document.getElementById("clock_0")?.innerHTML).toBe("<p>new</p>");
		});

		it("clears wrapper when called without newContent", () => {
			document.body.innerHTML = '<div id="clock_0"><span>old</span></div>';
			new Client().updateModuleContent(makeModule("clock_0"));
			expect(document.getElementById("clock_0")?.innerHTML).toBe("");
		});

		it("does nothing when the wrapper element does not exist", () => {
			document.body.innerHTML = "";
			expect(() => new Client().updateModuleContent(makeModule("nonexistent"), document.createElement("div"))).not.toThrow();
		});
	});

	describe("hideModule / showModule (DOM)", () => {
		beforeEach(() => {
			jest.useFakeTimers();
			document.body.innerHTML = `
				<div id="all-regions">
					<div class="top left">
						<div class="container">
							<div id="clock_0" class="clock module"></div>
						</div>
					</div>
				</div>
			`;
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		it("hideModule sets opacity to 0 and adds the hidden class", () => {
			const m = makeModule("clock_0");
			new Client().hideModule(m, 300, jest.fn());
			const wrapper = document.getElementById("clock_0")!;
			expect(wrapper.style.opacity).toBe("0");
			expect(wrapper.classList.contains("hidden")).toBe(true);
		});

		it("hideModule calls callback after the timeout elapses", () => {
			const m = makeModule("clock_0");
			const cb = jest.fn();
			new Client().hideModule(m, 300, cb);
			expect(cb).not.toHaveBeenCalled();
			jest.runAllTimers();
			expect(cb).toHaveBeenCalledTimes(1);
		});

		it("hideModule calls callback immediately when wrapper does not exist", () => {
			const m = makeModule("nonexistent");
			const cb = jest.fn();
			new Client().hideModule(m, 300, cb);
			expect(cb).toHaveBeenCalledTimes(1);
		});

		it("showModule sets opacity to 1 and removes the hidden class", () => {
			const wrapper = document.getElementById("clock_0")!;
			wrapper.classList.add("hidden");
			wrapper.style.position = "fixed";
			const m = makeModule("clock_0");
			new Client().showModule(m, 300, jest.fn());
			expect(wrapper.style.opacity).toBe("1");
			expect(wrapper.classList.contains("hidden")).toBe(false);
		});

		it("showModule calls callback immediately when wrapper does not exist", () => {
			const m = makeModule("nonexistent");
			const cb = jest.fn();
			new Client().showModule(m, 300, cb);
			expect(cb).toHaveBeenCalledTimes(1);
		});
	});
});

