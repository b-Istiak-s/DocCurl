const startServer = (port = 3000, projectName) => {
  const express = require("express");
  const path = require("path");
  const fs = require("fs");
  const MarkdownIt = require("markdown-it");
  const setupCurlRoutes = require("./curl-runner");

  const app = express();
  const PORT = port || process.env.PORT || 3000;
  const md = new MarkdownIt();

  // Resolve docs directory (handle both relative and absolute paths)
  const docsDir = path.isAbsolute(projectName)
    ? projectName
    : path.join(__dirname, projectName);

  // Middleware
  app.use(express.json({ limit: "10kb" }));

  // Serve static files from the frontend directory
  app.use(express.static(path.join(__dirname, "../frontend")));

  // Setup curl routes
  setupCurlRoutes(app);

  // API endpoint to get list of markdown files
  app.get("/api/docs", (req, res) => {
    console.log(`Serving docs from: ${docsDir}`);
    fs.readdir(docsDir, (err, files) => {
      if (err) {
        return res.status(500).json({ error: "Unable to read docs directory" });
      }
      const mdFiles = files.filter((file) => file.endsWith(".md"));
      res.json(mdFiles);
    });
  });

  // API endpoint to get a specific markdown file as HTML
  app.get("/api/docs/:filename", (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(docsDir, filename);

    // Security check: prevent directory traversal
    if (!filename.endsWith(".md") || filename.includes("..")) {
      return res.status(400).json({ error: "Invalid filename" });
    }

    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        return res.status(404).json({ error: "File not found" });
      }
      const html = md.render(data);
      res.json({ filename, html, markdown: data });
    });
  });

  // Serve index.html for the root route
  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/index.html"));
  });

  return app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
};

module.exports = { startServer };
