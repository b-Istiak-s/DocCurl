import test from "node:test";
import assert from "node:assert/strict";
import {
  createEnvManager,
  replacePlaceholders,
} from "../../frontend/modules/env.js";

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
  };
}

function createDocument() {
  return {
    createElement(tagName) {
      return new MockElement(tagName);
    },
  };
}

test("replacePlaceholders supports arbitrary variables and leaves missing placeholders unchanged", () => {
  const command =
    'curl "$BASE_URL/v1/users" -H "Authorization: Bearer $API_TOKEN" -H "X-Tenant: $TENANT" -H "X-Missing: $MISSING"';
  const resolved = replacePlaceholders(command, {
    BASE_URL: "https://api.example.com",
    API_TOKEN: "abc123",
    TENANT: "blue",
  });

  assert.equal(
    resolved,
    'curl "https://api.example.com/v1/users" -H "Authorization: Bearer abc123" -H "X-Tenant: blue" -H "X-Missing: $MISSING"',
  );
});

test("loadStoredEnv returns values from doccurl.env", () => {
  const envManager = createEnvManager({
    documentRef: createDocument(),
    localStorageRef: createLocalStorage({
      "doccurl.env": JSON.stringify({ TENANT: "green" }),
    }),
  });

  assert.deepEqual(envManager.loadStoredEnv(), {
    TENANT: "green",
  });
});

test("createEnvToolbar allows adding and removing variables and persists them to localStorage", () => {
  const localStorageRef = createLocalStorage({});
  const envManager = createEnvManager({
    documentRef: createDocument(),
    localStorageRef,
  });

  const toolbar = envManager.createEnvToolbar(["BASE_URL"]);
  const nameInputs = toolbar.querySelectorAll(".envNameInput");
  const valueInputs = toolbar.querySelectorAll(".envValueInput");

  assert.equal(nameInputs.length, 1);
  assert.equal(nameInputs[0].value, "BASE_URL");
  assert.equal(valueInputs[0].type, "text");

  valueInputs[0].value = "https://api.example.com";
  valueInputs[0].dispatch("input");

  toolbar.querySelector("#doccurl-add-env").click();

  const updatedNameInputs = toolbar.querySelectorAll(".envNameInput");
  const updatedValueInputs = toolbar.querySelectorAll(".envValueInput");
  assert.equal(updatedNameInputs.length, 2);

  updatedNameInputs[1].value = "API_TOKEN";
  updatedNameInputs[1].dispatch("input");
  assert.equal(updatedValueInputs[1].type, "password");

  updatedValueInputs[1].value = "secret-token";
  updatedValueInputs[1].dispatch("input");

  const removeButtons = toolbar.querySelectorAll(".removeEnvBtn");
  removeButtons[0].click();

  assert.deepEqual(JSON.parse(localStorageRef.getItem("doccurl.env")), {
    API_TOKEN: "secret-token",
  });
});
