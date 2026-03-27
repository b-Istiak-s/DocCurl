import { isPasswordValid } from "../../core/auth/password.js";
import {
  buildSessionCookie,
  clearSessionCookie,
  createSessionToken,
} from "../../core/auth/session.js";

const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

function getLoginClientKey(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function trimFailureTimestamps(timestamps, now, windowMs) {
  return timestamps.filter((timestamp) => now - timestamp < windowMs);
}

function getRetryAfterSeconds(retryAfterMs) {
  return String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
}

export function createLoginRateLimiter({
  now = () => Date.now(),
  maxFailures = LOGIN_MAX_FAILURES,
  windowMs = LOGIN_FAILURE_WINDOW_MS,
  lockoutMs = LOGIN_LOCKOUT_MS,
  cleanupIntervalMs = Math.min(windowMs, lockoutMs),
  stateStore = new Map(),
} = {}) {
  const stateByClientKey = stateStore;

  function normalizeState(existingState, currentTime) {
    const currentState = existingState || {
      blockedUntil: 0,
      failureTimestamps: [],
    };

    return {
      blockedUntil: currentState.blockedUntil > currentTime ? currentState.blockedUntil : 0,
      failureTimestamps: trimFailureTimestamps(
        currentState.failureTimestamps,
        currentTime,
        windowMs,
      ),
    };
  }

  function sweepExpiredStates(currentTime = now()) {
    for (const [clientKey, existingState] of stateByClientKey.entries()) {
      const nextState = normalizeState(existingState, currentTime);
      if (nextState.blockedUntil === 0 && nextState.failureTimestamps.length === 0) {
        stateByClientKey.delete(clientKey);
        continue;
      }
      stateByClientKey.set(clientKey, nextState);
    }
  }

  function readState(clientKey) {
    const currentTime = now();
    const nextState = normalizeState(stateByClientKey.get(clientKey), currentTime);

    if (nextState.blockedUntil === 0 && nextState.failureTimestamps.length === 0) {
      stateByClientKey.delete(clientKey);
      return { now: currentTime, state: nextState };
    }

    stateByClientKey.set(clientKey, nextState);
    return { now: currentTime, state: nextState };
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
    getRetryAfterMs(clientKey) {
      const { now: currentTime, state } = readState(clientKey);
      if (state.blockedUntil <= currentTime) {
        return 0;
      }
      return state.blockedUntil - currentTime;
    },
    recordFailure(clientKey) {
      const { now: currentTime, state } = readState(clientKey);
      state.failureTimestamps.push(currentTime);
      state.failureTimestamps = trimFailureTimestamps(
        state.failureTimestamps,
        currentTime,
        windowMs,
      );

      if (state.failureTimestamps.length >= maxFailures) {
        state.blockedUntil = currentTime + lockoutMs;
        state.failureTimestamps = [];
      }

      stateByClientKey.set(clientKey, state);
      return state.blockedUntil > currentTime ? state.blockedUntil - currentTime : 0;
    },
    reset(clientKey) {
      stateByClientKey.delete(clientKey);
    },
    dispose() {
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
      }
    },
  };
}

export function registerAuthRoutes(
  app,
  {
    authEnabled,
    isAuthenticated,
    configuredPassword,
    sessionSecret,
    secureSessionCookie = false,
    features = {},
    loginRateLimiter = createLoginRateLimiter(),
    getClientKey = getLoginClientKey,
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

    const clientKey = getClientKey(req);
    const retryAfterMs = loginRateLimiter.getRetryAfterMs(clientKey);
    if (retryAfterMs > 0) {
      res.setHeader("Retry-After", getRetryAfterSeconds(retryAfterMs));
      return res.status(429).json({ error: "Too many login attempts. Try again later." });
    }

    const password = req.body && typeof req.body.password === "string" ? req.body.password : "";

    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    if (!isPasswordValid(password, configuredPassword)) {
      const nextRetryAfterMs = loginRateLimiter.recordFailure(clientKey);
      if (nextRetryAfterMs > 0) {
        res.setHeader("Retry-After", getRetryAfterSeconds(nextRetryAfterMs));
        return res.status(429).json({ error: "Too many login attempts. Try again later." });
      }
      return res.status(401).json({ error: "Invalid password" });
    }

    loginRateLimiter.reset(clientKey);
    const sessionToken = createSessionToken(sessionSecret);
    res.setHeader("Set-Cookie", buildSessionCookie(sessionToken, { secure: secureSessionCookie }));
    return res.json({ success: true, authEnabled: true, authenticated: true });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.setHeader("Set-Cookie", clearSessionCookie({ secure: secureSessionCookie }));
    res.json({ success: true });
  });

  return () => {
    loginRateLimiter.dispose?.();
  };
}
