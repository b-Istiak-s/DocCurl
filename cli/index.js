#!/usr/bin/env node

import { program } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerServeCommand } from "./commands/serve.js";

program
  .name("doccurl")
  .description(
    "DocCurl CLI for scaffolding projects and serving interactive curl docs",
  )
  .addHelpText(
    "after",
    `
Examples:
	$ doccurl init my-api-docs
	$ doccurl serve
	$ doccurl serve --port 8080 --dir docs --password secret

Serve command parameters:
	--port <port>         HTTP port (1-65535), default: 3000
	--dir <dir>           Docs directory path, default: docs
	--dev                 Allow localhost/private targets (development only)
	--collapse            Enable "Focus Curls" document view toggle
	--password <password> Protect docs and API routes with a password

For full per-command details:
	$ doccurl serve --help
	$ doccurl init --help`,
  );

registerInitCommand(program);
registerServeCommand(program);

program.parse(process.argv);
