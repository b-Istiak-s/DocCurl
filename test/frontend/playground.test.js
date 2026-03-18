import test from "node:test";
import assert from "node:assert/strict";

import {
  clearAllStoredCurlEdits,
  createPlaygroundSystem,
  createStableCurlBlockId,
  formatCurlCommand,
  loadStoredCurlEdits,
} from "../../frontend/modules/playground.js";

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
    this.disabled = false;
    this.value = "";
    this.type = "";
    this.textContent = "";
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this._className = "";
    this._innerHTML = "";
    this.id = "";
    this.classList = new MockClassList(this);
  }

  get isConnected() {
    return Boolean(this.parentElement);
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

    if (!this._innerHTML.trim()) {
      return;
    }

    if (
      this._innerHTML.includes("curlScriptWrapper") &&
      this._innerHTML.includes("responsePane")
    ) {
      buildPlaygroundMarkup(this);
      return;
    }

    const simpleMatch = this._innerHTML
      .trim()
      .match(/^<([a-z0-9]+)([^>]*)>([^<]*)<\/\1>$/i);

    if (!simpleMatch) {
      return;
    }

    const [, tagName, rawAttributes, textValue] = simpleMatch;
    const child = new MockElement(tagName);
    applyAttributes(child, rawAttributes);
    child.textContent = textValue;
    this.appendChild(child);
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

  replaceChildren(...nodes) {
    this.children.forEach((child) => {
      child.parentElement = null;
    });
    this.children = [];
    nodes.forEach((node) => this.appendChild(node));
  }

  after(node) {
    if (!this.parentElement) {
      return;
    }

    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    node.parentElement = this.parentElement;
    siblings.splice(index + 1, 0, node);
  }

  replaceWith(node) {
    if (!this.parentElement) {
      return;
    }

    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    node.parentElement = this.parentElement;
    siblings.splice(index, 1, node);
    this.parentElement = null;
  }

  remove() {
    if (!this.parentElement) {
      return;
    }

    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index >= 0) {
      siblings.splice(index, 1);
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
    if (name === "disabled") {
      this.disabled = true;
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

  select() {}

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

function applyAttributes(element, rawAttributes) {
  const classMatch = String(rawAttributes || "").match(/class="([^"]+)"/i);
  if (classMatch) {
    element.className = classMatch[1];
  }

  if (/\bdisabled\b/i.test(rawAttributes)) {
    element.disabled = true;
  }
}

function createElement(tagName, className = "", textContent = "") {
  const element = new MockElement(tagName);
  if (className) {
    element.className = className;
  }
  if (textContent) {
    element.textContent = textContent;
  }
  return element;
}

function buildPlaygroundMarkup(container) {
  const requestPane = createElement("section", "playgroundPane");
  const requestHeader = createElement("div", "panelHeader", "Request");
  const requestPaneBody = createElement("div", "requestPaneBody");
  const requestEditorView = createElement("div", "requestEditorView");
  const requestWrapper = createElement("div", "curlScriptWrapper");
  const editorShell = createElement("div", "curlEditorShell");
  const overlay = createElement("pre", "curlOverlay");
  const overlayCode = createElement("code", "language-bash");
  const editor = createElement("textarea", "curlEditor");
  const uploadPanel = createElement("div", "curlUploadPanel");
  uploadPanel.hidden = true;
  const uploadError = createElement("div", "curlUploadError");
  uploadError.hidden = true;
  const uploadList = createElement("div", "curlUploadList");
  const uploadActions = createElement("div", "curlUploadActions");
  const hideUploadsButton = createElement("button", "hideUploadsBtn", "Hide Uploads");
  const uploadRunButton = createElement("button", "uploadRunBtn", "Run");
  const requestActions = createElement("div", "panelActions");
  const copyButton = createElement("button", "copyBtn", "Copy");
  const uploadToggleButton = createElement("button", "uploadToggleBtn", "Upload Files");
  uploadToggleButton.hidden = true;
  const runButton = createElement("button", "runBtn", "Run");

  overlay.appendChild(overlayCode);
  editorShell.append(overlay, editor);
  requestWrapper.appendChild(editorShell);
  uploadActions.append(hideUploadsButton, uploadRunButton);
  uploadPanel.append(uploadError, uploadList, uploadActions);
  requestActions.appendChild(copyButton);
  requestActions.appendChild(uploadToggleButton);
  requestActions.appendChild(runButton);
  requestEditorView.append(requestWrapper, requestActions);
  requestPaneBody.append(requestEditorView, uploadPanel);
  requestPane.append(requestHeader, requestPaneBody);

  const responsePane = createElement("section", "playgroundPane responsePane");
  const responseHeader = createElement("div", "panelHeader responseHeader");
  const responseLabel = createElement("span", "", "Response");
  const responseMetaButton = createElement("button", "responseMetaBtn", "Details");
  responseMetaButton.disabled = true;
  const responseToast = createElement("div", "responseMetaToast");
  const output = createElement("div", "curlOutput");
  const outputEmpty = createElement(
    "div",
    "outputEmpty",
    "Run a request to see the response",
  );
  const responseActions = createElement("div", "panelActions");
  const fullscreenButton = createElement("button", "fullscreenBtn", "Fullscreen");

  responseHeader.append(responseLabel, responseMetaButton);
  output.appendChild(outputEmpty);
  responseActions.appendChild(fullscreenButton);
  responsePane.append(responseHeader, responseToast, output, responseActions);

  container.append(requestPane, responsePane);
}

function createDocument() {
  return {
    body: new MockElement("body"),
    createElement(tagName) {
      return new MockElement(tagName);
    },
  };
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

function createWindow() {
  return {
    hljs: null,
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  };
}

class MockFormData {
  constructor() {
    this.entries = [];
  }

  append(name, value, filename) {
    this.entries.push({ name, value, filename });
  }
}

function createFileLike(name, size) {
  return { name, size };
}

function flushAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createNullProtoObject(value) {
  return Object.assign(Object.create(null), value);
}

function createCurlBlock(command) {
  const preElement = new MockElement("pre");
  const codeElement = new MockElement("code");
  codeElement.className = "language-curl";
  codeElement.textContent = command;
  preElement.appendChild(codeElement);
  return preElement;
}

test("createStableCurlBlockId stays stable and differentiates identical blocks by index", () => {
  const command = formatCurlCommand("curl https://api.example.com/users");

  const firstId = createStableCurlBlockId("guide.md", 0, command);
  const firstIdAgain = createStableCurlBlockId("guide.md", 0, command);
  const secondId = createStableCurlBlockId("guide.md", 1, command);

  assert.equal(firstId, firstIdAgain);
  assert.notEqual(firstId, secondId);
});

test("initializeCurlPlaygrounds restores saved edits and keeps stable block ids on each block", () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  const documentRef = createDocument();
  const windowRef = createWindow();
  global.document = documentRef;
  global.window = windowRef;

  try {
    const rawCommand = "curl https://api.example.com/users";
    const originalTemplate = formatCurlCommand(rawCommand);
    const secondBlockId = createStableCurlBlockId("guide.md", 1, originalTemplate);
    const storedEdit = formatCurlCommand("curl https://saved.example.com/users");
    const localStorageRef = createLocalStorage({
      "doccurl.curlEdits.v1": JSON.stringify({
        "guide.md": {
          [secondBlockId]: storedEdit,
        },
      }),
    });

    const docContent = new MockElement("div");
    docContent.append(createCurlBlock(rawCommand), createCurlBlock(rawCommand));

    const playgroundSystem = createPlaygroundSystem({
      docContent,
      fullscreenModal: new MockElement("div"),
      fullscreenMount: new MockElement("div"),
      apiFetch: async () => ({ ok: true }),
      parseJsonSafe: async () => ({}),
      withBasePath: (value) => value,
      envManager: {
        getCurrentEnv: () => ({}),
      },
      localStorageRef,
      documentRef,
      windowRef,
    });

    playgroundSystem.initializeCurlPlaygrounds("guide.md");

    const playgrounds = docContent.querySelectorAll(".curlPlaygroundInline");
    const editors = docContent.querySelectorAll(".curlEditor");
    const copyButtons = docContent.querySelectorAll(".copyBtn");

    assert.equal(playgrounds.length, 2);
    assert.equal(copyButtons.length, 2);
    assert.equal(
      playgrounds[0].dataset.curlBlockId,
      createStableCurlBlockId("guide.md", 0, originalTemplate),
    );
    assert.equal(playgrounds[1].dataset.curlBlockId, secondBlockId);
    assert.equal(editors[0].value, originalTemplate);
    assert.equal(editors[1].value, storedEdit);
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("copy button uses current env values and current editor text", async () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  const documentRef = createDocument();
  const windowRef = createWindow();
  global.document = documentRef;
  global.window = windowRef;

  try {
    const docContent = new MockElement("div");
    docContent.appendChild(createCurlBlock('curl "$BASE_URL/users"'));
    const copyCalls = [];

    const playgroundSystem = createPlaygroundSystem({
      docContent,
      fullscreenModal: new MockElement("div"),
      fullscreenMount: new MockElement("div"),
      apiFetch: async () => ({ ok: true }),
      parseJsonSafe: async () => ({}),
      withBasePath: (value) => value,
      envManager: {
        getCurrentEnv: () => ({
          BASE_URL: "https://api.example.com",
        }),
      },
      copyController: {
        async copyRequest(payload) {
          copyCalls.push(payload);
          return true;
        },
      },
      documentRef,
      windowRef,
    });

    playgroundSystem.initializeCurlPlaygrounds("guide.md");

    const editor = docContent.querySelector(".curlEditor");
    const copyButton = docContent.querySelector(".copyBtn");
    editor.value = 'curl "$BASE_URL/customers"';
    copyButton.click();

    assert.equal(copyCalls.length, 1);
    assert.equal(copyCalls[0].button, copyButton);
    assert.equal(copyCalls[0].command, 'curl "$BASE_URL/customers"');
    assert.deepEqual(copyCalls[0].env, {
      BASE_URL: "https://api.example.com",
    });
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("upload overlay opens and closes for upload-backed multipart rows without rendering a title", () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  const documentRef = createDocument();
  const windowRef = createWindow();
  global.document = documentRef;
  global.window = windowRef;

  try {
    const docContent = new MockElement("div");
    docContent.appendChild(
      createCurlBlock(
        'curl -F "company_id=1" -F "documents[]=@/tmp/license.pdf" -F "avatar=@R&{avatar.png}" https://api.example.com/upload',
      ),
    );

    const playgroundSystem = createPlaygroundSystem({
      docContent,
      fullscreenModal: new MockElement("div"),
      fullscreenMount: new MockElement("div"),
      apiFetch: async () => ({ ok: true }),
      parseJsonSafe: async () => ({}),
      withBasePath: (value) => value,
      envManager: {
        getCurrentEnv: () => ({}),
      },
      documentRef,
      windowRef,
    });

    playgroundSystem.initializeCurlPlaygrounds("guide.md");

    const uploadToggleButton = docContent.querySelector(".uploadToggleBtn");
    const uploadPanel = docContent.querySelector(".curlUploadPanel");
    const requestEditorView = docContent.querySelector(".requestEditorView");

    assert.equal(uploadToggleButton.hidden, false);
    assert.equal(uploadPanel.hidden, true);
    assert.equal(requestEditorView.hidden, false);
    assert.equal(docContent.querySelector(".curlUploadPanelHeader"), null);

    uploadToggleButton.click();

    const hideUploadsButton = docContent.querySelector(".hideUploadsBtn");
    const rows = docContent.querySelectorAll(".curlUploadRow");
    const fieldNames = docContent.querySelectorAll(".curlUploadFieldName");

    assert.equal(uploadPanel.hidden, false);
    assert.equal(requestEditorView.hidden, true);
    assert.equal(rows.length, 1);
    assert.equal(fieldNames[0].textContent, "documents[]");
    assert.equal(fieldNames[0].tagName, "LABEL");

    const fileInput = docContent.querySelector(".curlUploadInput");
    const playground = docContent.querySelector(".curlPlaygroundInline");
    assert.equal(
      fileInput.id,
      `${playground.dataset.curlBlockId}-upload-0`,
    );
    assert.equal(fieldNames[0].getAttribute("for"), fileInput.id);

    hideUploadsButton.click();

    assert.equal(uploadPanel.hidden, true);
    assert.equal(requestEditorView.hidden, false);
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("upload-backed multipart rows use distinct labels for repeated field names", () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  const documentRef = createDocument();
  const windowRef = createWindow();
  global.document = documentRef;
  global.window = windowRef;

  try {
    const docContent = new MockElement("div");
    docContent.appendChild(
      createCurlBlock(
        'curl -F "documents[]=@/tmp/license.pdf" -F "documents[]=@/tmp/certificate.pdf" https://api.example.com/upload',
      ),
    );

    const playgroundSystem = createPlaygroundSystem({
      docContent,
      fullscreenModal: new MockElement("div"),
      fullscreenMount: new MockElement("div"),
      apiFetch: async () => ({ ok: true }),
      parseJsonSafe: async () => ({}),
      withBasePath: (value) => value,
      envManager: {
        getCurrentEnv: () => ({}),
      },
      documentRef,
      windowRef,
    });

    playgroundSystem.initializeCurlPlaygrounds("guide.md");

    docContent.querySelector(".uploadToggleBtn").click();

    const fieldNames = docContent.querySelectorAll(".curlUploadFieldName");
    const fileInputs = docContent.querySelectorAll(".curlUploadInput");

    assert.deepEqual(
      fieldNames.map((element) => element.textContent),
      ["documents[] (1)", "documents[] (2)"],
    );
    assert.equal(fieldNames[0].getAttribute("for"), fileInputs[0].id);
    assert.equal(fieldNames[1].getAttribute("for"), fileInputs[1].id);
    const playground = docContent.querySelector(".curlPlaygroundInline");
    assert.equal(fileInputs[0].id, `${playground.dataset.curlBlockId}-upload-0`);
    assert.equal(fileInputs[1].id, `${playground.dataset.curlBlockId}-upload-1`);
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("upload-backed inputs use block-scoped ids across multiple playgrounds", () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  const documentRef = createDocument();
  const windowRef = createWindow();
  global.document = documentRef;
  global.window = windowRef;

  try {
    const docContent = new MockElement("div");
    const command = 'curl -F "documents[]=@/tmp/license.pdf" https://api.example.com/upload';
    docContent.append(createCurlBlock(command), createCurlBlock(command));

    const playgroundSystem = createPlaygroundSystem({
      docContent,
      fullscreenModal: new MockElement("div"),
      fullscreenMount: new MockElement("div"),
      apiFetch: async () => ({ ok: true }),
      parseJsonSafe: async () => ({}),
      withBasePath: (value) => value,
      envManager: {
        getCurrentEnv: () => ({}),
      },
      documentRef,
      windowRef,
    });

    playgroundSystem.initializeCurlPlaygrounds("guide.md");

    const playgrounds = docContent.querySelectorAll(".curlPlaygroundInline");
    const uploadButtons = docContent.querySelectorAll(".uploadToggleBtn");
    uploadButtons[0].click();
    uploadButtons[1].click();

    const labels = docContent.querySelectorAll(".curlUploadFieldName");
    const fileInputs = docContent.querySelectorAll(".curlUploadInput");

    assert.equal(playgrounds.length, 2);
    assert.equal(fileInputs.length, 2);
    assert.equal(fileInputs[0].id, `${playgrounds[0].dataset.curlBlockId}-upload-0`);
    assert.equal(fileInputs[1].id, `${playgrounds[1].dataset.curlBlockId}-upload-0`);
    assert.notEqual(fileInputs[0].id, fileInputs[1].id);
    assert.equal(labels[0].getAttribute("for"), fileInputs[0].id);
    assert.equal(labels[1].getAttribute("for"), fileInputs[1].id);
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("upload-backed multipart curl blocks run until a file is selected and then uses FormData", async () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  const documentRef = createDocument();
  const windowRef = createWindow();
  global.document = documentRef;
  global.window = windowRef;

  try {
    const docContent = new MockElement("div");
    docContent.appendChild(createCurlBlock('curl -F "documents[]=@/tmp/license.pdf" https://api.example.com/upload'));
    const apiCalls = [];
    const selectedFile = createFileLike("license.pdf", 1024);

    const playgroundSystem = createPlaygroundSystem({
      docContent,
      fullscreenModal: new MockElement("div"),
      fullscreenMount: new MockElement("div"),
      apiFetch: async (_url, options) => {
        apiCalls.push(options);
        return { ok: true };
      },
      parseJsonSafe: async () => ({
        success: true,
        output: '{"ok":true}',
      }),
      withBasePath: (value) => value,
      envManager: {
        getCurrentEnv: () => ({}),
      },
      FormDataRef: MockFormData,
      documentRef,
      windowRef,
    });

    playgroundSystem.initializeCurlPlaygrounds("guide.md");

    const uploadToggleButton = docContent.querySelector(".uploadToggleBtn");
    const runButton = docContent.querySelector(".runBtn");
    const uploadPanel = docContent.querySelector(".curlUploadPanel");
    const uploadError = docContent.querySelector(".curlUploadError");
    const requestEditorView = docContent.querySelector(".requestEditorView");
    const uploadRunButton = docContent.querySelector(".uploadRunBtn");

    runButton.click();
    await flushAsyncWork();

    assert.equal(apiCalls.length, 0);
    assert.equal(uploadPanel.hidden, false);
    assert.equal(requestEditorView.hidden, true);
    assert.match(uploadError.textContent, /documents\[\]/i);

    const fileInput = docContent.querySelector(".curlUploadInput");
    fileInput.files = [selectedFile];
    fileInput.dispatch("change");

    uploadRunButton.click();
    await flushAsyncWork();

    assert.equal(apiCalls.length, 1);
    assert.equal(apiCalls[0].headers, undefined);
    assert.ok(apiCalls[0].body instanceof MockFormData);
    assert.deepEqual(apiCalls[0].body.entries, [
      {
        name: "command",
        value: formatCurlCommand(
          'curl -F "documents[]=@/tmp/license.pdf" https://api.example.com/upload',
        ),
        filename: undefined,
      },
      { name: "upload_0", value: selectedFile, filename: "license.pdf" },
    ]);
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("env-resolved multipart uploads open the resolved picker UI and use resolved upload order", async () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  const documentRef = createDocument();
  const windowRef = createWindow();
  global.document = documentRef;
  global.window = windowRef;

  try {
    const docContent = new MockElement("div");
    docContent.appendChild(createCurlBlock("curl $SECOND $FIRST https://api.example.com/upload"));
    const apiCalls = [];
    const documentFile = createFileLike("license.pdf", 1024);
    const avatarFile = createFileLike("avatar.png", 2048);

    const playgroundSystem = createPlaygroundSystem({
      docContent,
      fullscreenModal: new MockElement("div"),
      fullscreenMount: new MockElement("div"),
      apiFetch: async (_url, options) => {
        apiCalls.push(options);
        return { ok: true };
      },
      parseJsonSafe: async () => ({
        success: true,
        output: '{"ok":true}',
      }),
      withBasePath: (value) => value,
      envManager: {
        getCurrentEnv: () => ({
          FIRST: '-F "avatar=@/tmp/avatar.png"',
          SECOND: '-F "documents[]=@/tmp/license.pdf"',
        }),
      },
      FormDataRef: MockFormData,
      documentRef,
      windowRef,
    });

    playgroundSystem.initializeCurlPlaygrounds("guide.md");

    const runButton = docContent.querySelector(".runBtn");
    const uploadPanel = docContent.querySelector(".curlUploadPanel");
    const requestEditorView = docContent.querySelector(".requestEditorView");
    const uploadRunButton = docContent.querySelector(".uploadRunBtn");

    runButton.click();
    await flushAsyncWork();

    assert.equal(apiCalls.length, 0);
    assert.equal(uploadPanel.hidden, false);
    assert.equal(requestEditorView.hidden, true);
    assert.deepEqual(
      docContent.querySelectorAll(".curlUploadFieldName").map((element) => element.textContent),
      ["documents[]", "avatar"],
    );

    const fileInputs = docContent.querySelectorAll(".curlUploadInput");
    fileInputs[0].files = [documentFile];
    fileInputs[0].dispatch("change");
    fileInputs[1].files = [avatarFile];
    fileInputs[1].dispatch("change");

    uploadRunButton.click();
    await flushAsyncWork();

    assert.equal(apiCalls.length, 1);
    assert.ok(apiCalls[0].body instanceof MockFormData);
    assert.equal(apiCalls[0].body.entries[0].name, "command");
    assert.match(apiCalls[0].body.entries[0].value, /documents\[\]=@\/tmp\/license\.pdf/);
    assert.match(apiCalls[0].body.entries[0].value, /avatar=@\/tmp\/avatar\.png/);
    assert.deepEqual(apiCalls[0].body.entries.slice(1), [
      { name: "upload_0", value: documentFile, filename: "license.pdf" },
      { name: "upload_1", value: avatarFile, filename: "avatar.png" },
    ]);
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("selected multipart files stay attached when upload rows are reordered", () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  const documentRef = createDocument();
  const windowRef = createWindow();
  global.document = documentRef;
  global.window = windowRef;

  try {
    const docContent = new MockElement("div");
    docContent.appendChild(
      createCurlBlock(
        'curl -F "documents[]=@/tmp/license.pdf" -F "avatar=@/tmp/avatar.png" https://api.example.com/upload',
      ),
    );
    const documentFile = createFileLike("license.pdf", 1024);
    const avatarFile = createFileLike("avatar.png", 2048);

    const playgroundSystem = createPlaygroundSystem({
      docContent,
      fullscreenModal: new MockElement("div"),
      fullscreenMount: new MockElement("div"),
      apiFetch: async () => ({ ok: true }),
      parseJsonSafe: async () => ({}),
      withBasePath: (value) => value,
      envManager: {
        getCurrentEnv: () => ({}),
      },
      documentRef,
      windowRef,
    });

    playgroundSystem.initializeCurlPlaygrounds("guide.md");

    const uploadToggleButton = docContent.querySelector(".uploadToggleBtn");
    const editor = docContent.querySelector(".curlEditor");

    uploadToggleButton.click();

    let fileInputs = docContent.querySelectorAll(".curlUploadInput");
    fileInputs[0].files = [documentFile];
    fileInputs[0].dispatch("change");
    fileInputs[1].files = [avatarFile];
    fileInputs[1].dispatch("change");

    editor.value =
      'curl -F "avatar=@/tmp/avatar.png" -F "documents[]=@/tmp/license.pdf" https://api.example.com/upload';
    editor.dispatch("input");

    assert.deepEqual(
      docContent.querySelectorAll(".curlUploadFieldName").map((element) => element.textContent),
      ["avatar", "documents[]"],
    );
    assert.deepEqual(
      docContent.querySelectorAll(".curlUploadMeta").map((element) => element.textContent),
      ["avatar.png (2 KB)", "license.pdf (1 KB)"],
    );
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("generated multipart curl still runs without browser uploads and keeps JSON payload", async () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  const documentRef = createDocument();
  const windowRef = createWindow();
  global.document = documentRef;
  global.window = windowRef;

  try {
    const docContent = new MockElement("div");
    docContent.appendChild(
      createCurlBlock('curl -F "avatar=@R&{avatar.png}" https://api.example.com/upload'),
    );
    const apiCalls = [];

    const playgroundSystem = createPlaygroundSystem({
      docContent,
      fullscreenModal: new MockElement("div"),
      fullscreenMount: new MockElement("div"),
      apiFetch: async (_url, options) => {
        apiCalls.push(options);
        return { ok: true };
      },
      parseJsonSafe: async () => ({
        success: true,
        output: '{"ok":true}',
      }),
      withBasePath: (value) => value,
      envManager: {
        getCurrentEnv: () => ({}),
      },
      documentRef,
      windowRef,
    });

    playgroundSystem.initializeCurlPlaygrounds("guide.md");

    const uploadToggleButton = docContent.querySelector(".uploadToggleBtn");
    const runButton = docContent.querySelector(".runBtn");

    assert.equal(uploadToggleButton.hidden, true);

    runButton.click();
    await flushAsyncWork();

    assert.equal(apiCalls.length, 1);
    assert.deepEqual(apiCalls[0].headers, {
      "Content-Type": "application/json",
    });
    assert.equal(
      apiCalls[0].body,
      JSON.stringify({
        command: formatCurlCommand(
          'curl -F "avatar=@R&{avatar.png}" https://api.example.com/upload',
        ),
      }),
    );
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("upload overlay auto-closes and disappears when curl stops having upload-backed fields", () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  const documentRef = createDocument();
  const windowRef = createWindow();
  global.document = documentRef;
  global.window = windowRef;

  try {
    const docContent = new MockElement("div");
    docContent.appendChild(
      createCurlBlock('curl -F "documents[]=@/tmp/license.pdf" https://api.example.com/upload'),
    );

    const playgroundSystem = createPlaygroundSystem({
      docContent,
      fullscreenModal: new MockElement("div"),
      fullscreenMount: new MockElement("div"),
      apiFetch: async () => ({ ok: true }),
      parseJsonSafe: async () => ({}),
      withBasePath: (value) => value,
      envManager: {
        getCurrentEnv: () => ({}),
      },
      documentRef,
      windowRef,
    });

    playgroundSystem.initializeCurlPlaygrounds("guide.md");

    const uploadToggleButton = docContent.querySelector(".uploadToggleBtn");
    const uploadPanel = docContent.querySelector(".curlUploadPanel");
    const requestEditorView = docContent.querySelector(".requestEditorView");
    const editor = docContent.querySelector(".curlEditor");

    uploadToggleButton.click();

    assert.equal(uploadPanel.hidden, false);
    assert.equal(requestEditorView.hidden, true);

    editor.value = 'curl -F "avatar=@R&{avatar.png}" https://api.example.com/upload';
    editor.dispatch("input");

    assert.equal(uploadPanel.hidden, true);
    assert.equal(requestEditorView.hidden, false);
    assert.equal(uploadToggleButton.hidden, true);
    assert.equal(docContent.querySelector(".curlUploadPanelHeader"), null);
    assert.equal(docContent.querySelectorAll(".curlUploadRow").length, 0);
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("page reset clears only the active document curl edits and keeps env values intact", () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  const documentRef = createDocument();
  const windowRef = createWindow();
  global.document = documentRef;
  global.window = windowRef;

  try {
    const rawCommand = "curl https://api.example.com/account";
    const originalTemplate = formatCurlCommand(rawCommand);
    const blockId = createStableCurlBlockId("page-a.md", 0, originalTemplate);
    const savedEdit = formatCurlCommand("curl https://edited.example.com/account");
    const localStorageRef = createLocalStorage({
      "doccurl.env": JSON.stringify({
        API_TOKEN: "secret-token",
      }),
      "doccurl.curlEdits.v1": JSON.stringify({
        "page-a.md": {
          [blockId]: savedEdit,
        },
        "page-b.md": {
          "curl-keep": "curl https://keep.example.com",
        },
      }),
    });

    const docContent = new MockElement("div");
    docContent.appendChild(createCurlBlock(rawCommand));

    const playgroundSystem = createPlaygroundSystem({
      docContent,
      fullscreenModal: new MockElement("div"),
      fullscreenMount: new MockElement("div"),
      apiFetch: async () => ({ ok: true }),
      parseJsonSafe: async () => ({}),
      withBasePath: (value) => value,
      envManager: {
        getCurrentEnv: () => ({
          API_TOKEN: "secret-token",
        }),
      },
      localStorageRef,
      documentRef,
      windowRef,
    });

    playgroundSystem.initializeCurlPlaygrounds("page-a.md");

    const editor = docContent.querySelector(".curlEditor");
    const output = docContent.querySelector(".curlOutput");

    assert.equal(editor.value, savedEdit);

    editor.value = "curl https://changed.example.com/account";
    editor.dispatch("input");
    editor.value = "curl https://blurred.example.com/account";
    editor.dispatch("blur");

    const storedAfterEdit = loadStoredCurlEdits(localStorageRef);
    assert.equal(Object.getPrototypeOf(storedAfterEdit), null);
    assert.equal(Object.getPrototypeOf(storedAfterEdit["page-a.md"]), null);
    assert.equal(
      storedAfterEdit["page-a.md"][blockId],
      formatCurlCommand("curl https://blurred.example.com/account"),
    );

    output.innerHTML = '<div class="outputEmpty">Custom response</div>';
    playgroundSystem.resetCurrentDocument();

    assert.equal(editor.value, originalTemplate);
    assert.ok(output.querySelector(".outputEmpty"));
    assert.deepEqual(loadStoredCurlEdits(localStorageRef), createNullProtoObject({
      "page-b.md": createNullProtoObject({
        "curl-keep": "curl https://keep.example.com",
      }),
    }));
    assert.deepEqual(JSON.parse(localStorageRef.getItem("doccurl.env")), {
      API_TOKEN: "secret-token",
    });
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("global reset clears all stored curl edits without touching env values", () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  const documentRef = createDocument();
  const windowRef = createWindow();
  global.document = documentRef;
  global.window = windowRef;

  try {
    const rawCommand = "curl https://api.example.com/docs";
    const originalTemplate = formatCurlCommand(rawCommand);
    const blockId = createStableCurlBlockId("page-a.md", 0, originalTemplate);
    const localStorageRef = createLocalStorage({
      "doccurl.env": JSON.stringify({
        BASE_URL: "https://api.example.com",
      }),
      "doccurl.curlEdits.v1": JSON.stringify({
        "page-a.md": {
          [blockId]: formatCurlCommand("curl https://edited.example.com/docs"),
        },
        "page-b.md": {
          "curl-keep": "curl https://keep.example.com",
        },
      }),
    });

    const docContent = new MockElement("div");
    docContent.appendChild(createCurlBlock(rawCommand));

    const playgroundSystem = createPlaygroundSystem({
      docContent,
      fullscreenModal: new MockElement("div"),
      fullscreenMount: new MockElement("div"),
      apiFetch: async () => ({ ok: true }),
      parseJsonSafe: async () => ({}),
      withBasePath: (value) => value,
      envManager: {
        getCurrentEnv: () => ({
          BASE_URL: "https://api.example.com",
        }),
      },
      localStorageRef,
      documentRef,
      windowRef,
    });

    playgroundSystem.initializeCurlPlaygrounds("page-a.md");
    const editor = docContent.querySelector(".curlEditor");

    assert.notEqual(editor.value, originalTemplate);

    playgroundSystem.resetAllDocuments();

    assert.equal(editor.value, originalTemplate);
    assert.deepEqual(loadStoredCurlEdits(localStorageRef), createNullProtoObject({}));
    assert.deepEqual(JSON.parse(localStorageRef.getItem("doccurl.env")), {
      BASE_URL: "https://api.example.com",
    });

    clearAllStoredCurlEdits(localStorageRef);
    assert.deepEqual(loadStoredCurlEdits(localStorageRef), createNullProtoObject({}));
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("loadStoredCurlEdits drops reserved keys and returns null-prototype maps", () => {
  const localStorageRef = createLocalStorage({
    "doccurl.curlEdits.v1": JSON.stringify({
      "__proto__": {
        polluted: "nope",
      },
      "page-a.md": {
        "__proto__": "ignore",
        constructor: "ignore",
        prototype: "ignore",
        "curl-safe": "curl https://api.example.com/safe",
      },
      constructor: {
        "curl-bad": "curl https://api.example.com/bad",
      },
    }),
  });

  const edits = loadStoredCurlEdits(localStorageRef);

  assert.equal(Object.getPrototypeOf(edits), null);
  assert.equal(Object.getPrototypeOf(edits["page-a.md"]), null);
  assert.deepEqual(edits, createNullProtoObject({
    "page-a.md": createNullProtoObject({
      "curl-safe": "curl https://api.example.com/safe",
    }),
  }));
  assert.equal(edits.__proto__, undefined);
  assert.equal(edits.constructor, undefined);
});
