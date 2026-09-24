// Normalizes the Node layers (run-coverage.mjs COVERAGE_LAYERS) and Chromium V8 coverage to
// src/, checks inventory and execution per layer, then emits one report per layer and a merged
// report held to its floor. Dist paths are never allowed into the published map: the source
// files a developer can act on are the unit of coverage. See internal dev doc §4 "Coverage in vier Schichten".

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import v8ToIstanbul from "v8-to-istanbul";
import coverageModule from "istanbul-lib-coverage";
import reportModule from "istanbul-lib-report";
import reportsModule from "istanbul-reports";
import { BROWSER_LAYER, COVERAGE_LAYERS } from "./run-coverage.mjs";

const { createCoverageMap } = coverageModule;
const { createContext } = reportModule;
const { create: createReport } = reportsModule;
const MODULE_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(MODULE_PATH), "..");
const SRC = path.join(ROOT, "src") + path.sep;
const COVERAGE = path.join(ROOT, "coverage");
const BUNDLE = path.join(ROOT, "dist", "room-climate-card.js");
// Measured floor; branches sit one point lower because timing-dependent tests shift a few
// branch counts between runs. See internal dev doc §4 "Coverage in vier Schichten".
export const MERGED_THRESHOLDS = Object.freeze({
  statements: 99,
  branches: 98,
  functions: 99,
  lines: 99,
});

// Reachable only through the built bundle: a layer that loads the bundle and shows either one
// unexecuted has lost the bundle's coverage somewhere between V8 and the report.
const CARD_ELEMENT = "src/element/room-climate-card.js";
export const BUNDLE_SENTINELS = Object.freeze(["src/index.js", CARD_ELEMENT]);
export const BUNDLE_LAYERS = Object.freeze(["bundle", "surface", BROWSER_LAYER]);

function readMap(file) {
  if (!fs.existsSync(file)) throw new Error(`coverage input is missing: ${path.relative(ROOT, file)}`);
  return createCoverageMap(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function sourceOnly(map, label) {
  const filtered = createCoverageMap({});
  for (const file of map.files()) {
    const absolute = path.resolve(file);
    if (absolute.startsWith(SRC)) filtered.addFileCoverage(map.fileCoverageFor(file));
  }
  if (filtered.files().length === 0) throw new Error(`${label} coverage contains no source-normalized src/ files`);
  return filtered;
}

// One V8 script coverage entry as Istanbul coverage; the bundle is remapped to src/ through its
// inline source map, a src/ file maps to itself.
async function istanbulOf(local, source, functions) {
  const converter = v8ToIstanbul(local, 0, { source });
  await converter.load();
  converter.applyCoverage(functions);
  return converter.toIstanbul();
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
      map.merge(await istanbulOf(local, entry.source, entry.functions));
    }
  }
  return sourceOnly(map, "browser");
}

// The bundle as a Node layer ran it (vm-evaluated by test/helpers/load-card.jsdom.js), from the
// raw V8 files c8 keeps in `v8/` (run-coverage.mjs c8Args); c8 itself drops this script.
async function nodeBundleMap(v8Directory) {
  if (!fs.existsSync(v8Directory)) throw new Error(`raw V8 coverage is missing: ${path.relative(ROOT, v8Directory)}`);
  const source = fs.readFileSync(BUNDLE, "utf8");
  if (!source.includes("//# sourceMappingURL=data:application/json")) {
    throw new Error(`${path.relative(ROOT, BUNDLE)} carries no inline source map; merge-coverage.mjs runs inside npm run coverage`);
  }
  const map = createCoverageMap({});
  for (const name of fs.readdirSync(v8Directory).filter((entry) => entry.endsWith(".json")).sort()) {
    for (const script of JSON.parse(fs.readFileSync(path.join(v8Directory, name), "utf8")).result) {
      if (!script.url.startsWith("file:") || path.resolve(fileURLToPath(script.url)) !== BUNDLE) continue;
      map.merge(await istanbulOf(BUNDLE, source, script.functions));
    }
  }
  return map;
}

// Every .js file under src/, read from the directory (not from any layer): Istanbul reports
// only files it was handed, so an unmeasured module vanishes from the summary rather than
// showing 0%. See internal dev doc §4 "Coverage in vier Schichten".
export function sourceFileInventory(directory = path.join(ROOT, "src"), found = []) {
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

// Every layer, and the merge, must cover the same src/ inventory. A layer that stops
// contributing a module leaves the merged percentages unchanged (the union still has it
// elsewhere) while one way of running that module goes unmeasured.
export function enforceInventories(layers, merged, source = relativeSorted(sourceFileInventory())) {
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

// Every layer that loads the bundle must have executed each bundle-only module and called a
// function of the card element: every such layer creates cards. A remap that counts lines
// without mapping functions (c8 --exclude-after-remap) fails the second check.
export function enforceExecution(layers) {
  const failures = [];
  for (const label of BUNDLE_LAYERS) {
    const byFile = new Map(layers[label].files().map((file) => [relativeSorted([file])[0], layers[label].fileCoverageFor(file)]));
    const blind = BUNDLE_SENTINELS.filter((file) => !Object.values(byFile.get(file)?.s ?? {}).some((count) => count > 0));
    if (blind.length > 0) failures.push(`${label} coverage never executed the bundle: ${blind.join(", ")}`);
    else if (!Object.values(byFile.get(CARD_ELEMENT).f).some((count) => count > 0)) {
      failures.push(`${label} coverage called no function of ${CARD_ELEMENT}`);
    }
  }
  if (failures.length > 0) throw new Error(failures.join(`\n`));
  console.log(`Coverage execution: ${BUNDLE_LAYERS.join(", ")} executed ${BUNDLE_SENTINELS.join(" and ")}.`);
}

function emit(name, map) {
  const directory = path.join(COVERAGE, name);
  fs.mkdirSync(directory, { recursive: true });
  const context = createContext({ dir: directory, coverageMap: map });
  for (const reporter of ["json", "json-summary", "lcovonly", "text-summary", "html"]) {
    createReport(reporter).execute(context);
  }
}

export function enforceThresholds(map, thresholds) {
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

async function main() {
  const layers = {};
  for (const { name } of COVERAGE_LAYERS) {
    const layer = readMap(path.join(COVERAGE, `raw-${name}`, "coverage-final.json"));
    layer.merge(await nodeBundleMap(path.join(COVERAGE, `raw-${name}`, "v8")));
    layers[name] = sourceOnly(layer, name);
  }
  layers[BROWSER_LAYER] = await browserMap();
  const merged = createCoverageMap({});
  for (const map of Object.values(layers)) merged.merge(map);

  for (const [name, map] of Object.entries(layers)) emit(name, map);
  emit("merged", merged);

  enforceInventories(layers, merged);
  enforceExecution(layers);

  const inventory = Object.fromEntries([...Object.entries(layers), ["merged", merged]].map(([name, map]) => [name, map.files().length]));
  fs.writeFileSync(path.join(COVERAGE, "layers.json"), `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  console.log(`Source-normalized coverage files: ${Object.entries(inventory).map(([name, count]) => `${name}=${count}`).join(", ")}`);
  enforceThresholds(merged, MERGED_THRESHOLDS);
}

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  await main();
}
