// Owns render-path selection and the state that describes the last successful DOM.
// Signatures and deferred-render debt commit only after a render callback succeeds.
// Details: internal documentation §4 "Commit-on-Success" and "Render-Signaturvertrag".

import { cardStructureSignature } from "../../render/composition/card-shell.js";

// Observable render decisions for callers and tests.
export const RENDER_PATH = {
  // Gesture active; retain the update as render debt.
  DEFERRED: "deferred",
  // Nothing that can affect the card changed.
  SKIPPED: "skipped",
  // The markup itself had to change.
  FULL: "full",
  // Stable no-data structure.
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
  let dataSignature = "";
  let structuralConfigSignature = null;
  let structureSignature = null;
  let rendered = false;
  let renderPending = false;
  let lastViewModel = null;
  // `undefined` means no pre-config snapshot; `null` means no view was visible.
  let preConfigVisualKey = undefined;

  return {
    render({ dataSignature: nextDataSignature, structuralConfigSignature: nextStructuralConfig, allowSkip = true }) {
      // Rendering mid-swipe would jump the track, so retain the update as debt.
      if (isDragging()) {
        renderPending = true;
        return RENDER_PATH.DEFERRED;
      }

      // Skip before model work; an equal committed signature also settles render debt.
      if (allowSkip && nextDataSignature === dataSignature) {
        renderPending = false;
        return RENDER_PATH.SKIPPED;
      }

      const viewModel = computeViewModel();
      const currentlyEmpty = isCurrentlyEmpty();
      // Each view contributes its optional-node shape without coupling this owner to view keys.
      const nextStructure = cardStructureSignature(viewModel, viewRenderers);

      const commit = () => {
        dataSignature = nextDataSignature;
        structuralConfigSignature = nextStructuralConfig;
        structureSignature = nextStructure;
        lastViewModel = viewModel;
        // Clearing here leaves debt intact when any render callback throws.
        renderPending = false;
      };

      const structureChanged = nextStructure !== structureSignature;
      const structuralConfigChanged = nextStructuralConfig !== structuralConfigSignature;

      if (!rendered || viewModel.empty !== currentlyEmpty || structureChanged || structuralConfigChanged) {
        // Capture first-render state before `rendered` flips.
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

    // Resize and fonts-ready remeasure the last successfully rendered model.
    get lastViewModel() {
      return lastViewModel;
    },
    get hasRendered() {
      return rendered;
    },
    // Render debt survives disconnect even though gesture state does not.
    get isRenderPending() {
      return renderPending;
    },

    // Config can change output without changing entities.
    invalidateDataSignature() {
      dataSignature = "";
    },

    // Capture against the old view list and timing before config replacement.
    capturePreConfigVisualKey(key) {
      preConfigVisualKey = key;
    },
    releasePreConfigVisualKey() {
      preConfigVisualKey = undefined;
    },
  };
}
