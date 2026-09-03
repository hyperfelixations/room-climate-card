// Pure string signatures for cheap render invalidation; every visible input must occur in
// one of them. Contract: see internal dev doc §4 "Render-Signaturvertrag".

// `last_updated` captures attribute-only changes that leave `last_changed` untouched.
export function entityDataSignature({ config, states, language, activeViewIndex, surface }) {
  const relevantEntities = [
    config.entity,
    config.range_entity,
    config.trend_entity,
    ...config.rooms.map((room) => room.entity),
  ].filter(Boolean);

  const relevantStates = relevantEntities
    .map((entity) => {
      const stateObj = states?.[entity];
      return `${entity}:${stateObj?.state ?? ""}:${stateObj?.last_updated ?? ""}`;
    })
    .join("|");

  return [
    relevantStates,
    `lang:${language}`,
    // Theme/card-mod repainting changes no entity, so the surface must be signed explicitly.
    `bg:${surface.samples.join(",")}|${surface.text || ""}`,
    `rotation:${config.rotation_seconds}`,
    `slide:${config.slide_seconds}`,
    `view:${activeViewIndex}`,
  ].join("|");
}

// Inputs that change markup or baked keyframes without necessarily changing view keys.
// Serializing `views` covers future structural view options generically. `show:` is omitted:
// its node presence is owned by the view model and signed by cardStructureSignature().
export function structuralConfigSignature(config) {
  return `${config.hide_footer}|${config.rotation_seconds}|${config.slide_seconds}|${config.auto_slide}|${JSON.stringify(config.views)}`;
}
