// The card shape both the daily-range view and the extreme-value view use.
//
// One model, two callers, so the two views can never drift apart visually. Every
// string and every custom property is resolved here: the render path interpolates
// them into markup, the patch path assigns the same values to an existing node, and
// neither decides anything of its own.
//
// The two visibility flags are independent and both default to shown. A hidden
// field is omitted from the tooltip and the ARIA label too, not just from the
// visible text — otherwise it would still be exposed on hover.

import { rgba } from "../../core/color.js";

// The four alphas a card's own custom properties are derived at.
const CARD_BG_ALPHA = 0.09;
const CARD_BORDER_ALPHA = 0.36;
const CARD_LINE_SHADOW_ALPHA = 0.24;

// The placeholder for a value or a name that is configured but currently absent.
// The card stays clickable — a missing reading is not a broken card.
const MISSING = "–";

// The neutral colour a card falls back to when nothing classified it. A CSS
// variable rather than a hex, so it follows the dashboard theme.
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
    // undefined/null both mean "not a real room", so the action layer falls back to
    // the card's default actions instead of a nonexistent room index.
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
