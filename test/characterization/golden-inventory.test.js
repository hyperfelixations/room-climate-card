"use strict";

// The golden screenshots as an inventory, checked without a browser. A baseline can keep
// passing while depicting something the card no longer renders; the pixel comparison (see
// maxDiffPixels in playwright.config.js) is one guard, this is the other. It answers what
// the comparison cannot: is every screenshot the spec asks for committed (a missing one is
// silently created on the next local run), is every committed screenshot still asked for
// (a renamed scenario leaves its PNG behind, uncompared), and are two baselines byte-
// identical (two scenarios written to differ that do not). It reads the spec's source
// rather than running it — checking committed files against committed intent needs no Chromium.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SPEC_PATH = path.join(__dirname, "..", "browser", "visual", "visual-golden.spec.js");
const SNAPSHOT_DIR = `${SPEC_PATH}-snapshots`;
// Playwright appends "-{projectName}-{platform}" to the name the spec passes.
const SUFFIX = "-chromium-win32.png";

// Every .png string literal in the spec. A name built from a loop variable becomes a
// pattern (only running the spec could enumerate its instances) but still constrains which
// files may exist.
function referencedNames(source) {
  const literals = [...source.matchAll(/["'`]([^"'`\n]*\.png)["'`]/g)].map((match) => match[1]);
  return literals.map((literal) => ({
    literal,
    exact: !literal.includes("${"),
    pattern: new RegExp(`^${literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\$\\\{[^}]*\\\}/g, "[a-z0-9-]+")}$`),
  }));
}

const source = fs.readFileSync(SPEC_PATH, "utf8");
const references = referencedNames(source);
const files = fs.readdirSync(SNAPSHOT_DIR).filter((name) => name.endsWith(".png"));

test("the golden spec references at least the baselines this project is known to have", () => {
  assert.ok(references.length > 0, "no screenshot names found — the extraction regex no longer matches the spec");
  assert.ok(files.length >= 30, `expected the committed baseline set, found only ${files.length} files`);
});

test("every committed golden is still referenced by the spec", () => {
  const orphans = files.filter((file) => {
    assert.ok(file.endsWith(SUFFIX), `${file} does not carry the expected "${SUFFIX}" suffix`);
    const name = `${file.slice(0, -SUFFIX.length)}.png`;
    return !references.some((reference) => reference.pattern.test(name));
  });
  assert.deepEqual(
    orphans,
    [],
    "these baselines are never compared against anything — delete them, or restore the scenario that produced them"
  );
});

test("every exactly-named screenshot the spec asks for is committed", () => {
  const present = new Set(files.map((file) => `${file.slice(0, -SUFFIX.length)}.png`));
  const missing = references.filter((reference) => reference.exact && !present.has(reference.literal)).map((reference) => reference.literal);
  assert.deepEqual(
    missing,
    [],
    "a missing baseline is written on the next local run without anyone reviewing it — record it deliberately instead"
  );
});

test("no two goldens are byte-identical", () => {
  const byDigest = new Map();
  for (const file of files) {
    const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(SNAPSHOT_DIR, file))).digest("hex");
    byDigest.set(digest, [...(byDigest.get(digest) || []), file]);
  }
  const duplicates = [...byDigest.values()].filter((group) => group.length > 1);
  assert.deepEqual(
    duplicates,
    [],
    "two scenarios render identically, so at least one of them is not covering what its name says"
  );
});

test("every golden is a non-empty, well-formed PNG", () => {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(SNAPSHOT_DIR, file));
    assert.ok(bytes.length > 1000, `${file} is suspiciously small (${bytes.length} bytes)`);
    assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `${file} is not a PNG`);
    // Width and height live in the IHDR chunk, at fixed offsets right after the
    // signature. A zero dimension means a capture of nothing.
    assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0, `${file} has a zero dimension`);
  }
});
