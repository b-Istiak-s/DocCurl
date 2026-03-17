import test from "node:test";
import assert from "node:assert/strict";

import { createCurlExportSystem } from "../../frontend/modules/export/index.js";
import {
  buildExportCollectionModel,
  extractCurlBlocksFromMarkdown,
} from "../../frontend/modules/export/collection-model.js";
import {
  createStableCurlBlockId,
  formatCurlCommand,
} from "../../frontend/modules/playground.js";

const textDecoder = new TextDecoder();

function readUint16(view, offset) {
  return view.getUint16(offset, true);
}

function readUint32(view, offset) {
  return view.getUint32(offset, true);
}

function readStoredZipEntries(bufferLike) {
  const bytes = bufferLike instanceof Uint8Array ? bufferLike : new Uint8Array(bufferLike);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const signature = readUint32(view, offset);
    if (signature !== 0x04034b50) {
      break;
    }

    const compressionMethod = readUint16(view, offset + 8);
    const compressedSize = readUint32(view, offset + 18);
    const fileNameLength = readUint16(view, offset + 26);
    const extraLength = readUint16(view, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const nameBytes = bytes.slice(nameStart, nameStart + fileNameLength);
    const fileName = textDecoder.decode(nameBytes);

    assert.equal(compressionMethod, 0);
    files[fileName] = bytes.slice(dataStart, dataStart + compressedSize);
    offset = dataStart + compressedSize;
  }

  return files;
}

function decodeText(bytes) {
  return textDecoder.decode(bytes);
}

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
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.style = {};
    this._className = "";
    this.classList = new MockClassList(this);
  }

  set className(value) {
    this.classList.set(value);
  }

  get className() {
    return this._className;
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
    if (name === "class") {
      this.className = String(value);
    }
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
    const results = [];

    const walk = (node) => {
      node.children.forEach((child) => {
        if (matchesSelector(child, selector)) {
          results.push(child);
        }
        walk(child);
      });
    };

    walk(this);
    return results;
  }
}

function matchesSelector(element, selector) {
  if (selector.startsWith(".")) {
    return element.classList.contains(selector.slice(1));
  }

  return element.tagName === selector.toUpperCase();
}

function createDocument() {
  const body = new MockElement("body");
  return {
    body,
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
  };
}

test("extractCurlBlocksFromMarkdown finds curl fences only", () => {
  assert.deepEqual(
    extractCurlBlocksFromMarkdown(`
## Example

\`\`\`curl
curl https://api.example.com/users
\`\`\`

\`\`\`js
console.log("ignore");
\`\`\`

\`\`\`curl
curl -X POST https://api.example.com/users
\`\`\`
`),
    [
      "curl https://api.example.com/users",
      "curl -X POST https://api.example.com/users",
    ],
  );
});

test("buildExportCollectionModel uses the nearest markdown heading for request names", async () => {
  const model = await buildExportCollectionModel({
    apiFetch: async (url) => {
      if (String(url).includes("/api/docs/tree")) {
        return {
          ok: true,
          json: async () => ({
            tree: [{ type: "file", name: "guide.md", path: "guide.md" }],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          markdown: `
# Authentication

\`\`\`curl
curl "$BASE_URL/login"
\`\`\`

## Profile

\`\`\`curl
curl "$BASE_URL/me"
\`\`\`
`,
        }),
      };
    },
    parseJsonSafe: async (response) => response.json(),
    withBasePath: (value) => value,
    localStorageRef: createLocalStorage(),
    env: {},
  });

  assert.equal(model.groups[0].requests[0].request.name, "Authentication");
  assert.equal(model.groups[0].requests[1].request.name, "Profile");
});

test("createCurlExportSystem renders export format buttons and exports stored edits with env", async () => {
  const previousDocument = global.document;
  const previousWindow = global.window;

  const documentRef = createDocument();
  const windowRef = {
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
    URL,
  };
  global.document = documentRef;
  global.window = windowRef;

  try {
    const downloads = [];
    const originalCommand = formatCurlCommand(
      'curl "$BASE_URL/users" -H "Authorization: Bearer $API_TOKEN"',
    );
    const blockId = createStableCurlBlockId("guide.md", 0, originalCommand);
    const localStorageRef = createLocalStorage({
      "doccurl.curlEdits.v1": JSON.stringify({
        "guide.md": {
          [blockId]: 'curl "$BASE_URL/edited" -H "Authorization: Bearer $API_TOKEN"',
        },
      }),
    });

    const exportSystem = createCurlExportSystem({
      apiFetch: async (url) => {
        if (String(url).includes("/api/docs/tree")) {
          return {
            ok: true,
            json: async () => ({
              tree: [
                {
                  type: "file",
                  name: "guide.md",
                  path: "guide.md",
                },
              ],
            }),
          };
        }

        return {
          ok: true,
          json: async () => ({
            markdown:
              '## List Users\n\n```curl\ncurl "$BASE_URL/users" -H "Authorization: Bearer $API_TOKEN"\n```',
          }),
        };
      },
      parseJsonSafe: async (response) => response.json(),
      withBasePath: (value) => value,
      envManager: {
        getCurrentEnv: () => ({
          BASE_URL: "https://api.example.com",
          API_TOKEN: "secret-token",
        }),
      },
      localStorageRef,
      documentRef,
      windowRef,
      downloadJsonImpl(filename, payload) {
        downloads.push({ filename, payload, kind: "json" });
      },
      downloadBinaryImpl(filename, payload, options) {
        downloads.push({ filename, payload, kind: "binary", options });
      },
    });

    exportSystem.openExportDialog();

    const optionButtons = documentRef.body.querySelectorAll(".exportOptionBtn");
    assert.equal(optionButtons.length, 3);
    assert.deepEqual(optionButtons.map((button) => button.textContent), [
      "Insomnia",
      "Postman",
      "Markdown",
    ]);

    await exportSystem.exportAll("postman");

    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].filename, "doccurl-export-postman.json");
    assert.equal(downloads[0].payload.item[0].item[0].name, "List Users");
    assert.equal(
      downloads[0].payload.item[0].item[0].request.url.raw,
      "{{BASE_URL}}/edited",
    );
    assert.deepEqual(downloads[0].payload.item[0].item[0].request.url.host, [
      "{{BASE_URL}}",
    ]);
    assert.deepEqual(downloads[0].payload.item[0].item[0].request.url.path, [
      "edited",
    ]);
    assert.deepEqual(downloads[0].payload.variable, [
      { key: "BASE_URL", value: "https://api.example.com", type: "string" },
      { key: "API_TOKEN", value: "secret-token", type: "string" },
    ]);
    assert.equal("environment" in downloads[0].payload, false);

    await exportSystem.exportAll("markdown");

    assert.equal(downloads[1].filename, "doccurl-export-markdown.zip");
    assert.equal(downloads[1].kind, "binary");
    assert.equal(downloads[1].options.mimeType, "application/zip");

    const archive = readStoredZipEntries(downloads[1].payload);
    assert.deepEqual(Object.keys(archive), ["guide.md"]);
    assert.equal(
      decodeText(archive["guide.md"]),
      '## List Users\n\n```curl\ncurl "$BASE_URL/edited" -H "Authorization: Bearer $API_TOKEN"\n```',
    );
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});

test("markdown export preserves untouched markdown and only replaces saved curl blocks", async () => {
  const originalCommand = formatCurlCommand('curl "$BASE_URL/users"');
  const editedBlockId = createStableCurlBlockId("guide.md", 0, originalCommand);
  const localStorageRef = createLocalStorage({
    "doccurl.curlEdits.v1": JSON.stringify({
      "guide.md": {
        [editedBlockId]: 'curl "$BASE_URL/people"',
      },
    }),
  });

  const downloads = [];
  const exportSystem = createCurlExportSystem({
    apiFetch: async (url) => {
      if (String(url).includes("/api/docs/tree")) {
        return {
          ok: true,
          json: async () => ({
            tree: [
              { type: "file", name: "guide.md", path: "guide.md" },
              { type: "file", name: "notes.md", path: "nested/notes.md" },
            ],
          }),
        };
      }

      if (String(url).includes("guide.md")) {
        return {
          ok: true,
          json: async () => ({
            markdown: [
              "# Guide",
              "",
              "```curl",
              'curl "$BASE_URL/users"',
              "```",
              "",
              "```js",
              'console.log("keep me");',
              "```",
              "",
              "```curl",
              "curl https://api.example.com/health",
              "```",
            ].join("\n"),
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          markdown: "# Notes\n\nNo curl here.\n",
        }),
      };
    },
    parseJsonSafe: async (response) => response.json(),
    withBasePath: (value) => value,
    envManager: {
      getCurrentEnv: () => ({}),
    },
    localStorageRef,
    documentRef: createDocument(),
    windowRef: {
      setTimeout(callback) {
        callback();
        return 1;
      },
      clearTimeout() {},
      URL,
    },
    downloadBinaryImpl(filename, payload) {
      downloads.push({ filename, payload });
    },
  });

  await exportSystem.exportAll("markdown");

  const archive = readStoredZipEntries(downloads[0].payload);
  assert.deepEqual(Object.keys(archive).sort(), ["guide.md", "nested/notes.md"]);
  assert.equal(
    decodeText(archive["guide.md"]),
    [
      "# Guide",
      "",
      "```curl",
      'curl "$BASE_URL/people"',
      "```",
      "",
      "```js",
      'console.log("keep me");',
      "```",
      "",
      "```curl",
      "curl https://api.example.com/health",
      "```",
    ].join("\n"),
  );
  assert.equal(decodeText(archive["nested/notes.md"]), "# Notes\n\nNo curl here.\n");
});
