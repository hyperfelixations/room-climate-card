// SHIPPED STYLESHEET SLICE: header parts and the main panel below them.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.

export const HEADER_CSS = `        .rtc-header {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 11px;
          align-items: center;
          min-width: 0;
        }

        .rtc-icon-badge {
          width: 39px;
          height: 39px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--tone-soft);
          border: 1px solid var(--tone-border);
        }

        .rtc-icon-badge ha-icon {
          width: 22px;
          height: 22px;
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
          font-size: 21px;
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
          margin-top: 4px;
          font-size: 12px;
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
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
          color: var(--tone-ink);
          background: var(--tone-soft);
          border: 1px solid var(--tone-border);
        }

        /* Let the headline grow beyond its 106px floor while the adjacent view keeps at least
           40% of a definite panel width; min-width:0 on the rotator permits negotiation. */
        .rtc-main-panel {
          display: grid;
          grid-template-columns: minmax(106px, auto) minmax(40%, 1fr);
          gap: 8px;
          align-items: center;
          border-radius: 17px;
          padding: 9px 10px;
          background: var(--rtc-panel);
          border: 1px solid var(--rtc-hairline);
        }

`;
