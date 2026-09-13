/**
 * @jest-environment jsdom
 */
import { createPanelNav } from "../clientDashboard.js";
import type { SessionInfo } from "../../types/index.js";

jest.mock("../clientState.js", () => ({
	setSession: jest.fn(),
}));

describe("createPanelNav", () => {
	beforeEach(() => {
		document.body.innerHTML = "<div>existing content</div>";
	});

	const session: SessionInfo = { username: "dala", displayName: "Dala the Tester", role: "user" };

	it("creates a #panel-nav element", () => {
		createPanelNav(session);
		expect(document.getElementById("panel-nav")).not.toBeNull();
	});

	it("inserts panel-nav before all existing body content", () => {
		createPanelNav(session);
		expect(document.body.firstChild?.nodeName).toBe("NAV");
	});

	it("displays the session displayName in #panel-nav-user", () => {
		createPanelNav(session);
		expect(document.getElementById("panel-nav-user")?.textContent).toBe("Dala the Tester");
	});

	it("includes a logout button", () => {
		createPanelNav(session);
		expect(document.getElementById("panel-nav-logout")).not.toBeNull();
	});

	it("sets the title text to MirrorStack", () => {
		createPanelNav(session);
		expect(document.getElementById("panel-nav-title")?.textContent).toBe("MirrorStack");
	});
});
