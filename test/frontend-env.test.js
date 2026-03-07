const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
  constructor(tagName = "div", ownerDocument = null) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
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

  after(node) {
    if (!this.parentElement) {
      return;
    }
    const index = this.parentElement.children.indexOf(this);
    node.parentElement = this.parentElement;
    this.parentElement.children.splice(index + 1, 0, node);
  }

  replaceWith(node) {
    if (!this.parentElement) {
      return;
    }
    const index = this.parentElement.children.indexOf(this);
    node.parentElement = this.parentElement;
    this.parentElement.children.splice(index, 1, node);
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

  focus() {}

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

function createLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    dump() {
      return Object.fromEntries(store.entries());
    },
  };
}

async function loadFrontendApp(initialStorage = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "frontend", "app.js"),
    "utf8",
  );

  const documentElements = {};
  const document = {
    body: new MockElement("body"),
    createElement(tagName) {
      return new MockElement(tagName, document);
    },
    getElementById(id) {
      if (!documentElements[id]) {
        const element = new MockElement("div", document);
        element.id = id;
        documentElements[id] = element;
      }
      return documentElements[id];
    },
    addEventListener() {},
  };

  const context = {
    console,
    document,
    localStorage: createLocalStorage(initialStorage),
    window: {
      location: { pathname: "/" },
      matchMedia: () => ({ matches: false }),
      hljs: null,
    },
    requestAnimationFrame: (callback) => callback(),
    fetch: async (url) => {
      if (String(url).includes("/api/auth/status")) {
        return {
          ok: true,
          async json() {
            return { authEnabled: false, authenticated: true };
          },
        };
      }

      if (String(url).includes("/api/docs/tree")) {
        return {
          ok: true,
          async json() {
            return { tree: [] };
          },
        };
      }

      throw new Error(`Unexpected fetch in test: ${url}`);
    },
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(source, context, {
    filename: path.join(__dirname, "..", "frontend", "app.js"),
  });

  await Promise.resolve();
  return context;
}

test("replacePlaceholders supports arbitrary variables and leaves missing placeholders unchanged", async () => {
  const context = await loadFrontendApp();

  const command =
    'curl "$APP_URL/v1/users" -H "Authorization: Bearer $TOKEN" -H "X-Tenant: $TENANT" -H "X-Missing: $MISSING"';
  const resolved = context.replacePlaceholders(command, {
    APP_URL: "https://api.example.com",
    TOKEN: "abc123",
    TENANT: "blue",
  });

  assert.equal(
    resolved,
    'curl "https://api.example.com/v1/users" -H "Authorization: Bearer abc123" -H "X-Tenant: blue" -H "X-Missing: $MISSING"',
  );
});

test("loadStoredEnv preserves legacy APP_URL/TOKEN values alongside stored arbitrary variables", async () => {
  const context = await loadFrontendApp({
    "doccurl.app_url": "https://legacy.example.com",
    "doccurl.token": "legacy-token",
    "doccurl.env": JSON.stringify({ TENANT: "green" }),
  });

  assert.deepEqual(JSON.parse(JSON.stringify(context.loadStoredEnv())), {
    APP_URL: "https://legacy.example.com",
    TOKEN: "legacy-token",
    TENANT: "green",
  });
});

test("createEnvToolbar allows adding and removing variables and persists them to localStorage", async () => {
  const context = await loadFrontendApp();

  const toolbar = context.createEnvToolbar(["APP_URL"]);
  const nameInputs = toolbar.querySelectorAll(".envNameInput");
  const valueInputs = toolbar.querySelectorAll(".envValueInput");

  assert.equal(nameInputs.length, 1);
  assert.equal(nameInputs[0].value, "APP_URL");
  assert.equal(valueInputs[0].type, "text");

  valueInputs[0].value = "https://api.example.com";
  valueInputs[0].dispatch("input");

  toolbar.querySelector("#doccurl-add-env").click();

  const updatedNameInputs = toolbar.querySelectorAll(".envNameInput");
  const updatedValueInputs = toolbar.querySelectorAll(".envValueInput");
  assert.equal(updatedNameInputs.length, 2);

  updatedNameInputs[1].value = "TOKEN";
  updatedNameInputs[1].dispatch("input");
  assert.equal(updatedValueInputs[1].type, "password");

  updatedValueInputs[1].value = "secret-token";
  updatedValueInputs[1].dispatch("input");

  const removeButtons = toolbar.querySelectorAll(".removeEnvBtn");
  removeButtons[0].click();

  assert.deepEqual(JSON.parse(context.localStorage.getItem("doccurl.env")), {
    TOKEN: "secret-token",
  });
});
