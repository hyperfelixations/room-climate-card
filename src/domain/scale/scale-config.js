// The axis parameters a profile contributes.
//
// Takes an already-projected display profile and pulls out the fields the scale maths
// needs, with both defaults made explicit here instead of in scattered `undefined` checks:
//
//   oneSided     the metric has no "too low" end (CO2, PM2.5): the lower bound never
//                grows away from the reference scale
//   anchorScale  true unless a profile opts out (outdoor temperature does)
//
// `scale` is null for the opt-out profiles; normalising it here means the axis maths sees
// one shape of "there is none" whether the profile came from YAML or a built-in.

export function scaleConfigFor(displayProfile) {
  return {
    comfort: displayProfile.comfort,
    optimal: displayProfile.optimal,
    scale: displayProfile.scale ?? null,
    step: displayProfile.step,
    oneSided: displayProfile.oneSided === true,
    headroom: displayProfile.headroom,
    anchorScale: displayProfile.anchorScale !== false,
  };
}
