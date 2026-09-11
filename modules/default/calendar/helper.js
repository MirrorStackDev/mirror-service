const zlib = require("node:zlib");
const Helper = require("../../../dist/js/helper").default;
const CalendarFetcher = require("./calendarfetcher");

class calendarHelper extends Helper {
	start () {
		console.log(`Starting helper: ${this.name}`);
		this.fetchers = [];
	}

	socketNotificationReceived (notification, payload) {
		if (notification === "ADD_CALENDAR") {
			this.createFetcher(
				payload.url,
				payload.fetchInterval,
				payload.excludedEvents,
				payload.maximumEntries,
				payload.maximumNumberOfDays,
				payload.auth,
				payload.broadcastPastEvents,
				payload.selfSignedCert,
				payload.id
			);
		} else if (notification === "FETCH_CALENDAR") {
			const key = payload.id + payload.url;
			if (typeof this.fetchers[key] === "undefined") {
				console.error("No fetcher exists with key: ", key);
				this.sendSocketNotification("CALENDAR_ERROR", { error_type: "MODULE_ERROR_UNSPECIFIED" });
				return;
			}
			this.fetchers[key].fetchCalendar();
		}
	}

	createFetcher (url, fetchInterval, excludedEvents, maximumEntries, maximumNumberOfDays, auth, broadcastPastEvents, selfSignedCert, identifier) {
		try {
			new URL(url);
		} catch (error) {
			console.error("Malformed calendar url: ", url, error);
			this.sendSocketNotification("CALENDAR_ERROR", { error_type: "MODULE_ERROR_MALFORMED_URL" });
			return;
		}

		let fetcher;
		let fetchIntervalCorrected;
		if (typeof this.fetchers[identifier + url] === "undefined") {
			if (fetchInterval < 60000) {
				console.warn(`fetchInterval for url ${url} must be >= 60000`);
				fetchIntervalCorrected = 60000;
			}
			console.log(`Create new calendarfetcher for url: ${url} - Interval: ${fetchIntervalCorrected || fetchInterval}`);
			fetcher = new CalendarFetcher(url, fetchIntervalCorrected || fetchInterval, excludedEvents, maximumEntries, maximumNumberOfDays, auth, broadcastPastEvents, selfSignedCert);

			fetcher.onReceive((fetcher) => {
				this.broadcastEvents(fetcher, identifier);
			});

			fetcher.onError((fetcher, errorInfo) => {
				console.error("Calendar Error. Could not fetch calendar: ", fetcher.url, errorInfo.message || errorInfo);
				this.sendSocketNotification("CALENDAR_ERROR", {
					id: identifier,
					error_type: errorInfo.translationKey
				});
			});

			this.fetchers[identifier + url] = fetcher;
			fetcher.fetchCalendar();
		} else {
			console.log(`Use existing calendarfetcher for url: ${url}`);
			fetcher = this.fetchers[identifier + url];
			if (fetcher.shouldRefetch()) {
				console.log(`Calendar data is stale, fetching fresh data for url: ${url}`);
				fetcher.fetchCalendar();
			} else {
				fetcher.broadcastEvents();
			}
		}
	}

	broadcastEvents (fetcher, identifier) {
		const checksum = zlib.crc32(Buffer.from(JSON.stringify(fetcher.events), "utf8"));
		this.sendSocketNotification("CALENDAR_EVENTS", {
			id: identifier,
			url: fetcher.url,
			events: fetcher.events,
			checksum: checksum
		});
	}
}

module.exports = calendarHelper;
