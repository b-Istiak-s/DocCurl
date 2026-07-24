export const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
]);

export const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const DATA_FLAGS = new Set([
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
]);

export const FORM_FLAGS = new Set(["-F", "--form"]);

export const DOCCURL_SCHEMA_FLAGS = new Set([
  "--doccurl-request-schema",
  "--doccurl-response-schema",
  "--doccurl-field-descriptions",
]);

export const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "host.docker.internal",
  "gateway.docker.internal",
  "docker.internal",
  "metadata.google.internal",
  "metadata",
]);

export const BLOCKED_IPV4_CIDRS = [
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

export const BLOCKED_IPV6_CIDRS = [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["::ffff:0:0", 96],
];

export const LIMITS = {
  maxCommandLength: 20_000,
  maxUrlLength: 2_048,
  maxHeaders: 40,
  maxHeaderNameLength: 128,
  maxHeaderValueLength: 2_048,
  maxBodyBytes: 64 * 1024,
  maxFormParts: 12,
  maxUploadFileBytes: 10 * 1024 * 1024,
  maxUploadTotalBytes: 25 * 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  requestTimeoutMs: 5_000,
  maxSchemaBytes: 16 * 1024,
  maxDescriptionsBytes: 16 * 1024,
};

export const CURL_RESPONSE_META_START = "__DOCCURL_META_START__";
export const CURL_RESPONSE_META_END = "__DOCCURL_META_END__";

export const NODOCKER_MARKER_PATH = "/etc/containers/nodocker";
export const RUNTIME_CHECK_TIMEOUT_MS = 1_500;
