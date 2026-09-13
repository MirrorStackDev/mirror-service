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

const CURRENT_USER = { username: "admin", displayName: "Admin", role: "admin" };
const REGULAR_USER = { username: "dala", displayName: "Dala", role: "user" };
const ADMIN_USER = { username: "boss", displayName: "Boss", role: "admin" };

beforeAll(() => {
	h.setup();
	h.getSession.mockReturnValue(CURRENT_USER);
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	require("../userManager");
});

function make(props: Record<string, unknown> = {}): any {
	return h.make("userManager", props);
}

describe("userManager", () => {
	describe("getStyles", () => {
		it("returns the userManager CSS path", () => {
			expect(make().getStyles()).toEqual(["/css/userManager.css"]);
		});
	});

	describe("fetchUsers", () => {
		it("calls GET /admin/users and returns the result", async () => {
			const users = [REGULAR_USER, CURRENT_USER];
			h.fetchMock.mockResolvedValueOnce({ ok: true, json: async () => users } as Response);
			const result = await make().fetchUsers();
			expect(h.fetchMock).toHaveBeenCalledWith("/admin/users");
			expect(result).toEqual(users);
		});

		it("returns an empty array when the fetch fails", async () => {
			h.fetchMock.mockResolvedValueOnce({ ok: false } as Response);
			expect(await make().fetchUsers()).toEqual([]);
		});
	});

	describe("renderRow", () => {
		it("shows username, displayName, and role badge", () => {
			const row = make().renderRow(REGULAR_USER, CURRENT_USER, 2);
			expect(row.querySelector(".um-username")?.textContent).toBe("dala");
			expect(row.querySelector(".um-displayname")?.textContent).toBe("Dala");
			expect(row.querySelector(".um-role")?.textContent).toBe("user");
		});

		it("includes a Delete button for a non-self, non-last-admin user", () => {
			const row = make().renderRow(REGULAR_USER, CURRENT_USER, 2);
			expect(row.querySelector(".um-del-btn")).not.toBeNull();
		});

		it("omits the Delete button when editing self", () => {
			const row = make().renderRow(CURRENT_USER, CURRENT_USER, 2);
			expect(row.querySelector(".um-del-btn")).toBeNull();
		});

		it("omits the Delete button for the last admin", () => {
			// adminCount = 1, user is the only admin
			const row = make().renderRow(ADMIN_USER, CURRENT_USER, 1);
			expect(row.querySelector(".um-del-btn")).toBeNull();
		});

		it("includes an Edit button", () => {
			const row = make().renderRow(REGULAR_USER, CURRENT_USER, 2);
			expect(row.querySelector(".popup-btn")?.textContent).toBe("Edit");
		});
	});

	describe("fieldEl", () => {
		it("creates a labeled input with the given type and value", () => {
			const wrap = make().fieldEl("username", "Username", "text", "dala");
			expect(wrap.querySelector("label")?.textContent).toBe("Username");
			const input = wrap.querySelector("input") as HTMLInputElement;
			expect(input?.type).toBe("text");
			expect(input?.value).toBe("dala");
		});

		it("marks the input as required when required=true", () => {
			const wrap = make().fieldEl("username", "Username", "text", "", true);
			expect((wrap.querySelector("input") as HTMLInputElement)?.required).toBe(true);
		});

		it("sets a placeholder when provided", () => {
			const wrap = make().fieldEl("pw", "Password", "password", "", false, "Leave blank to keep");
			expect((wrap.querySelector("input") as HTMLInputElement)?.placeholder).toBe("Leave blank to keep");
		});

		it("links the label to the input via id", () => {
			const wrap = make().fieldEl("displayName", "Display name", "text", "");
			expect(wrap.querySelector("label")?.htmlFor).toBe("um-displayName");
			expect(wrap.querySelector("input")?.id).toBe("um-displayName");
		});
	});

	describe("mirrorsFieldEl", () => {
		it("creates a checkbox per client", () => {
			const clients = [
				{ name: "bathroom", users: ["dala"] },
				{ name: "kitchen", users: [] },
			];
			const wrap = make().mirrorsFieldEl(clients, null);
			const checkboxes = wrap.querySelectorAll("input[type='checkbox']");
			expect(checkboxes).toHaveLength(2);
		});

		it("pre-checks the checkbox when user is already in the client's user list", () => {
			const clients = [{ name: "bathroom", users: ["dala"] }];
			const wrap = make().mirrorsFieldEl(clients, "dala");
			const cb = wrap.querySelector("input[type='checkbox']") as HTMLInputElement;
			expect(cb?.checked).toBe(true);
		});

		it("leaves the checkbox unchecked when user is not in the client's user list", () => {
			const clients = [{ name: "bathroom", users: ["alice"] }];
			const wrap = make().mirrorsFieldEl(clients, "dala");
			const cb = wrap.querySelector("input[type='checkbox']") as HTMLInputElement;
			expect(cb?.checked).toBe(false);
		});

		it("uses client-{name} as the checkbox name", () => {
			const clients = [{ name: "bathroom", users: [] }];
			const wrap = make().mirrorsFieldEl(clients, null);
			const cb = wrap.querySelector("input[type='checkbox']") as HTMLInputElement;
			expect(cb?.name).toBe("client-bathroom");
		});
	});

	describe("roleSelectEl", () => {
		it("pre-selects the current role", () => {
			const wrap = make().roleSelectEl("user", REGULAR_USER, CURRENT_USER);
			const select = wrap.querySelector("select") as HTMLSelectElement;
			expect(select?.value).toBe("user");
		});

		it("contains both 'admin' and 'user' options", () => {
			const wrap = make().roleSelectEl("admin", CURRENT_USER, null);
			const options = [...wrap.querySelectorAll("option")].map((o: any) => o.value);
			expect(options).toEqual(["admin", "user"]);
		});

		it("disables the select when editing self", () => {
			const wrap = make().roleSelectEl("admin", CURRENT_USER, CURRENT_USER);
			expect((wrap.querySelector("select") as HTMLSelectElement)?.disabled).toBe(true);
		});

		it("enables the select when editing another user", () => {
			const wrap = make().roleSelectEl("user", REGULAR_USER, CURRENT_USER);
			expect((wrap.querySelector("select") as HTMLSelectElement)?.disabled).toBe(false);
		});
	});

	describe("deleteUser", () => {
		beforeEach(() => {
			document.body.innerHTML = '<div id="all-regions"></div>';
			(global as any).confirm = jest.fn().mockReturnValue(true);
			(global as any).alert = jest.fn();
		});

		it("calls DELETE /admin/users/{username} when confirmed", async () => {
			const m = make();
			m.updateDom = jest.fn();
			h.fetchMock.mockResolvedValueOnce({ ok: true } as Response);
			await m.deleteUser("dala");
			expect(h.fetchMock).toHaveBeenCalledWith("/admin/users/dala", { method: "DELETE" });
		});

		it("calls updateDom on successful deletion", async () => {
			const m = make();
			m.updateDom = jest.fn();
			h.fetchMock.mockResolvedValueOnce({ ok: true } as Response);
			await m.deleteUser("dala");
			expect(m.updateDom).toHaveBeenCalled();
		});

		it("does nothing when user cancels the confirmation", async () => {
			(global as any).confirm = jest.fn().mockReturnValue(false);
			const m = make();
			m.updateDom = jest.fn();
			await m.deleteUser("dala");
			expect(h.fetchMock).not.toHaveBeenCalled();
			expect(m.updateDom).not.toHaveBeenCalled();
		});

		it("shows an alert when the DELETE request fails", async () => {
			h.fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Not found" }) } as Response);
			const m = make();
			m.updateDom = jest.fn();
			await m.deleteUser("dala");
			expect((global as any).alert).toHaveBeenCalledWith("Not found");
			expect(m.updateDom).not.toHaveBeenCalled();
		});
	});

	describe("createDom", () => {
		it("renders a user list with one row per user", async () => {
			const users = [REGULAR_USER, CURRENT_USER];
			h.fetchMock
				.mockResolvedValueOnce({ ok: true, json: async () => users } as Response)  // fetchUsers
				.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);     // fetchClients in openForm is not called here
			const m = make();
			await m.start();
			const el = await m.createDom();
			expect(el.querySelectorAll(".um-row")).toHaveLength(2);
		});

		it("shows an empty-state message when no users exist", async () => {
			h.fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);
			const m = make();
			await m.start();
			const el = await m.createDom();
			expect(el.querySelector(".popup-empty")?.textContent).toBe("No users found.");
		});
	});

	describe("notificationReceived", () => {
		it("is a no-op that does not throw", () => {
			expect(() => make().notificationReceived("ANY", {})).not.toThrow();
		});
	});
});
