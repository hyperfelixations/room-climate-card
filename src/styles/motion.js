// SHIPPED STYLESHEET SLICE: reduced-motion overrides.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.

export const MOTION_CSS = `        @media (prefers-reduced-motion: reduce) {
          /* Disables the auto animation; transform isn't !important, so manual swiping still works. */
          .rtc-track {
            animation: none !important;
            transition: none !important;
          }
        }
      `;
