import test from "node:test";
import assert from "node:assert/strict";
import { Command } from "commander";

import { registerServeCommand } from "../../cli/commands/serve.js";

test("serve command forwards the collapse flag to startServer", async () => {
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
    "--dev",
    "--collapse",
  ]);

  assert.ok(receivedCall);
  assert.equal(receivedCall.port, 4123);
  assert.match(receivedCall.docsDir, /\/docs$/);
  assert.deepEqual(receivedCall.options, {
    dev: true,
    collapse: true,
    password: "",
  });
});

test("serve command prompts for a password when --password is provided", async () => {
  let receivedCall = null;
  let promptCalls = 0;
  const program = new Command();

  registerServeCommand(program, {
    async promptPasswordImpl() {
      promptCalls += 1;
      return "secret123";
    },
    startServerImpl(port, docsDir, options) {
      receivedCall = { port, docsDir, options };
      return { close() {} };
    },
  });

  await program.parseAsync([
    "node",
    "doccurl",
    "serve",
    "--password",
  ]);

  assert.equal(promptCalls, 1);
  assert.ok(receivedCall);
  assert.deepEqual(receivedCall.options, {
    dev: false,
    collapse: false,
    password: "secret123",
  });
});

test("serve command surfaces prompt errors when --password is used without an interactive TTY", async () => {
  const program = new Command();

  registerServeCommand(program, {
    async promptPasswordImpl() {
      throw new Error("Interactive TTY required when using --password");
    },
    startServerImpl() {
      throw new Error("startServer should not be called when prompting fails");
    },
  });

  await assert.rejects(
    program.parseAsync(["node", "doccurl", "serve", "--password"]),
    /Interactive TTY required when using --password/i,
  );
});
