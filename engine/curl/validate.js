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

export function validateSchema(schema, { name, limits = LIMITS, maxField = "maxSchemaBytes" } = {}) {
  if (schema == null) {
    return;
  }
  if (typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`Invalid ${name}: must be a JSON object.`);
  }
  const limit = limits[maxField] || limits.maxSchemaBytes;
  const serialized = JSON.stringify(schema);
  if (serialized.length > limit) {
    throw new Error(`${name} exceeds ${limit} bytes (${serialized.length}).`);
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

  if (!Array.isArray(spec.formParts) || spec.formParts.length > LIMITS.maxFormParts) {
    throw new Error("Too many multipart fields in curl command");
  }

  for (const header of spec.headers) {
    validateHeader(header);
  }

  for (const formPart of spec.formParts) {
    if (!formPart || typeof formPart !== "object") {
      throw new Error("Invalid multipart field");
    }
    if (typeof formPart.name !== "string" || !formPart.name.trim()) {
      throw new Error("Multipart field name cannot be empty");
    }
    if (formPart.source === "generated") {
      if (typeof formPart.filename !== "string" || !formPart.filename.trim()) {
        throw new Error("Generated upload filename cannot be empty");
      }
      continue;
    }
    if (formPart.source === "upload") {
      if (typeof formPart.uploadIndex !== "number" || formPart.uploadIndex < 0) {
        throw new Error("Multipart upload field is missing its upload index");
      }
      continue;
    }

    if (typeof formPart.value !== "string") {
      throw new Error("Multipart text field value must be a string");
    }
  }

  const bodyBytes = Buffer.byteLength(spec.body || "", "utf8");
  if (bodyBytes > LIMITS.maxBodyBytes) {
    throw new Error("Request body exceeds allowed size");
  }

  if (spec.body && spec.formParts.length > 0) {
    throw new Error("Multipart form data cannot be mixed with body data");
  }

  if (spec.body && !BODY_METHODS.has(spec.method)) {
    throw new Error(`HTTP ${spec.method} cannot be used with body data`);
  }

  if (spec.formParts.length > 0 && !BODY_METHODS.has(spec.method)) {
    throw new Error(`HTTP ${spec.method} cannot be used with multipart form data`);
  }

  validateSchema(spec.requestSchema, { name: "Request schema" });
  validateSchema(spec.responseSchema, { name: "Response schema" });
  validateSchema(spec.fieldDescriptions, { name: "Field descriptions", maxField: "maxDescriptionsBytes" });
}
