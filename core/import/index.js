import { parseHoppscotchCollections } from "./hoppscotch.js";
import { parseInsomniaCollections } from "./insomnia.js";
import { renderCollectionsToMarkdown } from "./markdown/render.js";
import { parsePostmanCollections } from "./postman.js";

export function detectImportFormat(payload) {
  if (
    payload?.format === "postman" ||
    payload?.collection?.info?.schema?.includes?.("postman") ||
    payload?.info?.schema?.includes?.("postman")
  ) {
    return "postman";
  }

  if (
    payload?.format === "insomnia" ||
    Array.isArray(payload?.resources) ||
    payload?._type === "export"
  ) {
    return "insomnia";
  }

  if (
    payload?.format === "hoppscotch" ||
    Array.isArray(payload?.collections) ||
    ((Array.isArray(payload?.folders) || Array.isArray(payload?.requests)) &&
      (payload?.v === "2" || payload?.v === 2))
  ) {
    return "hoppscotch";
  }

  throw new Error("Unable to detect import format");
}

export function parseImportedCollections(payload, format = "auto") {
  const resolvedFormat = format === "auto" ? detectImportFormat(payload) : format;

  if (resolvedFormat === "postman") {
    return parsePostmanCollections(payload);
  }
  if (resolvedFormat === "insomnia") {
    return parseInsomniaCollections(payload);
  }
  if (resolvedFormat === "hoppscotch") {
    return parseHoppscotchCollections(payload);
  }

  throw new Error(`Unsupported import format: ${resolvedFormat}`);
}

export { renderCollectionsToMarkdown };
