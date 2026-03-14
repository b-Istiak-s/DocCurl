import path from "node:path";
import { startServer } from "../../server/index.js";

export function registerServeCommand(program, { startServerImpl = startServer } = {}) {
  program
    .command("serve")
    .option("-p, --port <port>", "Port number", "3000")
    .option("-d, --dir <dir>", "Docs directory", "docs")
    .option("--dev", "Allow localhost/private targets for local testing")
    .option("--collapse", "Enable curl-focused content collapse toggle in the UI")
    .option("--password <password>", "Password to protect docs and API routes")
    .action((options) => {
      const port = Number.parseInt(options.port, 10);
      const docsDir = path.resolve(process.cwd(), options.dir);
      startServerImpl(port, docsDir, {
        dev: Boolean(options.dev),
        collapse: Boolean(options.collapse),
        password: options.password || "",
      });
    });
}
