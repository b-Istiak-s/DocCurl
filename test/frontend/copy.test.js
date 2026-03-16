import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCopyPayload,
  copyText,
  serializeEnvForShell,
} from "../../frontend/modules/copy/clipboard.js";

class MockElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.value = "";
    this.attributes = {};
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentElement) {
      return;
    }
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) {
      this.parentElement.children.splice(index, 1);
    }
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  focus() {}

  select() {}
}

test("serializeEnvForShell produces shell-ready export lines", () => {
  assert.equal(
    serializeEnvForShell({
      BASE_URL: "https://api.example.com",
      API_TOKEN: "abc'def",
    }),
    "export BASE_URL='https://api.example.com'\nexport API_TOKEN='abc'\\''def'",
  );
});

test("buildCopyPayload keeps env exports and command formatting", () => {
  assert.equal(
    buildCopyPayload('curl "$BASE_URL/users"', {
      BASE_URL: "https://api.example.com",
    }),
    "export BASE_URL='https://api.example.com'\n\ncurl \"$BASE_URL/users\"",
  );
});

test("copyText falls back to document.execCommand when clipboard API is unavailable", async () => {
  const body = new MockElement("body");
  let copied = false;
  const documentRef = {
    body,
    createElement(tagName) {
      return new MockElement(tagName);
    },
    execCommand(command) {
      copied = command === "copy";
      return copied;
    },
  };

  await copyText("hello", {
    navigatorRef: {},
    documentRef,
  });

  assert.equal(copied, true);
  assert.equal(body.children.length, 0);
});
