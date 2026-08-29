// Card defaults for the optional YAML fields.
//
// Mode-dependent title/unit/icon/decimals are deliberately NOT here:
// presentation metadata lives with the metric registries, and every semantic
// classification/scale decision lives in the domain classification profiles.
//
// Neither are the `show:` block's defaults. SHOW_SWITCHES in show.js owns them, and
// the older top-level spellings that map onto that block are read WITHOUT a default
// of their own (see legacyShowRequests() in normalize-config.js), so one decision is
// never given two defaults that could drift apart.
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
  hide_footer: false, // Every view draws its footer unless something asks it not to.
};
