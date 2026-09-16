"use strict";

// A dependency-free stand-in for what card-mod 4.2.1 (thomasloven/lovelace-card-mod, tag
// v4.2.1) does to a card, for jsdom tests that cannot load the real bundle. Each function
// mirrors one place in its source; the real bundle runs in
// test/browser/core/card-mod-compatibility.spec.js.

// src/patch/hui-card.ts, HuiCardPatch._add_card_mod(): the configuration the styles are read from.
function cardModConfigOf(element) {
  return element?.config || element?._config;
}

// src/patch/ha-card.ts, findConfig(): the lookup for a card that sits outside hui-card,
// starting at the card's own ha-card.
function findConfigLikeCardMod(node) {
  if (!node) return null;
  if (node.config) return node.config;
  if (node._config) return node._config;
  if (node.host) return findConfigLikeCardMod(node.host);
  if (node.parentElement) return findConfigLikeCardMod(node.parentElement);
  if (node.parentNode) return findConfigLikeCardMod(node.parentNode);
  return null;
}

// src/helpers/apply_card_mod.ts appends a <card-mod> element to the target (the card's shadow
// root, or ha-card itself); src/card-mod.ts renders its styles as a <style> in its own light
// DOM, hides itself, and rewrites that text whenever a theme or template changes.
function attachCardMod(container, css) {
  const document = container.ownerDocument;
  const element = document.createElement("card-mod");
  element.setAttribute("slot", "none");
  element.style.display = "none";
  const style = document.createElement("style");
  style.textContent = css;
  element.appendChild(style);
  container.appendChild(element);
  return {
    element,
    setStyle(next) {
      style.textContent = next;
    },
  };
}

module.exports = { cardModConfigOf, findConfigLikeCardMod, attachCardMod };
