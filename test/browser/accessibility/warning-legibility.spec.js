"use strict";

// The warnings block stays legible in both colour schemes: its text against the tinted block
// reaches WCAG AA for normal text (4.5:1), its symbol the 3:1 a graphical object needs. The
// colours are the browser's computed values, composited the way the card paints them: the
// block's translucent tint over the card surface, with and without the card's top overlay (the
// primary text colour at 6%, pinned by the styles baseline). Boundary: the block's lines and
// placement belong to geometry specs; this file measures colour only. See internal dev doc §4
// "Diagnosevertrag".

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

const TOP_OVERLAY_ALPHA = 0.06;

// sRGB channels in 0..1 plus alpha, from the two forms Chromium serialises: rgb()/rgba() and
// color(srgb r g b / a).
function parseColor(value) {
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(value);
  if (srgb) return { rgb: [Number(srgb[1]), Number(srgb[2]), Number(srgb[3])], alpha: srgb[4] === undefined ? 1 : Number(srgb[4]) };
  const rgb = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgb) return { rgb: [rgb[1], rgb[2], rgb[3]].map((channel) => Number(channel) / 255), alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) };
  throw new Error(`unparsed colour: ${value}`);
}

function over(top, bottom) {
  return { rgb: top.rgb.map((channel, index) => channel * top.alpha + bottom.rgb[index] * (1 - top.alpha)), alpha: 1 };
}

function luminance({ rgb }) {
  const [r, g, b] = rgb.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(one, other) {
  const [high, low] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

for (const scheme of ["light", "dark"]) {
  test(`the warnings block is legible in the ${scheme} scheme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await gotoHarness(page);
    const cardId = await createCard(page, { entity: "sensor.avg", auto_slide: "yes" }, { "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C) });
    await setCardWidth(page, cardId, 400);
    const computed = await page.evaluate((id) => {
      const shadow = document.getElementById(id).shadowRoot;
      const style = (selector) => getComputedStyle(shadow.querySelector(selector));
      return {
        card: style(".rtc-card").backgroundColor,
        block: style(".rtc-warning").backgroundColor,
        text: style(".rtc-warning-text").color,
        icon: style(".rtc-warning-icon").fill,
      };
    }, cardId);

    const card = parseColor(computed.card);
    const text = parseColor(computed.text);
    const icon = parseColor(computed.icon);
    const block = parseColor(computed.block);
    const surfaces = { plain: card, "top overlay": over({ rgb: text.rgb, alpha: TOP_OVERLAY_ALPHA }, card) };
    for (const [name, surface] of Object.entries(surfaces)) {
      const background = over(block, surface);
      expect(contrast(text, background), `${scheme}, ${name}: text ${computed.text} on ${computed.block}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(icon, background), `${scheme}, ${name}: symbol ${computed.icon} on ${computed.block}`).toBeGreaterThanOrEqual(3);
    }
  });
}
