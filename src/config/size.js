// The card's size: a step or a factor for the whole card, or a block for its header, panel and
// rooms plus `dynamic`. A part the block does not write is small. Steps are read as written, like
// every other word the card accepts; a factor may also be quoted. The rooms have steps of their
// own: a chip has room to spare that header and panel do not. `dynamic` (default true) lets every
// part follow the card's width. See internal dev doc §3 "Konfigurationsvertrag" and §5 "Kartengröße".

import { createDiagnostic, fallbackValue } from "../core/diagnostics.js";
import { parseConfigNumber } from "../core/numbers.js";
import { assertKnownKeys, isPlainObject, isUnwritten, readBoolean } from "./primitives.js";

// The named steps of header and panel; a number within SIZE_FACTOR is a factor of its own.
export const SIZE_STEPS = Object.freeze({ small: 1, medium: 1.25, large: 1.5 });
// The same steps for the rooms.
export const ROOM_SIZE_STEPS = Object.freeze({ small: 1, medium: 1.5, large: 2 });
export const SIZE_FACTOR = Object.freeze({ min: 1, max: 2 });

const PARTS = Object.freeze(["header", "panel", "rooms"]);

// The rooms' factor that goes with a header or panel factor: the step tables, continued linearly
// up to the largest factor a block may give the rooms.
export function roomFactorFor(factor) {
  return Math.min(SIZE_FACTOR.max, Math.round((1 + 2 * (factor - 1)) * 10000) / 10000);
}

// A step or a factor of `steps`; anything else is small, named in one diagnostic.
function readSize(value, path, diagnostics, steps) {
  if (isUnwritten(value)) return steps.small;
  if (typeof value === "string" && Object.hasOwn(steps, value)) return steps[value];
  const number = parseConfigNumber(value);
  if (number !== null && number >= SIZE_FACTOR.min && number <= SIZE_FACTOR.max) return number;
  diagnostics.push(createDiagnostic("value.invalid", { path, value, fallback: fallbackValue("small") }));
  return steps.small;
}

// `hierarchy`: the rooms are not asked to be larger than the panel, so a reading stays below the
// headline and a short code below the entity label.
export function normalizeSizeConfig(value, diagnostics) {
  if (!isPlainObject(value)) {
    const factor = readSize(value, "size", diagnostics, SIZE_STEPS);
    return Object.freeze({ header: factor, panel: factor, rooms: roomFactorFor(factor), dynamic: true, hierarchy: true });
  }
  assertKnownKeys(value, [...PARTS, "dynamic"], "size");
  const panel = readSize(value.panel, "size.panel", diagnostics, SIZE_STEPS);
  const rooms = readSize(value.rooms, "size.rooms", diagnostics, ROOM_SIZE_STEPS);
  return Object.freeze({
    header: readSize(value.header, "size.header", diagnostics, SIZE_STEPS),
    panel,
    rooms,
    dynamic: readBoolean(value.dynamic, "size.dynamic", diagnostics, true),
    hierarchy: rooms <= roomFactorFor(panel) + 1e-9,
  });
}
