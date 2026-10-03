"use strict";

// The two lines that stand in for the whole card — every part hidden by `show:`, and a render
// that failed — are its only content, so they read in the title's colour and reach WCAG AA for
// normal text (4.5:1) against the card in both colour schemes. The title colour is measured on a
// default card in the same page, so the comparison follows the theme rather than a literal.
// Boundary: wording belongs to the notices tests, placement to the goldens; this file measures
// colour only. See internal dev doc §4 "Render-Primitive-/Composition-Vertrag".

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

const STATES = { "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C) };
const HIDE_ALL = { accent_line: false, icon: false, title: false, subtitle: false, entity_label: false, pill: false, panel: false, rooms: false };

function parseColor(value) {
  const rgb = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/.exec(value);
  if (!rgb) throw new Error(`unparsed colour: ${value}`);
  return { rgb: [rgb[1], rgb[2], rgb[3]].map((channel) => Number(channel) / 255), alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) };
}

function luminance({ rgb }) {
  const [r, g, b] = rgb.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(one, other) {
  const [high, low] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

async function colourOf(page, cardId, selector) {
  return page.evaluate(
    ({ id, selector }) => {
      const shadow = document.getElementById(id).shadowRoot;
      return { text: getComputedStyle(shadow.querySelector(selector)).color, card: getComputedStyle(shadow.querySelector(".rtc-card")).backgroundColor };
    },
    { id: cardId, selector }
  );
}

async function failRender(page, cardId) {
  await page.evaluate((id) => {
    document.getElementById(id).hass = {
      language: "en",
      locale: { language: "en" },
      states: new Proxy({}, { get() { throw new Error("simulated integration failure"); } }),
      callService: () => {},
    };
  }, cardId);
}

for (const scheme of ["light", "dark"]) {
  test(`the lines that stand in for the card read in the title colour in the ${scheme} scheme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await gotoHarness(page);
    const reference = await createCard(page, { entity: "sensor.avg" }, STATES);
    const title = (await colourOf(page, reference, ".rtc-title")).text;

    const hidden = await createCard(page, { entity: "sensor.avg", show: HIDE_ALL }, STATES);
    const failed = await createCard(page, { entity: "sensor.avg" }, STATES);
    await failRender(page, failed);
    await expect(page.locator(`#${failed} .rtc-render-failed`)).toHaveCount(1);

    for (const [name, cardId, selector] of [["every part hidden", hidden, ".rtc-nothing-shown"], ["render failed", failed, ".rtc-render-failed"]]) {
      await setCardWidth(page, cardId, 400);
      const measured = await colourOf(page, cardId, selector);
      expect(measured.text, `${scheme}, ${name}: the title colour`).toBe(title);
      const ratio = contrast(parseColor(measured.text), parseColor(measured.card));
      expect(ratio, `${scheme}, ${name}: ${measured.text} on ${measured.card}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}
