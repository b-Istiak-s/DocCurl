import {
  buildFieldDescriptionText,
  buildFormParts,
  buildSchemaMetadata,
  mapPlaceholders,
  toHeaderList,
} from "./shared.js";
import { buildGroupFolderTree } from "./folders.js";

function splitPostmanQuery(queryText) {
  if (!queryText) {
    return [];
  }

  return queryText
    .split("&")
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex === -1) {
        return { key: entry, value: "" };
      }
      return {
        key: entry.slice(0, separatorIndex),
        value: entry.slice(separatorIndex + 1),
      };
    })
    .filter((entry) => entry.key);
}

function buildPostmanUrl(rawUrl) {
  const raw = mapPlaceholders(rawUrl, "double-brace");
  if (!raw) {
    return { raw: "" };
  }

  const [withoutQuery, queryText = ""] = raw.split("?");
  let protocol = "";
  let hostText = withoutQuery;
  let pathText = "";

  const protocolMatch = withoutQuery.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
  if (protocolMatch) {
    protocol = protocolMatch[1];
    hostText = protocolMatch[2];
  }

  const slashIndex = hostText.indexOf("/");
  if (slashIndex >= 0) {
    pathText = hostText.slice(slashIndex + 1);
    hostText = hostText.slice(0, slashIndex);
  }

  const path = pathText
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const variable = path
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => ({ key: segment.slice(1) }));
  const url = { raw };

  if (protocol) {
    url.protocol = protocol;
  }
  if (hostText) {
    url.host = hostText.split(".").filter(Boolean);
  }
  if (path.length > 0) {
    url.path = path;
  }

  const query = splitPostmanQuery(queryText);
  if (query.length > 0) {
    url.query = query;
  }
  if (variable.length > 0) {
    url.variable = variable;
  }

  return url;
}

function buildRequestDescription(request) {
  if (!request) return undefined;
  const lines = [];
  const fieldDescriptionText = buildFieldDescriptionText(request);
  if (fieldDescriptionText) {
    lines.push("Field descriptions:");
    lines.push(fieldDescriptionText);
  }
  if (request.requestSchema) {
    lines.push("");
    lines.push("Request schema (JSON Schema 2020-12):");
    lines.push("```json");
    lines.push(JSON.stringify(request.requestSchema, null, 2));
    lines.push("```");
  }
  if (request.responseSchema) {
    lines.push("");
    lines.push("Response schema (JSON Schema 2020-12):");
    lines.push("```json");
    lines.push(JSON.stringify(request.responseSchema, null, 2));
    lines.push("```");
  }
  if (lines.length === 0) return undefined;
  return lines.join("\n");
}

function createPostmanItem(request) {
  const headers = toHeaderList(request.headers, "double-brace");
  const description = buildRequestDescription(request);
  const item = {
    name: request.name,
    request: {
      method: request.method,
      header: headers.map((header) => ({
        key: header.key,
        value: header.value,
      })),
      url: buildPostmanUrl(request.url),
    },
  };

  if (description) {
    item.request.description = description;
  }

  if (request.formParts.length > 0) {
    item.request.body = {
      mode: "formdata",
      formdata: buildFormParts(request.formParts, "double-brace").map((part) => ({
        key: part.name,
        type: part.type === "file" ? "file" : "text",
        src: part.type === "file" ? part.value : undefined,
        value: part.type === "text" ? part.value : undefined,
      })),
    };
  } else if (request.body) {
    item.request.body = {
      mode: "raw",
      raw: mapPlaceholders(request.body, "double-brace"),
      options: {
        raw: {
          language: "json",
        },
      },
    };
  }

  return item;
}

function renderPostmanFolder(folderNode) {
  const items = Array.from(folderNode.folders.values()).map((childFolder) =>
    renderPostmanFolder(childFolder),
  );
  items.push(...folderNode.requests.map((entry) => createPostmanItem(entry.request)));

  return {
    name: folderNode.name,
    item: items,
  };
}

export function formatPostmanExport(model) {
  const root = buildGroupFolderTree(model.groups);

  return {
    info: {
      name: "DocCurl Export",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: Array.from(root.folders.values()).map((folder) => renderPostmanFolder(folder)),
    variable: Object.entries(model.env).map(([key, value]) => ({
      key,
      value: String(value ?? ""),
      type: "string",
    })),
  };
}

export const __test__ = {
  buildRequestDescription,
  createPostmanItem,
  buildSchemaMetadata,
};
