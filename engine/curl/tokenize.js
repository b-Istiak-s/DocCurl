import { LIMITS } from "./constants.js";

export function tokenizeCommand(command) {
  if (typeof command !== "string") {
    throw new Error("Curl command must be a string");
  }

  const input = command.trim();
  if (!input) {
    throw new Error("Curl command is empty");
  }

  if (input.length > LIMITS.maxCommandLength) {
    throw new Error(`Curl command exceeds ${LIMITS.maxCommandLength} characters`);
  }

  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (escaping) {
      if (ch === "\n") {
        escaping = false;
        continue;
      }
      current += ch;
      escaping = false;
      continue;
    }

    if (quote === "'") {
      if (ch === "'") {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null;
        continue;
      }
      if (ch === "\\") {
        const next = input[i + 1];
        if (
          next === '"' ||
          next === "\\" ||
          next === "$" ||
          next === "`" ||
          next === "\n"
        ) {
          escaping = true;
          continue;
        }
      }
      current += ch;
      continue;
    }

    if (ch === "\\") {
      escaping = true;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (quote) {
    throw new Error("Unterminated quote in curl command");
  }

  if (escaping) {
    current += "\\";
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}
