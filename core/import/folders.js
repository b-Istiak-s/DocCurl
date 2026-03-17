import { splitFolderPathSegments } from "./utils.js";

export function createFolderNode(name) {
  return {
    name: String(name || "Folder").trim() || "Folder",
    requests: [],
    folders: [],
  };
}

function findChildFolder(parent, name) {
  return parent.folders.find((folder) => folder.name === name) || null;
}

export function ensureFolderPath(rootFolder, rawName) {
  const segments = splitFolderPathSegments(rawName);
  if (segments.length === 0) {
    return rootFolder;
  }

  let current = rootFolder;
  for (const segment of segments) {
    let next = findChildFolder(current, segment);
    if (!next) {
      next = createFolderNode(segment);
      current.folders.push(next);
    }
    current = next;
  }
  return current;
}

export function createContainer(name) {
  const normalizedName = String(name || "Collection").trim() || "Collection";
  return {
    name: normalizedName,
    rootFolder: createFolderNode(normalizedName),
  };
}
