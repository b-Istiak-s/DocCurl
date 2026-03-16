function downloadBlobFile(
  filename,
  payload,
  {
    documentRef = globalThis.document,
    urlRef = globalThis.URL,
    blobFactory = (content, options) => new Blob(content, options),
    mimeType = "application/octet-stream",
  } = {},
) {
  const blob = blobFactory([payload], {
    type: mimeType,
  });
  const url = urlRef.createObjectURL(blob);
  const link = documentRef.createElement("a");

  link.href = url;
  link.download = filename;
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
  urlRef.revokeObjectURL(url);
}

export function downloadJsonFile(filename, payload, options = {}) {
  downloadBlobFile(filename, JSON.stringify(payload, null, 2), {
    ...options,
    mimeType: "application/json",
  });
}

export function downloadBinaryFile(filename, payload, options = {}) {
  downloadBlobFile(filename, payload, {
    ...options,
    mimeType: options.mimeType || "application/octet-stream",
  });
}
