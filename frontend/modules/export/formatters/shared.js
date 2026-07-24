const SCHEMA_FLAG_TO_LABEL = {
  requestSchema: "--doccurl-request-schema",
  responseSchema: "--doccurl-response-schema",
  fieldDescriptions: "--doccurl-field-descriptions",
};

const SCHEMA_OUTPUT_ORDER = ["requestSchema", "responseSchema", "fieldDescriptions"];

export function mapPlaceholders(value, syntax = "double-brace") {
  const text = String(value ?? "");
  if (syntax === "insomnia") {
    return text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\b/g, "{{ _.$1 }}");
  }
  if (syntax === "hoppscotch") {
    return text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\b/g, "<<$1>>");
  }
  return text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\b/g, "{{$1}}");
}

export function toHeaderList(headers, syntax) {
  return (headers || []).map((header) => ({
    key: header.name,
    value: mapPlaceholders(header.value, syntax),
  }));
}

export function buildFormParts(formParts, syntax) {
  return (formParts || []).map((part) => ({
    ...part,
    value: mapPlaceholders(part.value, syntax),
  }));
}

export function stringifySchema(schema) {
  if (schema === null || schema === undefined) {
    return null;
  }
  try {
    return JSON.stringify(schema);
  } catch (error) {
    return null;
  }
}

export function buildSchemaCommentBlocks(request) {
  if (!request) return "";
  const blocks = [];
  for (const key of SCHEMA_OUTPUT_ORDER) {
    const json = stringifySchema(request[key]);
    if (!json) continue;
    const flagLabel = SCHEMA_FLAG_TO_LABEL[key];
    const headerLine = `# DocCurl ${flagLabel}:`;
    const bodyLines = json.split(/\r?\n/).map((line) => `# ${line}`);
    blocks.push([headerLine, ...bodyLines].join("\n"));
  }
  return blocks.join("\n\n");
}

export function buildSchemaFlagSnippet(request) {
  if (!request) return "";
  const fragments = [];
  for (const key of SCHEMA_OUTPUT_ORDER) {
    const json = stringifySchema(request[key]);
    if (!json) continue;
    fragments.push(`${SCHEMA_FLAG_TO_LABEL[key]}='${json.replace(/'/g, "'\\''")}'`);
  }
  return fragments.join(" \\\n  ");
}

export function buildFieldDescriptionText(request) {
  if (!request || !request.fieldDescriptions) return "";
  const entries = Object.entries(request.fieldDescriptions);
  if (entries.length === 0) return "";
  return entries
    .map(([name, text]) => `- \`${name}\` — ${String(text ?? "").trim()}`)
    .filter((entry) => !entry.endsWith("—"))
    .join("\n");
}

export function buildSchemaMetadata(request) {
  if (!request) return null;
  const payload = {};
  for (const key of SCHEMA_OUTPUT_ORDER) {
    if (request[key]) {
      payload[key] = request[key];
    }
  }
  if (Object.keys(payload).length === 0) return null;
  return payload;
}
