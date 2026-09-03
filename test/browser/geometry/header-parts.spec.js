"use strict";

// Where the header's parts land when one is not drawn. The header is a three-column grid
// (`auto 1fr auto`, 11px gap); an empty column still contributes its gap, so omitting the
// icon would push the title 11px from the left edge. The stylesheet carries one override
// per surviving subset; only a real browser says where the boxes ended up. The default case
// is measured too — a card asking for nothing must stay pixel-for-pixel unchanged.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

const STATES = {
  "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
  "sensor.r1": mkStateObj("sensor.r1", 19.4, TEMPERATURE_C),
  "sensor.r2": mkStateObj("sensor.r2", 24.8, TEMPERATURE_C),
};

const CONFIG = (show) => ({
  entity: "sensor.avg",
  title: "Temperature",
  auto_slide: false,
  rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
  views: [{ type: "scale" }],
  ...(show ? { show } : {}),
});

// Every box the header can hold, as the browser laid it out, plus the resolved track list.
async function headerLayout(page, cardId) {
  return page.evaluate((id) => {
    const shadow = document.getElementById(id).shadowRoot;
    const header = shadow.querySelector(".rtc-header");
    if (!header) return null;
    const box = (selector) => {
      const element = shadow.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
    };
    return {
      tracks: getComputedStyle(header).gridTemplateColumns.split(" ").length,
      gap: getComputedStyle(header).columnGap,
      header: box(".rtc-header"),
      icon: box(".rtc-icon-badge"),
      titleBlock: box(".rtc-title-block"),
      pill: box(".rtc-status-pill"),
    };
  }, cardId);
}

test("the default header is three tracks, and every part sits where it always has", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, CONFIG(null), STATES);
  await setCardWidth(page, cardId, 400);
  const layout = await headerLayout(page, cardId);

  expect(layout.tracks).toBe(3);
  expect(layout.gap).toBe("11px");
  expect(layout.icon.left).toBe(layout.header.left);
  expect(layout.pill.right).toBe(layout.header.right);
  expect(layout.titleBlock.left).toBe(layout.icon.right + 11);
});

// One case per surviving subset. `expectedTracks` is what the override has to resolve to;
// the edge assertions are what that means on the screen.
const SUBSETS = [
  { name: "no icon", show: { icon: false }, tracks: 2, leftmost: "titleBlock", rightmost: "pill" },
  { name: "no pill", show: { pill: false }, tracks: 2, leftmost: "icon", rightmost: "titleBlock" },
  { name: "no header lines", show: { title: false, subtitle: false }, tracks: 2, leftmost: "icon", rightmost: "pill" },
  { name: "title only", show: { icon: false, pill: false }, tracks: 1, leftmost: "titleBlock", rightmost: "titleBlock" },
  { name: "pill only", show: { icon: false, title: false, subtitle: false }, tracks: 1, leftmost: null, rightmost: "pill" },
  { name: "icon only", show: { pill: false, title: false, subtitle: false }, tracks: 1, leftmost: "icon", rightmost: null },
];

for (const subset of SUBSETS) {
  test(`${subset.name}: the missing column takes its gap with it`, async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(page, CONFIG(subset.show), STATES);
    await setCardWidth(page, cardId, 400);
    const layout = await headerLayout(page, cardId);

    expect(layout.tracks, "the override resolved to the wrong number of columns").toBe(subset.tracks);
    if (subset.leftmost) {
      expect(layout[subset.leftmost].left, `${subset.leftmost} should start at the header's left edge`).toBe(layout.header.left);
    }
    if (subset.rightmost) {
      expect(layout[subset.rightmost].right, `${subset.rightmost} should end at the header's right edge`).toBe(layout.header.right);
    }
  });
}

test("a header with nothing in it is not laid out at all", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, CONFIG({ icon: false, title: false, subtitle: false, pill: false }), STATES);
  await setCardWidth(page, cardId, 400);
  expect(await headerLayout(page, cardId)).toBeNull();

  // And what follows it starts where the header used to, rather than 11px lower.
  const panelTop = await page.evaluate((id) => {
    const shadow = document.getElementById(id).shadowRoot;
    const root = shadow.querySelector(".rtc-root");
    const panel = shadow.querySelector(".rtc-main-panel");
    return Math.round(panel.getBoundingClientRect().top - root.getBoundingClientRect().top);
  }, cardId);
  const rootPadding = await page.evaluate((id) => {
    const root = document.getElementById(id).shadowRoot.querySelector(".rtc-root");
    return Math.round(parseFloat(getComputedStyle(root).paddingTop));
  }, cardId);
  expect(panelTop).toBe(rootPadding);
});

test("the title wraps by default and clips when asked, on a card too narrow for it", async ({ page }) => {
  await gotoHarness(page);
  const long = "Temperature in the whole of the ground floor";

  const wrapping = await createCard(page, { ...CONFIG(null), title: long }, STATES);
  await setCardWidth(page, wrapping, 320);
  const clipping = await createCard(page, { ...CONFIG(null), title: { text: long, overflow: "clip" } }, STATES);
  await setCardWidth(page, clipping, 320);

  const measure = (id) =>
    page.evaluate((cardId) => {
      const title = document.getElementById(cardId).shadowRoot.querySelector(".rtc-title");
      const style = getComputedStyle(title);
      return {
        height: Math.round(title.getBoundingClientRect().height),
        whiteSpace: style.whiteSpace,
        overflow: style.overflow,
        clipped: title.scrollWidth > title.clientWidth,
      };
    }, id);

  const wrapped = await measure(wrapping);
  const clipped = await measure(clipping);

  expect(wrapped.whiteSpace).toBe("normal");
  expect(clipped.whiteSpace).toBe("nowrap");
  expect(clipped.overflow).toBe("hidden");
  expect(wrapped.height, "a wrapped title is taller than a clipped one").toBeGreaterThan(clipped.height);
  expect(clipped.clipped, "and the clipped one really is cut off rather than merely allowed to be").toBe(true);
});
