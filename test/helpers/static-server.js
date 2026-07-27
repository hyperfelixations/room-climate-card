"use strict";

// Minimal zero-dependency static file server for the Playwright test layer
// — serves the whole package root (so test/fixtures/harness.html can load
// ../../room-climate-card.js and ../helpers/hass-fixtures.js via plain
// relative <script src>, no bundler). Not used in production; only by
// `npm run test:browser` (see playwright.config.js's webServer option).

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PORT = Number(process.env.PORT) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`static-server listening on http://localhost:${PORT}`);
});
