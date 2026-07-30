// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The reduced-motion overrides.

export const MOTION_CSS = `        @media (prefers-reduced-motion: reduce) {
          /* Disables the auto animation; transform isn't !important, so manual swiping still works. */
          .rtc-track {
            animation: none !important;
            transition: none !important;
          }
        }
      `;
