const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { startServer } = require("../backend/server");

function createTempDocs() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "doccurl-auth-"));
  fs.mkdirSync(path.join(baseDir, "file"), { recursive: true });
  fs.writeFileSync(path.join(baseDir, "page.md"), "# Root page\n");
  fs.writeFileSync(path.join(baseDir, "file", "page.md"), "# Nested page\n");
  fs.writeFileSync(path.join(baseDir, "zzz.md"), "# Last page\n");
  return baseDir;
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function withServer({ docsDir, dev = false, password = "" }, run) {
  const server = startServer(0, docsDir, { dev, password });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run({ baseUrl });
  } finally {
    await closeServer(server);
  }
}

test("production mode requires password", () => {
  const docsDir = createTempDocs();
  try {
    assert.throws(
      () => startServer(0, docsDir, { dev: false, password: "" }),
      /requires --password/i,
    );
  } finally {
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
});

test("protected APIs are blocked until login succeeds", async () => {
  const docsDir = createTempDocs();
  try {
    await withServer(
      { docsDir, dev: false, password: "secret123" },
      async ({ baseUrl }) => {
        const statusResponse = await fetch(`${baseUrl}/api/auth/status`);
        const statusPayload = await statusResponse.json();
        assert.equal(statusPayload.authEnabled, true);
        assert.equal(statusPayload.authenticated, false);

        const blockedTree = await fetch(`${baseUrl}/api/docs/tree`);
        assert.equal(blockedTree.status, 401);

        const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "wrong" }),
        });
        assert.equal(invalidLogin.status, 401);

        const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "secret123" }),
        });
        assert.equal(loginResponse.status, 200);
        const cookieHeader = loginResponse.headers.get("set-cookie");
        assert.ok(cookieHeader);
        const sessionCookie = cookieHeader.split(";")[0];
        assert.ok(sessionCookie.startsWith("doccurl_session="));

        const treeResponse = await fetch(`${baseUrl}/api/docs/tree`, {
          headers: { Cookie: sessionCookie },
        });
        assert.equal(treeResponse.status, 200);
        const treePayload = await treeResponse.json();
        assert.ok(Array.isArray(treePayload.tree));
        assert.equal(treePayload.tree[0].type, "dir");
        assert.equal(treePayload.tree[1].type, "file");

        const docResponse = await fetch(
          `${baseUrl}/api/docs/content?path=${encodeURIComponent("file/page.md")}`,
          { headers: { Cookie: sessionCookie } },
        );
        assert.equal(docResponse.status, 200);
        const docPayload = await docResponse.json();
        assert.match(docPayload.html, /Nested page/);
      },
    );
  } finally {
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
});

test("path traversal is rejected for docs content endpoint", async () => {
  const docsDir = createTempDocs();
  try {
    await withServer(
      { docsDir, dev: false, password: "secret123" },
      async ({ baseUrl }) => {
        const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "secret123" }),
        });
        const sessionCookie = loginResponse.headers.get("set-cookie").split(";")[0];

        const response = await fetch(
          `${baseUrl}/api/docs/content?path=${encodeURIComponent("../nope.md")}`,
          { headers: { Cookie: sessionCookie } },
        );
        assert.equal(response.status, 400);
      },
    );
  } finally {
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
});

test("session cookies become invalid after restart", async () => {
  const docsDir = createTempDocs();
  try {
    let staleCookie = "";

    const firstServer = startServer(0, docsDir, {
      dev: false,
      password: "secret123",
    });
    const firstPort = firstServer.address().port;

    const loginResponse = await fetch(
      `http://127.0.0.1:${firstPort}/api/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "secret123" }),
      },
    );
    staleCookie = loginResponse.headers.get("set-cookie").split(";")[0];
    await closeServer(firstServer);

    const secondServer = startServer(0, docsDir, {
      dev: false,
      password: "secret123",
    });
    const secondPort = secondServer.address().port;

    const blocked = await fetch(`http://127.0.0.1:${secondPort}/api/docs/tree`, {
      headers: { Cookie: staleCookie },
    });
    assert.equal(blocked.status, 401);
    await closeServer(secondServer);
  } finally {
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
});

test("development mode stays open when password is not provided", async () => {
  const docsDir = createTempDocs();
  try {
    await withServer(
      { docsDir, dev: true, password: "" },
      async ({ baseUrl }) => {
        const statusResponse = await fetch(`${baseUrl}/api/auth/status`);
        const statusPayload = await statusResponse.json();
        assert.equal(statusPayload.authEnabled, false);
        assert.equal(statusPayload.authenticated, true);

        const treeResponse = await fetch(`${baseUrl}/api/docs/tree`);
        assert.equal(treeResponse.status, 200);
      },
    );
  } finally {
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
});
