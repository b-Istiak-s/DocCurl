import test from "node:test";
import assert from "node:assert/strict";

import { createDocsTreeSystem } from "../../frontend/modules/tree.js";

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
      resetDocSession() {},
      initializeCurlPlaygrounds() {},
    },
    closeSidebar() {},
  });

  try {
    await treeSystem.loadDocsTree();

    const toggleButton = docList.querySelector(".docTreeToggle");
    assert.ok(toggleButton);
    assert.equal(toggleButton.children.length, 2);

    const caret = toggleButton.querySelector(".docTreeCaret");
    const label = toggleButton.querySelector(".docTreeLabel");
    assert.ok(caret);
    assert.ok(label);
    assert.equal(caret.textContent, "▾");
    assert.equal(label.textContent, maliciousName);
    assert.equal(label.children.length, 0);
    assert.equal(toggleButton.querySelector("img"), null);

    toggleButton.click();
    assert.equal(docList.querySelector(".docTreeChildren"), null);

    const rerenderedToggle = docList.querySelector(".docTreeToggle");
    assert.ok(rerenderedToggle);
    rerenderedToggle.click();
    assert.ok(docList.querySelector(".docTreeChildren"));
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});
