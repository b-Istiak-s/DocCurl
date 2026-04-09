function isHeadingElement(element) {
  return /^H[1-6]$/.test(element?.tagName || "");
}

const BLOCKED_HTML_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "select",
  "option",
  "textarea",
]);

const ALLOWED_HTML_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "kbd",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

const ALLOWED_HTML_ATTRIBUTES = {
  a: new Set(["href", "title"]),
  code: new Set(["class"]),
  img: new Set(["src", "alt", "title"]),
  li: new Set(["value"]),
  ol: new Set(["start"]),
  pre: new Set(["class"]),
  span: new Set(["class"]),
  td: new Set(["align", "colspan", "rowspan"]),
  th: new Set(["align", "colspan", "rowspan"]),
};

function escapeHtmlAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clearElementChildren(element) {
  if (!element) {
    return;
  }

  if (typeof element.replaceChildren === "function") {
    element.replaceChildren();
    return;
  }

  if ("innerHTML" in element) {
    element.innerHTML = "";
  }
}

function renderTextBlock(
  container,
  tagName,
  className,
  text,
  documentRef = globalThis.document,
) {
  clearElementChildren(container);
  const element = documentRef?.createElement
    ? documentRef.createElement(tagName)
    : null;

  if (element) {
    if (className) {
      element.className = className;
    }
    element.textContent = text;
    container.appendChild(element);
    return;
  }

  container.textContent = text;
}

function isSafeDocumentUrl(value, { allowDataImage = false } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return false;
  }

  const schemeMatch = normalized.match(/^([a-z0-9+.-]+):/i);
  if (!schemeMatch) {
    return true;
  }

  const protocol = schemeMatch[1].toLowerCase();
  if (protocol === "http" || protocol === "https" || protocol === "mailto" || protocol === "tel") {
    return true;
  }

  if (
    allowDataImage &&
    protocol === "data" &&
    /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(normalized)
  ) {
    return true;
  }

  return false;
}

function filterSanitizedAttribute(tagName, attributeName, attributeValue) {
  const allowedAttributes = ALLOWED_HTML_ATTRIBUTES[tagName] || new Set();
  const normalizedName = String(attributeName || "").toLowerCase();
  const normalizedValue = String(attributeValue ?? "");

  if (
    !allowedAttributes.has(normalizedName) ||
    normalizedName.startsWith("on") ||
    normalizedName === "style"
  ) {
    return null;
  }

  if (
    (normalizedName === "href" && !isSafeDocumentUrl(normalizedValue)) ||
    (normalizedName === "src" &&
      !isSafeDocumentUrl(normalizedValue, { allowDataImage: tagName === "img" }))
  ) {
    return null;
  }

  return [normalizedName, normalizedValue];
}

function sanitizeHtmlAttributes(tagName, rawAttributes) {
  const sanitizedAttributes = [];
  const attributePattern =
    /([A-Za-z0-9:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;

  while ((match = attributePattern.exec(rawAttributes))) {
    const sanitized = filterSanitizedAttribute(
      tagName,
      match[1],
      match[3] ?? match[4] ?? match[5] ?? "",
    );
    if (!sanitized) {
      continue;
    }

    const [attributeName, attributeValue] = sanitized;

    sanitizedAttributes.push(
      ` ${attributeName}="${escapeHtmlAttribute(attributeValue)}"`,
    );
  }

  return sanitizedAttributes.join("");
}

export function sanitizeDocumentHtml(html) {
  const input = String(html || "");
  const withoutBlockedElements = input
    .replace(
      /<(script|style|iframe|object|embed|form|textarea|select|option|button)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(
      /<(link|meta|base|input)\b[^>]*\/?>/gi,
      "",
    );

  return withoutBlockedElements.replace(
    /<\/?([A-Za-z0-9:-]+)([^>]*)>/g,
    (fullMatch, rawTagName, rawAttributes = "") => {
      const tagName = String(rawTagName || "").toLowerCase();
      const isClosingTag = fullMatch.startsWith("</");

      if (BLOCKED_HTML_TAGS.has(tagName) || !ALLOWED_HTML_TAGS.has(tagName)) {
        return "";
      }

      if (isClosingTag) {
        return `</${tagName}>`;
      }

      const selfClosing = /\/>$/.test(fullMatch) || tagName === "br" || tagName === "hr";
      const sanitizedAttributes = sanitizeHtmlAttributes(tagName, rawAttributes);
      return `<${tagName}${sanitizedAttributes}${selfClosing ? " />" : ">"}`;
    },
  );
}

function appendSanitizedNode(parent, sourceNode, documentRef) {
  if (!sourceNode) {
    return;
  }

  if (sourceNode.nodeType === 3) {
    parent.appendChild(documentRef.createTextNode(sourceNode.textContent || ""));
    return;
  }

  if (sourceNode.nodeType !== 1) {
    return;
  }

  const tagName = sourceNode.tagName.toLowerCase();
  if (BLOCKED_HTML_TAGS.has(tagName)) {
    return;
  }

  if (!ALLOWED_HTML_TAGS.has(tagName)) {
    Array.from(sourceNode.childNodes || []).forEach((childNode) => {
      appendSanitizedNode(parent, childNode, documentRef);
    });
    return;
  }

  const safeElement = documentRef.createElement(tagName);

  Array.from(sourceNode.attributes || []).forEach((attribute) => {
    const sanitized = filterSanitizedAttribute(
      tagName,
      attribute.name,
      attribute.value,
    );
    if (!sanitized) {
      return;
    }

    const [attributeName, attributeValue] = sanitized;
    safeElement.setAttribute(attributeName, attributeValue);
  });

  Array.from(sourceNode.childNodes || []).forEach((childNode) => {
    appendSanitizedNode(safeElement, childNode, documentRef);
  });

  parent.appendChild(safeElement);
}

function renderSanitizedDocument(container, html, documentRef, windowRef) {
  const DOMParserImpl = windowRef?.DOMParser || globalThis.DOMParser;

  if (
    DOMParserImpl &&
    typeof documentRef?.createElement === "function" &&
    typeof documentRef?.createTextNode === "function"
  ) {
    clearElementChildren(container);
    const parser = new DOMParserImpl();
    const parsed = parser.parseFromString(String(html || ""), "text/html");
    Array.from(parsed.body.childNodes || []).forEach((childNode) => {
      appendSanitizedNode(container, childNode, documentRef);
    });
    return;
  }

  clearElementChildren(container);
  container.textContent = sanitizeDocumentHtml(html);
}

function isAlwaysVisibleElement(element) {
  return (
    element?.classList?.contains("docActionBar") ||
    element?.classList?.contains("docEnvBar")
  );
}

export function collectCollapsedVisibleElements(container) {
  const visibleElements = new Set();
  let lastHeading = null;

  function addElementAndAncestors(element) {
    if (!element) {
      return;
    }

    visibleElements.add(element);

    let ancestor = element.parentElement;
    while (ancestor && ancestor !== container) {
      visibleElements.add(ancestor);
      ancestor = ancestor.parentElement;
    }
  }

  function isCommandPlaygroundElement(element) {
    return (
      element?.classList?.contains("curlPlaygroundInline") ||
      element?.classList?.contains("soccliPlaygroundInline")
    );
  }

  function walk(node) {
    Array.from(node.children || []).forEach((child) => {
      if (isAlwaysVisibleElement(child)) {
        visibleElements.add(child);
      }

      if (isCommandPlaygroundElement(child)) {
        addElementAndAncestors(child);
        if (lastHeading) {
          addElementAndAncestors(lastHeading);
        }
      }

      if (isHeadingElement(child)) {
        lastHeading = child;
      }

      walk(child);
    });
  }

  walk(container);

  return visibleElements;
}

export function applyCollapsedDocumentView(container, isCollapsed) {
  const visibleElements = isCollapsed
    ? collectCollapsedVisibleElements(container)
    : null;

  function walk(node, preserveSubtree = false) {
    Array.from(node.children || []).forEach((child) => {
      const shouldPreserveSubtree =
        preserveSubtree ||
        (visibleElements?.has(child) && isHeadingElement(child)) ||
        isAlwaysVisibleElement(child) ||
        child?.classList?.contains("curlPlaygroundInline") ||
        child?.classList?.contains("soccliPlaygroundInline");
      const shouldHide =
        isCollapsed &&
        !shouldPreserveSubtree &&
        !visibleElements.has(child);

      child.classList.toggle("docContentCollapsedHidden", shouldHide);
      walk(child, shouldPreserveSubtree);
    });
  }

  walk(container);

  container.classList.toggle("docContentCollapsed", Boolean(isCollapsed));
}

export function createDocsTreeSystem({
  docList,
  docContent,
  apiFetch,
  parseJsonSafe,
  withBasePath,
  envManager,
  playgroundSystem,
  exportSystem,
  closeSidebar,
  getFeatures = () => ({}),
  documentRef = globalThis.document,
  windowRef = globalThis.window,
}) {
  const expandedDirs = new Set();
  let docsTree = [];
  let currentDocPath = "";
  const CARET_EXPANDED_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="6 9 12 15 18 9"></polyline></svg>';
  const CARET_COLLAPSED_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="9 18 15 12 9 6"></polyline></svg>';
  const FOLDER_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
  const FILE_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>';
  let isContentCollapsed = false;

  function renderDocError(message) {
    renderTextBlock(docContent, "p", "errorText", message, documentRef);
  }

  function renderTreeError(message) {
    renderTextBlock(docList, "li", "errorText", message, documentRef);
  }

  function createDocActionBar() {
    const features = getFeatures() || {};
    const hasCurlBlocks =
      docContent.querySelectorAll(".curlPlaygroundInline, .soccliPlaygroundInline").length > 0;

    const actionBar = documentRef.createElement("div");
    actionBar.className = "docActionBar";

    const actionMeta = documentRef.createElement("div");
    actionMeta.className = "docActionMeta";
    actionMeta.textContent = currentDocPath
      ? currentDocPath.replace(/\.md$/, "")
      : "Document";

    const actions = documentRef.createElement("div");
    actions.className = "docActionButtons";

    const pageResetButton = documentRef.createElement("button");
    pageResetButton.type = "button";
    pageResetButton.className = "secondaryBtn docActionButton";
    pageResetButton.textContent = "Reset Page";
    pageResetButton.disabled = !hasCurlBlocks;
    pageResetButton.addEventListener("click", () => {
      playgroundSystem.resetCurrentDocument();
    });
    actions.appendChild(pageResetButton);

    if (exportSystem) {
      const exportButton = documentRef.createElement("button");
      exportButton.type = "button";
      exportButton.className = "secondaryBtn docActionButton";
      exportButton.textContent = "Export Curls";
      exportButton.addEventListener("click", () => {
        exportSystem.openExportDialog();
      });
      actions.appendChild(exportButton);
    }

    if (features.contentCollapse) {
      const collapseToggle = documentRef.createElement("button");
      collapseToggle.type = "button";
      collapseToggle.className = "secondaryBtn docActionButton";
      collapseToggle.disabled = !hasCurlBlocks;

      const syncCollapseToggle = () => {
        collapseToggle.textContent = isContentCollapsed
          ? "Show All"
          : "Focus Curls";
        collapseToggle.setAttribute("aria-pressed", String(isContentCollapsed));
      };

      syncCollapseToggle();
      collapseToggle.addEventListener("click", () => {
        isContentCollapsed = !isContentCollapsed;
        applyCollapsedDocumentView(docContent, isContentCollapsed);
        syncCollapseToggle();
      });
      actions.appendChild(collapseToggle);
    }

    actionBar.append(actionMeta, actions);
    return actionBar;
  }

  function expandPathAncestors(filePath) {
    const parts = filePath.split("/");
    let cursor = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      cursor = cursor ? `${cursor}/${parts[i]}` : parts[i];
      expandedDirs.add(cursor);
    }
  }

  function findFirstFilePath(nodes) {
    for (const node of nodes) {
      if (node.type === "file") {
        return node.path;
      }
      if (node.type === "dir") {
        const nested = findFirstFilePath(node.children || []);
        if (nested) {
          return nested;
        }
      }
    }
    return "";
  }

  function docPathExists(nodes, pathValue) {
    for (const node of nodes) {
      if (node.type === "file" && node.path === pathValue) {
        return true;
      }
      if (
        node.type === "dir" &&
        docPathExists(node.children || [], pathValue)
      ) {
        return true;
      }
    }
    return false;
  }

  function renderTreeNodes(nodes, container, depth = 0) {
    nodes.forEach((node) => {
      const item = documentRef.createElement("li");
      item.className = "docTreeItem";

      if (node.type === "dir") {
        const expanded = expandedDirs.has(node.path);
        const toggleButton = documentRef.createElement("button");
        toggleButton.type = "button";
        toggleButton.className = "docTreeToggle";
        toggleButton.style.paddingLeft = `${13 + depth * 18}px`;

        const caret = documentRef.createElement("span");
        caret.className = "docTreeCaret";
        caret.setAttribute("aria-hidden", "true");
        caret.innerHTML = expanded ? CARET_EXPANDED_SVG : CARET_COLLAPSED_SVG;

        const folderIcon = documentRef.createElement("span");
        folderIcon.className = "docIcon folderIcon";
        folderIcon.setAttribute("aria-hidden", "true");
        folderIcon.innerHTML = FOLDER_ICON_SVG;

        const label = documentRef.createElement("span");
        label.className = "docTreeLabel";
        label.textContent = node.name;

        toggleButton.append(caret, folderIcon, label);

        if (currentDocPath && currentDocPath.startsWith(`${node.path}/`)) {
          toggleButton.classList.add("active");
        }

        toggleButton.addEventListener("click", () => {
          if (expandedDirs.has(node.path)) {
            expandedDirs.delete(node.path);
          } else {
            expandedDirs.add(node.path);
          }
          renderDocTree();
        });

        item.appendChild(toggleButton);

        if (expanded) {
          const childrenList = documentRef.createElement("ul");
          childrenList.className = "docTreeChildren";
          renderTreeNodes(node.children || [], childrenList, depth + 1);
          item.appendChild(childrenList);
        }

        container.appendChild(item);
        return;
      }

      if (node.type === "file") {
        const fileButton = documentRef.createElement("button");
        fileButton.type = "button";
        fileButton.className = "docListButton docTreeFileButton";
        fileButton.style.paddingLeft = `${13 + depth * 18}px`;
        fileButton.dataset.path = node.path;

        const fileIcon = documentRef.createElement("span");
        fileIcon.className = "docIcon fileIcon";
        fileIcon.setAttribute("aria-hidden", "true");
        fileIcon.innerHTML = FILE_ICON_SVG;

        const label = documentRef.createElement("span");
        label.className = "docTreeLabel";
        label.textContent = node.name.replace(/\.md$/, "");

        fileButton.append(fileIcon, label);

        if (currentDocPath === node.path) {
          fileButton.classList.add("active");
        }

        fileButton.addEventListener("click", () => {
          expandPathAncestors(node.path);
          loadDoc(node.path);
        });

        item.appendChild(fileButton);
        container.appendChild(item);
      }
    });
  }

  function renderDocTree() {
    docList.innerHTML = "";

    const root = documentRef.createElement("ul");
    root.className = "docTreeRoot";
    renderTreeNodes(docsTree, root, 0);
    docList.appendChild(root);
  }

  async function loadDoc(docPath) {
    if (playgroundSystem.hasFullscreenOpen()) {
      playgroundSystem.closeFullscreen();
    }

    currentDocPath = docPath;
    renderDocTree();
    docContent.innerHTML = '<div class="loading">Loading document...</div>';

    try {
      const response = await apiFetch(
        withBasePath(`/api/docs/content?path=${encodeURIComponent(docPath)}`),
      );

      if (!response.ok) {
        const data = await parseJsonSafe(response);
        renderDocError(`Error: ${data.error || "Unable to load document"}`);
        return;
      }

      const data = await parseJsonSafe(response);
      renderSanitizedDocument(docContent, data.html || "", documentRef, windowRef);

      const placeholderNames =
        envManager.collectPlaceholderNamesFromDocument(docContent);
      playgroundSystem.initializeCurlPlaygrounds(docPath);
      isContentCollapsed = false;

      const envToolbar = envManager.createEnvToolbar(placeholderNames);
      const actionBar = createDocActionBar();

      docContent.prepend(envToolbar);
      docContent.prepend(actionBar);
      applyCollapsedDocumentView(docContent, false);

      if (windowRef.matchMedia("(max-width: 960px)").matches) {
        closeSidebar();
      }
    } catch (error) {
      if (error.code === "UNAUTHORIZED") {
        renderDocError("Authentication required.");
        return;
      }

      renderDocError("Error loading document. Please try again.");
      console.error("Error loading document:", error);
    }
  }

  async function loadDocsTree() {
    try {
      const response = await apiFetch(withBasePath("/api/docs/tree"));

      if (!response.ok) {
        const data = await parseJsonSafe(response);
        renderTreeError(data.error || "Error loading docs tree");
        return;
      }

      const data = await parseJsonSafe(response);
      docsTree = Array.isArray(data.tree) ? data.tree : [];

      renderDocTree();

      if (docsTree.length === 0) {
        renderDocError("No markdown docs found.");
        return;
      }

      if (currentDocPath && docPathExists(docsTree, currentDocPath)) {
        expandPathAncestors(currentDocPath);
        renderDocTree();
        await loadDoc(currentDocPath);
        return;
      }

      const firstFilePath = findFirstFilePath(docsTree);
      if (firstFilePath) {
        expandPathAncestors(firstFilePath);
        renderDocTree();
        await loadDoc(firstFilePath);
      } else {
        renderDocError("No markdown docs found.");
      }
    } catch (error) {
      if (error.code === "UNAUTHORIZED") {
        return;
      }

      renderTreeError("Error loading docs tree");
      console.error("Error loading docs tree:", error);
    }
  }

  return {
    loadDocsTree,
  };
}
