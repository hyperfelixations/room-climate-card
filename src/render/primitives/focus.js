// Where focus goes when the element that had it disappears.
//
// The keyed patchers exist so this almost never happens, but two cases remain
// genuinely structural: a room whose entity vanished, and the average flipping
// between its interactive and its disabled shape. Leaving focus to fall back to the
// shadow root, the host or the body would drop a keyboard user out of the card
// entirely, so a deterministic target is chosen instead.
//
// The average button is preferred when it exists AND is the interactive shape — the
// disabled div variant is not focusable and would silently do nothing. `.rtc-root`
// carries tabindex="-1" for exactly this purpose: out of the tab order, but a valid
// programmatic target.

export function focusFallbackTarget(root) {
  if (!root) return null;
  const averageButton = root.querySelector("button.rtc-avg-button");
  if (averageButton) return averageButton;
  return root.querySelector(".rtc-root");
}

export function applyFocusFallback(root) {
  const target = focusFallbackTarget(root);
  if (target) target.focus();
}
