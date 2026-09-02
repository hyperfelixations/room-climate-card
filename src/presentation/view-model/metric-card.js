// Shared finished model for daily-range and extreme-value cards.
// Independent visibility flags also govern tooltip and accessibility text.

import { rgba } from "../../core/color.js";

// Metric-card paint recipe.
const CARD_BG_ALPHA = 0.09;
const CARD_BORDER_ALPHA = 0.36;
const CARD_LINE_SHADOW_ALPHA = 0.24;

// Missing readings retain a clickable placeholder card.
const MISSING = "–";

// Theme-following fallback for unclassified cards.
const NEUTRAL_COLOR = "var(--rtc-muted)";

export function buildMetricCardModel({
  label,
  name,
  value,
  entity,
  color,
  roomIndex,
  unit,
  texts,
  showName = true,
  showValue = true,
}) {
  const cardColor = color || NEUTRAL_COLOR;
  const hasValue = typeof value === "number" && Number.isFinite(value);
  const nameText = showName ? name || MISSING : "";
  const numText = showValue ? (hasValue ? texts.fmt(value) : MISSING) : "";
  const unitText = showValue && hasValue ? ` ${unit}` : "";
  const titleValueText = showValue ? (hasValue ? texts.fmtWithUnit(value) : MISSING) : "";

  return {
    label,
    nameText,
    numText,
    unitText,
    // Null means use card actions rather than a room override.
    roomIndex: roomIndex ?? null,
    entity: entity ?? "",
    color: cardColor,
    background: rgba(cardColor, CARD_BG_ALPHA),
    border: rgba(cardColor, CARD_BORDER_ALPHA),
    lineShadow: rgba(cardColor, CARD_LINE_SHADOW_ALPHA),
    title: [label, [nameText, titleValueText].filter(Boolean).join(" ")].filter(Boolean).join(": "),
    ariaLabel: texts.t("card.ariaOpen", { label, name: nameText }),
  };
}
