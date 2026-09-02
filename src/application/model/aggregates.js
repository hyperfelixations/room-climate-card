// Aggregates always use every participating room; grid visibility is presentation-only.
// Subtitles remain semantic descriptors, while `language` only stabilizes name tie-breaks.

// This shared order keeps extrema and equal-value name tie-breaks consistent.
export function sortRoomsByValue(rooms, language) {
  return [...rooms].sort((a, b) => a.value - b.value || a.name.localeCompare(b.name, language));
}

// Preserve config order and project accepted canonical values into the display unit.
// Colour and labels remain consumer-specific presentation decisions.
export function buildRoomModels({ config, context, toDisplay }) {
  const participatingByEntity = new Map(context.participatingRooms.map((model) => [model.entityId, model]));
  const declared = [];
  // Stryker disable next-line ArrayDeclaration: replacing the empty fallback with a
  // one-element array cannot change the result. The single element is a string, so
  // participatingByEntity.get(room.entity) is a lookup for `undefined`, which the map never
  // holds, and the `if (!model) continue` below leaves the loop having done nothing.
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

// Prefer a valid primary spread; callers supply `null` for room-based fallback.
// The caller canonicalizes this delta separately from absolute temperatures.
export function computeSpread({ attributeValue, roomsComparable, coolest, warmest }) {
  // Negative, undefined and NaN attributes fall back; `null >= 0` returns `null` unchanged.
  const attrSpread = attributeValue >= 0 ? attributeValue : null;
  const computedSpread = roomsComparable ? warmest.value - coolest.value : 0;
  return attrSpread !== null ? attrSpread : computedSpread;
}

// The largest deviation from the average is always one of the two extrema.
// Reusing them preserves the shared equal-value tie-break.
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
