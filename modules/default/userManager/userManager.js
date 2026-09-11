class userManager extends Module {
	getStyles() {
		return ["/css/userManager.css"];
	}

	defaults() {
		this.defaults = {};
		this._ready = false;
	}

	async start() {
		const session = getSession();
		if (session?.role !== "admin") {
			this.hide(0);
		} else {
			this._ready = true;
			this.updateDom();
		}
	}

	async fetchUsers() {
		const res = await fetch("/admin/users");
		if (!res.ok) return [];
		return res.json();
	}

	async createDom() {
		if (!this._ready) return document.createElement("div");

		const users = await this.fetchUsers();
		const currentUser = getSession();

		const wrap = document.createElement("div");
		wrap.className = "um-wrap";

		const hdr = document.createElement("div");
		hdr.className = "um-header";
		const title = document.createElement("h3");
		title.className = "um-title";
		title.textContent = "Users";
		const newBtn = document.createElement("button");
		newBtn.className = "popup-btn";
		newBtn.textContent = "+ New user";
		newBtn.addEventListener("click", () => this.openForm(null, currentUser));
		hdr.appendChild(title);
		hdr.appendChild(newBtn);
		wrap.appendChild(hdr);

		const adminCount = users.filter((u) => u.role === "admin").length;

		if (users.length === 0) {
			const empty = document.createElement("p");
			empty.className = "popup-empty";
			empty.textContent = "No users found.";
			wrap.appendChild(empty);
		} else {
			const list = document.createElement("div");
			list.className = "um-list";
			for (const user of users) {
				list.appendChild(this.renderRow(user, currentUser, adminCount));
			}
			wrap.appendChild(list);
		}

		return wrap;
	}

	renderRow(user, currentUser, adminCount) {
		const row = document.createElement("div");
		row.className = "um-row";

		const info = document.createElement("div");
		info.className = "um-info";

		const username = document.createElement("span");
		username.className = "um-username";
		username.textContent = user.username;

		const displayName = document.createElement("span");
		displayName.className = "um-displayname";
		displayName.textContent = user.displayName;

		const roleBadge = document.createElement("span");
		roleBadge.className = `um-role ${user.role}`;
		roleBadge.textContent = user.role;

		info.appendChild(username);
		info.appendChild(displayName);
		info.appendChild(roleBadge);

		const actions = document.createElement("div");
		actions.className = "um-actions";

		const editBtn = document.createElement("button");
		editBtn.className = "popup-btn";
		editBtn.textContent = "Edit";
		editBtn.addEventListener("click", () => this.openForm(user, currentUser));
		actions.appendChild(editBtn);

		const isSelf = currentUser && currentUser.username === user.username;
		const isLastAdmin = user.role === "admin" && adminCount === 1;

		if (!isSelf && !isLastAdmin) {
			const delBtn = document.createElement("button");
			delBtn.className = "popup-btn um-del-btn";
			delBtn.textContent = "Delete";
			delBtn.addEventListener("click", () => this.deleteUser(user.username));
			actions.appendChild(delBtn);
		}

		row.appendChild(info);
		row.appendChild(actions);
		return row;
	}

	async openForm(user, currentUser) {
		document.getElementById("um-form")?.remove();

		const clientsRes = await fetch("/admin/clients");
		const clients = clientsRes.ok ? await clientsRes.json() : [];

		const overlay = document.createElement("div");
		overlay.id = "um-form";
		overlay.className = "um-overlay";
		overlay.addEventListener("click", (e) => {
			if (e.target === overlay) overlay.remove();
		});

		const card = document.createElement("div");
		card.className = "um-form-card";

		const closeBtn = document.createElement("button");
		closeBtn.className = "um-close";
		closeBtn.textContent = "×";
		closeBtn.addEventListener("click", () => overlay.remove());
		card.appendChild(closeBtn);

		const title = document.createElement("h2");
		title.className = "um-form-title";
		title.textContent = user ? `Edit: ${user.username}` : "New user";
		card.appendChild(title);

		const errorEl = document.createElement("p");
		errorEl.className = "um-error";
		card.appendChild(errorEl);

		const form = document.createElement("form");
		form.className = "um-form-fields";

		if (!user) {
			form.appendChild(this.fieldEl("username", "Username", "text", "", true));
		}
		form.appendChild(
			this.fieldEl("displayName", "Display name", "text", user?.displayName ?? "", true),
		);
		form.appendChild(this.roleSelectEl(user?.role ?? "user", user, currentUser));
		const pwLabel = user ? "New password" : "Password";
		const pwPlaceholder = user ? "Leave blank to keep current" : "";
		form.appendChild(this.fieldEl("password", pwLabel, "password", "", !user, pwPlaceholder));

		if (clients.length > 0) {
			form.appendChild(this.mirrorsFieldEl(clients, user?.username ?? null));
		}

		const formActions = document.createElement("div");
		formActions.className = "um-form-actions";

		const cancelBtn = document.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.className = "popup-btn";
		cancelBtn.textContent = "Cancel";
		cancelBtn.addEventListener("click", () => overlay.remove());

		const saveBtn = document.createElement("button");
		saveBtn.type = "submit";
		saveBtn.className = "popup-btn um-save-btn";
		saveBtn.textContent = "Save";

		formActions.appendChild(cancelBtn);
		formActions.appendChild(saveBtn);
		form.appendChild(formActions);

		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			saveBtn.disabled = true;
			errorEl.textContent = "";

			const formData = Object.fromEntries(new FormData(form));
			if (!formData.password) delete formData.password;

			// Strip client checkboxes from account payload
			const accountData = Object.fromEntries(
				Object.entries(formData).filter(([k]) => !k.startsWith("client-")),
			);

			const res = user
				? await fetch(`/admin/users/${user.username}`, {
						method: "PATCH",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(accountData),
					})
				: await fetch("/admin/users", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(accountData),
					});

			if (!res.ok) {
				const body = await res.json();
				errorEl.textContent = body.error ?? "Something went wrong";
				saveBtn.disabled = false;
				return;
			}

			// Update client user lists
			const username = user ? user.username : accountData.username;
			for (const client of clients) {
				const cb = form.querySelector(`[name="client-${client.name}"]`);
				if (!cb) continue;
				const checked = cb.checked;
				const inList = client.users.includes(username);
				if (checked === inList) continue;
				const updatedUsers = checked
					? [...client.users, username]
					: client.users.filter((u) => u !== username);
				await fetch(`/admin/clients/${client.name}/users`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ users: updatedUsers }),
				});
			}

			overlay.remove();
			this.updateDom();
		});

		card.appendChild(form);
		overlay.appendChild(card);
		document.getElementById("all-regions").appendChild(overlay);
	}

	fieldEl(name, label, type, value = "", required = false, placeholder = "") {
		const wrap = document.createElement("div");
		wrap.className = "um-field";

		const lbl = document.createElement("label");
		lbl.className = "um-label";
		lbl.textContent = label;
		lbl.htmlFor = `um-${name}`;

		const input = document.createElement("input");
		input.type = type;
		input.name = name;
		input.id = `um-${name}`;
		input.value = value;
		input.className = "um-input";
		if (required) input.required = true;
		if (placeholder) input.placeholder = placeholder;

		wrap.appendChild(lbl);
		wrap.appendChild(input);
		return wrap;
	}

	mirrorsFieldEl(clients, username) {
		const wrap = document.createElement("div");
		wrap.className = "um-field";

		const lbl = document.createElement("label");
		lbl.className = "um-label";
		lbl.textContent = "Mirror access";
		wrap.appendChild(lbl);

		const checkboxes = document.createElement("div");
		checkboxes.className = "um-mirrors";

		for (const client of clients) {
			const label = document.createElement("label");
			label.className = "um-mirror-label";

			const cb = document.createElement("input");
			cb.type = "checkbox";
			cb.name = `client-${client.name}`;
			cb.checked = username ? client.users.includes(username) : false;

			label.appendChild(cb);
			label.appendChild(document.createTextNode(` ${client.name}`));
			checkboxes.appendChild(label);
		}

		wrap.appendChild(checkboxes);
		return wrap;
	}

	roleSelectEl(currentRole, editingUser, currentUser) {
		const wrap = document.createElement("div");
		wrap.className = "um-field";

		const lbl = document.createElement("label");
		lbl.className = "um-label";
		lbl.textContent = "Role";
		lbl.htmlFor = "um-role";

		const select = document.createElement("select");
		select.name = "role";
		select.id = "um-role";
		select.className = "um-select";

		// Prevent downgrading your own admin role
		const isSelf = currentUser && editingUser && currentUser.username === editingUser.username;
		if (isSelf) select.disabled = true;

		for (const role of ["admin", "user"]) {
			const opt = document.createElement("option");
			opt.value = role;
			opt.textContent = role;
			if (role === currentRole) opt.selected = true;
			select.appendChild(opt);
		}

		wrap.appendChild(lbl);
		wrap.appendChild(select);
		return wrap;
	}

	async deleteUser(username) {
		if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
		const res = await fetch(`/admin/users/${username}`, { method: "DELETE" });
		if (res.ok) {
			this.updateDom();
		} else {
			const body = await res.json();
			alert(body.error ?? "Delete failed");
		}
	}

	notificationReceived() {}
}

window.userManager = userManager;
