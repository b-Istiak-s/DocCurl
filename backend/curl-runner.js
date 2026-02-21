const { execFile } = require("child_process");
const dns = require("dns");
const fs = require("fs/promises");
const net = require("net");

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DATA_FLAGS = new Set([
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
]);
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "host.docker.internal",
  "gateway.docker.internal",
  "docker.internal",
  "metadata.google.internal",
  "metadata",
]);

const BLOCKED_IPV4_CIDRS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

const BLOCKED_IPV6_CIDRS = [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["::ffff:0:0", 96],
];

const LIMITS = {
  maxCommandLength: 20_000,
  maxUrlLength: 2_048,
  maxHeaders: 40,
  maxHeaderNameLength: 128,
  maxHeaderValueLength: 2_048,
  maxBodyBytes: 64 * 1024,
  maxOutputBytes: 1024 * 1024,
  requestTimeoutMs: 5_000,
};
const NODOCKER_MARKER_PATH = "/etc/containers/nodocker";
const RUNTIME_CHECK_TIMEOUT_MS = 1_500;

function defaultDnsLookup(hostname) {
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

function checkRuntimeAvailable(runtime, execFileCheck = execFile) {
  return new Promise((resolve) => {
    execFileCheck(
      runtime,
      ["--version"],
      { timeout: RUNTIME_CHECK_TIMEOUT_MS },
      (error) => {
        resolve(!error);
      },
    );
  });
}

async function defaultRuntimeResolver(execFileCheck = execFile) {
  if (await checkRuntimeAvailable("podman", execFileCheck)) {
    return "podman";
  }

  if (await checkRuntimeAvailable("docker", execFileCheck)) {
    return "docker";
  }

  throw new Error("No container runtime available. Install podman or docker.");
}

function createNoDockerEnsurer({
  markerPath = NODOCKER_MARKER_PATH,
  fsAccess = fs.access,
  fsWriteFile = fs.writeFile,
  logger = console,
} = {}) {
  let checked = false;

  return async (runtime) => {
    if (runtime !== "podman" || checked) {
      return;
    }
    checked = true;

    try {
      await fsAccess(markerPath);
      return;
    } catch (error) {
      if (error && error.code && error.code !== "ENOENT") {
        logger.warn(
          `Unable to inspect ${markerPath}: ${error.message}.`,
        );
      }
    }

    try {
      await fsWriteFile(markerPath, "", { flag: "wx" });
    } catch (error) {
      if (error && error.code === "EEXIST") {
        return;
      }
      logger.warn(
        `Could not create ${markerPath}. To silence podman's Docker emulation warning, run: sudo touch ${markerPath}`,
      );
    }
  };
}

function tokenizeCommand(command) {
  if (typeof command !== "string") {
    throw new Error("Curl command must be a string");
  }

  const input = command.trim();
  if (!input) {
    throw new Error("Curl command is empty");
  }

  if (input.length > LIMITS.maxCommandLength) {
    throw new Error(
      `Curl command exceeds ${LIMITS.maxCommandLength} characters`,
    );
  }

  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (escaping) {
      if (ch === "\n") {
        escaping = false;
        continue;
      }
      current += ch;
      escaping = false;
      continue;
    }

    if (quote === "'") {
      if (ch === "'") {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null;
        continue;
      }
      if (ch === "\\") {
        const next = input[i + 1];
        if (
          next === '"' ||
          next === "\\" ||
          next === "$" ||
          next === "`" ||
          next === "\n"
        ) {
          escaping = true;
          continue;
        }
      }
      current += ch;
      continue;
    }

    if (ch === "\\") {
      escaping = true;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (quote) {
    throw new Error("Unterminated quote in curl command");
  }

  if (escaping) {
    current += "\\";
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function parseHeader(rawHeader) {
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

function parseCurlCommand(command) {
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
        url = remaining[0];
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

  let method = explicitMethod
    ? explicitMethod.toUpperCase()
    : headRequested
      ? "HEAD"
      : "GET";

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

function parseLegacyRequest(payload) {
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

function validateHeader(header) {
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

function validateRequestSpec(spec) {
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

function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet < 0 || octet > 255) {
      return null;
    }
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function isIpv4InCidr(ip, base, prefix) {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt == null || baseInt == null) {
    return false;
  }
  const mask =
    prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0) & 0xffffffff;
  return (ipInt & mask) === (baseInt & mask);
}

function isValidHextet(segment) {
  return /^[0-9a-f]{1,4}$/i.test(segment);
}

function ipv6ToBigInt(inputAddress) {
  let address = inputAddress.toLowerCase();

  if (address.includes("%")) {
    [address] = address.split("%");
  }

  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    if (lastColon === -1) {
      return null;
    }
    const ipv4Part = address.slice(lastColon + 1);
    const ipv4Int = ipv4ToInt(ipv4Part);
    if (ipv4Int == null) {
      return null;
    }
    const high = ((ipv4Int >>> 16) & 0xffff).toString(16);
    const low = (ipv4Int & 0xffff).toString(16);
    address = `${address.slice(0, lastColon)}:${high}:${low}`;
  }

  const pieces = address.split("::");
  if (pieces.length > 2) {
    return null;
  }

  const left = pieces[0] ? pieces[0].split(":").filter(Boolean) : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":").filter(Boolean) : [];

  if (left.some((segment) => !isValidHextet(segment))) {
    return null;
  }
  if (right.some((segment) => !isValidHextet(segment))) {
    return null;
  }

  if (pieces.length === 1 && left.length !== 8) {
    return null;
  }

  const missing = 8 - (left.length + right.length);
  if (missing < 0) {
    return null;
  }

  const full = pieces.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (full.length !== 8) {
    return null;
  }

  let value = 0n;
  for (const segment of full) {
    value = (value << 16n) + BigInt(parseInt(segment, 16));
  }
  return value;
}

function isIpv6InCidr(ip, base, prefix) {
  const ipValue = ipv6ToBigInt(ip);
  const baseValue = ipv6ToBigInt(base);
  if (ipValue == null || baseValue == null) {
    return false;
  }

  if (prefix === 0) {
    return true;
  }

  const shift = BigInt(128 - prefix);
  return (ipValue >> shift) === (baseValue >> shift);
}

function isBlockedIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    return BLOCKED_IPV4_CIDRS.some(([base, prefix]) =>
      isIpv4InCidr(ip, base, prefix),
    );
  }
  if (family === 6) {
    return BLOCKED_IPV6_CIDRS.some(([base, prefix]) =>
      isIpv6InCidr(ip, base, prefix),
    );
  }
  return true;
}

function isBlockedHostname(hostname) {
  const normalized = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }
  if (normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    return true;
  }
  if (normalized.endsWith(".internal")) {
    return true;
  }
  return false;
}

function isLocalDevTarget(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isBlockedHostname(hostname)) {
    return true;
  }

  const ipFamily = net.isIP(hostname);
  if (ipFamily > 0) {
    return isBlockedIp(hostname);
  }

  return false;
}

async function validateTargetUrl(url, { isDev = false, dnsLookup = defaultDnsLookup } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only http/https URLs are allowed";
  }

  if (isDev) {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return "Invalid URL host";
  }

  if (isBlockedHostname(hostname)) {
    return "URL host is blocked in production mode";
  }

  const ipFamily = net.isIP(hostname);
  if (ipFamily > 0) {
    if (isBlockedIp(hostname)) {
      return "URL target is blocked in production mode";
    }
    return null;
  }

  let records;
  try {
    records = await dnsLookup(hostname);
  } catch {
    return "Unable to resolve hostname";
  }

  const resolvedRecords = Array.isArray(records) ? records : [records];
  if (resolvedRecords.length === 0) {
    return "Unable to resolve hostname";
  }

  for (const record of resolvedRecords) {
    if (!record || typeof record.address !== "string") {
      return "Unable to resolve hostname";
    }
    if (isBlockedIp(record.address)) {
      return "URL resolves to a blocked network target";
    }
  }

  return null;
}

function buildCurlArgs(spec) {
  const args = [
    "-sS",
    "--proto",
    "=http,https",
    "--max-redirs",
    "0",
    "--connect-timeout",
    "4",
    "--max-time",
    "5",
    "-X",
    spec.method,
    spec.url,
  ];

  for (const header of spec.headers) {
    args.push("-H", `${header.name}: ${header.value}`);
  }

  if (spec.body) {
    args.push("--data-raw", spec.body);
  }

  return args;
}

function resolveRequestSpec(payload) {
  if (payload && typeof payload.command === "string") {
    return parseCurlCommand(payload.command);
  }
  if (payload && typeof payload.url === "string") {
    return parseLegacyRequest(payload);
  }
  throw new Error("Invalid payload. Use { command: string }");
}

function setupCurlRoutes(app, options = {}) {
  const isDev = Boolean(options.isDev);
  const execFileImpl = options.execFileImpl || execFile;
  const dnsLookup = options.dnsLookup || defaultDnsLookup;
  const containerImage = options.dockerImage || "curlimages/curl";
  const runtimeResolver =
    options.runtimeResolver ||
    (() => defaultRuntimeResolver(options.runtimeExecFile || execFile));
  const ensureNoDockerMarker =
    options.ensureNoDockerMarker ||
    createNoDockerEnsurer({
      markerPath: options.noDockerMarkerPath || NODOCKER_MARKER_PATH,
      fsAccess: options.fsAccess || fs.access,
      fsWriteFile: options.fsWriteFile || fs.writeFile,
      logger: options.logger || console,
    });
  const runtimeOverride = options.containerRuntime;
  let runtimePromise = null;

  async function getContainerRuntime() {
    if (runtimeOverride) {
      return runtimeOverride;
    }

    if (!runtimePromise) {
      runtimePromise = runtimeResolver();
    }
    return runtimePromise;
  }

  app.post("/api/run-curl", async (req, res) => {
    let requestSpec;
    let containerRuntime;
    try {
      requestSpec = resolveRequestSpec(req.body);
      validateRequestSpec(requestSpec);

      const urlError = await validateTargetUrl(requestSpec.url, {
        isDev,
        dnsLookup,
      });
      if (urlError) {
        return res.status(400).json({ error: urlError });
      }

      containerRuntime = await getContainerRuntime();
      await ensureNoDockerMarker(containerRuntime);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const curlArgs = buildCurlArgs(requestSpec);
    const networkMode =
      isDev && isLocalDevTarget(requestSpec.url) ? "host" : "bridge";

    const containerArgs = [
      "run",
      "--rm",
      "--memory=64m",
      "--cpus=0.5",
      "--pids-limit=64",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      `--network=${networkMode}`,
      "--tmpfs=/tmp:rw,noexec,nosuid,size=16m",
      "--user=65534:65534",
      containerImage,
      ...curlArgs,
    ];

    execFileImpl(
      containerRuntime,
      containerArgs,
      {
        timeout: LIMITS.requestTimeoutMs,
        maxBuffer: LIMITS.maxOutputBytes,
      },
      (error, stdout, stderr) => {
        if (error) {
          return res.status(500).json({
            error: "Execution failed",
            details: stderr || error.message,
          });
        }

        return res.json({
          success: true,
          output: stdout,
        });
      },
    );
  });
}

module.exports = setupCurlRoutes;
module.exports.setupCurlRoutes = setupCurlRoutes;
module.exports.tokenizeCommand = tokenizeCommand;
module.exports.parseCurlCommand = parseCurlCommand;
module.exports.parseLegacyRequest = parseLegacyRequest;
module.exports.validateRequestSpec = validateRequestSpec;
module.exports.validateTargetUrl = validateTargetUrl;
module.exports.buildCurlArgs = buildCurlArgs;
module.exports.resolveRequestSpec = resolveRequestSpec;
module.exports.isBlockedIp = isBlockedIp;
module.exports.isLocalDevTarget = isLocalDevTarget;
module.exports.defaultRuntimeResolver = defaultRuntimeResolver;
module.exports.createNoDockerEnsurer = createNoDockerEnsurer;
