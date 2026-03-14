#!/usr/bin/env node

import { program } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerServeCommand } from "./commands/serve.js";

program.name("doccurl");

registerInitCommand(program);
registerServeCommand(program);

program.parse(process.argv);
