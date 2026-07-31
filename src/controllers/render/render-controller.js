// Who decides HOW the card is rendered, and what "already rendered" means.
//
// Three questions used to be answered by seven fields scattered across the custom
// element next to the configuration, the hass object and the DOM handles:
//
//   is a render needed at all?          the data signature
//   can it be a patch, or must the      the structure signature and the
//   markup be rebuilt?                  structural-config signature
//   what is currently on screen?        rendered / lastViewModel
//
// Nothing else owns those. The element supplies the inputs and performs the three
// render paths; this module decides which one runs and when the decision is committed.
//
// COMMIT ON SUCCESS is the rule that makes the whole thing safe. The signatures are the
// card's memory of what is on screen, so writing them before the render would mean a
// throwing render leaves behind a memory of a render that never happened — and the very
// next identical hass push would compare equal and be skipped, freezing the card on
// stale content until some unrelated update happened to differ. Every commit below
// therefore happens after the render path returns, never before.
//
// It holds no DOM, no clock, no configuration object and no view model of its own
// making: seven ports in, one decision out.

import { cardStructureSignature } from "../../render/composition/card-shell.js";

// Which path a render() call took. Returned rather than logged, so a test can assert
// "this hass update was a patch, not a rebuild" — the property the partial-update
// pipeline exists to provide — without reading private state or counting DOM writes.
export const RENDER_PATH = {
  // A gesture is in flight; the update is remembered and replayed when it ends.
  DEFERRED: "deferred",
  // Nothing that can affect the card changed.
  SKIPPED: "skipped",
  // The markup itself had to change.
  FULL: "full",
  // The card is in its empty state and stayed there.
  EMPTY: "empty",
  // Same markup, new values.
  CONTENT: "content",
};

export function createRenderController({
  viewRenderers,
  computeViewModel,
  isDragging,
  isCurrentlyEmpty,
  renderAll,
  updateEmpty,
  updateContent,
}) {
  // ---- owned state ----------------------------------------------------------
  let dataSignature = "";
  let structuralConfigSignature = null;
  let structureSignature = null;
  let rendered = false;
  let renderPending = false;
  let lastViewModel = null;
  // A transient snapshot taken by setConfig() before the new configuration is installed,
  // consumed by the one render that follows it. `undefined` means "no snapshot, compute
  // it live"; `null` is a real snapshot meaning "no view was visible", so the two cannot
  // be collapsed into one falsy check.
  let preConfigVisualKey = undefined;

  return {
    // ---- the decision ---------------------------------------------------------
    render({ dataSignature: nextDataSignature, structuralConfigSignature: nextStructuralConfig, allowSkip = true }) {
      // A hass update arriving mid-swipe cannot be rendered without jumping the track.
      // Remembering it is what stops it from being silently lost until some later,
      // unrelated update happens to arrive.
      if (isDragging()) {
        renderPending = true;
        return RENDER_PATH.DEFERRED;
      }

      // Deliberately before any model or view-model work: an unchanged signature means
      // an unchanged card, and computing a view model only to throw it away would make
      // every no-op hass push cost a full pipeline run.
      //
      // A skip settles an outstanding debt as much as a render does: the committed
      // signature equals the one being asked for, so whatever was deferred is already
      // what the card is showing.
      if (allowSkip && nextDataSignature === dataSignature) {
        renderPending = false;
        return RENDER_PATH.SKIPPED;
      }

      const viewModel = computeViewModel();
      const currentlyEmpty = isCurrentlyEmpty();
      // What the MARKUP would look like, as one comparable value: the chip grid, the
      // ordered view keys, the collapsed-vs-hint null-view state, and whatever each view
      // declares about its own optional nodes. A change here cannot be expressed by
      // patching, so it forces a rebuild — and because each view contributes its own
      // part, a new view or a new optional element extends the signature without this
      // module learning about it.
      const nextStructure = cardStructureSignature(viewModel, viewRenderers);

      const commit = () => {
        dataSignature = nextDataSignature;
        structuralConfigSignature = nextStructuralConfig;
        structureSignature = nextStructure;
        lastViewModel = viewModel;
        // Whatever was deferred, this render has now caught up with it. Clearing the
        // debt HERE rather than at the call site is what ties it to success: a render
        // path that throws leaves the obligation standing, and the next opportunity —
        // the end of the gesture, or the card being put back into the document — pays
        // it. Clearing it before the render would lose the update on any failure.
        renderPending = false;
      };

      const structureChanged = nextStructure !== structureSignature;
      const structuralConfigChanged = nextStructuralConfig !== structuralConfigSignature;

      if (!rendered || viewModel.empty !== currentlyEmpty || (!viewModel.empty && (structureChanged || structuralConfigChanged))) {
        // isFirstRender is passed in rather than read back afterwards: the render path
        // needs to know whether there is a previous view worth protecting, and it must
        // learn that before `rendered` flips.
        renderAll(viewModel, { isFirstRender: !rendered, preConfigVisualKey });
        rendered = true;
        commit();
        return RENDER_PATH.FULL;
      }

      if (viewModel.empty) {
        updateEmpty(viewModel);
        commit();
        return RENDER_PATH.EMPTY;
      }

      updateContent(viewModel);
      commit();
      return RENDER_PATH.CONTENT;
    },

    // ---- queries ---------------------------------------------------------------
    // The view model currently on screen. The resize and fonts triggers re-measure
    // against this rather than waiting for a hass update they have no reason to expect.
    get lastViewModel() {
      return lastViewModel;
    },
    get hasRendered() {
      return rendered;
    },
    // Whether an update has been received but not yet shown. Only ever set by a
    // deferral and only ever cleared by a render that completed, so there is no way to
    // forget an update by hand — which is exactly how one used to be lost across a
    // disconnect, where the debt was dropped because the GESTURE that caused it was
    // gone. The gesture and the data are two different obligations: the first must not
    // survive a disconnect, the second must.
    get isRenderPending() {
      return renderPending;
    },

    // ---- commands --------------------------------------------------------------
    // A new configuration can change the output without changing a single entity, so
    // the data signature stops being evidence of anything.
    invalidateDataSignature() {
      dataSignature = "";
    },

    // The view visible BEFORE a configuration change, read while the old configuration
    // and view list are still intact. Computing it afterwards would reinterpret the
    // still-running old animation with the new timing and land on the wrong view.
    capturePreConfigVisualKey(key) {
      preConfigVisualKey = key;
    },
    releasePreConfigVisualKey() {
      preConfigVisualKey = undefined;
    },
  };
}
