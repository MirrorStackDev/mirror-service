/**
 * @jest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHarness } from "../../../../js/testUtils/moduleHarness.js";
import { Module } from "../../../../js/module.js";

jest.mock("../../../../js/clientState.js", () => ({
	getClient: jest.fn().mockReturnValue({
		updateDom: jest.fn(),
		hideModule: jest.fn(),
		showModule: jest.fn(),
		sendNotification: jest.fn(),
		reload: jest.fn(),
		defModules: [],
		moduleObjs: [],
	}),
}));

jest.mock("../../../../js/clientSocket.js", () => ({
	ClientSocket: jest.fn().mockImplementation(() => ({
		socket: { on: jest.fn(), emit: jest.fn() },
		setNotificationCallback: jest.fn(),
		sendNotification: jest.fn(),
	})),
}));

const h = createHarness(Module);

beforeAll(() => {
	h.setup();
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	require("../personalization");
});

function make(props: Record<string, unknown> = {}): any {
	return h.make("personalization", {
		scope: "global",
		configs: {},
		assignedClients: [],
		availableModules: null,
		dirty: false,
		listEl: null,
		saveBtn: null,
		currentUser: null,
		userToggled: false,
		changeUserBtn: null,
		...props,
	});
}

function makeWithList(modules: unknown[] = []): any {
	const listEl = document.createElement("div");
	const m = make({ listEl, scope: "global", configs: { global: { modules } } });
	return m;
}

describe("personalization", () => {
	describe("getStyles", () => {
		it("returns the personalization CSS path", () => {
			expect(make().getStyles()).toEqual(["/css/personalization.css"]);
		});
	});

	describe("currentModules", () => {
		it("returns the modules array for the current scope", () => {
			const mods = [{ module: "clock" }];
			const m = make({ configs: { global: { modules: mods } } });
			expect(m.currentModules()).toBe(mods);
		});

		it("returns an empty array when no config exists for the scope", () => {
			const m = make({ configs: {} });
			expect(m.currentModules()).toEqual([]);
		});
	});

	describe("toggleClientUser", () => {
		it("does nothing when scope is 'global'", () => {
			const m = make({ scope: "global" });
			m.setChangeUserLabel = jest.fn();
			m.toggleClientUser();
			expect(h.trackerSocket.sendNotification).not.toHaveBeenCalled();
			expect(m.setChangeUserLabel).not.toHaveBeenCalled();
		});

		it("sends CHANGE_USER_X with currentUser when toggling on", () => {
			const m = make({ scope: "bathroom", currentUser: "dala", userToggled: false });
			m.setChangeUserLabel = jest.fn();
			m.toggleClientUser();
			expect(h.trackerSocket.sendNotification).toHaveBeenCalledWith("CHANGE_USER_X", {
				client: "bathroom", user: "dala",
			});
			expect(m.userToggled).toBe(true);
		});

		it("sends CHANGE_USER_X with 'GLOBAL' when toggling off", () => {
			const m = make({ scope: "bathroom", currentUser: "dala", userToggled: true });
			m.setChangeUserLabel = jest.fn();
			m.toggleClientUser();
			expect(h.trackerSocket.sendNotification).toHaveBeenCalledWith("CHANGE_USER_X", {
				client: "bathroom", user: "GLOBAL",
			});
			expect(m.userToggled).toBe(false);
		});
	});

	describe("setChangeUserLabel", () => {
		it("sets 'Reset to Global' label when userToggled is true", () => {
			const btn = document.createElement("button");
			const m = make({ changeUserBtn: btn, userToggled: true, currentUser: "dala" });
			m.setChangeUserLabel();
			expect(btn.textContent).toBe("Reset to Global");
		});

		it("sets 'Assign me (user)' label when userToggled is false", () => {
			const btn = document.createElement("button");
			const m = make({ changeUserBtn: btn, userToggled: false, currentUser: "dala" });
			m.setChangeUserLabel();
			expect(btn.textContent).toBe("Assign me (dala)");
		});

		it("does nothing when changeUserBtn is null", () => {
			const m = make({ changeUserBtn: null });
			expect(() => m.setChangeUserLabel()).not.toThrow();
		});
	});

	describe("moveModule", () => {
		it("swaps a module with its neighbour in the direction given", () => {
			const mods = [{ module: "a" }, { module: "b" }, { module: "c" }];
			const m = make({ scope: "global", configs: { global: { modules: mods } } });
			m.markDirty = jest.fn();
			m.renderList = jest.fn();
			m.moveModule(0, 1);
			expect(m.configs.global.modules[0].module).toBe("b");
			expect(m.configs.global.modules[1].module).toBe("a");
		});

		it("does nothing when moving before the first element", () => {
			const mods = [{ module: "a" }, { module: "b" }];
			const m = make({ scope: "global", configs: { global: { modules: mods } } });
			m.markDirty = jest.fn();
			m.renderList = jest.fn();
			m.moveModule(0, -1);
			expect(m.configs.global.modules[0].module).toBe("a");
			expect(m.markDirty).not.toHaveBeenCalled();
		});

		it("does nothing when moving past the last element", () => {
			const mods = [{ module: "a" }, { module: "b" }];
			const m = make({ scope: "global", configs: { global: { modules: mods } } });
			m.markDirty = jest.fn();
			m.renderList = jest.fn();
			m.moveModule(1, 1);
			expect(m.configs.global.modules[1].module).toBe("b");
			expect(m.markDirty).not.toHaveBeenCalled();
		});
	});

	describe("markDirty", () => {
		it("sets dirty to true and enables the save button", () => {
			const saveBtn = document.createElement("button");
			saveBtn.disabled = true;
			const m = make({ saveBtn });
			m.markDirty();
			expect(m.dirty).toBe(true);
			expect(saveBtn.disabled).toBe(false);
		});

		it("does not throw when saveBtn is null", () => {
			const m = make({ saveBtn: null });
			expect(() => m.markDirty()).not.toThrow();
		});
	});

	describe("renderList", () => {
		it("renders an empty-state message when there are no modules", () => {
			const m = makeWithList([]);
			m.renderList();
			expect(m.listEl.querySelector(".pers-empty")).not.toBeNull();
		});

		it("renders one .pers-row per module", () => {
			const m = makeWithList([{ module: "clock" }, { module: "weather" }]);
			m.renderList();
			expect(m.listEl.querySelectorAll(".pers-row")).toHaveLength(2);
		});

		it("clears previous content before re-rendering", () => {
			const m = makeWithList([{ module: "clock" }]);
			m.listEl.innerHTML = "<div class='stale'></div>";
			m.renderList();
			expect(m.listEl.querySelector(".stale")).toBeNull();
		});
	});

	describe("renderRow", () => {
		it("shows the module name in .pers-name", () => {
			const m = make();
			const arr = [{ module: "clock", position: "top_left" }, {}, {}];
			const row = m.renderRow(arr[0], 0, 3, arr);
			expect(row.querySelector(".pers-name")?.textContent).toBe("clock");
		});

		it("disables the up arrow for the first item", () => {
			const m = make();
			const arr = [{ module: "clock" }, {}, {}];
			const row = m.renderRow(arr[0], 0, 3, arr);
			const upBtn = [...row.querySelectorAll(".pers-arrow")].find((b: any) => b.textContent === "↑") as HTMLButtonElement;
			expect(upBtn?.disabled).toBe(true);
		});

		it("disables the down arrow for the last item", () => {
			const m = make();
			const arr = [{}, {}, { module: "clock" }];
			const row = m.renderRow(arr[2], 2, 3, arr);
			const downBtn = [...row.querySelectorAll(".pers-arrow")].find((b: any) => b.textContent === "↓") as HTMLButtonElement;
			expect(downBtn?.disabled).toBe(true);
		});

		it("enables both arrows for a middle item", () => {
			const m = make();
			const arr = [{}, { module: "clock" }, {}];
			const row = m.renderRow(arr[1], 1, 3, arr);
			const [upBtn, downBtn] = [...row.querySelectorAll(".pers-arrow")] as HTMLButtonElement[];
			expect(upBtn?.disabled).toBe(false);
			expect(downBtn?.disabled).toBe(false);
		});

		it("delete button removes the module and marks dirty", () => {
			const mods = [{ module: "clock" }, { module: "weather" }];
			const m = make({ scope: "global", configs: { global: { modules: mods } } });
			m.markDirty = jest.fn();
			m.renderList = jest.fn();
			const row = m.renderRow(mods[0], 0, 2, mods);
			const delBtn = row.querySelector(".pers-del") as HTMLButtonElement;
			delBtn.click();
			expect(m.configs.global.modules).toHaveLength(1);
			expect(m.markDirty).toHaveBeenCalled();
		});
	});

	describe("renderConfigEditor", () => {
		it("creates a text input for string values", () => {
			const m = make({ manifests: { weather: [{ key: "city", type: "string" }] } });
			const editor = m.renderConfigEditor({ city: "Prague" }, "weather");
			const input = editor.querySelector("input[type='text']") as HTMLInputElement;
			expect(input?.value).toBe("Prague");
		});

		it("creates a number input for numeric values", () => {
			const m = make({ manifests: { weather: [{ key: "zoom", type: "number" }] } });
			const editor = m.renderConfigEditor({ zoom: 2 }, "weather");
			const input = editor.querySelector("input[type='number']") as HTMLInputElement;
			expect(input?.value).toBe("2");
		});

		it("creates a checkbox for boolean values", () => {
			const m = make({ manifests: { weather: [{ key: "show", type: "boolean" }] } });
			const editor = m.renderConfigEditor({ show: true }, "weather");
			const cb = editor.querySelector("input[type='checkbox']") as HTMLInputElement;
			expect(cb?.checked).toBe(true);
		});

		it("labels each field with its key", () => {
			const m = make({ manifests: { weather: [{ key: "timezone", type: "string" }] } });
			const editor = m.renderConfigEditor({ timezone: "UTC" }, "weather");
			expect(editor.querySelector("label")?.textContent).toBe("timezone");
		});

		it("returns null when no manifest schema is known for the module", () => {
			const m = make();
			expect(m.renderConfigEditor({ city: "Prague" }, "weather")).toBeNull();
		});
	});

	describe("fetchScope", () => {
		it("fetches and caches the global config", async () => {
			const data = { name: "dala", modules: [{ module: "clock" }] };
			h.fetchMock
				.mockResolvedValueOnce({ ok: true, json: async () => data } as Response)
				.mockResolvedValueOnce({ ok: true, json: async () => ({ config: [] }) } as Response);
			const m = make();
			await m.fetchScope("global");
			expect(m.configs["global"]).toBe(data);
		});

		it("stores currentUser from the fetched data", async () => {
			const data = { name: "dala", modules: [] };
			h.fetchMock.mockResolvedValueOnce({ ok: true, json: async () => data } as Response);
			const m = make();
			await m.fetchScope("global");
			expect(m.currentUser).toBe("dala");
		});

		it("skips the fetch when data is already cached", async () => {
			const m = make({ configs: { global: { modules: [] } } });
			await m.fetchScope("global");
			expect(h.fetchMock).not.toHaveBeenCalled();
		});

		it("falls back to empty modules on a failed fetch", async () => {
			h.fetchMock.mockResolvedValueOnce({ ok: false } as Response);
			const m = make();
			await m.fetchScope("global");
			expect(m.configs["global"]).toEqual({ modules: [] });
		});
	});

	describe("save", () => {
		it("PUTs to /user/config for the global scope", async () => {
			const saveBtn = document.createElement("button");
			const mods = [{ module: "clock" }];
			const m = make({ saveBtn, scope: "global", configs: { global: { modules: mods } } });
			h.fetchMock.mockResolvedValueOnce({ ok: true } as Response);
			await m.save();
			expect(h.fetchMock).toHaveBeenCalledWith(
				"/user/config",
				expect.objectContaining({ method: "PUT" }),
			);
		});

		it("PUTs to /user/config/{scope} for a client scope", async () => {
			const saveBtn = document.createElement("button");
			const m = make({ saveBtn, scope: "bathroom", configs: { bathroom: { modules: [] } } });
			h.fetchMock.mockResolvedValueOnce({ ok: true } as Response);
			await m.save();
			expect(h.fetchMock).toHaveBeenCalledWith(
				"/user/config/bathroom",
				expect.objectContaining({ method: "PUT" }),
			);
		});

		it("clears dirty and shows 'Saved!' on success", async () => {
			jest.useFakeTimers();
			const saveBtn = document.createElement("button");
			const m = make({ saveBtn, dirty: true, scope: "global", configs: { global: { modules: [] } } });
			h.fetchMock.mockResolvedValueOnce({ ok: true } as Response);
			await m.save();
			expect(m.dirty).toBe(false);
			expect(saveBtn.textContent).toBe("Saved!");
			jest.useRealTimers();
		});

		it("re-enables button and shows 'Save failed' on error", async () => {
			jest.useFakeTimers();
			const saveBtn = document.createElement("button");
			const m = make({ saveBtn, scope: "global", configs: { global: { modules: [] } } });
			h.fetchMock.mockResolvedValueOnce({ ok: false } as Response);
			await m.save();
			expect(saveBtn.disabled).toBe(false);
			expect(saveBtn.textContent).toBe("Save failed");
			jest.useRealTimers();
		});
	});

	describe("notificationReceived", () => {
		it("is a no-op that does not throw", () => {
			expect(() => make().notificationReceived("ANY", {})).not.toThrow();
		});
	});
});
