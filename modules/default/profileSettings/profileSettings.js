class profileSettings extends Module {
	getStyles() {
		return ["/css/profileSettings.css"];
	}

	defaults() {
		this.profile = null;
		this.saveBtn = null;
		this.statusEl = null;
	}

	async fetchProfile() {
		const res = await fetch("/user/profile");
		if (!res.ok) return null;
		return res.json();
	}

	async createDom() {
		this.profile = await this.fetchProfile();

		const wrap = document.createElement("div");
		wrap.className = "ps-wrap";

		const title = document.createElement("h3");
		title.className = "ps-title";
		title.textContent = "Profile settings";
		wrap.appendChild(title);

		wrap.appendChild(this.buildDisplayNameSection());
		wrap.appendChild(this.buildPasswordSection());

		this.statusEl = document.createElement("p");
		this.statusEl.className = "ps-status";
		wrap.appendChild(this.statusEl);

		return wrap;
	}

	buildDisplayNameSection() {
		const section = document.createElement("div");
		section.className = "ps-section";

		const label = document.createElement("label");
		label.className = "ps-label";
		label.htmlFor = "ps-displayname";
		label.textContent = "Display name";
		section.appendChild(label);

		const input = document.createElement("input");
		input.type = "text";
		input.id = "ps-displayname";
		input.className = "ps-input";
		input.value = this.profile?.displayName ?? "";
		input.placeholder = "Display name";
		section.appendChild(input);

		const btn = document.createElement("button");
		btn.className = "popup-btn ps-save-btn";
		btn.textContent = "Save";
		btn.addEventListener("click", () => this.saveDisplayName(input.value.trim()));
		section.appendChild(btn);

		return section;
	}

	buildPasswordSection() {
		const section = document.createElement("div");
		section.className = "ps-section";

		const heading = document.createElement("p");
		heading.className = "ps-section-heading";
		heading.textContent = "Change password";
		section.appendChild(heading);

		const currentInput = this.fieldEl("ps-current-pw", "Current password", "password");
		const newInput = this.fieldEl("ps-new-pw", "New password", "password");
		const confirmInput = this.fieldEl("ps-confirm-pw", "Confirm new password", "password");

		section.appendChild(currentInput.wrap);
		section.appendChild(newInput.wrap);
		section.appendChild(confirmInput.wrap);

		const btn = document.createElement("button");
		btn.className = "popup-btn ps-save-btn";
		btn.textContent = "Change password";
		btn.addEventListener("click", () =>
			this.savePassword(currentInput.input.value, newInput.input.value, confirmInput.input.value));
		section.appendChild(btn);

		return section;
	}

	fieldEl(id, labelText, type) {
		const wrap = document.createElement("div");
		wrap.className = "ps-field";
		const label = document.createElement("label");
		label.htmlFor = id;
		label.className = "ps-label";
		label.textContent = labelText;
		const input = document.createElement("input");
		input.type = type;
		input.id = id;
		input.className = "ps-input";
		wrap.appendChild(label);
		wrap.appendChild(input);
		return { wrap, input };
	}

	async saveDisplayName(displayName) {
		if (!displayName) { this.setStatus("Display name cannot be empty.", true); return; }
		const res = await fetch("/user/profile", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ displayName }),
		});
		if (res.ok) {
			this.setStatus("Display name updated.");
		} else {
			const data = await res.json().catch(() => ({}));
			this.setStatus(data.error ?? "Failed to update display name.", true);
		}
	}

	async savePassword(current, next, confirm) {
		if (!current || !next || !confirm) { this.setStatus("All password fields are required.", true); return; }
		if (next !== confirm) { this.setStatus("New passwords do not match.", true); return; }
		if (next.length < 6) { this.setStatus("Password must be at least 6 characters.", true); return; }
		const res = await fetch("/user/profile", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: next, currentPassword: current }),
		});
		if (res.ok) {
			this.setStatus("Password changed.");
			document.getElementById("ps-current-pw").value = "";
			document.getElementById("ps-new-pw").value = "";
			document.getElementById("ps-confirm-pw").value = "";
		} else {
			const data = await res.json().catch(() => ({}));
			this.setStatus(data.error ?? "Failed to change password.", true);
		}
	}

	setStatus(msg, isError = false) {
		if (!this.statusEl) return;
		this.statusEl.textContent = msg;
		this.statusEl.className = "ps-status" + (isError ? " ps-status-error" : " ps-status-ok");
		setTimeout(() => {
			if (this.statusEl) {
				this.statusEl.textContent = "";
				this.statusEl.className = "ps-status";
			}
		}, 4000);
	}

	notificationReceived() {}
}

window.profileSettings = profileSettings;
