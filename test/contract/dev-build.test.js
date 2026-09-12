"use strict";

// The development build (scripts/build-dev.mjs, `npm run build:dev`) and its promise: loaded as a
// second dashboard resource it registers a separate card beside the released one and leaves the
// released card's element, picker entry and version global untouched. Built into a temp directory
// with injected time and Git state, so the run is deterministic and never writes dist/.
// Boundary: what the product artifact itself is stays in build-artifact.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { CARD_SOURCE_PATH, createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { buildScenario } = require("../fixtures/scenario.js");
const { CO2 } = require("../fixtures/attributes.js");
const packageJson = require("../../package.json");
const registrationBaseline = require("../baseline/registration/custom-cards.json");

const PRODUCT_TAG = "room-climate-card";
const DEV_TAG = "room-climate-card-dev";
const BUILT_AT = new Date("2026-09-12T15:30:12.345Z");
const DEV_VERSION = `${packageJson.version}-dev+20260912T153012Z.abc1234.dirty`;
// SemVer 2.0.0, from semver.org.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const PRODUCT_METADATA = {
  CARD_TYPE: "room-climate-card",
  CARD_NAME: "Room Climate Card",
  CARD_VERSION: "2.38.2",
  CARD_VERSION_GLOBAL: "roomClimateCardVersion",
};

let devScript;
let outDir;
let devFile;
let devSource;
let productSource;
let productHashBefore;

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

test.before(async () => {
  devScript = await import("../../scripts/build-dev.mjs");
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "rcc-dev-build-"));
  devFile = path.join(outDir, "room-climate-card-dev.js");
  productHashBefore = sha256(CARD_SOURCE_PATH);
  await devScript.buildDevBundle({ outFile: devFile, builtAt: BUILT_AT, git: { commit: "abc1234", dirty: true } });
  devSource = fs.readFileSync(devFile, "utf8");
  productSource = fs.readFileSync(CARD_SOURCE_PATH, "utf8");
});

test.after(() => {
  if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
});

// A bare realm, as in build-artifact.test.js; console.info is captured, since the dev build
// announces itself there and nothing else may.
function loadIntoBareRealm(sources) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", runScripts: "outside-only" });
  const info = [];
  dom.window.console.info = (...args) => info.push(args.join(" "));
  for (const source of sources) dom.window.eval(source);
  return { window: dom.window, info };
}

const withoutFunctions = (entry) =>
  Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, typeof value === "function" ? "[Function]" : value]));

// ------------------------------------------------------------------ the identity --

test("the dev identity is derived from the product identity, with and without Git", () => {
  const derive = (git) => ({ ...devScript.deriveDevIdentity(PRODUCT_METADATA, { builtAt: BUILT_AT, ...git }) });
  assert.deepEqual(derive({ commit: "abc1234", dirty: true }), {
    CARD_TYPE: "room-climate-card-dev",
    CARD_NAME: "Room Climate Card (Dev)",
    CARD_VERSION: "2.38.2-dev+20260912T153012Z.abc1234.dirty",
    CARD_VERSION_GLOBAL: "roomClimateCardDevVersion",
  });
  assert.equal(derive({ commit: "abc1234", dirty: false }).CARD_VERSION, "2.38.2-dev+20260912T153012Z.abc1234");
  assert.equal(derive({ commit: null, dirty: false }).CARD_VERSION, "2.38.2-dev+20260912T153012Z");
  const fromPrerelease = devScript.deriveDevIdentity({ ...PRODUCT_METADATA, CARD_VERSION: "2.39.0-dev.1" }, { builtAt: BUILT_AT });
  for (const version of [
    derive({ commit: "abc1234", dirty: true }).CARD_VERSION,
    derive({ commit: null }).CARD_VERSION,
    fromPrerelease.CARD_VERSION,
  ]) {
    assert.match(version, SEMVER, `${version} is not a SemVer version`);
  }
});

test("a product version global that does not follow from the product type is refused", () => {
  assert.throws(
    () => devScript.deriveDevIdentity({ ...PRODUCT_METADATA, CARD_VERSION_GLOBAL: "rccVersion" }, { builtAt: BUILT_AT }),
    /CARD_VERSION_GLOBAL "rccVersion" does not follow from CARD_TYPE "room-climate-card"/
  );
});

test("an identity constant the dev build does not derive stops the build", () => {
  const identity = devScript.deriveDevIdentity(PRODUCT_METADATA, { builtAt: BUILT_AT });
  assert.doesNotThrow(() => devScript.assertSameExports(Object.keys(PRODUCT_METADATA), identity));
  assert.throws(
    () => devScript.assertSameExports([...Object.keys(PRODUCT_METADATA), "CARD_ICON"], identity),
    /exports CARD_ICON, CARD_NAME, CARD_TYPE, CARD_VERSION, CARD_VERSION_GLOBAL, but the dev build derives .* extend deriveDevIdentity\(\)/
  );
});

// ------------------------------------------------------------------ the artifact --

test("the build writes the file it was asked for and leaves the product artifact alone", () => {
  assert.equal(sha256(CARD_SOURCE_PATH), productHashBefore, "dist/room-climate-card.js must not change");
  assert.deepEqual(fs.readdirSync(outDir), ["room-climate-card-dev.js"]);
});

test("the dev artifact is a strict, self-contained IIFE that says what it is", () => {
  assert.ok(
    devSource.startsWith(`/* Room Climate Card (Dev) ${DEV_VERSION} — DEVELOPMENT BUILD, not a release.\n`),
    devSource.slice(0, 200)
  );
  assert.match(devSource, /from commit abc1234 with uncommitted changes at 2026-09-12T15:30:12\.345Z/);
  assert.match(devSource, /use `type: custom:room-climate-card-dev`/);
  assert.match(devSource, /\(function \(\) \{\n'use strict';/);
  assert.match(devSource, /\}\)\(\);\n?$/);
  assert.doesNotMatch(devSource, /^\s*import\s|^\s*export\s/m);
  assert.doesNotMatch(devSource, /\brequire\s*\(|\bimport\s*\(/);
  assert.doesNotMatch(devSource, /\/\/# sourceMappingURL/);
  assert.match(devSource, /const CARD_TYPE = "room-climate-card-dev";/);
  assert.doesNotMatch(devSource, /const CARD_TYPE = "room-climate-card";/);
});

test("only the identity module and the announcement differ from the product bundle", () => {
  // Everything below the banner, with the one swapped module and the outro removed, is the product
  // bundle byte for byte: the dev build tests the same card, not a variant of it.
  // card-metadata.js has no imports, so it is the first module in the IIFE and ends with
  // CARD_VERSION_GLOBAL.
  const identityModule = /^'use strict';\n\n[\s\S]*?^const CARD_VERSION_GLOBAL = "[^"]*";\n/m;
  const withoutIdentity = (source) =>
    source
      .slice(source.indexOf("(function () {"))
      .replace(identityModule, "'use strict';\n<identity>\n")
      .replace(/^console\.info\("Room Climate Card \(Dev\) [^"]*"\);\n\n/m, "");
  const dev = withoutIdentity(devSource);
  assert.ok(dev.includes("<identity>") && !dev.includes("console.info(\"Room Climate Card (Dev)"), "both edits must apply");
  assert.equal(dev, withoutIdentity(productSource));
});

// ------------------------------------------------------------------ coexistence --

for (const order of [["product", "dev"], ["dev", "product"]]) {
  test(`the released and the dev card coexist in one realm (${order.join(" first, then ")})`, () => {
    const sources = order.map((which) => (which === "product" ? productSource : devSource));
    const { window, info } = loadIntoBareRealm(sources);

    const productElement = window.customElements.get(PRODUCT_TAG);
    const devElement = window.customElements.get(DEV_TAG);
    assert.equal(typeof productElement, "function");
    assert.equal(typeof devElement, "function");
    assert.notEqual(productElement, devElement, "each bundle defines its own element class");

    assert.equal(window.customCards.length, 2);
    const product = window.customCards.find((card) => card.type === PRODUCT_TAG);
    const dev = window.customCards.find((card) => card.type === DEV_TAG);
    assert.deepEqual(JSON.parse(JSON.stringify(withoutFunctions(product))), registrationBaseline[0]);
    assert.equal(dev.name, "Room Climate Card (Dev)");
    assert.equal(dev.description, product.description);
    assert.equal(dev.documentationURL, product.documentationURL);
    assert.equal(dev.preview, true);

    assert.equal(window.roomClimateCardVersion, packageJson.version, "the released card's version global is untouched");
    assert.equal(window.roomClimateCardDevVersion, DEV_VERSION);
    const own = Object.keys(window).filter((key) => /^(rtc|roomClimate|customCards)/i.test(key));
    assert.deepEqual(own.sort(), ["customCards", "roomClimateCardDevVersion", "roomClimateCardVersion"]);
    assert.deepEqual(info, [`Room Climate Card (Dev) ${DEV_VERSION}`], "only the dev build announces itself, once");
  });
}

test("loading the dev build twice neither throws nor duplicates its picker entry", () => {
  const { window } = loadIntoBareRealm([productSource, devSource, devSource]);
  assert.equal(window.customCards.filter((card) => card.type === DEV_TAG).length, 1);
  assert.equal(window.customCards.length, 2);
});

test("the dev card's picker hook suggests the dev card, not the released one", () => {
  const { window } = loadIntoBareRealm([productSource, devSource]);
  const dev = window.customCards.find((card) => card.type === DEV_TAG);
  const hass = { states: { "sensor.co2": { entity_id: "sensor.co2", state: "700", attributes: CO2 } } };
  assert.equal(dev.getEntitySuggestion(hass, "sensor.co2").config.type, `custom:${DEV_TAG}`);
  const product = window.customCards.find((card) => card.type === PRODUCT_TAG);
  assert.equal(product.getEntitySuggestion(hass, "sensor.co2").config.type, `custom:${PRODUCT_TAG}`);
});

test("a dev card renders beside the released one in the component harness", () => {
  // The harness's jsdom console forwards to Node's; the dev build's announcement is captured.
  const originalInfo = console.info;
  const info = [];
  console.info = (...args) => info.push(args.join(" "));
  let env;
  try {
    env = createTestEnvironment({ additionalScripts: [devFile] });
  } finally {
    console.info = originalInfo;
  }
  assert.deepEqual(info, [`Room Climate Card (Dev) ${DEV_VERSION}`]);

  const built = buildScenario({ metric: "temperature", primary: { state: 21.4 } });
  const released = env.createCard(built.config, built.hass);
  const dev = env.document.createElement(DEV_TAG);
  env.document.body.appendChild(dev);
  try {
    dev.hass = built.hass;
    dev.setConfig(built.config);
    assert.notEqual(dev.constructor, released.constructor);
    for (const card of [released, dev]) {
      const root = card.shadowRoot.querySelector(".rtc-root");
      assert.ok(root, `${card.localName} rendered no .rtc-root`);
      assert.notEqual(root.getAttribute("data-state"), "no-data", card.localName);
      assert.match(card.shadowRoot.querySelector(".rtc-avg-value").textContent, /21\.4/, card.localName);
    }
  } finally {
    dev.remove();
    env.cleanupAll();
  }
});
