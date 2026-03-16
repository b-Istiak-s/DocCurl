import path from "node:path";
import { formatCurlSpec } from "./curl.js";

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function createNameRegistry() {
  const counts = new Map();
  return {
    next(name) {
      const base = slugify(name);
      const count = counts.get(base) || 0;
      counts.set(base, count + 1);
      return count === 0 ? base : `${base}-${count + 1}`;
    },
  };
}

function renderFieldTable(title, fields, headingLevel) {
  if (!fields || fields.length === 0) {
    return "";
  }

  const lines = [
    `${headingLevel} ${title}`,
    "",
    "| Name | Requirement |",
    "| --- | --- |",
    ...fields.map((field) => `| ${field.name} | Optional |`),
    "",
  ];

  return lines.join("\n");
}

function renderRequestSection(request, { requestHeading, tableHeading }) {
  const sections = [`${requestHeading} ${request.name}`, ""];

  const groups = [
    ["Path Params", request.pathParams],
    ["Query Params", request.queryParams],
    ["Headers", request.headers.map((header) => ({ name: header.name }))],
    ["Body Fields", request.bodyFields],
    ["Form Fields", request.formFields],
  ];

  groups.forEach(([title, fields]) => {
    const table = renderFieldTable(title, fields, tableHeading);
    if (table) {
      sections.push(table);
    }
  });

  sections.push("```curl");
  sections.push(formatCurlSpec(request.curlSpec));
  sections.push("```");
  sections.push("");
  return sections.join("\n");
}

function renderFolderMarkdown(folder) {
  const sections = [`# ${folder.name}`, ""];
  folder.requests.forEach((request, index) => {
    if (index > 0) {
      sections.push("");
    }
    sections.push(
      renderRequestSection(request, {
        requestHeading: "##",
        tableHeading: "###",
      }),
    );
  });
  return sections.join("\n").trimEnd() + "\n";
}

function renderIndexMarkdown(folder, requestFiles) {
  const lines = [`# ${folder.name}`, ""];
  if (requestFiles.length > 0) {
    lines.push("## Requests", "");
    requestFiles.forEach((requestFile) => {
      lines.push(`- [${requestFile.name}](./${requestFile.filename})`);
    });
    lines.push("");
  }
  return lines.join("\n");
}

function renderRequestMarkdown(request) {
  return (
    renderRequestSection(request, {
      requestHeading: "#",
      tableHeading: "##",
    }).trimEnd() + "\n"
  );
}

function renderFolderOutputs(
  folder,
  { parentDir, isRoot = false, siblingRegistry = null },
  outputs,
  threshold,
) {
  const folderSlug = isRoot ? slugify(folder.name) : siblingRegistry.next(folder.name);
  const folderDir = isRoot ? parentDir : path.posix.join(parentDir, folderSlug);

  if (folder.requests.length > 0) {
    if (isRoot) {
      if (folder.requests.length < threshold) {
        outputs.push({
          path: path.posix.join(parentDir, `${folderSlug}.md`),
          content: renderFolderMarkdown(folder),
        });
      } else {
        const requestNameRegistry = createNameRegistry();
        const requestFiles = folder.requests.map((request) => ({
          name: request.name,
          filename: `${requestNameRegistry.next(request.name)}.md`,
          request,
        }));

        outputs.push({
          path: path.posix.join(parentDir, "index.md"),
          content: renderIndexMarkdown(folder, requestFiles),
        });

        requestFiles.forEach((requestFile) => {
          outputs.push({
            path: path.posix.join(parentDir, requestFile.filename),
            content: renderRequestMarkdown(requestFile.request),
          });
        });
      }
    } else if (folder.requests.length < threshold) {
      outputs.push({
        path: path.posix.join(parentDir, `${folderSlug}.md`),
        content: renderFolderMarkdown(folder),
      });
    } else {
      const requestNameRegistry = createNameRegistry();
      const requestFiles = folder.requests.map((request) => ({
        name: request.name,
        filename: `${requestNameRegistry.next(request.name)}.md`,
        request,
      }));

      outputs.push({
        path: path.posix.join(folderDir, "index.md"),
        content: renderIndexMarkdown(folder, requestFiles),
      });

      requestFiles.forEach((requestFile) => {
        outputs.push({
          path: path.posix.join(folderDir, requestFile.filename),
          content: renderRequestMarkdown(requestFile.request),
        });
      });
    }
  }

  const childRegistry = createNameRegistry();
  const childParentDir = isRoot ? parentDir : folderDir;
  folder.folders.forEach((childFolder) => {
    renderFolderOutputs(
      childFolder,
      {
        parentDir: childParentDir,
        isRoot: false,
        siblingRegistry: childRegistry,
      },
      outputs,
      threshold,
    );
  });
}

export function renderCollectionsToMarkdown(collections, { smallFolderThreshold = 8 } = {}) {
  const outputs = [];
  const rootRegistry = createNameRegistry();

  (collections || []).forEach((collection) => {
    const containerDir = rootRegistry.next(collection.name);
    renderFolderOutputs(
      collection.rootFolder,
      {
        parentDir: containerDir,
        isRoot: true,
      },
      outputs,
      smallFolderThreshold,
    );
  });

  return outputs;
}
