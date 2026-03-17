import { createStableCurlBlockId, formatCurlCommand, loadStoredCurlEdits } from "../playground.js";
import { parseCurlForExport } from "./curl.js";

function flattenDocPaths(nodes, result = []) {
  (nodes || []).forEach((node) => {
    if (node.type === "file" && node.path) {
      result.push(node.path);
      return;
    }

    if (node.type === "dir") {
      flattenDocPaths(node.children || [], result);
    }
  });
  return result;
}

export function extractCurlBlocksFromMarkdown(markdown) {
  return extractNamedCurlBlocksFromMarkdown(markdown).map((entry) => entry.command);
}

function normalizeHeadingText(text) {
  return String(text || "").replace(/\s+#+\s*$/, "").trim();
}

export function extractNamedCurlBlocksFromMarkdown(markdown) {
  const blocks = [];
  const lines = String(markdown || "").split(/\r?\n/);
  let currentHeading = "";
  let activeFence = "";
  let activeKind = "";
  let buffer = [];

  lines.forEach((line) => {
    const fenceMatch = line.match(/^\s*(```+|~~~+)\s*([A-Za-z0-9_-]+)?\s*$/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const language = String(fenceMatch[2] || "").toLowerCase();

      if (activeFence) {
        if (marker === activeFence) {
          if (activeKind === "curl") {
            const command = buffer.join("\n").trim();
            if (command) {
              blocks.push({
                command,
                heading: currentHeading,
              });
            }
          }
          activeFence = "";
          activeKind = "";
          buffer = [];
        } else if (activeKind === "curl") {
          buffer.push(line);
        }
        return;
      }

      activeFence = marker;
      activeKind = language === "curl" ? "curl" : "other";
      buffer = [];
      return;
    }

    if (activeKind === "curl") {
      buffer.push(line);
      return;
    }

    if (activeFence) {
      return;
    }

    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
    if (headingMatch) {
      currentHeading = normalizeHeadingText(headingMatch[1]);
    }
  });

  return blocks;
}

export async function buildExportCollectionModel({
  apiFetch,
  parseJsonSafe,
  withBasePath,
  localStorageRef = globalThis.localStorage,
  env = {},
}) {
  const storedEdits = loadStoredCurlEdits(localStorageRef);
  const treeResponse = await apiFetch(withBasePath("/api/docs/tree"));
  const treeData = await parseJsonSafe(treeResponse);
  if (!treeResponse.ok) {
    throw new Error(treeData.error || "Unable to load docs tree");
  }

  const docPaths = flattenDocPaths(treeData.tree || []);
  const groups = [];
  const docs = [];

  for (const docPath of docPaths) {
    const response = await apiFetch(
      withBasePath(`/api/docs/content?path=${encodeURIComponent(docPath)}`),
    );
    const data = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(data.error || `Unable to load ${docPath}`);
    }

    const blocks = extractNamedCurlBlocksFromMarkdown(data.markdown || "");
    const requests = blocks.map((block, blockIndex) => {
      const command = block.command;
      const originalTemplate = formatCurlCommand(command);
      const blockId = createStableCurlBlockId(docPath, blockIndex, originalTemplate);
      const savedEdit = storedEdits[docPath]?.[blockId] || "";
      const hasStoredEdit = Boolean(savedEdit);
      const effectiveCommand = hasStoredEdit ? savedEdit : originalTemplate;
      return {
        id: blockId,
        docPath,
        blockIndex,
        command: effectiveCommand,
        originalCommand: command,
        effectiveCommand,
        hasStoredEdit,
        request: parseCurlForExport(effectiveCommand, {
          index: blockIndex,
          name: block.heading,
        }),
      };
    });

    groups.push({
      docPath,
      requests,
    });
    docs.push({
      docPath,
      markdown: String(data.markdown || ""),
      blocks: requests,
    });
  }

  return {
    exportedAt: new Date().toISOString(),
    env: { ...env },
    groups,
    docs,
  };
}
