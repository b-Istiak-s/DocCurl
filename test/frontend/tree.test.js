import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCollapsedDocumentView,
  collectCollapsedVisibleElements,
  createDocsTreeSystem,
} from "../../frontend/modules/tree.js";

class MockClassList {
  constructor(element) {
    this.element = element;
    this.classes = new Set();
  }

  add(...names) {
    names.forEach((name) => {
      if (name) {
        this.classes.add(name);
      }
    });
    this.#sync();
  }

  remove(...names) {
    names.forEach((name) => this.classes.delete(name));
    this.#sync();
  }

  toggle(name, force) {
    if (force === true || (force !== false && !this.classes.has(name))) {
      this.classes.add(name);
      this.#sync();
      return true;
    }

    this.classes.delete(name);
    this.#sync();
    return false;
  }

  contains(name) {
    return this.classes.has(name);
  }

  set(value) {
    this.classes = new Set(String(value || "").split(/\s+/).filter(Boolean));
    this.#sync();
  }

  #sync() {
    this.element._className = Array.from(this.classes).join(" ");
  }
}

class MockElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.style = {};
    this.hidden = false;
    this.value = "";
    this.type = "";
    this.textContent = "";
    this._className = "";
    this._innerHTML = "";
    this.id = "";
    this.classList = new MockClassList(this);
  }

  set className(value) {
    this.classList.set(value);
  }

  get className() {
    return this._className;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    this.children = [];
    this.textContent = "";

    // Minimal parser used to catch regressions where tree buttons are built with raw HTML.
    if (
      this.tagName === "BUTTON" &&
      this._innerHTML.includes("docTreeCaret") &&
      this._innerHTML.includes("docTreeLabel")
    ) {
      const spanMatches = Array.from(
        this._innerHTML.matchAll(/<span class="([^"]+)">([\s\S]*?)<\/span>/g),
      );

      spanMatches.forEach(([, className, contents]) => {
        const child = new MockElement("span");
        child.className = className;
        if (/<img\b/i.test(contents)) {
          child.appendChild(new MockElement("img"));
        } else {
          child.textContent = contents.trim();
        }
        this.appendChild(child);
      });
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  prepend(...nodes) {
    nodes
      .slice()
      .reverse()
      .forEach((node) => {
        node.parentElement = this;
        this.children.unshift(node);
      });
  }

  remove() {
    if (!this.parentElement) {
      return;
    }

    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) {
      this.parentElement.children.splice(index, 1);
    }
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "id") {
      this.id = String(value);
    }
    if (name === "class") {
      this.className = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  dispatch(type, event = {}) {
    (this.listeners[type] || []).forEach((listener) =>
      listener({ target: this, preventDefault() {}, ...event }),
    );
  }

  click() {
    this.dispatch("click");
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = selector.trim().split(/\s+/);
    const results = [];

    const walk = (node, depth) => {
      node.children.forEach((child) => {
        if (matchesSelector(child, selectors[depth])) {
          if (depth === selectors.length - 1) {
            results.push(child);
          } else {
            walk(child, depth + 1);
          }
        }
        walk(child, depth);
      });
    };

    walk(this, 0);
    return results;
  }
}

function matchesSelector(element, selector) {
  if (!selector) {
    return false;
  }
  if (selector.startsWith("#")) {
    return element.id === selector.slice(1);
  }
  if (selector.startsWith(".")) {
    return element.classList.contains(selector.slice(1));
  }

  const [tagName, className] = selector.split(".");
  if (tagName && element.tagName !== tagName.toUpperCase()) {
    return false;
  }
  if (className) {
    return element.classList.contains(className);
  }
  return true;
}

function createDocument() {
  return {
    createElement(tagName) {
      return new MockElement(tagName);
    },
  };
}

function createResponse(ok, data) {
  return { ok, data };
}

test("docs tree renders directory labels safely and keeps toggle behavior", async () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  global.document = createDocument();
  global.window = {
    matchMedia: () => ({ matches: false }),
  };

  const docList = new MockElement("div");
  const docContent = new MockElement("div");
  const maliciousName = '<img src=x onerror="alert(1)">';

  const treeResponse = createResponse(true, {
    tree: [
      {
        type: "dir",
        name: maliciousName,
        path: "malicious",
        children: [
          {
            type: "file",
            name: "page.md",
            path: "malicious/page.md",
          },
        ],
      },
    ],
  });

  const contentResponse = createResponse(true, {
    html: "<p>Loaded</p>",
    markdown: "Loaded",
  });

  const treeSystem = createDocsTreeSystem({
    docList,
    docContent,
    apiFetch: async (url) => {
      if (String(url).includes("/api/docs/tree")) {
        return treeResponse;
      }
      return contentResponse;
    },
    parseJsonSafe: async (response) => response.data,
    withBasePath: (value) => value,
    envManager: {
      collectPlaceholderNamesFromDocument: () => [],
      createEnvToolbar: () => new MockElement("div"),
    },
    playgroundSystem: {
      hasFullscreenOpen: () => false,
      closeFullscreen() {},
      resetCurrentDocument() {},
      initializeCurlPlaygrounds() {},
    },
    exportSystem: {
      openExportDialog() {},
    },
    closeSidebar() {},
  });

  try {
    await treeSystem.loadDocsTree();

    const toggleButton = docList.querySelector(".docTreeToggle");
    assert.ok(toggleButton);
    assert.equal(toggleButton.children.length, 3);

    const caret = toggleButton.querySelector(".docTreeCaret");
    const folderIcon = toggleButton.querySelector(".folderIcon");
    const label = toggleButton.querySelector(".docTreeLabel");
    assert.ok(caret);
    assert.ok(folderIcon);
    assert.ok(label);
    assert.equal(caret.getAttribute("aria-hidden"), "true");
    assert.match(caret.innerHTML, /aria-hidden="true"/);
    assert.match(caret.innerHTML, /focusable="false"/);
    assert.equal(folderIcon.getAttribute("aria-hidden"), "true");
    assert.match(folderIcon.innerHTML, /aria-hidden="true"/);
    assert.match(folderIcon.innerHTML, /focusable="false"/);
    assert.equal(label.textContent, maliciousName);
    assert.equal(label.children.length, 0);
    assert.equal(toggleButton.querySelector("img"), null);

    const fileButton = docList.querySelector(".docTreeFileButton");
    const fileIcon = fileButton?.querySelector(".fileIcon");
    const fileLabel = fileButton?.querySelector(".docTreeLabel");
    assert.ok(fileButton);
    assert.ok(fileIcon);
    assert.ok(fileLabel);
    assert.equal(fileIcon.getAttribute("aria-hidden"), "true");
    assert.match(fileIcon.innerHTML, /aria-hidden="true"/);
    assert.match(fileIcon.innerHTML, /focusable="false"/);
    assert.equal(fileLabel.textContent, "page");
    assert.equal(fileButton.querySelector("img"), null);

    fileButton.click();
    await Promise.resolve();
    await Promise.resolve();
    const actionButtons = docContent.querySelectorAll(".docActionButton");
    assert.equal(actionButtons.some((button) => button.textContent === "Export Curls"), true);

    toggleButton.click();
    assert.equal(docList.querySelector(".docTreeChildren"), null);

    const rerenderedToggle = docList.querySelector(".docTreeToggle");
    assert.ok(rerenderedToggle);
    assert.equal(rerenderedToggle.querySelector(".docTreeCaret")?.getAttribute("aria-hidden"), "true");
    assert.equal(rerenderedToggle.querySelector(".folderIcon")?.getAttribute("aria-hidden"), "true");
    rerenderedToggle.click();
    assert.ok(docList.querySelector(".docTreeChildren"));
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("collapsed document view keeps env controls, headings, and curl blocks visible", () => {
  const container = new MockElement("div");

  const actionBar = new MockElement("div");
  actionBar.className = "docActionBar";

  const envBar = new MockElement("div");
  envBar.className = "docEnvBar";

  const headingOne = new MockElement("h2");
  headingOne.textContent = "Authentication";

  const intro = new MockElement("p");
  intro.textContent = "Intro";

  const firstCurl = new MockElement("div");
  firstCurl.className = "curlPlaygroundInline";

  const detail = new MockElement("p");
  detail.textContent = "Detail";

  const headingTwo = new MockElement("h3");
  headingTwo.textContent = "Checks";

  const secondCurl = new MockElement("div");
  secondCurl.className = "curlPlaygroundInline";

  const closing = new MockElement("p");
  closing.textContent = "Closing";

  container.append(
    actionBar,
    envBar,
    headingOne,
    intro,
    firstCurl,
    detail,
    headingTwo,
    secondCurl,
    closing,
  );

  const visibleElements = collectCollapsedVisibleElements(container);

  assert.equal(visibleElements.has(actionBar), true);
  assert.equal(visibleElements.has(envBar), true);
  assert.equal(visibleElements.has(headingOne), true);
  assert.equal(visibleElements.has(firstCurl), true);
  assert.equal(visibleElements.has(headingTwo), true);
  assert.equal(visibleElements.has(secondCurl), true);
  assert.equal(visibleElements.has(intro), false);
  assert.equal(visibleElements.has(detail), false);
  assert.equal(visibleElements.has(closing), false);

  applyCollapsedDocumentView(container, true);

  assert.equal(container.classList.contains("docContentCollapsed"), true);
  assert.equal(actionBar.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(envBar.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(headingOne.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(firstCurl.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(headingTwo.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(secondCurl.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(intro.classList.contains("docContentCollapsedHidden"), true);
  assert.equal(detail.classList.contains("docContentCollapsedHidden"), true);
  assert.equal(closing.classList.contains("docContentCollapsedHidden"), true);

  applyCollapsedDocumentView(container, false);

  assert.equal(container.classList.contains("docContentCollapsed"), false);
  assert.equal(intro.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(detail.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(closing.classList.contains("docContentCollapsedHidden"), false);
});

test("collapsed document view keeps visible heading subtrees intact", () => {
  const container = new MockElement("div");

  const heading = new MockElement("h2");
  const headingCode = new MockElement("code");
  headingCode.textContent = "GET /api/auth/status";
  heading.appendChild(headingCode);

  const curl = new MockElement("div");
  curl.className = "curlPlaygroundInline";

  const trailing = new MockElement("p");
  trailing.textContent = "Trailing text";

  container.append(heading, curl, trailing);

  const visibleElements = collectCollapsedVisibleElements(container);
  assert.equal(visibleElements.has(heading), true);
  assert.equal(visibleElements.has(curl), true);

  applyCollapsedDocumentView(container, true);

  assert.equal(heading.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(
    headingCode.classList.contains("docContentCollapsedHidden"),
    false,
  );
  assert.equal(curl.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(trailing.classList.contains("docContentCollapsedHidden"), true);
});

test("collapsed document view keeps nested curl playgrounds reachable", () => {
  const container = new MockElement("div");

  const headingOne = new MockElement("h2");
  headingOne.textContent = "Setup";

  const intro = new MockElement("p");
  intro.textContent = "Intro";

  const headingTwo = new MockElement("h4");
  headingTwo.textContent = "Run this curl";

  const list = new MockElement("ul");
  const unrelatedItem = new MockElement("li");
  unrelatedItem.textContent = "Overview";

  const curlItem = new MockElement("li");
  const quote = new MockElement("blockquote");
  const nestedCurl = new MockElement("div");
  nestedCurl.className = "curlPlaygroundInline";
  const nestedCurlContent = new MockElement("div");
  nestedCurlContent.className = "curlEditor";
  nestedCurlContent.textContent = "curl https://api.example.com";
  nestedCurl.appendChild(nestedCurlContent);
  quote.appendChild(nestedCurl);
  curlItem.appendChild(quote);

  const trailingItem = new MockElement("li");
  trailingItem.textContent = "Closing";

  list.append(unrelatedItem, curlItem, trailingItem);

  const outro = new MockElement("p");
  outro.textContent = "Outro";

  container.append(headingOne, intro, headingTwo, list, outro);

  const visibleElements = collectCollapsedVisibleElements(container);

  assert.equal(visibleElements.has(headingOne), false);
  assert.equal(visibleElements.has(headingTwo), true);
  assert.equal(visibleElements.has(list), true);
  assert.equal(visibleElements.has(curlItem), true);
  assert.equal(visibleElements.has(quote), true);
  assert.equal(visibleElements.has(nestedCurl), true);
  assert.equal(visibleElements.has(unrelatedItem), false);
  assert.equal(visibleElements.has(trailingItem), false);
  assert.equal(visibleElements.has(intro), false);
  assert.equal(visibleElements.has(outro), false);

  applyCollapsedDocumentView(container, true);

  assert.equal(container.classList.contains("docContentCollapsed"), true);
  assert.equal(headingOne.classList.contains("docContentCollapsedHidden"), true);
  assert.equal(headingTwo.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(list.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(curlItem.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(quote.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(nestedCurl.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(
    nestedCurlContent.classList.contains("docContentCollapsedHidden"),
    false,
  );
  assert.equal(unrelatedItem.classList.contains("docContentCollapsedHidden"), true);
  assert.equal(trailingItem.classList.contains("docContentCollapsedHidden"), true);
  assert.equal(intro.classList.contains("docContentCollapsedHidden"), true);
  assert.equal(outro.classList.contains("docContentCollapsedHidden"), true);

  applyCollapsedDocumentView(container, false);

  assert.equal(headingOne.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(headingTwo.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(list.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(unrelatedItem.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(trailingItem.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(
    nestedCurlContent.classList.contains("docContentCollapsedHidden"),
    false,
  );
  assert.equal(intro.classList.contains("docContentCollapsedHidden"), false);
  assert.equal(outro.classList.contains("docContentCollapsedHidden"), false);
});
