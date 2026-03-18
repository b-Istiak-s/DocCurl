import os from "node:os";
import path from "node:path";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import Busboy from "busboy";
import { LIMITS } from "../constants.js";

const INCOMING_UPLOAD_DIR = ".incoming";
const UPLOAD_FIELD_PATTERN = /^upload_(\d+)$/;

function createMultipartUploadError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseUploadIndex(fieldName) {
  const match = String(fieldName || "").match(UPLOAD_FIELD_PATTERN);
  if (!match) {
    return null;
  }

  const uploadIndex = Number.parseInt(match[1], 10);
  if (!Number.isFinite(uploadIndex) || uploadIndex < 0) {
    return null;
  }

  return uploadIndex;
}

export async function parseMultipartUploadRequest(
  req,
  {
    tmpDir = os.tmpdir(),
    limits = LIMITS,
    BusboyImpl = Busboy,
    mkdtempImpl = fs.mkdtemp,
    mkdirImpl = fs.mkdir,
    rmImpl = fs.rm,
    createWriteStreamImpl = nodeFs.createWriteStream,
    logger = console,
  } = {},
) {
  const tempDir = await mkdtempImpl(path.join(tmpDir, "doccurl-upload-"));
  const incomingDir = path.join(tempDir, INCOMING_UPLOAD_DIR);
  await mkdirImpl(incomingDir, { recursive: true });

  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;

    try {
      await rmImpl(tempDir, { recursive: true, force: true });
    } catch (error) {
      logger.warn?.("Unable to clean up multipart upload temp files", {
        tempDir,
        error,
      });
    }
  };

  const parser = BusboyImpl({
    headers: req.headers,
    limits: {
      files: limits.maxFormParts,
      fields: 1,
      fieldSize: limits.maxCommandLength,
    },
  });

  return new Promise((resolve, reject) => {
    const body = {};
    const uploadFilesByIndex = new Map();
    const activeFiles = new Set();
    let nextTempFileIndex = 0;
    let totalBytes = 0;
    let pendingFiles = 0;
    let parserClosed = false;
    let settled = false;
    let abortedError = null;

    const cleanupListeners = () => {
      req.removeListener("aborted", handleRequestAborted);
      req.removeListener("error", handleRequestError);
      parser.removeListener("close", handleParserClose);
      parser.removeListener("error", handleParserError);
      parser.removeListener("filesLimit", handleFilesLimit);
      parser.removeListener("fieldsLimit", handleFieldsLimit);
      parser.removeListener("field", handleField);
      parser.removeListener("file", handleFile);
    };

    const settle = async (error = null) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanupListeners();

      if (error) {
        await cleanup();
        reject(error);
        return;
      }

      resolve({
        body,
        tempDir,
        uploadFilesByIndex,
        cleanup,
      });
    };

    const maybeFinish = () => {
      if (!parserClosed || pendingFiles > 0 || settled) {
        return;
      }

      if (abortedError) {
        void settle(abortedError);
        return;
      }

      void settle();
    };

    const abort = (error) => {
      if (abortedError) {
        return;
      }

      abortedError = error;

      for (const fileState of Array.from(activeFiles)) {
        fileState.abort(error);
      }

      try {
        req.unpipe(parser);
      } catch {}

      if (!req.destroyed) {
        req.resume();
      }

      parser.destroy(error);
    };

    function handleRequestAborted() {
      abort(createMultipartUploadError("REQUEST_ABORTED", "Invalid multipart upload payload"));
    }

    function handleRequestError(error) {
      abort(error);
    }

    function handleParserClose() {
      parserClosed = true;
      maybeFinish();
    }

    function handleParserError(error) {
      if (!abortedError) {
        abortedError = error;
      }
      maybeFinish();
    }

    function handleFilesLimit() {
      abort(createMultipartUploadError("LIMIT_FILE_COUNT", "Too many uploaded files"));
    }

    function handleFieldsLimit() {
      abort(createMultipartUploadError("LIMIT_FIELD_COUNT", "Unexpected multipart fields"));
    }

    function handleField(fieldName, value, info = {}) {
      if (info.valueTruncated) {
        abort(createMultipartUploadError("LIMIT_FIELD_VALUE", "Curl command field is too large"));
        return;
      }

      body[fieldName] = value;
    }

    function handleFile(fieldName, fileStream, info = {}) {
      const tempFilePath = path.join(incomingDir, `part-${nextTempFileIndex}`);
      const writeStream = createWriteStreamImpl(tempFilePath);
      const uploadIndex = parseUploadIndex(fieldName);
      const originalname = info.filename || "";
      let fileBytes = 0;
      let fileSettled = false;

      pendingFiles += 1;

      const fileState = {
        abort(error) {
          if (fileSettled) {
            return;
          }

          fileStream.removeListener("data", onData);
          fileStream.removeListener("end", onEnd);
          fileStream.removeListener("error", onFileError);
          writeStream.removeListener("drain", onDrain);
          writeStream.removeListener("error", onWriteError);
          writeStream.removeListener("finish", onWriteFinish);

          try {
            fileStream.resume();
          } catch {}

          writeStream.destroy();
          finishFile(error);
        },
      };

      nextTempFileIndex += 1;
      activeFiles.add(fileState);

      const finishFile = (error = null) => {
        if (fileSettled) {
          return;
        }

        fileSettled = true;
        activeFiles.delete(fileState);
        pendingFiles -= 1;

        if (error) {
          abort(error);
          maybeFinish();
          return;
        }

        if (uploadIndex !== null && !uploadFilesByIndex.has(uploadIndex)) {
          uploadFilesByIndex.set(uploadIndex, {
            originalname,
            size: fileBytes,
            tempFilePath,
          });
        }

        maybeFinish();
      };

      const onData = (chunk) => {
        if (fileSettled) {
          return;
        }

        fileBytes += chunk.length;
        totalBytes += chunk.length;

        if (fileBytes > limits.maxUploadFileBytes) {
          fileState.abort(
            createMultipartUploadError(
              "LIMIT_FILE_SIZE",
              `Each uploaded file must be ${Math.round(limits.maxUploadFileBytes / (1024 * 1024))} MB or smaller`,
            ),
          );
          return;
        }

        if (totalBytes > limits.maxUploadTotalBytes) {
          fileState.abort(
            createMultipartUploadError(
              "LIMIT_TOTAL_FILE_SIZE",
              `Uploaded files must total ${Math.round(limits.maxUploadTotalBytes / (1024 * 1024))} MB or less`,
            ),
          );
          return;
        }

        try {
          if (!writeStream.write(chunk)) {
            fileStream.pause();
          }
        } catch (error) {
          fileState.abort(error);
        }
      };

      const onEnd = () => {
        if (fileSettled) {
          return;
        }

        writeStream.end();
      };

      const onDrain = () => {
        if (!fileSettled) {
          fileStream.resume();
        }
      };

      const onFileError = (error) => {
        fileState.abort(error);
      };

      const onWriteError = (error) => {
        fileState.abort(error);
      };

      const onWriteFinish = () => {
        finishFile();
      };

      fileStream.on("data", onData);
      fileStream.on("end", onEnd);
      fileStream.on("error", onFileError);
      writeStream.on("drain", onDrain);
      writeStream.on("error", onWriteError);
      writeStream.on("finish", onWriteFinish);
    }

    req.on("aborted", handleRequestAborted);
    req.on("error", handleRequestError);
    parser.on("close", handleParserClose);
    parser.on("error", handleParserError);
    parser.on("filesLimit", handleFilesLimit);
    parser.on("fieldsLimit", handleFieldsLimit);
    parser.on("field", handleField);
    parser.on("file", handleFile);
    req.pipe(parser);
  });
}
