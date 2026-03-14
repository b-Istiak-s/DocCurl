import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const STARTER_DOC_FILES = [
  "overview.md",
  "playground.md",
  "self-test-api.md",
];

export const STARTER_DOCS_SOURCE_DIR = path.resolve(__dirname, "../../docs");

export function scaffoldProject(projectDir, { docsSourceDir = STARTER_DOCS_SOURCE_DIR } = {}) {
  if (!fs.existsSync(docsSourceDir)) {
    throw new Error(`Starter docs directory not found: ${docsSourceDir}`);
  }

  fs.mkdirSync(projectDir, { recursive: true });

  const docsDir = path.join(projectDir, "docs");
  fs.mkdirSync(docsDir, { recursive: true });

  STARTER_DOC_FILES.forEach((filename) => {
    const sourcePath = path.join(docsSourceDir, filename);
    const destinationPath = path.join(docsDir, filename);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Starter doc not found: ${sourcePath}`);
    }

    if (fs.existsSync(destinationPath)) {
      throw new Error(`Starter doc already exists: ${destinationPath}`);
    }

    fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
  });

  return { projectDir, docsDir };
}

export function registerInitCommand(program) {
  program
    .command("init <projectName>")
    .description("Create a new DocCurl project template")
    .action((projectName) => {
      const projectDir = path.join(process.cwd(), projectName);
      scaffoldProject(projectDir);
      console.log(`Created DocCurl project at ${projectDir} with starter docs`);
    });
}
