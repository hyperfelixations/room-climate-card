// Normalizes direct-source, bundle/jsdom and Chromium V8 coverage to src/, then emits one
// report per execution layer and a merged report. Dist paths are never allowed into the
// published map: the source files a developer can act on are the unit of coverage.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import v8ToIstanbul from "v8-to-istanbul";
import coverageModule from "istanbul-lib-coverage";
import reportModule from "istanbul-lib-report";
import reportsModule from "istanbul-reports";

const { createCoverageMap } = coverageModule;
const { createContext } = reportModule;
const { create: createReport } = reportsModule;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src") + path.sep;
const COVERAGE = path.join(ROOT, "coverage");
const MERGED_THRESHOLDS = Object.freeze({
  statements: 98,
  branches: 97,
  functions: 75,
  lines: 98,
});

function readMap(file) {
  if (!fs.existsSync(file)) throw new Error(`coverage input is missing: ${path.relative(ROOT, file)}`);
  return createCoverageMap(JSON.parse(fs.readFileSync(file, "utf8")));
}

function sourceOnly(map, label) {
  const filtered = createCoverageMap({});
  for (const file of map.files()) {
    const absolute = path.resolve(file);
    if (absolute.startsWith(SRC)) filtered.addFileCoverage(map.fileCoverageFor(file));
  }
  if (filtered.files().length === 0) throw new Error(`${label} coverage contains no source-normalized src/ files`);
  return filtered;
}

async function browserMap() {
  const directory = path.join(COVERAGE, "browser", "raw");
  if (!fs.existsSync(directory)) throw new Error("browser coverage produced no raw directory");
  const map = createCoverageMap({});
  for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith(".json")).sort()) {
    const entries = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    for (const entry of entries) {
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(entry.url).pathname).replace(/^\//, "");
      } catch {
        continue;
      }
      if (!pathname.startsWith("src/") && pathname !== "dist/room-climate-card.js") continue;
      const local = path.join(ROOT, ...pathname.split("/"));
      if (!fs.existsSync(local)) continue;
      const converter = v8ToIstanbul(local, 0, { source: entry.source });
      await converter.load();
      converter.applyCoverage(entry.functions);
      map.merge(converter.toIstanbul());
    }
  }
  return sourceOnly(map, "browser");
}

// Every .js file under src/, read from the directory (not from any layer): Istanbul reports
// only files it was handed, so an unmeasured module vanishes from the summary rather than
// showing 0%. See interne Doku §4 "Coverage in drei Schichten".
function sourceFileInventory(directory = path.join(ROOT, "src"), found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) sourceFileInventory(full, found);
    else if (entry.name.endsWith(".js")) found.push(full);
  }
  return found;
}

const relativeSorted = (files) => files.map((file) => path.relative(ROOT, path.resolve(file)).split(path.sep).join("/")).sort();

function describeDifference(label, expected, actual) {
  const missing = expected.filter((file) => !actual.includes(file));
  const extra = actual.filter((file) => !expected.includes(file));
  const parts = [];
  const list = (files) => files.join(`\n  `);
  if (missing.length > 0) parts.push(`missing from ${label}:\n  ${list(missing)}`);
  if (extra.length > 0) parts.push(`present only in ${label}:\n  ${list(extra)}`);
  return parts.join(`\n`);
}

// All three layers, and the merge, must cover the same src/ inventory. A layer that stops
// contributing a module leaves the merged percentages unchanged (the union still has it
// elsewhere) while one way of running that module goes unmeasured.
function enforceInventories(layers, merged) {
  const source = relativeSorted(sourceFileInventory());
  const failures = [];
  for (const [label, map] of Object.entries(layers)) {
    const files = relativeSorted(map.files());
    if (files.join("|") !== source.join("|")) {
      failures.push(`${label} coverage does not cover the src/ inventory
${describeDifference(label, source, files)}`);
    }
  }
  const mergedFiles = relativeSorted(merged.files());
  if (mergedFiles.join("|") !== source.join("|")) {
    failures.push(`the merged map does not cover the src/ inventory
${describeDifference("the merge", source, mergedFiles)}`);
  }
  if (failures.length > 0) throw new Error(failures.join(`\n\n`));
  console.log(`Coverage inventory: all ${source.length} source files present in every layer and in the merge.`);
}

function emit(name, map) {
  const directory = path.join(COVERAGE, name);
  fs.mkdirSync(directory, { recursive: true });
  const context = createContext({ dir: directory, coverageMap: map });
  for (const reporter of ["json", "json-summary", "lcovonly", "text-summary", "html"]) {
    createReport(reporter).execute(context);
  }
}

function enforceThresholds(map, thresholds) {
  const summary = map.getCoverageSummary().toJSON();
  const failures = [];
  for (const [metric, minimum] of Object.entries(thresholds)) {
    const actual = summary[metric].pct;
    if (actual < minimum) failures.push(`${metric}: ${actual}% < ${minimum}%`);
  }
  if (failures.length > 0) {
    throw new Error(`merged source coverage is below its quality floor:\n${failures.join("\n")}`);
  }
  console.log(
    `Merged coverage quality floor passed: ${Object.entries(thresholds)
      .map(([metric, minimum]) => `${metric}>=${minimum}%`)
      .join(", ")}`,
  );
}

const unit = sourceOnly(readMap(path.join(COVERAGE, "raw-unit", "coverage-final.json")), "unit");
const bundle = sourceOnly(readMap(path.join(COVERAGE, "raw-bundle", "coverage-final.json")), "bundle");
const browser = await browserMap();
const merged = createCoverageMap({});
merged.merge(unit);
merged.merge(bundle);
merged.merge(browser);

emit("unit", unit);
emit("bundle", bundle);
emit("browser", browser);
emit("merged", merged);

enforceInventories({ unit, bundle, browser }, merged);

const inventory = { unit: unit.files().length, bundle: bundle.files().length, browser: browser.files().length, merged: merged.files().length };
fs.writeFileSync(path.join(COVERAGE, "layers.json"), `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
console.log(`Source-normalized coverage files: ${Object.entries(inventory).map(([name, count]) => `${name}=${count}`).join(", ")}`);
enforceThresholds(merged, MERGED_THRESHOLDS);
