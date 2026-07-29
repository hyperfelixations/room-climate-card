// Prints a single digest over the whole characterization baseline set.
//
// During a refactoring the baselines must not move. The test suite already
// enforces that per file; this gives one number to quote in a review, compare
// against an earlier run, or hand to an independent checker — without having
// to trust file timestamps, which prove nothing about content.
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
//   native  this platform's separator — kept only so an anchor taken with it
//           stays reproducible. On Windows that is what the 2026-07-29
//           independent review recorded
//           (9c56d557422e30176a7c8ee2c2150247b10579ce2ab00488df18c2c89fd3cdf2);
//           on other platforms it is identical to posix.

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
