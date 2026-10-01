// Castor by IT Leonard
// ui/src/components/BrandLock.tsx
//
// Non-removable brand mark: the Castor logo + "Castor by IT Leonard".
//
//   <BrandMark>  the locked node (logo, attribution text, optional extra
//                children); shared by the sidebar footer and the auth screens.
//   <BrandLock>  the sidebar footer flavour: BrandMark + build version.
//
// The mark is the project's required attribution (NOTICE, Apache-2.0 section
// 4(d); TRADEMARKS.md). It is rendered with inline !important visibility styles
// AND guarded at runtime: a MutationObserver plus a 1 s tick re-assert those
// styles, put the node back if it is detached, recreate the logo if it is
// removed or re-pointed, and rewrite the attribution text if it is edited. The
// point is that tampering with the mark in a *distributed* image (an injected
// stylesheet, a devtools edit, a script that strips the node) is detectable
// and self-repairing. It is not DRM: Castor is open source and a modified
// rebuild can change anything; that case is covered by NOTICE/TRADEMARKS, not
// by this file.
//
// The markup carries no class that the app's own CSS hides at any breakpoint:
// shell.css keeps .brandlock visible in the 920px icon rail and in the phone
// drawer, it only reflows it.

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { BRAND } from "../lib/brand";
import { useServerVersion } from "../lib/version";

// Stable id for the sidebar instance (the guard works by ref, not by id).
const LOCK_ID = "castor-brandlock-7f3a";

type StyleLock = Record<string, string>;

// Declarations forced inline with !important and re-asserted by the guard.
// Only what makes a node VISIBLE is locked; layout (padding, font, colour)
// stays in the stylesheet so themes and breakpoints keep working.
const VISIBLE: StyleLock = {
  visibility: "visible",
  opacity: "1",
  position: "static",
  transform: "none",
  filter: "none",
  clip: "auto",
  "clip-path": "none",
  overflow: "visible",
  "max-width": "none",
  "max-height": "none",
  "pointer-events": "auto",
};
const ROOT_LOCK: StyleLock = { display: "flex", width: "auto", height: "auto", "user-select": "none", ...VISIBLE };
const TEXT_LOCK: StyleLock = { display: "inline", width: "auto", height: "auto", ...VISIBLE };
function imgLock(size: number): StyleLock {
  return {
    display: "inline-block",
    width: `${size}px`,
    height: `${size}px`,
    "flex-shrink": "0",
    "object-fit": "contain",
    ...VISIBLE,
  };
}

function lockStyle(el: HTMLElement, lock: StyleLock) {
  for (const [prop, val] of Object.entries(lock)) {
    // setProperty with "important" wins over any author stylesheet rule,
    // including ones injected after mount. Only write when something drifted,
    // so the observer below does not re-trigger itself.
    if (el.style.getPropertyValue(prop) !== val || el.style.getPropertyPriority(prop) !== "important") {
      el.style.setProperty(prop, val, "important");
    }
  }
  // `hidden` / aria-hidden would hide the mark from assistive tech even though
  // the inline display wins the cascade: strip them.
  if (el.hasAttribute("hidden")) el.removeAttribute("hidden");
  if (el.getAttribute("aria-hidden") === "true") el.removeAttribute("aria-hidden");
}

function setAttr(el: Element, name: string, value: string) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

// Direct child of `root` tagged data-brand=<kind>. Only direct children count:
// a copy wrapped into some hidden container is not the mark.
function ownChild<T extends Element>(root: HTMLElement, tag: string, kind: string): T | null {
  for (const c of Array.from(root.children)) {
    if (c.tagName === tag && c.getAttribute("data-brand") === kind) return c as unknown as T;
  }
  return null;
}

interface BrandGuardSpec {
  /** Exact text the attribution span must carry. */
  text: string;
  /** Logo the node must contain, placed right before the text. */
  img?: { src: string; size: number; alt: string };
}

// Bring `root` back to the expected shape: locked styles, the aria-label, the
// logo (present, right src and size, not hidden) and the text (verbatim).
// Every write is conditional, so a pass without drift touches nothing.
function assertLocked(root: HTMLElement, spec: BrandGuardSpec) {
  lockStyle(root, ROOT_LOCK);
  setAttr(root, "aria-label", spec.text);

  let img: HTMLImageElement | null = null;
  if (spec.img) {
    img = ownChild<HTMLImageElement>(root, "IMG", "logo");
    if (!img) {
      img = document.createElement("img");
      img.setAttribute("data-brand", "logo");
      root.insertBefore(img, root.firstChild);
    }
    setAttr(img, "src", spec.img.src);
    setAttr(img, "alt", spec.img.alt);
    setAttr(img, "width", String(spec.img.size));
    setAttr(img, "height", String(spec.img.size));
    // srcset/sizes would win over src in the browser's source selection.
    if (img.hasAttribute("srcset")) img.removeAttribute("srcset");
    if (img.hasAttribute("sizes")) img.removeAttribute("sizes");
    lockStyle(img, imgLock(spec.img.size));
  }

  let text = ownChild<HTMLElement>(root, "SPAN", "text");
  if (!text) {
    text = document.createElement("span");
    text.setAttribute("data-brand", "text");
    root.insertBefore(text, img ? img.nextSibling : root.firstChild);
  }
  if (text.textContent !== spec.text) text.textContent = spec.text;
  lockStyle(text, TEXT_LOCK);
  // Keep the logo immediately before the text.
  if (img && img.nextSibling !== text) root.insertBefore(img, text);
}

// Attach the runtime guard to the node behind `ref`: re-assert on any
// mutation inside the node, re-insert it if its parent loses it, and tick every
// second as a safety net for whatever the observers miss.
function useBrandGuard(ref: RefObject<HTMLElement>, spec: BrandGuardSpec) {
  const specRef = useRef(spec);
  specRef.current = spec;
  const { text } = spec;
  const imgSrc = spec.img?.src;
  const imgSize = spec.img?.size;
  const imgAlt = spec.img?.alt;

  // useLayoutEffect rather than useEffect: on unmount React runs layout
  // cleanups before it detaches the host node, so the observers are gone by
  // the time the node leaves the DOM and a normal unmount is never mistaken
  // for tampering.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;
    const next = el.nextSibling;
    let disposed = false;

    const reassert = () => {
      if (disposed) return;
      if (!el.isConnected && parent && parent.isConnected) {
        // The node was pulled out of its parent: put it back where it was.
        parent.insertBefore(el, next && next.parentNode === parent ? next : null);
      }
      assertLocked(el, specRef.current);
    };
    reassert();

    // Anything inside the node: style/class/attribute edits, the logo being
    // removed or re-pointed, the text being rewritten.
    const selfObs = new MutationObserver(reassert);
    selfObs.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
    // The node itself being removed from its parent.
    let parentObs: MutationObserver | undefined;
    if (parent) {
      parentObs = new MutationObserver(reassert);
      parentObs.observe(parent, { childList: true });
    }
    const tick = window.setInterval(reassert, 1000);

    return () => {
      disposed = true;
      selfObs.disconnect();
      parentObs?.disconnect();
      window.clearInterval(tick);
    };
  }, [ref, text, imgSrc, imgSize, imgAlt]);
}

export interface BrandMarkProps {
  id?: string;
  className?: string;
  /** Logo edge in px (the artwork is square). */
  logoSize?: number;
  /**
   * Accessible name of the logo. Pass "" where a larger Castor logo already
   * names the brand right next to the mark; the attribution text remains the
   * node's own label either way.
   */
  logoAlt?: string;
  /** Extra content after the attribution (e.g. the build version). */
  children?: ReactNode;
}

// The locked node: [logo] "Castor by IT Leonard" [children].
export function BrandMark({ id, className, logoSize = 20, logoAlt = BRAND.name, children }: BrandMarkProps) {
  const ref = useRef<HTMLDivElement>(null);
  useBrandGuard(ref, { text: BRAND.attribution, img: { src: BRAND.logoSrc, size: logoSize, alt: logoAlt } });

  return (
    <div
      id={id}
      ref={ref}
      className={className}
      aria-label={BRAND.attribution}
      // Initial inline lock so the node is correct on first paint; the guard
      // upgrades these to !important right after mount and keeps them there.
      style={{
        display: "flex",
        visibility: "visible",
        opacity: 1,
        alignItems: "center",
        userSelect: "none",
      }}
    >
      <img
        data-brand="logo"
        src={BRAND.logoSrc}
        alt={logoAlt}
        width={logoSize}
        height={logoSize}
        style={{ display: "inline-block", objectFit: "contain", flexShrink: 0 }}
      />
      <span data-brand="text">{BRAND.attribution}</span>
      {children}
    </div>
  );
}

// Sidebar footer: the mark plus the build version.
export function BrandLock() {
  const serverVersion = useServerVersion();
  return (
    <BrandMark id={LOCK_ID} className="sidebar-footer brandlock" logoSize={20}>
      <span className="mono brand-version">{serverVersion}</span>
    </BrandMark>
  );
}
