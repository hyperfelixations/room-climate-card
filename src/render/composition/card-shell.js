// The card shell: the frame every view is mounted into.
//
// Header, average, view area, room chips. The shell knows the SHAPE of the card and
// nothing about any individual view — it never names "scale" or "range_scale", never
// imports the view registry, and cannot: the registry is a separate group of the same
// architectural layer, so the only way it arrives here is as an argument from the
// composition root. That is what makes adding a view a change in two places
// (a definition and a module) rather than three.
//
// The layout hook works the same way. A view MAY declare resolveLayout(); the shell
// calls it on whichever views declare one, in registry order, without knowing what any
// of them measure.
//
// NOTE ON WHITESPACE: the indentation INSIDE the template literals is shipped markup
// and is captured verbatim by the DOM characterization baselines.

import { escapeHtml } from "../../core/text.js";
import { renderAverage, updateAverage } from "../primitives/average.js";
import { renderRoomGridRows, updateRoomGrid } from "../primitives/room-grid.js";

// The two null-view states are deliberately different. A configuration that genuinely
// asks for nothing collapses the view area entirely — no markup at all, so a card
// intentionally configured without views does not display a hint that looks like a
// misconfiguration. A view that WAS requested but is systemically unavailable shows a
// localized hint instead, because that case genuinely is something the user should
// notice and can fix.
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
    // The solo path uses the same generic lookup as the carousel path: one view, one
    // renderer call, no special-casing of which view it happens to be. Hardcoding a
    // view here would break the moment a configuration omits it.
    return `
          <div class="rtc-rotator-solo">${renderView(keys[0])}</div>
        `;
  }
  if (viewModel.views.collapsed) return "";
  return `<div class="rtc-rotator-solo rtc-no-views">${escapeHtml(viewModel.carousel.noActiveViewsHint)}</div>`;
}

// What the card's MARKUP looks like, as one comparable value.
//
// A DOM patcher can only change nodes that exist. Every optional part of the markup is
// therefore a structural decision: when its presence changes, patching cannot express
// it and the card has to be rebuilt. This composes exactly those decisions — the
// shell's own, plus whatever each view declares about itself — so that the render
// controller can compare one value instead of maintaining a list of booleans that
// silently omits whatever nobody remembered to add.
//
// The rule for a view's own contribution is precise: list the optional nodes the view
// does NOT reconcile in its patch(). Anything it does reconcile must stay out, or a
// routine data change would cost a full rebuild and reset the carousel.
//
// A view without a structureSignature() is declaring that it reconciles everything.
export function cardStructureSignature(viewModel, viewRenderers) {
  const parts = [
    `state:${viewModel.empty ? "no-data" : "data"}`,
    `chips:${viewModel.rooms.showChips ? 1 : 0}`,
    // The headline's caption is a NODE that is either there or not (see
    // renderAverage()). A patch can change its text; it cannot create or delete it, so
    // its presence has to force a rebuild.
    `avgLabel:${viewModel.average.hasLabel ? 1 : 0}`,
    `views:${viewModel.views.keys.join(",")}`,
    `collapsed:${viewModel.views.collapsed ? 1 : 0}`,
  ];
  if (viewModel.empty) {
    // These are the no-data structures a text patch cannot create or remove.
    // The keyed grid still reconciles individual chips while it remains present.
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

  // tabindex="-1": out of the normal tab order, but focusable programmatically — the
  // last-resort focus fallback target when a focused element disappears and no average
  // button exists to fall back to instead.
  return `
        <div class="rtc-root" data-state="${viewModel.empty ? "no-data" : "data"}" data-metric="${escapeHtml(viewModel.metric.kind)}" style="${viewModel.toneStyle}" tabindex="-1">
          <div class="rtc-top-line"></div>

          <div class="rtc-header">
            <div class="rtc-icon-badge" aria-hidden="true">
              <ha-icon icon="${escapeHtml(viewModel.header.icon)}"></ha-icon>
            </div>

            <div class="rtc-title-block">
              <div class="rtc-title">${escapeHtml(viewModel.header.title)}</div>
              <div class="rtc-subtitle">${escapeHtml(viewModel.header.subtitle)}</div>
            </div>

            <div class="rtc-status-pill">${escapeHtml(viewModel.header.statusLabel)}</div>
          </div>

          <div class="rtc-main-panel">
            <div class="rtc-average">${renderAverage(viewModel)}</div>

            ${renderViewArea(context, viewModel, viewRenderers)}
          </div>

          ${roomGrid}
        </div>
      `;
}

// The partial update: only text, colours, markers and the dynamic subsections change,
// so the slide animation never restarts. Each view patches its own subsection; a view
// that is not currently mounted is a no-op through its own container guard.
function patchShell(context, root, viewModel) {
  if (!root) return;

  const contentRoot = root.querySelector(".rtc-root");
  if (contentRoot) {
    contentRoot.setAttribute("style", viewModel.toneStyle);
    contentRoot.setAttribute("data-state", viewModel.empty ? "no-data" : "data");
    contentRoot.setAttribute("data-metric", viewModel.metric.kind || "");
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

// Re-resolves every mounted view's own measured layout. The single entry point for
// triggers that neither know nor care which views currently exist: the initial render,
// a resize, and the web font finishing loading.
export function resolveViewLayouts(context, root, viewModel, viewRenderers) {
  if (!root || !viewModel || viewModel.empty) return;
  for (const view of viewRenderers) {
    if (typeof view.resolveLayout === "function") view.resolveLayout(context, root, viewModel);
  }
}
