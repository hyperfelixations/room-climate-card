// The scale footer keeps its full text while it fits on its line, else takes its compact
// form when it has one; CSS ellipsis truncates beyond that. Rewritten on every pass, so the
// footer widens back when room returns.

import { overflowsBox, setText } from "../primitives/dom.js";

export function resolveFooterForm(containerEl, content) {
  const footerEl = containerEl?.querySelector(".rtc-scale-footer");
  if (!footerEl || content?.footerText == null) return;
  setText(footerEl, content.footerText);
  if (content.compactFooterText && overflowsBox(footerEl)) setText(footerEl, content.compactFooterText);
}
