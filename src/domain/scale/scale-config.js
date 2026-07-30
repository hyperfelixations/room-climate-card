// The axis parameters a profile contributes.
//
// Takes an already-projected display profile and pulls out exactly the fields the
// scale maths needs, with the two defaults made explicit rather than left to
// `undefined` checks scattered across call sites:
//
//   oneSided     the metric has no "too low" end (CO2, PM2.5), so the lower
//                bound never grows away from the reference scale
//   anchorScale  true unless a profile opts out. Outdoor temperature does opt
//                out: its readings are seasonal, so the axis follows the live
//                data instead of being pinned to a reference range that would be
//                wrong for most of the year.

export function scaleConfigFor(displayProfile) {
  return {
    comfort: displayProfile.comfort,
    optimal: displayProfile.optimal,
    scale: displayProfile.scale,
    step: displayProfile.step,
    oneSided: displayProfile.oneSided === true,
    headroom: displayProfile.headroom,
    anchorScale: displayProfile.anchorScale !== false,
  };
}
