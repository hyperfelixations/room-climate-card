// The two comparable values that decide whether anything has to be rendered at all.
//
// Both are strings on purpose. The question "did anything change" is asked on every
// hass push — several times a second on a busy dashboard — and answering it by walking
// two object graphs would cost more than the render it is trying to avoid. A string
// comparison costs nothing and is trivially correct as long as every input that can
// change the output appears in it, which is what the two functions below are for.
//
// Pure: no clock, no DOM, no element. Everything arrives as an argument, so a signature
// can be asserted by writing down a config and a states map.

// Everything whose change requires the card to be re-evaluated at all.
//
// last_updated rather than last_changed is deliberate: an attribute-only update (a
// thermostat's target temperature moving while its state stays "heat") leaves
// last_changed untouched, and the card reads attributes.
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
    // The colours the card is painted on. Nothing about the entities changes when a user
    // switches theme or a card-mod rule repaints the card, so this is the only thing that
    // can bring it back for a repaint — see adaptPalette().
    `bg:${surface.samples.join(",")}|${surface.text || ""}`,
    `rotation:${config.rotation_seconds}`,
    `slide:${config.slide_seconds}`,
    `view:${activeViewIndex}`,
  ].join("|");
}

// Everything that changes the MARKUP without changing the view list, and therefore
// cannot be applied by patching.
//
//   accent_line            the bar across the top edge is a node, and a patch can change
//                          text and colours but cannot create or delete one
//   hide_footer            the footer markup exists or it does not
//   rotation_seconds       the @keyframes breakpoint percentages are baked into
//   slide_seconds          <style> at full-render time and cannot be patched
//   auto_slide             only the structural path starts or stops the animation, so
//                          toggling this alone would otherwise leave it as it was
//   views                  a views[i].options change (a band toggling) does not alter
//                          the key list at all, and the patch path can only update
//                          elements that already exist
//
// The last entry is what makes this generic: every current and future structural view
// option is covered without naming it here.
export function structuralConfigSignature(config) {
  return `${config.accent_line}|${config.hide_footer}|${config.rotation_seconds}|${config.slide_seconds}|${config.auto_slide}|${JSON.stringify(config.views)}`;
}
