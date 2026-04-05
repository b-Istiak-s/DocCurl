import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import {
  CURL_RESPONSE_META_END,
  CURL_RESPONSE_META_START,
} from "../../engine/curl/constants.js";

import {
  setupCurlRoutes,
  setupSoccliRoutes,
  parseCurlCommand,
  validateTargetUrl,
} from "../../engine/index.js";

let portsBlocked = false;
let portsChecked = false;
let printedPortWarning = false;

async function withTempDir(prefix, run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

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

async function withServer(options, run) {
  if (!portsChecked) {
    portsChecked = true;
    portsBlocked = !(await checkPortBinding());
    if (portsBlocked && !printedPortWarning) {
      printedPortWarning = true;
      console.warn("Skipping socket-based engine tests: local port binding is blocked.");
    }
  }

  if (portsBlocked) {
    return false;
  }

  const app = express();
  app.use(express.json({ limit: "128kb" }));
  setupCurlRoutes(app, {
    containerRuntime: "docker",
    ...options,
  });
  setupSoccliRoutes(app, {
    containerRuntime: "docker",
    ...options,
  });

  const server = app.listen(0, "127.0.0.1");
  const listenResult = await Promise.race([
    once(server, "listening").then(() => ({ ok: true })),
    once(server, "error").then(([error]) => ({ error })),
  ]);

  if (listenResult.error) {
    if (listenResult.error.code === "EPERM") {
      portsBlocked = true;
      if (!printedPortWarning) {
        printedPortWarning = true;
        console.warn("Skipping socket-based engine tests: local port binding is blocked.");
      }
      return false;
    }
    throw listenResult.error;
  }

  const addressInfo = server.address();
  const port = addressInfo && typeof addressInfo === "object" ? addressInfo.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
    return true;
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

test("parseCurlCommand preserves full multiline JSON body", () => {
  const command = `curl -X POST "https://api.example.com/api/auth/register" \\
 -H "Content-Type: application/json" \\
 -d '{"name":"Employee","email":"employee@example.com","password":"password"}'`;

  const parsed = parseCurlCommand(command);
  assert.equal(parsed.method, "POST");
  assert.equal(parsed.url, "https://api.example.com/api/auth/register");
  assert.equal(
    parsed.body,
    '{"name":"Employee","email":"employee@example.com","password":"password"}',
  );
});

test("parseCurlCommand accepts CRLF multiline curl commands pasted from Windows editors", () => {
  const command =
    'curl \\\r\n' +
    '  -X POST \\\r\n' +
    '  "https://api.example.com/documents" \\\r\n' +
    '  -H "Authorization: Bearer $TOKEN" \\\r\n' +
    '  -F "compliance_item_id=1" \\\r\n' +
    '  -F "file=@/path/to/license.pdf"';

  const parsed = parseCurlCommand(command);

  assert.equal(parsed.method, "POST");
  assert.equal(parsed.url, "https://api.example.com/documents");
  assert.deepEqual(parsed.headers, [
    { name: "Authorization", value: "Bearer $TOKEN" },
  ]);
  assert.deepEqual(parsed.formParts, [
    {
      name: "compliance_item_id",
      value: "1",
      source: "text",
    },
    {
      name: "file",
      source: "upload",
      uploadReference: "/path/to/license.pdf",
      filename: "license.pdf",
      uploadIndex: 0,
    },
  ]);
});

test("parseCurlCommand parses quoted URL and headers", () => {
  const parsed = parseCurlCommand(
    'curl --url "https://api.example.com:8443/users" -H "Authorization: Bearer abc123"',
  );

  assert.equal(parsed.method, "GET");
  assert.equal(parsed.url, "https://api.example.com:8443/users");
  assert.deepEqual(parsed.headers, [
    { name: "Authorization", value: "Bearer abc123" },
  ]);
});

test("parseCurlCommand accepts generated multipart uploads and infers POST", () => {
  const parsed = parseCurlCommand('curl -F "avatar=@R&{avatar.png}" https://api.example.com');

  assert.equal(parsed.method, "POST");
  assert.equal(parsed.url, "https://api.example.com");
  assert.deepEqual(parsed.formParts, [
    {
      name: "avatar",
      filename: "avatar.png",
      extension: "png",
      source: "generated",
    },
  ]);
  assert.equal(parsed.body, "");
});

test("parseCurlCommand accepts text and generated multipart fields together", () => {
  const parsed = parseCurlCommand(
    'curl -F "company_id=1" -F "documents[]=@R&{license.pdf}" https://api.example.com',
  );

  assert.equal(parsed.method, "POST");
  assert.deepEqual(parsed.formParts, [
    {
      name: "company_id",
      value: "1",
      source: "text",
    },
    {
      name: "documents[]",
      filename: "license.pdf",
      extension: "pdf",
      source: "generated",
    },
  ]);
});

test("parseCurlCommand accepts browser-upload-backed multipart fields", () => {
  const parsed = parseCurlCommand(
    'curl -F "documents[]=@/tmp/license.pdf" -F "avatar=@local-avatar.png" https://api.example.com',
  );

  assert.equal(parsed.method, "POST");
  assert.deepEqual(parsed.formParts, [
    {
      name: "documents[]",
      source: "upload",
      uploadReference: "/tmp/license.pdf",
      filename: "license.pdf",
      uploadIndex: 0,
    },
    {
      name: "avatar",
      source: "upload",
      uploadReference: "local-avatar.png",
      filename: "local-avatar.png",
      uploadIndex: 1,
    },
  ]);
});

test("parseCurlCommand rejects unsupported generated upload extensions", () => {
  assert.throws(
    () => parseCurlCommand('curl -F "avatar=@R&{avatar.exe}" https://api.example.com'),
    /unsupported generated upload extension/i,
  );
});

test("parseCurlCommand rejects unsupported multipart file modifiers", () => {
  assert.throws(
    () => parseCurlCommand('curl -F "avatar=@/tmp/x.pdf;type=application/pdf" https://api.example.com'),
    /not supported/i,
  );
});

test("parseCurlCommand rejects mixing multipart and body data", () => {
  assert.throws(
    () =>
      parseCurlCommand(
        'curl -F "avatar=@R&{avatar.png}" -d "name=test" https://api.example.com',
      ),
    /cannot be mixed/i,
  );
});

test("parseCurlCommand rejects unsupported flags", () => {
  assert.throws(
    () => parseCurlCommand("curl --proxy http://proxy.local https://api.example.com"),
    /Unsupported flag/i,
  );
});

test("validateTargetUrl blocks localhost and private targets in production", async () => {
  const blockedUrls = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://10.0.0.1:8080",
    "http://192.168.1.8:8080",
    "http://172.16.0.9:8080",
    "http://[::1]:8080",
    "http://[fd00::1]:8080",
  ];

  for (const url of blockedUrls) {
    const error = await validateTargetUrl(url, { isDev: false });
    assert.ok(error, `Expected blocked URL to fail validation: ${url}`);
  }
});

test("validateTargetUrl blocks DNS names resolving to private addresses", async () => {
  const error = await validateTargetUrl("https://api.example.com", {
    isDev: false,
    dnsLookup: async () => [{ address: "10.20.30.40" }],
  });
  assert.match(error, /blocked/i);
});

test("validateTargetUrl allows public host on non-default port in production", async () => {
  const error = await validateTargetUrl("https://api.example.com:8443/path", {
    isDev: false,
    dnsLookup: async () => [{ address: "8.8.8.8" }],
  });
  assert.equal(error, null);
});

test("validateTargetUrl allows localhost in development mode", async () => {
  const error = await validateTargetUrl("http://localhost:3000/path", {
    isDev: true,
  });
  assert.equal(error, null);
});

test("POST /api/run-curl returns 400 for missing payload", async () => {
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
      execFileImpl: () => {
        throw new Error("exec should not be called for invalid payload");
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 400);
      assert.match(data.error, /Invalid payload/i);
    },
  );
  if (!started) {
    return;
  }
});

test("POST /api/run-soccli returns 400 when command is not prefixed with soccli", async () => {
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-soccli`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "curl https://example.com" }),
      });
      assert.equal(response.status, 400);
      const payload = await response.json();
      assert.match(payload.error, /start with \"soccli\"/i);
    },
  );

  if (!started) {
    test.skip("Socket-based engine tests are skipped in this environment.");
  }
});

test("POST /api/run-curl rejects blocked URL before execution", async () => {
  let called = false;
  const started = await withServer(
    {
      isDev: false,
      execFileImpl: () => {
        called = true;
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "curl http://127.0.0.1:3000/health" }),
      });
      const data = await response.json();
      assert.equal(response.status, 400);
      assert.match(data.error, /blocked/i);
      assert.equal(called, false);
    },
  );
  if (!started) {
    return;
  }
});

test("POST /api/run-curl executes valid parsed command with hardened container args", async () => {
  const calls = [];
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
      execFileImpl: (command, args, options, callback) => {
        calls.push({ command, args, options });
        callback(null, '{"ok":true}', "");
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: 'curl "https://api.example.com/v1/ping"' }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.success, true);
      assert.equal(data.output, '{"ok":true}');
    },
  );
  if (!started) {
    return;
  }

  assert.equal(calls.length, 1);
  assert.ok(["docker", "podman"].includes(calls[0].command));
  assert.ok(calls[0].args.includes("--cap-drop=ALL"));
  assert.ok(calls[0].args.includes("--security-opt=no-new-privileges"));
  assert.ok(calls[0].args.includes("--network=bridge"));
  assert.equal(calls[0].args.includes("--network=host"), false);
  assert.ok(calls[0].args.includes("--write-out"));
});

test("POST /api/run-curl mounts generated multipart uploads and rewrites curl args", async () => {
  const calls = [];
  const writes = [];
  const chmods = [];
  const removals = [];
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
      uploadTmpDir: "/tmp",
      uploadFsMkdtemp: async () => "/tmp/doccurl-upload-test",
      uploadFsWriteFile: async (filePath, value) => {
        writes.push({ filePath, value: Buffer.from(value) });
      },
      uploadFsChmod: async (targetPath, mode) => {
        chmods.push({ targetPath, mode });
      },
      uploadFsRm: async (targetPath, options) => {
        removals.push({ targetPath, options });
      },
      execFileImpl: (command, args, _options, callback) => {
        calls.push({ command, args });
        callback(null, "ok", "");
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: 'curl -F "avatar=@R&{avatar.png}" "https://api.example.com/upload"',
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.success, true);
    },
  );
  if (!started) {
    return;
  }

  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes("-v"));
  assert.ok(calls[0].args.includes("/tmp/doccurl-upload-test:/tmp/doccurl-uploads:ro"));
  assert.ok(calls[0].args.includes("-F"));
  assert.ok(calls[0].args.includes("avatar=@/tmp/doccurl-uploads/avatar.png"));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filePath, "/tmp/doccurl-upload-test/avatar.png");
  assert.deepEqual(chmods, [
    { targetPath: "/tmp/doccurl-upload-test", mode: 0o700 },
    { targetPath: "/tmp/doccurl-upload-test/avatar.png", mode: 0o600 },
  ]);
  assert.equal(removals.length, 1);
  assert.deepEqual(removals[0], {
    targetPath: "/tmp/doccurl-upload-test",
    options: { recursive: true, force: true },
  });
});

test("POST /api/run-curl accepts browser multipart uploads and mounts them by upload index", async () => {
  const calls = [];
  const inspectedUploads = [];
  const chmods = [];
  let browserUploadTempDir;

  const started = await withTempDir("doccurl-upload-browser-", async (uploadTempDir) => {
    browserUploadTempDir = uploadTempDir;
    return (
    withServer(
      {
        isDev: false,
        dnsLookup: async () => [{ address: "8.8.8.8" }],
        uploadFsMkdtemp: async () => uploadTempDir,
        uploadFsChmod: async (targetPath, mode) => {
          chmods.push({ targetPath, mode });
          await fs.chmod(targetPath, mode);
        },
        execFileImpl: (command, args, _options, callback) => {
          calls.push({ command, args });

          void fs
            .readFile(path.join(uploadTempDir, "Therapy_License.pdf"), "utf8")
            .then((value) => {
              inspectedUploads.push({
                filePath: path.join(uploadTempDir, "Therapy_License.pdf"),
                value,
              });
              callback(null, "ok", "");
            }, callback);
        },
      },
      async (baseUrl) => {
        const formData = new FormData();
        formData.append(
          "command",
          'curl -F "company_id=1" -F "documents[]=@/tmp/license.pdf" "https://api.example.com/upload"',
        );
        formData.append(
          "upload_0",
          new Blob(["browser-file"], { type: "application/pdf" }),
          "Therapy License.pdf",
        );
        formData.append(
          "upload_99",
          new Blob(["ignored"], { type: "text/plain" }),
          "ignored.txt",
        );

        const response = await fetch(`${baseUrl}/api/run-curl`, {
          method: "POST",
          body: formData,
        });
        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.success, true);
      },
    )
    );
  });
  if (!started) {
    return;
  }

  assert.equal(calls.length, 1);
  const formFlags = calls[0].args.filter((value, index, array) => array[index - 1] === "-F");
  assert.deepEqual(formFlags, [
    "company_id=1",
    "documents[]=@/tmp/doccurl-uploads/Therapy_License.pdf",
  ]);
  assert.deepEqual(inspectedUploads, [
    {
      filePath: path.join(calls[0].args[calls[0].args.indexOf("-v") + 1].split(":")[0], "Therapy_License.pdf"),
      value: "browser-file",
    },
  ]);
  assert.equal(
    chmods.some(
      ({ targetPath, mode }) => targetPath === browserUploadTempDir && mode === 0o700,
    ),
    true,
  );
  assert.equal(
    chmods.some(
      ({ targetPath, mode }) =>
        targetPath === path.join(browserUploadTempDir, ".incoming") && mode === 0o700,
    ),
    true,
  );
  assert.equal(
    chmods.some(
      ({ targetPath, mode }) =>
        targetPath === path.join(browserUploadTempDir, ".incoming", "part-0") &&
        mode === 0o600,
    ),
    true,
  );
  assert.equal(
    chmods.some(
      ({ targetPath, mode }) =>
        targetPath === path.join(browserUploadTempDir, "Therapy_License.pdf") &&
        mode === 0o600,
    ),
    true,
  );
});

test("POST /api/run-curl rejects browser-upload-backed multipart fields when files are missing", async () => {
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
      execFileImpl: () => {
        throw new Error("exec should not run when upload is missing");
      },
    },
    async (baseUrl) => {
      const formData = new FormData();
      formData.append(
        "command",
        'curl -F "documents[]=@/tmp/license.pdf" "https://api.example.com/upload"',
      );

      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      assert.equal(response.status, 400);
      assert.match(data.error, /missing uploaded file/i);
    },
  );
  if (!started) {
    return;
  }
});

test("POST /api/run-curl rejects multipart uploads once streamed total size exceeds the limit", async () => {
  const removals = [];
  const started = await withTempDir("doccurl-upload-total-limit-", async (uploadTempDir) =>
    withServer(
      {
        isDev: false,
        dnsLookup: async () => [{ address: "8.8.8.8" }],
        uploadLimits: {
          maxUploadTotalBytes: 5,
        },
        uploadFsMkdtemp: async () => uploadTempDir,
        uploadFsRm: async (targetPath, options) => {
          removals.push({ targetPath, options });
          await fs.rm(targetPath, options);
        },
        execFileImpl: () => {
          throw new Error("exec should not run when upload total exceeds the limit");
        },
      },
      async (baseUrl) => {
        const formData = new FormData();
        formData.append(
          "command",
          'curl -F "documents[]=@/tmp/license.pdf" "https://api.example.com/upload"',
        );
        formData.append(
          "upload_0",
          new Blob(["abc"], { type: "application/pdf" }),
          "license.pdf",
        );
        formData.append(
          "upload_99",
          new Blob(["def"], { type: "text/plain" }),
          "ignored.txt",
        );

        const response = await fetch(`${baseUrl}/api/run-curl`, {
          method: "POST",
          body: formData,
        });
        const data = await response.json();

        assert.equal(response.status, 400);
        assert.match(data.error, /must total/i);
      },
    ),
  );
  if (!started) {
    return;
  }

  assert.equal(removals.length, 1);
  assert.deepEqual(removals[0], {
    targetPath: removals[0].targetPath,
    options: { recursive: true, force: true },
  });
});

test("POST /api/run-curl rejects multipart uploads once a streamed file exceeds the per-file limit", async () => {
  const started = await withTempDir("doccurl-upload-file-limit-", async (uploadTempDir) =>
    withServer(
      {
        isDev: false,
        dnsLookup: async () => [{ address: "8.8.8.8" }],
        uploadLimits: {
          maxUploadFileBytes: 5,
          maxUploadTotalBytes: 50,
        },
        uploadFsMkdtemp: async () => uploadTempDir,
        execFileImpl: () => {
          throw new Error("exec should not run when upload file exceeds the limit");
        },
      },
      async (baseUrl) => {
        const formData = new FormData();
        formData.append(
          "command",
          'curl -F "documents[]=@/tmp/license.pdf" "https://api.example.com/upload"',
        );
        formData.append(
          "upload_0",
          new Blob(["123456"], { type: "application/pdf" }),
          "license.pdf",
        );

        const response = await fetch(`${baseUrl}/api/run-curl`, {
          method: "POST",
          body: formData,
        });
        const data = await response.json();

        assert.equal(response.status, 400);
        assert.match(data.error, /each uploaded file must be/i);
      },
    ),
  );
  if (!started) {
    return;
  }
});

test("POST /api/run-curl rejects unexpected multipart text fields during streaming parse", async () => {
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
      execFileImpl: () => {
        throw new Error("exec should not run when multipart fields are invalid");
      },
    },
    async (baseUrl) => {
      const formData = new FormData();
      formData.append(
        "command",
        'curl -F "documents[]=@/tmp/license.pdf" "https://api.example.com/upload"',
      );
      formData.append("extra", "unexpected");

      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      assert.equal(response.status, 400);
      assert.match(data.error, /unexpected multipart fields/i);
    },
  );
  if (!started) {
    return;
  }
});

test("POST /api/run-curl cleans up upload temp dirs when multipart parser setup throws", async () => {
  const removals = [];
  let uploadTempDir;
  const started = await withTempDir("doccurl-upload-parser-setup-", async (tempDir) => {
    uploadTempDir = tempDir;
    return withServer(
      {
        isDev: false,
        dnsLookup: async () => [{ address: "8.8.8.8" }],
        uploadFsMkdtemp: async () => uploadTempDir,
        uploadFsMkdir: async (targetPath, options) => {
          await fs.mkdir(targetPath, options);
        },
        uploadFsRm: async (targetPath, options) => {
          removals.push({ targetPath, options });
          await fs.rm(targetPath, options);
        },
        BusboyImpl: () => {
          throw new Error("Multipart boundary missing");
        },
        execFileImpl: () => {
          throw new Error("exec should not run when multipart parser setup fails");
        },
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/run-curl`, {
          method: "POST",
          headers: { "Content-Type": "multipart/form-data" },
          body: "--ignored--",
        });
        const data = await response.json();

        assert.equal(response.status, 400);
        assert.match(data.error, /multipart boundary missing/i);
      },
    );
  });
  if (!started) {
    return;
  }

  assert.equal(removals.length, 1);
  assert.deepEqual(removals[0], {
    targetPath: uploadTempDir,
    options: { recursive: true, force: true },
  });
});

test("POST /api/run-curl rejects oversized multipart command fields during streaming parse", async () => {
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
      uploadLimits: {
        maxCommandLength: 10,
      },
      execFileImpl: () => {
        throw new Error("exec should not run when multipart command field is too large");
      },
    },
    async (baseUrl) => {
      const formData = new FormData();
      formData.append("command", 'curl "https://api.example.com/upload"');

      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      assert.equal(response.status, 400);
      assert.match(data.error, /curl command field is too large/i);
    },
  );
  if (!started) {
    return;
  }
});

test("POST /api/run-curl keeps multipart text fields while mounting generated uploads", async () => {
  const calls = [];
  const writes = [];
  const chmods = [];
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
      uploadTmpDir: "/tmp",
      uploadFsMkdtemp: async () => "/tmp/doccurl-upload-mixed",
      uploadFsWriteFile: async (filePath, value) => {
        writes.push({ filePath, value: Buffer.from(value) });
      },
      uploadFsChmod: async (targetPath, mode) => {
        chmods.push({ targetPath, mode });
      },
      uploadFsRm: async () => {},
      execFileImpl: (command, args, _options, callback) => {
        calls.push({ command, args });
        callback(null, "ok", "");
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command:
            'curl -F "company_id=1" -F "documents[]=@R&{license.pdf}" "https://api.example.com/upload"',
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.success, true);
    },
  );
  if (!started) {
    return;
  }

  assert.equal(calls.length, 1);
  const formFlags = calls[0].args.filter((value, index, array) => array[index - 1] === "-F");
  assert.deepEqual(formFlags, [
    "company_id=1",
    "documents[]=@/tmp/doccurl-uploads/license.pdf",
  ]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filePath, "/tmp/doccurl-upload-mixed/license.pdf");
  assert.deepEqual(chmods, [
    { targetPath: "/tmp/doccurl-upload-mixed", mode: 0o700 },
    { targetPath: "/tmp/doccurl-upload-mixed/license.pdf", mode: 0o600 },
  ]);
});

test("POST /api/run-curl cleans up generated uploads when execution fails", async () => {
  const removals = [];
  const loggedErrors = [];
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
      uploadTmpDir: "/tmp",
      uploadFsMkdtemp: async () => "/tmp/doccurl-upload-failure",
      uploadFsWriteFile: async () => {},
      uploadFsChmod: async () => {},
      uploadFsRm: async (targetPath, options) => {
        removals.push({ targetPath, options });
      },
      logger: {
        error: (message, details) => loggedErrors.push({ message, details }),
      },
      execFileImpl: (_command, _args, _options, callback) => {
        callback(new Error("boom"), "", "upload failed");
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: 'curl -F "avatar=@R&{avatar.png}" "https://api.example.com/upload"',
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 500);
      assert.equal(data.error, "Execution failed");
      assert.equal(Object.hasOwn(data, "details"), false);
    },
  );
  if (!started) {
    return;
  }

  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0].message, "Curl execution failed");
  assert.equal(loggedErrors[0].details.requestUrl, "https://api.example.com/upload");
  assert.deepEqual(loggedErrors[0].details.error, {
    message: "Execution failed",
  });
  assert.equal(Object.hasOwn(loggedErrors[0].details, "stderr"), false);
  assert.equal(removals.length, 1);
  assert.deepEqual(removals[0], {
    targetPath: "/tmp/doccurl-upload-failure",
    options: { recursive: true, force: true },
  });
});

test("POST /api/run-curl strips credentials and query params from logged request URLs", async () => {
  const loggedErrors = [];
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
      logger: {
        error: (message, details) => loggedErrors.push({ message, details }),
      },
      execFileImpl: () => {
        throw new Error("boom");
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command:
            'curl "https://user:secret@api.example.com/upload?token=top-secret&mode=debug#frag"',
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 500);
      assert.equal(data.error, "Execution failed");
    },
  );
  if (!started) {
    return;
  }

  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0].message, "Curl execution failed");
  assert.equal(loggedErrors[0].details.requestUrl, "https://api.example.com/upload");
  assert.deepEqual(loggedErrors[0].details.error, {
    message: "Execution failed",
  });
  assert.equal(Object.hasOwn(loggedErrors[0].details, "stderr"), false);
});

test("POST /api/run-curl cleans up generated uploads when mount preparation fails", async () => {
  const removals = [];
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
      uploadTmpDir: "/tmp",
      uploadFsMkdtemp: async () => "/tmp/doccurl-upload-prepare-failure",
      uploadFsWriteFile: async () => {
        throw new Error("write failed");
      },
      uploadFsChmod: async () => {},
      uploadFsRm: async (targetPath, options) => {
        removals.push({ targetPath, options });
      },
      execFileImpl: () => {
        throw new Error("exec should not run when mount preparation fails");
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: 'curl -F "avatar=@R&{avatar.png}" "https://api.example.com/upload"',
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 400);
      assert.match(data.error, /write failed/i);
    },
  );
  if (!started) {
    return;
  }

  assert.equal(removals.length, 1);
  assert.deepEqual(removals[0], {
    targetPath: "/tmp/doccurl-upload-prepare-failure",
    options: { recursive: true, force: true },
  });
});

test("POST /api/run-curl returns upstream status, content type, and timing metadata", async () => {
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
      execFileImpl: (_command, _args, _options, callback) => {
        callback(
          null,
          `{"ok":true}${CURL_RESPONSE_META_START}201\tapplication/json; charset=utf-8\t0.245${CURL_RESPONSE_META_END}`,
          "",
        );
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: 'curl "https://api.example.com/v1/ping"' }),
      });
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.success, true);
      assert.equal(data.output, '{"ok":true}');
      assert.deepEqual(data.metadata, {
        statusCode: 201,
        contentType: "application/json; charset=utf-8",
        durationMs: 245,
      });
    },
  );
  if (!started) {
    return;
  }
});

test("POST /api/run-curl preserves upstream HTTP 500 responses in output metadata", async () => {
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
      execFileImpl: (_command, _args, _options, callback) => {
        callback(
          null,
          `{"error":"upstream"}${CURL_RESPONSE_META_START}500\tapplication/json\t0.103${CURL_RESPONSE_META_END}`,
          "",
        );
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: 'curl "https://api.example.com/v1/fail"' }),
      });
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.success, true);
      assert.equal(data.output, '{"error":"upstream"}');
      assert.deepEqual(data.metadata, {
        statusCode: 500,
        contentType: "application/json",
        durationMs: 103,
      });
    },
  );
  if (!started) {
    return;
  }
});

test("POST /api/run-curl keeps backward compatibility for legacy payload", async () => {
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.4.4" }],
      execFileImpl: (command, args, _options, callback) => {
        assert.ok(["docker", "podman"].includes(command));
        assert.ok(args.includes("--data-raw"));
        assert.ok(args.includes('{"ok":true}'));
        callback(null, "ok", "");
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://api.example.com/v1",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: '{"ok":true}',
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.success, true);
      assert.equal(data.output, "ok");
    },
  );
  if (!started) {
    return;
  }
});

test("POST /api/run-curl uses host network in dev mode for localhost targets", async () => {
  const calls = [];
  const started = await withServer(
    {
      isDev: true,
      execFileImpl: (command, args, _options, callback) => {
        calls.push({ command, args });
        callback(null, "ok", "");
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: 'curl "http://localhost:3000/health"' }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.success, true);
    },
  );
  if (!started) {
    return;
  }

  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes("--network=host"));
});

test("POST /api/run-curl keeps bridge network in production mode", async () => {
  const calls = [];
  const started = await withServer(
    {
      isDev: false,
      dnsLookup: async () => [{ address: "8.8.8.8" }],
      execFileImpl: (_command, args, _options, callback) => {
        calls.push(args);
        callback(null, "ok", "");
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: 'curl "https://api.example.com/ping"' }),
      });
      assert.equal(response.status, 200);
    },
  );
  if (!started) {
    return;
  }

  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("--network=bridge"));
  assert.equal(calls[0].includes("--network=host"), false);
});

test("POST /api/run-curl continues when /etc/containers/nodocker creation fails", async () => {
  const warnings = [];
  const started = await withServer(
    {
      isDev: true,
      containerRuntime: "podman",
      fsAccess: async () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
      fsWriteFile: async () => {
        const error = new Error("permission denied");
        error.code = "EACCES";
        throw error;
      },
      logger: {
        warn: (message) => warnings.push(String(message)),
      },
      execFileImpl: (_command, _args, _options, callback) => {
        callback(null, "ok", "");
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/run-curl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: 'curl "http://localhost:3000/health"' }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.success, true);
    },
  );
  if (!started) {
    return;
  }

  assert.equal(warnings.length > 0, true);
  assert.equal(
    warnings.some((message) => message.includes("sudo touch /etc/containers/nodocker")),
    true,
  );
});
