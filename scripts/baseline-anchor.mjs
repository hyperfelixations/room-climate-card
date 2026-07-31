// Prints a single digest over the whole characterization baseline set.
//
// The test suite enforces each baseline separately; this provides one content
// digest for comparing complete baseline sets without relying on timestamps.
//
// Recipe: files sorted by relative path, then for each file
//   <relative path> NUL <file bytes> NUL
// fed into one SHA-256.
//
// Two digests are printed, differing only in the path separator that goes into
// the hash chain:
//
//   posix   forward slashes — the binding, platform-independent value from here
//           on.
//   native  this platform's separator, retained for platform-local comparisons;
//           on POSIX platforms it is identical to posix.

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
