// Preserve keyboard context when structural patching removes the focused node.
// Prefer the interactive average; `.rtc-root[tabindex="-1"]` is the programmatic fallback.

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
