// Three colours, in both directions: a traffic light rather than a gradient.
//
// It comes out of what people asked for in the community thread — colours that shout when
// a number is bad, instead of the soft ramp the card ships by default. Green means the
// room is where it should be, amber means it has drifted, red means do something.
//
// TWO STEPS PER WING, NOT FIVE, and that is the design rather than an omission. A ramp
// with eleven positions asks the reader to compare shades; three colours ask nothing at
// all. Both wings carry the same pair because the message is about DISTANCE from optimal,
// not about direction: too cold and too hot are equally wrong, and this palette says so.
//
// A profile with more reach than the palette collapses onto what the palette has, which
// is the whole point of anchoring both at optimal. On the built-in profiles, whose reach
// is five steps:
//
//   deviation   +-1   +-2   +-3   +-4   +-5
//   colour      amber amber red   red   red
//
// CO2 and PM2.5 read the same way upwards and never ask for the `below` wing at all.
//
// Measured: neighbouring steps sit dE00 49 and 38 apart, contrast is 2,17 : 1 on a light
// card and 4,00 : 1 on a dark one.
//
// DELIBERATELY NOT measured against colour vision deficiency. Green against red is
// precisely the pair red-green deficiency loses, so this palette collapses for roughly
// one man in twelve — by construction, because those are the colours a traffic light is
// made of. Holding it to that standard would be measuring it against a goal it does not
// have; `color-vision` is the palette for that, and the readme points at it here.

export const signal = {
  id: "signal",
  tunedFor: "any",
  optimal: "#1DB85D",
  above: ["#FD9808", "#EE2046"],
  below: ["#FD9808", "#EE2046"],
};
