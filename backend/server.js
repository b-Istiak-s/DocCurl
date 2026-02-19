const express = require("express");
const path = require("path");
const fs = require("fs");
const MarkdownIt = require("markdown-it");

const app = express();
const PORT = process.env.PORT || 3000;
const md = new MarkdownIt();

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, "../frontend")));

// API endpoint to get list of markdown files
app.get("/api/docs", (req, res) => {
  const docsDir = path.join(__dirname, "../docs");
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
  const filePath = path.join(__dirname, "../docs", filename);

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

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
