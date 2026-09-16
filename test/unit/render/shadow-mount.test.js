"use strict";

// Direct unit tests for render/composition/shadow-mount.js: which nodes of a shadow root the
// card owns, and that a render replaces exactly those. The stylesheet and the ha-card surface
// are mounted once; later renders swap the body inside the surface. A node another module
// inserted (card-mod's <card-mod>, in the root or inside ha-card) stays where it is.
// Boundary: what the body contains is render-shell.test.js; when the watch asks again is
// unit/runtime/surface-watch.test.js; the card driven with card-mod is contract/card-mod-compatibility.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

let renderContext;
let shadowMount;

test.before(async () => {
  renderContext = await import("../../../src/render/primitives/render-context.js");
  shadowMount = await import("../../../src/render/composition/shadow-mount.js");
});

// A fresh realm with a shadow root to mount into, as the card has.
function makeRealm() {
  const jsdom = new JSDOM("<!doctype html><html><body><div id='host'></div></body></html>");
  const ownerDocument = jsdom.window.document;
  const root = ownerDocument.getElementById("host").attachShadow({ mode: "open" });
  return { ownerDocument, root, context: renderContext.createRenderContext(ownerDocument), mount: shadowMount.createShadowMount(root) };
}

const BODY = `
        <div class="rtc-root" data-state="data" tabindex="-1">one</div>
      `;
const OTHER_BODY = `
        <div class="rtc-root" data-state="error" tabindex="-1">two</div>
      `;

// What the card wrote with one innerHTML assignment before it tracked its own nodes; the
// DOM characterization baselines pin exactly these bytes.
const reference = (css, body) => `
        <style>${css}</style>
        <ha-card class="rtc-card">
          ${body}
        </ha-card>
      `;

// `:scope` matches nothing on a shadow root, so direct children are counted by hand.
const directChildren = (parent, localName) => Array.from(parent.children).filter((node) => node.localName === localName);

function foreignNode(ownerDocument, css) {
  const element = ownerDocument.createElement("card-mod");
  element.innerHTML = `<style>${css}</style>`;
  return element;
}

test("the first mount writes the same bytes one innerHTML assignment wrote", () => {
  const realm = makeRealm();
  realm.mount.mount(realm.context, { css: ".a{}", bodyHtml: BODY });
  assert.equal(realm.root.innerHTML, reference(".a{}", BODY));
});

test("a later mount keeps the stylesheet and the surface, and replaces only the body", () => {
  const realm = makeRealm();
  realm.mount.mount(realm.context, { css: ".a{}", bodyHtml: BODY });
  const style = realm.root.querySelector("style");
  const surface = realm.root.querySelector("ha-card");
  const oldRoot = realm.root.querySelector(".rtc-root");

  realm.mount.mount(realm.context, { css: ".b{}", bodyHtml: OTHER_BODY });
  assert.equal(realm.root.querySelector("style"), style, "the same <style> element");
  assert.equal(realm.root.querySelector("ha-card"), surface, "the same ha-card element");
  assert.notEqual(realm.root.querySelector(".rtc-root"), oldRoot, "a new body");
  assert.equal(oldRoot.isConnected, false);
  assert.equal(realm.root.innerHTML, reference(".b{}", OTHER_BODY), "and the result reads as a fresh render would");
});

test("an unchanged stylesheet is not written again", () => {
  const realm = makeRealm();
  realm.mount.mount(realm.context, { css: ".a{}", bodyHtml: BODY });
  const text = realm.root.querySelector("style").firstChild;
  realm.mount.mount(realm.context, { css: ".a{}", bodyHtml: OTHER_BODY });
  assert.equal(realm.root.querySelector("style").firstChild, text, "writing textContent would replace the text node");
});

test("a node another module put into the shadow root survives every render, after the card's own", () => {
  const realm = makeRealm();
  realm.mount.mount(realm.context, { css: ".a{}", bodyHtml: BODY });
  const foreign = foreignNode(realm.ownerDocument, "ha-card{background:red}");
  realm.root.appendChild(foreign);

  realm.mount.mount(realm.context, { css: ".b{}", bodyHtml: OTHER_BODY });
  realm.mount.mount(realm.context, { css: ".b{}", bodyHtml: BODY });
  assert.equal(foreign.parentNode, realm.root);
  assert.equal(realm.root.lastChild, foreign, "still after the card's stylesheet, so it wins a tie");
  assert.equal(realm.root.querySelectorAll("card-mod").length, 1);
});

test("a foreign node inside ha-card stays, and the new body goes where the old one was", () => {
  const realm = makeRealm();
  realm.mount.mount(realm.context, { css: ".a{}", bodyHtml: BODY });
  const surface = realm.root.querySelector("ha-card");
  const foreign = foreignNode(realm.ownerDocument, "ha-card{border:none}");
  surface.appendChild(foreign);

  realm.mount.mount(realm.context, { css: ".a{}", bodyHtml: OTHER_BODY });
  assert.equal(foreign.parentNode, surface);
  assert.equal(surface.lastChild, foreign, "the body is inserted before the foreign node, not after it");
  assert.equal(surface.querySelector(".rtc-root").textContent, "two");
  assert.equal(surface.querySelectorAll(".rtc-root").length, 1);
});

test("a foreign node that arrived before the first render stays after the card's nodes", () => {
  const realm = makeRealm();
  const foreign = foreignNode(realm.ownerDocument, ":host{--x:1}");
  realm.root.appendChild(foreign);
  realm.mount.mount(realm.context, { css: ".a{}", bodyHtml: BODY });
  assert.equal(realm.root.lastChild, foreign);
  assert.equal(realm.root.innerHTML, `${reference(".a{}", BODY)}<card-mod><style>:host{--x:1}</style></card-mod>`);
});

test("a surface someone else removed is mounted again, and foreign nodes are left alone", () => {
  const realm = makeRealm();
  realm.mount.mount(realm.context, { css: ".a{}", bodyHtml: BODY });
  const foreign = foreignNode(realm.ownerDocument, "");
  realm.root.appendChild(foreign);
  realm.root.querySelector("ha-card").remove();

  realm.mount.mount(realm.context, { css: ".a{}", bodyHtml: OTHER_BODY });
  assert.equal(realm.root.querySelectorAll("ha-card").length, 1);
  assert.equal(realm.root.querySelectorAll("style").length, 2, "one stylesheet of the card, one inside the foreign node");
  assert.equal(directChildren(realm.root, "style").length, 1, "the card's earlier stylesheet was removed");
  assert.equal(realm.root.lastChild, foreign);
});

test("the text fallback replaces the card's nodes and nothing else", () => {
  const realm = makeRealm();
  realm.mount.mount(realm.context, { css: ".a{}", bodyHtml: BODY });
  const foreign = foreignNode(realm.ownerDocument, "");
  realm.root.appendChild(foreign);

  realm.mount.showText("The card could not be drawn.");
  assert.equal(realm.root.querySelector("ha-card"), null);
  assert.deepEqual(directChildren(realm.root, "style"), []);
  assert.equal(realm.root.firstChild.nodeType, 3);
  assert.equal(realm.root.firstChild.data, "The card could not be drawn.");
  assert.equal(realm.root.lastChild, foreign);

  realm.mount.mount(realm.context, { css: ".a{}", bodyHtml: BODY });
  assert.equal(realm.root.textContent.includes("The card could not be drawn."), false, "a later render removes the fallback text");
  assert.equal(realm.root.lastChild, foreign);
});

test("the mount names where a foreign stylesheet can land and which nodes there are foreign", () => {
  const realm = makeRealm();
  assert.deepEqual(realm.mount.containers(), [realm.root], "before the first render only the root exists");
  assert.deepEqual(realm.mount.foreignNodes(), []);

  realm.mount.mount(realm.context, { css: ".a{}", bodyHtml: BODY });
  const surface = realm.root.querySelector("ha-card");
  assert.deepEqual(realm.mount.containers(), [realm.root, surface]);
  assert.deepEqual(realm.mount.foreignNodes(), [], "the card's own whitespace, stylesheet, surface and body are not foreign");

  const inRoot = foreignNode(realm.ownerDocument, "");
  const inSurface = foreignNode(realm.ownerDocument, "");
  realm.root.appendChild(inRoot);
  surface.appendChild(inSurface);
  assert.deepEqual(realm.mount.foreignNodes(), [inRoot, inSurface]);

  realm.mount.showText("x");
  assert.deepEqual(realm.mount.containers(), [realm.root]);
  assert.deepEqual(realm.mount.foreignNodes(), [inRoot]);
});

test("the mount works in whichever realm owns the shadow root", () => {
  const first = makeRealm();
  const second = makeRealm();
  first.mount.mount(first.context, { css: ".a{}", bodyHtml: BODY });
  second.mount.mount(second.context, { css: ".a{}", bodyHtml: BODY });
  assert.equal(first.root.querySelector("ha-card").ownerDocument, first.ownerDocument);
  assert.equal(second.root.querySelector("ha-card").ownerDocument, second.ownerDocument);
});
