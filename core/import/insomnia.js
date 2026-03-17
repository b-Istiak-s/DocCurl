import { createContainer, ensureFolderPath } from "./folders.js";
import { normalizeRequest } from "./utils.js";

function extractInsomniaBody(body) {
  if (!body || typeof body !== "object") {
    return { rawBody: "", bodyFields: [], formParts: [] };
  }

  if (body.mimeType === "multipart/form-data" && Array.isArray(body.params)) {
    return {
      rawBody: "",
      bodyFields: [],
      formParts: body.params || [],
    };
  }

  return {
    rawBody: typeof body.text === "string" ? body.text : "",
    bodyFields: [],
    formParts: [],
  };
}

function parseInsomniaRequest(resource) {
  const body = extractInsomniaBody(resource.body);

  return normalizeRequest({
    name: resource.name || "",
    method: resource.method || "GET",
    url: resource.url || "",
    headers: (resource.headers || []).map((header) => ({
      name: String(header?.name ?? "").trim(),
      value: header?.value ?? "",
      disabled: Boolean(header?.disabled),
    })),
    rawBody: body.rawBody,
    bodyFields: body.bodyFields,
    formParts: body.formParts,
  });
}

function buildGroupMap(resources) {
  const byParent = new Map();
  (resources || []).forEach((resource) => {
    const parentId = resource?.parentId || "";
    if (!byParent.has(parentId)) {
      byParent.set(parentId, []);
    }
    byParent.get(parentId).push(resource);
  });
  return byParent;
}

function parseGroupChildren(groupMap, parentId, targetFolder) {
  const children = groupMap.get(parentId) || [];

  children.forEach((resource) => {
    if (resource._type === "request_group") {
      const nestedFolder = ensureFolderPath(targetFolder, resource.name || "Folder");
      parseGroupChildren(groupMap, resource._id, nestedFolder);
      return;
    }

    if (resource._type === "request") {
      targetFolder.requests.push(parseInsomniaRequest(resource));
    }
  });
}

export function parseInsomniaCollections(payload) {
  const source = payload?.format === "insomnia" && payload.resources ? payload : payload;
  if (!source || !Array.isArray(source.resources)) {
    throw new Error("Invalid Insomnia payload");
  }

  const resources = source.resources;
  const workspaces = resources.filter((resource) => resource?._type === "workspace");
  const groupMap = buildGroupMap(resources);

  return workspaces.map((workspace) => {
    const container = createContainer(workspace.name || "Insomnia Workspace");
    parseGroupChildren(groupMap, workspace._id, container.rootFolder);
    return container;
  });
}
