// JSON Schema 2020-12 documentation renderer with live diff.
//
// Exposes a single modal that can be opened from any playground. The modal
// shows two tabs (Request / Response). The Request tab renders the attached
// request schema as a five-column table. The Response tab renders the attached
// response schema as a five-column table and, when a recent response is
// available, overlays a live diff (missing/mismatch/extra rows) on top.

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeType(typeValue) {
  if (Array.isArray(typeValue)) {
    return [...new Set(typeValue.filter((t) => typeof t === "string"))];
  }
  if (typeof typeValue === "string") {
    return [typeValue];
  }
  return [];
}

function renderType(sub) {
  if (sub === true) return "any";
  if (sub === false) return "never";
  if (!isPlainObject(sub)) return "(unspecified)";

  const enumValues = Array.isArray(sub.enum) ? sub.enum : null;
  if (enumValues) {
    return `enum(${enumValues.map((v) => JSON.stringify(v)).join(" | ")})`;
  }

  const types = normalizeType(sub.type);
  if (types.length > 0) {
    const hasNull = types.includes("null");
    const nonNull = types.filter((t) => t !== "null");
    if (nonNull.length === 1 && hasNull) {
      return `${nonNull[0]} · nullable`;
    }
    if (hasNull && nonNull.length > 1) {
      return `${nonNull.join(" | ")} · nullable`;
    }
    if (types.length === 1 && types[0] === "array") {
      const items = sub.items;
      if (isPlainObject(items)) {
        return `array<${renderType(items)}>`;
      }
      return "array";
    }
    return types.join(" | ");
  }

  if (Array.isArray(sub.oneOf)) {
    return `oneOf(${sub.oneOf.map(renderType).join(", ")})`;
  }
  if (Array.isArray(sub.anyOf)) {
    return `anyOf(${sub.anyOf.map(renderType).join(", ")})`;
  }
  if (Array.isArray(sub.allOf)) {
    return `allOf(${sub.allOf.map(renderType).join(", ")})`;
  }

  return "(unspecified)";
}

function renderConstraints(sub) {
  if (!isPlainObject(sub)) return "";

  const chips = [];

  if (sub.const !== undefined) {
    chips.push(`constant: ${JSON.stringify(sub.const)}`);
  }

  if (Array.isArray(sub.enum)) {
    chips.push(`enum: ${sub.enum.map((v) => JSON.stringify(v)).join(", ")}`);
  }

  if (typeof sub.minimum === "number") chips.push(`≥ ${sub.minimum}`);
  if (typeof sub.maximum === "number") chips.push(`≤ ${sub.maximum}`);
  if (typeof sub.exclusiveMinimum === "number") chips.push(`> ${sub.exclusiveMinimum}`);
  if (typeof sub.exclusiveMaximum === "number") chips.push(`< ${sub.exclusiveMaximum}`);
  if (typeof sub.multipleOf === "number") chips.push(`multiple of ${sub.multipleOf}`);

  if (typeof sub.minLength === "number" && typeof sub.maxLength === "number") {
    chips.push(`length ${sub.minLength}–${sub.maxLength}`);
  } else {
    if (typeof sub.minLength === "number") chips.push(`length ≥ ${sub.minLength}`);
    if (typeof sub.maxLength === "number") chips.push(`length ≤ ${sub.maxLength}`);
  }
  if (typeof sub.pattern === "string") chips.push(`pattern /${sub.pattern}/`);
  if (typeof sub.format === "string") chips.push(`format: ${sub.format}`);

  if (typeof sub.minItems === "number" && typeof sub.maxItems === "number") {
    chips.push(`items ${sub.minItems}–${sub.maxItems}`);
  } else {
    if (typeof sub.minItems === "number") chips.push(`items ≥ ${sub.minItems}`);
    if (typeof sub.maxItems === "number") chips.push(`items ≤ ${sub.maxItems}`);
  }
  if (sub.uniqueItems === true) chips.push("unique items");

  if (sub.additionalProperties === false) {
    chips.push("closed object");
  } else if (isPlainObject(sub.additionalProperties)) {
    chips.push(`additional: ${renderType(sub.additionalProperties)}`);
  }

  if (isPlainObject(sub.patternProperties)) {
    const patterns = Object.keys(sub.patternProperties).join(", ");
    if (patterns) chips.push(`patterned keys: ${patterns}`);
  }

  if (typeof sub.minProperties === "number") chips.push(`properties ≥ ${sub.minProperties}`);
  if (typeof sub.maxProperties === "number") chips.push(`properties ≤ ${sub.maxProperties}`);

  if (typeof sub.contentEncoding === "string") {
    chips.push(`encoding: ${sub.contentEncoding}`);
  }
  if (typeof sub.contentMediaType === "string") {
    chips.push(`media type: ${sub.contentMediaType}`);
  }

  if (sub.default !== undefined) {
    chips.push(`default: ${JSON.stringify(sub.default)}`);
  }

  if (isPlainObject(sub.dependentRequired)) {
    for (const [dep, reqs] of Object.entries(sub.dependentRequired)) {
      if (Array.isArray(reqs)) {
        chips.push(`when ${dep} present, requires ${reqs.join(", ")}`);
      }
    }
  }

  return chips.join("; ");
}

function resolveDescription(path, schema, descriptions) {
  if (isPlainObject(descriptions)) {
    if (typeof descriptions[path] === "string") {
      return descriptions[path];
    }
    const leaf = path.split(/[.[\]]+/).filter(Boolean).pop();
    if (leaf && typeof descriptions[leaf] === "string") {
      return descriptions[leaf];
    }
  }
  if (isPlainObject(schema) && typeof schema.description === "string") {
    return schema.description;
  }
  return "";
}

function flattenProperties(properties, { required = [], descriptions, prefix = "", depth = 0 } = {}) {
  const rows = [];
  if (!isPlainObject(properties)) return rows;

  for (const [name, sub] of Object.entries(properties)) {
    if (!isPlainObject(sub)) continue;
    const fullName = prefix ? `${prefix}.${name}` : name;
    const isRequired = required.includes(name);
    const badges = [];
    if (sub.deprecated === true) badges.push("deprecated");
    if (sub.readOnly === true) badges.push("read-only");
    if (sub.writeOnly === true) badges.push("write-only");

    rows.push({
      path: fullName,
      type: renderType(sub),
      presence: isRequired ? "Required" : "Optional",
      constraints: renderConstraints(sub),
      description: resolveDescription(fullName, sub, descriptions),
      badges,
    });

    const types = normalizeType(sub.type);
    const isObject = types.length === 0 ? isPlainObject(sub.properties) : types.includes("object");
    if (isObject && isPlainObject(sub.properties) && depth === 0) {
      rows.push(
        ...flattenProperties(sub.properties, {
          required: Array.isArray(sub.required) ? sub.required : [],
          descriptions,
          prefix: fullName,
          depth: depth + 1,
        }),
      );
    }

    const isArray = types.length === 0 ? false : types.includes("array");
    const items = sub.items;
    if (
      isArray &&
      isPlainObject(items) &&
      isPlainObject(items.properties) &&
      depth === 0
    ) {
      const itemRequired = Array.isArray(items.required) ? items.required : [];
      rows.push(
        ...flattenProperties(items.properties, {
          required: itemRequired,
          descriptions,
          prefix: `${fullName}[]`,
          depth: depth + 1,
        }),
      );
    }
  }

  return rows;
}

function buildRows(schema, descriptions) {
  if (!isPlainObject(schema)) return [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = isPlainObject(schema.properties) ? schema.properties : null;
  if (!properties) return [];
  return flattenProperties(properties, {
    required,
    descriptions,
  });
}

function isTypeCompatible(sub, observedType) {
  if (!isPlainObject(sub)) return true;
  const allowed = new Set();
  if (Array.isArray(sub.type)) {
    for (const t of sub.type) allowed.add(t);
  } else if (typeof sub.type === "string") {
    allowed.add(sub.type);
  }
  if (allowed.size === 0) return true;
  if (allowed.has(observedType)) return true;
  if (observedType === "number" && allowed.has("integer")) return true;
  if (observedType === "integer" && allowed.has("number")) return true;
  if (typeof observedType === "string" && observedType.startsWith("array<") && allowed.has("array")) {
    return true;
  }
  if (Array.isArray(sub.anyOf)) {
    for (const branch of sub.anyOf) {
      if (isTypeCompatible(branch, observedType)) return true;
    }
  }
  if (Array.isArray(sub.oneOf)) {
    for (const branch of sub.oneOf) {
      if (isTypeCompatible(branch, observedType)) return true;
    }
  }
  return false;
}

function computeResponseDiff(responseSchema, responseFields) {
  if (!isPlainObject(responseSchema)) {
    return { error: "No response schema attached." };
  }
  if (!isPlainObject(responseFields) || !Array.isArray(responseFields.fields)) {
    return { error: "Run the request to see a diff." };
  }
  if (responseSchema.type !== "object" || !isPlainObject(responseSchema.properties)) {
    return { error: "Response schema is not an object schema; cannot diff." };
  }

  const observed = new Map(responseFields.fields.map((f) => [f.name, f]));
  const declared = Object.entries(responseSchema.properties);
  const matches = [];
  const missing = [];
  const mismatches = [];
  const extra = [];

  for (const [name, sub] of declared) {
    if (!observed.has(name)) {
      missing.push({ name, sub });
      continue;
    }
    const observedField = observed.get(name);
    if (isTypeCompatible(sub, observedField.type)) {
      matches.push({ name, sub, observed: observedField });
    } else {
      mismatches.push({ name, sub, observed: observedField });
    }
  }

  if (responseSchema.additionalProperties === false) {
    for (const [name, observedField] of observed) {
      if (!responseSchema.properties[name]) {
        extra.push({ name, observed: observedField });
      }
    }
  }

  return { matches, missing, mismatches, extra };
}

function escapeText(value) {
  return String(value ?? "");
}

function buildTable(rows, { withDiff = false, descriptions = null } = {}) {
  const table = document.createElement("table");
  table.className = "schemaTable";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Field", "Type", "Presence", "Constraints", "Description"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    if (withDiff && row.diffState && row.diffState !== "none") {
      tr.className = `schemaDiffRow--${row.diffState}`;
    }
    for (const key of ["path", "type", "presence", "constraints", "description"]) {
      const td = document.createElement("td");
      if (key === "type") {
        td.className = "schemaType";
      }
      if (key === "presence" && row.presence === "Required") {
        td.className = "schemaRequired";
      }
      td.textContent = escapeText(row[key]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function buildDiffTable(diff) {
  const wrap = document.createElement("div");
  wrap.className = "schemaDiff";

  if (diff.error) {
    const p = document.createElement("p");
    p.className = "schemaEmpty";
    p.textContent = diff.error;
    wrap.appendChild(p);
    return wrap;
  }

  function appendSection(label, entries, state) {
    if (entries.length === 0) return;
    const header = document.createElement("h4");
    header.className = "schemaDiffHeader";
    header.textContent = `${label} (${entries.length})`;
    wrap.appendChild(header);
    const rows = entries.map((entry) => ({
      path: entry.name,
      type: renderType(entry.sub || entry.observed),
      presence: "",
      constraints: state === "match" ? "type matches" : state === "mismatch" ? `expected, observed ${entry.observed?.type || "?"}` : state === "missing" ? "not present in response" : "not declared in schema",
      description: resolveDescription(entry.name, entry.sub, null),
      diffState: state,
    }));
    wrap.appendChild(buildTable(rows, { withDiff: true }));
  }

  appendSection("Matches", diff.matches, "match");
  appendSection("Type mismatches", diff.mismatches, "mismatch");
  appendSection("Missing from response", diff.missing, "missing");
  appendSection("Extra in response", diff.extra, "extra");

  if (
    diff.matches.length === 0 &&
    diff.mismatches.length === 0 &&
    diff.missing.length === 0 &&
    diff.extra.length === 0
  ) {
    const p = document.createElement("p");
    p.className = "schemaEmpty";
    p.textContent = "Schema and response agree on every property.";
    wrap.appendChild(p);
  }

  return wrap;
}

function createElement(tag, { className, text, hidden } = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  if (hidden) el.hidden = true;
  return el;
}

export function createSchemaSystem({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) {
  if (!documentRef) {
    throw new Error("createSchemaSystem requires a document reference");
  }

  let modal = null;
  let tabBar = null;
  let body = null;
  let requestTab = null;
  let responseTab = null;
  let activeTab = "request";

  function ensureModal() {
    if (modal) return;

    modal = createElement("div", { className: "schemaModal", hidden: true });
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Request and response schemas");

    const card = createElement("div", { className: "schemaCard" });
    const header = createElement("div", { className: "schemaHeader" });
    const title = createElement("h3", { text: "Schemas" });
    const closeBtn = createElement("button", {
      className: "schemaCloseBtn secondaryBtn",
      text: "Close",
    });
    closeBtn.type = "button";
    closeBtn.addEventListener("click", () => close());
    header.append(title, closeBtn);

    tabBar = createElement("div", { className: "schemaTabBar" });
    requestTab = createElement("button", {
      className: "schemaTab",
      text: "Request",
    });
    responseTab = createElement("button", {
      className: "schemaTab",
      text: "Response",
    });
    requestTab.type = "button";
    responseTab.type = "button";
    requestTab.addEventListener("click", () => setActiveTab("request"));
    responseTab.addEventListener("click", () => setActiveTab("response"));
    tabBar.append(requestTab, responseTab);

    body = createElement("div", { className: "schemaBody" });

    const footer = createElement("div", { className: "schemaFooter" });
    footer.append(createElement("span", {
      className: "schemaFooterHint",
      text: "Schemas travel with the curl block in the source Markdown.",
    }));

    card.append(header, tabBar, body, footer);
    modal.append(card);

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        close();
      }
    });

    if (documentRef.body) {
      documentRef.body.appendChild(modal);
    }
  }

  function setActiveTab(name) {
    activeTab = name;
    if (requestTab) requestTab.setAttribute("aria-selected", String(name === "request"));
    if (responseTab) responseTab.setAttribute("aria-selected", String(name === "response"));
    renderActive();
  }

  function renderEmpty(message) {
    body.replaceChildren();
    const p = createElement("p", { className: "schemaEmpty", text: message });
    body.appendChild(p);
  }

  let lastPayload = null;

  function renderActive() {
    if (!body || !lastPayload) return;
    const { requestSchema, responseSchema, fieldDescriptions, responseFields, responseLabel } = lastPayload;

    if (activeTab === "request") {
      if (!requestSchema) {
        renderEmpty(
          "No request schema attached. Add --doccurl-request-schema '...' to the curl block in the source Markdown.",
        );
        return;
      }
      const rows = buildRows(requestSchema, fieldDescriptions);
      if (rows.length === 0) {
        renderEmpty("Schema has no properties to document.");
        return;
      }
      body.replaceChildren(buildTable(rows));
    } else {
      if (!responseSchema) {
        renderEmpty(
          "No response schema attached. Add --doccurl-response-schema '...' to the curl block in the source Markdown.",
        );
        return;
      }
      const rows = buildRows(responseSchema, fieldDescriptions);
      const wrap = createElement("div", { className: "schemaResponseWrap" });
      if (rows.length > 0) {
        wrap.appendChild(buildTable(rows));
      }
      if (responseLabel) {
        const label = createElement("p", {
          className: "schemaDiffLabel",
          text: `Live diff against ${responseLabel}`,
        });
        wrap.appendChild(label);
      }
      const diff = computeResponseDiff(responseSchema, responseFields);
      wrap.appendChild(buildDiffTable(diff));
      body.replaceChildren(wrap);
    }
  }

  function setTabAvailability(hasRequest, hasResponse) {
    if (requestTab) {
      requestTab.hidden = !hasRequest;
      requestTab.disabled = !hasRequest;
    }
    if (responseTab) {
      responseTab.hidden = !hasResponse;
      responseTab.disabled = !hasResponse;
    }
  }

  function open(payload) {
    ensureModal();
    const data = payload || {};
    lastPayload = {
      requestSchema: data.requestSchema || null,
      responseSchema: data.responseSchema || null,
      fieldDescriptions: data.fieldDescriptions || null,
      responseFields: data.responseFields || null,
      responseLabel: data.responseLabel || null,
    };

    const hasRequest = Boolean(lastPayload.requestSchema);
    const hasResponse = Boolean(lastPayload.responseSchema);
    setTabAvailability(hasRequest, hasResponse);

    if (!hasRequest && !hasResponse) {
      renderEmpty(
        "This request has no schema attached. Add --doccurl-request-schema '...' and/or --doccurl-response-schema '...' to the curl block in the source Markdown to enable schema inspection.",
      );
    } else {
      setActiveTab(hasRequest ? "request" : "response");
    }

    modal.hidden = false;
  }

  function close() {
    if (!modal) return;
    modal.hidden = true;
  }

  function isOpen() {
    return Boolean(modal && !modal.hidden);
  }

  if (windowRef && typeof windowRef.addEventListener === "function") {
    const handler = (event) => {
      if (event.key === "Escape" && isOpen()) {
        close();
      }
    };
    windowRef.addEventListener("keydown", handler);
  }

  return {
    open,
    close,
    isOpen,
  };
}

// Internal helpers exposed for tests.
export const __test__ = {
  buildRows,
  computeResponseDiff,
  renderType,
  renderConstraints,
  isTypeCompatible,
};
