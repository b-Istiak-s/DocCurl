import path from "node:path";

export function normalizeDocPath(rawPath) {
  if (typeof rawPath !== "string") {
    throw new Error("Invalid path");
  }

  const normalized = path.posix.normalize(rawPath.replace(/\\/g, "/").trim());
  if (!normalized || normalized === ".") {
    throw new Error("Invalid path");
  }

  if (
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Invalid path");
  }

  if (!normalized.endsWith(".md")) {
    throw new Error("Only markdown files are supported");
  }

  return normalized;
}

export function resolveSafeDocPath(docsDir, relativePath) {
  const docsRoot = path.resolve(docsDir);
  const targetPath = path.resolve(docsRoot, relativePath);

  if (targetPath !== docsRoot && !targetPath.startsWith(`${docsRoot}${path.sep}`)) {
    throw new Error("Path traversal is not allowed");
  }

  return targetPath;
}
