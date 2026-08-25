"use strict";

// THE PAINT ROLES, HELD AGAINST A LIVE CARD.
//
// src/domain/classification/paint-roles.js states where each palette colour lands and what
// is behind it: the scale track is 8% of the theme's text colour over the card, the status
// pill is a 20% tint of the tone colour, a room chip's mark an 18% tint over the chip's own
// 10% tint. Every one of those is a claim about the STYLESHEET, and a claim about a
// stylesheet that nothing renders will eventually stop being true.
//
// So this file renders the card and asks the browser. The unit-level guard next door
// (test/unit/domain/paint-roles.test.js) checks that the alphas match the modules that own
// them; only a real cascade can check that they are still combined in that order, on that
// element, over that background.
//
// AND IT RENDERS THE BRACKETING CASES SO A PERSON CAN LOOK. The separation factors were set
// by looking at cards at 400px on a light theme, not by a formula — a 12px/900 pill on a
// tint of itself is either readable or it is not, and only an eye can say which. The plate
// below is the same set of cards, with the verdict beside each, so the next person to touch
// a factor can check it the way it was checked the first time.
//
// The screenshot is deliberately NOT a golden. A golden would freeze the pixels; the point
// of this one is that a human looks at it.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../../helpers/browser-helpers.js");

const TEMP = { device_class: "temperature", unit_of_measurement: "°C" };

// A card with three rooms: one below the comfort band, one inside it, one above. That is the
// smallest scenario in which every role is painted at once — the pill and the icon carry the
// average's tone, the track carries three markers and the optimal band, and the chips carry
// both an in-band mark and two out-of-band ones.
const STATES = {
  "sensor.avg": mkStateObj("sensor.avg", 22, TEMP),
  "sensor.r1": mkStateObj("sensor.r1", 19.4, TEMP),
  "sensor.r2": mkStateObj("sensor.r2", 24.8, TEMP),
  "sensor.r3": mkStateObj("sensor.r3", 22.1, TEMP),
};
const CONFIG = (palette) => ({
  entity: "sensor.avg",
  palette,
  rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }, { entity: "sensor.r3" }],
  views: ["scale"],
});

// What the browser resolved, as `{ base, alpha }` — the two halves a role composites.
async function paintedWith(page, cardId, selector, property) {
  return page.evaluate(
    ([id, sel, prop]) => {
      const element = document.getElementById(id).shadowRoot.querySelector(sel);
      if (!element) return null;
      const value = prop === "color" ? getComputedStyle(element).color : getComputedStyle(element).backgroundColor;
      // Chromium hands back `rgb(r, g, b)`, `rgba(r, g, b, a)` or, for a color-mix(), a
      // `color(srgb ...)` form. All three are read here rather than only the first.
      const rgba = value.match(/rgba?\(([^)]+)\)/);
      if (rgba) {
        const parts = rgba[1].split(",").map((part) => Number(part.trim()));
        return { channels: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
      }
      const srgb = value.match(/color\(srgb ([^)]+)\)/);
      if (srgb) {
        const parts = srgb[1].split("/");
        const channels = parts[0].trim().split(/\s+/).map((part) => Math.round(Number(part) * 255));
        return { channels, alpha: parts[1] ? Number(parts[1].trim()) : 1 };
      }
      return { raw: value };
    },
    [cardId, selector, property]
  );
}

const hexOf = (measured) =>
  `#${measured.channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

// ---------------------------------------------- the surface the card reads ----

test("the card reads the theme's text colour, and follows it when it changes", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, CONFIG("pastel"), STATES);

  const surfaceOf = (id) => page.evaluate((cid) => document.getElementById(cid)._surface(), id);

  const themed = await surfaceOf(cardId);
  expect(themed.samples.length).toBeGreaterThan(0);
  expect(themed.text).toMatch(/^#[0-9a-f]{6}$/i);

  // A theme that states a different text colour puts the scale track somewhere else, and the
  // card has to see that even though its background has not moved.
  await page.evaluate((id) => {
    document.getElementById(id).style.setProperty("--primary-text-color", "rgb(114, 114, 114)");
  }, cardId);
  const relit = await surfaceOf(cardId);
  expect(relit.text).toBe("#727272");
  expect(relit.samples).toEqual(themed.samples);

  // An opaque colour only, and only from THAT property. A translucent text colour is not a
  // surface the roles can composite onto, and no second source is consulted: the track is
  // mixed out of --primary-text-color by name, so anything else would be a different colour
  // wearing the same label. Null is the honest answer and the roles fall back to the card.
  await page.evaluate((id) => {
    document.getElementById(id).style.setProperty("--primary-text-color", "rgba(0, 0, 0, 0.5)");
  }, cardId);
  expect((await surfaceOf(cardId)).text).toBeNull();

  // And a theme that sets nothing at all is the same answer, not a fabricated one.
  await page.evaluate((id) => {
    document.getElementById(id).style.setProperty("--primary-text-color", "not-a-colour");
  }, cardId);
  expect((await surfaceOf(cardId)).text).toBeNull();
});

// ---------------------------------------------- the map matches the paint ----

test("every role's background is the one the browser actually composites", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, CONFIG("pastel"), STATES);

  const surface = await page.evaluate((id) => document.getElementById(id)._surface(), cardId);
  const card = surface.samples[0];

  // The tone colour as the card painted it, read from the pill rather than recomputed: the
  // whole point is to compare the model against what is on the screen.
  const pillText = await paintedWith(page, cardId, ".rtc-status-pill", "color");
  const tone = hexOf(pillText);
  expect(tone).toMatch(/^#[0-9A-F]{6}$/);

  const measured = {
    track: await paintedWith(page, cardId, ".rtc-scale-bar", "background"),
    band: await paintedWith(page, cardId, ".rtc-optimal-band", "background"),
    pill: await paintedWith(page, cardId, ".rtc-status-pill", "background"),
    icon: await paintedWith(page, cardId, ".rtc-icon-badge", "background"),
  };

  // 1 — the track really is a tint of the text colour, at the weight the roles assume.
  expect(hexOf(measured.track)).toBe(surface.text);
  expect(measured.track.alpha).toBeCloseTo(0.08, 3);

  // 2 — the band, the pill and the icon really are tints of the tone colour, at 20%.
  for (const [name, entry] of Object.entries({ band: measured.band, pill: measured.pill, icon: measured.icon })) {
    expect(hexOf(entry), name).toBe(tone);
    expect(entry.alpha, name).toBeCloseTo(0.2, 3);
  }

  // 3 — and a room chip's mark is an 18% tint over the chip's own 10% one.
  const chip = await paintedWith(page, cardId, ".rtc-room-chip", "background");
  const mark = await page.evaluate((id) => {
    const chips = document.getElementById(id).shadowRoot.querySelectorAll(".rtc-room-top *");
    for (const element of chips) {
      const background = getComputedStyle(element).backgroundColor;
      if (background && background !== "rgba(0, 0, 0, 0)") return { background, color: getComputedStyle(element).color };
    }
    return null;
  }, cardId);
  expect(mark, "a room chip paints a coloured mark").not.toBeNull();
  expect(chip.alpha).toBeCloseTo(0.1, 3);
  expect(mark.background).toMatch(/0\.18\)$/);

  // 4 — the roles, given the same surface, produce exactly those backgrounds. This is the
  // assertion the whole file exists for: the model and the paint agree.
  const modelled = await page.evaluate(
    async ([cardColour, textColour, toneColour]) => {
      const roles = await import("/src/domain/classification/paint-roles.js");
      const point = roles.pointOf(cardColour, textColour);
      const byId = (id) => roles.PAINT_ROLES.find((role) => role.id === id);
      return {
        marker: byId("marker").background(toneColour, point),
        toneLabel: byId("toneLabel").background(toneColour, point),
        toneIcon: byId("toneIcon").background(toneColour, point),
        bandForeground: roles.foregroundFor(byId("toneBand"), toneColour, point),
      };
    },
    [card, surface.text, tone]
  );

  const compose = (base, alpha, over) => {
    const parse = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
    const [br, bg, bb] = parse(base);
    const [orr, og, ob] = parse(over);
    return `#${[br * alpha + orr * (1 - alpha), bg * alpha + og * (1 - alpha), bb * alpha + ob * (1 - alpha)]
      .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()}`;
  };
  const track = compose(surface.text, 0.08, card);
  expect(modelled.marker.toUpperCase()).toBe(track);
  expect(modelled.toneLabel.toUpperCase()).toBe(compose(tone, 0.2, card));
  expect(modelled.toneIcon.toUpperCase()).toBe(compose(tone, 0.2, card));
  expect(modelled.bandForeground.toUpperCase()).toBe(compose(tone, 0.2, track));
});

// ---------------------------------------------- the plate to look at ---------

// The cases the factors were bracketed against, in the order the bracket runs. Each is a
// palette the card will build for itself, so what is rendered is a real card and not a
// swatch — which is the whole difference between this plate and a colour table.
const BRACKET = [
  ["white", "toneBand", "no band at all — the failing side"],
  ["#AADDCC", "toneBand", "barely a tint — still the failing side"],
  ["#77EEDD", "toneBand", "plainly a band — the passing side"],
  ["pastel", "toneBand", "unmistakable"],
  ["lime", "toneLabel", "Optimal cannot be read, and the ramp can — the case this exists for"],
  ["gold", "toneLabel", "the same failure in a warmer hue"],
  ["teal", "toneLabel", "comfortably readable"],
];

test("the bracketing cards, rendered for a person to look at", async ({ page }) => {
  await gotoHarness(page);
  await page.setViewportSize({ width: 900, height: 1400 });

  for (const [palette, role, why] of BRACKET) {
    const cardId = await createCard(page, CONFIG(palette), STATES);
    await page.evaluate(
      ([id, name, roleId, reason]) => {
        const card = document.getElementById(id);
        const caption = document.createElement("div");
        caption.style.cssText = "font:600 11px system-ui;margin:10px 0 2px;color:#333";
        caption.textContent = `${name} — ${roleId}: ${reason}`;
        card.parentElement.insertBefore(caption, card);
        card.style.width = "400px";
      },
      [cardId, palette, role, why]
    );
  }
  await page.evaluate(() => document.fonts.ready);

  // Not a golden: the file is written so it can be opened and judged, and it is regenerated
  // on every run rather than compared against a stored copy.
  await page.locator("#stage").screenshot({ path: "test-results/paint-role-calibration.png" });

  // What the plate is being checked against, asserted so the run still fails if the verdicts
  // and the picture ever part company.
  const verdicts = await page.evaluate(async () => {
    const fit = await import("/src/domain/classification/palette-fit.js");
    const roles = await import("/src/domain/classification/paint-roles.js");
    const registry = await import("/src/domain/classification/palettes/registry.js");
    const surface = roles.surfaceOf(["#FFFFFF"], "#212121");
    const at = (name, roleId) => {
      const palette = registry.paletteForName(name) || registry.paletteForColor(name);
      const report = fit.evaluatePaletteFit(registry.completePalette(palette), surface);
      const optimal = report.steps.find((step) => step.key === "optimal");
      return optimal.roles[roleId].fits;
    };
    return {
      whiteBand: at("white", "toneBand"),
      pastelBand: at("pastel", "toneBand"),
      limeLabel: at("lime", "toneLabel"),
      limeAccent: at("lime", "accent"),
      tealLabel: at("teal", "toneLabel"),
    };
  });

  expect(verdicts.whiteBand, "palette: white paints no band").toBe(false);
  expect(verdicts.pastelBand, "pastel's band is unmistakable").toBe(true);
  expect(verdicts.limeLabel, "lime's Optimal pill cannot be read").toBe(false);
  expect(verdicts.limeAccent, "and lime's middle is fine where it is painted on the card").toBe(true);
  expect(verdicts.tealLabel, "teal's pill is comfortably readable").toBe(true);
});
