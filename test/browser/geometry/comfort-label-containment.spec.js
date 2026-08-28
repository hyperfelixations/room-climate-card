"use strict";

// The comfort label sits above the bar, centred on the comfort band's own centre. Until
// this was pinned, nothing stopped it there: a band pushed towards one end of the axis
// carried its label past the view's edge, where a solo view clipped it against the
// rotator and a carousel painted it straight across the slide next door. All four
// metrics reach that state with ordinary readings — CO2 from about 1200 ppm, PM2.5 from
// about 24 µg/m³, and temperature at both ends (35 °C leaves on the left, 5 °C on the
// right).

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers");

const CO2 = { device_class: "carbon_dioxide", unit_of_measurement: "ppm" };

// The container queries are what make the narrow widths meaningful here, and they need a
// block-level ha-card to apply to at all (see the same note in
// narrow-width-overflow.spec.js). Installed per test rather than in a beforeEach, so the
// rest of this file keeps measuring exactly what it measured before.
test.describe(".rtc-scale-comfort-label stays inside its own view", () => {
  async function gotoHarnessWithBlockCard(page) {
    await page.addInitScript(() => {
      if (!customElements.get("ha-card")) {
        customElements.define("ha-card", class extends HTMLElement {
          connectedCallback() {
            this.style.display = "block";
          }
        });
      }
    });
    await gotoHarness(page);
  }

  const OVERFLOW_CASES = [
    ["co2", "carbon_dioxide", "ppm", 2252, "left"],
    ["co2", "carbon_dioxide", "ppm", 5000, "left"],
    ["pm25", "pm25", "µg/m³", 118.4, "left"],
    ["temperature", "temperature", "°C", 35, "left"],
    ["temperature", "temperature", "°C", 5, "right"],
    ["humidity", "humidity", "%", 5, "right"],
    // The control: a comfort band in the middle of the axis, which never needed
    // clamping and must not be moved by it either.
    ["temperature", "temperature", "°C", 22, "neither"],
  ];

  function scaleOnlyCard(page, value, deviceClass, unit) {
    const attributes = { device_class: deviceClass, unit_of_measurement: unit };
    return createCard(
      page,
      { entity: "sensor.avg", auto_slide: false, views: [{ type: "scale" }] },
      { "sensor.avg": mkStateObj("sensor.avg", value, attributes) },
      // German has the longest comfort label of the languages sharing this layout, so
      // the assertion is made against the hardest realistic text.
      "de"
    );
  }

  // Measured against the comfort ROW, which is the label's own containing block and,
  // being a grid item of the same single-column .rtc-scale-view, exactly as wide as the
  // bar its percentage refers to.
  async function comfortLabelBox(page, cardId) {
    return page.evaluate((cardId) => {
      const view = document.getElementById(cardId).shadowRoot.querySelector(".rtc-scale-view");
      const label = view.querySelector(".rtc-scale-comfort-label");
      const row = view.querySelector(".rtc-scale-comfort-row");
      const bar = view.querySelector(".rtc-scale-bar");
      const labelRect = label.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return {
        hidden: label.hidden,
        overLeftEdge: rowRect.left - labelRect.left,
        overRightEdge: labelRect.right - rowRect.right,
        centre: labelRect.left + labelRect.width / 2 - rowRect.left,
        rowWidth: rowRect.width,
        barWidth: bar.getBoundingClientRect().width,
      };
    }, cardId);
  }

  for (const [mode, deviceClass, unit, value, escapes] of OVERFLOW_CASES) {
    test(`${mode} ${value} ${unit} keeps its comfort label inside the row (escapes ${escapes} today)`, async ({ page }) => {
      await gotoHarnessWithBlockCard(page);
      const cardId = await scaleOnlyCard(page, value, deviceClass, unit);
      for (const width of [320, 400, 520, 700]) {
        await setCardWidth(page, cardId, width);
        const measured = await comfortLabelBox(page, cardId);
        if (measured.hidden) continue;
        expect(
          measured.overLeftEdge,
          `${mode} ${value} ${unit} at ${width}px reaches ${measured.overLeftEdge.toFixed(1)}px past the left edge`
        ).toBeLessThanOrEqual(0.5);
        expect(
          measured.overRightEdge,
          `${mode} ${value} ${unit} at ${width}px reaches ${measured.overRightEdge.toFixed(1)}px past the right edge`
        ).toBeLessThanOrEqual(0.5);
      }
    });
  }

  // The clamp mixes two boxes: the percentage is a position on the AXIS, the containment
  // is against the ROW. They are the same width because both are items of the same
  // single-column grid — stated here so a future change to that grid fails loudly
  // instead of quietly displacing every comfort label by the difference.
  test("the comfort row and the scale bar are exactly as wide as each other", async ({ page }) => {
    await gotoHarnessWithBlockCard(page);
    const cardId = await scaleOnlyCard(page, 22, "temperature", "°C");
    for (const width of [320, 520]) {
      await setCardWidth(page, cardId, width);
      const measured = await comfortLabelBox(page, cardId);
      expect(measured.rowWidth, `at ${width}px the label's containing block must match the bar`).toBeCloseTo(measured.barWidth, 1);
    }
  });

  // A clamp that also moved the labels which were never in trouble would be a regression
  // dressed as a fix.
  test("a comfort band in the middle of the axis keeps its label over the band's centre", async ({ page }) => {
    await gotoHarnessWithBlockCard(page);
    const cardId = await scaleOnlyCard(page, 22, "temperature", "°C");
    for (const width of [400, 520, 700]) {
      await setCardWidth(page, cardId, width);
      const measured = await comfortLabelBox(page, cardId);
      const bandCentre = await page.evaluate((cardId) => {
        const view = document.getElementById(cardId).shadowRoot.querySelector(".rtc-scale-view");
        const band = view.querySelector(".rtc-comfort-band");
        const row = view.querySelector(".rtc-scale-comfort-row");
        const bandRect = band.getBoundingClientRect();
        return bandRect.left + bandRect.width / 2 - row.getBoundingClientRect().left;
      }, cardId);
      expect(measured.centre, `at ${width}px the label must stay centred on its band`).toBeCloseTo(bandCentre, 0);
    }
  });

  // Before the clamp and long before the ellipsis, the label may swap to its own short
  // form — the same intermediate step the optimal label takes, because a real word beats
  // a truncated one whenever a real word fits.
  //
  // Every one of the fifteen languages currently declares a short form identical to its
  // long one, so nothing in the shipped card exercises this. Substituting a genuinely
  // shorter pair on the live content model is therefore the only way to tell "the short
  // form is chosen when it has to be" apart from "the key is still never read".
  test("a comfort label that does not fit falls back to its short form before being clamped", async ({ page }) => {
    await gotoHarnessWithBlockCard(page);
    const cardId = await scaleOnlyCard(page, 22, "temperature", "°C");
    await setCardWidth(page, cardId, 320);
    const measured = await page.evaluate((cardId) => {
      const card = document.getElementById(cardId);
      const view = card.shadowRoot.querySelector(".rtc-scale-view");
      const label = view.querySelector(".rtc-scale-comfort-label");
      const row = view.querySelector(".rtc-scale-comfort-row");
      const model = card._renderController.lastViewModel;
      const content = model.views.byKey.scale;
      const read = () => {
        card._resolveViewLayouts(model);
        const labelRect = label.getBoundingClientRect();
        return {
          text: label.textContent,
          overLeftEdge: row.getBoundingClientRect().left - labelRect.left,
          clipped: label.scrollWidth > label.clientWidth + 0.5,
        };
      };
      // A long form far too wide for the row, and a short form that fits it comfortably.
      content.comfortLabel.long = "Ein sehr langer Komfortbereich der hier niemals hineinpasst";
      content.comfortLabel.short = "20–24°C Komf.";
      const shortened = read();
      // And the other direction: a long form that fits must not be shortened.
      content.comfortLabel.long = "20–24°C Komfort";
      const kept = read();
      return { shortened, kept };
    }, cardId);
    expect(measured.shortened.text, "the short form has to be chosen when the long one cannot fit").toBe("20–24°C Komf.");
    expect(measured.shortened.clipped, "and it must fit without being truncated on top of that").toBe(false);
    expect(measured.shortened.overLeftEdge, "the shortened label still has to be inside the row").toBeLessThanOrEqual(0.5);
    expect(measured.kept.text, "a long form that fits must not be shortened").toBe("20–24°C Komfort");
  });

  // The last resort, below which there is nothing left to move: a row narrower than the
  // label itself. Clipping with an ellipsis is the answer every other single-line label
  // on this card gives.
  test("a label wider than the whole row truncates instead of leaving it", async ({ page }) => {
    await gotoHarnessWithBlockCard(page);
    const cardId = await scaleOnlyCard(page, 22, "temperature", "°C");
    await setCardWidth(page, cardId, 320);
    const measured = await page.evaluate((cardId) => {
      const card = document.getElementById(cardId);
      const view = card.shadowRoot.querySelector(".rtc-scale-view");
      const label = view.querySelector(".rtc-scale-comfort-label");
      const row = view.querySelector(".rtc-scale-comfort-row");
      // Substituted on the content model rather than on the node: the layout pass owns
      // the text and would overwrite anything written straight into the DOM. BOTH forms
      // are overlong, so this is the case where there is nothing left to fall back to.
      const model = card._renderController.lastViewModel;
      const overlong = "Ein garantiert viel zu langer Komfortbereich der niemals in diese Zeile passt";
      model.views.byKey.scale.comfortLabel.long = overlong;
      model.views.byKey.scale.comfortLabel.short = overlong;
      // The layout pass runs on render, on resize and on fonts.ready; a change made from
      // a test is none of those, so it is invoked the way the card would invoke it.
      card._resolveViewLayouts(model);
      const labelRect = label.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const style = getComputedStyle(label);
      return {
        overLeftEdge: rowRect.left - labelRect.left,
        overRightEdge: labelRect.right - rowRect.right,
        clipped: label.scrollWidth > label.clientWidth + 0.5,
        overflow: style.overflowX,
        textOverflow: style.textOverflow,
      };
    }, cardId);
    expect(measured.overflow, "the label must clip its own overflow").toBe("hidden");
    expect(measured.textOverflow, "a clipped label must end in an ellipsis").toBe("ellipsis");
    expect(measured.clipped, "this text must genuinely be too long, or the test proves nothing").toBe(true);
    expect(measured.overLeftEdge, "even the truncated label must not leave the row").toBeLessThanOrEqual(0.5);
    expect(measured.overRightEdge).toBeLessThanOrEqual(0.5);
  });

  // The failure a user actually sees: nothing clips an individual carousel slide, so a
  // label that leaves its own view is painted over the one beside it.
  test("in a carousel the comfort label never reaches into the neighbouring view", async ({ page }) => {
    await gotoHarnessWithBlockCard(page);
    const attributes = CO2;
    const cardId = await createCard(
      page,
      {
        entity: "sensor.avg",
        range_entity: "sensor.range",
        auto_slide: false,
        views: [{ type: "range_scale", enabled: true }, { type: "scale" }],
      },
      {
        "sensor.avg": mkStateObj("sensor.avg", 2252, attributes),
        "sensor.range": mkStateObj("sensor.range", 900, { unit_of_measurement: "ppm", minimum: 1800, maximum: 2700 }),
      },
      "de"
    );
    for (const width of [320, 400, 520]) {
      await setCardWidth(page, cardId, width);
      const leftOfOwnView = await page.evaluate((cardId) => {
        const root = document.getElementById(cardId).shadowRoot;
        const scaleView = root.querySelector(".rtc-scale-view");
        const label = scaleView.querySelector(".rtc-scale-comfort-label").getBoundingClientRect();
        return scaleView.getBoundingClientRect().left - label.left;
      }, cardId);
      expect(
        leftOfOwnView,
        `at ${width}px the label reaches ${leftOfOwnView.toFixed(1)}px past its own view and into the slide beside it`
      ).toBeLessThanOrEqual(0.5);
    }
  });
});
