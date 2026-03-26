import path from "node:path";
import { startServer } from "../../server/index.js";

export function registerServeCommand(
  program,
  { startServerImpl = startServer } = {},
) {
  program
    .command("serve")
    .description("Serve markdown docs with interactive curl playgrounds")
    .option("-p, --port <port>", "HTTP port (1-65535)", "3000")
    .option(
      "-d, --dir <dir>",
      "Docs directory path (relative to current directory or absolute)",
      "docs",
    )
    .option("--host <host>", "Host interface to bind (defaults to 127.0.0.1)")
    .option(
      "--dev",
      "Allow localhost/private network targets (development only)",
    )
    .option("--collapse", 'Enable the "Focus Curls"/"Show All" document toggle')
    .option("--password <password>", "Require password for docs and API routes")
    .addHelpText(
      "after",
      `
Notes:
  • --port must be a valid integer; defaults to 3000.
  • --dir is resolved from the current working directory.
  • --host defaults to 127.0.0.1; use 0.0.0.0 for intentional network exposure.
  • --dev relaxes production URL target restrictions.
  • --collapse enables a curl-focused reading mode in the UI.

Examples:
  $ doccurl serve
  $ doccurl serve --port 8080 --dir docs
  $ doccurl serve --host 0.0.0.0 --port 8080
  $ doccurl serve --dev --collapse
  $ doccurl serve --password my-secret`,
    )
    .action((options) => {
      const port = Number.parseInt(options.port, 10);
      const docsDir = path.resolve(process.cwd(), options.dir);
      startServerImpl(port, docsDir, {
        dev: Boolean(options.dev),
        collapse: Boolean(options.collapse),
        host: options.host || "127.0.0.1",
        password: options.password || "",
      });
    });
}
