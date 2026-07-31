"use strict";

// Small, dependency-free seeded PRNG (mulberry32) for the permanent
// randomized/property tests — deliberately not
// a `fast-check` dependency, consistent with this project's minimal-tooling
// philosophy (only jsdom + @playwright/test as devDependencies). Fully
// deterministic for a given seed, so a CI run is exactly reproducible; the
// default seed used across the standard test run is 0xC1A6E (see
// randomized-extremes.property.test.js), with ROOM_CLIMATE_CARD_FUZZ_SEEDS
// available for ad-hoc additional-seed runs through the package.json
// `test:fuzz` script.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class SeededRandom {
  constructor(seed) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
  }

  // [0, 1)
  float() {
    return this._next();
  }

  // Integer in [min, max], inclusive both ends.
  int(min, max) {
    return Math.floor(this.float() * (max - min + 1)) + min;
  }

  // A number in [min, max], with `digits` decimal places (default 1).
  number(min, max, digits = 1) {
    const value = this.float() * (max - min) + min;
    return Number(value.toFixed(digits));
  }

  pick(array) {
    return array[this.int(0, array.length - 1)];
  }

  bool(trueProbability = 0.5) {
    return this.float() < trueProbability;
  }

  // A short randomized string (letters/digits/a few HTML-significant
  // characters, for XSS-fuzzing room names) of length in [minLen, maxLen].
  string(minLen, maxLen) {
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 <>&\"'äöüß";
    const len = this.int(minLen, maxLen);
    let out = "";
    for (let i = 0; i < len; i++) out += alphabet[this.int(0, alphabet.length - 1)];
    return out;
  }
}

module.exports = { SeededRandom, mulberry32 };
