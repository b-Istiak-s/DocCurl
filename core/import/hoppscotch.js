import { createContainer, ensureFolderPath } from "./folders.js";
import { buildQueryString, normalizeRequest, normalizeVariableReference } from "./utils.js";

function extractHoppscotchBody(body) {
  if (!body || typeof body !== "object") {
    return { rawBody: "", bodyFields: [], formParts: [] };
  }

  if (body.contentType === "multipart/form-data" && Array.isArray(body.form)) {
    return {
      rawBody: "",
      bodyFields: [],
      formParts: body.form || [],
    };
  }

  return {
    rawBody: typeof body.body === "string" ? body.body : "",
    bodyFields: [],
    formParts: [],
  };
}

function parseHoppscotchRequest(request) {
  const body = extractHoppscotchBody(request.body);

  return normalizeRequest({
    name: request.name || "",
    method: request.method || "GET",
    url: normalizeHoppscotchUrl(request),
    headers: (request.headers || []).map((header) => ({
      name: String(header?.key ?? "").trim(),
      value: header?.value ?? "",
      active: header?.active !== false,
    })),
    rawBody: body.rawBody,
    bodyFields: body.bodyFields,
    formParts: body.formParts,
  });
}

function normalizeHoppscotchUrl(request) {
  if (typeof request?.endpoint === "string" && request.endpoint.trim()) {
    const query = buildQueryString(request.params || [], "key", "value");
    return `${normalizeVariableReference(request.endpoint)}${query ? `?${query}` : ""}`;
  }

  const baseUrl = normalizeVariableReference(request?.url || "");
  const path = normalizeVariableReference(request?.path || "");
  const query = buildQueryString(request?.rawParams || request?.params || [], "key", "value");
  return `${baseUrl}${path}${query ? `?${query}` : ""}`;
}

function parseFolder(folder, targetFolder) {
  const nestedFolder = ensureFolderPath(targetFolder, folder?.name || "Folder");
  (folder?.requests || []).forEach((request) => {
    nestedFolder.requests.push(parseHoppscotchRequest(request));
  });
  (folder?.folders || []).forEach((childFolder) => {
    parseFolder(childFolder, nestedFolder);
  });
}

export function parseHoppscotchCollections(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid Hoppscotch payload");
  }

  const collections = Array.isArray(payload.collections) ? payload.collections : [payload];

  return collections.map((collection) => {
    const container = createContainer(collection.name || "Hoppscotch Collection");
    (collection.requests || []).forEach((request) => {
      container.rootFolder.requests.push(parseHoppscotchRequest(request));
    });
    (collection.folders || []).forEach((folder) => {
      parseFolder(folder, container.rootFolder);
    });
    return container;
  });
}
