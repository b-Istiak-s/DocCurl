import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { LIMITS, NODOCKER_MARKER_PATH } from "./constants.js";
import { resolveRequestSpec } from "./parse.js";
import { validateRequestSpec } from "./validate.js";
import { defaultDnsLookup, isLocalDevTarget, validateTargetUrl } from "./network.js";
import { createNoDockerEnsurer, defaultRuntimeResolver } from "./runtime.js";
import { buildCurlArgs } from "./args.js";

export function setupCurlRoutes(app, options = {}) {
  const isDev = Boolean(options.isDev);
  const execFileImpl = options.execFileImpl || execFile;
  const dnsLookup = options.dnsLookup || defaultDnsLookup;
  const containerImage = options.dockerImage || "curlimages/curl";
  const runtimeResolver =
    options.runtimeResolver ||
    (() => defaultRuntimeResolver(options.runtimeExecFile || execFile));
  const ensureNoDockerMarker =
    options.ensureNoDockerMarker ||
    createNoDockerEnsurer({
      markerPath: options.noDockerMarkerPath || NODOCKER_MARKER_PATH,
      fsAccess: options.fsAccess || fs.access,
      fsWriteFile: options.fsWriteFile || fs.writeFile,
      logger: options.logger || console,
    });
  const runtimeOverride = options.containerRuntime;

  let runtimePromise = null;

  async function getContainerRuntime() {
    if (runtimeOverride) {
      return runtimeOverride;
    }

    if (!runtimePromise) {
      runtimePromise = runtimeResolver();
    }
    return runtimePromise;
  }

  app.post("/api/run-curl", async (req, res) => {
    let requestSpec;
    let containerRuntime;
    try {
      requestSpec = resolveRequestSpec(req.body);
      validateRequestSpec(requestSpec);

      const urlError = await validateTargetUrl(requestSpec.url, {
        isDev,
        dnsLookup,
      });
      if (urlError) {
        return res.status(400).json({ error: urlError });
      }

      containerRuntime = await getContainerRuntime();
      await ensureNoDockerMarker(containerRuntime);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const curlArgs = buildCurlArgs(requestSpec);
    const networkMode = isDev && isLocalDevTarget(requestSpec.url) ? "host" : "bridge";

    const containerArgs = [
      "run",
      "--rm",
      "--memory=64m",
      "--cpus=0.5",
      "--pids-limit=64",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      `--network=${networkMode}`,
      "--tmpfs=/tmp:rw,noexec,nosuid,size=16m",
      "--user=65534:65534",
      containerImage,
      ...curlArgs,
    ];

    execFileImpl(
      containerRuntime,
      containerArgs,
      {
        timeout: LIMITS.requestTimeoutMs,
        maxBuffer: LIMITS.maxOutputBytes,
      },
      (error, stdout, stderr) => {
        if (error) {
          return res.status(500).json({
            error: "Execution failed",
            details: stderr || error.message,
          });
        }

        return res.json({
          success: true,
          output: stdout,
        });
      },
    );
  });
}
