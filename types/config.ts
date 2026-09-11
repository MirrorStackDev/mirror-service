export type UserSwitchMode = "DELETE" | "SAVE";

export type LogLevel = "INFO" | "LOG" | "WARN" | "ERROR" | "DEBUG";

export interface HttpHeaders {
	contentSecurityPolicy: boolean | { directives: Record<string, string[]> };
	crossOriginOpenerPolicy: boolean;
	crossOriginEmbedderPolicy: boolean;
	crossOriginResourcePolicy: boolean;
	originAgentCluster: boolean;
}

export interface ServerConfig {
	address: string;
	port: number | string;
	ipWhitelist: string[];
	ipBlackList: string[];
	https: boolean;
	httpsPrivateKey?: string;
	httpsCertificate?: string;
	httpHeaders: HttpHeaders;
	checkServerInterval: number;
	userSwitchMode: UserSwitchMode;
	logLevel: LogLevel[];
	reloadAfterServerRestart: boolean;
	language: string;
	timeFormat: 12 | 24;
	units: "metric" | "imperial";
	zoom: number;
	customCss: string;
	rootConf: string;
	clientConfigs: string[];
	rootDir?: string;
}

export interface ElectronConfig {
	address: string;
	port: number;
	clientName: string;
	gpu: boolean;
	zoom: number;
	https: boolean;
	electronSwitches?: string[];
	electronOptions?: Record<string, unknown>;
	ignoreXOriginHeader?: boolean;
	ignoreContentSecurityPolicy?: boolean;
}
