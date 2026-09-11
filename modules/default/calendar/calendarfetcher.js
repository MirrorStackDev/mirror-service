const ical = require("node-ical");
const CalendarFetcherUtils = require("./calendarfetcherutils");

class CalendarFetcher {
	constructor (url, reloadInterval, excludedEvents, maximumEntries, maximumNumberOfDays, auth, includePastEvents, selfSignedCert) {
		this.url = url;
		this.reloadInterval = reloadInterval;
		this.excludedEvents = excludedEvents;
		this.maximumEntries = maximumEntries;
		this.maximumNumberOfDays = maximumNumberOfDays;
		this.includePastEvents = includePastEvents;
		this.auth = auth;
		this.selfSignedCert = selfSignedCert;

		this.events = [];
		this.lastFetch = null;
		this._etag = null;
		this._lastModified = null;
		this._timer = null;

		this.fetchFailedCallback = () => {};
		this.eventsReceivedCallback = () => {};
	}

	async _doFetch () {
		const headers = { "User-Agent": "HA-Mirrors/calendar" };
		if (this._etag) headers["If-None-Match"] = this._etag;
		if (this._lastModified) headers["If-Modified-Since"] = this._lastModified;

		if (this.auth) {
			if (this.auth.method === "bearer") {
				headers["Authorization"] = `Bearer ${this.auth.pass}`;
			} else {
				const creds = Buffer.from(`${this.auth.user}:${this.auth.pass}`).toString("base64");
				headers["Authorization"] = `Basic ${creds}`;
			}
		}

		const fetchOptions = { headers };

		let response;
		try {
			response = await fetch(this.url, fetchOptions);
		} catch (err) {
			this.fetchFailedCallback(this, {
				message: err.message,
				status: null,
				errorType: "FETCH_ERROR",
				translationKey: "MODULE_ERROR_UNSPECIFIED",
				retryAfter: this.reloadInterval,
				url: this.url,
				originalError: err
			});
			return;
		}

		if (response.status === 304) {
			this.lastFetch = Date.now();
			this.broadcastEvents();
			return;
		}

		if (!response.ok) {
			this.fetchFailedCallback(this, {
				message: `HTTP ${response.status}`,
				status: response.status,
				errorType: "FETCH_ERROR",
				translationKey: "MODULE_ERROR_UNSPECIFIED",
				retryAfter: this.reloadInterval,
				url: this.url
			});
			return;
		}

		const newEtag = response.headers.get("etag");
		const newLastModified = response.headers.get("last-modified");
		if (newEtag) this._etag = newEtag;
		if (newLastModified) this._lastModified = newLastModified;

		try {
			const responseData = await response.text();
			const filteredData = await CalendarFetcherUtils.preFilterICS(responseData, {
				includePastEvents: this.includePastEvents,
				maximumNumberOfDays: this.maximumNumberOfDays
			});
			const parsed = await ical.async.parseICS(filteredData);

			this.events = CalendarFetcherUtils.filterEvents(parsed, {
				excludedEvents: this.excludedEvents,
				includePastEvents: this.includePastEvents,
				maximumEntries: this.maximumEntries,
				maximumNumberOfDays: this.maximumNumberOfDays
			});

			this.lastFetch = Date.now();
			this.broadcastEvents();
		} catch (error) {
			console.error(`${this.url} - iCal parsing failed: ${error.message}`);
			this.fetchFailedCallback(this, {
				message: `iCal parsing failed: ${error.message}`,
				status: null,
				errorType: "PARSE_ERROR",
				translationKey: "MODULE_ERROR_UNSPECIFIED",
				retryAfter: this.reloadInterval,
				url: this.url,
				originalError: error
			});
		}
	}

	fetchCalendar () {
		this._doFetch();
		if (!this._timer) {
			this._timer = setInterval(() => this._doFetch(), this.reloadInterval);
		}
	}

	shouldRefetch () {
		if (!this.lastFetch) return true;
		return Date.now() - this.lastFetch >= this.reloadInterval;
	}

	broadcastEvents () {
		console.info(`Broadcasting ${this.events.length} events from ${this.url}.`);
		this.eventsReceivedCallback(this);
	}

	onReceive (callback) {
		this.eventsReceivedCallback = callback;
	}

	onError (callback) {
		this.fetchFailedCallback = callback;
	}
}

module.exports = CalendarFetcher;
