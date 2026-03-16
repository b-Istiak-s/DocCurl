function quoteDouble(value) {
  return `"${String(value ?? "").replace(/["\\]/g, "\\$&")}"`;
}

function quoteSinglePreferred(value) {
  const stringValue = String(value ?? "");
  if (!stringValue.includes("'")) {
    return `'${stringValue}'`;
  }
  return quoteDouble(stringValue);
}

function normalizeJsonData(dataToken) {
  try {
    const parsed = JSON.parse(String(dataToken ?? ""));
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

function formatDataLines(dataToken) {
  const prettyJson = normalizeJsonData(dataToken);
  if (!prettyJson) {
    return [`  -d ${quoteSinglePreferred(dataToken)} \\`];
  }

  const jsonLines = prettyJson.split("\n");
  if (jsonLines.length === 1) {
    return [`  -d '${jsonLines[0]}' \\`];
  }

  const lines = [`  -d '${jsonLines[0]}`];
  for (let index = 1; index < jsonLines.length; index += 1) {
    const isLast = index === jsonLines.length - 1;
    lines.push(`  ${jsonLines[index]}${isLast ? "' \\" : ""}`);
  }
  return lines;
}

export function formatCurlSpec(spec) {
  const lines = ["curl \\"];
  lines.push(`  -X ${String(spec.method || "GET").toUpperCase()} \\`);

  if (spec.url) {
    lines.push(`  ${quoteDouble(spec.url)} \\`);
  }

  for (const header of spec.headers || []) {
    lines.push(`  -H ${quoteDouble(`${header.name}: ${header.value}`)} \\`);
  }

  if (spec.body) {
    lines.push(...formatDataLines(spec.body));
  }

  for (const part of spec.formParts || []) {
    lines.push(`  -F ${quoteDouble(`${part.name}=${part.value}`)} \\`);
  }

  if (lines.length === 1) {
    return "curl";
  }

  lines[lines.length - 1] = lines[lines.length - 1].replace(/\s\\$/, "");
  return lines.join("\n");
}
