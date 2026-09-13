import { setSession } from "./clientState.js";
import { log } from "./logger.js";
import type { ClientConfig, ActiveConfig } from "../types/module.js";
import type { SessionInfo } from "../types/index.js";

/**
 * Injects a top navigation bar into the dashboard — displays the project title,
 * the current user's display name, and a logout button.
 * Only rendered when `ClientConfig.showNav` is true (the default).
 */
export function createPanelNav(session: SessionInfo): void {
	const nav = document.createElement("nav");
	nav.id = "panel-nav";

	const title = document.createElement("span");
	title.id = "panel-nav-title";
	title.textContent = "MirrorStack";

	const right = document.createElement("div");
	right.id = "panel-nav-right";

	const userSpan = document.createElement("span");
	userSpan.id = "panel-nav-user";
	userSpan.textContent = session.displayName;

	const logoutBtn = document.createElement("button");
	logoutBtn.id = "panel-nav-logout";
	logoutBtn.textContent = "Log out";
	logoutBtn.addEventListener("click", async () => {
		await fetch("/auth/logout", { method: "POST" });
		window.location.href = "/login";
	});

	right.appendChild(userSpan);
	right.appendChild(logoutBtn);
	nav.appendChild(title);
	nav.appendChild(right);
	document.body.insertBefore(nav, document.body.firstChild);
}

/**
 * Dashboard boot sequence — authenticates the session, optionally renders the nav bar,
 * and resolves the initial module config based on the user's role.
 * Returns `null` if the user is not authenticated (triggers a redirect to `/login`).
 */
export async function startDashboardClient(clientConfig: ClientConfig): Promise<ActiveConfig | null> {
	const sessionRes = await fetch("/auth/me");
	if (!sessionRes.ok) {
		window.location.href = "/login";
		return null;
	}

	const session = (await sessionRes.json()) as SessionInfo;
	setSession(session);

	if (clientConfig.showNav !== false) {
		createPanelNav(session);
	}

	const modules = session.role === "admin"
		? clientConfig.defaultModules
		: [
			{ module: "personalization", position: "middle_center" as const, config: {} },
			{ module: "profileSettings", position: "middle_center" as const, config: {} },
		];

	log.info("Client", `Dashboard session: ${session.username} (${session.role})`);
	return { name: clientConfig.name, modules };
}
