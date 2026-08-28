"use strict";

// Two things only a real browser can answer.
//
// FIRST, whether the card actually sees what it is painted on. jsdom hands back a computed
// style that does not track a later inline change, so the unit layer can only check a card
// that was styled before its first read. Here the cascade is real, and a card-mod-style
// override behaves the way one would in a dashboard — including a gradient, where the card
// has to read the colour stops rather than a `background-color` that is not there.
//
// SECOND — and this is the one that matters most — it RENDERS THE BORDERLINE CALIBRATION
// PAIRS so a person can look at them. The visibility threshold is a number, and a number
// cannot be reviewed. The swatches can: each shows a colour painted on its background at
// text weight, next to the verdict the card gives it. If a swatch labelled "invisible" is
// plainly readable, or one labelled "visible" is not, the calibration table is wrong and
// this is where that becomes obvious.
//
// The screenshot is deliberately NOT a golden. A golden would freeze the pixels; the point
// of this one is that a human looks at it when the threshold changes.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj } = require("../../helpers/browser-helpers.js");
const { BORDERLINE, VISIBLE, INVISIBLE } = require("../../fixtures/palette-fit-calibration.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

const TEMP = TEMPERATURE_C;

// The card reads a SURFACE — the colours it sits on, and the theme's text colour. These
// checks are about the first half; the text colour and what depends on it are the subject of
// paint-role-calibration.spec.js next door.
async function backgroundOf(page, cardId) {
  return page.evaluate((id) => document.getElementById(id)._surface().samples, cardId);
}

// ------------------------------------------------ reading the real background --

test("the card reads the colour it is painted on, and follows it when it changes", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg" }, { "sensor.avg": mkStateObj("sensor.avg", 22, TEMP) });

  // The harness carries Home Assistant's real light-theme custom properties, so the card
  // resolves its background through the theme exactly as it would in a dashboard.
  const themed = await backgroundOf(page, cardId);
  expect(themed.length).toBeGreaterThan(0);
  expect(themed[0]).toMatch(/^#[0-9a-f]{6}$/i);

  // What card-mod does. No theme flag knows about this, and the card still has to see it.
  await page.evaluate((id) => {
    document.getElementById(id).shadowRoot.querySelector(".rtc-card").style.backgroundColor = "rgb(20, 20, 20)";
  }, cardId);
  expect(await backgroundOf(page, cardId)).toEqual(["#141414"]);

  // And back, so the answer tracks the paint rather than latching on the first read.
  await page.evaluate((id) => {
    document.getElementById(id).shadowRoot.querySelector(".rtc-card").style.backgroundColor = "rgb(250, 250, 250)";
  }, cardId);
  expect(await backgroundOf(page, cardId)).toEqual(["#fafafa"]);
});

test("a gradient background is read as its colour stops and the blends between them", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg" }, { "sensor.avg": mkStateObj("sensor.avg", 22, TEMP) });

  await page.evaluate((id) => {
    const card = document.getElementById(id).shadowRoot.querySelector(".rtc-card");
    card.style.background = "linear-gradient(rgb(255, 255, 255), rgb(0, 0, 0))";
  }, cardId);

  const samples = await backgroundOf(page, cardId);
  // Both ends, and the interior — a white-to-black gradient passes through mid grey, which
  // is where every mid-light ramp dies and what reading only the stops would have missed.
  expect(samples.length).toBeGreaterThan(2);
  expect(samples[0]).toBe("#ffffff");
  expect(samples[samples.length - 1]).toBe("#000000");
  expect(samples.some((hex) => /^#[78][0-9a-f]{5}$/i.test(hex))).toBe(true);
});

test("a translucent card is composited onto what is actually behind it", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg" }, { "sensor.avg": mkStateObj("sensor.avg", 22, TEMP) });

  await page.evaluate((id) => {
    document.getElementById("stage").style.backgroundColor = "rgb(255, 255, 255)";
    document.getElementById(id).shadowRoot.querySelector(".rtc-card").style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  }, cardId);

  const [sample] = await backgroundOf(page, cardId);
  // Half-transparent black over white is a mid grey — and it is a mid grey because browsers
  // composite in sRGB rather than in linear light. A linear-light blend would give #bcbcbc.
  const channel = parseInt(sample.slice(1, 3), 16);
  expect(channel).toBeGreaterThan(110);
  expect(channel).toBeLessThan(146);
});

test("a background image the card cannot read falls through to the theme", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg" }, { "sensor.avg": mkStateObj("sensor.avg", 22, TEMP) });

  await page.evaluate((id) => {
    const card = document.getElementById(id).shadowRoot.querySelector(".rtc-card");
    card.style.background = "url(data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)";
  }, cardId);

  const samples = await backgroundOf(page, cardId);
  // Nothing here can know the average colour of a photograph, and a guess would be worse
  // than the theme value. What must NOT happen is an empty answer or a crash.
  expect(samples.length).toBeGreaterThan(0);
  for (const hex of samples) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
});

// ------------------------------------------------------- the swatches to look at --

test("the calibration swatches render for review", async ({ page }) => {
  await gotoHarness(page);

  const rows = [
    ...BORDERLINE.map(([colour, background, verdict, why]) => ({ colour, background, verdict, why, group: "borderline" })),
    ...VISIBLE.slice(0, 4).map(([colour, background, why]) => ({ colour, background, verdict: "visible", why, group: "visible" })),
    ...INVISIBLE.slice(0, 4).map(([colour, background, why]) => ({ colour, background, verdict: "invisible", why, group: "invisible" })),
  ];

  await page.evaluate((entries) => {
    const stage = document.getElementById("stage");
    stage.innerHTML = "";
    stage.style.background = "#EFEFEF";
    stage.style.padding = "16px";
    stage.style.width = "900px";
    for (const entry of entries) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:14px;margin-bottom:8px;font:13px system-ui";
      const swatch = document.createElement("div");
      // Text weight, not a solid block: the card paints NUMBERS in these colours, and a
      // thin glyph is far harder to pick out than a filled rectangle. Judging the threshold
      // against a block would set it far too low.
      swatch.style.cssText =
        `background:${entry.background};color:${entry.colour};width:230px;padding:10px 12px;` +
        "font:600 22px/1.1 system-ui;border-radius:8px;border:1px solid rgba(0,0,0,.15)";
      swatch.textContent = "21.4 °C";
      const label = document.createElement("div");
      label.style.cssText = "flex:1";
      label.innerHTML =
        `<b>${entry.verdict}</b> · <code>${entry.colour}</code> on <code>${entry.background}</code>` +
        `<br><span style="opacity:.65">${entry.why}</span>`;
      row.append(swatch, label);
      stage.append(row);
    }
  }, rows);

  // Attached rather than compared: this exists to be LOOKED AT when the threshold moves,
  // and freezing it as a golden would only assert that nobody had changed the fixture.
  await test.info().attach("palette-fit-calibration.png", {
    body: await page.locator("#stage").screenshot(),
    contentType: "image/png",
  });

  await expect(page.locator("#stage > div")).toHaveCount(rows.length);
});
