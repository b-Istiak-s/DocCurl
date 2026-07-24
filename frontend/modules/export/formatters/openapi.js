// OpenAPI 3.1 exporter. Walks every curl block in the export model and
// assembles a single OpenAPI document. Paths are auto-derived from the URL
// (after the protocol + host), methods from -X/--request, request bodies from
// --doccurl-request-schema, responses from --doccurl-response-schema, and
// per-field descriptions from --doccurl-field-descriptions merged into the
// schema as `description` keywords.
//
// The exporter is intentionally conservative: when a block does not declare
// a schema, the body becomes an example. When no response schema is attached
// the operation gets a generic 200 response carrying the curl example body.
//
// Reuses the description styles from the playground's schema renderer so the
// field descriptions travel with the spec and consumers can render them
// straight from the JSON Schema without relying on external docs.

const MAX_OPENAPI_SCHEMA_BYTES = 16 * 1024;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return null;
  }
}

function shortHash(value) {
  let hash = 5381;
  const input = String(value ?? "");
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function normalizeMethod(method, fallback) {
  const upper = String(method || "").toUpperCase();
  if (upper) return upper;
  return fallback || "GET";
}

function splitUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) {
    return { path: "/", query: "", server: "" };
  }

  const [withoutQuery, queryText = ""] = url.split("?");
  let serverText = "";
  let pathText = withoutQuery;

  const protocolMatch = withoutQuery.match(/^([a-z][a-z0-9+.-]*):\/\/([^/]+)(\/.*)?$/i);
  if (protocolMatch) {
    serverText = `${protocolMatch[1]}://${protocolMatch[2]}`;
    pathText = protocolMatch[3] || "/";
  }

  if (!pathText.startsWith("/")) {
    pathText = `/${pathText}`;
  }

  return { path: pathText, query: queryText, server: serverText };
}

function detectPathParams(rawUrl) {
  const { path } = splitUrl(rawUrl);
  const params = [];
  const templated = path
    .split("/")
    .map((segment) => {
      const trimmed = segment.trim();
      if (!trimmed) return segment;
      if (
        /^\d+$/.test(trimmed) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
      ) {
        const name = `var${params.length + 1}`;
        params.push({ name, in: "path", required: true, schema: { type: "string" } });
        return `{${name}}`;
      }
      return segment;
    })
    .join("/");
  return { path: templated, pathParams: params };
}

function splitQuery(queryText) {
  if (!queryText) return [];
  return queryText
    .split("&")
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex === -1) return { name: entry, value: "" };
      return {
        name: entry.slice(0, separatorIndex),
        value: entry.slice(separatorIndex + 1),
      };
    })
    .filter((entry) => entry.name);
}

function buildServers(serverText) {
  if (!serverText) return [{ url: "/" }];
  return [{ url: serverText }];
}

function withFieldDescriptions(schema, fieldDescriptions) {
  if (!isPlainObject(schema) || !fieldDescriptions) return schema;
  const cloned = JSON.parse(JSON.stringify(schema));
  mergeDescriptionsInto(cloned, fieldDescriptions);
  return cloned;
}

function mergeDescriptionsInto(node, descriptions) {
  if (!isPlainObject(node)) return;
  if (isPlainObject(node.properties)) {
    for (const [name, sub] of Object.entries(node.properties)) {
      const direct = descriptions[name];
      if (typeof direct === "string" && !sub.description) {
        sub.description = direct;
      }
      mergeDescriptionsInto(sub, descriptions);
    }
  }
  if (isPlainObject(node.items)) {
    mergeDescriptionsInto(node.items, descriptions);
  }
}

function buildSchemaRef(request, components) {
  const schema = withFieldDescriptions(request.requestSchema, request.fieldDescriptions);
  if (!schema) return null;
  const key = safeStringify(schema);
  const refName = `Schema_${shortHash(key)}`;
  if (!components[refName]) {
    components[refName] = schema;
  }
  return { $ref: `#/components/schemas/${refName}` };
}

function buildResponseSchemaRef(request, components) {
  if (!request.responseSchema) return null;
  const schema = withFieldDescriptions(request.responseSchema, request.fieldDescriptions);
  const key = safeStringify(schema);
  const refName = `Schema_${shortHash(key)}`;
  if (!components[refName]) {
    components[refName] = schema;
  }
  return { $ref: `#/components/schemas/${refName}` };
}

function buildRequestBody(request, components) {
  if (!request.body && !request.formParts.length) return undefined;
  const content = {};

  if (request.body) {
    const mediaType = request.headers.some(
      (header) => String(header.name || "").toLowerCase() === "content-type" &&
        /json/i.test(header.value || ""),
    )
      ? "application/json"
      : "text/plain";
    const schemaRef = buildSchemaRef(request, components);
    if (schemaRef) {
      content[mediaType] = {
        schema: schemaRef,
        example: tryParseJson(request.body) ?? request.body,
      };
    } else {
      content[mediaType] = {
        schema: { type: "string" },
        example: tryParseJson(request.body) ?? request.body,
      };
    }
  }

  if (request.formParts.length > 0) {
    const schemaRef = buildSchemaRef(request, components);
    if (schemaRef) {
      content["multipart/form-data"] = {
        schema: schemaRef,
      };
    } else {
      const properties = {};
      const required = [];
      for (const part of request.formParts) {
        properties[part.name] = {
          type: part.type === "file" ? "string" : "string",
          format: part.type === "file" ? "binary" : undefined,
        };
        if (part.type !== "file") {
          required.push(part.name);
        }
      }
      content["multipart/form-data"] = {
        schema: {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
      };
    }
  }

  return Object.keys(content).length > 0 ? { content } : undefined;
}

function tryParseJson(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed;
  } catch (error) {
    return null;
  }
}

function buildResponses(request, components) {
  const responses = {};
  const schemaRef = buildResponseSchemaRef(request, components);
  if (schemaRef) {
    responses["200"] = {
      description: "Successful response",
      content: {
        "application/json": {
          schema: schemaRef,
        },
      },
    };
  } else {
    responses["200"] = {
      description: "Successful response",
      content: {
        "text/plain": {
          schema: { type: "string" },
        },
      },
    };
  }
  return responses;
}

function buildQueryParameters(queryText) {
  return splitQuery(queryText).map((entry) => ({
    name: entry.name,
    in: "query",
    schema: { type: "string" },
    example: entry.value,
  }));
}

function buildHeaderParameters(request) {
  return (request.headers || []).map((header) => ({
    name: header.name,
    in: "header",
    schema: { type: "string" },
    example: header.value,
  }));
}

function buildOperation(request, components) {
  const { path, pathParams } = detectPathParams(request.url);
  const queryParams = buildQueryParameters(splitUrl(request.url).query);
  const headerParams = buildHeaderParameters(request);

  const parameters = [...pathParams, ...queryParams, ...headerParams] || [];

  const operation = {
    summary: request.name,
    description: [
      request.fieldDescriptions
        ? "### Field descriptions\n" +
          Object.entries(request.fieldDescriptions)
            .map(([name, text]) => `- \`${name}\` — ${String(text ?? "").trim()}`)
            .filter((entry) => !entry.endsWith("—"))
            .join("\n")
        : null,
    ]
      .filter(Boolean)
      .join("\n\n") || undefined,
    parameters: parameters.length > 0 ? parameters : undefined,
  };

  const requestBody = buildRequestBody(request, components);
  if (requestBody) {
    operation.requestBody = requestBody;
  }

  operation.responses = buildResponses(request, components);

  return { path, operation };
}

function buildPaths(model, components) {
  const paths = {};
  for (const group of model.groups) {
    for (const block of group.requests) {
      const { method, url } = block.request;
      const derivedMethod = normalizeMethod(method);
      const { path, operation } = buildOperation(block.request, components);
      if (!paths[path]) {
        paths[path] = {};
      }
      const existing = paths[path][derivedMethod.toLowerCase()];
      if (existing) {
        paths[path][derivedMethod.toLowerCase()] = mergeOperations(existing, operation);
      } else {
        paths[path][derivedMethod.toLowerCase()] = operation;
      }
    }
  }
  return paths;
}

function mergeOperations(a, b) {
  const merged = { ...a, ...b };
  if (a.summary || b.summary) {
    merged.summary = [a.summary, b.summary].filter(Boolean).join(" / ");
  }
  if (a.description || b.description) {
    merged.description = [a.description, b.description].filter(Boolean).join("\n\n---\n\n");
  }
  if (a.parameters || b.parameters) {
    merged.parameters = [...(a.parameters || []), ...(b.parameters || [])];
  }
  return merged;
}

export function buildOpenApiSpec(model, { title = "DocCurl Export", version = "1.0.0" } = {}) {
  const components = {};
  const paths = buildPaths(model, components);
  const firstServer = model.groups
    .flatMap((group) => group.requests)
    .map((block) => splitUrl(block.request.url).server)
    .find((value) => value);

  return {
    openapi: "3.1.0",
    info: {
      title,
      version,
      description: model.exportedAt
        ? `Generated from DocCurl on ${model.exportedAt}.`
        : "Generated from DocCurl.",
    },
    servers: buildServers(firstServer),
    paths,
    components: {
      schemas: components,
    },
  };
}

export function formatOpenApiExport(model, options) {
  return buildOpenApiSpec(model, options);
}

export const __test__ = {
  buildOpenApiSpec,
  detectPathParams,
  splitUrl,
  splitQuery,
  withFieldDescriptions,
  buildOperation,
  buildRequestBody,
  buildResponses,
  MAX_OPENAPI_SCHEMA_BYTES,
};
