#!/usr/bin/env node

const { program } = require("commander");
const { startServer } = require("../backend/server");
const fs = require("fs");
const path = require("path");

program
  .command("init <projectName>")
  .description("Create a new DocCurl project template")
  .action((projectName) => {
    const projectDir = path.join(process.cwd(), projectName);
    if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir);
    fs.mkdirSync(path.join(projectDir, "docs"));
    console.log(`Created DocCurl project at ${projectDir}`);
  });

program
  .command("serve")
  .option("-p, --port <port>", "Port number", "3000")
  .option("-d, --dir <dir>", "Docs directory", "docs")
  .option("--dev", "Allow localhost/private targets for local testing")
  .action((options) => {
    const port = parseInt(options.port, 10);
    const docsDir = path.resolve(process.cwd(), options.dir);
    startServer(port, docsDir, { dev: Boolean(options.dev) });
  });

program.parse(process.argv);
