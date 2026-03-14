import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const npmPacklistPath = [
  path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/node_modules/npm-packlist/lib/index.js"),
  path.resolve(path.dirname(process.execPath), "node_modules/npm/node_modules/npm-packlist/lib/index.js"),
].find((candidate) => fs.existsSync(candidate));

if (!npmPacklistPath) {
  throw new Error("Unable to locate npm-packlist from the current Node installation.");
}

const { default: packlist } = await import(pathToFileURL(npmPacklistPath).href);

test("npm pack includes runtime docs helpers", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const tree = {
    path: process.cwd(),
    package: packageJson,
    isProjectRoot: true,
    edgesOut: new Map(),
  };

  return packlist(tree).then((files) => {
    const filePaths = new Set(files);

    assert.ok(filePaths.has("core/docs/tree.js"));
    assert.ok(filePaths.has("core/docs/paths.js"));
    assert.equal(filePaths.has("docs/overview.md"), false);
    assert.equal(filePaths.has(".env"), false);
  });
});
