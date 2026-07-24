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
    assert.equal(optionButtons.length, 4);
    assert.deepEqual(optionButtons.map((button) => button.textContent), [
      "Insomnia",
      "OpenAPI 3.1",
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

import { parseCurlForExport } from "../../frontend/modules/export/curl.js";

test("parseCurlForExport extracts --doccurl-request-schema and --doccurl-response-schema", () => {
  const command = [
    "curl",
    "-X",
    "POST",
    "https://api.example.com/users",
    "-H",
    "Content-Type: application/json",
    "-d",
    "'{\"name\":\"Ada\"}'",
    "--doccurl-request-schema",
    "'{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}},\"required\":[\"name\"]}'",
    "--doccurl-response-schema",
    "'{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"}}}'",
    "--doccurl-field-descriptions",
    "'{\"name\":\"The user display name\",\"id\":\"Server-assigned identifier\"}'",
  ].join(" ");

  const request = parseCurlForExport(command);
  assert.equal(request.method, "POST");
  assert.deepEqual(request.requestSchema, {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  });
  assert.deepEqual(request.responseSchema, {
    type: "object",
    properties: { id: { type: "string" } },
  });
  assert.deepEqual(request.fieldDescriptions, {
    name: "The user display name",
    id: "Server-assigned identifier",
  });
});

test("parseCurlForExport accepts --doccurl-*-schema equals form", () => {
  const command =
    "curl https://api.example.com/x --doccurl-request-schema='{\"type\":\"object\"}'";
  const request = parseCurlForExport(command);
  assert.deepEqual(request.requestSchema, { type: "object" });
});

test("parseCurlForExport returns null schemas when no flags are attached", () => {
  const request = parseCurlForExport("curl https://api.example.com/x");
  assert.equal(request.requestSchema, null);
  assert.equal(request.responseSchema, null);
  assert.equal(request.fieldDescriptions, null);
});

test("parseCurlForExport rejects malformed JSON in schema flag", () => {
  assert.throws(
    () =>
      parseCurlForExport(
        "curl https://api.example.com/x --doccurl-request-schema '{not json}'",
      ),
    /Invalid JSON in --doccurl-request-schema/,
  );
});

test("parseCurlForExport rejects file references in schema flag", () => {
  assert.throws(
    () =>
      parseCurlForExport(
        "curl https://api.example.com/x --doccurl-request-schema @schema.json",
      ),
    /File references are not supported/,
  );
});

test("parseCurlForExport rejects duplicate --doccurl-request-schema flags", () => {
  assert.throws(
    () =>
      parseCurlForExport(
        "curl https://api.example.com/x --doccurl-request-schema '{\"type\":\"object\"}' --doccurl-request-schema '{\"type\":\"array\"}'",
      ),
    /Duplicate flag: --doccurl-request-schema/,
  );
});

import { formatPostmanExport } from "../../frontend/modules/export/formatters/postman.js";
import { formatInsomniaExport } from "../../frontend/modules/export/formatters/insomnia.js";

function buildSingleRequestModel(request) {
  return {
    exportedAt: "2024-01-01T00:00:00.000Z",
    env: {},
    groups: [
      {
        docPath: "guide.md",
        requests: [
          {
            id: "block-1",
            docPath: "guide.md",
            blockIndex: 0,
            command: "curl",
            originalCommand: "curl",
            effectiveCommand: "curl",
            hasStoredEdit: false,
            request,
          },
        ],
      },
    ],
  };
}

test("Postman export includes request/response schemas and field descriptions", () => {
  const request = parseCurlForExport(
    [
      "curl",
      "-X",
      "POST",
      "https://api.example.com/users",
      "-d",
      "'{\"name\":\"Ada\"}'",
      "--doccurl-request-schema",
      "'{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}}}'",
      "--doccurl-response-schema",
      "'{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"}}}'",
      "--doccurl-field-descriptions",
      "'{\"name\":\"The user display name\"}'",
    ].join(" "),
  );

  const payload = formatPostmanExport(buildSingleRequestModel(request));
  const item = payload.item[0].item[0];
  assert.ok(typeof item.request.description === "string");
  assert.match(item.request.description, /Field descriptions/);
  assert.match(item.request.description, /The user display name/);
  assert.match(item.request.description, /Request schema \(JSON Schema 2020-12\)/);
  assert.match(item.request.description, /Response schema \(JSON Schema 2020-12\)/);
  assert.deepEqual(item.request.body, {
    mode: "raw",
    raw: '{"name":"Ada"}',
    options: { raw: { language: "json" } },
  });
});

test("Postman export omits description when no schemas are attached", () => {
  const request = parseCurlForExport("curl https://api.example.com/users");
  const payload = formatPostmanExport(buildSingleRequestModel(request));
  const item = payload.item[0].item[0];
  assert.equal("description" in item.request, false);
  assert.equal("body" in item.request, false);
});

test("Insomnia export includes schema metadata and description", () => {
  const request = parseCurlForExport(
    [
      "curl",
      "-X",
      "POST",
      "https://api.example.com/users",
      "-d",
      "'{\"name\":\"Ada\"}'",
      "--doccurl-request-schema",
      "'{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}}}'",
      "--doccurl-response-schema",
      "'{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"}}}'",
      "--doccurl-field-descriptions",
      "'{\"name\":\"The user display name\"}'",
    ].join(" "),
  );

  const payload = formatInsomniaExport(buildSingleRequestModel(request));
  const req = payload.resources.find((r) => r._type === "request");
  assert.ok(req);
  assert.match(req.description, /Field descriptions/);
  assert.match(req.description, /Request schema/);
  assert.match(req.description, /Response schema/);
  assert.deepEqual(req.meta.requestSchema, request.requestSchema);
  assert.deepEqual(req.meta.responseSchema, request.responseSchema);
  assert.equal(req.meta["doccurl://note"].includes("documentation only"), true);
});

test("Insomnia export has empty meta object when no schemas are attached", () => {
  const request = parseCurlForExport("curl https://api.example.com/users");
  const payload = formatInsomniaExport(buildSingleRequestModel(request));
  const req = payload.resources.find((r) => r._type === "request");
  assert.equal(req.description, "");
  assert.deepEqual(Object.keys(req.meta), ["doccurl://note"]);
});

import { buildOpenApiSpec } from "../../frontend/modules/export/formatters/openapi.js";

function buildModelFromCommands(commands) {
  return {
    exportedAt: "2024-01-01T00:00:00.000Z",
    env: {},
    groups: [
      {
        docPath: "guide.md",
        requests: commands.map((command, index) => {
          const request = parseCurlForExport(command);
          return {
            id: `block-${index}`,
            docPath: "guide.md",
            blockIndex: index,
            command,
            originalCommand: command,
            effectiveCommand: command,
            hasStoredEdit: false,
            request,
          };
        }),
      },
    ],
  };
}

test("OpenAPI export builds a single doc with paths, servers, and component schemas", () => {
  const command =
    "curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{\"name\":\"Ada\"}' --doccurl-request-schema '{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}},\"required\":[\"name\"]}' --doccurl-response-schema '{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"}}}' --doccurl-field-descriptions '{\"name\":\"The user display name\",\"id\":\"Server-assigned identifier\"}'";
  const spec = buildOpenApiSpec(buildModelFromCommands([command]));
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.title, "DocCurl Export");
  assert.deepEqual(spec.servers, [{ url: "https://api.example.com" }]);
  assert.equal(Boolean(spec.paths["/users"]), true);
  assert.equal(Boolean(spec.paths["/users"].post), true);
  const post = spec.paths["/users"].post;
  assert.equal(post.summary, "POST https://api.example.com/users");
  assert.match(post.description, /Field descriptions/);
  assert.match(post.description, /The user display name/);
  assert.equal(Boolean(post.requestBody), true);
  assert.equal(Boolean(post.requestBody.content["application/json"]), true);
  assert.equal(Boolean(post.requestBody.content["application/json"].schema.$ref), true);
  assert.equal(Boolean(post.responses["200"].content["application/json"].schema.$ref), true);

  const componentNames = Object.keys(spec.components.schemas);
  assert.equal(componentNames.length, 2);
  const requestSchema = spec.components.schemas[componentNames[0]];
  assert.equal(requestSchema.properties.name.description, "The user display name");
  const responseSchema = spec.components.schemas[componentNames[1]];
  assert.equal(responseSchema.properties.id.description, "Server-assigned identifier");
});

test("OpenAPI export preserves example body when no request schema is attached", () => {
  const command = "curl -X POST https://api.example.com/echo -d '{\"a\":1}'";
  const spec = buildOpenApiSpec(buildModelFromCommands([command]));
  const post = spec.paths["/echo"].post;
  assert.deepEqual(post.requestBody.content["text/plain"].example, { a: 1 });
  assert.equal(post.responses["200"].content["text/plain"].schema.type, "string");
});

test("OpenAPI export derives path parameters from numeric/uuid segments", () => {
  const command = "curl https://api.example.com/users/42";
  const spec = buildOpenApiSpec(buildModelFromCommands([command]));
  assert.equal(Boolean(spec.paths["/users/{var1}"]), true);
  const getOp = spec.paths["/users/{var1}"].get;
  assert.equal(getOp.parameters.length, 1);
  assert.equal(getOp.parameters[0].name, "var1");
  assert.equal(getOp.parameters[0].in, "path");
});

test("OpenAPI export merges operations with same path and method", () => {
  const spec = buildOpenApiSpec(
    buildModelFromCommands([
      "curl https://api.example.com/users",
      "curl https://api.example.com/users",
    ]),
  );
  const getOp = spec.paths["/users"].get;
  assert.equal(getOp.summary, "GET https://api.example.com/users / GET https://api.example.com/users");
});

test("OpenAPI export omits description when no schemas or field descriptions", () => {
  const command = "curl https://api.example.com/health";
  const spec = buildOpenApiSpec(buildModelFromCommands([command]));
  const op = spec.paths["/health"].get;
  assert.equal(op.description, undefined);
  assert.equal(Object.keys(spec.components.schemas).length, 0);
});

test("OpenAPI export exposes query and header parameters", () => {
  const command =
    "curl 'https://api.example.com/search?q=hello' -H 'Accept: application/json'";
  const spec = buildOpenApiSpec(buildModelFromCommands([command]));
  const op = spec.paths["/search"].get;
  const queryParam = op.parameters.find((p) => p.in === "query");
  const headerParam = op.parameters.find((p) => p.in === "header");
  assert.equal(queryParam.name, "q");
  assert.equal(queryParam.example, "hello");
  assert.equal(headerParam.name, "Accept");
  assert.equal(headerParam.example, "application/json");
});

test("OpenAPI export supports multipart form data", () => {
  const command = "curl -F 'file=@/tmp/x.png' -F 'note=hello' https://api.example.com/upload";
  const spec = buildOpenApiSpec(buildModelFromCommands([command]));
  const post = spec.paths["/upload"].post;
  assert.equal(Boolean(post.requestBody.content["multipart/form-data"]), true);
});

