const path = require("node:path");
const Helper = require("../../../dist/js/helper").default;

class weatherHelper extends Helper {
	start () {
		console.log(`Starting helper: ${this.name}`);
		this.providers = {};
		this.lastData = {};
	}

	socketNotificationReceived (notification, payload) {
		if (notification === "INIT_WEATHER") {
			console.log(`Received INIT_WEATHER for instance ${payload.instanceId}`);
			this.initWeatherProvider(payload);
		} else if (notification === "STOP_WEATHER") {
			console.log(`Received STOP_WEATHER for instance ${payload.instanceId}`);
			this.stopWeatherProvider(payload.instanceId);
		}
	}

	async initWeatherProvider (config) {
		const identifier = config.weatherProvider.toLowerCase();
		const instanceId = config.instanceId;

		console.log(`Attempting to initialize provider ${identifier} for instance ${instanceId}`);

		if (this.providers[instanceId]) {
			console.log(`Weather provider ${identifier} already initialized for instance ${instanceId}, re-sending WEATHER_INITIALIZED`);
			this.sendSocketNotification("WEATHER_INITIALIZED", {
				instanceId,
				locationName: this.providers[instanceId].locationName
			});
			if (this.lastData[instanceId]) {
				this.sendSocketNotification("WEATHER_DATA", this.lastData[instanceId]);
			}
			return;
		}

		try {
			const providerPath = path.join(__dirname, "providers", `${identifier}.js`);
			console.log(`Loading provider from: ${providerPath}`);
			const ProviderClass = require(providerPath);

			const provider = new ProviderClass(config);

			provider.setCallbacks(
				(data) => {
					const payload = { instanceId, type: config.type, data };
					this.lastData[instanceId] = payload;
					this.sendSocketNotification("WEATHER_DATA", payload);
				},
				(errorInfo) => {
					this.sendSocketNotification("WEATHER_ERROR", {
						instanceId,
						error: errorInfo.message || "Unknown error",
						translationKey: errorInfo.translationKey
					});
				}
			);

			await provider.initialize();
			this.providers[instanceId] = provider;

			this.sendSocketNotification("WEATHER_INITIALIZED", {
				instanceId,
				locationName: provider.locationName
			});

			provider.start();

			console.log(`Weather provider ${identifier} initialized for instance ${instanceId}`);
		} catch (error) {
			console.error(`Failed to initialize weather provider ${identifier}:`, error);
			this.sendSocketNotification("WEATHER_ERROR", {
				instanceId,
				error: error.message
			});
		}
	}

	stopWeatherProvider (instanceId) {
		const provider = this.providers[instanceId];
		if (provider) {
			console.log(`Stopping weather provider for instance ${instanceId}`);
			provider.stop();
			delete this.providers[instanceId];
			delete this.lastData[instanceId];
		} else {
			console.warn(`No provider found for instance ${instanceId}`);
		}
	}
}

module.exports = weatherHelper;
