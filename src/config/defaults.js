// Card defaults for the optional YAML fields.
//
// Mode-dependent title/unit/icon/decimals are deliberately NOT here:
// presentation metadata lives with the metric registries, and every semantic
// classification/scale decision lives in the domain classification profiles.
//
// There are no default entities, and none of them is individually required. What IS
// required is that at least one CURRENT-VALUE source exists: either `entity` or at
// least one `rooms` entry. `range_entity` and `trend_entity` describe a value rather
// than being one, so they never satisfy that on their own. The check lives in
// normalize-config.js, where both fields have been normalized and can be judged
// together.

export const DEFAULT_CONFIG = {
  rotation_seconds: 14, // hold time per view
  slide_seconds: 1, // transition time between views
  hold_seconds: 0.5,
  tap_action: { action: "more-info" },
  hold_action: { action: "more-info" },
  auto_slide: true,
  swipe: true, // Manual swiping remains independent of automatic rotation.
  unavailable_values: "show", // Preserve visible source identity during temporary outages.
};
