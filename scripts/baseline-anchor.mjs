// Prints one SHA-256 digest over the whole characterization baseline set, for comparing
// complete sets without relying on timestamps. Recipe: files sorted by relative path, then
// per file `<relative path> NUL <bytes> NUL`. Two digests differ only in the path separator
// hashed: `posix` (forward slashes) is the binding platform-independent value; `native`
// uses this platform's separator and is identical to posix on POSIX.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baselineDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "baseline");

function listFiles(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

function digest(files, separator) {
  const hash = crypto.createHash("sha256");
  const named = files.map((file) => ({ file, name: file.split("/").join(separator) }));
  named.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const { file, name } of named) {
    hash.update(name, "utf8");
    hash.update(Buffer.from([0]));
    hash.update(fs.readFileSync(path.join(baselineDir, file)));
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

const files = listFiles(baselineDir);
const bytes = files.reduce((sum, file) => sum + fs.statSync(path.join(baselineDir, file)).size, 0);

console.log(`baseline-anchor: ${files.length} files, ${bytes} bytes`);
console.log(`  posix  ${digest(files, "/")}`);
console.log(`  native ${digest(files, path.sep)}`);
