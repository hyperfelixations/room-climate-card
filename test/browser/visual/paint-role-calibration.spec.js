"use strict";

// The paint roles (src/domain/classification/paint-roles.js) held against a live card: where
// each palette colour lands and what is composited behind it, on that element, in that
// order, over that background. The unit guard (test/unit/domain/paint-roles.test.js) checks
// the alphas against the modules; only a real cascade checks the composition. Rationale:
// see internal dev doc §5 "Ermittlung des Kartenhintergrunds" and §5 "Tönungsanpassung von Pille, Icon und Chipmarke".
//
// It also renders the bracketing cases as a plate a person can look at — the separation
// factors were set by eye at 400px on a light theme. The plate is attached each run, not a
// golden.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj } = require("../../helpers/browser-helpers.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

const TEMP = TEMPERATURE_C;

// Three rooms — one below the comfort band, one inside, one above — the smallest scenario
// that paints every role at once.
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

  // Opaque colour only, and only from --primary-text-color: a translucent text colour is not
  // a surface the roles can composite onto, and no second source is consulted. Null is the
  // answer and the roles fall back to the card.
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

  // The tone colour as the card painted it, from `--tone-color` (not the pill's text): where
  // the palette colour needs adjustment to be read on a tint of itself the pill paints
  // `--tone-ink`, and measuring roles against that would test the adjusted colour.
  const tone = (
    await page.evaluate(
      (id) => document.getElementById(id).shadowRoot.querySelector(".rtc-root").style.getPropertyValue("--tone-color"),
      cardId
    )
  )
    .trim()
    .toUpperCase();
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

  // 4 — the roles, given the same surface, produce exactly those backgrounds: model and
  // paint agree.
  const modelled = await page.evaluate(
    async ([cardColour, textColour, toneColour]) => {
      const roles = await import("/src/domain/classification/paint-roles.js");
      const point = roles.pointOf(cardColour, textColour);
      const byId = (id) => roles.PAINT_ROLES.find((role) => role.id === id);
      // Through backgroundsFor(): the header icon shares the pill's measurement (`mirrors`
      // in paint-roles.js) and has no background function of its own.
      const backgroundOf = (id) => roles.backgroundsFor(byId(id), toneColour, point)[0];
      return {
        marker: backgroundOf("marker"),
        toneLabel: backgroundOf("toneLabel"),
        toneIcon: backgroundOf("toneIcon"),
        bandForeground: roles.foregroundFor(byId("toneBand"), toneColour, point),
      };
    },
    [card, surface.text, tone]
  );

  // 4a — the chip mark paints the adjustment the model computed: where a palette colour
  // would be swallowed by a tint of itself, one adjustment is worked out for the whole ramp
  // and applied to pill, icon and mark alike (domain/classification/tone-legibility.js).
  // Read off the live element: `--room-color` is the mark's ink, `--room-mark-bg` the tint
  // beneath it (an rgba of the palette colour, so the palette colour is recovered here).
  const painted = await page.evaluate((id) => {
    const chip = document.getElementById(id).shadowRoot.querySelector(".rtc-room-chip");
    for (const element of chip.querySelectorAll(".rtc-room-top *")) {
      const background = getComputedStyle(element).backgroundColor;
      if (background && background !== "rgba(0, 0, 0, 0)") {
        return {
          markBackground: background,
          roomColor: chip.style.getPropertyValue("--room-color").trim(),
          markTint: chip.style.getPropertyValue("--room-mark-bg").trim(),
        };
      }
    }
    return null;
  }, cardId);
  expect(painted, "a room chip paints a coloured mark").not.toBeNull();

  const paintedAlpha = Number(painted.markBackground.match(/rgba?\(([^)]+)\)/)[1].split(",")[3] ?? 1);
  const paletteColour = (() => {
    const [red, green, blue] = painted.markTint.match(/rgba?\(([^)]+)\)/)[1].split(",").map((part) => Number(part.trim()));
    return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  })();

  const recipe = await page.evaluate(
    async ([cardColour, textColour, colourOfTheStep]) => {
      const [roles, tone] = await Promise.all([
        import("/src/domain/classification/paint-roles.js"),
        import("/src/domain/classification/tone-legibility.js"),
      ]);
      const point = roles.pointOf(cardColour, textColour);
      const answer = tone.legibleTintRecipe(colourOfTheStep, point.card);
      return { ink: answer.ink, alpha: roles.TINT_ALPHAS.chipMark * answer.tintFactor };
    },
    [card, surface.text, paletteColour]
  );
  expect(painted.roomColor.toUpperCase()).toBe(recipe.ink.toUpperCase());
  // To two digits, because Chromium reports a composited alpha quantised to 1/255 — a value the
  // card wrote as 0.164 comes back as 0.165.
  expect(paintedAlpha).toBeCloseTo(recipe.alpha, 2);

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

// The cases the factors were bracketed against, in bracket order. Each is a real card built
// from the palette, not a swatch.
const BRACKET = [
  ["white", "toneBand", "no band at all — the failing side"],
  ["#AADDCC", "toneBand", "barely a tint — still the failing side"],
  ["#77EEDD", "toneBand", "plainly a band — the passing side"],
  ["pastel", "toneBand", "unmistakable"],
  ["lime", "toneLabel", "Optimal cannot be read, and the ramp can — the case this exists for"],
  ["gold", "toneLabel", "the same failure in a warmer hue"],
  ["teal", "toneLabel", "comfortably readable"],
];

test("the bracketing cards, rendered for a person to look at", async ({ page }, testInfo) => {
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

  // Regenerated each run, not compared against a stored copy.
  const plate = await page.locator("#stage").screenshot();
  await testInfo.attach("paint-role-calibration", { body: plate, contentType: "image/png" });

  // The verdicts the plate is checked against, so the run fails if verdicts and picture part.
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

// ---------------------------------------------- what the screen actually shows ----

// The question the model comparisons above cannot ask: can a person read it? Those read the
// custom property, not the rule that consumes it, so a pill could ship in the raw palette
// colour with a correct `--tone-ink` unused beside it. This test reads only what the browser
// resolved — the text colour and the backgrounds behind it composited to the first opaque
// one — and checks the role's own separation. The cases below are the reported ones and
// their brackets.

// Foreground and composited background, both from the browser. The walk upward stops at the
// first alpha-1 background (always `.rtc-card`). Only `background-color` is read, so the
// 135° overlay gradient is excluded — the same simplification the card's surface reading
// makes.
async function paintedAgainstItsBackground(page, cardId, selector) {
  return page.evaluate(
    ([id, sel]) => {
      const parse = (value) => {
        const match = String(value).match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const parts = match[1].split(",").map((part) => Number(part.trim()));
        return { channels: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
      };
      const hex = (channels) =>
        `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

      const element = typeof sel === "string" ? document.getElementById(id).shadowRoot.querySelector(sel) : sel;
      if (!element) return null;

      const layers = [];
      let node = element;
      while (node) {
        const background = parse(getComputedStyle(node).backgroundColor);
        if (background && background.alpha > 0) {
          layers.push(background);
          if (background.alpha >= 1) break;
        }
        node = node.parentElement || node.getRootNode().host || null;
      }
      if (!layers.length || layers[layers.length - 1].alpha < 1) return null;

      // Bottom upwards: each translucent layer composited onto what is already beneath it.
      let behind = layers[layers.length - 1].channels;
      for (let index = layers.length - 2; index >= 0; index -= 1) {
        const layer = layers[index];
        behind = behind.map((channel, axis) => layer.channels[axis] * layer.alpha + channel * (1 - layer.alpha));
      }

      const foreground = parse(getComputedStyle(element).color);
      return { foreground: hex(foreground.channels), background: hex(behind) };
    },
    [cardId, selector]
  );
}

// The chip mark has no class of its own: it is the one element under `.rtc-room-top` that
// paints a background.
const CHIP_MARK = ".rtc-room-chip .rtc-room-top";
async function chipMarkHandle(page, cardId) {
  return page.evaluateHandle(
    ([id, sel]) => {
      const top = document.getElementById(id).shadowRoot.querySelector(sel);
      for (const element of top.querySelectorAll("*")) {
        const background = getComputedStyle(element).backgroundColor;
        if (background && background !== "rgba(0, 0, 0, 0)") return element;
      }
      return null;
    },
    [cardId, CHIP_MARK]
  );
}

// Palette and scheme, and why each is here.
const LEGIBILITY_CASES = [
  ["yellow", "light", "the reported card: pure yellow on a 20% tint of pure yellow over white"],
  ["gold", "light", "the same trap one hue away"],
  ["yellow", "dark", "the hue that fails on white, on the background it does not fail on"],
  ["navy", "dark", "a dark colour on a dark card — the opposite corner"],
  ["pastel", "light", "a shipped palette, where nothing should have to move"],
  ["pastel", "dark", "the same, on the other surface"],
];

for (const [palette, scheme, why] of LEGIBILITY_CASES) {
  test(`palette: ${palette} on a ${scheme} card paints a pill, an icon and a chip mark that can be read — ${why}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await gotoHarness(page);
    const cardId = await createCard(page, CONFIG(palette), STATES);

    const places = {
      toneLabel: await paintedAgainstItsBackground(page, cardId, ".rtc-status-pill"),
      toneIcon: await paintedAgainstItsBackground(page, cardId, ".rtc-icon-badge ha-icon"),
      chipMark: await paintedAgainstItsBackground(page, cardId, await chipMarkHandle(page, cardId)),
    };

    for (const [roleId, painted] of Object.entries(places)) {
      expect(painted, `${roleId} paints something on a resolvable background`).not.toBeNull();

      const verdict = await page.evaluate(
        async ([role, foreground, background]) => {
          const [oklch, fit] = await Promise.all([
            import("/src/core/oklch.js"),
            import("/src/domain/classification/palette-fit.js"),
          ]);
          return {
            separation: oklch.screenDistance(foreground, background),
            required: fit.requiredSeparationOf(role),
          };
        },
        [roleId, painted.foreground, painted.background]
      );

      expect(
        verdict.separation,
        `${roleId}: ${painted.foreground} on ${painted.background} separates by ${verdict.separation.toFixed(
          3
        )}, and this role asks ${verdict.required.toFixed(3)}`
      ).toBeGreaterThanOrEqual(verdict.required);
    }
  });
}
