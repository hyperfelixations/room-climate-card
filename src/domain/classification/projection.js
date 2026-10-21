// Re-expressing a classification profile in the unit the card actually displays.
//
// Every comparison the card makes — tier selection, comfort counting, scale geometry, icon
// choice — runs against the DISPLAYED value. Projecting the profile (rather than converting
// each reading back) is what keeps the printed band equal to the applied band: it stops a
// displayed "68 °F comfort" edge from classifying as if it were 67.9 °F.
//
// A profile applies exactly as authored in the unit it was written in: built-ins in the
// canonical unit, a custom profile in its `unit` (carried as `profile.authored`). Only a
// projection into another unit rounds boundaries (thresholdRounding) and widens the step to
// the next 1-2-5 value. See internal dev doc §5 "Einheitenregel".

import { niceStepAtLeast } from "../../core/numbers.js";
import { findReexpressionFault, reexpressProfile } from "./reexpression.js";

// The projected profile, and the first fault the projection introduced (null when there is
// none; see reexpression.js). The authored unit returns the authored profile itself.
export function projectProfile(canonical, definition, unitProfile) {
  const displayProfile = unitProfile || definition.unitProfiles[definition.canonicalProfileKey];
  const { authored, ...profile } = canonical;
  if (authored?.unitProfileKey === displayProfile.key) return { projected: authored.profile, fault: null };
  if (displayProfile.key === definition.canonicalProfileKey) return { projected: canonical, fault: null };

  const round = displayProfile.thresholdRounding || ((value) => value);
  const projected = reexpressProfile(profile, {
    absolute: (value) => round(displayProfile.fromCanonical(value)),
    delta: displayProfile.deltaFromCanonical,
    // A step that underflows to zero stays zero, so the fault names a collapse.
    step: (value) => {
      const step = displayProfile.deltaFromCanonical(value);
      return step > 0 ? niceStepAtLeast(step) : step;
    },
  });
  return { projected, fault: findReexpressionFault(profile, projected) };
}

// The projection a render uses. The effective classification policy has already fallen back
// from a profile with a fault (application/model/classification-policy.js), so a fault here is
// a bug, not a configuration problem.
export function projectProfileToDisplayUnit(canonical, definition, unitProfile, metricKind) {
  const { projected, fault } = projectProfile(canonical, definition, unitProfile);
  if (fault) throw new Error(`classification profile for "${metricKind}" projects with a ${fault.kind} at ${fault.field}`);
  return projected;
}
