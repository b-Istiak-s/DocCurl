import fs from "node:fs";
import path from "node:path";

export function sortNodes(nodes) {
  return nodes.sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    return a.type === "dir" ? -1 : 1;
  });
}

export function buildDocsTree(docsDir, relativeDir = "") {
  const absoluteDir = relativeDir ? path.join(docsDir, relativeDir) : docsDir;

  let entries;
  try {
    entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes = [];

  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = buildDocsTree(docsDir, relativePath);
      if (children.length > 0) {
        nodes.push({
          type: "dir",
          name: entry.name,
          path: relativePath,
          children,
        });
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      nodes.push({
        type: "file",
        name: entry.name,
        path: relativePath,
      });
    }
  }

  return sortNodes(nodes);
}
