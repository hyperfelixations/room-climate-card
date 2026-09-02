// Reading a classification an integration or template sensor provides itself.
//
// Trust boundary: attributes come from third-party integrations and reach CSS
// properties, inline styles and visible text, so each field is validated alone and a
// failure is treated as ABSENT.
//   value_color  a valid hex colour
//   value_level  a non-empty string, kept VERBATIM (not translated)
//   value_score  a finite number ("" and null rejected before Number() makes them 0)
//   value_zone   a non-empty string
//
// allowPartial: `auto` mode accepts the entity only with a complete colour+level pair
// (a half-filled set renders worse than the numeric profile); `entity` mode takes
// whatever is there.

import { isHexColor } from "../../core/color.js";

export function readEntityClassification(attributes, { allowPartial = false } = {}) {
  if (!attributes) return null;

  const color = typeof attributes.value_color === "string" && isHexColor(attributes.value_color.trim())
    ? attributes.value_color.trim()
    : null;
  const level = typeof attributes.value_level === "string" && attributes.value_level.trim()
    ? attributes.value_level.trim()
    : null;
  const numericScore = Number(attributes.value_score);
  const score = attributes.value_score !== undefined && attributes.value_score !== null && attributes.value_score !== "" && Number.isFinite(numericScore)
    ? numericScore
    : null;
  const zone = typeof attributes.value_zone === "string" && attributes.value_zone.trim() ? attributes.value_zone.trim() : null;

  if (allowPartial ? (!color && !level && score === null && !zone) : (!color || !level)) return null;
  return {
    color,
    level,
    score,
    zone,
    source: "entity",
    profileId: null,
  };
}
