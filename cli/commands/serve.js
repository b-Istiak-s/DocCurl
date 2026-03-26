import path from "node:path";
import { startServer } from "../../server/index.js";

export async function promptPasswordFromTty({
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  if (
    !stdin?.isTTY ||
    !stdout?.isTTY ||
    typeof stdin.setRawMode !== "function"
  ) {
    throw new Error("Interactive TTY required when using --password");
  }

  return new Promise((resolve, reject) => {
    let password = "";
    let settled = false;
    const previousRawMode = Boolean(stdin.isRaw);
    const previousEncoding = typeof stdin.readableEncoding === "string" ? stdin.readableEncoding : null;

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;

      stdin.removeListener("data", handleData);
      stdin.removeListener("error", handleError);
      stdin.setRawMode(previousRawMode);
      if (typeof stdin.pause === "function") {
        stdin.pause();
      }
      if (previousEncoding && typeof stdin.setEncoding === "function") {
        stdin.setEncoding(previousEncoding);
      }
      stdout.write("\n");

      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    };

    const handleError = (error) => {
      finish(error);
    };

    const handleData = (chunk) => {
      for (const character of String(chunk || "")) {
        if (character === "\u0003") {
          const error = new Error("Password prompt cancelled");
          error.code = "PROMPT_CANCELLED";
          finish(error);
          return;
        }

        if (character === "\r" || character === "\n") {
          finish(null, password);
          return;
        }

        if (character === "\u0008" || character === "\u007f") {
          password = password.slice(0, -1);
          continue;
        }

        password += character;
      }
    };

    stdout.write("Password: ");
    if (typeof stdin.setEncoding === "function") {
      stdin.setEncoding("utf8");
    }
    stdin.setRawMode(true);
    if (typeof stdin.resume === "function") {
      stdin.resume();
    }
    stdin.on("data", handleData);
    stdin.on("error", handleError);
  });
}

export function registerServeCommand(
  program,
  {
    startServerImpl = startServer,
    promptPasswordImpl = promptPasswordFromTty,
  } = {},
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
    .option(
      "--dev",
      "Allow localhost/private network targets (development only)",
    )
    .option("--collapse", 'Enable the "Focus Curls"/"Show All" document toggle')
    .option("--password", "Prompt for a password to protect docs and API routes")
    .addHelpText(
      "after",
      `
Notes:
  • --port must be a valid integer; defaults to 3000.
  • --dir is resolved from the current working directory.
  • --dev relaxes production URL target restrictions.
  • --collapse enables a curl-focused reading mode in the UI.
  • --password prompts for a hidden password; it is required in non-dev mode.

Examples:
  $ doccurl serve
  $ doccurl serve --port 8080 --dir docs
  $ doccurl serve --dev --collapse
  $ doccurl serve --password`,
    )
    .action(async (options) => {
      const port = Number.parseInt(options.port, 10);
      const docsDir = path.resolve(process.cwd(), options.dir);
      const password = options.password ? await promptPasswordImpl() : "";
      startServerImpl(port, docsDir, {
        dev: Boolean(options.dev),
        collapse: Boolean(options.collapse),
        password,
      });
    });
}
