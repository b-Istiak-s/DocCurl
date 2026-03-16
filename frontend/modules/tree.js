function isHeadingElement(element) {
  return /^H[1-6]$/.test(element?.tagName || "");
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

  function walk(node) {
    Array.from(node.children || []).forEach((child) => {
      if (isAlwaysVisibleElement(child)) {
        visibleElements.add(child);
      }

      if (child?.classList?.contains("curlPlaygroundInline")) {
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
        child?.classList?.contains("curlPlaygroundInline");
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

  function createDocActionBar() {
    const features = getFeatures() || {};
    const hasCurlBlocks =
      docContent.querySelectorAll(".curlPlaygroundInline").length > 0;

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
        docContent.innerHTML = `<p class="errorText">Error: ${data.error || "Unable to load document"}</p>`;
        return;
      }

      const data = await parseJsonSafe(response);
      docContent.innerHTML = data.html || "";

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
        docContent.innerHTML =
          '<p class="errorText">Authentication required.</p>';
        return;
      }

      docContent.innerHTML =
        '<p class="errorText">Error loading document. Please try again.</p>';
      console.error("Error loading document:", error);
    }
  }

  async function loadDocsTree() {
    try {
      const response = await apiFetch(withBasePath("/api/docs/tree"));

      if (!response.ok) {
        const data = await parseJsonSafe(response);
        docList.innerHTML = `<li class="errorText">${data.error || "Error loading docs tree"}</li>`;
        return;
      }

      const data = await parseJsonSafe(response);
      docsTree = Array.isArray(data.tree) ? data.tree : [];

      renderDocTree();

      if (docsTree.length === 0) {
        docContent.innerHTML =
          '<p class="errorText">No markdown docs found.</p>';
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
        docContent.innerHTML =
          '<p class="errorText">No markdown docs found.</p>';
      }
    } catch (error) {
      if (error.code === "UNAUTHORIZED") {
        return;
      }

      docList.innerHTML = '<li class="errorText">Error loading docs tree</li>';
      console.error("Error loading docs tree:", error);
    }
  }

  return {
    loadDocsTree,
  };
}
