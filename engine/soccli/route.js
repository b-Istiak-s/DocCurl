import { spawn } from "node:child_process";
import { LIMITS, NODOCKER_MARKER_PATH } from "../curl/constants.js";
import { createNoDockerEnsurer, defaultRuntimeResolver } from "../curl/runtime.js";
import { parseSoccliCommand } from "./command.js";

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
  const soccliImage = options.soccliImage || "docker.io/billyistiak/soccli:latest";
  const spawnImpl = options.spawnImpl || spawn;
  const soccliSocketTimeoutMs = Number.isFinite(options.soccliSocketTimeoutMs)
    ? options.soccliSocketTimeoutMs
    : 60_000;

  let runtimePromise = null;
  let activeSoccliRun = null;

  async function getContainerRuntime() {
    if (runtimeOverride) {
      return runtimeOverride;
    }

    if (!runtimePromise) {
      runtimePromise = runtimeResolver();
    }

    return runtimePromise;
  }

  function stopActiveSoccliRun() {
    if (!activeSoccliRun?.child || activeSoccliRun.child.killed) {
      return;
    }

    const { child } = activeSoccliRun;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 300);
  }

  app.post("/api/run-soccli", async (req, res) => {
    const command = typeof req.body?.command === "string" ? req.body.command : "";

    let soccliArgs;
    try {
      soccliArgs = parseSoccliCommand(command);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    let containerRuntime;
    try {
      containerRuntime = await getContainerRuntime();
      await ensureNoDockerMarker(containerRuntime);
    } catch {
      return res.status(500).json({ error: "Execution failed" });
    }

    stopActiveSoccliRun();

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
        "--network=bridge",
        "--tmpfs=/tmp:rw,noexec,nosuid,size=16m",
        "--user=65534:65534",
        soccliImage,
        ...soccliArgs,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    activeSoccliRun = { child };
    const outputCollector = createOutputCollector();
    let hasOpenedStream = false;

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

    if (soccliSocketTimeoutMs !== null && soccliSocketTimeoutMs > 0) {
      res.setTimeout(soccliSocketTimeoutMs, () => {
        if (!child.killed) {
          child.kill("SIGTERM");
        }

        if (res.headersSent) {
          if (!res.writableEnded) {
            res.write("\n[soccli] Session timed out\n");
            res.end();
          }
          return;
        }

        res.status(408).json({ error: "Soccli session timed out" });
      });
    }

    const closeActiveRun = () => {
      if (activeSoccliRun?.child === child) {
        activeSoccliRun = null;
      }
    };

    req.on("close", () => {
      if (!res.writableEnded && !child.killed) {
        child.kill("SIGTERM");
      }
    });

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

      if (res.headersSent) {
        if (!res.writableEnded) {
          if (signal === "SIGTERM" || signal === "SIGKILL") {
            res.write("\n[soccli] Session replaced by a new run\n");
          } else if (code !== 0) {
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

      if (signal === "SIGTERM" || signal === "SIGKILL") {
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
