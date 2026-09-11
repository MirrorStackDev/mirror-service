import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import type { Application } from "express";

const spec = swaggerJsdoc({
	definition: {
		openapi: "3.0.0",
		info: {
			title: "HA-Mirrors API",
			version: "1.0.0",
			description: "HTTP API for the HA-Mirrors smart mirror platform",
		},
		components: {
			securitySchemes: {
				cookie: { type: "apiKey", in: "cookie", name: "authToken" },
			},
			schemas: {
				Error: {
					type: "object",
					properties: { error: { type: "string" } },
					required: ["error"],
				},
				Ok: {
					type: "object",
					properties: { ok: { type: "boolean", example: true } },
					required: ["ok"],
				},
				Session: {
					type: "object",
					properties: {
						username: { type: "string" },
						displayName: { type: "string" },
						role: { type: "string", enum: ["admin", "user"] },
						token: { type: "string" },
					},
					required: ["username", "displayName", "role", "token"],
				},
				Account: {
					type: "object",
					properties: {
						username: { type: "string" },
						displayName: { type: "string" },
						role: { type: "string", enum: ["admin", "user"] },
					},
					required: ["username", "displayName", "role"],
				},
				ModuleDefinition: {
					type: "object",
					properties: {
						module: { type: "string", example: "clock" },
						position: { type: "string", example: "top_left" },
						classes: { type: "string" },
						header: { type: "string" },
						hiddenOnStartup: { type: "boolean" },
						config: { type: "object", additionalProperties: true },
					},
					required: ["module"],
				},
				Page: {
					type: "object",
					properties: {
						name: { type: "string" },
						rotationMs: { type: "integer" },
						modules: { type: "array", items: { $ref: "#/components/schemas/ModuleDefinition" } },
					},
					required: ["modules"],
				},
				ClientLayout: {
					type: "object",
					properties: {
						pages: { type: "array", items: { $ref: "#/components/schemas/Page" } },
						fixed: { type: "array", items: { $ref: "#/components/schemas/ModuleDefinition" } },
						homePage: { type: "integer" },
						rotationMs: { type: "integer" },
					},
					required: ["pages", "fixed"],
				},
				UserConfig: {
					type: "object",
					properties: {
						name: { type: "string" },
						modules: { type: "array", items: { $ref: "#/components/schemas/ModuleDefinition" } },
						layout: { $ref: "#/components/schemas/ClientLayout" },
					},
					required: ["name", "modules"],
				},
				ClientInfo: {
					type: "object",
					properties: {
						name: { type: "string" },
						type: { type: "string", enum: ["mirror", "dashboard"] },
						userSwitchMode: { type: "string", enum: ["SAVE", "DELETE"] },
						defaultModules: { type: "array", items: { $ref: "#/components/schemas/ModuleDefinition" } },
						layout: { oneOf: [{ $ref: "#/components/schemas/ClientLayout" }, { type: "null" }] },
					},
					required: ["name", "type", "userSwitchMode", "defaultModules", "layout"],
				},
			},
		},
	},
	apis: ["./js/routes/auth.ts", "./js/routes/user.ts", "./js/routes/admin.ts"],
});

export function registerDocsRoute(app: Application): void {
	app.use("/docs", swaggerUi.serve, swaggerUi.setup(spec));
}
