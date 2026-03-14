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
  const children = Array.from(container.children || []);
  const visibleElements = new Set(children.filter((child) => isAlwaysVisibleElement(child)));

  children.forEach((child, index) => {
    if (!child?.classList?.contains("curlPlaygroundInline")) {
      return;
    }

    visibleElements.add(child);

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = children[cursor];

      if (isAlwaysVisibleElement(previous)) {
        continue;
      }

      if (isHeadingElement(previous)) {
        visibleElements.add(previous);
        break;
      }
    }
  });

  return visibleElements;
}

export function applyCollapsedDocumentView(container, isCollapsed) {
  const visibleElements = isCollapsed ? collectCollapsedVisibleElements(container) : null;

  Array.from(container.children || []).forEach((child) => {
    const shouldHide =
      isCollapsed &&
      !isAlwaysVisibleElement(child) &&
      !visibleElements.has(child);

    child.classList.toggle("docContentCollapsedHidden", shouldHide);
  });

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
  closeSidebar,
  getFeatures = () => ({}),
}) {
  const expandedDirs = new Set();
  let docsTree = [];
  let currentDocPath = "";
  let isContentCollapsed = false;

  function createDocActionBar() {
    const features = getFeatures() || {};
    const hasCurlBlocks = docContent.querySelectorAll(".curlPlaygroundInline").length > 0;

    const actionBar = document.createElement("div");
    actionBar.className = "docActionBar";

    const actionMeta = document.createElement("div");
    actionMeta.className = "docActionMeta";
    actionMeta.textContent = currentDocPath ? currentDocPath.replace(/\.md$/, "") : "Document";

    const actions = document.createElement("div");
    actions.className = "docActionButtons";

    const pageResetButton = document.createElement("button");
    pageResetButton.type = "button";
    pageResetButton.className = "secondaryBtn docActionButton";
    pageResetButton.textContent = "Reset Page";
    pageResetButton.disabled = !hasCurlBlocks;
    pageResetButton.addEventListener("click", () => {
      playgroundSystem.resetCurrentDocument();
    });
    actions.appendChild(pageResetButton);

    if (features.contentCollapse) {
      const collapseToggle = document.createElement("button");
      collapseToggle.type = "button";
      collapseToggle.className = "secondaryBtn docActionButton";
      collapseToggle.disabled = !hasCurlBlocks;

      const syncCollapseToggle = () => {
        collapseToggle.textContent = isContentCollapsed ? "Show All" : "Focus Curls";
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
      if (node.type === "dir" && docPathExists(node.children || [], pathValue)) {
        return true;
      }
    }
    return false;
  }

  function renderTreeNodes(nodes, container, depth = 0) {
    nodes.forEach((node) => {
      const item = document.createElement("li");
      item.className = "docTreeItem";

      if (node.type === "dir") {
        const expanded = expandedDirs.has(node.path);
        const toggleButton = document.createElement("button");
        toggleButton.type = "button";
        toggleButton.className = "docTreeToggle";
        toggleButton.style.paddingLeft = `${13 + depth * 18}px`;
        const caret = document.createElement("span");
        caret.className = "docTreeCaret";
        caret.textContent = expanded ? "▾" : "▸";

        const label = document.createElement("span");
        label.className = "docTreeLabel";
        label.textContent = node.name;

        toggleButton.append(caret, label);

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
          const childrenList = document.createElement("ul");
          childrenList.className = "docTreeChildren";
          renderTreeNodes(node.children || [], childrenList, depth + 1);
          item.appendChild(childrenList);
        }

        container.appendChild(item);
        return;
      }

      if (node.type === "file") {
        const fileButton = document.createElement("button");
        fileButton.type = "button";
        fileButton.className = "docListButton docTreeFileButton";
        fileButton.style.paddingLeft = `${13 + depth * 18}px`;
        fileButton.dataset.path = node.path;
        fileButton.textContent = node.name.replace(/\.md$/, "");

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

    const root = document.createElement("ul");
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
      const response = await apiFetch(withBasePath(`/api/docs/content?path=${encodeURIComponent(docPath)}`));

      if (!response.ok) {
        const data = await parseJsonSafe(response);
        docContent.innerHTML = `<p class="errorText">Error: ${data.error || "Unable to load document"}</p>`;
        return;
      }

      const data = await parseJsonSafe(response);
      docContent.innerHTML = data.html || "";

      const placeholderNames = envManager.collectPlaceholderNamesFromDocument(docContent);
      playgroundSystem.initializeCurlPlaygrounds(docPath);
      isContentCollapsed = false;

      const envToolbar = envManager.createEnvToolbar(placeholderNames);
      const actionBar = createDocActionBar();

      docContent.prepend(envToolbar);
      docContent.prepend(actionBar);
      applyCollapsedDocumentView(docContent, false);

      if (window.matchMedia("(max-width: 960px)").matches) {
        closeSidebar();
      }
    } catch (error) {
      if (error.code === "UNAUTHORIZED") {
        docContent.innerHTML = '<p class="errorText">Authentication required.</p>';
        return;
      }

      docContent.innerHTML = '<p class="errorText">Error loading document. Please try again.</p>';
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
        docContent.innerHTML = '<p class="errorText">No markdown docs found.</p>';
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
        docContent.innerHTML = '<p class="errorText">No markdown docs found.</p>';
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
