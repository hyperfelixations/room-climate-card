"use strict";

// The 148 CSS colour names, checked against the only authority there is.
//
// The table in src/core/color.js claims to be the CSS Color Module Level 4 definitions,
// and nothing in a Node test can do better than agree with whatever was typed into it —
// a transposed digit in `mediumspringgreen` would sail through every unit test in the
// suite and quietly give somebody the wrong ramp.
//
// Chromium has its own implementation of that specification. So it is asked directly: set
// the name as a colour, read back what it computed, compare. That is a real second source
// rather than a restatement of the first, which is the only kind of check worth having
// over a table of constants.

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
