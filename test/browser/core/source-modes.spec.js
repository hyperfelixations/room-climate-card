"use strict";

// The four source topologies as a user meets them, in a real browser.
//
// The topology itself is resolved from configuration and tested purely elsewhere. What only a
// browser can show is the consequence: whether the headline is actually clickable, whether
// removing its label also removes the space the label occupied, and whether the room chips
// appear at all under each show_rooms policy.
//
// The last test is the one that earns the file - a mistyped room entity must not turn a
// one-room card into a two-room card, which is a layout question and looks fine in a model.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj, setCardWidth, updateHass, waitForStableLayout } = require("../../helpers/browser-helpers");

const TEMP = { device_class: "temperature", unit_of_measurement: "°C" };

test("one room without a primary is a clickable headline and follows the show_rooms policy", async ({ page }) => {
  await gotoHarness(page);
  const states = { "sensor.kitchen": mkStateObj("sensor.kitchen", 21, TEMP) };
  const cardId = await createCard(page, {
    rooms: [{
      entity: "sensor.kitchen",
      name: "Kitchen",
      short: "KI",
      tap_action: { action: "navigate", navigation_path: "/lovelace/kitchen" },
    }],
  }, states);

  const auto = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const root = el.shadowRoot;
    const headline = root.querySelector(".rtc-avg-button");
    return {
      label: headline.querySelector(".rtc-avg-label")?.textContent,
      tag: headline.tagName,
      entity: headline.getAttribute("data-entity"),
      roomIndex: headline.getAttribute("data-room-index"),
      grids: root.querySelectorAll(".rtc-room-grid").length,
      extremes: root.querySelectorAll(".rtc-extremes-view").length,
    };
  }, cardId);
  expect(auto).toEqual({
    label: "Kitchen",
    tag: "BUTTON",
    entity: "sensor.kitchen",
    roomIndex: "0",
    grids: 0,
    extremes: 0,
  });

  const action = await page.evaluate((id) => new Promise((resolve) => {
    const el = document.getElementById(id);
    el.addEventListener("hass-action", (event) => resolve(event.detail), { once: true });
    el.shadowRoot.querySelector(".rtc-avg-button").click();
  }), cardId);
  expect(action.action).toBe("tap");
  expect(action.config.tap_action.navigation_path).toBe("/lovelace/kitchen");

  await page.evaluate((id) => {
    const el = document.getElementById(id);
    el.setConfig({ rooms: [{ entity: "sensor.kitchen", name: "Kitchen", short: "KI" }], show_rooms: true });
  }, cardId);
  expect(await page.locator(`#${cardId}`).evaluate((el) => el.shadowRoot.querySelectorAll(".rtc-room-chip").length)).toBe(1);
  expect(await page.locator(`#${cardId}`).evaluate((el) => el.shadowRoot.querySelectorAll(".rtc-room-grid").length)).toBe(1);
});

test("two rooms without a primary produce a calculated non-clickable consensus", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, {
    rooms: [
      { entity: "sensor.a", name: "A" },
      { entity: "sensor.b", name: "B" },
    ],
  }, {
    "sensor.a": mkStateObj("sensor.a", 20, TEMP),
    "sensor.b": mkStateObj("sensor.b", 24, TEMP),
  });

  const result = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const headline = el.shadowRoot.querySelector(".rtc-avg-button");
    const model = el._computeViewModel();
    return {
      tag: headline.tagName,
      entity: headline.getAttribute("data-entity"),
      roomIndex: headline.getAttribute("data-room-index"),
      source: model.average.source,
      value: model.average.value,
      label: model.average.label,
      chips: el.shadowRoot.querySelectorAll(".rtc-room-chip").length,
    };
  }, cardId);
  expect(result).toEqual({
    tag: "DIV",
    entity: null,
    roomIndex: null,
    source: "calculated",
    value: 22,
    label: "Home avg.",
    chips: 2,
  });
});

test("removing the headline label also removes its vertical spacing", async ({ page }) => {
  await gotoHarness(page);
  const states = { "sensor.primary": mkStateObj("sensor.primary", 22, TEMP) };
  const noLabelId = await createCard(page, { entity: "sensor.primary" }, states);
  const withLabelId = await createCard(page, { entity: "sensor.primary", entity_label: "Current" }, states);

  const metrics = await page.evaluate(({ noLabelId, withLabelId }) => {
    function read(id) {
      const root = document.getElementById(id).shadowRoot;
      const headline = root.querySelector(".rtc-avg-button");
      const value = root.querySelector(".rtc-avg-value");
      const label = root.querySelector(".rtc-avg-label");
      return {
        hasLabel: Boolean(label),
        marginTop: getComputedStyle(value).marginTop,
        valueOffset: value.getBoundingClientRect().top - headline.getBoundingClientRect().top,
      };
    }
    return { noLabel: read(noLabelId), withLabel: read(withLabelId) };
  }, { noLabelId, withLabelId });

  expect(metrics.noLabel.hasLabel).toBe(false);
  expect(metrics.noLabel.marginTop).toBe("0px");
  expect(Math.abs(metrics.noLabel.valueOffset)).toBeLessThanOrEqual(1);
  expect(metrics.withLabel.hasLabel).toBe(true);
  expect(metrics.withLabel.marginTop).toBe("4px");
  expect(metrics.withLabel.valueOffset).toBeGreaterThan(metrics.noLabel.valueOffset + 4);
});

// Reported against 2.38.0 from a live Home Assistant: a card configured with one real
// room and one mistyped one drew a room chip and captioned itself "Home avg." — it had
// counted the id Home Assistant does not know as a second source. Home Assistant keeps
// REGISTERED entities in the state machine even while their integration is unloaded,
// publishing them as `unavailable`; an id that is absent from hass.states is absent
// because it is wrong. So this is a one-room card, and it has to look like one.
test("a mistyped room does not turn a one-room card into a two-room card", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(
    page,
    {
      rooms: [
        { name: "Arbeitszimmer", short: "AZ", entity: "sensor.az_temperatur" },
        { name: "Bedroom", short: "BE", entity: "sensor.bedroom_temperature" },
      ],
    },
    { "sensor.az_temperatur": mkStateObj("sensor.az_temperatur", 28.7, { device_class: "temperature", unit_of_measurement: "°C" }) }
  );
  const card = page.locator(`#${cardId}`);

  // The single-room contract, in full: no chip repeating the headline, the room's own
  // name as the caption, and the room's entity on the big value so its tap and hold
  // actions apply.
  await expect(card.locator(".rtc-room-chip")).toHaveCount(0);
  await expect(card.locator(".rtc-room-grid")).toHaveCount(0);
  await expect(card.locator(".rtc-avg-label")).toHaveText("Arbeitszimmer");
  const headline = card.locator(".rtc-avg-button");
  await expect(headline).toHaveAttribute("data-entity", "sensor.az_temperatur");
  await expect(headline).toHaveAttribute("data-room-index", "0");
  expect(await headline.evaluate((node) => node.tagName)).toBe("BUTTON");

  // The typo is still reported — hidden from the layout is not hidden from the user.
  await expect(card.locator(".rtc-subtitle")).toContainText("not found");

  // And the counter-case, in the same browser: an entity that EXISTS but is
  // unavailable keeps the two-room card it was configured as, with its `--` chip.
  const bothId = await createCard(
    page,
    {
      rooms: [
        { name: "Arbeitszimmer", short: "AZ", entity: "sensor.az_temperatur" },
        { name: "Bad", short: "BA", entity: "sensor.ba_temperatur" },
      ],
    },
    {
      "sensor.az_temperatur": mkStateObj("sensor.az_temperatur", 28.8, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.ba_temperatur": mkStateObj("sensor.ba_temperatur", "unavailable", { device_class: "temperature", unit_of_measurement: "°C" }),
    }
  );
  const both = page.locator(`#${bothId}`);
  await expect(both.locator(".rtc-room-chip")).toHaveCount(2);
  await expect(both.locator(".rtc-avg-label")).toHaveText("Home avg.");
  await expect(both.locator('[data-entity="sensor.ba_temperatur"] .rtc-room-value-num')).toHaveText("--");
});

// The headline has two element types on purpose — a <button> when the value belongs to
// one identifiable entity, a <div> when it is a consensus nothing can be attributed to
// (see the two tests above). What they must NOT differ in is where they put the number.
//
// Until this was pinned, they did: the button reset in styles/average.js overrode
// appearance, font, colour, border, margin and text-align but not padding, so Chrome's
// UA `padding: 1px 6px` reached the button shape and nothing reached the div shape. The
// number sat 6px further right and the shell 2px taller in exactly the cards that have a
// main entity — and the card jumped between the two whenever that entity dropped out.
//
// Measured against the SHARED class, not the tag: that is the whole point of the fix.
test.describe("both headline shapes occupy the same box", () => {
  const CONSENSUS_ROOMS = [
    { entity: "sensor.a", name: "A" },
    { entity: "sensor.b", name: "B" },
  ];
  // One value, so any geometric difference is the shape's doing and nothing else's.
  const sameValueStates = (withPrimary) => {
    const states = {
      "sensor.a": mkStateObj("sensor.a", 22.2, TEMP),
      "sensor.b": mkStateObj("sensor.b", 22.2, TEMP),
    };
    if (withPrimary) states["sensor.primary"] = mkStateObj("sensor.primary", 22.2, TEMP);
    return states;
  };

  async function headlineGeometry(page, cardId) {
    return page.evaluate((id) => {
      const root = document.getElementById(id).shadowRoot;
      const shell = root.querySelector(".rtc-avg-button");
      const num = root.querySelector(".rtc-avg-value-num");
      const computed = getComputedStyle(shell);
      const shellRect = shell.getBoundingClientRect();
      const panelRect = root.querySelector(".rtc-main-panel").getBoundingClientRect();
      return {
        tag: shell.tagName,
        padding: `${computed.paddingTop} ${computed.paddingRight} ${computed.paddingBottom} ${computed.paddingLeft}`,
        // Relative to the panel: two cards sit at different page offsets, one card
        // measured before and after a state change does not.
        numLeft: Math.round((num.getBoundingClientRect().left - panelRect.left) * 100) / 100,
        shellHeight: Math.round(shellRect.height * 100) / 100,
      };
    }, cardId);
  }

  test("a main entity and a calculated consensus indent the number identically", async ({ page }) => {
    await gotoHarness(page);
    const withPrimary = await createCard(page, { entity: "sensor.primary", rooms: CONSENSUS_ROOMS }, sameValueStates(true));
    const withoutPrimary = await createCard(page, { rooms: CONSENSUS_ROOMS }, sameValueStates(false));
    await setCardWidth(page, withPrimary, 520);
    await setCardWidth(page, withoutPrimary, 520);

    const button = await headlineGeometry(page, withPrimary);
    const div = await headlineGeometry(page, withoutPrimary);

    expect(button.tag, "the attributable headline must stay a real button").toBe("BUTTON");
    expect(div.tag, "the consensus headline must stay a plain div").toBe("DIV");
    expect(div.padding, "both shapes share .rtc-avg-button, so both must carry its padding").toBe(button.padding);
    expect(div.numLeft, "the number must start at the same place in both shapes").toBeCloseTo(button.numLeft, 1);
    expect(div.shellHeight, "the shell must be the same height in both shapes").toBeCloseTo(button.shellHeight, 1);
  });

  test("the headline does not move when the main entity drops out and returns", async ({ page }) => {
    await gotoHarness(page);
    const available = sameValueStates(true);
    const outage = { ...available, "sensor.primary": mkStateObj("sensor.primary", "unavailable", TEMP) };
    const cardId = await createCard(page, { entity: "sensor.primary", rooms: CONSENSUS_ROOMS }, available);
    await setCardWidth(page, cardId, 520);
    const before = await headlineGeometry(page, cardId);

    await updateHass(page, cardId, outage);
    await waitForStableLayout(page, cardId, 520);
    const during = await headlineGeometry(page, cardId);

    await updateHass(page, cardId, available);
    await waitForStableLayout(page, cardId, 520);
    const after = await headlineGeometry(page, cardId);

    expect(during.tag, "the outage must genuinely flip the shape, or this test proves nothing").toBe("DIV");
    expect(after.tag).toBe("BUTTON");
    expect(during.numLeft, "the number must not jump sideways when the sensor drops out").toBeCloseTo(before.numLeft, 1);
    expect(after.numLeft, "nor when it comes back").toBeCloseTo(before.numLeft, 1);
    expect(during.shellHeight, "nor may the shell change height").toBeCloseTo(before.shellHeight, 1);
    expect(after.shellHeight).toBeCloseTo(before.shellHeight, 1);
  });

  // The indentation has to come from the project's own stylesheet. As long as it came
  // from the browser, the card looked different in browsers whose UA button padding
  // differs from Chrome's — and the div shape had none at all.
  test("the indentation is owned by .rtc-avg-button, not by the browser's button default", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(page, { entity: "sensor.primary" }, { "sensor.primary": mkStateObj("sensor.primary", 22.2, TEMP) });
    const measured = await page.evaluate((id) => {
      const root = document.getElementById(id).shadowRoot;
      const probe = document.createElement("button");
      // A button carrying none of the card's classes: whatever padding it reports is
      // what the reset rule leaves behind for any future button in this shadow root.
      root.querySelector(".rtc-root").appendChild(probe);
      const reset = getComputedStyle(probe).paddingLeft;
      probe.remove();
      const headline = getComputedStyle(root.querySelector(".rtc-avg-button"));
      return { reset, headlineLeft: headline.paddingLeft, headlineTop: headline.paddingTop };
    }, cardId);
    expect(measured.reset, "the button reset must neutralize the UA padding").toBe("0px");
    expect(measured.headlineLeft, "the headline's own indentation is a project decision").toBe("6px");
    expect(measured.headlineTop).toBe("1px");
  });
});
