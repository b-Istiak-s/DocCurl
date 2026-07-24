import { ALLOWED_METHODS, DATA_FLAGS, DOCCURL_SCHEMA_FLAGS, FORM_FLAGS } from "./constants.js";
import { tokenizeCommand } from "./tokenize.js";
import { parseMultipartFormPart } from "./uploads/parse.js";

const SCHEMA_FLAG_TO_SPEC = {
  "--doccurl-request-schema": "requestSchema",
  "--doccurl-response-schema": "responseSchema",
  "--doccurl-field-descriptions": "fieldDescriptions",
};

export function parseHeader(rawHeader) {
  if (typeof rawHeader !== "string" || !rawHeader.includes(":")) {
    throw new Error(`Invalid header format: ${String(rawHeader)}`);
  }

  const separatorIndex = rawHeader.indexOf(":");
  const name = rawHeader.slice(0, separatorIndex).trim();
  const value = rawHeader.slice(separatorIndex + 1).trim();

  if (!name) {
    throw new Error("Header name cannot be empty");
  }

  return { name, value };
}

function parseDocCurlFlagValue(flag, rawValue) {
  if (typeof rawValue !== "string") {
    throw new Error(`Missing value for ${flag}`);
  }
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    throw new Error(`Empty value for ${flag}`);
  }
  if (trimmed.startsWith("@")) {
    throw new Error(
      `File references are not supported for ${flag}; paste the JSON inline.`,
    );
  }
  if (/[\r\n]/.test(trimmed)) {
    throw new Error(`${flag} must be a single-line JSON value.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Invalid JSON in ${flag}: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${flag} must be a JSON object.`);
  }
  return parsed;
}

export function parseCurlCommand(command) {
  const tokens = tokenizeCommand(command);
  if (tokens[0] !== "curl") {
    throw new Error("Command must start with curl");
  }

  let url = "";
  let explicitMethod = "";
  let headRequested = false;
  const headers = [];
  const bodyParts = [];
  const formParts = [];
  const docCurlFlags = {};
  let uploadIndex = 0;

  function readNextValue(flag, index) {
    const value = tokens[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  }

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token === "-X" || token === "--request") {
      explicitMethod = readNextValue(token, i);
      i += 1;
      continue;
    }

    if (token.startsWith("--request=")) {
      explicitMethod = token.slice("--request=".length);
      continue;
    }

    if (token.startsWith("-X") && token.length > 2) {
      explicitMethod = token.slice(2);
      continue;
    }

    if (token === "-H" || token === "--header") {
      headers.push(parseHeader(readNextValue(token, i)));
      i += 1;
      continue;
    }

    if (token.startsWith("--header=")) {
      headers.push(parseHeader(token.slice("--header=".length)));
      continue;
    }

    if (token.startsWith("-H") && token.length > 2) {
      headers.push(parseHeader(token.slice(2)));
      continue;
    }

    if (DATA_FLAGS.has(token)) {
      if (formParts.length > 0) {
        throw new Error("Multipart form data cannot be mixed with body data");
      }
      bodyParts.push(readNextValue(token, i));
      i += 1;
      continue;
    }

    const dataMatch = token.match(/^--data(?:-raw|-binary|-urlencode)?=(.*)$/);
    if (dataMatch) {
      if (formParts.length > 0) {
        throw new Error("Multipart form data cannot be mixed with body data");
      }
      bodyParts.push(dataMatch[1]);
      continue;
    }

    if (token === "--url") {
      url = readNextValue(token, i);
      i += 1;
      continue;
    }

    if (token.startsWith("--url=")) {
      url = token.slice("--url=".length);
      continue;
    }

    if (token === "-I" || token === "--head") {
      headRequested = true;
      continue;
    }

    if (FORM_FLAGS.has(token)) {
      if (bodyParts.length > 0) {
        throw new Error("Multipart form data cannot be mixed with body data");
      }
      {
        const formPart = parseMultipartFormPart(readNextValue(token, i));
        if (formPart.source === "upload") {
          formPart.uploadIndex = uploadIndex;
          uploadIndex += 1;
        }
        formParts.push(formPart);
      }
      i += 1;
      continue;
    }

    if (token.startsWith("--form=")) {
      if (bodyParts.length > 0) {
        throw new Error("Multipart form data cannot be mixed with body data");
      }
      {
        const formPart = parseMultipartFormPart(token.slice("--form=".length));
        if (formPart.source === "upload") {
          formPart.uploadIndex = uploadIndex;
          uploadIndex += 1;
        }
        formParts.push(formPart);
      }
      continue;
    }

    if (token.startsWith("-F") && token.length > 2) {
      if (bodyParts.length > 0) {
        throw new Error("Multipart form data cannot be mixed with body data");
      }
      {
        const formPart = parseMultipartFormPart(token.slice(2));
        if (formPart.source === "upload") {
          formPart.uploadIndex = uploadIndex;
          uploadIndex += 1;
        }
        formParts.push(formPart);
      }
      continue;
    }

    if (token === "-L" || token === "--location") {
      throw new Error("Redirect-following (-L/--location) is disabled");
    }

    if (DOCCURL_SCHEMA_FLAGS.has(token)) {
      const specKey = SCHEMA_FLAG_TO_SPEC[token];
      if (docCurlFlags[specKey] !== undefined) {
        throw new Error(`Duplicate flag: ${token}`);
      }
      const value = readNextValue(token, i);
      docCurlFlags[specKey] = parseDocCurlFlagValue(token, value);
      i += 1;
      continue;
    }

    let schemaEqualsMatch = null;
    for (const flag of DOCCURL_SCHEMA_FLAGS) {
      if (token.startsWith(`${flag}=`)) {
        schemaEqualsMatch = { flag, value: token.slice(flag.length + 1) };
        break;
      }
    }
    if (schemaEqualsMatch) {
      const { flag, value } = schemaEqualsMatch;
      const specKey = SCHEMA_FLAG_TO_SPEC[flag];
      if (docCurlFlags[specKey] !== undefined) {
        throw new Error(`Duplicate flag: ${flag}`);
      }
      docCurlFlags[specKey] = parseDocCurlFlagValue(flag, value);
      continue;
    }

    if (token === "--") {
      const remaining = tokens.slice(i + 1);
      if (remaining.length === 0) {
        throw new Error("Missing URL after --");
      }
      if (!url) {
        [url] = remaining;
      } else {
        throw new Error(`Unsupported extra argument: ${remaining[0]}`);
      }
      if (remaining.length > 1) {
        throw new Error(`Unsupported extra argument: ${remaining[1]}`);
      }
      break;
    }

    if (token.startsWith("-")) {
      throw new Error(`Unsupported flag: ${token}`);
    }

    if (!url) {
      url = token;
      continue;
    }

    throw new Error(`Unsupported extra argument: ${token}`);
  }

  if (!url) {
    throw new Error("Missing URL in curl command");
  }

  let method = explicitMethod ? explicitMethod.toUpperCase() : headRequested ? "HEAD" : "GET";

  if (!explicitMethod && (bodyParts.length > 0 || formParts.length > 0) && method === "GET") {
    method = "POST";
  }

  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(`Invalid HTTP method: ${method}`);
  }

  return {
    method,
    url,
    headers,
    body: bodyParts.join("&"),
    formParts,
    requestSchema: docCurlFlags.requestSchema || null,
    responseSchema: docCurlFlags.responseSchema || null,
    fieldDescriptions: docCurlFlags.fieldDescriptions || null,
  };
}

export function parseLegacyRequest(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid request payload");
  }

  const { url, method = "GET", headers = {}, body = "" } = payload;
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("Missing URL in payload");
  }

  if (headers == null || typeof headers !== "object" || Array.isArray(headers)) {
    throw new Error("Legacy headers must be an object");
  }

  const headerList = Object.entries(headers).map(([name, value]) => ({
    name: String(name),
    value: String(value),
  }));

  return {
    method: String(method).toUpperCase(),
    url: url.trim(),
    headers: headerList,
    body: body == null ? "" : String(body),
    formParts: [],
    requestSchema: null,
    responseSchema: null,
    fieldDescriptions: null,
  };
}

export function resolveRequestSpec(payload) {
  if (payload && typeof payload.command === "string") {
    return parseCurlCommand(payload.command);
  }
  if (payload && typeof payload.url === "string") {
    return parseLegacyRequest(payload);
  }
  throw new Error("Invalid payload. Use { command: string }");
}
