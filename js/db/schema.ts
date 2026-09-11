import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
	username:     text("username").primaryKey(),
	displayName:  text("display_name").notNull(),
	role:         text("role").notNull(),          // "admin" | "user"
	passwordHash: text("password_hash").notNull(),
	salt:         text("salt").notNull(),
});

export const sessions = sqliteTable("sessions", {
	token:       text("token").primaryKey(),
	username:    text("username").notNull().references(() => accounts.username, { onDelete: "cascade" }),
	displayName: text("display_name").notNull(),
	role:        text("role").notNull(),
	expiresAt:   integer("expires_at").notNull(),  // Unix ms
});

// Merges {client}.json config + cTracker.json runtime state into one row per client
export const clients = sqliteTable("clients", {
	name:           text("name").primaryKey(),
	type:           text("type").notNull().default("mirror"),
	userSwitchMode: text("user_switch_mode").notNull().default("SAVE"),
	defaultModules: text("default_modules").notNull().default("[]"),  // JSON: ModuleDefinition[] — legacy, used when layout is null
	layout:         text("layout"),                                    // JSON: ClientLayout | null
	// runtime tracker state — reset to defaults on server start
	status:      text("status").notNull().default("offline"),
	currentUser: text("current_user").notNull().default("default"),
	lastOnline:  integer("last_online"),   // Unix ms, nullable
	connectedAt: integer("connected_at"),  // Unix ms, nullable
	connections: text("connections").notNull().default("[]"),  // JSON: { ip, connectedAt }[]
});

// Replaces the users[] array in {client}.json — normalized for clean reverse lookups
export const clientUsers = sqliteTable("client_users", {
	clientName: text("client_name").notNull().references(() => clients.name, { onDelete: "cascade" }),
	username:   text("username").notNull().references(() => accounts.username, { onDelete: "cascade" }),
}, (t) => [
	primaryKey({ columns: [t.clientName, t.username] }),
]);

// Global config (clientName = "") and per-client config (clientName = "bathroom" etc.)
// Replaces configs/users/{username}.json and configs/{client}/users/{username}.json
export const userConfigs = sqliteTable("user_configs", {
	username:   text("username").notNull().references(() => accounts.username, { onDelete: "cascade" }),
	clientName: text("client_name").notNull().default(""),  // "" = global config
	modules:    text("modules").notNull().default("[]"),    // JSON: ModuleDefinition[] (used when layout is null)
	layout:     text("layout"),                             // JSON: ClientLayout | null (paged user config)
}, (t) => [
	primaryKey({ columns: [t.username, t.clientName] }),
]);
