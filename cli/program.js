import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerGenerateMdCommand } from "./commands/generate-md.js";
import { registerInitCommand } from "./commands/init.js";
import { registerServeCommand } from "./commands/serve.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readPackageVersion() {
  const packageJsonPath = path.resolve(__dirname, "../package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return String(packageJson.version || "0.0.0");
}

export function createProgram({
  version = readPackageVersion(),
  registerInitCommandImpl = registerInitCommand,
  registerServeCommandImpl = registerServeCommand,
  registerGenerateMdCommandImpl = registerGenerateMdCommand,
} = {}) {
  const program = new Command();

  program
    .name("doccurl")
    .description(
      "DocCurl CLI for scaffolding projects, generating markdown docs, and serving interactive curl docs",
    )
    .version(version, "-v, --version")
    .addHelpText(
      "after",
      `
Examples:
	$ doccurl --version
	$ doccurl init my-api-docs
	$ doccurl serve --port 8080 --dir docs --password secret
	$ doccurl generate-md postman.json --format auto --out docs/imported

For full per-command details:
	$ doccurl serve --help
	$ doccurl init --help
	$ doccurl generate-md --help`,
    );

  registerInitCommandImpl(program);
  registerServeCommandImpl(program);
  registerGenerateMdCommandImpl(program);

  return program;
}
