// Rejects a profile that becomes degenerate when projected into a display unit.
//
// Projection rounds every boundary independently (integer Fahrenheit). Rounding is
// order-preserving but not injective: two values still distinct in Celsius can round to
// the same Fahrenheit value, collapsing a band to zero width or making a tier
// unreachable. The classifier compares against these rounded numbers, so a collapse is a
// real bug, not a cosmetic one.
//
// Every property checked here is already guaranteed in the canonical profile, so each
// check first confirms the canonical values were ordered — this only catches what
// ROUNDING introduced. Built-in profiles never trigger it (gaps >= 1 °C, well above the
// ~0.56 °C that survives integer Fahrenheit rounding); it exists for narrow custom gaps.

export function assertProjectedGeometry(canonical, projected, metricKind, displayProfile) {
  const unitLabel = displayProfile.displayUnit || displayProfile.key;
  const fail = (detail) => {
    throw new Error(
      `Invalid configuration: classification profile for "${metricKind}" becomes degenerate when rounded to ${unitLabel} (${detail}) — configure wider gaps, or set classification.unit to "${unitLabel}" directly to avoid rounding.`
    );
  };
  if (!(projected.comfort.min < projected.comfort.max)) fail("comfort band collapses");
  if (!(projected.optimal.min < projected.optimal.max)) fail("optimal band collapses");
  // Only a declared reference range can collapse; a profile whose axis follows the data
  // has none to round in the first place.
  if (projected.scale && !(projected.scale.min < projected.scale.max)) fail("scale collapses");
  for (let i = 1; i < canonical.tiers.length; i++) {
    const wasDescending = Number.isFinite(canonical.tiers[i - 1].min) && Number.isFinite(canonical.tiers[i].min)
      && canonical.tiers[i].min < canonical.tiers[i - 1].min;
    if (!wasDescending) continue;
    if (!(projected.tiers[i].min < projected.tiers[i - 1].min)) {
      fail(`tier thresholds collapse near ${projected.tiers[i].min}${unitLabel}`);
    }
  }
  if (projected.iconTiers) {
    for (let i = 1; i < canonical.iconTiers.length; i++) {
      const wasDescending = Number.isFinite(canonical.iconTiers[i - 1].min) && Number.isFinite(canonical.iconTiers[i].min)
        && canonical.iconTiers[i].min < canonical.iconTiers[i - 1].min;
      if (!wasDescending) continue;
      if (!(projected.iconTiers[i].min < projected.iconTiers[i - 1].min)) {
        fail(`icon tiers collapse near ${projected.iconTiers[i].min}${unitLabel}`);
      }
    }
  }
}
