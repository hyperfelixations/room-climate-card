// CSS lengths written the way the shipped stylesheet writes them: at most four decimals, no
// trailing zeros, no leading zero (`.04em`), and a bare `0`.

function cssNumber(value) {
  const text = String(Math.round(value * 10000) / 10000);
  return text.replace(/^(-?)0\./, "$1.");
}

export function px(value) {
  return value === 0 ? "0" : `${cssNumber(value)}px`;
}

export function em(value) {
  return value === 0 ? "0" : `${cssNumber(value)}em`;
}
