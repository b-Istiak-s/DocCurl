import path from "node:path";
import {
  GENERATED_FILE_EXTENSIONS,
  GENERIC_UPLOAD_TOKEN_PATTERN,
  GENERATED_UPLOAD_TOKEN_PATTERN,
} from "./constants.js";

function normalizeGeneratedFilename(filename) {
  return path.posix.basename(String(filename || "").trim());
}

export function parseMultipartFormPart(rawValue) {
  const value = String(rawValue || "").trim();
  const match = value.match(GENERATED_UPLOAD_TOKEN_PATTERN);
  const genericUploadMatch = value.match(GENERIC_UPLOAD_TOKEN_PATTERN);

  if (!value.includes("=")) {
    throw new Error("Multipart field must use the form name=value");
  }

  if (!match) {
    const separatorIndex = value.indexOf("=");
    const fieldName = value.slice(0, separatorIndex).trim();
    const fieldValue = value.slice(separatorIndex + 1);

    if (!fieldName) {
      throw new Error("Multipart field name cannot be empty");
    }

    if (fieldValue.startsWith("@")) {
      const uploadValue = fieldValue.slice(1).trim();
      if (!uploadValue) {
        throw new Error("Multipart upload reference cannot be empty");
      }
      if (uploadValue.includes(";")) {
        throw new Error(
          "Multipart upload modifiers like ;type= and ;filename= are not supported",
        );
      }

      return {
        name: fieldName,
        source: "upload",
        uploadReference: uploadValue,
        filename: path.posix.basename(uploadValue),
      };
    }

    return {
      name: fieldName,
      value: fieldValue,
      source: "text",
    };
  }

  const fieldName = String(match[1] || "").trim();
  const filename = normalizeGeneratedFilename(match[2]);
  if (!fieldName) {
    throw new Error("Multipart field name cannot be empty");
  }
  if (!filename) {
    throw new Error("Generated upload filename cannot be empty");
  }
  if (filename.includes("/") || filename.includes("\\")) {
    throw new Error("Generated upload filename must not include path separators");
  }

  const extensionIndex = filename.lastIndexOf(".");
  if (extensionIndex <= 0 || extensionIndex === filename.length - 1) {
    throw new Error("Generated upload filename must include a supported extension");
  }

  const extension = filename.slice(extensionIndex + 1).toLowerCase();
  if (!GENERATED_FILE_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported generated upload extension: ${extension}`);
  }

  return {
    name: fieldName,
    filename,
    extension,
    source: "generated",
  };
}

export function parseGeneratedFormPart(rawValue) {
  const parsed = parseMultipartFormPart(rawValue);
  if (parsed.source !== "generated") {
    throw new Error(
      "Multipart only supports generated files in the form field=@R&{filename.ext}",
    );
  }
  return parsed;
}
