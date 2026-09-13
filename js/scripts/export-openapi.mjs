import fs from "node:fs";
import path from "node:path";
import swaggerJsdoc from "swagger-jsdoc";

const spec = swaggerJsdoc({
	definition: {
		openapi: "3.0.0",
		info: {
			title: "MirrorStack API",
			version: "1.0.0",
			description: "HTTP API for the MirrorStack smart mirror platform",
		},
		components: {
			securitySchemes: {
				cookie: { type: "apiKey", in: "cookie", name: "authToken" },
			},
			schemas: {
				Error: { type: "object", properties: { error: { type: "string" } }, required: ["error"] },
				Ok: { type: "object", properties: { ok: { type: "boolean", example: true } }, required: ["ok"] },
				Session: {
					type: "object",
					properties: {
						username: { type: "string" }, displayName: { type: "string" },
						role: { type: "string", enum: ["admin", "user"] }, token: { type: "string" },
					},
					required: ["username", "displayName", "role", "token"],
				},
				Account: {
					type: "object",
					properties: {
						username: { type: "string" }, displayName: { type: "string" },
						role: { type: "string", enum: ["admin", "user"] },
					},
					required: ["username", "displayName", "role"],
				},
				ModuleDefinition: {
					type: "object",
					properties: {
						module: { type: "string", example: "clock" }, position: { type: "string" },
						classes: { type: "string" }, header: { type: "string" },
						hiddenOnStartup: { type: "boolean" }, config: { type: "object", additionalProperties: true },
					},
					required: ["module"],
				},
				Page: {
					type: "object",
					properties: {
						name: { type: "string" }, rotationMs: { type: "integer" },
						modules: { type: "array", items: { $ref: "#/components/schemas/ModuleDefinition" } },
					},
					required: ["modules"],
				},
				ClientLayout: {
					type: "object",
					properties: {
						pages: { type: "array", items: { $ref: "#/components/schemas/Page" } },
						fixed: { type: "array", items: { $ref: "#/components/schemas/ModuleDefinition" } },
						homePage: { type: "integer" }, rotationMs: { type: "integer" },
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
						name: { type: "string" }, type: { type: "string", enum: ["mirror", "dashboard"] },
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

const outDir = path.resolve("docs");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "openapi.json"), JSON.stringify(spec, null, 2));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>MirrorStack API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: "./openapi.json", dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset] });
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(outDir, "api.html"), html);
console.log("Exported docs/openapi.json and docs/api.html");
