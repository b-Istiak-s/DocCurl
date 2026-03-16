import fs from "node:fs";
import path from "node:path";
import { Option } from "commander";
import { parseImportedCollections, renderCollectionsToMarkdown } from "../../core/import/index.js";

function collectTargetDirectories(filePaths, baseOutputDir) {
  const directories = new Set();

  filePaths.forEach((filePath) => {
    let current = path.dirname(filePath);
    while (current.startsWith(baseOutputDir) && current !== baseOutputDir) {
      directories.add(current);
      current = path.dirname(current);
    }
  });

  return Array.from(directories).sort((left, right) => left.length - right.length);
}

export function generateMarkdownDocs(
  inputFile,
  {
    format = "auto",
    out = "docs/imported",
  } = {},
  {
    cwd = process.cwd(),
    fsExistsSync = fs.existsSync,
    fsMkdirSync = fs.mkdirSync,
    fsReadFileSync = fs.readFileSync,
    fsWriteFileSync = fs.writeFileSync,
  } = {},
) {
  const inputPath = path.resolve(cwd, inputFile);
  if (!fsExistsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const payload = JSON.parse(fsReadFileSync(inputPath, "utf8"));
  const collections = parseImportedCollections(payload, format);
  const outputs = renderCollectionsToMarkdown(collections);
  const outputRoot = path.resolve(cwd, out);

  const outputFiles = outputs.map((entry) => ({
    ...entry,
    absolutePath: path.resolve(outputRoot, entry.path),
  }));

  const targetDirectories = collectTargetDirectories(
    outputFiles.map((entry) => entry.absolutePath),
    outputRoot,
  );

  for (const directoryPath of targetDirectories) {
    if (fsExistsSync(directoryPath)) {
      throw new Error(`Output directory already exists: ${directoryPath}`);
    }
  }

  for (const file of outputFiles) {
    if (fsExistsSync(file.absolutePath)) {
      throw new Error(`Output file already exists: ${file.absolutePath}`);
    }
  }

  fsMkdirSync(outputRoot, { recursive: true });
  targetDirectories.forEach((directoryPath) => {
    fsMkdirSync(directoryPath, { recursive: true });
  });

  outputFiles.forEach((file) => {
    fsWriteFileSync(file.absolutePath, file.content, "utf8");
  });

  return {
    inputPath,
    outputRoot,
    filesWritten: outputFiles.map((file) => file.absolutePath),
  };
}

export function registerGenerateMdCommand(program) {
  program
    .command("generate-md <inputFile>")
    .description("Generate DocCurl markdown docs from Postman, Insomnia, or Hoppscotch JSON")
    .addOption(
      new Option("--format <format>", "Import format")
        .choices(["auto", "postman", "insomnia", "hoppscotch"])
        .default("auto"),
    )
    .option(
      "--out <dir>",
      "Output directory for generated markdown",
      "docs/imported",
    )
    .addHelpText(
      "after",
      `
Output rules:
  • Top-level collections/workspaces become directories.
  • Folders with fewer than 8 requests become one markdown file named after the folder.
  • Folders with 8 or more requests become a directory with index.md plus one file per request.

Examples:
  $ doccurl generate-md postman.json
  $ doccurl generate-md insomnia-export.json --format insomnia --out docs/imported
  $ doccurl generate-md hoppscotch.json --format auto`,
    )
    .action((inputFile, options) => {
      const result = generateMarkdownDocs(inputFile, options);
      console.log(`Generated ${result.filesWritten.length} markdown files in ${result.outputRoot}`);
    });
}
