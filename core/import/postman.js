import { createContainer, ensureFolderPath } from "./folders.js";
import { buildQueryString, normalizeRequest, normalizeVariableReference } from "./utils.js";

function normalizePostmanUrl(urlValue) {
  if (typeof urlValue === "string") {
    return normalizeVariableReference(urlValue);
  }

  if (!urlValue || typeof urlValue !== "object") {
    return "";
  }

  if (typeof urlValue.raw === "string" && urlValue.raw.trim()) {
    return normalizeVariableReference(urlValue.raw);
  }

  const protocol = urlValue.protocol ? `${normalizeVariableReference(urlValue.protocol)}://` : "";
  const host = Array.isArray(urlValue.host)
    ? urlValue.host.map(normalizeVariableReference).join(".")
    : normalizeVariableReference(urlValue.host ?? "");
  const path = Array.isArray(urlValue.path)
    ? `/${urlValue.path.map(normalizeVariableReference).join("/")}`
    : urlValue.path
      ? `/${normalizeVariableReference(urlValue.path)}`
      : "";
  const query = buildQueryString(urlValue.query || []);

  return `${protocol}${host}${path}${query ? `?${query}` : ""}`;
}

function extractPostmanBody(body) {
  if (!body || typeof body !== "object") {
    return { rawBody: "", bodyFields: [], formParts: [] };
  }

  if (body.mode === "formdata") {
    return {
      rawBody: "",
      bodyFields: [],
      formParts: body.formdata || [],
    };
  }

  if (body.mode === "urlencoded") {
    const entries = (body.urlencoded || []).filter((entry) => entry && entry.key);
    return {
      rawBody: entries
        .map((entry) =>
          `${encodeURIComponent(entry.key)}=${encodeURIComponent(
            normalizeVariableReference(entry.value ?? ""),
          )}`,
        )
        .join("&"),
      bodyFields: entries.map((entry) => ({ name: String(entry.key) })),
      formParts: [],
    };
  }

  return {
    rawBody: typeof body.raw === "string" ? body.raw : "",
    bodyFields: [],
    formParts: [],
  };
}

function parsePostmanRequest(item) {
  const request = item?.request || {};
  const body = extractPostmanBody(request.body);
  const headers = (request.header || []).map((header) => ({
    name: String(header?.key ?? "").trim(),
    value: header?.value ?? "",
    disabled: Boolean(header?.disabled),
  }));
  const pathParams = (request.url?.variable || []).map((entry) => ({
    name: String(entry?.key ?? entry?.name ?? "").trim(),
  }));

  return normalizeRequest({
    name: item?.name || "",
    method: request.method || "GET",
    url: normalizePostmanUrl(request.url),
    headers,
    rawBody: body.rawBody,
    bodyFields: body.bodyFields,
    formParts: body.formParts,
    pathParams,
  });
}

function parseItemsIntoFolder(items, targetFolder) {
  (items || []).forEach((item) => {
    if (Array.isArray(item?.item)) {
      const nestedFolder = ensureFolderPath(targetFolder, item.name || "Folder");
      parseItemsIntoFolder(item.item, nestedFolder);
      return;
    }

    if (item?.request) {
      targetFolder.requests.push(parsePostmanRequest(item));
    }
  });
}

export function parsePostmanCollections(payload) {
  const source = payload?.format === "postman" && payload.collection ? payload.collection : payload;
  if (!source || typeof source !== "object") {
    throw new Error("Invalid Postman payload");
  }

  const container = createContainer(source.info?.name || source.name || "Postman Collection");
  parseItemsIntoFolder(source.item || [], container.rootFolder);
  return [container];
}
