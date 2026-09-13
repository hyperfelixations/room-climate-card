// Where a profile becomes degenerate when projected into a display unit.
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

// The first threshold of a descending list that rounding pulled level with its predecessor.
function collapsedThreshold(canonicalTiers, projectedTiers, path) {
  for (let i = 1; i < canonicalTiers.length; i++) {
    const wasDescending = Number.isFinite(canonicalTiers[i - 1].min) && Number.isFinite(canonicalTiers[i].min)
      && canonicalTiers[i].min < canonicalTiers[i - 1].min;
    if (wasDescending && !(projectedTiers[i].min < projectedTiers[i - 1].min)) return `${path}[${i}].min`;
  }
  return null;
}

// The first fault the projection introduced, as { kind: "overflow" | "collapse", field }, or
// null. `field` is the YAML path of the boundary, band or scale concerned.
export function findProjectedGeometryFault(canonical, projected) {
  // Only a boundary finite in the canonical unit can overflow; open tier ends, an absent
  // headroom and an absent valid_range edge are not numbers to begin with.
  for (const [field, canonicalValue, projectedValue] of boundaryPairs(canonical, projected)) {
    if (Number.isFinite(canonicalValue) && !Number.isFinite(projectedValue)) return { kind: "overflow", field };
  }
  if (!(projected.comfort.min < projected.comfort.max)) return { kind: "collapse", field: "classification.bands.comfort" };
  if (!(projected.optimal.min < projected.optimal.max)) return { kind: "collapse", field: "classification.bands.optimal" };
  // Only a declared reference range can collapse; a profile whose axis follows the data
  // has none to round in the first place.
  if (projected.scale && !(projected.scale.min < projected.scale.max)) return { kind: "collapse", field: "classification.scale" };
  const tier = collapsedThreshold(canonical.tiers, projected.tiers, "classification.tiers");
  if (tier) return { kind: "collapse", field: tier };
  const icon = projected.iconTiers ? collapsedThreshold(canonical.iconTiers, projected.iconTiers, "classification.icons") : null;
  return icon ? { kind: "collapse", field: icon } : null;
}
