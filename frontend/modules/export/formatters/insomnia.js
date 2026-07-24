import {
  buildFieldDescriptionText,
  buildFormParts,
  buildSchemaMetadata,
  mapPlaceholders,
} from "./shared.js";

function buildRequestBody(request) {
  if (request.formParts.length > 0) {
    return {
      mimeType: "multipart/form-data",
      params: buildFormParts(request.formParts, "insomnia").map((part) => ({
        name: part.name,
        value: part.value,
        type: part.type === "file" ? "file" : "text",
        fileName: part.type === "file" ? part.filename : undefined,
      })),
    };
  }

  if (!request.body) {
    return {};
  }

  return {
    mimeType: "text/plain",
    text: mapPlaceholders(request.body, "insomnia"),
  };
}

function buildInsomniaDescription(request) {
  if (!request) return "";
  const sections = [];
  const fieldDescriptionText = buildFieldDescriptionText(request);
  if (fieldDescriptionText) {
    sections.push("Field descriptions:\n" + fieldDescriptionText);
  }
  if (request.requestSchema) {
    sections.push(
      "Request schema (JSON Schema 2020-12):\n```json\n" +
        JSON.stringify(request.requestSchema, null, 2) +
        "\n```",
    );
  }
  if (request.responseSchema) {
    sections.push(
      "Response schema (JSON Schema 2020-12):\n```json\n" +
        JSON.stringify(request.responseSchema, null, 2) +
        "\n```",
    );
  }
  return sections.join("\n\n");
}

export function formatInsomniaExport(model) {
  const workspaceId = "wrk_doccurl_export";
  const environmentId = "env_doccurl_export";
  const resources = [
    {
      _id: workspaceId,
      _type: "workspace",
      name: "DocCurl Export",
      description: "",
      created: model.exportedAt,
      updated: model.exportedAt,
      scope: "collection",
    },
    {
      _id: environmentId,
      _type: "environment",
      parentId: workspaceId,
      name: "DocCurl Environment",
      data: Object.fromEntries(
        Object.entries(model.env).map(([key, value]) => [key, String(value ?? "")]),
      ),
    },
  ];

  model.groups.forEach((group, groupIndex) => {
    const folderId = `fld_doccurl_${groupIndex}`;
    resources.push({
      _id: folderId,
      _type: "request_group",
      parentId: workspaceId,
      name: group.docPath,
      created: model.exportedAt,
      updated: model.exportedAt,
    });

    group.requests.forEach((entry, requestIndex) => {
      const description = buildInsomniaDescription(entry.request);
      const meta = buildSchemaMetadata(entry.request) || {};
      resources.push({
        _id: `req_doccurl_${groupIndex}_${requestIndex}`,
        _type: "request",
        parentId: folderId,
        name: entry.request.name,
        method: entry.request.method,
        url: mapPlaceholders(entry.request.url, "insomnia"),
        headers: entry.request.headers.map((header) => ({
          name: header.name,
          value: mapPlaceholders(header.value, "insomnia"),
        })),
        body: buildRequestBody(entry.request),
        description,
        meta: {
          ...meta,
          "doccurl://note": "Schemas and field descriptions are documentation only; they are not executed by Insomnia.",
        },
      });
    });
  });

  return {
    _type: "export",
    __export_format: 4,
    __export_date: model.exportedAt,
    __export_source: "doccurl",
    resources,
  };
}
