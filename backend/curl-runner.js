const { execFile } = require("child_process");

const NODE_ENV = process.env.NODE_ENV || "development";

function setupCurlRoutes(app) {
  function isValidUrl(url) {
    try {
      if (NODE_ENV === "development") {
        // In development, allow localhost for testing
        return true;
      }

      const parsed = new URL(url);

      // Only allow http and https
      if (!["http:", "https:"].includes(parsed.protocol)) return false;

      // Block localhost and internal IPs
      const hostname = parsed.hostname;

      if (
        hostname === "localhost" ||
        hostname.startsWith("127.") ||
        hostname.startsWith("10.") ||
        hostname.startsWith("192.168.") ||
        hostname.startsWith("172.") ||
        hostname === "::1" ||
        hostname.startsWith("fc00:") ||
        hostname.startsWith("fd00:")
      ) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  app.post("/api/run-curl", async (req, res) => {
    const { url, method = "GET", headers = {}, body = "" } = req.body;

    // Basic validation
    if (!url || !isValidUrl(url)) {
      return res.status(400).json({ error: "Invalid or blocked URL" });
    }

    const allowedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
    if (!allowedMethods.includes(method.toUpperCase())) {
      return res.status(400).json({ error: "Invalid HTTP method" });
    }

    // Construct curl arguments safely
    const curlArgs = ["-X", method.toUpperCase(), url];

    // Add headers safely
    for (const [key, value] of Object.entries(headers)) {
      curlArgs.push("-H", `${key}: ${value}`);
    }

    // Add body if present
    if (body && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
      curlArgs.push("-d", body);
    }

    curlArgs.push("--max-redirs", "0");

    // Docker arguments (secure)
    const dockerArgs = [
      "run",
      "--rm",
      "--memory=64m",
      "--cpus=0.5",
      "--pids-limit=64",
      "--read-only",
      "--network=host",
      "curlimages/curl",
      ...curlArgs,
    ];

    execFile(
      "docker",
      dockerArgs,
      { timeout: 5000 }, // 5 second timeout
      (error, stdout, stderr) => {
        if (error) {
          return res.status(500).json({
            error: "Execution failed",
            details: stderr || error.message,
          });
        }

        res.json({
          success: true,
          output: stdout,
        });
      },
    );
  });
}

module.exports = setupCurlRoutes;
