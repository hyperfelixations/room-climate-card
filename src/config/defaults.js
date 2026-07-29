// Card defaults for the optional YAML fields.
//
// Mode-dependent title/unit/icon/decimals are deliberately NOT here:
// presentation metadata lives with the metric registries, and every semantic
// classification/scale decision lives in the domain classification profiles.
//
// There are no default entities. `entity` is the only required config field;
// `rooms` is optional and the card falls back to minimal mode without it.

export const DEFAULT_CONFIG = {
  rotation_seconds: 14, // hold time per view
  slide_seconds: 1, // transition time between views
  hold_seconds: 0.5,
  tap_action: { action: "more-info" },
  hold_action: { action: "more-info" },
  auto_slide: true, // AP-C1: automatic rotation between views
  swipe: true, // AP-C1: manual horizontal drag gesture, independent of auto_slide
};
