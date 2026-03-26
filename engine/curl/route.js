import { execFile } from "node:child_process";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import {
  CURL_RESPONSE_META_END,
  CURL_RESPONSE_META_START,
  LIMITS,
  NODOCKER_MARKER_PATH,
} from "./constants.js";
import { resolveRequestSpec } from "./parse.js";
import { validateRequestSpec } from "./validate.js";
import {
  defaultDnsLookup,
  isLocalDevTarget,
  validateTargetUrl,
} from "./network.js";
import { createNoDockerEnsurer, defaultRuntimeResolver } from "./runtime.js";
import { buildCurlArgs } from "./args.js";
import { prepareMountedUploads } from "./uploads/files.js";
import { parseMultipartUploadRequest } from "./uploads/multipart.js";

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

  const metadataText = text.slice(
    startIndex + CURL_RESPONSE_META_START.length,
    endIndex,
  );
  const [statusCodeRaw = "", contentTypeRaw = "", timeTotalRaw = ""] =
    metadataText.split("\t");

  const statusCode = Number.parseInt(statusCodeRaw, 10);
  const durationSeconds = Number.parseFloat(timeTotalRaw);

  return {
    output: text.slice(0, startIndex),
    metadata: {
      statusCode: Number.isFinite(statusCode) ? statusCode : null,
      contentType: contentTypeRaw || null,
      durationMs: Number.isFinite(durationSeconds)
        ? Math.round(durationSeconds * 1000)
        : null,
    },
  };
}

function formatMultipartError(error, limits = LIMITS) {
  if (!error) {
    return "Invalid multipart upload payload";
  }

  if (error.code === "LIMIT_FILE_SIZE") {
    return `Each uploaded file must be ${Math.round(limits.maxUploadFileBytes / (1024 * 1024))} MB or smaller`;
  }
  if (error.code === "LIMIT_TOTAL_FILE_SIZE") {
    return `Uploaded files must total ${Math.round(limits.maxUploadTotalBytes / (1024 * 1024))} MB or less`;
  }
  if (error.code === "LIMIT_FILE_COUNT") {
    return "Too many uploaded files";
  }
  if (error.code === "LIMIT_FIELD_COUNT") {
    return "Unexpected multipart fields";
  }
  if (error.code === "LIMIT_FIELD_VALUE") {
    return "Curl command field is too large";
  }

  return error.message || "Invalid multipart upload payload";
}

export function setupCurlRoutes(app, options = {}) {
  const isDev = Boolean(options.isDev);
  const execFileImpl = options.execFileImpl || execFile;
  const dnsLookup = options.dnsLookup || defaultDnsLookup;
  const containerImage = options.dockerImage || "curlimages/curl";
  const logger = options.logger || console;
  const runtimeResolver =
    options.runtimeResolver ||
    (() => defaultRuntimeResolver(options.runtimeExecFile || execFile));
  const ensureNoDockerMarker =
    options.ensureNoDockerMarker ||
    createNoDockerEnsurer({
      markerPath: options.noDockerMarkerPath || NODOCKER_MARKER_PATH,
      fsAccess: options.fsAccess || fs.access,
      fsWriteFile: options.fsWriteFile || fs.writeFile,
      logger,
    });
  const runtimeOverride = options.containerRuntime;
  const uploadLimits = {
    maxCommandLength: LIMITS.maxCommandLength,
    maxFormParts: LIMITS.maxFormParts,
    maxUploadFileBytes: LIMITS.maxUploadFileBytes,
    maxUploadTotalBytes: LIMITS.maxUploadTotalBytes,
    ...options.uploadLimits,
  };

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
    let requestBody = req.body;
    let requestSpec;
    let containerRuntime;
    let multipartSession;
    let uploadSession;
    let uploadFilesByIndex = new Map();
    try {
      if (req.is("multipart/form-data")) {
        multipartSession = await parseMultipartUploadRequest(req, {
          tmpDir: options.uploadTmpDir,
          limits: uploadLimits,
          BusboyImpl: options.BusboyImpl,
          mkdtempImpl: options.uploadFsMkdtemp || fs.mkdtemp,
          mkdirImpl: options.uploadFsMkdir || fs.mkdir,
          rmImpl: options.uploadFsRm || fs.rm,
          createWriteStreamImpl:
            options.uploadFsCreateWriteStream || nodeFs.createWriteStream,
          logger,
        });
        requestBody = multipartSession.body;
        uploadFilesByIndex = multipartSession.uploadFilesByIndex;
      }

      requestSpec = resolveRequestSpec(requestBody);
      validateRequestSpec(requestSpec);

      const urlError = await validateTargetUrl(requestSpec.url, {
        isDev,
        dnsLookup,
      });
      if (urlError) {
        if (multipartSession) {
          await multipartSession.cleanup();
          multipartSession = null;
        }
        return res.status(400).json({ error: urlError });
      }

      containerRuntime = await getContainerRuntime();
      await ensureNoDockerMarker(containerRuntime);

      if (requestSpec.formParts.length > 0) {
        const mountTempDir = multipartSession?.tempDir || null;
        multipartSession = null;
        uploadSession = await prepareMountedUploads(
          requestSpec.formParts,
          uploadFilesByIndex,
          {
            tempDir: mountTempDir,
            tmpDir: options.uploadTmpDir,
            mkdtempImpl: options.uploadFsMkdtemp || fs.mkdtemp,
            writeFileImpl: options.uploadFsWriteFile || fs.writeFile,
            chmodImpl: options.uploadFsChmod || fs.chmod,
            renameImpl: options.uploadFsRename || fs.rename,
            rmImpl: options.uploadFsRm || fs.rm,
            logger,
          },
        );
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
      } else if (multipartSession) {
        await multipartSession.cleanup();
      }
      if (req.is("multipart/form-data")) {
        return res
          .status(400)
          .json({ error: formatMultipartError(error, uploadLimits) });
      }
      return res.status(400).json({ error: error.message });
    }

    const curlArgs = buildCurlArgs(requestSpec);
    const networkMode =
      isDev && isLocalDevTarget(requestSpec.url) ? "host" : "bridge";

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
      } else if (multipartSession) {
        await multipartSession.cleanup();
        multipartSession = null;
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
              logger.error?.("Curl execution failed", {
                requestUrl: requestSpec.url,
                stderr: String(stderr || ""),
                error,
              });
              return res.status(500).json({
                error: "Execution failed",
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
      logger.error?.("Curl execution failed", {
        requestUrl: requestSpec?.url || null,
        error,
      });
      await finishWithCleanup(() =>
        res.status(500).json({
          error: "Execution failed",
        }),
      );
    }
  });
}
