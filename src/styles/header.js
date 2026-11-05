// SHIPPED STYLESHEET SLICE: header parts, the warnings block and the main panel below them.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.

import { px } from "./css-units.js";

export function headerCss({ shell, header, panel }) {
  return `        .rtc-header {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: ${px(11, header)};
          align-items: center;
          min-width: 0;
        }

        .rtc-icon-badge {
          width: ${px(39, header)};
          height: ${px(39, header)};
          border-radius: ${px(14, header)};
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--tone-soft);
          border: 1px solid var(--tone-border);
        }

        .rtc-icon-badge ha-icon {
          width: ${px(22, header)};
          height: ${px(22, header)};
          color: var(--tone-ink);
        }

        /* Remove absent header columns and their gaps; the full header needs no override.
           Right-align a lone pill only when its remaining track stretches. */
        .rtc-root[data-parts="icon title"] .rtc-header {
          grid-template-columns: auto 1fr;
        }

        .rtc-root[data-parts="icon pill"] .rtc-header {
          grid-template-columns: auto 1fr;
        }

        .rtc-root[data-parts="title pill"] .rtc-header {
          grid-template-columns: 1fr auto;
        }

        .rtc-root[data-parts="icon"] .rtc-header {
          grid-template-columns: auto;
        }

        .rtc-root[data-parts="title"] .rtc-header {
          grid-template-columns: 1fr;
        }

        .rtc-root[data-parts="pill"] .rtc-header {
          grid-template-columns: 1fr;
        }

        .rtc-root[data-parts="icon pill"] .rtc-status-pill,
        .rtc-root[data-parts="pill"] .rtc-status-pill {
          justify-self: end;
        }

        .rtc-title-block {
          min-width: 0;
        }

        .rtc-title {
          font-size: ${px(21, header)};
          font-weight: 920;
          line-height: 1.05;
          color: var(--primary-text-color);
        }

        /* Title wraps by default; this attribute opts into clipping. */
        .rtc-root[data-title="clip"] .rtc-title {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rtc-subtitle {
          margin-top: ${px(4, header)};
          font-size: ${px(12, header)};
          font-weight: 650;
          line-height: 1.25;
          color: var(--rtc-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Subtitle clips by default; this attribute opts into wrapping. anywhere breaks
           otherwise-unbreakable entity ids in no-data explanations. */
        .rtc-root[data-subtitle="wrap"] .rtc-subtitle {
          white-space: normal;
          overflow: visible;
          text-overflow: clip;
          overflow-wrap: anywhere;
        }

        .rtc-status-pill {
          padding: ${px(6, header)} ${px(10, header)};
          border-radius: 999px;
          font-size: ${px(12, header)};
          font-weight: 900;
          white-space: nowrap;
          color: var(--tone-ink);
          background: var(--tone-soft);
          border: 1px solid var(--tone-border);
        }

        /* Tint and symbol derive from the theme's warning colour; the text keeps the primary
           colour, which stays legible on the light tint in either theme. */
        .rtc-warning {
          display: flex;
          align-items: flex-start;
          gap: ${px(8, shell)};
          padding: ${px(8, shell)} ${px(10, shell)};
          border-radius: ${px(14, shell)};
          background: var(--rtc-warning-bg);
          border: 1px solid var(--rtc-warning-border);
          color: var(--primary-text-color);
          font-size: ${px(12, shell)};
          font-weight: 650;
          line-height: 1.3;
        }

        .rtc-warning-icon {
          flex: 0 0 ${px(16, shell)};
          width: ${px(16, shell)};
          height: ${px(16, shell)};
          fill: var(--rtc-warning-ink);
        }

        .rtc-warning-text {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        /* Let the headline grow beyond its 106px floor while the adjacent view keeps at least
           40% of a definite panel width; min-width:0 on the rotator permits negotiation. */
        .rtc-main-panel {
          display: grid;
          grid-template-columns: minmax(${px(106, panel)}, auto) minmax(40%, 1fr);
          gap: ${px(8, panel)};
          align-items: center;
          border-radius: ${px(17, panel)};
          padding: ${px(9, panel)} ${px(10, panel)};
          background: var(--rtc-panel);
          border: 1px solid var(--rtc-hairline);
        }

`;
}
