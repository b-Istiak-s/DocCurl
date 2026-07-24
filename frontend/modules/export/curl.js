import { tokenizeShell } from "../playground.js";

const DOCCURL_SCHEMA_FLAGS = new Set([
  "--doccurl-request-schema",
  "--doccurl-response-schema",
  "--doccurl-field-descriptions",
]);

const SCHEMA_FLAG_TO_SPEC = {
  "--doccurl-request-schema": "requestSchema",
  "--doccurl-response-schema": "responseSchema",
  "--doccurl-field-descriptions": "fieldDescriptions",
};

function parseSchemaFlagValue(flag, rawValue) {
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

function normalizeCommand(command) {
  return String(command || "").trim();
}

function parseHeaderToken(rawHeader) {
  const separatorIndex = String(rawHeader || "").indexOf(":");
  if (separatorIndex === -1) {
    throw new Error(`Invalid header format: ${rawHeader}`);
  }

  return {
    name: rawHeader.slice(0, separatorIndex).trim(),
    value: rawHeader.slice(separatorIndex + 1).trim(),
  };
}

function parseFormToken(rawFormValue) {
  const value = String(rawFormValue || "");
  const generatedFileMatch = value.match(/^([^=]+)=@R&\{([^{}]+)\}$/);
  if (generatedFileMatch) {
    return {
      name: generatedFileMatch[1].trim(),
      type: "file",
      value: `@R&{${generatedFileMatch[2]}}`,
      filename: generatedFileMatch[2],
    };
  }

  const uploadFileMatch = value.match(/^([^=]+)=@(.+)$/);
  if (uploadFileMatch) {
    const uploadValue = uploadFileMatch[2].trim();
    if (!uploadValue || uploadValue.includes(";")) {
      throw new Error(`Unsupported multipart file token: ${rawFormValue}`);
    }

    const segments = uploadValue.split(/[\\/]/).filter(Boolean);
    const filename = segments[segments.length - 1] || uploadValue;

    return {
      name: uploadFileMatch[1].trim(),
      type: "file",
      value: `@${uploadValue}`,
      filename,
    };
  }

  const textMatch = value.match(/^([^=]+)=(.*)$/);
  if (textMatch) {
    return {
      name: textMatch[1].trim(),
      type: "text",
      value: textMatch[2],
      filename: "",
    };
  }

  throw new Error(`Invalid multipart value: ${rawFormValue}`);
}

function buildRequestName(method, url, index) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    return `Request ${index + 1}`;
  }

  return `${method} ${normalizedUrl}`.slice(0, 120);
}

export function parseCurlForExport(command, options = 0) {
  const config =
    typeof options === "number"
      ? { index: options, name: "" }
      : {
          index: Number(options?.index) || 0,
          name: String(options?.name || "").trim(),
        };
  const tokens = tokenizeShell(normalizeCommand(command));
  if (!tokens.length || tokens[0] !== "curl") {
    throw new Error("Command must start with curl");
  }

  let method = "";
  let url = "";
  let headRequested = false;
  const headers = [];
  const bodyParts = [];
  const formParts = [];
  const docCurlFlags = {};

  function readNextValue(flag, tokenIndex) {
    const value = tokens[tokenIndex + 1];
    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  }

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token === "-X" || token === "--request") {
      method = readNextValue(token, i);
      i += 1;
      continue;
    }
    if (token.startsWith("--request=")) {
      method = token.slice("--request=".length);
      continue;
    }
    if (token.startsWith("-X") && token.length > 2) {
      method = token.slice(2);
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

    if (token === "-H" || token === "--header") {
      headers.push(parseHeaderToken(readNextValue(token, i)));
      i += 1;
      continue;
    }
    if (token.startsWith("--header=")) {
      headers.push(parseHeaderToken(token.slice("--header=".length)));
      continue;
    }
    if (token.startsWith("-H") && token.length > 2) {
      headers.push(parseHeaderToken(token.slice(2)));
      continue;
    }

    if (
      token === "-d" ||
      token === "--data" ||
      token === "--data-raw" ||
      token === "--data-binary" ||
      token === "--data-urlencode"
    ) {
      bodyParts.push(readNextValue(token, i));
      i += 1;
      continue;
    }
    if (
      token.startsWith("--data=") ||
      token.startsWith("--data-raw=") ||
      token.startsWith("--data-binary=") ||
      token.startsWith("--data-urlencode=")
    ) {
      bodyParts.push(token.slice(token.indexOf("=") + 1));
      continue;
    }

    if (token === "-F" || token === "--form") {
      formParts.push(parseFormToken(readNextValue(token, i)));
      i += 1;
      continue;
    }
    if (token.startsWith("--form=")) {
      formParts.push(parseFormToken(token.slice("--form=".length)));
      continue;
    }
    if (token.startsWith("-F") && token.length > 2) {
      formParts.push(parseFormToken(token.slice(2)));
      continue;
    }

    if (token === "-I" || token === "--head") {
      headRequested = true;
      continue;
    }

    if (DOCCURL_SCHEMA_FLAGS.has(token)) {
      const specKey = SCHEMA_FLAG_TO_SPEC[token];
      if (docCurlFlags[specKey] !== undefined) {
        throw new Error(`Duplicate flag: ${token}`);
      }
      const value = readNextValue(token, i);
      docCurlFlags[specKey] = parseSchemaFlagValue(token, value);
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
      docCurlFlags[specKey] = parseSchemaFlagValue(flag, value);
      continue;
    }

    if (!url && !token.startsWith("-")) {
      url = token;
      continue;
    }
  }

  const normalizedMethod = method
    ? method.toUpperCase()
    : headRequested
      ? "HEAD"
      : bodyParts.length > 0 || formParts.length > 0
        ? "POST"
        : "GET";

  return {
    method: normalizedMethod,
    url,
    headers,
    body: bodyParts.join("&"),
    formParts,
    name: config.name || buildRequestName(normalizedMethod, url, config.index),
    rawCommand: normalizeCommand(command),
    requestSchema: docCurlFlags.requestSchema || null,
    responseSchema: docCurlFlags.responseSchema || null,
    fieldDescriptions: docCurlFlags.fieldDescriptions || null,
  };
}
