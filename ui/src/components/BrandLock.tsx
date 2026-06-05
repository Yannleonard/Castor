// ui/src/components/BrandLock.tsx
//
// Non-removable brand attribution shown in the sidebar footer:
//   "Castor by Leonard"  ·  v<version>
//
// This is the project's required legal attribution. It is rendered with inline
// !important visibility styles AND guarded at runtime by a MutationObserver so
// that the usual ways of hiding it in the *distributed* build — an injected
// stylesheet, a devtools `display:none`, removing the node, or zeroing its
// opacity — are reverted automatically. (Castor is Apache-2.0 open source, so
// someone who rebuilds from modified source can of course change anything; the
// goal here is that the shipped image keeps the attribution visible under normal
// tampering, not DRM.)
//
// The footer markup intentionally carries no class that the app's own CSS hides
// on small screens — the responsive rule that used to `display:none` the footer
// does not apply to this element.

import { useEffect, useRef } from "react";
import { version } from "../lib/version";

// Stable, hard-to-guess id so an injected `#... { display:none }` rule cannot
// trivially target it by a friendly name, and so the guard can find its node.
const LOCK_ID = "castor-brandlock-7f3a";

// The visibility-critical declarations we force inline (highest specificity
// short of a UA important) and re-assert from the runtime guard. Layout props
// (padding/border/font) stay in the stylesheet; only what makes the node
// VISIBLE is locked here.
const LOCKED: Record<string, string> = {
  display: "flex",
  visibility: "visible",
  opacity: "1",
  "pointer-events": "auto",
  position: "static",
  height: "auto",
  "max-height": "none",
  width: "auto",
  "max-width": "none",
  overflow: "visible",
  transform: "none",
  clip: "auto",
  "clip-path": "none",
  "user-select": "none",
};

function assertLocked(el: HTMLElement) {
  for (const [prop, val] of Object.entries(LOCKED)) {
    // setProperty with "important" wins over any author stylesheet rule,
    // including ones injected after mount.
    if (el.style.getPropertyValue(prop) !== val || el.style.getPropertyPriority(prop) !== "important") {
      el.style.setProperty(prop, val, "important");
    }
  }
  // The `hidden` attribute (and aria-hidden) would semantically hide the mark
  // even though our inline display wins the cascade — strip them so the
  // attribution stays present for assistive tech and cannot be hidden that way.
  if (el.hasAttribute("hidden")) el.removeAttribute("hidden");
  if (el.getAttribute("aria-hidden") === "true") el.removeAttribute("aria-hidden");
}

export function BrandLock() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    assertLocked(el);

    // Re-assert whenever this node's attributes (style/class) change, or when
    // the surrounding subtree is mutated (e.g. the node gets detached). Cheap:
    // the callback only touches inline style when something drifted.
    const reassert = () => {
      if (!el.isConnected && parent) {
        // node was removed — put it back at the end of its original parent.
        parent.appendChild(el);
      }
      assertLocked(el);
    };

    const parent = el.parentElement;
    const selfObs = new MutationObserver(reassert);
    selfObs.observe(el, { attributes: true, attributeFilter: ["style", "class", "hidden"] });

    let parentObs: MutationObserver | undefined;
    if (parent) {
      parentObs = new MutationObserver(reassert);
      parentObs.observe(parent, { childList: true });
    }

    // Belt-and-suspenders: a low-frequency tick catches anything the observers
    // miss (e.g. a stylesheet toggled without mutating this node's attributes).
    const tick = window.setInterval(assertLocked.bind(null, el), 1000);

    return () => {
      selfObs.disconnect();
      parentObs?.disconnect();
      window.clearInterval(tick);
    };
  }, []);

  return (
    <div
      id={LOCK_ID}
      ref={ref}
      className="sidebar-footer brandlock"
      aria-label="Castor by Leonard"
      // Initial inline lock so it is correct on first paint, before the effect
      // runs. The effect upgrades these to !important and keeps them there.
      style={{
        display: "flex",
        visibility: "visible",
        opacity: 1,
        alignItems: "center",
        justifyContent: "space-between",
        userSelect: "none",
      }}
    >
      <span>Castor by Leonard</span>
      <span className="mono">{version.short}</span>
    </div>
  );
}
