// Room models, extrema, comfort counting, spread and the semantic subtitle.
//
// The one invariant that runs through all of it: every calculation here uses EVERY
// valid room. A room hidden by a grid override is still a full data source — the
// cap is a display decision and must never change the average, the extrema, the
// spread, the comfort count or the subtitle.
//
// The subtitle is returned as a SEMANTIC descriptor, not a sentence: which branch
// applies plus the numbers it needs. Turning that into localized text is the
// presentation layer's job.
//
// `language` is passed in as a plain locale string, not a translator. It is needed
// for one thing only: the name tie-break when two rooms report the same value. That
// tie-break is part of the business ordering (the extrema and the "stands out most"
// room must agree on it), so it cannot move to the presentation layer without
// changing which room gets named.

// Value order, with a locale-aware name tie-break. This is the business order:
// extrema, comfort counting and spread all read it.
export function sortRoomsByValue(rooms, language) {
  return [...rooms].sort((a, b) => a.value - b.value || a.name.localeCompare(b.name, language));
}

// One room model per participating room, in config-declaration order.
//
// Only rooms the measurement context actually accepted appear here: same metric
// kind as the resolved context, numerically and physically valid, entity currently
// available. `value` is the DISPLAY value, so every comparison against the
// comfort band (also resolved into the display unit) is correct no matter which
// unit each entity reports in.
// Deliberately carries no colour and no label: those are per-consumer decisions
// resolved later, and adding them here would change the shape every renderer
// already reads.
export function buildRoomModels({ config, context, toDisplay }) {
  const participatingByEntity = new Map(context.participatingRooms.map((model) => [model.entityId, model]));
  const declared = [];
  for (const [index, room] of (config.rooms || []).entries()) {
    const model = participatingByEntity.get(room.entity);
    if (!model) continue;
    declared.push({
      name: room.name,
      short: room.short,
      entity: room.entity,
      tap_action: room.tap_action,
      hold_action: room.hold_action,
      index,
      value: toDisplay(model.canonicalValue),
    });
  }
  return declared;
}

export function computeComfortCounts(rooms, comfort, roomsComparable) {
  if (!roomsComparable) return { inComfort: 0, tooWarm: 0, tooCool: 0 };
  return {
    inComfort: rooms.filter((room) => room.value >= comfort.min && room.value <= comfort.max).length,
    tooWarm: rooms.filter((room) => room.value > comfort.max).length,
    tooCool: rooms.filter((room) => room.value < comfort.min).length,
  };
}

// Spread prefers the primary entity's own spread attribute, which a template
// sensor computes server-side over the full day rather than over the current
// snapshot. It is only recomputed locally when that attribute is missing or
// invalid, or when the average itself is the room-based fallback — the attribute
// belongs to the primary entity's state and would otherwise be a stale reading
// from a broken one.
//
// The attribute is a DELTA in the primary's own unit, so it is canonicalized and
// then projected with the delta path; using the absolute path would add the
// Fahrenheit offset to a difference.
export function computeSpread({ attributeValue, roomsComparable, coolest, warmest }) {
  // A negative room-to-room range is physically impossible; treat it exactly like
  // a missing attribute.
  const attrSpread = attributeValue !== null && attributeValue >= 0 ? attributeValue : null;
  const computedSpread = roomsComparable ? warmest.value - coolest.value : 0;
  return attrSpread !== null ? attrSpread : computedSpread;
}

// Which subtitle sentence applies, and the numbers it needs.
//
// The "stands out most" room is always the coolest or the warmest: the average
// sits between the global minimum and maximum, so |value - avg| is maximized at
// one of those two endpoints. Reusing those already-computed objects instead of a
// second, independent sort is what keeps the named room and the extreme-value
// cards from disagreeing on an exact value tie.
export function buildSubtitleModel({ avg, comfort, roomsComparable, counts, roomCount, coolest, warmest, missingRooms }) {
  let sentence;
  if (avg > comfort.max) {
    sentence = roomsComparable
      ? { kind: "aboveComfort", diff: avg - comfort.max, count: counts.tooWarm, total: roomCount, adjective: "above" }
      : { kind: "aboveComfortNoRooms", diff: avg - comfort.max };
  } else if (avg < comfort.min) {
    sentence = roomsComparable
      ? { kind: "belowComfort", diff: comfort.min - avg, count: counts.tooCool, total: roomCount, adjective: "below" }
      : { kind: "belowComfortNoRooms", diff: comfort.min - avg };
  } else if (roomsComparable && counts.tooWarm + counts.tooCool > 0) {
    const warmestOut = warmest.value > comfort.max;
    const coolestOut = coolest.value < comfort.min;
    const issue = warmestOut && coolestOut
      ? (Math.abs(warmest.value - avg) >= Math.abs(coolest.value - avg) ? warmest : coolest)
      : warmestOut ? warmest : coolest;
    sentence = { kind: "inComfortIssue", name: issue.name };
  } else if (roomsComparable) {
    sentence = { kind: "inComfortAllGood" };
  } else {
    sentence = { kind: "inComfort" };
  }
  return { ...sentence, missingRooms };
}
