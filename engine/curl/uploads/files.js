import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { GENERATED_UPLOAD_MOUNT_ROOT } from "./constants.js";

const GENERATED_FILE_BYTES = {
  png: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=",
    "base64",
  ),
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  webp: Buffer.from("RIFF\x1a\0\0\0WEBPVP8 \x0e\0\0\0\x10\0\0\x9d\x01*\x01\0\x01\0\0", "binary"),
  gif: Buffer.from("R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"),
  avif: Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00,
    0x00, 0x61, 0x76, 0x69, 0x66, 0x6d, 0x69, 0x66, 0x31,
  ]),
  mp4: Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02,
    0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  ]),
  webm: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]),
  pdf: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "utf8"),
};

function getGeneratedFileBytes(extension) {
  const bytes = GENERATED_FILE_BYTES[extension];
  if (!bytes) {
    throw new Error(`Unsupported generated upload extension: ${extension}`);
  }
  return bytes;
}

function sanitizeMountedFilename(filename, fallback = "upload.bin") {
  const baseName = path.posix.basename(String(filename || "").trim()) || fallback;
  return baseName.replace(/[^A-Za-z0-9._-]/g, "_");
}

function createUniqueMountedFilename(filename, usedNames) {
  const normalized = sanitizeMountedFilename(filename);
  if (!usedNames.has(normalized)) {
    usedNames.add(normalized);
    return normalized;
  }

  const extensionIndex = normalized.lastIndexOf(".");
  const baseName = extensionIndex > 0 ? normalized.slice(0, extensionIndex) : normalized;
  const extension = extensionIndex > 0 ? normalized.slice(extensionIndex) : "";
  let counter = 1;

  while (usedNames.has(`${baseName}-${counter}${extension}`)) {
    counter += 1;
  }

  const candidate = `${baseName}-${counter}${extension}`;
  usedNames.add(candidate);
  return candidate;
}

export async function prepareMountedUploads(
  formParts,
  uploadFilesByIndex = new Map(),
  {
    tempDir: existingTempDir = null,
    tmpDir = os.tmpdir(),
    mkdtempImpl = fs.mkdtemp,
    writeFileImpl = fs.writeFile,
    chmodImpl = fs.chmod,
    renameImpl = fs.rename,
    rmImpl = fs.rm,
    logger = console,
  } = {},
) {
  const mountableParts = Array.isArray(formParts)
    ? formParts.filter((part) => part?.source === "generated" || part?.source === "upload")
    : [];

  if (mountableParts.length === 0) {
    return {
      mountArgs: [],
      resolveFormFilePath(part) {
        return part?.filename || part?.value || "";
      },
      async cleanup() {},
    };
  }

  const tempDir = existingTempDir || (await mkdtempImpl(path.join(tmpDir, "doccurl-upload-")));
  const cleanupTempDir = async () => {
    try {
      await rmImpl(tempDir, { recursive: true, force: true });
    } catch (error) {
      logger.warn?.("Unable to clean up generated upload temp files", {
        tempDir,
        error,
      });
    }
  };

  const mountedFilePaths = new Map();
  const usedNames = new Set();

  try {
    await chmodImpl(tempDir, 0o700);

    for (const part of mountableParts) {
      let sourceFilename;

      if (part.source === "generated") {
        sourceFilename = part.filename;
      } else {
        const uploadedFile = uploadFilesByIndex.get(part.uploadIndex);
        if (!uploadedFile) {
          throw new Error(`Missing uploaded file for multipart field: ${part.name}`);
        }
        if (!uploadedFile.tempFilePath) {
          throw new Error(`Missing uploaded temp file for multipart field: ${part.name}`);
        }
        sourceFilename = uploadedFile.originalname || part.filename || `upload-${part.uploadIndex}`;
      }

      const mountedFilename = createUniqueMountedFilename(sourceFilename, usedNames);
      const tempFilePath = path.join(tempDir, mountedFilename);

      if (part.source === "generated") {
        await writeFileImpl(tempFilePath, getGeneratedFileBytes(part.extension));
      } else {
        const uploadedFile = uploadFilesByIndex.get(part.uploadIndex);
        if (uploadedFile.tempFilePath !== tempFilePath) {
          await renameImpl(uploadedFile.tempFilePath, tempFilePath);
          uploadedFile.tempFilePath = tempFilePath;
        }
      }

      await chmodImpl(tempFilePath, 0o600);
      mountedFilePaths.set(part, `${GENERATED_UPLOAD_MOUNT_ROOT}/${mountedFilename}`);
    }
  } catch (error) {
    await cleanupTempDir();
    throw error;
  }

  return {
    mountArgs: ["-v", `${tempDir}:${GENERATED_UPLOAD_MOUNT_ROOT}:ro`],
    resolveFormFilePath(part) {
      return (
        mountedFilePaths.get(part) ||
        `${GENERATED_UPLOAD_MOUNT_ROOT}/${sanitizeMountedFilename(part?.filename, "upload.bin")}`
      );
    },
    async cleanup() {
      await cleanupTempDir();
    },
  };
}
