// Which known key a mistyped one was probably meant to be, for every place the card refuses an
// unknown key. See internal dev doc §3 "Der Schlüsselvertrag".

// Max edit distance for a suggestion: 2 covers a dropped/doubled character, a
// transposition, or a separator written the other way (`tap-action`, `tapAction`).
const SUGGESTION_LIMIT = 2;

// Levenshtein distance, abandoned as soon as it cannot come in under `limit`. The
// early exits bound the cost for an arbitrarily long key pasted in by accident.
function editDistance(one, other, limit) {
  if (Math.abs(one.length - other.length) > limit) return limit + 1;
  let previous = Array.from({ length: other.length + 1 }, (_, index) => index);
  for (let row = 1; row <= one.length; row++) {
    const current = [row];
    let best = row;
    for (let column = 1; column <= other.length; column++) {
      const substitution = previous[column - 1] + (one[row - 1] === other[column - 1] ? 0 : 1);
      current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, substitution);
      best = Math.min(best, current[column]);
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[other.length];
}

// The one allowed key a written one was probably meant to be, or null — only when it
// is the single closest one (a tie is ambiguous, so it stays silent). Case-insensitive
// match; the suggestion is spelled the way the option really is.
export function nearestKey(written, allowed) {
  const needle = String(written).toLowerCase();
  let best = null;
  let bestDistance = SUGGESTION_LIMIT + 1;
  let ties = 0;
  for (const candidate of allowed) {
    const distance = editDistance(needle, candidate.toLowerCase(), SUGGESTION_LIMIT);
    if (distance > SUGGESTION_LIMIT) continue;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      ties = 1;
    } else if (distance === bestDistance) {
      ties += 1;
    }
  }
  return ties === 1 ? best : null;
}
