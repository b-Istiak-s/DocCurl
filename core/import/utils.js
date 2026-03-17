function normalizeVariableReference(value) {
  return String(value ?? "")
    .replace(
      /\{\{\s*(?:(?:[_$]\.)?([A-Za-z_][A-Za-z0-9_]*))\s*\}\}/g,
      (_match, name) => `$${name}`,
    )
    .replace(/<<\s*([A-Za-z_][A-Za-z0-9_]*)\s*>>/g, (_match, name) => `$${name}`);
}

function splitFolderPathSegments(name) {
  const segments = String(name ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return [];
  }

  const lastIndex = segments.length - 1;
  segments[lastIndex] = segments[lastIndex].replace(/\.md$/i, "").trim();
  return segments.filter(Boolean);
}

function uniqueByName(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.name;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function flattenJsonFields(value, prefix = "", result = []) {
  if (Array.isArray(value)) {
    if (prefix) {
      result.push({ name: `${prefix}[]` });
    }

    value.forEach((entry) => {
      if (entry && typeof entry === "object") {
        flattenJsonFields(entry, prefix ? `${prefix}[]` : "[]", result);
      }
    });
    return result;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (entry && typeof entry === "object") {
        flattenJsonFields(entry, nextPrefix, result);
      } else {
        result.push({ name: nextPrefix });
      }
    });
    return result;
  }

  if (prefix) {
    result.push({ name: prefix });
  }
  return result;
}

function safeParseJson(text) {
  try {
    return JSON.parse(String(text ?? ""));
  } catch {
    return null;
  }
}

function safeParseUrl(rawUrl) {
  const normalizedUrl = normalizeVariableReference(rawUrl).trim();
  if (!normalizedUrl) {
    return {
      url: "",
      pathname: "",
      queryParams: [],
      pathParams: [],
    };
  }

  let urlForParsing = normalizedUrl;
  let strippedBaseVariable = false;

  if (/^\$[A-Za-z_][A-Za-z0-9_]*(?:\/|$)/.test(urlForParsing)) {
    urlForParsing = urlForParsing.replace(/^\$[A-Za-z_][A-Za-z0-9_]*/, "");
    strippedBaseVariable = true;
  }

  try {
    const parsed = new URL(urlForParsing, "https://doccurl.local");
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const pathParams = pathSegments
      .map((segment, index) => {
        if (segment.startsWith(":")) {
          return { name: segment.slice(1) };
        }
        if (segment.startsWith("$")) {
          if (strippedBaseVariable && index === 0) {
            return null;
          }
          return { name: segment.slice(1) };
        }
        return null;
      })
      .filter(Boolean);

    return {
      url: normalizedUrl,
      pathname: parsed.pathname,
      queryParams: Array.from(parsed.searchParams.keys()).map((name) => ({ name })),
      pathParams: uniqueByName(pathParams),
    };
  } catch {
    return {
      url: normalizedUrl,
      pathname: "",
      queryParams: [],
      pathParams: [],
    };
  }
}

function normalizeHeaderList(headers, { keyField = "key", valueField = "value" } = {}) {
  return uniqueByName(
    (headers || [])
      .filter((header) => header && !header.disabled && header.active !== false)
      .map((header) => ({
        name: String(header[keyField] ?? header.name ?? "").trim(),
        value: normalizeVariableReference(header[valueField] ?? header.value ?? ""),
      }))
      .filter((header) => header.name),
  );
}

function buildQueryString(entries, nameField = "key", valueField = "value") {
  return (entries || [])
    .filter((entry) => entry && !entry.disabled && entry.active !== false)
    .map((entry) => {
      const key = String(entry[nameField] ?? entry.name ?? "").trim();
      const value = normalizeVariableReference(entry[valueField] ?? entry.value ?? "");
      return key ? `${encodeURIComponent(key)}=${encodeURIComponent(value)}` : "";
    })
    .filter(Boolean)
    .join("&");
}

function normalizeFormPartValue(part) {
  if (part.type === "file") {
    if (typeof part.src === "string" && part.src.trim()) {
      return `@${part.src.trim()}`;
    }
    if (Array.isArray(part.src) && typeof part.src[0] === "string" && part.src[0].trim()) {
      return `@${part.src[0].trim()}`;
    }
    if (typeof part.fileName === "string" && part.fileName.trim()) {
      return `@${part.fileName.trim()}`;
    }
    return "@file";
  }

  return normalizeVariableReference(part.value ?? "");
}

function normalizeFormParts(formParts = []) {
  return uniqueByName(
    formParts
      .filter((part) => part && !part.disabled && part.active !== false)
      .map((part) => ({
        name: String(part.key ?? part.name ?? "").trim(),
        type: part.type === "file" || part.isFile ? "file" : "text",
        value: normalizeFormPartValue(part),
      }))
      .filter((part) => part.name),
  );
}

function normalizeRequest({
  name,
  method = "GET",
  url = "",
  headers = [],
  rawBody = "",
  bodyFields = [],
  formParts = [],
  pathParams = [],
  queryParams = [],
}) {
  const normalizedUrl = safeParseUrl(url);
  const normalizedHeaders = normalizeHeaderList(headers, { keyField: "name", valueField: "value" });
  const normalizedBody = normalizeVariableReference(rawBody);
  const normalizedFormParts = normalizeFormParts(formParts);
  const normalizedBodyFields =
    bodyFields.length > 0
      ? uniqueByName(bodyFields.map((field) => ({ name: field.name })))
      : (() => {
          const parsedJson = safeParseJson(normalizedBody);
          return parsedJson ? uniqueByName(flattenJsonFields(parsedJson)) : [];
        })();

  return {
    name: String(name || `${String(method || "GET").toUpperCase()} ${normalizedUrl.url || "/"}`).trim(),
    method: String(method || "GET").toUpperCase(),
    url: normalizedUrl.url,
    headers: normalizedHeaders,
    queryParams: uniqueByName([...queryParams.map((item) => ({ name: item.name })), ...normalizedUrl.queryParams]),
    pathParams: uniqueByName([...pathParams.map((item) => ({ name: item.name })), ...normalizedUrl.pathParams]),
    bodyFields: normalizedBodyFields,
    formFields: uniqueByName(normalizedFormParts.map((part) => ({ name: part.name }))),
    rawBody: normalizedBody,
    curlSpec: {
      method: String(method || "GET").toUpperCase(),
      url: normalizedUrl.url,
      headers: normalizedHeaders,
      body: normalizedFormParts.length > 0 ? "" : normalizedBody,
      formParts: normalizedFormParts,
    },
  };
}

export {
  buildQueryString,
  flattenJsonFields,
  normalizeFormParts,
  normalizeHeaderList,
  normalizeRequest,
  normalizeVariableReference,
  safeParseJson,
  safeParseUrl,
  splitFolderPathSegments,
  uniqueByName,
};
