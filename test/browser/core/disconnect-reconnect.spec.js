"use strict";

// Disconnect and reconnect with real pointer events, a real compositor and a real
// document move.
//
// The jsdom layer proves the contract by calling the handlers; this proves it end to
// end. It also covers the one thing jsdom cannot express at all: adoptNode into a second
// document, where the card carries its runtimes with it but every capability — timers,
// animation frames, the fonts promise — belongs to the new realm.
//
// A detached element cannot be found by id any more, so each test parks a reference on
// `window.__card` first. Every test listens for `pageerror`: the failure this file
// guards against is silent — the card simply stops updating.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, updateHass, mkStateObj } = require("../../helpers/browser-helpers");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

function threeViewStates(average = 22) {
  return {
    "sensor.avg": mkStateObj("sensor.avg", average, TEMPERATURE_C),
    "sensor.range": mkStateObj("sensor.range", 3, { unit_of_measurement: "°C", minimum: 20, maximum: 23 }),
    "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
  };
}

async function setUpCard(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await gotoHarness(page);
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
      auto_slide: true,
    },
    threeViewStates()
  );
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    el.style.width = "400px";
    // Kept so the tests can reach the element once it is detached.
    window.__card = el;
  }, cardId);
  await page.waitForTimeout(100);
  return { cardId, card: page.locator(`#${cardId}`), errors };
}

// Starts a drag and leaves the button held, so the gesture is genuinely in flight.
async function startDrag(page, box) {
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(startX - i * 20, startY, { steps: 1 });
    await page.waitForTimeout(10);
  }
}

test("a card removed mid-drag and reinserted keeps updating", async ({ page }) => {
  const { card, errors } = await setUpCard(page);
  const box = await card.locator(".rtc-rotator").boundingBox();

  await startDrag(page, box);
  expect(await card.evaluate((el) => el._isDragging)).toBe(true);

  // Home Assistant reflows the dashboard: the same element leaves the document.
  const afterRemove = await page.evaluate(() => {
    window.__card.remove();
    return { pointer: window.__card._interaction.pointer, dragging: window.__card._interaction.isDragging };
  });
  expect(afterRemove.pointer, "no gesture may outlive the removal").toBeNull();
  expect(afterRemove.dragging).toBe(false);

  // The pointerup now lands on a detached card and must be a harmless no-op.
  await page.mouse.up();
  await page.evaluate(() => document.getElementById("stage").appendChild(window.__card));

  await page.evaluate((states) => {
    window.__card.hass = { language: "en", locale: { language: "en" }, states, callService: () => {} };
  }, threeViewStates(27));
  await page.waitForTimeout(200);

  expect(errors, `unexpected page errors: ${errors.join(" | ")}`).toEqual([]);
  const shown = await page.evaluate(() => window.__card.shadowRoot.querySelector(".rtc-avg-value-num").textContent);
  expect(shown).toContain("27");
});

test("an update received during a real drag is on screen after a real reconnect, with no further update", async ({ page }) => {
  // The same contract as the jsdom layer, with a genuine pointer gesture and a genuine
  // document removal. Nothing is pushed into the card after the reconnect and no private
  // render entry point is called: what Home Assistant already handed over must simply be
  // visible again.
  const { card, errors } = await setUpCard(page);
  const box = await card.locator(".rtc-rotator").boundingBox();
  expect(await card.locator(".rtc-avg-value-num").innerText()).toContain("22");

  await startDrag(page, box);
  expect(await card.evaluate((el) => el._isDragging)).toBe(true);

  // Home Assistant pushes a new state while the finger is still down.
  await page.evaluate((states) => {
    window.__card.hass = { language: "en", locale: { language: "en" }, states, callService: () => {} };
  }, threeViewStates(30));
  expect(
    await page.evaluate(() => window.__card.shadowRoot.querySelector(".rtc-avg-value-num").textContent),
    "the update is deliberately deferred while the track is being dragged"
  ).toContain("22");

  // The dashboard reflows the card away before the finger is lifted.
  await page.evaluate(() => window.__card.remove());
  await page.mouse.up(); // lands on a detached card: a harmless no-op
  await page.evaluate(() => document.getElementById("stage").appendChild(window.__card));

  const shown = await page.evaluate(() => window.__card.shadowRoot.querySelector(".rtc-avg-value-num").textContent);
  expect(shown, "the value received before the removal must be visible again").toContain("30");
  expect(errors, `unexpected page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("after catching up on reconnect, auto-slide and the accessibility sync run again", async ({ page }) => {
  const { card, errors } = await setUpCard(page);
  const box = await card.locator(".rtc-rotator").boundingBox();

  await startDrag(page, box);
  await page.evaluate((states) => {
    window.__card.hass = { language: "en", locale: { language: "en" }, states, callService: () => {} };
  }, threeViewStates(30));
  await page.evaluate(() => window.__card.remove());
  await page.mouse.up();
  await page.evaluate(() => document.getElementById("stage").appendChild(window.__card));

  // The catch-up render can rebuild the whole shadow DOM. Whatever it did, the card must
  // end up animating again and keeping its accessibility state in step with the track.
  expect(await page.evaluate(() => window.__card.shadowRoot.querySelector(".rtc-avg-value-num").textContent)).toContain("30");
  expect(
    await page.evaluate(() => window.__card._carousel.accessibilityTimerHandle !== null),
    "the accessibility sync is armed again"
  ).toBe(true);

  // Exactly one view is reachable at any moment, and it is the one the model says.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const views = Array.from(window.__card.shadowRoot.querySelectorAll(".rtc-view"));
          return views.filter((view) => !view.hasAttribute("inert")).length;
        }),
      { message: "exactly one view stays outside inert" }
    )
    .toBe(1);
  expect(
    await page.evaluate(() => {
      const views = Array.from(window.__card.shadowRoot.querySelectorAll(".rtc-view"));
      return views.findIndex((view) => !view.hasAttribute("inert")) === window.__card._carousel.currentVisualIndex();
    })
  ).toBe(true);
  expect(errors, `unexpected page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("a card removed after a completed swipe leaves no timer behind and re-engages on reconnect", async ({ page }) => {
  const { card, errors } = await setUpCard(page);
  const box = await card.locator(".rtc-rotator").boundingBox();

  await startDrag(page, box);
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await card.evaluate((el) => el._carousel.resumeTimerHandle !== null)).toBe(true);

  const afterDisconnect = await page.evaluate(() => {
    window.__card.remove();
    return {
      resume: window.__card._carousel.resumeTimerHandle,
      a11y: window.__card._carousel.accessibilityTimerHandle,
      pointer: window.__card._interaction.pointer,
      dragging: window.__card._interaction.isDragging,
    };
  });
  expect(afterDisconnect.resume).toBeNull();
  expect(afterDisconnect.a11y).toBeNull();
  expect(afterDisconnect.pointer).toBeNull();
  expect(afterDisconnect.dragging).toBe(false);

  const reEngaged = await page.evaluate(() => {
    document.getElementById("stage").appendChild(window.__card);
    return window.__card._carousel.accessibilityTimerHandle !== null;
  });
  expect(reEngaged, "the reconnected card re-engages the synchronized animation").toBe(true);
  expect(errors, `unexpected page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("a card adopted into a second document keeps working and carries no gesture across", async ({ page }) => {
  const { errors } = await setUpCard(page);

  const result = await page.evaluate(() => {
    const el = window.__card;
    el.remove();

    // A genuine realm change: a second document, and adoptNode rather than a move.
    const other = document.implementation.createHTMLDocument("second");
    const adopted = other.adoptNode(el);
    other.body.appendChild(adopted);

    return {
      ownerChanged: adopted.ownerDocument !== document,
      pointer: adopted._interaction.pointer,
      dragging: adopted._interaction.isDragging,
      rendered: Boolean(adopted.shadowRoot.querySelector(".rtc-root")),
      // The platform resolves late, so the adapter must now report the NEW document.
      realmFollowed: adopted._platform.isDocumentHidden() === other.hidden,
    };
  });

  expect(result.ownerChanged).toBe(true);
  expect(result.pointer).toBeNull();
  expect(result.dragging).toBe(false);
  expect(result.rendered).toBe(true);
  expect(result.realmFollowed).toBe(true);
  expect(errors, `unexpected page errors: ${errors.join(" | ")}`).toEqual([]);
});
