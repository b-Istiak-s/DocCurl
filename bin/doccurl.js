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
  .action((options) => {
    const port = parseInt(options.port, 10);
    const docsDir = path.resolve(process.cwd(), options.dir);
    startServer(port, docsDir);
  });

program.parse(process.argv);
