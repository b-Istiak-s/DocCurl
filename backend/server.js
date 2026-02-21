const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");
const MarkdownIt = require("markdown-it");
const setupCurlRoutes = require("./curl-runner");

const SESSION_COOKIE_NAME = "doccurl_session";
const SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function hashPassword(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest();
}

function isPasswordValid(inputPassword, expectedPassword) {
  const inputHash = hashPassword(inputPassword);
  const expectedHash = hashPassword(expectedPassword);
  return crypto.timingSafeEqual(inputHash, expectedHash);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) {
    return cookies;
  }

  const parts = String(cookieHeader).split(";");
  for (const part of parts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex < 0) {
      continue;
    }
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function buildSessionSignature(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function createSessionToken(secret, now = Date.now()) {
  const issuedAt = now;
  const expiresAt = now + SESSION_TTL_MS;
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${issuedAt}.${expiresAt}.${nonce}`;
  const signature = buildSessionSignature(payload, secret);
  return `${payload}.${signature}`;
}

function isSessionTokenValid(token, secret, now = Date.now()) {
  if (typeof token !== "string" || !token) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const issuedAt = Number(parts[0]);
  const expiresAt = Number(parts[1]);
  const nonce = parts[2];
  const signature = parts[3];

  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt <= 0 ||
    expiresAt <= issuedAt ||
    !nonce ||
    !signature
  ) {
    return false;
  }

  if (expiresAt < now) {
    return false;
  }

  const payload = `${issuedAt}.${expiresAt}.${nonce}`;
  const expectedSignature = buildSessionSignature(payload, secret);
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

function buildSessionCookie(token) {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}

function sortNodes(nodes) {
  return nodes.sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    return a.type === "dir" ? -1 : 1;
  });
}

function buildDocsTree(docsDir, relativeDir = "") {
  const absoluteDir = relativeDir
    ? path.join(docsDir, relativeDir)
    : docsDir;

  let entries;
  try {
    entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes = [];

  for (const entry of entries) {
    const relativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      const children = buildDocsTree(docsDir, relativePath);
      if (children.length > 0) {
        nodes.push({
          type: "dir",
          name: entry.name,
          path: relativePath,
          children,
        });
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      nodes.push({
        type: "file",
        name: entry.name,
        path: relativePath,
      });
    }
  }

  return sortNodes(nodes);
}

function normalizeDocPath(rawPath) {
  if (typeof rawPath !== "string") {
    throw new Error("Invalid path");
  }

  const normalized = path.posix.normalize(rawPath.replace(/\\/g, "/").trim());
  if (!normalized || normalized === ".") {
    throw new Error("Invalid path");
  }

  if (
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Invalid path");
  }

  if (!normalized.endsWith(".md")) {
    throw new Error("Only markdown files are supported");
  }

  return normalized;
}

function resolveSafeDocPath(docsDir, relativePath) {
  const docsRoot = path.resolve(docsDir);
  const targetPath = path.resolve(docsRoot, relativePath);

  if (targetPath !== docsRoot && !targetPath.startsWith(`${docsRoot}${path.sep}`)) {
    throw new Error("Path traversal is not allowed");
  }

  return targetPath;
}

function startServer(port = 3000, projectName, options = {}) {
  const app = express();
  const envPort = Number.parseInt(process.env.PORT || "", 10);
  const PORT = Number.isFinite(port)
    ? port
    : Number.isFinite(envPort)
      ? envPort
      : 3000;
  const md = new MarkdownIt();

  const docsDir = path.isAbsolute(projectName)
    ? projectName
    : path.join(__dirname, projectName);

  const isDev = Boolean(options.dev);
  const configuredPassword =
    typeof options.password === "string" ? options.password : "";
  const authEnabled = isDev ? configuredPassword.length > 0 : true;

  if (!isDev && configuredPassword.length === 0) {
    throw new Error("Production mode requires --password");
  }

  const sessionSecret = crypto.randomBytes(32);

  function isAuthenticated(req) {
    if (!authEnabled) {
      return true;
    }

    const cookies = parseCookies(req.headers.cookie || "");
    const sessionToken = cookies[SESSION_COOKIE_NAME];
    return isSessionTokenValid(sessionToken, sessionSecret);
  }

  app.use(express.json({ limit: "128kb" }));
  app.use(express.static(path.join(__dirname, "../frontend")));

  app.get("/api/auth/status", (req, res) => {
    res.json({
      authEnabled,
      authenticated: isAuthenticated(req),
    });
  });

  app.post("/api/auth/login", (req, res) => {
    if (!authEnabled) {
      return res.json({ success: true, authEnabled: false, authenticated: true });
    }

    const password = req.body && typeof req.body.password === "string"
      ? req.body.password
      : "";

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

  if (authEnabled) {
    app.use("/api", (req, res, next) => {
      if (req.path === "/auth/status" || req.path === "/auth/login" || req.path === "/auth/logout") {
        return next();
      }

      if (!isAuthenticated(req)) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      return next();
    });
  }

  setupCurlRoutes(app, { isDev });

  app.get("/api/docs/tree", (_req, res) => {
    const tree = buildDocsTree(docsDir);
    res.json({ tree });
  });

  app.get("/api/docs/content", (req, res) => {
    try {
      const relativePath = normalizeDocPath(req.query.path);
      const filePath = resolveSafeDocPath(docsDir, relativePath);

      fs.readFile(filePath, "utf8", (err, data) => {
        if (err) {
          return res.status(404).json({ error: "File not found" });
        }

        const html = md.render(data);
        return res.json({
          path: relativePath,
          filename: path.basename(relativePath),
          html,
          markdown: data,
        });
      });
    } catch (error) {
      return res.status(400).json({ error: error.message || "Invalid path" });
    }
  });

  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/index.html"));
  });

  const server = app.listen(PORT, () => {
    const addressInfo = server.address();
    const effectivePort =
      addressInfo && typeof addressInfo === "object" ? addressInfo.port : PORT;
    const authLabel = authEnabled ? "password-protected" : "open";
    console.log(
      `Server is running on http://localhost:${effectivePort} (${isDev ? "development" : "production"} mode, ${authLabel})`,
    );
  });

  return server;
}

module.exports = {
  startServer,
  // exported for tests
  buildDocsTree,
  normalizeDocPath,
  resolveSafeDocPath,
  parseCookies,
  isSessionTokenValid,
  createSessionToken,
};
