function createFolderNode(name = "") {
  return {
    name,
    folders: new Map(),
    requests: [],
  };
}

function splitDocPath(docPath) {
  return String(docPath || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment, index, parts) =>
      index === parts.length - 1 ? segment.replace(/\.md$/i, "").trim() || "Document" : segment,
    );
}

export function buildGroupFolderTree(groups = []) {
  const root = createFolderNode("");

  groups.forEach((group) => {
    const segments = splitDocPath(group.docPath);
    let cursor = root;

    segments.forEach((segment) => {
      if (!cursor.folders.has(segment)) {
        cursor.folders.set(segment, createFolderNode(segment));
      }
      cursor = cursor.folders.get(segment);
    });

    cursor.requests.push(...(group.requests || []));
  });

  return root;
}
