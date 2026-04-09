import { spawn } from "node:child_process";
import { LIMITS, NODOCKER_MARKER_PATH } from "../curl/constants.js";
import {
  createNoDockerEnsurer,
  defaultRuntimeResolver,
} from "../curl/runtime.js";
import {
  defaultDnsLookup,
  isLocalDevTarget,
  validateTargetUrl,
} from "../curl/network.js";
import { parseSoccliCommand } from "./command.js";

const ALLOWED_SOCCLI_PROTOCOLS = new Set([
  "raw",
  "pusher",
  "socketio",
  "graphql",
  "jsonrpc",
  "json-rpc",
  "stomp",
  "signalr",
  "mqtt",
  "wamp",
]);

function createOutputCollector(limitBytes = LIMITS.maxOutputBytes) {
  let output = "";
  let overflowed = false;

  return {
    append(chunk) {
      if (overflowed) {
        return;
      }
      output += String(chunk ?? "");
      if (output.length > limitBytes) {
        output = output.slice(0, limitBytes);
        overflowed = true;
      }
    },
    value() {
      return output;
    },
  };
}

function normalizeSoccliUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  if (value.startsWith("wss://")) {
    return `https://${value.slice("wss://".length)}`;
  }
  if (value.startsWith("ws://")) {
    return `http://${value.slice("ws://".length)}`;
  }

  return value;
}

function extractSoccliTargetUrl(soccliArgs) {
  for (const token of soccliArgs.slice(1)) {
    if (/^(wss?|https?):\/\//i.test(token)) {
      return normalizeSoccliUrl(token);
    }
  }

  const hostIndex = soccliArgs.indexOf("--host");
  if (hostIndex === -1 || !soccliArgs[hostIndex + 1]) {
    return "";
  }

  const host = soccliArgs[hostIndex + 1];
  const portIndex = soccliArgs.indexOf("--port");
  const pathIndex = soccliArgs.indexOf("--path");
  const secure = soccliArgs.includes("--secure");
  const protocol = secure ? "https" : "http";
  const port =
    portIndex !== -1 && soccliArgs[portIndex + 1]
      ? `:${soccliArgs[portIndex + 1]}`
      : "";
  const path =
    pathIndex !== -1 && soccliArgs[pathIndex + 1]
      ? soccliArgs[pathIndex + 1]
      : "/";

  return `${protocol}://${host}${port}${path}`;
}

function resolveRunScopeKey(req) {
  const explicitRunScope =
    typeof req.body?.runScope === "string" ? req.body.runScope.trim() : "";
  if (explicitRunScope) {
    return `scope:${explicitRunScope}`;
  }

  const cookieHeader =
    typeof req.headers?.cookie === "string" ? req.headers.cookie.trim() : "";
  if (cookieHeader) {
    return `cookie:${cookieHeader}`;
  }

  return `ip:${req.ip || "unknown"}`;
}

function terminateChildWithDeadline(
  child,
  { sigtermDelayMs = 0, sigkillDelayMs = 300 } = {},
) {
  if (!child) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let exited = false;
    let termTimer = null;
    let killTimer = null;
    let forceResolveTimer = null;

    const cleanup = () => {
      if (termTimer) {
        clearTimeout(termTimer);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
      if (forceResolveTimer) {
        clearTimeout(forceResolveTimer);
      }
      child.off("exit", onExit);
      child.off("error", onExit);
    };

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const onExit = () => {
      exited = true;
      finish();
    };

    const sendSigterm = () => {
      if (exited) {
        finish();
        return;
      }
      try {
        child.kill("SIGTERM");
      } catch {
        finish();
        return;
      }

      killTimer = setTimeout(() => {
        if (exited) {
          return;
        }

        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }

        forceResolveTimer = setTimeout(() => {
          finish();
        }, 50);
      }, sigkillDelayMs);
    };

    child.once("exit", onExit);
    child.once("error", onExit);

    termTimer = setTimeout(sendSigterm, sigtermDelayMs);
  });
}

export function setupSoccliRoutes(app, options = {}) {
  const logger = options.logger || console;
  const runtimeResolver =
    options.runtimeResolver ||
    (() => defaultRuntimeResolver(options.runtimeExecFile));
  const ensureNoDockerMarker =
    options.ensureNoDockerMarker ||
    createNoDockerEnsurer({
      markerPath: options.noDockerMarkerPath || NODOCKER_MARKER_PATH,
      fsAccess: options.fsAccess,
      fsWriteFile: options.fsWriteFile,
      logger,
    });
  const runtimeOverride = options.containerRuntime;
  const soccliImage =
    options.soccliImage || "docker.io/billyistiak/soccli:latest";
  const spawnImpl = options.spawnImpl || spawn;
  const soccliSocketTimeoutMs =
    options.soccliSocketTimeoutMs ||
    options.requestTimeoutMs ||
    LIMITS.requestTimeoutMs;
  const isDev = Boolean(options.isDev);
  const dnsLookup = options.dnsLookup || defaultDnsLookup;

  const runtimePromisesByScope = new Map();
  const activeSoccliRuns = new Map();

  async function getContainerRuntime(scopeKey) {
    if (runtimeOverride) {
      return runtimeOverride;
    }

    if (!runtimePromisesByScope.has(scopeKey)) {
      runtimePromisesByScope.set(scopeKey, runtimeResolver());
    }

    return runtimePromisesByScope.get(scopeKey);
  }

  async function stopActiveSoccliRun(scopeKey) {
    const activeRun = activeSoccliRuns.get(scopeKey);
    if (!activeRun?.child) {
      return;
    }

    if (typeof activeRun.terminate === "function") {
      await activeRun.terminate("replaced");
      return;
    }

    await terminateChildWithDeadline(activeRun.child, {
      sigtermDelayMs: 0,
      sigkillDelayMs: 300,
    });
  }

  app.post("/api/run-soccli", async (req, res) => {
    const command =
      typeof req.body?.command === "string" ? req.body.command : "";
    const scopeKey = resolveRunScopeKey(req);

    let soccliArgs;
    try {
      soccliArgs = parseSoccliCommand(command);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const protocolCommand = soccliArgs[0];
    if (!ALLOWED_SOCCLI_PROTOCOLS.has(protocolCommand)) {
      return res
        .status(400)
        .json({ error: `Unsupported soccli protocol: ${protocolCommand}` });
    }

    const targetUrl = extractSoccliTargetUrl(soccliArgs);
    if (!targetUrl) {
      return res
        .status(400)
        .json({ error: "Soccli command must include a destination URL/host" });
    }

    const urlError = await validateTargetUrl(targetUrl, {
      isDev,
      dnsLookup,
    });
    if (urlError) {
      return res.status(400).json({ error: urlError });
    }

    let containerRuntime;
    try {
      containerRuntime = await getContainerRuntime(scopeKey);
      await ensureNoDockerMarker(containerRuntime);
    } catch {
      return res.status(500).json({ error: "Execution failed" });
    }

    await stopActiveSoccliRun(scopeKey);

    const networkMode =
      isDev && isLocalDevTarget(targetUrl) ? "host" : "bridge";

    const child = spawnImpl(
      containerRuntime,
      [
        "run",
        "--rm",
        "-i",
        "-t",
        "--memory=128m",
        "--cpus=0.5",
        "--pids-limit=64",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        `--network=${networkMode}`,
        "--tmpfs=/tmp:rw,noexec,nosuid,size=16m",
        "--user=65534:65534",
        soccliImage,
        ...soccliArgs,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const outputCollector = createOutputCollector();
    let hasOpenedStream = false;
    let terminationReason = null;
    let terminationPromise = null;

    const markTerminationReason = (reason) => {
      if (!terminationReason) {
        terminationReason = reason;
      }
    };

    const terminateRun = (reason) => {
      markTerminationReason(reason);
      if (!terminationPromise) {
        terminationPromise = terminateChildWithDeadline(child, {
          sigtermDelayMs: 0,
          sigkillDelayMs: 300,
        });
      }
      return terminationPromise;
    };

    activeSoccliRuns.set(scopeKey, { child, terminate: terminateRun });

    const openStream = () => {
      if (hasOpenedStream || res.headersSent) {
        return;
      }
      hasOpenedStream = true;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
    };

    const streamChunk = (chunk) => {
      outputCollector.append(chunk);
      openStream();
      if (!res.writableEnded) {
        res.write(String(chunk ?? ""));
      }
    };

    child.stdout.on("data", streamChunk);
    child.stderr.on("data", streamChunk);

    const timeoutHandle = setTimeout(async () => {
      await terminateRun("timeout");

      if (res.headersSent) {
        if (!res.writableEnded) {
          res.write("\n[soccli] Session timed out\n");
          res.end();
        }
        return;
      }

      res.status(408).json({ error: "Soccli session timed out" });
    }, soccliSocketTimeoutMs);

    const handleClientDisconnect = () => {
      if (res.writableEnded) {
        return;
      }
      void terminateRun("disconnect");
    };

    const closeActiveRun = () => {
      clearTimeout(timeoutHandle);
      if (activeSoccliRuns.get(scopeKey)?.child === child) {
        activeSoccliRuns.delete(scopeKey);
      }
    };

    req.once("aborted", handleClientDisconnect);
    res.once("close", handleClientDisconnect);

    child.on("error", () => {
      closeActiveRun();
      if (!res.headersSent) {
        res.status(500).json({ error: "Execution failed" });
        return;
      }
      if (!res.writableEnded) {
        res.write("\n[soccli] Execution failed\n");
        res.end();
      }
    });

    child.on("close", (code, signal) => {
      closeActiveRun();

      if (
        terminationReason === "disconnect" ||
        terminationReason === "timeout"
      ) {
        return;
      }

      if (res.headersSent) {
        if (!res.writableEnded) {
          if (terminationReason === "replaced") {
            res.write("\n[soccli] Session replaced by a new run\n");
          } else if (code !== 0 || signal) {
            const message = outputCollector.value() || "Execution failed";
            res.write(`\n[soccli] ${message}\n`);
          }
          res.end();
        }
        return;
      }

      if (code === 0) {
        return res.json({ success: true, output: outputCollector.value() });
      }

      if (terminationReason === "replaced") {
        return res
          .status(409)
          .json({ error: "Previous soccli session replaced by a new run" });
      }

      return res.status(500).json({
        error: outputCollector.value() || "Execution failed",
      });
    });
  });
}
