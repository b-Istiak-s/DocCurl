import { replaceEditedCurlBlocks } from "./replace.js";
import { createZipArchive, encodeText } from "./zip.js";

export function buildMarkdownExportArchive(model) {
  const files = {};

  (model.docs || []).forEach((doc) => {
    files[doc.docPath] = encodeText(replaceEditedCurlBlocks(doc.markdown, doc.blocks));
  });

  return createZipArchive(files);
}
