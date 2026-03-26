import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { buildDocsTree } from "../core/docs/tree.js";
import { normalizeDocPath, resolveSafeDocPath } from "../core/docs/paths.js";
import { parseCookies, isSessionTokenValid, createSessionToken } from "../core/auth/session.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function formatAddressForLog(address) {
  if (typeof address !== "string" || address.length === 0) {
    return "127.0.0.1";
  }

  if (address.includes(":") && !address.startsWith("[")) {
    return `[${address}]`;
  }

  return address;
}

export function startServer(port = 3000, projectName, options = {}) {
  const envPort = Number.parseInt(process.env.PORT || "", 10);
  const effectivePort = Number.isFinite(port) ? port : Number.isFinite(envPort) ? envPort : 3000;

  const docsDir = path.isAbsolute(projectName)
    ? projectName
    : path.join(__dirname, projectName);

  const isDev = Boolean(options.dev);
  const collapse = Boolean(options.collapse);
  const configuredPassword = typeof options.password === "string" ? options.password : "";
  const frontendDir = options.frontendDir || path.resolve(__dirname, "../frontend");
  const host = typeof options.host === "string" && options.host ? options.host : "127.0.0.1";

  const { app, authEnabled } = createApp({
    docsDir,
    isDev,
    configuredPassword,
    frontendDir,
    curlRouteOptions: options.curlRouteOptions || {},
    docsRouteOptions: options.docsRouteOptions || {},
    features: {
      contentCollapse: collapse,
    },
  });

  const server = app.listen(effectivePort, host, () => {
    const addressInfo = server.address();
    const serverPort = addressInfo && typeof addressInfo === "object" ? addressInfo.port : effectivePort;
    const serverHost =
      addressInfo && typeof addressInfo === "object"
        ? formatAddressForLog(addressInfo.address)
        : formatAddressForLog(host);
    const authLabel = authEnabled ? "password-protected" : "open";
    console.log(
      `Server is running on http://${serverHost}:${serverPort} (${isDev ? "development" : "production"} mode, ${authLabel})`,
    );
  });

  return server;
}

export {
  buildDocsTree,
  normalizeDocPath,
  resolveSafeDocPath,
  parseCookies,
  isSessionTokenValid,
  createSessionToken,
};
