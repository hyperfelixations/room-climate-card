// Card defaults for the optional YAML fields only.
//
// Not here: mode-dependent title/unit/icon/decimals (metric registries and
// classification profiles own those), and the `show:` block's defaults
// (SHOW_SWITCHES in show.js). The source-minimum requirement is checked in
// normalize-config.js — see internal dev doc §3 "Konfigurationsvertrag".

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
