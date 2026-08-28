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
// Emitted only when it is not the default, so the ordinary card's markup is byte for byte
// what it has always been — the wrapping rule in styles/header.js hangs off this attribute
// and does nothing without it. Patched rather than made structural: it changes how one
// element behaves, not which elements exist.
function subtitleOverflowAttribute(viewModel) {
  return viewModel.header.subtitleOverflow === "wrap" ? ` data-subtitle="wrap"` : "";
}

// The same for the line above it, and mirrored: the title WRAPS by default, so `clip` is
// the departure worth writing down. Two attributes rather than one shared value, because a
// card may well want the title clipped and the subtitle wrapped.
function titleOverflowAttribute(viewModel) {
  return viewModel.header.titleOverflow === "clip" ? ` data-title="clip"` : "";
}

// WHICH HEADER PARTS EXIST, for the stylesheet to lay out the row with.
//
// The header is a three-column grid, and a column that holds nothing still brings its gap:
// dropping the icon without saying so would leave the title 11px from the left edge instead
// of at it. So the parts that ARE present travel to the CSS, which carries one override per
// subset.
//
// Emitted only when something is missing, so the ordinary card's markup and the ordinary
// card's cascade are both untouched — the same rule the two overflow attributes follow. The
// value is built from the very booleans that decide the markup below, so there is no second
// derivation that could drift from what was actually rendered.
function headerPartsAttribute(parts) {
  const present = ["icon", "title", "pill"].filter((name) => parts[name]);
  return present.length === 3 ? "" : ` data-parts="${present.join(" ")}"`;
}

// The bar across the top edge, and the whitespace that follows it.
//
// Both, together, because the indentation inside these template literals is shipped markup:
// emitting the node and its trailing blank line as ONE piece is what makes the default byte
// for byte what it has always been, and what makes its absence a clean absence rather than a
// blank line where an element used to be. `accent_line: false` therefore leaves the header as
// the first thing inside the content root — the card ends at its top edge the way it ends at
// its bottom one, with nothing put in the line's place.
function accentLineMarkup(viewModel) {
  return viewModel.accentLine ? `<div class="rtc-top-line"></div>\n\n          ` : "";
}

export function cardStructureSignature(viewModel, viewRenderers) {
  const parts = [
    `state:${viewModel.empty ? "no-data" : "data"}`,
    `chips:${viewModel.rooms.showChips ? 1 : 0}`,
    // The headline's caption is a NODE that is either there or not (see
    // renderAverage()). A patch can change its text; it cannot create or delete it, so
    // its presence has to force a rebuild.
    `avgLabel:${viewModel.average.hasLabel ? 1 : 0}`,
    // Same reason as avgLabel: a patch can change the subtitle's text, it cannot create
    // or delete the node.
    `subtitle:${viewModel.header.hasSubtitle ? 1 : 0}`,
    // And the same reason again for the rest of the parts the `show:` block governs. They
    // are signed HERE rather than in structuralConfigSignature(), because a node the view
    // model decides about belongs with the two above it — one mechanism for one kind of
    // thing, so the two can never disagree about which of them is the truth.
    `accentLine:${viewModel.accentLine ? 1 : 0}`,
    `icon:${viewModel.header.hasIcon ? 1 : 0}`,
    `title:${viewModel.header.hasTitle ? 1 : 0}`,
    `pill:${viewModel.header.hasPill ? 1 : 0}`,
    `panel:${viewModel.hasPanel ? 1 : 0}`,
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

  // `subtitle: ""` asks for no line, and no line means no NODE: an empty div still takes
  // its margin and its line box, which is not what "remove it" looks like. Its presence is
  // therefore structural and appears in cardStructureSignature() below, exactly like the
  // headline's caption.
  const subtitle = viewModel.header.hasSubtitle
    ? `<div class="rtc-subtitle">${escapeHtml(viewModel.header.subtitle)}</div>`
    : "";

  const parts = {
    icon: viewModel.header.hasIcon,
    // The block, not the line: a card with only a subtitle still needs the box that
    // positions it, and a card with neither needs no column at all.
    title: viewModel.header.hasTitle || viewModel.header.hasSubtitle,
    pill: viewModel.header.hasPill,
  };
  const header = headerMarkup(viewModel, parts, subtitle);
  const panel = mainPanelMarkup(context, viewModel, viewRenderers);

  // NOTHING LEFT TO DRAW is a state the card has to say something about. An empty card is
  // indistinguishable from a broken one, and the configuration that produced it is a
  // handful of switches somebody can undo — so the card says which ones.
  //
  // The bar across the top does not count as content: it is three pixels of colour and
  // makes no statement. Whether it is drawn is therefore not part of this question.
  const body = header || panel || roomGrid
    ? `${header}${panel}${roomGrid}`
    : `<div class="rtc-nothing-shown">${escapeHtml(viewModel.hiddenHint)}</div>`;

  // tabindex="-1": out of the normal tab order, but focusable programmatically — the
  // last-resort focus fallback target when a focused element disappears and no average
  // button exists to fall back to instead.
  return `
        <div class="rtc-root" data-state="${viewModel.empty ? "no-data" : "data"}" data-metric="${escapeHtml(viewModel.metric.kind)}"${titleOverflowAttribute(viewModel)}${subtitleOverflowAttribute(viewModel)}${headerPartsAttribute(parts)} style="${viewModel.toneStyle}" tabindex="-1">
          ${accentLineMarkup(viewModel)}${body}
        </div>
      `;
}

// The header row, and the blank line that follows it — one piece, for the reason
// accentLineMarkup() gives: the indentation in these template literals is shipped markup,
// and a part has to take its own separator with it or leave a hole where it used to be.
//
// The three children are joined rather than written out, which is what makes the default
// provably unchanged: with all three present the join reproduces the same bytes the
// hand-written template produced, and with one missing there is no leftover blank line.
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

// The middle block: the headline and the views beside it, with the same trailing separator
// rule. Hiding it is a layout decision only — every room still feeds the extrema, the
// comfort count and the spread, exactly as a hidden chip grid does.
function mainPanelMarkup(context, viewModel, viewRenderers) {
  if (!viewModel.hasPanel) return "";
  return `<div class="rtc-main-panel">
            <div class="rtc-average">${renderAverage(viewModel)}</div>

            ${renderViewArea(context, viewModel, viewRenderers)}
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

// Re-resolves every mounted view's own measured layout. The single entry point for
// triggers that neither know nor care which views currently exist: the initial render,
// a resize, and the web font finishing loading.
export function resolveViewLayouts(context, root, viewModel, viewRenderers) {
  if (!root || !viewModel || viewModel.empty) return;
  for (const view of viewRenderers) {
    if (typeof view.resolveLayout === "function") view.resolveLayout(context, root, viewModel);
  }
}
