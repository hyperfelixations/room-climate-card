// Reading a classification an integration or template sensor provides itself.
//
// This is a trust boundary. The attributes come from arbitrary third-party
// integrations and end up in CSS custom properties, inline styles and visible
// text, so each field is validated on its own and anything that fails is treated
// as ABSENT rather than passed through:
//
//   value_color  must be a valid hex colour (it reaches a style attribute)
//   value_level  a non-empty string, kept VERBATIM — it is the integration's own
//                wording and is deliberately not translated
//   value_score  a finite number, with "" and null rejected before Number()
//                turns them into 0
//   value_zone   a non-empty string
//
// allowPartial distinguishes the two modes. Automatic mode accepts the entity as
// the source only when it supplies a complete colour+level pair, because a
// half-filled attribute set would render worse than the card's own numeric
// classification. Forced `entity` mode asks for whatever is there.

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
