/* global WeatherUtils, WeatherObject, moment, nunjucks */

function formatTime (config, date) {
	const m = moment.isMoment(date) ? date : moment(date);
	return config.timeFormat === 12 ? m.format("h:mm A") : m.format("HH:mm");
}

class weather extends Module {
	defaults () {
		this.defaults = {
			weatherProvider: "openmeteo",
			roundTemp: false,
			type: "current",
			lang: "en",
			units: "metric",
			tempUnits: "metric",
			windUnits: "metric",
			timeFormat: 24,
			updateInterval: 10 * 60 * 1000,
			showFeelsLike: true,
			showHumidity: "none",
			hideZeroes: false,
			showIndoorHumidity: false,
			showIndoorTemperature: false,
			allowOverrideNotification: false,
			showPeriod: true,
			showPeriodUpper: false,
			showPrecipitationAmount: false,
			showPrecipitationProbability: false,
			showUVIndex: false,
			showSun: true,
			showWindDirection: true,
			showWindDirectionAsArrow: false,
			degreeLabel: false,
			decimalSymbol: ".",
			maxNumberOfDays: 5,
			maxEntries: 5,
			ignoreToday: false,
			fade: true,
			fadePoint: 0.25,
			initialLoadDelay: 0,
			appendLocationNameToHeader: true,
			calendarClass: "calendar",
			tableClass: "small",
			onlyTemp: false,
			colored: false,
			absoluteDates: false,
			forecastDateFormat: "ddd",
			hourlyForecastIncrements: 1,
			themeDir: "",
			themeCustomScripts: []
		};
	}

	instanceId = null;
	fetchedLocationName = null;
	currentWeatherObject = null;
	weatherForecastArray = null;
	weatherHourlyArray = null;
	firstEvent = null;

	getStyles () {
		return ["weather.css"];
	}

	getScripts () {
		const base = this.data.path;
		return [
			`${base}node_modules/moment/moment.js`,
			`${base}node_modules/moment-timezone/builds/moment-timezone-with-data.js`,
			`${base}node_modules/suncalc/suncalc.js`,
			`${base}node_modules/nunjucks/browser/nunjucks.min.js`,
			`${base}precompiled.js`,
			`${base}weatherutils.js`,
			`${base}weatherobject.js`
		];
	}

	getThemeDir () {
		const td = this.config.themeDir.replace(/\/+$/, "");
		return td.length > 0 ? `${td}/` : "";
	}

	getTemplate () {
		switch (this.config.type.toLowerCase()) {
			case "current":
				return `${this.getThemeDir()}current.njk`;
			case "hourly":
				return `${this.getThemeDir()}hourly.njk`;
			case "daily":
			case "forecast":
				return `${this.getThemeDir()}forecast.njk`;
			default:
				return `${this.getThemeDir()}forecast.njk`;
		}
	}

	getTemplateData () {
		const now = new Date();
		const startOfHour = new Date(now);
		startOfHour.setMinutes(0, 0, 0);
		const upcomingHourlyData = this.weatherHourlyArray
			?.filter((entry) => entry.date?.valueOf() >= startOfHour.getTime());
		const hourlySourceData = upcomingHourlyData?.length ? upcomingHourlyData : this.weatherHourlyArray;

		const increment = this.config.hourlyForecastIncrements;
		const hourlyData = hourlySourceData?.filter((_entry, index) => (index + 1) % increment === increment - 1);

		return {
			config: this.config,
			current: this.currentWeatherObject,
			forecast: this.weatherForecastArray,
			hourly: hourlyData,
			indoor: {
				humidity: this.indoorHumidity,
				temperature: this.indoorTemperature
			}
		};
	}

	async start () {
		console.info(`Starting module: ${this.name}`);

		moment.locale(this.config.lang);

		if (typeof this.config.showHumidity === "boolean") {
			console.warn("[weather] Deprecation warning: Please consider updating showHumidity to the new style.");
			this.config.showHumidity = this.config.showHumidity ? "wind" : "none";
		}

		this.instanceId = this.id;
		this.createSocket();
		this.addFilters();

		console.log(`[weather] Initializing server-side provider with instance ID: ${this.instanceId}`);

		this.sendSocketNotification("INIT_WEATHER", {
			instanceId: this.instanceId,
			weatherProvider: this.config.weatherProvider,
			...this.config
		});
	}

	suspend () {
		if (this.instanceId) {
			this.sendSocketNotification("STOP_WEATHER", { instanceId: this.instanceId });
		}
	}

	notificationReceived (notification, payload, sender) {
		if (notification === "CALENDAR_EVENTS") {
			if (!sender) return;
			const senderClasses = (sender.classes || "").toLowerCase().split(" ");
			if (senderClasses.indexOf(this.config.calendarClass.toLowerCase()) !== -1) {
				this.firstEvent = null;
				for (let event of payload) {
					if (event.location || event.geo) {
						this.firstEvent = event;
						break;
					}
				}
			}
		} else if (notification === "INDOOR_TEMPERATURE") {
			this.indoorTemperature = this.roundValue(payload);
			this.updateDom();
		} else if (notification === "INDOOR_HUMIDITY") {
			this.indoorHumidity = this.roundValue(payload);
			this.updateDom();
		} else if (notification === "CURRENT_WEATHER_OVERRIDE" && this.config.allowOverrideNotification) {
			if (this.currentWeatherObject) {
				Object.assign(this.currentWeatherObject, payload);
				this.updateDom();
			}
		}
	}

	socketNotificationReceived (notification, payload) {
		if (payload.instanceId !== this.instanceId) {
			return;
		}

		if (notification === "WEATHER_INITIALIZED") {
			console.log(`[weather] Provider initialized, location: ${payload.locationName}`);
			this.fetchedLocationName = payload.locationName;
			this.updateDom();
		} else if (notification === "WEATHER_DATA") {
			this.handleWeatherData(payload);
		} else if (notification === "WEATHER_ERROR") {
			console.error("[weather] Error from helper:", payload.error);
		}
	}

	handleWeatherData (payload) {
		const { type, data } = payload;
		if (!data) return;

		switch (type) {
			case "current":
				this.currentWeatherObject = this.createWeatherObject(data);
				break;
			case "forecast":
			case "daily":
				this.weatherForecastArray = data.map((d) => this.createWeatherObject(d));
				break;
			case "hourly":
				this.weatherHourlyArray = data.map((d) => this.createWeatherObject(d));
				break;
			default:
				console.warn(`Unknown weather data type: ${type}`);
				break;
		}

		this.updateAvailable();
	}

	createWeatherObject (data) {
		const weather = new WeatherObject();
		Object.assign(weather, {
			...data,
			date: data.date ? moment(data.date) : null,
			sunrise: data.sunrise ? moment(data.sunrise) : null,
			sunset: data.sunset ? moment(data.sunset) : null
		});
		return weather;
	}

	updateAvailable () {
		console.log("[weather] New weather information available.");
		this.updateDom();

		const currentWeather = this.currentWeatherObject;
		if (currentWeather) {
			this.sendNotification("CURRENTWEATHER_TYPE", { type: currentWeather.weatherType?.replace("-", "_") });
		}
	}

	roundValue (temperature) {
		if (temperature === null || temperature === undefined) return "";
		const decimals = this.config.roundTemp ? 0 : 1;
		const roundValue = parseFloat(temperature).toFixed(decimals);
		if (roundValue === "NaN") return "";
		return roundValue === "-0" ? 0 : roundValue;
	}

	nunjucksEnvironment () {
		if (this._weatherNjkEnv) return this._weatherNjkEnv;
		const nj = window.nunjucks;
		if (!nj) throw new Error("[weather] nunjucks not loaded");
		this._weatherNjkEnv = new nj.Environment(new nj.PrecompiledLoader(), { autoescape: true });
		return this._weatherNjkEnv;
	}

	addFilters () {
		const env = this.nunjucksEnvironment();

		env.addFilter("translate", (key, args) => {
			const map = {
				LOADING: "Loading…",
				TODAY: "Today",
				TOMORROW: "Tomorrow",
				FEELS: args?.DEGREE ? `Feels like ${args.DEGREE}` : "Feels like",
				PRECIP_AMOUNT: "Precipitation:",
				PRECIP_POP: "Chance of rain:",
				N: "N", NNE: "NNE", NE: "NE", ENE: "ENE",
				E: "E", ESE: "ESE", SE: "SE", SSE: "SSE",
				S: "S", SSW: "SSW", SW: "SW", WSW: "WSW",
				W: "W", WNW: "WNW", NW: "NW", NNW: "NNW"
			};
			return map[key] ?? key;
		});

		env.addFilter("formatTime", (date) => formatTime(this.config, date));

		env.addFilter("unit", (value, type, valueUnit) => {
			if (type === "temperature") {
				if (value === null || value === undefined) return "";
				let formatted = `${this.roundValue(WeatherUtils.convertTemp(value, this.config.tempUnits))}°`;
				if (this.config.degreeLabel) {
					if (this.config.tempUnits === "metric") formatted += "C";
					else if (this.config.tempUnits === "imperial") formatted += "F";
					else formatted += "K";
				}
				return formatted;
			} else if (type === "precip") {
				if (value === null || isNaN(value)) return "";
				return WeatherUtils.convertPrecipitationUnit(value, valueUnit, this.config.units);
			} else if (type === "humidity") {
				return `${value}%`;
			} else if (type === "wind") {
				return WeatherUtils.convertWind(value, this.config.windUnits);
			}
			return value;
		});

		env.addFilter("roundValue", (value) => this.roundValue(value));

		env.addFilter("decimalSymbol", (value) => value.toString().replace(/\./g, this.config.decimalSymbol));

		env.addFilter("calcNumSteps", (forecast) => Math.min(forecast.length, this.config.maxNumberOfDays));

		env.addFilter("calcNumEntries", (dataArray) => Math.min(dataArray.length, this.config.maxEntries));

		env.addFilter("opacity", (currentStep, numSteps) => {
			if (this.config.fade && this.config.fadePoint < 1) {
				if (this.config.fadePoint < 0) this.config.fadePoint = 0;
				const startingPoint = numSteps * this.config.fadePoint;
				const numFadesteps = numSteps - startingPoint;
				if (currentStep >= startingPoint) {
					return 1 - (currentStep - startingPoint) / numFadesteps;
				}
				return 1;
			}
			return 1;
		});
	}
}

window.weather = weather;
