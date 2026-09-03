"use strict";

// The 148 CSS colour names in src/core/color.js, checked against Chromium's own CSS Color
// Module Level 4 implementation: set the name as a colour, read back the computed value,
// compare. A Node test can only agree with whatever was typed into the table; this is a
// real second source.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness } = require("../../helpers/browser-helpers.js");

test("every CSS colour name in the table is the colour the browser says it is", async ({ page }) => {
  await gotoHarness(page);
  const result = await page.evaluate(async () => {
    const module = await import("/src/core/color.js");
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const mismatches = {};
    let checked = 0;
    for (const [name, hex] of Object.entries(module.CSS_COLOR_NAMES)) {
      // Cleared first: an unrecognized name leaves the previous value in place, so
      // without this a misspelt key would silently inherit its predecessor's colour.
      probe.style.color = "";
      probe.style.color = name;
      const computed = getComputedStyle(probe).color;
      const [r, g, b] = computed.match(/\d+/g).map(Number);
      const asHex = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
      if (asHex !== hex) mismatches[name] = { table: hex, browser: asHex };
      checked += 1;
    }
    probe.remove();
    return { mismatches, checked };
  });
  expect(result.checked).toBe(148);
  expect(result.mismatches).toEqual({});
});
