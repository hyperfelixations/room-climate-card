// The composition root: imports the finished custom element, registers it, and adds
// the card-picker entry. Computes nothing.
//
// The `customElements`/`window` reads below are the one allowed exception to the
// platform contract (see internal dev doc §4 "Keine Browserglobals in fachlichen Schichten"):
// a card can only register itself against the real global registry. The build wraps
// this tree in the dependency-free IIFE — see internal dev doc §4 "Build-/Dist-Vertrag".

import { CARD_NAME, CARD_TYPE, CARD_VERSION } from "./core/card-metadata.js";
import { suggestionsForEntity } from "./application/model/card-suggestions.js";
import { RoomClimateCard } from "./element/room-climate-card.js";

// ==== Registration ====
if (!customElements.get(CARD_TYPE)) {
  customElements.define(CARD_TYPE, RoomClimateCard);
}

window.customCards = window.customCards || [];
const existingCard = window.customCards.find((card) => card.type === CARD_TYPE);
const cardMetadata = {
  type: CARD_TYPE,
  name: CARD_NAME,
  // Live preview from getStubConfig(), which names a real climate sensor from the
  // user's system when there is one (see card-suggestions.js).
  preview: true,
  description: "Standalone climate card (temperature, humidity, CO2, or PM2.5) with an average value, comfort range, optional room extremes/chips, and HA actions.",
  documentationURL: "https://github.com/hyperfelixations/room-climate-card",
  // Answers HA's "what do you want to show" picker flow: a pure, total function over
  // hass.states (see card-suggestions.js), so no guard is needed here.
  getEntitySuggestion: (hass, entityId) => suggestionsForEntity(hass?.states, entityId),
};

if (existingCard) {
  Object.assign(existingCard, cardMetadata);
} else {
  window.customCards.push(cardMetadata);
}

window.roomClimateCardVersion = CARD_VERSION;
