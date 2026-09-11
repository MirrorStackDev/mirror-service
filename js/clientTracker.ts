import type { ClientStatus, ClientConnection, ClientTrackerData } from "../types/tracker.js";
import type { ClientType } from "../types/module.js";

// Shape of the object as stored/loaded from cTracker.json (dates are strings)
interface ClientTrackerJSON {
	name: string;
	type: ClientType;
	lastOnline: string | null;
	connectedAt: string | null;
	status: ClientStatus;
	user: string;
	connections: ClientConnection[];
}

/**
 * Tracks the runtime state of a connected mirror — online status, active user,
 * and individual socket connections. Persisted to `cTracker.json` between restarts.
 */
class ClientTracker implements ClientTrackerData {
	name: string;
	type: ClientType;
	lastOnline: Date | null;
	connectedAt: Date | null;
	status: ClientStatus;
	user: string;
	connections: ClientConnection[];

	constructor(
		name: string,
		type: ClientType,
		lastOnline: string | Date | null = null,
		connectedAt: string | Date | null = null,
		status: ClientStatus = "online",
		connections: ClientConnection[] = [],
		user: string = "default",
	) {
		this.name = name;
		this.type = type;
		this.lastOnline = lastOnline ? new Date(lastOnline) : null;
		this.connectedAt = connectedAt ? new Date(connectedAt) : null;
		this.status = status;
		this.user = user;
		this.connections = connections;
	}

	/** Deserialises a persisted JSON record — converts date strings back to `Date` objects. */
	static fromObject(obj: ClientTrackerJSON): ClientTracker {
		return new ClientTracker(
			obj.name,
			obj.type,
			obj.lastOnline,
			obj.connectedAt,
			obj.status,
			obj.connections,
			obj.user,
		);
	}

	start(): void {}

	end(): void {}
}

export default ClientTracker;
