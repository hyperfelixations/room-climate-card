"use strict";

// Which of the four shapes a card is (primary-with-rooms, primary-only, rooms-only, single
// room as headline) and which configured ids shape it. resolveSourceTopology() is pure over
// the normalized configuration; resolveSourceEligibility() decides which ids are sources at
// all and needs `states`. The point to protect: eligibility answers from what a sensor
// declares, never from what it currently reads, or the card would reshape as sensors blink.
// Pure: no card, no DOM. The assembled behaviour is in component/rendering/source-modes.

const test = require("node:test");
const assert = require("node:assert/strict");

const { HUMIDITY, TEMPERATURE_C, TEMPERATURE } = require("../../fixtures/attributes.js");

let topology;

test.before(async () => {
  topology = await import("../../../src/application/model/source-topology.js");
});

function config(entity, roomEntities = []) {
  return {
    entity,
    rooms: roomEntities.map((roomEntity) => ({ entity: roomEntity })),
  };
}

test("the four source topologies are resolved only from normalized configuration", () => {
  const { SOURCE_TOPOLOGY, resolveSourceTopology } = topology;

  assert.deepEqual(resolveSourceTopology(config("sensor.primary")), {
    kind: SOURCE_TOPOLOGY.PRIMARY_ONLY,
    headlineEntity: "sensor.primary",
    roomIndex: null,
  });
  assert.deepEqual(resolveSourceTopology(config(null, ["sensor.room"])), {
    kind: SOURCE_TOPOLOGY.SINGLE_ROOM,
    headlineEntity: "sensor.room",
    roomIndex: 0,
  });
  assert.deepEqual(resolveSourceTopology(config("sensor.room", ["sensor.room"])), {
    kind: SOURCE_TOPOLOGY.SINGLE_ROOM,
    headlineEntity: "sensor.room",
    roomIndex: 0,
  });
  assert.deepEqual(resolveSourceTopology(config(null, ["sensor.a", "sensor.b"])), {
    kind: SOURCE_TOPOLOGY.ROOM_CONSENSUS,
    headlineEntity: null,
    roomIndex: null,
  });
  assert.deepEqual(resolveSourceTopology(config("sensor.primary", ["sensor.room"])), {
    kind: SOURCE_TOPOLOGY.PRIMARY_WITH_ROOMS,
    headlineEntity: "sensor.primary",
    roomIndex: null,
  });
});

test("a primary repeated among several rooms never inherits a room identity", () => {
  const result = topology.resolveSourceTopology(
    config("sensor.primary", ["sensor.primary", "sensor.other"])
  );
  assert.deepEqual(result, {
    kind: topology.SOURCE_TOPOLOGY.PRIMARY_WITH_ROOMS,
    headlineEntity: "sensor.primary",
    roomIndex: null,
  });
});

test("chip redundancy is exactly the single-room topology", () => {
  for (const kind of Object.values(topology.SOURCE_TOPOLOGY)) {
    assert.equal(
      topology.chipsWouldDuplicateHeadline({ kind }),
      kind === topology.SOURCE_TOPOLOGY.SINGLE_ROOM,
      kind
    );
  }
});

// --------------------------------------------- sources Home Assistant knows --
//
// An id absent from hass.states was mistyped, never existed, or was deleted — Home Assistant
// keeps registered-but-unloaded entities in the state machine as `unavailable`. So "unknown
// to Home Assistant" is a property of the configuration: an unknown source does not shape
// the card; an unavailable one still does.

const known = (...ids) => (entityId) => ids.includes(entityId);

test("a configured room Home Assistant does not know does not shape the card", () => {
  const { SOURCE_TOPOLOGY, resolveSourceTopology } = topology;
  // One real room, one typo: a one-room card.
  const result = resolveSourceTopology(config(null, ["sensor.real", "sensor.typo"]), known("sensor.real"));
  assert.deepEqual(result, {
    kind: SOURCE_TOPOLOGY.SINGLE_ROOM,
    headlineEntity: "sensor.real",
    roomIndex: 0,
  });
});

test("the surviving room keeps its CONFIGURED index, not its position after filtering", () => {
  const { SOURCE_TOPOLOGY, resolveSourceTopology } = topology;
  const result = resolveSourceTopology(config(null, ["sensor.typo", "sensor.real"]), known("sensor.real"));
  assert.deepEqual(result, {
    kind: SOURCE_TOPOLOGY.SINGLE_ROOM,
    headlineEntity: "sensor.real",
    roomIndex: 1,
  });
});

test("an unavailable room still shapes the card, because it exists", () => {
  const { SOURCE_TOPOLOGY, resolveSourceTopology } = topology;
  // Both known to Home Assistant; one merely has no usable value right now.
  const result = resolveSourceTopology(config(null, ["sensor.a", "sensor.b"]), known("sensor.a", "sensor.b"));
  assert.equal(result.kind, SOURCE_TOPOLOGY.ROOM_CONSENSUS);
});

test("a primary Home Assistant does not know leaves the rooms to decide", () => {
  const { SOURCE_TOPOLOGY, resolveSourceTopology } = topology;
  assert.equal(
    resolveSourceTopology(config("sensor.typo", ["sensor.a", "sensor.b"]), known("sensor.a", "sensor.b")).kind,
    SOURCE_TOPOLOGY.ROOM_CONSENSUS
  );
  assert.deepEqual(resolveSourceTopology(config("sensor.typo", ["sensor.a"]), known("sensor.a")), {
    kind: SOURCE_TOPOLOGY.SINGLE_ROOM,
    headlineEntity: "sensor.a",
    roomIndex: 0,
  });
});

test("a card whose sources are ALL unknown keeps the identity its configuration gives it", () => {
  const { SOURCE_TOPOLOGY, resolveSourceTopology } = topology;
  const nothing = () => false;
  // Otherwise a card would change shape during the start-up moment before states publish.
  assert.deepEqual(resolveSourceTopology(config("sensor.primary"), nothing), {
    kind: SOURCE_TOPOLOGY.PRIMARY_ONLY,
    headlineEntity: "sensor.primary",
    roomIndex: null,
  });
  assert.equal(resolveSourceTopology(config(null, ["sensor.a", "sensor.b"]), nothing).kind, SOURCE_TOPOLOGY.ROOM_CONSENSUS);
  assert.equal(
    resolveSourceTopology(config("sensor.primary", ["sensor.a"]), nothing).kind,
    SOURCE_TOPOLOGY.PRIMARY_WITH_ROOMS
  );
});

test("without the predicate every configured source counts, exactly as before", () => {
  const { SOURCE_TOPOLOGY, resolveSourceTopology } = topology;
  assert.equal(resolveSourceTopology(config(null, ["sensor.a", "sensor.b"])).kind, SOURCE_TOPOLOGY.ROOM_CONSENSUS);
  assert.equal(resolveSourceTopology(config(null, ["sensor.a"])).kind, SOURCE_TOPOLOGY.SINGLE_ROOM);
});

// ------------------------------------------- which ids are sources at all --
//
// resolveSourceEligibility() answers two questions: does Home Assistant have this id, and
// does this source measure what the card is about. Both are properties of the declaration,
// not the current reading, which keeps the shape still while a sensor comes and goes.

const state = (value, attributes) => ({ state: String(value), attributes });

// A humidity card: the primary declares humidity, and so does one of the rooms.
const HUMIDITY_STATES = {
  "sensor.avg": state(44, HUMIDITY),
  "sensor.room": state(41, HUMIDITY),
  "sensor.foreign": state(21, TEMPERATURE_C),
  // Present, numeric, says nothing the card can use: no device_class, a shared unit. Written
  // out rather than named — see the note in test/fixtures/attributes.js.
  "sensor.unidentified": state(7, { unit_of_measurement: "ppb" }),
  // Declares the card's own measurement and has nothing to report right now.
  "sensor.offline": state("unavailable", HUMIDITY),
  // Declares the card's own measurement in a unit the card cannot read for it.
  "sensor.badunit": state(41, { device_class: HUMIDITY.device_class, unit_of_measurement: "hPa" }),
};

test("a room declaring another measurement is not a source of this card", () => {
  const { SOURCE_TOPOLOGY, resolveSourceEligibility, resolveSourceTopology } = topology;
  // One usable entity, listed as both the primary and the one room, plus a thermometer on a
  // humidity card: the thermometer does not turn a single-room card into a whole-home one.
  const config = {
    entity: "sensor.avg",
    rooms: [{ entity: "sensor.avg" }, { entity: "sensor.foreign" }],
  };
  assert.deepEqual(resolveSourceTopology(config, resolveSourceEligibility(HUMIDITY_STATES, config)), {
    kind: SOURCE_TOPOLOGY.SINGLE_ROOM,
    headlineEntity: "sensor.avg",
    roomIndex: 0,
  });
});

test("only the reading is unavailable, so the declaration still shapes the card", () => {
  const { SOURCE_TOPOLOGY, resolveSourceEligibility, resolveSourceTopology } = topology;
  // Three rooms unusable this minute for three reasons, all staying sources: an outage, an
  // unreadable unit and an undeclared sensor are all availability, which never reshapes a card.
  for (const roomEntity of ["sensor.offline", "sensor.badunit", "sensor.unidentified"]) {
    const config = { entity: "sensor.avg", rooms: [{ entity: roomEntity }] };
    assert.equal(
      resolveSourceTopology(config, resolveSourceEligibility(HUMIDITY_STATES, config)).kind,
      SOURCE_TOPOLOGY.PRIMARY_WITH_ROOMS,
      roomEntity
    );
  }
});

test("with no primary to settle the measurement, no room is filtered out", () => {
  const { SOURCE_TOPOLOGY, resolveSourceEligibility, resolveSourceTopology } = topology;
  // Rooms that disagree about what they measure have no arbiter; the card reports a mixed
  // configuration rather than filtering one against the other.
  const noPrimary = { entity: null, rooms: [{ entity: "sensor.room" }, { entity: "sensor.foreign" }] };
  assert.equal(
    resolveSourceTopology(noPrimary, resolveSourceEligibility(HUMIDITY_STATES, noPrimary)).kind,
    SOURCE_TOPOLOGY.ROOM_CONSENSUS
  );
  // Same when the configured primary has no state object: an unknown id declares nothing.
  const typo = { entity: "sensor.typo", rooms: [{ entity: "sensor.room" }, { entity: "sensor.foreign" }] };
  assert.equal(
    resolveSourceTopology(typo, resolveSourceEligibility(HUMIDITY_STATES, typo)).kind,
    SOURCE_TOPOLOGY.ROOM_CONSENSUS
  );
});

test("a primary that declares nothing itself filters nothing either", () => {
  const { resolveSourceEligibility } = topology;
  const states = { "sensor.avg": state(44, {}), "sensor.foreign": state(21, TEMPERATURE_C) };
  const eligible = resolveSourceEligibility(states, { entity: "sensor.avg" });
  assert.equal(eligible("sensor.foreign"), true, "nobody has said what this card is about");
});

test("the eligibility predicate answers the two halves separately", () => {
  const { resolveSourceEligibility } = topology;
  const eligible = resolveSourceEligibility(HUMIDITY_STATES, { entity: "sensor.avg" });
  assert.equal(eligible("sensor.room"), true, "declares this card's measurement");
  assert.equal(eligible("sensor.foreign"), false, "declares a different measurement");
  assert.equal(eligible("sensor.unidentified"), true, "declares nothing, which is not a contradiction");
  assert.equal(eligible("sensor.nowhere"), false, "Home Assistant does not have this id");
  assert.equal(eligible(null), false, "and neither does it have no id at all");
});

test("a declaration made by the unit alone counts as one", () => {
  const { resolveSourceEligibility } = topology;
  // The card reads device_class first, then a single-measurement unit; both are
  // declarations, so a bare °C sensor is as foreign to a humidity card as a declared one.
  const states = { "sensor.avg": state(44, HUMIDITY), "sensor.bare": state(21, { unit_of_measurement: "°C" }) };
  assert.equal(resolveSourceEligibility(states, { entity: "sensor.avg" })("sensor.bare"), false);
  // And the mirror image: a device class without a unit still says what it measures.
  const warm = { "sensor.avg": state(21, TEMPERATURE_C), "sensor.classy": state(23, TEMPERATURE) };
  assert.equal(resolveSourceEligibility(warm, { entity: "sensor.avg" })("sensor.classy"), true);
});

test("a card whose rooms are all foreign refers to its primary alone", () => {
  const { SOURCE_TOPOLOGY, resolveSourceEligibility, resolveSourceTopology } = topology;
  // Nothing left to stand among, so the headline needs no caption.
  const config = { entity: "sensor.avg", rooms: [{ entity: "sensor.foreign" }] };
  assert.deepEqual(resolveSourceTopology(config, resolveSourceEligibility(HUMIDITY_STATES, config)), {
    kind: SOURCE_TOPOLOGY.PRIMARY_ONLY,
    headlineEntity: "sensor.avg",
    roomIndex: null,
  });
});

test("before any state is published the configuration alone decides", () => {
  const { SOURCE_TOPOLOGY, resolveSourceEligibility, resolveSourceTopology } = topology;
  // Start-up moment: `states` is empty, so the full-configuration fallback keeps the card
  // the shape its YAML gives it.
  const config = { entity: "sensor.avg", rooms: [{ entity: "sensor.foreign" }] };
  assert.equal(
    resolveSourceTopology(config, resolveSourceEligibility({}, config)).kind,
    SOURCE_TOPOLOGY.PRIMARY_WITH_ROOMS
  );
  assert.equal(
    resolveSourceTopology(config, resolveSourceEligibility(undefined, config)).kind,
    SOURCE_TOPOLOGY.PRIMARY_WITH_ROOMS
  );
});
