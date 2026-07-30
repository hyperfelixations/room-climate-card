// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The design tokens, and the auto-slide keyframes that precede them.

export function tokensCss({ keyframes }) {
  return `
        ${keyframes}

        :host {
          display: block;
          --rtc-radius: 20px;
          --rtc-muted: var(--secondary-text-color);
          --rtc-faint: color-mix(in srgb, var(--secondary-text-color) 72%, transparent);
          --rtc-hairline: color-mix(in srgb, var(--divider-color, var(--primary-text-color)) 42%, transparent);
          --rtc-panel: color-mix(in srgb, var(--primary-text-color) 4%, transparent);
          --rtc-chip-bg: color-mix(in srgb, var(--primary-text-color) 3%, transparent);
          --rtc-card-border: color-mix(in srgb, var(--divider-color, var(--primary-text-color)) 70%, transparent);
          --rtc-top-overlay: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
          -webkit-tap-highlight-color: transparent;
        }

`;
}
