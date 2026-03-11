import fs from "node:fs";
import path from "node:path";
import { buildDocsTree } from "../../core/docs/tree.js";
import { normalizeDocPath, resolveSafeDocPath } from "../../core/docs/paths.js";

export function registerDocsRoutes(app, { docsDir, markdownRenderer }) {
  app.get("/api/docs/tree", (_req, res) => {
    const tree = buildDocsTree(docsDir);
    res.json({ tree });
  });

  app.get("/api/docs/content", (req, res) => {
    try {
      const relativePath = normalizeDocPath(req.query.path);
      const filePath = resolveSafeDocPath(docsDir, relativePath);

      fs.readFile(filePath, "utf8", (error, data) => {
        if (error) {
          return res.status(404).json({ error: "File not found" });
        }

        const html = markdownRenderer.render(data);
        return res.json({
          path: relativePath,
          filename: path.basename(relativePath),
          html,
          markdown: data,
        });
      });
    } catch (error) {
      return res.status(400).json({ error: error.message || "Invalid path" });
    }
  });
}
