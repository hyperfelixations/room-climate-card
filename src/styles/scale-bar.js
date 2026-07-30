// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The bar itself: bands, markers, edge labels and the footer — shared by both scale views.

export const SCALE_BAR_CSS = `        .rtc-scale-bar {
          position: relative;
          height: 9px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
          overflow: visible;
          border: 1px solid var(--rtc-hairline);
        }

        .rtc-comfort-band,
        .rtc-optimal-band,
        .rtc-marker {
          position: absolute;
          top: 0;
          bottom: 0;
        }

        .rtc-comfort-band {
          background: color-mix(in srgb, var(--primary-text-color) 10%, transparent);
          z-index: 1;
        }

        .rtc-optimal-band {
          background: var(--tone-band);
          z-index: 2;
        }

        .rtc-marker {
          top: 50%;
          transform: translate(-50%, -50%);
          width: 4px;
          height: 17px;
          border-radius: 999px;
          background: var(--marker-color);
          box-shadow: 0 0 0 3px var(--marker-shadow);
        }

        .rtc-marker-cold { z-index: 4; }
        .rtc-marker-warm { z-index: 5; }
        .rtc-marker-room {
          height: 13px;
          z-index: 4;
        }
        .rtc-marker-avg {
          height: 15px;
          z-index: 6;
        }
        .rtc-marker-avg.rtc-marker-emphasized {
          height: 19px;
        }

        .rtc-scale-labels {
          position: relative;
          height: 12px;
          font-size: 10px;
          font-weight: 750;
          color: var(--rtc-faint);
          white-space: nowrap;
        }

        .rtc-scale-labels span {
          position: absolute;
          top: 0;
          /* Ellipsis only actually engages on .rtc-scale-label-center, and
             only when _resolveOptimalLabelPosition() sets an explicit
             max-width (no non-overlapping position fits) — harmless no-op
             on min/max, which never get a max-width. */
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rtc-scale-label-min { left: 0; }
        .rtc-scale-label-center { transform: translateX(-50%); }
        .rtc-scale-label-max { right: 0; }

        .rtc-scale-footer {
          font-size: 10.5px;
          font-weight: 750;
          color: var(--rtc-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rtc-extremes-view,
`;
