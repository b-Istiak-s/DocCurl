import { ALLOWED_METHODS, DATA_FLAGS } from "./constants.js";
import { tokenizeCommand } from "./tokenize.js";

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
      bodyParts.push(readNextValue(token, i));
      i += 1;
      continue;
    }

    const dataMatch = token.match(/^--data(?:-raw|-binary|-urlencode)?=(.*)$/);
    if (dataMatch) {
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

    if (token === "-F" || token === "--form" || token.startsWith("--form=")) {
      throw new Error("Multipart (-F/--form) is not supported in DocCurl");
    }

    if (token === "-L" || token === "--location") {
      throw new Error("Redirect-following (-L/--location) is disabled");
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

  if (!explicitMethod && bodyParts.length > 0 && method === "GET") {
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
