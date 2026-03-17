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
