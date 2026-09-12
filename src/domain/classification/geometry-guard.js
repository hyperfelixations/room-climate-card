// Rejects a profile that becomes degenerate when projected into a display unit.
//
// Two ways a projection breaks what held in the canonical unit. A scaling unit can overflow a
// finite boundary ((v * 9) / 5 + 32 beyond Number.MAX_VALUE), which no axis or tier can use.
// And projection rounds every boundary independently (integer Fahrenheit): order-preserving
// but not injective, so two values still distinct in Celsius can round to the same
// Fahrenheit value, collapsing a band to zero width or making a tier unreachable. The
// classifier compares against these rounded numbers, so a collapse is a real bug.
//
// Every property checked here holds in the canonical profile, so each check compares against
// it and catches only what the projection introduced. Built-in profiles never trigger either
// (finite, gaps >= 1 °C, well above the ~0.56 °C that survives integer Fahrenheit rounding).

// Every numeric boundary a profile carries, canonical and projected side by side, named by the
// YAML path it is written under. Only a custom profile can fail here; its legacy temperature
// icon object counts as icons[0..3] in the order fire, high, normal, low.
function boundaryPairs(canonical, projected) {
  const pairs = [];
  for (const band of ["comfort", "optimal"]) {
    for (const edge of ["min", "max"]) {
      pairs.push([`classification.bands.${band}.${edge}`, canonical[band][edge], projected[band][edge]]);
    }
  }
  if (canonical.scale) {
    for (const edge of ["min", "max"]) {
      pairs.push([`classification.scale.${edge}`, canonical.scale[edge], projected.scale[edge]]);
    }
  }
  pairs.push(
    ["classification.scale.step", canonical.step, projected.step],
    ["classification.scale.headroom", canonical.headroom, projected.headroom]
  );
  if (canonical.validRange) {
    for (const edge of ["min", "max"]) {
      pairs.push([`classification.valid_range.${edge}`, canonical.validRange[edge], projected.validRange[edge]]);
    }
  }
  canonical.tiers.forEach((tier, index) => pairs.push([`classification.tiers[${index}].min`, tier.min, projected.tiers[index].min]));
  canonical.iconTiers?.forEach((tier, index) =>
    pairs.push([`classification.icons[${index}].min`, tier.min, projected.iconTiers[index].min])
  );
  return pairs;
}

export function assertProjectedGeometry(canonical, projected, metricKind, displayProfile) {
  const unitLabel = displayProfile.displayUnit || displayProfile.key;
  // Only a boundary finite in the canonical unit can overflow; open tier ends, an absent
  // headroom and an absent valid_range edge are not numbers to begin with.
  for (const [field, canonicalValue, projectedValue] of boundaryPairs(canonical, projected)) {
    if (Number.isFinite(canonicalValue) && !Number.isFinite(projectedValue)) {
      throw new Error(
        `Invalid configuration: classification profile for "${metricKind}" cannot be expressed in ${unitLabel} (${field} lies beyond the largest number ${unitLabel} can hold) — keep every classification boundary within the range a sensor can report.`
      );
    }
  }
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
