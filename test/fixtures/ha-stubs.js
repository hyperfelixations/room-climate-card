"use strict";

// Shared HA custom-element stubs for the offline harness. Real Home Assistant registers
// ha-card and ha-icon via its frontend bundle; this harness loads none, so without stubs
// they stay undefined elements with observable consequences (wrong default display, broken
// overflow-clip containment, inert @container queries — see harness.html). customElements
// .define() upgrades matching tags inside any shadow root, which a <style> rule in this
// document cannot cross — so these are real registered elements, not CSS. Loaded once,
// before room-climate-card.js.
(function () {
  // --- ha-card ---
  // Only `display: block` is missing versus a real ha-card (.rtc-card CSS re-declares the
  // rest). Set inline so it wins regardless of specificity or scoping.
  class HaCardStub extends HTMLElement {
    connectedCallback() {
      this.style.display = "block";
    }
  }
  if (!customElements.get("ha-card")) {
    customElements.define("ha-card", HaCardStub);
  }

  // --- ha-icon ---
  // The full MDI set is not reproduced offline (this is layout fidelity, not icon-content
  // testing). The stub is visibly non-empty and differentiated by icon family, covering
  // every mdi:* name the card sets; unmatched names fall back to a plain dot.
  const PATHS = {
    thermometer:
      '<path d="M15 13V5a3 3 0 0 0-6 0v8a5 5 0 1 0 6 0zm-3-9a1 1 0 0 1 1 1v8.17a3 3 0 1 1-2 0V5a1 1 0 0 1 1-1z"/>',
    fire: '<path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/>',
    snowflake:
      '<path d="M22 11h-4.17l2.83-2.83-1.41-1.41L15 11h-2V9l4.24-4.24-1.41-1.41L13 6.17V2h-2v4.17L8.17 3.34 6.76 4.75 11 9v2H9L4.76 6.76 3.34 8.17 6.17 11H2v2h4.17l-2.83 2.83 1.41 1.41L9 13h2v2l-4.24 4.24 1.41 1.41L11 17.83V22h2v-4.17l2.83 2.83 1.41-1.41L13 15v-2h2l4.24 4.24 1.41-1.41L17.83 13H22z"/>',
    "water-percent":
      '<circle cx="9" cy="8" r="2.5"/><circle cx="15" cy="16" r="2.5"/><path d="M17 6L7 18" stroke="currentColor" stroke-width="1.6" fill="none"/>',
    "water-plus":
      '<circle cx="8" cy="17" r="4"/><path d="M14 2v6M11 5h6" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    "water-minus":
      '<circle cx="8" cy="17" r="4"/><path d="M11 5h6" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    "water-off":
      '<circle cx="12" cy="14" r="4"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    water: '<path d="M12 2C8 8 5 11.5 5 15a7 7 0 0 0 14 0c0-3.5-3-7-7-13z"/>',
    molecule:
      '<circle cx="6" cy="6" r="2.6"/><circle cx="18" cy="6" r="2.6"/><circle cx="12" cy="18" r="2.6"/><path d="M6 6l6 12M18 6l-6 12" stroke="currentColor" stroke-width="1.4" fill="none"/>',
    alert:
      '<path d="M12 2L1 21h22L12 2zm0 5.5L19.5 19h-15L12 7.5z"/><rect x="11" y="11" width="2" height="5"/><rect x="11" y="17" width="2" height="2"/>',
    weather:
      '<path d="M6 14a4 4 0 1 1 1.1-7.85A5 5 0 0 1 17 8a3.5 3.5 0 0 1-.5 6.97H6z"/>',
    generic: '<circle cx="12" cy="12" r="5"/>',
  };

  function familyFor(icon) {
    const name = String(icon || "").replace(/^mdi:/, "");
    if (name.includes("fire")) return "fire";
    if (name === "snowflake") return "snowflake";
    if (name.startsWith("thermometer")) return "thermometer";
    if (name.startsWith("water")) return PATHS[name] ? name : "water";
    if (name.startsWith("molecule")) return "molecule";
    if (name.startsWith("alert")) return "alert";
    if (name.startsWith("weather")) return "weather";
    return "generic";
  }

  class HaIconStub extends HTMLElement {
    static get observedAttributes() {
      return ["icon"];
    }

    connectedCallback() {
      this._render();
    }

    attributeChangedCallback() {
      if (this.isConnected) this._render();
    }

    _render() {
      const family = familyFor(this.getAttribute("icon"));
      const body = PATHS[family] || PATHS.generic;
      this.innerHTML =
        '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" focusable="false">' + body + "</svg>";
      this.style.display = "inline-flex";
      this.style.alignItems = "center";
      this.style.justifyContent = "center";
    }
  }

  if (!customElements.get("ha-icon")) {
    customElements.define("ha-icon", HaIconStub);
  }
})();
