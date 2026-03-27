import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Command } from "commander";

import {
  promptPasswordFromTty,
  registerServeCommand,
} from "../../cli/commands/serve.js";

function createMockTty({ readableEncoding } = {}) {
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.readableEncoding = readableEncoding;
  stdin.rawModeCalls = [];
  stdin.encodingCalls = [];
  stdin.resumeCalls = 0;
  stdin.pauseCalls = 0;
  stdin.setRawMode = (value) => {
    stdin.isRaw = value;
    stdin.rawModeCalls.push(value);
  };
  stdin.setEncoding = (value) => {
    stdin.readableEncoding = value;
    stdin.encodingCalls.push(value);
  };
  stdin.resume = () => {
    stdin.resumeCalls += 1;
  };
  stdin.pause = () => {
    stdin.pauseCalls += 1;
  };

  const stdout = {
    isTTY: true,
    writes: [],
    write(value) {
      stdout.writes.push(value);
    },
  };

  return { stdin, stdout };
}

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

test("serve command leaves host undefined when --host is omitted", async () => {
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
  ]);

  assert.ok(receivedCall);
  assert.equal(receivedCall.port, 4123);
  assert.match(receivedCall.docsDir, /\/docs$/);
  assert.deepEqual(receivedCall.options, {
    dev: false,
    collapse: false,
    host: undefined,
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
    host: undefined,
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

test("promptPasswordFromTty restores stdin encoding to null when it was previously unset", async () => {
  const { stdin, stdout } = createMockTty();
  const prompt = promptPasswordFromTty({ stdin, stdout });

  stdin.emit("data", "secret123\r");

  await assert.doesNotReject(prompt);
  assert.deepEqual(stdin.encodingCalls, ["utf8", null]);
  assert.deepEqual(stdin.rawModeCalls, [true, false]);
  assert.equal(stdin.pauseCalls, 1);
});

test("promptPasswordFromTty rejects when stdin ends before newline", async () => {
  const { stdin, stdout } = createMockTty({ readableEncoding: "latin1" });
  const prompt = promptPasswordFromTty({ stdin, stdout });

  stdin.emit("end");

  await assert.rejects(prompt, (error) => {
    assert.equal(error.code, "PROMPT_ENDED");
    assert.match(error.message, /ended before input was completed/i);
    return true;
  });
  assert.deepEqual(stdin.encodingCalls, ["utf8", "latin1"]);
  assert.deepEqual(stdin.rawModeCalls, [true, false]);
});

test("promptPasswordFromTty rejects when stdin closes before newline", async () => {
  const { stdin, stdout } = createMockTty();
  const prompt = promptPasswordFromTty({ stdin, stdout });

  stdin.emit("close");

  await assert.rejects(prompt, (error) => {
    assert.equal(error.code, "PROMPT_CLOSED");
    assert.match(error.message, /closed before input was completed/i);
    return true;
  });
  assert.deepEqual(stdin.encodingCalls, ["utf8", null]);
  assert.deepEqual(stdin.rawModeCalls, [true, false]);
});
