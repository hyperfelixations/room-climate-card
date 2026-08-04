"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

let topology;

test.before(async () => {
  topology = await import("../../src/application/model/source-topology.js");
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
// An id that is absent from hass.states is absent because it was mistyped, never
// existed, or was deleted — Home Assistant keeps REGISTERED entities in the state
// machine even while their integration is unloaded, publishing them as `unavailable`
// with `attributes.restored === true` rather than removing them. So "unknown to Home
// Assistant" is a property of the configuration, and an unknown source does not shape
// the card; an unavailable one still does.

const known = (...ids) => (entityId) => ids.includes(entityId);

test("a configured room Home Assistant does not know does not shape the card", () => {
  const { SOURCE_TOPOLOGY, resolveSourceTopology } = topology;
  // Exactly the reported case: one real room, one typo. That is a one-room card.
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
  // Both known to Home Assistant; one of them merely has no usable value right now.
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
  // Otherwise a card would change shape during the moment at start-up before states
  // are published — and a card with nothing to show still has a configured identity.
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
