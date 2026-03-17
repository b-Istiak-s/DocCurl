import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import {
  CURL_RESPONSE_META_END,
  CURL_RESPONSE_META_START,
  LIMITS,
  NODOCKER_MARKER_PATH,
} from "./constants.js";
import { resolveRequestSpec } from "./parse.js";
import { validateRequestSpec } from "./validate.js";
import { defaultDnsLookup, isLocalDevTarget, validateTargetUrl } from "./network.js";
import { createNoDockerEnsurer, defaultRuntimeResolver } from "./runtime.js";
import { buildCurlArgs } from "./args.js";
import { prepareGeneratedUploads } from "./uploads/files.js";

function parseCurlResponseMetadata(stdout) {
  const text = String(stdout ?? "");
  const startIndex = text.lastIndexOf(CURL_RESPONSE_META_START);
  const endIndex = text.lastIndexOf(CURL_RESPONSE_META_END);

  if (
    startIndex === -1 ||
    endIndex === -1 ||
    endIndex < startIndex + CURL_RESPONSE_META_START.length
  ) {
    return {
      output: text,
      metadata: null,
    };
  }

  const metadataText = text.slice(startIndex + CURL_RESPONSE_META_START.length, endIndex);
  const [statusCodeRaw = "", contentTypeRaw = "", timeTotalRaw = ""] = metadataText.split("\t");

  const statusCode = Number.parseInt(statusCodeRaw, 10);
  const durationSeconds = Number.parseFloat(timeTotalRaw);

  return {
    output: text.slice(0, startIndex),
    metadata: {
      statusCode: Number.isFinite(statusCode) ? statusCode : null,
      contentType: contentTypeRaw || null,
      durationMs: Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null,
    },
  };
}

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
    let uploadSession;
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

      if (requestSpec.formParts.length > 0) {
        uploadSession = await prepareGeneratedUploads(requestSpec.formParts, {
          tmpDir: options.uploadTmpDir,
          mkdtempImpl: options.uploadFsMkdtemp || fs.mkdtemp,
          writeFileImpl: options.uploadFsWriteFile || fs.writeFile,
          chmodImpl: options.uploadFsChmod || fs.chmod,
          rmImpl: options.uploadFsRm || fs.rm,
          logger: options.logger || console,
        });
        requestSpec = {
          ...requestSpec,
          formParts: requestSpec.formParts.map((part) => ({
            ...part,
            filePath: uploadSession.resolveFormFilePath(part),
          })),
        };
      }
    } catch (error) {
      if (uploadSession) {
        await uploadSession.cleanup();
      }
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
      ...(uploadSession?.mountArgs || []),
      containerImage,
      ...curlArgs,
    ];

    const finishWithCleanup = async (sendResponse) => {
      if (uploadSession) {
        await uploadSession.cleanup();
        uploadSession = null;
      }
      return sendResponse();
    };

    try {
      execFileImpl(
        containerRuntime,
        containerArgs,
        {
          timeout: LIMITS.requestTimeoutMs,
          maxBuffer: LIMITS.maxOutputBytes,
        },
        (error, stdout, stderr) => {
          finishWithCleanup(() => {
            if (error) {
              return res.status(500).json({
                error: "Execution failed",
                details: stderr || error.message,
              });
            }

            const result = parseCurlResponseMetadata(stdout);
            return res.json({
              success: true,
              output: result.output,
              metadata: result.metadata,
            });
          });
        },
      );
    } catch (error) {
      await finishWithCleanup(() =>
        res.status(500).json({
          error: "Execution failed",
          details: error.message,
        }),
      );
    }
  });
}
