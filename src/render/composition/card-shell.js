// View-agnostic card shell; registry-injected renderers optionally own resolveLayout().
// Template-literal indentation is shipped markup and baseline-pinned; see internal dev doc §4 "Render-Primitive-/Composition-Vertrag".

import { escapeHtml } from "../../core/text.js";
import { renderAverage, updateAverage } from "../primitives/average.js";
import { renderRoomGridRows, updateRoomGrid } from "../primitives/room-grid.js";

// Requested-none collapses; requested-but-unavailable renders a localized hint.
function renderViewArea(context, viewModel, viewRenderers) {
  const keys = viewModel.views.keys;
  const byKey = new Map(viewRenderers.map((view) => [view.key, view]));
  const renderView = (key) => byKey.get(key).render(context, viewModel);

  if (keys.length >= 2) {
    return `
          <div class="rtc-rotator" aria-live="off" title="${escapeHtml(viewModel.carousel.hint)}">
            <div class="rtc-track">
              ${keys.map((key) => `<div class="rtc-view">${renderView(key)}</div>`).join("")}
            </div>
          </div>
        `;
  }
  if (keys.length === 1) {
    // Solo rendering uses the same registry lookup as the carousel.
    return `
          <div class="rtc-rotator-solo">${renderView(keys[0])}</div>
        `;
  }
  if (viewModel.views.collapsed) return "";
  return `<div class="rtc-rotator-solo rtc-no-views">${escapeHtml(viewModel.carousel.noActiveViewsHint)}</div>`;
}

// Structural signatures list optional nodes patch() cannot create/remove; views without one
// reconcile all their structure. Overflow attributes are patchable behavior, not structure.
function subtitleOverflowAttribute(viewModel) {
  return viewModel.header.subtitleOverflow === "wrap" ? ` data-subtitle="wrap"` : "";
}

// Title wraps by default; separate attributes allow title/subtitle policies to differ.
function titleOverflowAttribute(viewModel) {
  return viewModel.header.titleOverflow === "clip" ? ` data-title="clip"` : "";
}

// Tell the three-column CSS which parts exist; omit the attribute for the default full header.
function headerPartsAttribute(parts) {
  const present = ["icon", "title", "pill"].filter((name) => parts[name]);
  return present.length === 3 ? "" : ` data-parts="${present.join(" ")}"`;
}

// Emit the accent line with its shipped separator so absence leaves no whitespace hole.
function accentLineMarkup(viewModel) {
  return viewModel.accentLine ? `<div class="rtc-top-line"></div>\n\n          ` : "";
}

export function cardStructureSignature(viewModel, viewRenderers) {
  const parts = [
    `state:${viewModel.empty ? "no-data" : "data"}`,
    `chips:${viewModel.rooms.showChips ? 1 : 0}`,
    // Patches change text but cannot create/remove the headline caption.
    `avgLabel:${viewModel.average.hasLabel ? 1 : 0}`,
    // Subtitle node presence is structural for the same reason.
    `subtitle:${viewModel.header.hasSubtitle ? 1 : 0}`,
    // View-model-owned optional nodes share this one signature mechanism.
    `accentLine:${viewModel.accentLine ? 1 : 0}`,
    `icon:${viewModel.header.hasIcon ? 1 : 0}`,
    `title:${viewModel.header.hasTitle ? 1 : 0}`,
    `pill:${viewModel.header.hasPill ? 1 : 0}`,
    `panel:${viewModel.hasPanel ? 1 : 0}`,
    `views:${viewModel.views.keys.join(",")}`,
    `collapsed:${viewModel.views.collapsed ? 1 : 0}`,
  ];
  if (viewModel.empty) {
    // No-data nodes are structural; the keyed grid still reconciles its chips.
    parts.push(`avgButton:${viewModel.average.entity ? 1 : 0}`);
    parts.push(`hint:${viewModel.noData.hintKind}`);
    return parts.join("|");
  }
  for (const view of viewRenderers) {
    const content = viewModel.views.byKey[view.key];
    if (!content || typeof view.structureSignature !== "function") continue;
    parts.push(`${view.key}:${view.structureSignature(content)}`);
  }
  return parts.join("|");
}

export function renderCardBody(context, viewModel, viewRenderers) {
  const roomGrid = viewModel.rooms.showChips
    ? `
          <div class="rtc-room-grid">
            ${renderRoomGridRows(viewModel)}
          </div>
        `
    : "";

  // Empty subtitle means no node; its presence is therefore structural.
  const subtitle = viewModel.header.hasSubtitle
    ? `<div class="rtc-subtitle">${escapeHtml(viewModel.header.subtitle)}</div>`
    : "";

  const parts = {
    icon: viewModel.header.hasIcon,
    // Subtitle alone still needs the positioning block.
    title: viewModel.header.hasTitle || viewModel.header.hasSubtitle,
    pill: viewModel.header.hasPill,
  };
  const header = headerMarkup(viewModel, parts, subtitle);
  const panel = mainPanelMarkup(context, viewModel, viewRenderers);

  // If header, panel and rooms are all hidden, explain the reversible configuration state.
  // The decorative accent line does not count as content.
  const body = header || panel || roomGrid
    ? `${header}${panel}${roomGrid}`
    : `<div class="rtc-nothing-shown">${escapeHtml(viewModel.hiddenHint)}</div>`;

  // Programmatic last-resort focus target, excluded from normal tab order.
  return `
        <div class="rtc-root" data-state="${viewModel.empty ? "no-data" : "data"}" data-metric="${escapeHtml(viewModel.metric.kind)}"${titleOverflowAttribute(viewModel)}${subtitleOverflowAttribute(viewModel)}${headerPartsAttribute(parts)} style="${viewModel.toneStyle}" tabindex="-1">
          ${accentLineMarkup(viewModel)}${body}
        </div>
      `;
}

// Join header children with their shipped separators so omissions leave no whitespace holes.
function headerMarkup(viewModel, parts, subtitle) {
  const children = [];
  if (parts.icon) {
    children.push(`<div class="rtc-icon-badge" aria-hidden="true">
              <ha-icon icon="${escapeHtml(viewModel.header.icon)}"></ha-icon>
            </div>`);
  }
  if (parts.title) {
    const title = viewModel.header.hasTitle
      ? `<div class="rtc-title">${escapeHtml(viewModel.header.title)}</div>
              `
      : "";
    children.push(`<div class="rtc-title-block">
              ${title}${subtitle}
            </div>`);
  }
  if (parts.pill) {
    children.push(`<div class="rtc-status-pill">${escapeHtml(viewModel.header.statusLabel)}</div>`);
  }
  if (!children.length) return "";
  return `<div class="rtc-header">
            ${children.join("\n\n            ")}
          </div>

          `;
}

// Panel visibility changes layout only; hidden rooms still feed derived values.
function mainPanelMarkup(context, viewModel, viewRenderers) {
  if (!viewModel.hasPanel) return "";
  return `<div class="rtc-main-panel">
            <div class="rtc-average">${renderAverage(viewModel)}</div>

            ${renderViewArea(context, viewModel, viewRenderers)}
          </div>

          `;
}

// Patch dynamic content in place so routine updates never restart the slide animation.
function patchShell(context, root, viewModel) {
  if (!root) return;

  const contentRoot = root.querySelector(".rtc-root");
  if (contentRoot) {
    contentRoot.setAttribute("style", viewModel.toneStyle);
    contentRoot.setAttribute("data-state", viewModel.empty ? "no-data" : "data");
    contentRoot.setAttribute("data-metric", viewModel.metric.kind || "");
    if (viewModel.header.subtitleOverflow === "wrap") contentRoot.setAttribute("data-subtitle", "wrap");
    else contentRoot.removeAttribute("data-subtitle");
    if (viewModel.header.titleOverflow === "clip") contentRoot.setAttribute("data-title", "clip");
    else contentRoot.removeAttribute("data-title");
  }

  const iconEl = root.querySelector(".rtc-icon-badge ha-icon");
  if (iconEl) iconEl.setAttribute("icon", viewModel.header.icon);

  const titleEl = root.querySelector(".rtc-title");
  if (titleEl) titleEl.textContent = viewModel.header.title;

  const subtitleEl = root.querySelector(".rtc-subtitle");
  if (subtitleEl) subtitleEl.textContent = viewModel.header.subtitle;

  const statusEl = root.querySelector(".rtc-status-pill");
  if (statusEl) statusEl.textContent = viewModel.header.statusLabel;

  updateAverage(context, root, root.querySelector(".rtc-average"), viewModel);
  updateRoomGrid(context, root, root.querySelector(".rtc-room-grid"), viewModel);
}

export function patchCardBody(context, root, viewModel, viewRenderers) {
  patchShell(context, root, viewModel);

  for (const view of viewRenderers) view.patch(context, root, viewModel);
}

export function patchEmptyCardBody(context, root, viewModel) {
  patchShell(context, root, viewModel);
}

// Resolve mounted view layouts after initial render, resize or font settlement.
export function resolveViewLayouts(context, root, viewModel, viewRenderers) {
  if (!root || !viewModel || viewModel.empty) return;
  for (const view of viewRenderers) {
    if (typeof view.resolveLayout === "function") view.resolveLayout(context, root, viewModel);
  }
}
