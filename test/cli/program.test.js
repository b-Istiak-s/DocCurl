import test from "node:test";
import assert from "node:assert/strict";

import { createProgram } from "../../cli/program.js";

function configureCapturedProgram(program) {
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
  return {
    getOutput() {
      return output;
    },
  };
}

test("program prints version with --version and -v", async () => {
  for (const flag of ["--version", "-v"]) {
    const program = createProgram({ version: "9.9.9" });
    const capture = configureCapturedProgram(program);

    await assert.rejects(
      program.parseAsync(["node", "doccurl", flag]),
      (error) => error.code === "commander.version",
    );

    assert.match(capture.getOutput(), /9\.9\.9/);
  }
});

test("root help mentions generate-md", async () => {
  const program = createProgram({ version: "1.2.0" });
  const capture = configureCapturedProgram(program);

  await assert.rejects(
    program.parseAsync(["node", "doccurl", "--help"]),
    (error) => error.code === "commander.helpDisplayed",
  );

  assert.match(capture.getOutput(), /generate-md/);
  assert.match(capture.getOutput(), /--version/);
});
