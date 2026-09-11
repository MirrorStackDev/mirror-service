const moment = require("moment-timezone");
const ical = require("node-ical");

const CalendarFetcherUtils = {

	shouldEventBeExcluded (config, title) {
		for (const filterConfig of config.excludedEvents) {
			const match = CalendarFetcherUtils.checkEventAgainstFilter(title, filterConfig);
			if (match) {
				return {
					excluded: !match.until,
					until: match.until
				};
			}
		}

		return {
			excluded: false,
			until: null
		};
	},

	getLocalTimezone () {
		return moment.tz.guess();
	},

	calculateFilterWindow (config) {
		const today = moment().startOf("day");
		const start = config.includePastEvents
			? today.clone().subtract(config.maximumNumberOfDays, "days").toDate()
			: new Date();
		const end = today.clone().add(config.maximumNumberOfDays, "days").toDate();
		return [start, end];
	},

	async preFilterICS (rawICS, config) {
		const { icsFilter } = await import("ics-filter");
		const [start, end] = CalendarFetcherUtils.calculateFilterWindow(config);
		return icsFilter(rawICS, start, end);
	},

	filterEvents (data, config) {
		const newEvents = [];

		console.debug(`There are ${Object.entries(data).length} calendar entries.`);

		const now = moment();
		const pastLocalMoment = config.includePastEvents ? now.clone().startOf("day").subtract(config.maximumNumberOfDays, "days") : now;
		const futureLocalMoment
			= now
				.clone()
				.startOf("day")
				.add(config.maximumNumberOfDays, "days")
				.subtract(1, "seconds");

		Object.values(data).forEach((event) => {
			if (event.type !== "VEVENT") {
				return;
			}

			const title = CalendarFetcherUtils.getTitleFromEvent(event);
			console.debug(`title: ${title}`);

			const { excluded, until: eventFilterUntil } = CalendarFetcherUtils.shouldEventBeExcluded(config, title);
			if (excluded) {
				return;
			}

			console.debug(`Event: ${title} | start: ${event.start} | end: ${event.end} | recurring: ${!!event.rrule}`);

			const location = CalendarFetcherUtils.unwrapParameterValue(event.location) || false;
			const geo = event.geo || false;
			const description = CalendarFetcherUtils.unwrapParameterValue(event.description) || false;

			let instances;
			try {
				instances = CalendarFetcherUtils.expandRecurringEvent(event, pastLocalMoment, futureLocalMoment);
			} catch (error) {
				console.error(`Could not expand event "${title}": ${error.message}`);
				return;
			}

			for (const instance of instances) {
				const { event: instanceEvent, startMoment, endMoment, isRecurring, isFullDay } = instance;

				if (endMoment.isBefore(pastLocalMoment) || startMoment.isAfter(futureLocalMoment)) {
					continue;
				}

				if (CalendarFetcherUtils.timeFilterApplies(now, endMoment, eventFilterUntil)) {
					continue;
				}

				const instanceTitle = CalendarFetcherUtils.getTitleFromEvent(instanceEvent);

				console.debug(`saving event: ${instanceTitle}, start: ${startMoment.toDate()}, end: ${endMoment.toDate()}`);
				newEvents.push({
					title: instanceTitle,
					startDate: startMoment.format("x"),
					endDate: endMoment.format("x"),
					fullDayEvent: isFullDay,
					recurringEvent: isRecurring,
					class: event.class,
					firstYear: event.start.getFullYear(),
					location: CalendarFetcherUtils.unwrapParameterValue(instanceEvent.location) || location,
					geo: instanceEvent.geo || geo,
					description: CalendarFetcherUtils.unwrapParameterValue(instanceEvent.description) || description
				});
			}
		});

		newEvents.sort(function (a, b) {
			return a.startDate - b.startDate;
		});

		return newEvents;
	},

	getTitleFromEvent (event) {
		return CalendarFetcherUtils.unwrapParameterValue(event.summary || event.description) || "Event";
	},

	unwrapParameterValue (value) {
		if (value && typeof value === "object" && typeof value.val !== "undefined") {
			return value.val;
		}
		return value;
	},

	timeFilterApplies (now, endDate, filter) {
		if (filter) {
			const until = filter.split(" "),
				value = parseInt(until[0]),
				increment = until[1].slice(-1) === "s" ? until[1] : `${until[1]}s`,
				filterUntil = moment(endDate.format()).subtract(value, increment);

			return now.isBefore(filterUntil);
		}

		return false;
	},

	titleFilterApplies (title, filter, useRegex, regexFlags) {
		if (useRegex) {
			let regexFilter = filter;
			if (filter[0] === "/") {
				regexFilter = filter.slice(1, -1);
			}
			return new RegExp(regexFilter, regexFlags).test(title);
		} else {
			return title.includes(filter);
		}
	},

	expandRecurringEvent (event, pastLocalMoment, futureLocalMoment) {
		const localTimezone = CalendarFetcherUtils.getLocalTimezone();

		return ical
			.expandRecurringEvent(event, {
				from: pastLocalMoment.toDate(),
				to: futureLocalMoment.toDate(),
				includeOverrides: true,
				excludeExdates: true,
				expandOngoing: true
			})
			.map((inst) => {
				let startMoment, endMoment;
				if (inst.isFullDay) {
					startMoment = moment.tz([inst.start.getFullYear(), inst.start.getMonth(), inst.start.getDate()], localTimezone);
					endMoment = moment.tz([inst.end.getFullYear(), inst.end.getMonth(), inst.end.getDate()], localTimezone);
				} else {
					startMoment = moment(inst.start).tz(localTimezone);
					endMoment = moment(inst.end).tz(localTimezone);
				}
				if (startMoment.valueOf() === endMoment.valueOf()) endMoment = endMoment.endOf("day");
				return { event: inst.event, startMoment, endMoment, isRecurring: inst.isRecurring, isFullDay: inst.isFullDay };
			});
	},

	checkEventAgainstFilter (title, filterConfig) {
		let filter = filterConfig;
		let testTitle = title.toLowerCase();
		let until = null;
		let useRegex = false;
		let regexFlags = "g";

		if (filter instanceof Object) {
			if (typeof filter.until !== "undefined") {
				until = filter.until;
			}

			if (typeof filter.regex !== "undefined") {
				useRegex = filter.regex;
			}

			if (filter.caseSensitive) {
				filter = filter.filterBy;
				testTitle = title;
			} else if (useRegex) {
				filter = filter.filterBy;
				testTitle = title;
				regexFlags += "i";
			} else {
				filter = filter.filterBy.toLowerCase();
			}
		} else {
			filter = filter.toLowerCase();
		}

		if (CalendarFetcherUtils.titleFilterApplies(testTitle, filter, useRegex, regexFlags)) {
			return { until };
		}

		return null;
	}
};

if (typeof module !== "undefined") {
	module.exports = CalendarFetcherUtils;
}
