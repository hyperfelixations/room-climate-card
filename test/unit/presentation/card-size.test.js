"use strict";

// The size a card draws at its measured width (resolveCardSize() in card-size.js). Without a size,
// or at small, nothing changes at any width. A sized card never grows header and panel beyond what
// the narrowest proven card holds; `dynamic` grows every part with the width, a fixed size keeps the
// rooms at their step in fewer columns; the readings fill their row; where the rooms keep below the
// panel, a reading stays under the headline's share and a short code under the entity label.
// Boundary: room-chip-fit.test.js owns the fit itself, test/browser/geometry/size.spec.js the drawn
// card. See internal dev doc §5 "Kartengröße".

const test = require("node:test");
const assert = require("node:assert/strict");

let cardSize;
let sizeConfig;
let fit;
let metrics;
let core;
let layout;

test.before(async () => {
  cardSize = await import("../../../src/presentation/view-model/card-size.js");
  sizeConfig = await import("../../../src/config/size.js");
  fit = await import("../../../src/presentation/view-model/room-chip-fit.js");
  metrics = await import("../../../src/presentation/view-model/room-chip-metrics.js");
  core = await import("../../../src/core/size.js");
  layout = await import("../../../src/presentation/view-model/room-layout.js");
});

const TEMPERATURE = { valueTexts: ["10.0", "35.0"], unitText: "°C" };
const WIDTHS = [320, 360, 375, 400, 440, 480, 520, 600, 800];
const EPSILON = 1e-9;

const config = (raw) => sizeConfig.normalizeSizeConfig(raw, []);
const resolve = (raw, width, count = 7) =>
  cardSize.resolveCardSize({ size: config(raw), width, chipTexts: TEMPERATURE, grid: { count, columns: null, rows: null } });
// The font sizes a resolved size draws at this width, in its width layout.
function fonts(resolved, width) {
  const regime = fit.chipRegimeAt(width, resolved.size.shell);
  const chip = metrics.ROOM_CHIP_REGIMES[regime];
  return {
    roomValue: chip.valueFont * resolved.size.roomValue,
    roomLabel: chip.labelFont * resolved.size.rooms,
    headline: cardSize.HEADLINE_FONT_PX[regime] * resolved.size.panel,
    entityLabel: cardSize.ENTITY_LABEL_FONT_PX * resolved.size.entityLabel,
  };
}

test("without a size, or at small, the card draws as is in the drawn card's columns at every width", () => {
  const drawn = fit.autoRoomColumns(TEMPERATURE);
  for (const width of WIDTHS) {
    for (const raw of [undefined, "small", {}, { dynamic: false }]) {
      const resolved = cardSize.resolveCardSize({ size: raw === undefined ? undefined : config(raw), width, chipTexts: TEMPERATURE, grid: { count: 7, columns: null, rows: null } });
      assert.deepEqual(resolved, { size: core.UNSCALED_SIZE, autoColumns: drawn }, `${JSON.stringify(raw)} at ${width}`);
    }
  }
});

test("header and panel never grow beyond the card's width over the narrowest proven card", () => {
  for (const width of WIDTHS) {
    const limit = Math.max(1, (width - 2) / (cardSize.SAFE_CARD_WIDTH_PX - 2));
    for (const raw of ["medium", "large", 2, { header: 2, panel: 2, dynamic: false }]) {
      const { size } = resolve(raw, width);
      assert.ok(size.header <= limit + EPSILON && size.panel <= limit + EPSILON, `${JSON.stringify(raw)} at ${width}: ${size.header}, ${size.panel}`);
      assert.equal(size.shell, Math.max(size.header, size.panel), "the frame holds the larger of the two");
    }
  }
  assert.equal(resolve({ header: "large", panel: "large", dynamic: false }, 600).size.panel, 1.5, "a card with room draws the full factor");
});

test("dynamic grows every part with the width, from the drawn card at 320 px to its factor at 480 px", () => {
  assert.deepEqual(resolve("large", cardSize.SAFE_CARD_WIDTH_PX).size, core.UNSCALED_SIZE, "drawn as is at the narrowest card");
  const full = resolve("large", cardSize.DYNAMIC_FULL_WIDTH_PX).size;
  assert.equal(full.header, 1.5);
  assert.equal(full.panel, 1.5);
  let previous = null;
  for (const width of WIDTHS) {
    const { size } = resolve("large", width);
    if (previous) {
      assert.ok(size.header >= previous.header && size.panel >= previous.panel, `${width}: the frame never shrinks with a wider card`);
    }
    previous = size;
  }
});

test("a fixed size keeps the rooms at their step on a narrow card, in fewer columns", () => {
  const drawn = fit.autoRoomColumns(TEMPERATURE);
  const fixed = resolve({ header: "large", panel: "large", rooms: "large", dynamic: false }, 375);
  const dynamic = resolve("large", 375);
  assert.ok(fixed.size.roomValue >= sizeConfig.ROOM_SIZE_STEPS.large - EPSILON, `${fixed.size.roomValue}`);
  assert.ok(fixed.autoColumns < drawn);
  assert.ok(dynamic.size.roomValue < fixed.size.roomValue, "dynamic keeps a narrow card smaller");
});

test("a sized card's chips fill their row and read clearly larger than the drawn card's", () => {
  for (const width of [375, 400, 440, 480, 600]) {
    for (const raw of ["medium", "large"]) {
      const resolved = resolve(raw, width);
      const drawn = fonts(resolved, width);
      assert.ok(drawn.roomValue >= 1.3 * fonts(resolve("small", width), width).roomValue, `${raw} at ${width}: ${drawn.roomValue}`);
      // The widest row still fits, and the reading could not grow further: the row would break or
      // the headline's share is reached.
      const widest = Math.max(...layout.roomGridRows(7, null, null, resolved.autoColumns).rowSizes.map((row) => row.columnCount));
      const holds = (size) => fit.roomColumnsAt({ ...TEMPERATURE, width, size }) >= widest;
      assert.ok(holds(resolved.size), `${raw} at ${width}: the row holds its chips`);
      const atShare = drawn.roomValue >= cardSize.ROOM_HEADLINE_SHARE * drawn.headline - 0.01;
      const grown = { ...resolved.size, roomValue: resolved.size.roomValue * 1.03 };
      assert.ok(atShare || !holds(grown), `${raw} at ${width}: the reading fills its chip`);
    }
  }
});

test("where the rooms keep below the panel, a reading stays below the headline and is filled only up to its share, a short code stays at the entity label", () => {
  for (const width of WIDTHS) {
    for (const raw of ["medium", "large", 1.4, { panel: "large", rooms: "medium" }, { header: "medium", panel: "medium", rooms: "medium", dynamic: false }]) {
      const resolved = resolve(raw, width);
      const drawn = fonts(resolved, width);
      const where = `${JSON.stringify(raw)} at ${width}`;
      assert.ok(drawn.roomValue < drawn.headline, `${where}: the reading below the headline`);
      // Beyond its step a reading grows only up to its share of the headline.
      assert.ok(drawn.roomValue <= cardSize.ROOM_HEADLINE_SHARE * drawn.headline + 0.01 || resolved.size.roomValue <= config(raw).rooms + EPSILON, `${where}: ${drawn.roomValue}`);
      assert.ok(drawn.roomLabel <= drawn.entityLabel * 1.1 + EPSILON, `${where}: ${drawn.roomLabel} against ${drawn.entityLabel}`);
    }
  }
});

test("rooms asked to be larger than the panel are not held below it", () => {
  const resolved = resolve({ rooms: "large" }, 440);
  const drawn = fonts(resolved, 440);
  assert.equal(resolved.size.panel, 1);
  assert.equal(resolved.size.entityLabel, 1, "the entity label does not grow for them");
  assert.ok(drawn.roomLabel > drawn.entityLabel);
  assert.ok(drawn.roomValue > drawn.headline * cardSize.ROOM_HEADLINE_SHARE);
});

test("small rooms beside a larger header and panel never take more columns than the drawn card", () => {
  const drawn = fit.autoRoomColumns(TEMPERATURE);
  for (const width of WIDTHS) {
    const resolved = resolve({ header: "large", panel: "large" }, width);
    assert.equal(resolved.size.rooms, 1);
    assert.equal(resolved.size.roomValue, 1);
    assert.ok(resolved.autoColumns <= drawn, `${width}: ${resolved.autoColumns}`);
  }
});

test("where the card has room, the steps stay apart", () => {
  for (const width of [480, 600]) {
    const medium = resolve("medium", width).size;
    const large = resolve("large", width).size;
    assert.ok(medium.panel < large.panel && medium.header < large.header, `${width}`);
    assert.ok(medium.roomValue <= large.roomValue, `${width}`);
  }
});
