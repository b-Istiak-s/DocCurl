import { isPasswordValid } from "../../core/auth/password.js";
import {
  buildSessionCookie,
  clearSessionCookie,
  createSessionToken,
} from "../../core/auth/session.js";

export function registerAuthRoutes(
  app,
  {
    authEnabled,
    isAuthenticated,
    configuredPassword,
    sessionSecret,
    features = {},
  },
) {
  app.get("/api/auth/status", (req, res) => {
    res.json({
      authEnabled,
      authenticated: isAuthenticated(req),
      features: {
        contentCollapse: Boolean(features.contentCollapse),
      },
    });
  });

  app.post("/api/auth/login", (req, res) => {
    if (!authEnabled) {
      return res.json({ success: true, authEnabled: false, authenticated: true });
    }

    const password = req.body && typeof req.body.password === "string" ? req.body.password : "";

    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    if (!isPasswordValid(password, configuredPassword)) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const sessionToken = createSessionToken(sessionSecret);
    res.setHeader("Set-Cookie", buildSessionCookie(sessionToken));
    return res.json({ success: true, authEnabled: true, authenticated: true });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.json({ success: true });
  });
}
