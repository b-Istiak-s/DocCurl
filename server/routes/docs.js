import fs from "node:fs";
import path from "node:path";
import { buildDocsTree } from "../../core/docs/tree.js";

const DOCS_REQUEST_WINDOW_MS = 60 * 1000;
const DOCS_MAX_REQUESTS = 120;

function getDocsClientKey(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function trimRequestTimestamps(timestamps, now, windowMs) {
  return timestamps.filter((timestamp) => now - timestamp < windowMs);
}

function getRetryAfterSeconds(retryAfterMs) {
  return String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
}

function resolveRequestedDocPath(docsDir, rawPath) {
  if (typeof rawPath !== "string") {
    throw new Error("Invalid path");
  }

  const normalizedRelativePath = path.posix.normalize(rawPath.replace(/\\/g, "/").trim());
  if (!normalizedRelativePath || normalizedRelativePath === ".") {
    throw new Error("Invalid path");
  }

  if (
    normalizedRelativePath.startsWith("/") ||
    normalizedRelativePath.startsWith("../") ||
    normalizedRelativePath.includes("/../")
  ) {
    throw new Error("Invalid path");
  }

  if (!normalizedRelativePath.endsWith(".md")) {
    throw new Error("Only markdown files are supported");
  }

  const docsRoot = path.resolve(docsDir);
  const resolvedFilePath = path.resolve(docsRoot, normalizedRelativePath);

  if (
    resolvedFilePath !== docsRoot &&
    !resolvedFilePath.startsWith(`${docsRoot}${path.sep}`)
  ) {
    throw new Error("Path traversal is not allowed");
  }

  return {
    relativePath: normalizedRelativePath,
    filePath: resolvedFilePath,
  };
}

export function createDocsRateLimiter({
  now = () => Date.now(),
  maxRequests = DOCS_MAX_REQUESTS,
  windowMs = DOCS_REQUEST_WINDOW_MS,
  cleanupIntervalMs = windowMs,
  stateStore = new Map(),
} = {}) {
  const requestTimestampsByClientKey = stateStore;

  function readTimestamps(clientKey) {
    const currentTime = now();
    const timestamps = trimRequestTimestamps(
      requestTimestampsByClientKey.get(clientKey) || [],
      currentTime,
      windowMs,
    );

    if (timestamps.length === 0) {
      requestTimestampsByClientKey.delete(clientKey);
    } else {
      requestTimestampsByClientKey.set(clientKey, timestamps);
    }

    return { now: currentTime, timestamps };
  }

  function sweepExpiredStates(currentTime = now()) {
    for (const [clientKey, timestamps] of requestTimestampsByClientKey.entries()) {
      const nextTimestamps = trimRequestTimestamps(timestamps, currentTime, windowMs);
      if (nextTimestamps.length === 0) {
        requestTimestampsByClientKey.delete(clientKey);
        continue;
      }
      requestTimestampsByClientKey.set(clientKey, nextTimestamps);
    }
  }

  const shouldSweep =
    Number.isFinite(cleanupIntervalMs) && cleanupIntervalMs > 0;
  const cleanupTimer = shouldSweep
    ? setInterval(() => {
        sweepExpiredStates();
      }, cleanupIntervalMs)
    : null;
  cleanupTimer?.unref?.();

  return {
    consume(clientKey) {
      const { now: currentTime, timestamps } = readTimestamps(clientKey);
      if (timestamps.length >= maxRequests) {
        const retryAfterMs = Math.max(1, windowMs - (currentTime - timestamps[0]));
        return { allowed: false, retryAfterMs };
      }

      timestamps.push(currentTime);
      requestTimestampsByClientKey.set(clientKey, timestamps);
      return { allowed: true, retryAfterMs: 0 };
    },
    dispose() {
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
      }
    },
  };
}

export function registerDocsRoutes(
  app,
  {
    docsDir,
    markdownRenderer,
    fsReadFile = fs.readFile,
    logger = console,
    docsRateLimiter = createDocsRateLimiter(),
    getClientKey = getDocsClientKey,
  },
) {
  const docsRateLimitMiddleware = (req, res, next) => {
    const { allowed, retryAfterMs } = docsRateLimiter.consume(getClientKey(req));
    if (!allowed) {
      res.setHeader("Retry-After", getRetryAfterSeconds(retryAfterMs));
      return res.status(429).json({ error: "Too many docs requests. Try again later." });
    }
    return next();
  };

  app.get("/api/docs/tree", docsRateLimitMiddleware, (_req, res) => {
    const tree = buildDocsTree(docsDir);
    res.json({ tree });
  });

  app.get("/api/docs/content", docsRateLimitMiddleware, (req, res) => {
    try {
      const { relativePath, filePath } = resolveRequestedDocPath(
        docsDir,
        req.query.path,
      );

      fsReadFile(filePath, "utf8", (error, data) => {
        if (error) {
          if (error.code === "ENOENT") {
            return res.status(404).json({ error: "File not found" });
          }

          logger.error("Unable to read document", {
            path: filePath,
            code: error.code || "UNKNOWN",
            error,
          });
          return res.status(500).json({ error: "Unable to read document" });
        }

        const html = markdownRenderer.render(data);
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

  return () => {
    docsRateLimiter.dispose?.();
  };
}
