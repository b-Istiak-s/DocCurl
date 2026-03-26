import test from "node:test";
import assert from "node:assert/strict";
import { Command } from "commander";

import { registerServeCommand } from "../../cli/commands/serve.js";

test("serve command forwards host and collapse options to startServer", async () => {
  let receivedCall = null;
  const program = new Command();

  registerServeCommand(program, {
    startServerImpl(port, docsDir, options) {
      receivedCall = { port, docsDir, options };
      return { close() {} };
    },
  });

  await program.parseAsync([
    "node",
    "doccurl",
    "serve",
    "--port",
    "4123",
    "--dir",
    "docs",
    "--host",
    "0.0.0.0",
    "--dev",
    "--collapse",
  ]);

  assert.ok(receivedCall);
  assert.equal(receivedCall.port, 4123);
  assert.match(receivedCall.docsDir, /\/docs$/);
  assert.deepEqual(receivedCall.options, {
    dev: true,
    collapse: true,
    host: "0.0.0.0",
    password: "",
  });
});
