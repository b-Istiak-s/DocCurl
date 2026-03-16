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

export async function prepareGeneratedUploads(
  formParts,
  {
    tmpDir = os.tmpdir(),
    mkdtempImpl = fs.mkdtemp,
    writeFileImpl = fs.writeFile,
    chmodImpl = fs.chmod,
    rmImpl = fs.rm,
    logger = console,
  } = {},
) {
  const generatedParts = Array.isArray(formParts)
    ? formParts.filter((part) => part?.source === "generated")
    : [];

  if (generatedParts.length === 0) {
    return {
      mountArgs: [],
      resolveFormFilePath(part) {
        return part?.filename || part?.value || "";
      },
      async cleanup() {},
    };
  }

  const tempDir = await mkdtempImpl(path.join(tmpDir, "doccurl-upload-"));
  await chmodImpl(tempDir, 0o755);
  const mountedFilePaths = new Map();

  for (const part of generatedParts) {
    const tempFilePath = path.join(tempDir, part.filename);
    await writeFileImpl(tempFilePath, getGeneratedFileBytes(part.extension));
    await chmodImpl(tempFilePath, 0o644);
    mountedFilePaths.set(part.filename, `${GENERATED_UPLOAD_MOUNT_ROOT}/${part.filename}`);
  }

  return {
    mountArgs: ["-v", `${tempDir}:${GENERATED_UPLOAD_MOUNT_ROOT}:ro`],
    resolveFormFilePath(part) {
      return mountedFilePaths.get(part.filename) || `${GENERATED_UPLOAD_MOUNT_ROOT}/${part.filename}`;
    },
    async cleanup() {
      try {
        await rmImpl(tempDir, { recursive: true, force: true });
      } catch (error) {
        logger.warn?.("Unable to clean up generated upload temp files", {
          tempDir,
          error,
        });
      }
    },
  };
}
