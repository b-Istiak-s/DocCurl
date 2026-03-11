import { ALLOWED_METHODS, BODY_METHODS, LIMITS } from "./constants.js";

export function validateHeader(header) {
  if (!/^[A-Za-z0-9-]+$/.test(header.name)) {
    throw new Error(`Invalid header name: ${header.name}`);
  }

  if (
    header.name.length > LIMITS.maxHeaderNameLength ||
    header.value.length > LIMITS.maxHeaderValueLength
  ) {
    throw new Error("Header exceeds allowed size");
  }

  if (/[\r\n]/.test(header.name) || /[\r\n]/.test(header.value)) {
    throw new Error("Invalid newline characters in header");
  }
}

export function validateRequestSpec(spec) {
  if (!ALLOWED_METHODS.has(spec.method)) {
    throw new Error(`Invalid HTTP method: ${spec.method}`);
  }

  if (typeof spec.url !== "string" || !spec.url || spec.url.length > LIMITS.maxUrlLength) {
    throw new Error("Invalid URL");
  }

  if (!Array.isArray(spec.headers) || spec.headers.length > LIMITS.maxHeaders) {
    throw new Error("Too many headers in curl command");
  }

  for (const header of spec.headers) {
    validateHeader(header);
  }

  const bodyBytes = Buffer.byteLength(spec.body || "", "utf8");
  if (bodyBytes > LIMITS.maxBodyBytes) {
    throw new Error("Request body exceeds allowed size");
  }

  if (spec.body && !BODY_METHODS.has(spec.method)) {
    throw new Error(`HTTP ${spec.method} cannot be used with body data`);
  }
}
