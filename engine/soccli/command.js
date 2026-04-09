import { tokenizeCommand } from "../curl/tokenize.js";

export function parseSoccliCommand(command) {
  const tokens = tokenizeCommand(command);
  if (tokens[0] !== "soccli") {
    throw new Error('Command must start with "soccli"');
  }
  if (tokens.length < 2) {
    throw new Error("Provide a soccli subcommand");
  }
  return tokens.slice(1);
}
