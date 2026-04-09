import { tokenizeCommand } from "../curl/tokenize.js";

export function parseSoccliCommand(command) {
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new Error("soccli: invalid command");
  }

  let tokens;
  try {
    tokens = tokenizeCommand(command);
  } catch (error) {
    const detail =
      error instanceof Error && error.message
        ? error.message
        : "invalid command";
    throw new Error(`soccli: tokenizer error - ${detail}`);
  }

  if (tokens[0] !== "soccli") {
    throw new Error('soccli: command must start with "soccli"');
  }
  if (tokens.length < 2) {
    throw new Error("soccli: invalid command");
  }
  return tokens.slice(1);
}
