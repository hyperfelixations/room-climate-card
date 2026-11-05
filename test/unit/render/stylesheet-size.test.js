"use strict";

// The size factors in the stylesheet. At factor 1 every slice writes the pinned bytes
// (test/baseline/styles/full.css, checked by the characterization layer); at any other factor
// every length scales by exactly the factor of the one part that owns it. Strokes keep their
// width — borders, the focus ring, a metric card's inset highlight — and so does a pill's 999px
// radius. CSS comments read the same at every size. See internal dev doc §5 "Kartengröße".

const test = require("node:test");
const assert = require("node:assert/strict");

let styles;
let size;

test.before(async () => {
  styles = await import("../../../src/styles/index.js");
  size = await import("../../../src/core/size.js");
});

const VIEW_HEIGHT = 70;

// The view-area height arrives already scaled by the panel factor, as the view model hands it over.
function stylesheet(factors) {
  const sized = { ...size.UNSCALED_SIZE, ...factors };
  return styles.buildStyles({ keyframes: "", trackAnimationCss: "", viewCount: 2, viewWidthPct: 50, viewHeight: VIEW_HEIGHT * sized.panel, size: sized });
}

const LENGTH = /(-?(?:\d+\.?\d*|\.\d+))px/g;

// Lengths outside comments; a comment is blanked to its own length so indices still match.
function lengths(css) {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length));
  return [...code.matchAll(LENGTH)].map((match) => ({ text: match[1], value: Number(match[1]), index: match.index }));
}

// The declaration a length stands in, from its property to the semicolon or closing parenthesis.
function declarationAt(css, index) {
  const start = Math.max(css.lastIndexOf(";", index), css.lastIndexOf("{", index)) + 1;
  const ends = [css.indexOf(";", index), css.indexOf("{", index)].filter((at) => at >= 0);
  return css.slice(start, Math.min(...ends)).trim().replace(/\s+/g, " ");
}

const STROKE = /^(border(-[a-z]+)?|outline(-offset)?)\s*:|^box-shadow: inset 0 1px 0 /;

test("every length belongs to exactly one size part and scales by exactly its factor", () => {
  const css = stylesheet({});
  const base = lengths(css);
  const owner = new Array(base.length).fill(null);
  for (const part of size.SIZE_PARTS) {
    const scaled = lengths(stylesheet({ [part]: 2 }));
    assert.equal(scaled.length, base.length, `${part}: the stylesheet keeps its lengths`);
    scaled.forEach((length, i) => {
      if (length.value === base[i].value) return;
      const where = declarationAt(css, base[i].index);
      assert.equal(length.value, base[i].value * 2, `${part} doubles ${where}`);
      assert.equal(owner[i], null, `${where} is owned by ${owner[i]} and by ${part}`);
      owner[i] = part;
    });
  }
  const unscaled = base.filter((_, i) => owner[i] === null).map((length) => declarationAt(css, length.index));
  for (const declaration of unscaled) {
    assert.ok(STROKE.test(declaration) || /(?<![\d.])999px/.test(declaration), `a length no part scales: ${declaration}`);
  }
  for (const part of size.SIZE_PARTS) {
    assert.ok(owner.includes(part), `${part} owns lengths`);
  }
});

test("each part scales its own region of the card", () => {
  assert.match(stylesheet({ shell: 2 }), /@container rtc-card \(max-width: 920px\)/, "shell: the narrow layout's breakpoint");
  assert.match(stylesheet({ shell: 2 }), /--rtc-radius: 40px;/, "shell: the corner radius");
  assert.match(stylesheet({ header: 2 }), /\.rtc-icon-badge \{[^}]*width: 78px;/, "header: the icon badge");
  assert.match(stylesheet({ header: 2 }), /\.rtc-title \{[^}]*font-size: 42px;/, "header: the title");
  assert.match(stylesheet({ panel: 2 }), /\.rtc-avg-value \{[^}]*font-size: 66px;/, "panel: the headline value");
  assert.match(stylesheet({ panel: 2 }), /--rtc-view-height: 140px;[^}]*--rtc-view-height-narrow: 148px;/, "panel: the view area");
  assert.match(stylesheet({ rooms: 2 }), /\.rtc-room-value \{[^}]*font-size: 34px;/, "rooms: the chip value");
  assert.match(stylesheet({ rooms: 2 }), /\.rtc-room-mark \{[^}]*width: 30px;/, "rooms: the chip mark");
});

test("a factor that is not a whole number writes lengths with at most four decimals", () => {
  for (const factor of [1.25, 1.33333, 1.7]) {
    const sized = Object.fromEntries(size.SIZE_PARTS.map((part) => [part, factor]));
    for (const length of lengths(stylesheet(sized))) {
      assert.match(length.text, /^-?\d*(\.\d{1,4})?$/, `${factor}: ${length.text}px`);
      assert.doesNotMatch(length.text, /^-?0\.|\.\d*0$/, `${factor}: ${length.text}px is written like the pinned bytes`);
    }
  }
});

test("CSS comments are the same bytes at every size", () => {
  const comments = (css) => css.match(/\/\*[\s\S]*?\*\//g);
  const base = comments(stylesheet({}));
  assert.ok(base.length > 20);
  assert.deepEqual(comments(stylesheet({ shell: 1.5, header: 2, panel: 1.25, rooms: 1.75 })), base);
});
