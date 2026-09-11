import { getClient, getClientConfig, setConfigInUse } from "./clientState.js";
import { resetDOM } from "./utils.js";
import type { ActiveConfig, ClientLayout } from "../types/module.js";

interface UserModuleStorage {
	name: string;
	moduleObjs: unknown[];
}

export class UserService {
	private userModulesStorage: UserModuleStorage[] = [];
	activeUser: string;

	constructor() {
		const clientConfig = getClientConfig();
		this.activeUser = clientConfig.name;
	}

	changeUser(userName: string): void {
		const name = userName === "GLOBAL" ? "default" : userName;
		const clientConfig = getClientConfig();
		if (clientConfig.userSwitchMode === "SAVE") {
			this.changeUserSAVE(name);
		} else {
			void this.changeUserDELETE(name);
		}
	}

	changeUserSAVE(_userName: string): void {
		// TODO: implement SAVE mode user switching
	}

	async changeUserDELETE(userName: string): Promise<void> {
		const user = await this.findUserConfig(userName);
		resetDOM();
		setConfigInUse(user);
		getClient().reload();
	}

	async findUserConfig(userName: string): Promise<ActiveConfig> {
		const clientConfig = getClientConfig();

		if (userName === "default") {
			let layout: ClientLayout | undefined;
			try {
				const res = await fetch(`/${clientConfig.name}/layout`);
				if (res.ok) layout = (await res.json()) as ClientLayout;
			} catch { /* ignore */ }
			return { name: clientConfig.name, modules: clientConfig.defaultModules, layout };
		}

		if (clientConfig.userSwitchMode === "SAVE") {
			const stored = this.userModulesStorage.find((u) => u.name === userName);
			if (stored) return { name: stored.name, modules: [] };
		}

		const response = await fetch(`/get-user/${userName}`, {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: clientConfig.name,
		});
		const data = (await response.json()) as ActiveConfig;

		if (clientConfig.userSwitchMode === "SAVE") {
			this.userModulesStorage.push({ name: data.name, moduleObjs: [] });
		}

		return { name: data.name, modules: data.modules, layout: data.layout };
	}
}
