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
