import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { Command } from "commander";

import { generateMarkdownDocs, registerGenerateMdCommand } from "../../cli/commands/generate-md.js";

test("generateMarkdownDocs writes folder markdown for a small folder", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "doccurl-generate-md-"));
  const inputPath = path.join(tempRoot, "postman.json");

  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      info: {
        name: "Platform",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      item: [
        {
          name: "Auth",
          item: [
            {
              name: "Login",
              request: {
                method: "POST",
                url: "{{BASE_URL}}/login",
                body: {
                  mode: "raw",
                  raw: '{"email":"{{EMAIL}}"}',
                },
              },
            },
          ],
        },
      ],
    }),
    "utf8",
  );

  try {
    const result = generateMarkdownDocs(inputPath, { format: "auto", out: "docs/imported" }, {
      cwd: tempRoot,
    });

    assert.equal(result.filesWritten.length, 1);
    const outputFile = path.join(tempRoot, "docs/imported/platform/auth.md");
    assert.equal(fs.existsSync(outputFile), true);

    const content = fs.readFileSync(outputFile, "utf8");
    assert.match(content, /^# Auth/m);
    assert.match(content, /^## Login/m);
    assert.match(content, /^### Body Fields/m);
    assert.match(content, /^```curl$/m);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("generateMarkdownDocs rejects existing target files and directories", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "doccurl-generate-md-"));
  const inputPath = path.join(tempRoot, "hoppscotch.json");
  const outputDir = path.join(tempRoot, "docs/imported/workspace");

  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      collections: [
        {
          name: "Workspace",
          requests: [],
          folders: [
            {
              name: "Reports",
              requests: [
                {
                  name: "Summary",
                  method: "GET",
                  endpoint: "{{BASE_URL}}/reports",
                  headers: [],
                  body: { contentType: "text/plain", body: "", form: [] },
                },
              ],
              folders: [],
            },
          ],
        },
      ],
    }),
    "utf8",
  );

  fs.mkdirSync(outputDir, { recursive: true });

  try {
    assert.throws(
      () => generateMarkdownDocs(inputPath, { out: "docs/imported" }, { cwd: tempRoot }),
      /already exists/i,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("generate-md command help documents format and output rules", async () => {
  const program = new Command();
  let output = "";
  program.exitOverride();
  program.configureOutput({
    writeOut(message) {
      output += message;
    },
    writeErr(message) {
      output += message;
    },
    outputError(message, write) {
      write(message);
    },
  });
  registerGenerateMdCommand(program);

  await assert.rejects(
    program.parseAsync(["node", "doccurl", "generate-md", "--help"]),
    (error) => error.code === "commander.helpDisplayed",
  );

  assert.match(output, /--format <format>/);
  assert.match(output, /--out <dir>/);
  assert.match(output, /Folders with fewer than 8 requests/);
});

test("generate-md command rejects unsupported format choices", async () => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut() {},
    writeErr() {},
    outputError() {},
  });
  registerGenerateMdCommand(program);

  await assert.rejects(
    program.parseAsync(["node", "doccurl", "generate-md", "input.json", "--format", "unknown"]),
    (error) => error.code === "commander.invalidArgument",
  );
});
