import crypto from "node:crypto";
import express from "express";
import path from "node:path";
import MarkdownIt from "markdown-it";
import { parseCookies, SESSION_COOKIE_NAME, isSessionTokenValid } from "../core/auth/session.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDocsRoutes } from "./routes/docs.js";
import { registerCurlRoutes } from "./routes/curl.js";
import { createAuthRequiredMiddleware } from "./middleware/auth-required.js";

export function createApp({
  docsDir,
  isDev = false,
  trustProxy = false,
  configuredPassword = "",
  frontendDir,
  authRouteOptions = {},
  curlRouteOptions = {},
  docsRouteOptions = {},
  features = {},
}) {
  const authEnabled = isDev ? configuredPassword.length > 0 : true;
  if (!isDev && configuredPassword.length === 0) {
    throw new Error("Production mode requires --password");
  }

  const app = express();
  const markdownRenderer = new MarkdownIt();
  const sessionSecret = crypto.randomBytes(32);

  app.set("trust proxy", trustProxy);

  function isAuthenticated(req) {
    if (!authEnabled) {
      return true;
    }

    const cookies = parseCookies(req.headers.cookie || "");
    const sessionToken = cookies[SESSION_COOKIE_NAME];
    return isSessionTokenValid(sessionToken, sessionSecret);
  }

  app.use(express.json({ limit: "128kb" }));
  app.use(express.static(frontendDir));

  registerAuthRoutes(app, {
    authEnabled,
    isAuthenticated,
    configuredPassword,
    sessionSecret,
    features,
    ...authRouteOptions,
  });

  app.use("/api", createAuthRequiredMiddleware({ authEnabled, isAuthenticated }));

  registerCurlRoutes(app, {
    isDev,
    ...curlRouteOptions,
  });

  registerDocsRoutes(app, {
    docsDir,
    markdownRenderer,
    ...docsRouteOptions,
  });

  app.get("/", (_req, res) => {
    res.sendFile(path.join(frontendDir, "index.html"));
  });

  return { app, authEnabled };
}
