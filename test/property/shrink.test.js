"use strict";

// The shrinker, tested against predicates whose answer is known in advance.
//
// A shrinker is easy to get subtly wrong and hard to notice: it reports a smaller case, the
// smaller case fails, everything looks fine — and yet the reduction dropped the thing that
// caused the failure and landed on a different bug. That is exactly what the previous
// attempt did, and because nothing tested the shrinker, nothing said so.
//
// So the properties checked here are the two that make a shrunk case trustworthy: what
// comes back still satisfies the predicate, and what comes back is genuinely smaller.

const test = require("node:test");
const assert = require("node:assert/strict");

const { shrink, candidates, sizeOf } = require("./shrink.js");
const { generateDescription } = require("./generators.js");
const { SeededRandom } = require("../helpers/seeded-random.js");

const BIG = {
  metric: "temperature",
  language: "uk",
  primary: { state: 21, unit: { value: "°F" } },
  rooms: [
    { state: 1, name: "one" },
    { state: 2, name: "two" },
    { state: 999, name: "the culprit" },
    { state: 4, name: "four" },
    { state: 5, name: "five" },
  ],
  config: { palette: "vivid", subtitle: "clip", title: "Klima" },
};

// "Fails" whenever a room still reports 999 — a property that depends on exactly one room
// and on nothing else, so the correct minimum is known: one room, no configuration.
const dependsOnOneRoom = (description) => (description.rooms || []).some((room) => room.state === 999);

test("the shrunk case still satisfies the predicate", () => {
  const { description } = shrink(BIG, dependsOnOneRoom);
  assert.ok(dependsOnOneRoom(description), "the shrinker returned something that no longer fails");
});

test("the shrunk case is actually smaller, and reaches the real minimum", () => {
  const { description } = shrink(BIG, dependsOnOneRoom);
  const before = sizeOf(BIG);
  const after = sizeOf(description);
  assert.ok(after.json < before.json, `${after.json} is not smaller than ${before.json}`);
  assert.equal(after.rooms, 1, "everything except the one room that matters should be gone");
  assert.equal(after.configKeys, 0, "no configuration key mattered, so none should remain");
});

test("a predicate that depends on configuration keeps that configuration", () => {
  const needsPalette = (description) => description.config && description.config.palette === "vivid";
  const { description } = shrink(BIG, needsPalette);
  assert.equal(description.config.palette, "vivid", "the shrinker dropped the thing the failure needed");
  assert.equal(sizeOf(description).rooms, 0, "the rooms did not matter and should be gone");
});

test("a predicate that depends on a misspelled attribute keeps the misspelling", () => {
  const withTypo = {
    ...BIG,
    rooms: [{ state: 21, deviceClass: { key: "device_clas", value: "temperature" } }, { state: 22 }],
  };
  const needsTypo = (description) =>
    (description.rooms || []).some((room) => room.deviceClass && room.deviceClass.key === "device_clas");
  const { description } = shrink(withTypo, needsTypo);
  assert.ok(needsTypo(description));
  assert.equal(description.rooms.length, 1);
});

test("a predicate nothing satisfies leaves the case alone", () => {
  const { description, steps } = shrink(BIG, () => false);
  assert.deepEqual(description, BIG, "a case that cannot be reduced must come back unchanged");
  assert.ok(steps > 0, "the shrinker should still have tried");
});

test("shrinking is bounded, even against a predicate that always says yes", () => {
  // Always-true means every candidate is accepted, so the loop only stops when there is
  // nothing left to remove — or when the budget runs out. Either is fine; running forever
  // is not.
  const { description, steps } = shrink(BIG, () => true, { maxSteps: 40 });
  assert.ok(steps <= 40, `took ${steps} steps against a budget of 40`);
  assert.ok(sizeOf(description).json <= sizeOf(BIG).json);
});

test("a candidate the builder refuses is skipped rather than returned", () => {
  // The predicate throws for anything with rooms; the shrinker must not treat a thrown
  // predicate as "still fails" and hand back a case that cannot even be built.
  const explodes = (description) => {
    if ((description.rooms || []).length > 0) throw new Error("cannot evaluate");
    return true;
  };
  const { description } = shrink(BIG, explodes);
  assert.equal((description.rooms || []).length, 0);
});

test("every candidate is a valid description, for any generated case", () => {
  const rng = new SeededRandom(0x5417);
  for (let index = 0; index < 40; index++) {
    const original = generateDescription(rng.int(0, 0x7fffffff));
    for (const candidate of candidates(original)) {
      assert.equal(typeof candidate, "object");
      assert.ok(candidate !== original, "a candidate must be a copy, never the original");
      assert.doesNotThrow(() => JSON.parse(JSON.stringify(candidate)), "a candidate must be plain JSON");
    }
  }
});

test("shrinking never mutates the description it was given", () => {
  const snapshot = JSON.stringify(BIG);
  shrink(BIG, dependsOnOneRoom);
  assert.equal(JSON.stringify(BIG), snapshot);
});
