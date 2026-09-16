// The nodes this card owns in its shadow root. The stylesheet and the ha-card surface are mounted
// once; a render replaces the body inside the surface. Nodes another module inserted (card-mod) are
// never touched and stay after the card's own. See internal dev doc §4 "Shadow-DOM-Eigentum".

// Template-literal whitespace is shipped markup, pinned by the DOM characterization baselines.
const shellMarkup = (css, bodyHtml) => `
        <style>${css}</style>
        <ha-card class="rtc-card">
          ${bodyHtml}
        </ha-card>
      `;

const bodyMarkup = (bodyHtml) => `
          ${bodyHtml}
        `;

export function createShadowMount(root) {
  let style = null;
  let surface = null;
  // Owned children of `root` (whitespace, style, surface, or the fallback text) and of `surface`.
  let outer = [];
  let body = [];

  const isMounted = () => Boolean(style && surface && style.parentNode === root && surface.parentNode === root);
  const containers = () => (isMounted() ? [root, surface] : [root]);

  // One fragment, one insertion: a single childList record for an observer.
  function insert(container, nodes, before) {
    const fragment = container.ownerDocument.createDocumentFragment();
    for (const node of nodes) fragment.appendChild(node);
    container.insertBefore(fragment, before);
  }

  function removeOwned(container, nodes) {
    for (const node of nodes) {
      if (node.parentNode === container) container.removeChild(node);
    }
  }

  // New owned nodes go where the old ones were, else in front of anything foreign.
  function anchorIn(container, previous) {
    return previous.find((node) => node.parentNode === container) ?? container.firstChild;
  }

  return {
    mount(context, { css, bodyHtml }) {
      if (!isMounted()) {
        const nodes = context.htmlToNodes(shellMarkup(css, bodyHtml));
        insert(root, nodes, anchorIn(root, outer));
        removeOwned(root, outer);
        outer = nodes;
        style = nodes.find((node) => node.localName === "style");
        surface = nodes.find((node) => node.localName === "ha-card");
        body = Array.from(surface.childNodes);
        return;
      }
      if (style.textContent !== css) style.textContent = css;
      const nodes = context.htmlToNodes(bodyMarkup(bodyHtml));
      insert(surface, nodes, anchorIn(surface, body));
      removeOwned(surface, body);
      body = nodes;
    },

    // Last resort when not even the stylesheet can be built.
    showText(text) {
      const node = root.ownerDocument.createTextNode(text);
      insert(root, [node], anchorIn(root, outer));
      removeOwned(root, outer);
      outer = [node];
      style = null;
      surface = null;
      body = [];
    },

    // Where a foreign stylesheet can land.
    containers,

    foreignNodes() {
      const owned = new Set([...outer, ...body]);
      return containers().flatMap((container) => Array.from(container.childNodes).filter((node) => !owned.has(node)));
    },
  };
}
