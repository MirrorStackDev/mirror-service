const POSITIONS = [
	"top_bar",
	"top_left",
	"top_center",
	"top_right",
	"upper_third",
	"middle_center",
	"lower_third",
	"bottom_left",
	"bottom_center",
	"bottom_right",
	"bottom_bar",
	"fullscreen_above",
	"fullscreen_below",
];

class personalization extends Module {
	getStyles() {
		return ["/css/personalization.css"];
	}

	defaults() {
		this.defaults = {};
		this.scope = "global"; // "global" or a client name
		this.configs = {}; // cache: { global: {...}, bathroom: {...} }
		this.layouts = {}; // cache: { global: ClientLayout, bathroom: ClientLayout }
		this.pageMode = {}; // { global: boolean, bathroom: boolean }
		this.manifests = {}; // cache: { moduleName: configField[] | null }
		this.assignedClients = [];
		this.availableModules = null;
		this.dirty = false;
		this.listEl = null;
		this.saveBtn = null;
		this.pageModeBtn = null;
		this.currentUser = null;
		this.userToggled = false;
		this.changeUserBtn = null;
	}

	async fetchModuleManifest(name) {
		if (name in this.manifests) return;
		const res = await fetch(`/modules/manifest/${name}`);
		const data = res.ok ? await res.json() : {};
		this.manifests[name] = Array.isArray(data.config) ? data.config : null;
	}

	async fetchScope(scope) {
		if (this.configs[scope]) return;
		const url = scope === "global" ? "/user/config" : `/user/config/${scope}`;
		const res = await fetch(url);
		const data = res.ok ? await res.json() : { modules: [] };
		this.configs[scope] = data;
		if (data.layout) {
			this.layouts[scope] = data.layout;
			this.pageMode[scope] = true;
		} else {
			this.pageMode[scope] = false;
		}
		if (data.name && !this.currentUser) this.currentUser = data.name;

		const mods = [
			...(data.modules ?? []),
			...(data.layout
				? [...(data.layout.fixed ?? []), ...data.layout.pages.flatMap((p) => p.modules)]
				: []),
		];
		await Promise.all(mods.map((m) => this.fetchModuleManifest(m.module)));
	}

	async fetchAssignedClients() {
		if (this.assignedClients.length) return;
		const res = await fetch("/user/clients");
		this.assignedClients = res.ok ? await res.json() : [];
	}

	async fetchAvailableModules() {
		if (this.availableModules) return;
		const res = await fetch("/user/modules/available");
		this.availableModules = res.ok ? await res.json() : [];
		await Promise.all(this.availableModules.map((name) => this.fetchModuleManifest(name)));
	}

	currentModules() {
		return this.configs[this.scope]?.modules ?? [];
	}

	currentLayout() {
		return this.layouts[this.scope] ?? { pages: [{ modules: [] }], fixed: [] };
	}

	toggleClientUser() {
		if (this.scope === "global") return;
		this.userToggled = !this.userToggled;
		const user = this.userToggled ? this.currentUser : "GLOBAL";
		trackerSocket.sendNotification("CHANGE_USER_X", { client: this.scope, user: user });
		this.setChangeUserLabel();
	}

	setChangeUserLabel() {
		if (!this.changeUserBtn) return;
		this.changeUserBtn.textContent = this.userToggled
			? "Reset to Global"
			: `Assign me (${this.currentUser})`;
	}

	togglePageMode() {
		const current = this.pageMode[this.scope] ?? false;
		if (!current) {
			const mods = this.configs[this.scope]?.modules ?? [];
			this.layouts[this.scope] = { pages: [{ modules: [...mods] }], fixed: [] };
			this.pageMode[this.scope] = true;
		} else {
			if (!confirm("Disable page mode? All pages will be merged into a flat module list.")) return;
			const layout = this.currentLayout();
			const allMods = layout.pages.flatMap((p) => p.modules);
			if (!this.configs[this.scope]) this.configs[this.scope] = { modules: [] };
			this.configs[this.scope].modules = allMods;
			this.pageMode[this.scope] = false;
			delete this.layouts[this.scope];
		}
		this.markDirty();
		this.updatePageModeBtn();
		this.renderList();
	}

	updatePageModeBtn() {
		if (!this.pageModeBtn) return;
		const active = this.pageMode[this.scope] ?? false;
		this.pageModeBtn.textContent = active ? "Pages: ON" : "Pages: OFF";
		this.pageModeBtn.classList.toggle("active", active);
	}

	async createDom() {
		await Promise.all([this.fetchScope("global"), this.fetchAssignedClients()]);

		const wrap = document.createElement("div");
		wrap.className = "pers-wrap";

		// Header
		const hdr = document.createElement("div");
		hdr.className = "pers-header";

		const left = document.createElement("div");
		left.className = "pers-header-left";

		const title = document.createElement("h3");
		title.className = "pers-title";
		title.textContent = "Your modules";
		left.appendChild(title);

		// Scope selector (only shown if the user is assigned to at least one client)
		if (this.assignedClients.length > 0) {
			const scopeSelect = document.createElement("select");
			scopeSelect.className = "pers-scope-select";

			const globalOpt = document.createElement("option");
			globalOpt.value = "global";
			globalOpt.textContent = "Global (fallback)";
			scopeSelect.appendChild(globalOpt);

			for (const client of this.assignedClients) {
				const opt = document.createElement("option");
				opt.value = client;
				opt.textContent = client;
				scopeSelect.appendChild(opt);
			}

			scopeSelect.value = this.scope;
			scopeSelect.addEventListener("change", async () => {
				if (this.dirty) {
					const ok = confirm("You have unsaved changes. Switch scope and discard them?");
					if (!ok) {
						scopeSelect.value = this.scope;
						return;
					}
					this.dirty = false;
				}
				this.scope = scopeSelect.value;
				await this.fetchScope(this.scope);
				this.renderList();
				this.saveBtn.disabled = true;
				this.saveBtn.textContent = "Save changes";

				this.userToggled = false;
				if (this.changeUserBtn) {
					this.changeUserBtn.disabled = this.scope === "global";
					this.setChangeUserLabel();
				}
				this.updatePageModeBtn();
			});

			left.appendChild(scopeSelect);
		}

		const btnRow = document.createElement("div");
		btnRow.className = "pers-header-btns";

		this.changeUserBtn = document.createElement("button");
		this.changeUserBtn.className = "popup-btn pers-changeuser-btn";
		this.changeUserBtn.disabled = this.scope === "global";
		this.setChangeUserLabel();
		this.changeUserBtn.addEventListener("click", () => this.toggleClientUser());

		this.pageModeBtn = document.createElement("button");
		this.pageModeBtn.className = "popup-btn pers-pagemode-btn";
		this.updatePageModeBtn();
		this.pageModeBtn.addEventListener("click", () => this.togglePageMode());

		const addBtn = document.createElement("button");
		addBtn.className = "popup-btn";
		addBtn.textContent = "+ Add module";
		addBtn.addEventListener("click", () => {
			if (this.pageMode[this.scope]) return; // in page mode use section-level add
			this.showAddForm();
		});

		this.saveBtn = document.createElement("button");
		this.saveBtn.className = "popup-btn pers-save-btn";
		this.saveBtn.textContent = "Save changes";
		this.saveBtn.disabled = true;
		this.saveBtn.addEventListener("click", () => this.save());

		btnRow.appendChild(this.changeUserBtn);
		btnRow.appendChild(this.pageModeBtn);
		btnRow.appendChild(addBtn);
		btnRow.appendChild(this.saveBtn);

		hdr.appendChild(left);
		hdr.appendChild(btnRow);
		wrap.appendChild(hdr);

		this.listEl = document.createElement("div");
		this.listEl.className = "pers-list";
		this.renderList();
		wrap.appendChild(this.listEl);

		return wrap;
	}

	renderList() {
		this.listEl.innerHTML = "";
		if (this.pageMode[this.scope]) {
			this.renderPageMode();
		} else {
			this.renderFlatMode();
		}
	}

	renderFlatMode() {
		const modules = this.currentModules();

		if (!modules.length) {
			const empty = document.createElement("div");
			empty.className = "pers-empty";
			const msg = document.createElement("p");
			msg.className = "popup-empty";
			msg.textContent =
				this.scope === "global"
					? "No modules configured yet."
					: `No overrides for ${this.scope} — uses global config.`;
			const hint = document.createElement("p");
			hint.className = "pers-empty-hint";
			hint.textContent = 'Use "+ Add module" to build your layout.';
			empty.appendChild(msg);
			empty.appendChild(hint);
			this.listEl.appendChild(empty);
			return;
		}

		modules.forEach((mod, index) => {
			this.listEl.appendChild(this.renderRow(mod, index, modules.length, modules));
		});
	}

	renderPageMode() {
		const layout = this.currentLayout();

		this.listEl.appendChild(this.renderPageSection("Fixed", layout.fixed, null, layout.pages.length));

		layout.pages.forEach((page, i) => {
			this.listEl.appendChild(this.renderPageSection(`Page ${i + 1}`, page.modules, i, layout.pages.length));
		});

		const addPageBtn = document.createElement("button");
		addPageBtn.className = "popup-btn pers-add-page-btn";
		addPageBtn.textContent = "+ Add page";
		addPageBtn.addEventListener("click", () => {
			this.currentLayout().pages.push({ modules: [] });
			this.markDirty();
			this.renderList();
		});
		this.listEl.appendChild(addPageBtn);
	}

	renderPageSection(title, modules, pageIdx, totalPages) {
		const section = document.createElement("div");
		section.className = "pers-page-section";

		const hdr = document.createElement("div");
		hdr.className = "pers-page-hdr";

		const titleEl = document.createElement("span");
		titleEl.className = "pers-page-title";
		titleEl.textContent = title;
		hdr.appendChild(titleEl);

		if (pageIdx !== null) {
			if (pageIdx > 0) {
				const upBtn = document.createElement("button");
				upBtn.className = "pers-arrow";
				upBtn.textContent = "↑";
				upBtn.addEventListener("click", () => {
					const pages = this.currentLayout().pages;
					[pages[pageIdx], pages[pageIdx - 1]] = [pages[pageIdx - 1], pages[pageIdx]];
					this.markDirty();
					this.renderList();
				});
				hdr.appendChild(upBtn);
			}
			if (pageIdx < totalPages - 1) {
				const downBtn = document.createElement("button");
				downBtn.className = "pers-arrow";
				downBtn.textContent = "↓";
				downBtn.addEventListener("click", () => {
					const pages = this.currentLayout().pages;
					[pages[pageIdx], pages[pageIdx + 1]] = [pages[pageIdx + 1], pages[pageIdx]];
					this.markDirty();
					this.renderList();
				});
				hdr.appendChild(downBtn);
			}
			if (totalPages > 1) {
				const delBtn = document.createElement("button");
				delBtn.className = "popup-btn pers-del";
				delBtn.textContent = "×";
				delBtn.title = "Remove page";
				delBtn.addEventListener("click", () => {
					this.currentLayout().pages.splice(pageIdx, 1);
					this.markDirty();
					this.renderList();
				});
				hdr.appendChild(delBtn);
			}
		}

		section.appendChild(hdr);

		const modList = document.createElement("div");
		modList.className = "pers-mod-list";
		modules.forEach((mod, idx) => {
			modList.appendChild(this.renderPageRow(mod, idx, modules.length, modules));
		});

		if (!modules.length) {
			const empty = document.createElement("p");
			empty.className = "pers-empty-hint";
			empty.textContent = "No modules — add one below.";
			modList.appendChild(empty);
		}

		section.appendChild(modList);

		const addBtn = document.createElement("button");
		addBtn.className = "popup-btn pers-add-to-page-btn";
		addBtn.textContent = "+ Add module";
		addBtn.addEventListener("click", () => this.showAddFormForArray(modules, section));
		section.appendChild(addBtn);

		return section;
	}

	renderRow(mod, index, total, arr) {
		const row = document.createElement("div");
		row.className = "pers-row";

		const reorder = document.createElement("div");
		reorder.className = "pers-reorder";

		const upBtn = document.createElement("button");
		upBtn.className = "pers-arrow";
		upBtn.textContent = "↑";
		upBtn.disabled = index === 0;
		upBtn.addEventListener("click", () => this.moveModule(index, -1));

		const downBtn = document.createElement("button");
		downBtn.className = "pers-arrow";
		downBtn.textContent = "↓";
		downBtn.disabled = index === total - 1;
		downBtn.addEventListener("click", () => this.moveModule(index, 1));

		reorder.appendChild(upBtn);
		reorder.appendChild(downBtn);
		row.appendChild(reorder);

		row.appendChild(this.renderModuleMain(mod, index, arr ?? this.configs[this.scope].modules, () => {
			this.configs[this.scope].modules.splice(index, 1);
			this.markDirty();
			this.renderList();
		}));

		return row;
	}

	renderPageRow(mod, index, total, arr) {
		const row = document.createElement("div");
		row.className = "pers-row";

		const reorder = document.createElement("div");
		reorder.className = "pers-reorder";

		const upBtn = document.createElement("button");
		upBtn.className = "pers-arrow";
		upBtn.textContent = "↑";
		upBtn.disabled = index === 0;
		upBtn.addEventListener("click", () => {
			[arr[index], arr[index - 1]] = [arr[index - 1], arr[index]];
			this.markDirty();
			this.renderList();
		});

		const downBtn = document.createElement("button");
		downBtn.className = "pers-arrow";
		downBtn.textContent = "↓";
		downBtn.disabled = index === total - 1;
		downBtn.addEventListener("click", () => {
			[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
			this.markDirty();
			this.renderList();
		});

		reorder.appendChild(upBtn);
		reorder.appendChild(downBtn);
		row.appendChild(reorder);

		row.appendChild(this.renderModuleMain(mod, index, arr, () => {
			arr.splice(index, 1);
			this.markDirty();
			this.renderList();
		}));

		return row;
	}

	renderModuleMain(mod, index, arr, onDelete) {
		const main = document.createElement("div");
		main.className = "pers-main";

		const topRow = document.createElement("div");
		topRow.className = "pers-top-row";

		const nameEl = document.createElement("span");
		nameEl.className = "pers-name";
		nameEl.textContent = mod.module;
		topRow.appendChild(nameEl);

		const posSelect = document.createElement("select");
		posSelect.className = "pers-pos-select";
		for (const pos of POSITIONS) {
			const opt = document.createElement("option");
			opt.value = pos;
			opt.textContent = pos.replace(/_/g, " ");
			if (pos === (mod.position ?? "middle_center")) opt.selected = true;
			posSelect.appendChild(opt);
		}
		posSelect.addEventListener("change", () => {
			arr[index].position = posSelect.value;
			this.markDirty();
		});
		topRow.appendChild(posSelect);

		const hiddenLabel = document.createElement("label");
		hiddenLabel.className = "pers-hidden";
		const hiddenCb = document.createElement("input");
		hiddenCb.type = "checkbox";
		hiddenCb.checked = mod.hiddenOnStartup ?? false;
		hiddenCb.addEventListener("change", () => {
			arr[index].hiddenOnStartup = hiddenCb.checked;
			this.markDirty();
		});
		hiddenLabel.appendChild(hiddenCb);
		hiddenLabel.appendChild(document.createTextNode(" hidden"));
		topRow.appendChild(hiddenLabel);

		const delBtn = document.createElement("button");
		delBtn.className = "popup-btn pers-del";
		delBtn.textContent = "×";
		delBtn.title = "Remove module";
		delBtn.addEventListener("click", onDelete);
		topRow.appendChild(delBtn);

		main.appendChild(topRow);
		if (!mod.config) mod.config = {};
		const cfgEditor = this.renderConfigEditor(mod.config, mod.module);
		if (cfgEditor) main.appendChild(cfgEditor);

		return main;
	}

	renderConfigEditor(config, moduleName) {
		const schema = this.manifests[moduleName];
		if (!schema || !schema.length) return null;

		const editor = document.createElement("div");
		editor.className = "pers-config";

		for (const field of schema) {
			if (!(field.key in config)) {
				config[field.key] =
					field.default ?? (field.type === "boolean" ? false : field.type === "number" ? 0 : "");
			}

			const row = document.createElement("div");
			row.className = "pers-config-field";

			const label = document.createElement("label");
			label.className = "pers-config-label";
			label.textContent = field.label ?? field.key;
			row.appendChild(label);

			let input;
			if (field.type === "boolean") {
				input = document.createElement("input");
				input.type = "checkbox";
				input.checked = Boolean(config[field.key]);
				input.addEventListener("change", () => {
					config[field.key] = input.checked;
					this.markDirty();
				});
			} else if (field.type === "number") {
				input = document.createElement("input");
				input.type = "number";
				input.value = String(config[field.key]);
				input.className = "pers-config-input";
				input.addEventListener("input", () => {
					config[field.key] = Number(input.value);
					this.markDirty();
				});
			} else if (field.type === "select") {
				input = document.createElement("select");
				input.className = "pers-config-input";
				const numericSelect = typeof field.default === "number";
				for (const opt of field.options ?? []) {
					const o = document.createElement("option");
					const v = String(typeof opt === "object" ? opt.value : opt);
					const l = typeof opt === "object" ? (opt.label ?? v) : v;
					o.value = v;
					o.textContent = l;
					if (String(config[field.key]) === v) o.selected = true;
					input.appendChild(o);
				}
				input.addEventListener("change", () => {
					config[field.key] = numericSelect ? Number(input.value) : input.value;
					this.markDirty();
				});
			} else if (field.type === "array") {
				const current = Array.isArray(config[field.key]) ? config[field.key] : [];
				input = document.createElement("div");
				input.className = "pers-config-checkgroup";
				for (const opt of field.options ?? []) {
					const lbl = document.createElement("label");
					lbl.className = "pers-config-chk";
					const chk = document.createElement("input");
					chk.type = "checkbox";
					chk.checked = current.includes(opt);
					chk.addEventListener("change", () => {
						const arr = Array.isArray(config[field.key]) ? [...config[field.key]] : [];
						if (chk.checked) {
							if (!arr.includes(opt)) arr.push(opt);
						} else {
							const i = arr.indexOf(opt);
							if (i !== -1) arr.splice(i, 1);
						}
						config[field.key] = arr;
						this.markDirty();
					});
					lbl.appendChild(chk);
					lbl.appendChild(document.createTextNode(opt));
					input.appendChild(lbl);
				}
			} else if (field.type === "urllist") {
				if (!Array.isArray(config[field.key])) config[field.key] = [];
				input = document.createElement("div");
				input.className = "pers-urllist";
				const renderUrlList = () => {
					input.innerHTML = "";
					const items = config[field.key];
					items.forEach((item, i) => {
						const obj = typeof item === "string" ? { url: item } : { ...item };

						const urlRow = document.createElement("div");
						urlRow.className = "pers-urllist-row";

						const urlInput = document.createElement("input");
						urlInput.type = "text";
						urlInput.className = "pers-config-input pers-urllist-input";
						urlInput.placeholder = "https://…";
						urlInput.value = obj.url || "";
						urlInput.addEventListener("input", () => {
							obj.url = urlInput.value;
							items[i] = obj;
							this.markDirty();
						});

						const delBtn = document.createElement("button");
						delBtn.textContent = "×";
						delBtn.className = "pers-config-del";
						delBtn.addEventListener("click", () => {
							items.splice(i, 1);
							renderUrlList();
							this.markDirty();
						});

						urlRow.appendChild(urlInput);
						urlRow.appendChild(delBtn);
						input.appendChild(urlRow);

						// Auth row
						const authRow = document.createElement("div");
						authRow.className = "pers-urllist-auth";

						const userInput = document.createElement("input");
						userInput.type = "text";
						userInput.className = "pers-config-input pers-urllist-auth-input";
						userInput.placeholder = "Username";
						userInput.value = obj.auth?.user || "";
						userInput.addEventListener("input", () => {
							if (!obj.auth) obj.auth = { method: "basic" };
							obj.auth.user = userInput.value;
							items[i] = obj;
							this.markDirty();
						});

						const passInput = document.createElement("input");
						passInput.type = "password";
						passInput.className = "pers-config-input pers-urllist-auth-input";
						passInput.placeholder = "Password / App password";
						passInput.value = obj.auth?.pass || "";
						passInput.addEventListener("input", () => {
							if (!obj.auth) obj.auth = { method: "basic" };
							obj.auth.pass = passInput.value;
							items[i] = obj;
							this.markDirty();
						});

						authRow.appendChild(userInput);
						authRow.appendChild(passInput);
						input.appendChild(authRow);
					});
					const addBtn = document.createElement("button");
					addBtn.textContent = "+ Add";
					addBtn.className = "pers-urllist-add";
					addBtn.addEventListener("click", () => {
						items.push({ url: "" });
						renderUrlList();
						this.markDirty();
					});
					input.appendChild(addBtn);
				};
				renderUrlList();
			} else {
				input = document.createElement("input");
				input.type = "text";
				input.value = String(config[field.key]);
				input.className = "pers-config-input";
				if (field.placeholder) input.placeholder = field.placeholder;
				input.addEventListener("input", () => {
					config[field.key] = input.value;
					this.markDirty();
				});
			}

			row.appendChild(input);
			editor.appendChild(row);
		}

		return editor;
	}

	async showAddForm() {
		this.listEl.querySelector(".pers-add-form")?.remove();
		await this.fetchAvailableModules();

		const form = document.createElement("div");
		form.className = "pers-add-form";

		const moduleSelect = document.createElement("select");
		moduleSelect.className = "pers-pos-select";
		for (const name of this.availableModules) {
			const opt = document.createElement("option");
			opt.value = name;
			opt.textContent = name;
			moduleSelect.appendChild(opt);
		}

		const posSelect = document.createElement("select");
		posSelect.className = "pers-pos-select";
		for (const pos of POSITIONS) {
			const opt = document.createElement("option");
			opt.value = pos;
			opt.textContent = pos.replace(/_/g, " ");
			if (pos === "middle_center") opt.selected = true;
			posSelect.appendChild(opt);
		}

		const addBtn = document.createElement("button");
		addBtn.className = "popup-btn pers-add-confirm";
		addBtn.textContent = "Add";
		addBtn.addEventListener("click", () => {
			const config = this.defaultConfigFromSchema(moduleSelect.value);
			if (!this.configs[this.scope]) this.configs[this.scope] = { modules: [] };
			this.configs[this.scope].modules.push({
				module: moduleSelect.value,
				position: posSelect.value,
				config,
			});
			this.markDirty();
			this.renderList();
		});

		const cancelBtn = document.createElement("button");
		cancelBtn.className = "popup-btn";
		cancelBtn.textContent = "Cancel";
		cancelBtn.addEventListener("click", () => form.remove());

		form.appendChild(moduleSelect);
		form.appendChild(posSelect);
		form.appendChild(addBtn);
		form.appendChild(cancelBtn);

		this.listEl.appendChild(form);
		moduleSelect.focus();
	}

	async showAddFormForArray(arr, container) {
		container.querySelector(".pers-add-form")?.remove();
		await this.fetchAvailableModules();

		const form = document.createElement("div");
		form.className = "pers-add-form";

		const moduleSelect = document.createElement("select");
		moduleSelect.className = "pers-pos-select";
		for (const name of this.availableModules) {
			const opt = document.createElement("option");
			opt.value = name;
			opt.textContent = name;
			moduleSelect.appendChild(opt);
		}

		const posSelect = document.createElement("select");
		posSelect.className = "pers-pos-select";
		for (const pos of POSITIONS) {
			const opt = document.createElement("option");
			opt.value = pos;
			opt.textContent = pos.replace(/_/g, " ");
			if (pos === "middle_center") opt.selected = true;
			posSelect.appendChild(opt);
		}

		const addBtn = document.createElement("button");
		addBtn.className = "popup-btn pers-add-confirm";
		addBtn.textContent = "Add";
		addBtn.addEventListener("click", () => {
			const config = this.defaultConfigFromSchema(moduleSelect.value);
			arr.push({ module: moduleSelect.value, position: posSelect.value, config });
			this.markDirty();
			this.renderList();
		});

		const cancelBtn = document.createElement("button");
		cancelBtn.className = "popup-btn";
		cancelBtn.textContent = "Cancel";
		cancelBtn.addEventListener("click", () => form.remove());

		form.appendChild(moduleSelect);
		form.appendChild(posSelect);
		form.appendChild(addBtn);
		form.appendChild(cancelBtn);

		container.appendChild(form);
		moduleSelect.focus();
	}

	defaultConfigFromSchema(moduleName) {
		const schema = this.manifests[moduleName] ?? [];
		const config = {};
		for (const field of schema) {
			config[field.key] =
				field.default ?? (field.type === "boolean" ? false : field.type === "number" ? 0 : "");
		}
		return config;
	}

	moveModule(index, direction) {
		const mods = this.configs[this.scope].modules;
		const target = index + direction;
		if (target < 0 || target >= mods.length) return;
		[mods[index], mods[target]] = [mods[target], mods[index]];
		this.markDirty();
		this.renderList();
	}

	markDirty() {
		this.dirty = true;
		if (this.saveBtn) {
			this.saveBtn.disabled = false;
			this.saveBtn.textContent = "Save changes";
		}
	}

	async save() {
		if (!this.saveBtn) return;
		this.saveBtn.disabled = true;
		this.saveBtn.textContent = "Saving…";

		const url = this.scope === "global" ? "/user/config" : `/user/config/${this.scope}`;
		const body = this.pageMode[this.scope]
			? JSON.stringify({ layout: this.layouts[this.scope] })
			: JSON.stringify({ modules: this.configs[this.scope]?.modules ?? [] });

		const res = await fetch(url, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body,
		});

		if (res.ok) {
			this.dirty = false;
			this.saveBtn.textContent = "Saved!";
			setTimeout(() => {
				if (!this.dirty && this.saveBtn) {
					this.saveBtn.textContent = "Save changes";
					this.saveBtn.disabled = true;
				}
			}, 2000);
		} else {
			this.saveBtn.disabled = false;
			this.saveBtn.textContent = "Save failed";
			setTimeout(() => {
				if (this.saveBtn) this.saveBtn.textContent = "Save changes";
			}, 2000);
		}
	}

	notificationReceived() {}
}

window.personalization = personalization;
