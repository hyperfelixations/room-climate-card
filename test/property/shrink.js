"use strict";

// STRUCTURAL SHRINKING.
//
// The previous attempt at this re-ran the generator with a smaller room count and hoped
// the result would be the same case. It never was: changing the room count changes how
// much of the random stream the rooms consume, so every draw after it comes out different.
// What came back was not a minimised counterexample but an unrelated card that happened to
// also fail — or, more often, one that did not, and the shrinker reported no reduction.
//
// This one never touches the generator. It takes the DESCRIPTION of a failing case and
// reduces the description: drop rooms, drop configuration, pull an entity back to an
// ordinary one, and after each edit ask whether it still fails. That is deterministic by
// construction, and the answer is a description — which is JSON, which is a fixture.
//
// Greedy and one-directional: a candidate is kept only if it still fails, so the result is
// always a real counterexample, never a guess.

const { describeScenario } = require("../fixtures/scenario.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Every one-step reduction of a description, roughly largest first. Order matters only for
// speed: dropping ten rooms in one step is worth trying before normalising one attribute.
function* candidates(description) {
  const rooms = description.rooms || [];

  // --- rooms, in bulk then one at a time -----------------------------------------
  if (rooms.length > 0) {
    const withoutRooms = clone(description);
    withoutRooms.rooms = [];
    yield withoutRooms;
  }
  if (rooms.length > 1) {
    const half = clone(description);
    half.rooms = rooms.slice(0, Math.floor(rooms.length / 2));
    yield half;
  }
  for (let index = 0; index < rooms.length; index++) {
    const dropped = clone(description);
    dropped.rooms = rooms.filter((_, other) => other !== index);
    yield dropped;
  }

  // --- configuration, in bulk then key by key ------------------------------------
  const configKeys = Object.keys(description.config || {});
  if (configKeys.length > 0) {
    const bare = clone(description);
    bare.config = {};
    yield bare;
    for (const key of configKeys) {
      const without = clone(description);
      delete without.config[key];
      yield without;
    }
  }

  // --- the primary entity ---------------------------------------------------------
  if (description.primary) {
    if (rooms.length > 0) {
      const noPrimary = clone(description);
      noPrimary.primary = null;
      yield noPrimary;
    }
    yield* entityReductions(description, "primary");
  }

  // --- each room's entity ----------------------------------------------------------
  for (let index = 0; index < rooms.length; index++) {
    yield* entityReductions(description, index);
  }

  // --- everything else -------------------------------------------------------------
  if (description.language !== "en") {
    const english = clone(description);
    english.language = "en";
    yield english;
  }
}

// One entity, made more ordinary one property at a time. `where` is "primary" or a room
// index. Each reduction is a separate candidate so the shrinker can tell WHICH property
// the failure needs.
function* entityReductions(description, where) {
  const read = (d) => (where === "primary" ? d.primary : d.rooms[where]);
  const entity = read(description);
  if (!entity) return;

  // A name only ever matters for markup, so try removing it before anything semantic.
  if (entity.name !== undefined) {
    const next = clone(description);
    delete read(next).name;
    yield next;
  }
  if (entity.present === false) {
    const next = clone(description);
    delete read(next).present;
    yield next;
  }
  // Attributes: back to the metric's canonical spelling, then gone entirely. Both
  // directions are reductions — "no unit" is simpler than "a strange unit", and "the right
  // unit" is simpler still.
  for (const attribute of ["unit", "deviceClass"]) {
    if (entity[attribute] !== undefined) {
      const canonical = clone(description);
      delete read(canonical)[attribute];
      yield canonical;
    }
    if (entity[attribute] !== null) {
      const absent = clone(description);
      read(absent)[attribute] = null;
      yield absent;
    }
  }
  if (entity.state !== undefined) {
    const typical = clone(description);
    delete read(typical).state;
    yield typical;
  }
}

// Reduces `description` for as long as `stillFails(description)` keeps saying yes.
//
// `stillFails` must be a pure-enough predicate: same description in, same answer out. It
// is called once per candidate, so it is also the cost of shrinking — the step budget is
// there to keep a pathological case from running for minutes.
function shrink(description, stillFails, { maxSteps = 200 } = {}) {
  let best = clone(description);
  let steps = 0;
  let improved = true;

  while (improved && steps < maxSteps) {
    improved = false;
    for (const candidate of candidates(best)) {
      if (steps >= maxSteps) break;
      steps += 1;
      let fails;
      try {
        fails = stillFails(candidate);
      } catch {
        // A candidate the scenario builder refuses is not a reduction, it is a different
        // problem. Skip it rather than reporting a case that cannot be built.
        continue;
      }
      if (fails) {
        best = candidate;
        improved = true;
        break;
      }
    }
  }

  return { description: best, steps };
}

// How much smaller a description got, for the report. Rooms and configuration keys are
// what a reader actually scans for.
function sizeOf(description) {
  const full = describeScenario(description);
  return {
    rooms: full.rooms.length,
    configKeys: Object.keys(full.config).length,
    json: JSON.stringify(description).length,
  };
}

module.exports = { shrink, candidates, sizeOf };
