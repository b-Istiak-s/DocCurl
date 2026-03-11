import fs from "node:fs";
import path from "node:path";

export function registerInitCommand(program) {
  program
    .command("init <projectName>")
    .description("Create a new DocCurl project template")
    .action((projectName) => {
      const projectDir = path.join(process.cwd(), projectName);
      if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir);
      }
      fs.mkdirSync(path.join(projectDir, "docs"));
      console.log(`Created DocCurl project at ${projectDir}`);
    });
}
