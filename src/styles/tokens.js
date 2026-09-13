// SHIPPED STYLESHEET SLICE: auto-slide keyframes and design tokens.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.

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
          --rtc-warning: var(--warning-color, #ffa600);
          --rtc-warning-bg: color-mix(in srgb, var(--rtc-warning) 14%, transparent);
          --rtc-warning-border: color-mix(in srgb, var(--rtc-warning) 45%, transparent);
          --rtc-warning-ink: color-mix(in srgb, var(--rtc-warning) 62%, var(--primary-text-color));
          -webkit-tap-highlight-color: transparent;
        }

`;
}
