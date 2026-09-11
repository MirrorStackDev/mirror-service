// Payloads for module visibility/lifecycle events
// Sent from dashboard/root → server → target mirror client
export interface ModuleSocketPayload {
	client: string;
	id: string;
}

// Payload for user switch events
export interface UserSocketPayload {
	client: string;
	user: string;
}

// Payload for cursor visibility toggle
export interface CursorSocketPayload {
	client: string;
	visible: boolean;
}

export type PageAction =
	| "select"
	| "next"
	| "prev"
	| "home"
	| "showHidden"
	| "leaveHidden"
	| "pauseRotation"
	| "resumeRotation";

export interface PageCommandPayload {
	action: PageAction;
	page?: number;   // for "select"
	name?: string;   // for "showHidden"
}

// All socket event names and their payload types
export interface ServerSocketEvents {
	HIDE_MODULE_X: ModuleSocketPayload;
	SHOW_MODULE_X: ModuleSocketPayload;
	SUSPEND_MODULE_X: ModuleSocketPayload;
	RESUME_MODULE_X: ModuleSocketPayload;
	CHANGE_USER_X: UserSocketPayload;
	TOGGLE_CURSOR_X: CursorSocketPayload;
	heartbeat: void;
	retrieveTrackers: void;
}

export interface ClientSocketEvents {
	HIDE_MODULE_Y: ModuleSocketPayload;
	SHOW_MODULE_Y: ModuleSocketPayload;
	SUSPEND_MODULE_Y: ModuleSocketPayload;
	RESUME_MODULE_Y: ModuleSocketPayload;
	CHANGE_USER_Y: UserSocketPayload;
	TOGGLE_CURSOR_Y: CursorSocketPayload;
	trackersData: unknown;
	LAYOUT: import("./module.js").ClientLayout;
	PAGE_COMMAND: PageCommandPayload;
}
