import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { STARTER_DOC_FILES, scaffoldProject } from "../../cli/commands/init.js";

test("scaffoldProject creates starter docs for new projects", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "doccurl-init-"));
  const projectDir = path.join(tempRoot, "sample-project");

  try {
    const { docsDir } = scaffoldProject(projectDir);

    assert.equal(fs.existsSync(docsDir), true);
    assert.deepEqual(fs.readdirSync(docsDir).sort(), STARTER_DOC_FILES.slice().sort());

    const overviewDoc = fs.readFileSync(path.join(docsDir, "overview.md"), "utf8");
    const selfTestDoc = fs.readFileSync(path.join(docsDir, "self-test-api.md"), "utf8");

    assert.match(overviewDoc, /DocCurl turns Markdown API notes/i);
    assert.match(selfTestDoc, /\$DOCCURL_BASE_URL/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("scaffoldProject refuses to overwrite starter docs", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "doccurl-init-"));
  const projectDir = path.join(tempRoot, "sample-project");

  try {
    scaffoldProject(projectDir);

    assert.throws(
      () => scaffoldProject(projectDir),
      /Starter doc already exists/i,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
