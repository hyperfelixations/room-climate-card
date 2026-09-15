"use strict";

// The accent line occupies one configured edge of `.rtc-root` without participating in
// layout. The top edge is the default; `accent_line: bottom` moves the same 3px element to
// the opposite edge. Switching position must preserve the card, root and content geometry,
// because the option changes paint placement only.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth, waitForStableLayout } = require("../../helpers/browser-helpers");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

const CONFIG = {
  entity: "sensor.avg",
  auto_slide: false,
  views: [{ type: "scale" }],
};

async function geometry(page, cardId) {
  return page.evaluate((id) => {
    const card = document.getElementById(id);
    const surface = card.shadowRoot.querySelector(".rtc-card").getBoundingClientRect();
    const root = card.shadowRoot.querySelector(".rtc-root").getBoundingClientRect();
    const line = card.shadowRoot.querySelector(".rtc-top-line").getBoundingClientRect();
    const header = card.shadowRoot.querySelector(".rtc-header").getBoundingClientRect();
    return {
      surface: { width: surface.width, height: surface.height },
      root: { width: root.width, height: root.height },
      line: {
        width: line.width,
        height: line.height,
        topFromRoot: line.top - root.top,
        bottomFromRoot: root.bottom - line.bottom,
      },
      header: { topFromRoot: header.top - root.top, height: header.height },
    };
  }, cardId);
}

test("accent_line moves between card edges without shifting content", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, CONFIG, {
    "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
  });

  for (const width of [320, 400, 700]) {
    await setCardWidth(page, cardId, width);
    const top = await geometry(page, cardId);
    expect(top.line.topFromRoot).toBeCloseTo(0, 1);
    expect(top.line.height).toBeCloseTo(3, 1);
    expect(top.line.width).toBeCloseTo(top.root.width, 1);

    await page.evaluate(({ id, config }) => {
      document.getElementById(id).setConfig({ ...config, accent_line: "bottom" });
    }, { id: cardId, config: CONFIG });
    await waitForStableLayout(page, cardId, width);
    const bottom = await geometry(page, cardId);
    expect(bottom.line.bottomFromRoot).toBeCloseTo(0, 1);
    expect(bottom.line.height).toBeCloseTo(3, 1);
    expect(bottom.line.width).toBeCloseTo(bottom.root.width, 1);
    expect(bottom.surface).toEqual(top.surface);
    expect(bottom.root).toEqual(top.root);
    expect(bottom.header).toEqual(top.header);

    await page.evaluate(({ id, config }) => {
      document.getElementById(id).setConfig(config);
    }, { id: cardId, config: CONFIG });
    await waitForStableLayout(page, cardId, width);
  }
});
