// Proves that the committed distribution artifact is byte-for-byte what the
// current src/ produces through the configured build.
//
// This matters because dist/room-climate-card.js is not a build convenience —
// it IS the published artifact. HACS serves it verbatim from the repository,
// and Home Assistant executes it. A stale bundle would mean every user runs
// code that no longer exists in source, with a green test suite to match
// (the tests load the artifact, not the sources).
//
// "Matches src/" means: rebuilding with the same sources and the same Rollup
// version produces the same bytes. It does NOT mean the bundle is a literal
// copy of the sources — Rollup bundles ES modules, drops import/export
// statements, and may move or rename top-level declarations (see
// rollup.config.mjs).
//
// The check deliberately never writes to dist/: it bundles in memory via
// Rollup's generate() API and compares the result against the untouched
// committed file. Building into dist/ first and then comparing would compare
// the build against itself and always pass.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import config from "../rollup.config.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = path.join(repoRoot, config.output.file);

function fail(message) {
  console.error(`verify-dist: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(artifactPath)) {
  fail(
    `${config.output.file} is missing.\n` +
      `  It is a committed artifact, not a build side product. Run "npm run build" and commit the result.`
  );
}

const committed = fs.readFileSync(artifactPath, "utf8");

const bundle = await rollup({
  input: path.join(repoRoot, config.input),
  treeshake: config.treeshake,
  onwarn: config.onwarn,
});
const { output } = await bundle.generate(config.output);
await bundle.close();

if (output.length !== 1) {
  fail(`expected exactly one output chunk, got ${output.length} — the distribution contract is a single file`);
}
const rebuilt = output[0].code;

// Report UTF-8 bytes — what actually lands on disk and on the wire. (A second
// figure from String.length would be UTF-16 code units, not characters: this
// file contains °, µ, ³, em dashes and translated UI text, so neither number
// is a character count in any useful sense.)
const byteLength = (text) => Buffer.byteLength(text, "utf8");

if (rebuilt === committed) {
  console.log(`verify-dist: OK — ${config.output.file} matches src/ (${byteLength(committed)} bytes UTF-8)`);
  process.exit(0);
}

// Line endings are the one failure mode that is not an actual content drift,
// so name it explicitly instead of showing a confusing whole-file diff.
// Detected symmetrically and by content, not by guessing which side is wrong:
// if both sides become identical once every CRLF is normalized to LF, the
// difference is nothing but line endings. .gitattributes pins src/**/*.js and
// dist/*.js to eol=lf precisely to prevent this, so reaching here means those
// attributes did not apply to this working tree.
const toLf = (text) => text.replace(/\r\n/g, "\n");
if (toLf(committed) === toLf(rebuilt)) {
  fail(
    `${config.output.file} differs from the rebuilt bundle in line endings only.\n` +
      `  committed: ${committed.includes("\r\n") ? "contains CRLF" : "LF only"}\n` +
      `  rebuilt  : ${rebuilt.includes("\r\n") ? "contains CRLF" : "LF only"}\n` +
      `  The content is identical, so this is a checkout/normalization problem rather\n` +
      `  than a stale bundle. Suggested order:\n` +
      `    1. review "git status" and note any local modifications;\n` +
      `    2. save or stash anything you have not committed yet;\n` +
      `    3. check the affected paths out again so .gitattributes ("text eol=lf" for\n` +
      `       src/**/*.js and dist/*.js) applies, or work from a fresh clone.`
  );
}

// Point at the first divergence so the cause is obvious without an external
// diff tool.
const committedLines = committed.split("\n");
const rebuiltLines = rebuilt.split("\n");
let line = 0;
while (line < committedLines.length && committedLines[line] === rebuiltLines[line]) line++;

fail(
  `${config.output.file} is out of date with src/.\n` +
    `  committed: ${byteLength(committed)} bytes UTF-8, ${committedLines.length} lines\n` +
    `  rebuilt  : ${byteLength(rebuilt)} bytes UTF-8, ${rebuiltLines.length} lines\n` +
    `  first difference at line ${line + 1}:\n` +
    `    committed: ${JSON.stringify(committedLines[line])}\n` +
    `    rebuilt  : ${JSON.stringify(rebuiltLines[line])}\n` +
    `  Run "npm run build" and commit dist/.`
);
