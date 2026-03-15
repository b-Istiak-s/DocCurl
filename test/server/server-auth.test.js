import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import net from "node:net";

import { startServer } from "../../server/index.js";

let portsBlocked = false;
let portsChecked = false;
let printedPortWarning = false;

async function checkPortBinding() {
  return new Promise((resolve) => {
    const probe = net.createServer();

    probe.once("error", () => {
      resolve(false);
    });

    probe.listen(0, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

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

async function withServer(
  {
    docsDir,
    dev = false,
    password = "",
    collapse = false,
    curlRouteOptions = {},
    docsRouteOptions = {},
  },
  run,
) {
  if (!portsChecked) {
    portsChecked = true;
    portsBlocked = !(await checkPortBinding());
    if (portsBlocked && !printedPortWarning) {
      printedPortWarning = true;
      console.warn("Skipping socket-based server tests: local port binding is blocked.");
    }
  }

  if (portsBlocked) {
    return false;
  }

  let server;
  try {
    server = startServer(0, docsDir, {
      dev,
      password,
      collapse,
      host: "127.0.0.1",
      curlRouteOptions,
      docsRouteOptions,
    });
  } catch (error) {
    if (error.code === "EPERM") {
      portsBlocked = true;
      if (!printedPortWarning) {
        printedPortWarning = true;
        console.warn("Skipping socket-based server tests: local port binding is blocked.");
      }
      return false;
    }
    throw error;
  }
  const listenResult = await Promise.race([
    once(server, "listening").then(() => ({ ok: true })),
    once(server, "error").then(([error]) => ({ error })),
  ]);

  if (listenResult.error) {
    if (listenResult.error.code === "EPERM") {
      portsBlocked = true;
      if (!printedPortWarning) {
        printedPortWarning = true;
        console.warn("Skipping socket-based server tests: local port binding is blocked.");
      }
      return false;
    }
    throw listenResult.error;
  }

  const addressInfo = server.address();
  const port = addressInfo && typeof addressInfo === "object" ? addressInfo.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run({ baseUrl });
    return true;
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
    const started = await withServer(
      { docsDir, dev: false, password: "secret123" },
      async ({ baseUrl }) => {
        const statusResponse = await fetch(`${baseUrl}/api/auth/status`);
        const statusPayload = await statusResponse.json();
        assert.equal(statusPayload.authEnabled, true);
        assert.equal(statusPayload.authenticated, false);
        assert.deepEqual(statusPayload.features, {
          contentCollapse: false,
        });

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
    if (!started) {
      return;
    }
  } finally {
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
});

test("path traversal is rejected for docs content endpoint", async () => {
  const docsDir = createTempDocs();
  try {
    const started = await withServer(
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
    if (!started) {
      return;
    }
  } finally {
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
});

test("missing docs content returns 404", async () => {
  const docsDir = createTempDocs();
  try {
    const started = await withServer(
      { docsDir, dev: true },
      async ({ baseUrl }) => {
        const response = await fetch(
          `${baseUrl}/api/docs/content?path=${encodeURIComponent("missing.md")}`,
        );
        const payload = await response.json();

        assert.equal(response.status, 404);
        assert.equal(payload.error, "File not found");
      },
    );
    if (!started) {
      return;
    }
  } finally {
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
});

test("unreadable docs content returns 500 and logs the underlying error", async () => {
  const docsDir = createTempDocs();
  const loggedErrors = [];

  try {
    const started = await withServer(
      {
        docsDir,
        dev: true,
        docsRouteOptions: {
          fsReadFile: (_filePath, _encoding, callback) => {
            const error = new Error("permission denied");
            error.code = "EACCES";
            callback(error);
          },
          logger: {
            error: (...args) => loggedErrors.push(args),
          },
        },
      },
      async ({ baseUrl }) => {
        const response = await fetch(
          `${baseUrl}/api/docs/content?path=${encodeURIComponent("page.md")}`,
        );
        const payload = await response.json();

        assert.equal(response.status, 500);
        assert.equal(payload.error, "Unable to read document");
      },
    );
    if (!started) {
      return;
    }

    assert.equal(loggedErrors.length, 1);
    assert.equal(loggedErrors[0][0], "Unable to read document");
    assert.equal(loggedErrors[0][1].code, "EACCES");
    assert.match(loggedErrors[0][1].path, /page\.md$/);
  } finally {
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
});

test("session cookies become invalid after restart", async () => {
  const docsDir = createTempDocs();
  try {
    if (!portsChecked) {
      portsChecked = true;
      portsBlocked = !(await checkPortBinding());
      if (portsBlocked && !printedPortWarning) {
        printedPortWarning = true;
        console.warn("Skipping socket-based server tests: local port binding is blocked.");
      }
    }

    if (portsBlocked) {
      return;
    }

    let firstServer;
    try {
      firstServer = startServer(0, docsDir, {
        dev: false,
        password: "secret123",
        host: "127.0.0.1",
      });
    } catch (error) {
      if (error.code === "EPERM") {
        portsBlocked = true;
        if (!printedPortWarning) {
          printedPortWarning = true;
          console.warn("Skipping socket-based server tests: local port binding is blocked.");
        }
        return;
      }
      throw error;
    }

    const firstListen = await Promise.race([
      once(firstServer, "listening").then(() => ({ ok: true })),
      once(firstServer, "error").then(([error]) => ({ error })),
    ]);
    if (firstListen.error) {
      if (firstListen.error.code === "EPERM") {
        portsBlocked = true;
        if (!printedPortWarning) {
          printedPortWarning = true;
          console.warn("Skipping socket-based server tests: local port binding is blocked.");
        }
        return;
      }
      throw firstListen.error;
    }

    const firstAddress = firstServer.address();
    const firstPort = firstAddress && typeof firstAddress === "object" ? firstAddress.port : 0;

    const loginResponse = await fetch(`http://127.0.0.1:${firstPort}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "secret123" }),
    });
    const staleCookie = loginResponse.headers.get("set-cookie").split(";")[0];
    await closeServer(firstServer);

    let secondServer;
    try {
      secondServer = startServer(0, docsDir, {
        dev: false,
        password: "secret123",
        host: "127.0.0.1",
      });
    } catch (error) {
      if (error.code === "EPERM") {
        portsBlocked = true;
        if (!printedPortWarning) {
          printedPortWarning = true;
          console.warn("Skipping socket-based server tests: local port binding is blocked.");
        }
        return;
      }
      throw error;
    }
    const secondListen = await Promise.race([
      once(secondServer, "listening").then(() => ({ ok: true })),
      once(secondServer, "error").then(([error]) => ({ error })),
    ]);
    if (secondListen.error) {
      if (secondListen.error.code === "EPERM") {
        portsBlocked = true;
        if (!printedPortWarning) {
          printedPortWarning = true;
          console.warn("Skipping socket-based server tests: local port binding is blocked.");
        }
        return;
      }
      throw secondListen.error;
    }

    const secondAddress = secondServer.address();
    const secondPort = secondAddress && typeof secondAddress === "object" ? secondAddress.port : 0;

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
    const started = await withServer(
      { docsDir, dev: true, password: "" },
      async ({ baseUrl }) => {
        const statusResponse = await fetch(`${baseUrl}/api/auth/status`);
        const statusPayload = await statusResponse.json();
        assert.equal(statusPayload.authEnabled, false);
        assert.equal(statusPayload.authenticated, true);
        assert.deepEqual(statusPayload.features, {
          contentCollapse: false,
        });

        const treeResponse = await fetch(`${baseUrl}/api/docs/tree`);
        assert.equal(treeResponse.status, 200);
      },
    );
    if (!started) {
      return;
    }
  } finally {
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
});

test("auth status exposes the collapse feature flag when enabled", async () => {
  const docsDir = createTempDocs();
  try {
    const started = await withServer(
      { docsDir, dev: true, collapse: true },
      async ({ baseUrl }) => {
        const statusResponse = await fetch(`${baseUrl}/api/auth/status`);
        const statusPayload = await statusResponse.json();

        assert.equal(statusPayload.authEnabled, false);
        assert.equal(statusPayload.authenticated, true);
        assert.deepEqual(statusPayload.features, {
          contentCollapse: true,
        });
      },
    );
    if (!started) {
      return;
    }
  } finally {
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
});
