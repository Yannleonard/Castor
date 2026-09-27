// ui/src/components/BrandLock.test.tsx
// The brand mark must survive the usual runtime tampering: hidden through an
// inline style, detached from its parent, logo removed or re-pointed, text
// rewritten. Each repair may come from the MutationObserver (a microtask) or,
// failing that, from the 1 s tick; polling with real timers covers both.
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BrandLock } from "./BrandLock";
import { AuthBrand } from "../views/AuthBrand";
import { BRAND } from "../lib/brand";

const settle = { timeout: 2500, interval: 50 };

function renderLock() {
  const utils = render(<BrandLock />);
  const el = screen.getByLabelText(BRAND.attribution);
  return { ...utils, el };
}

describe("BrandLock", () => {
  it("renders the logo, the attribution text and the version, locked inline", () => {
    const { el } = renderLock();
    expect(el).toHaveTextContent("Castor by IT Leonard");
    const img = screen.getByRole("img", { name: "Castor" });
    expect(el.contains(img)).toBe(true);
    expect(img).toHaveAttribute("src", BRAND.logoSrc);
    expect(img).toHaveAttribute("width", "20");
    // Logo first, text right after it.
    expect(img.nextSibling).toBe(el.querySelector('span[data-brand="text"]'));
    expect(el.style.getPropertyValue("display")).toBe("flex");
    expect(el.style.getPropertyPriority("display")).toBe("important");
    expect(img.style.getPropertyValue("visibility")).toBe("visible");
    expect(img.style.getPropertyPriority("visibility")).toBe("important");
  });

  it("restores display:flex !important after an inline display:none", async () => {
    const { el } = renderLock();
    el.style.display = "none";
    await waitFor(() => {
      expect(el.style.getPropertyValue("display")).toBe("flex");
      expect(el.style.getPropertyPriority("display")).toBe("important");
    }, settle);
  });

  it("re-inserts the node after it is removed from its parent", async () => {
    const { el } = renderLock();
    const parent = el.parentElement as HTMLElement;
    parent.removeChild(el);
    expect(el.isConnected).toBe(false);
    await waitFor(() => expect(el.isConnected).toBe(true), settle);
    expect(el.parentElement).toBe(parent);
  });

  it("rewrites the attribution text after it is edited", async () => {
    const { el } = renderLock();
    const span = el.querySelector('span[data-brand="text"]') as HTMLElement;
    span.textContent = "Castor by Someone Else";
    await waitFor(() => expect(span.textContent).toBe("Castor by IT Leonard"), settle);
    // Same thing through the text node itself (characterData mutation).
    (span.firstChild as Text).data = "Beaver Inc.";
    await waitFor(() => expect(span.textContent).toBe("Castor by IT Leonard"), settle);
  });

  it("resets a re-pointed logo src and recreates a removed logo", async () => {
    const { el } = renderLock();
    const img = el.querySelector('img[data-brand="logo"]') as HTMLImageElement;
    img.setAttribute("src", "/somewhere/else.png");
    await waitFor(() => expect(img).toHaveAttribute("src", BRAND.logoSrc), settle);

    img.remove();
    await waitFor(() => {
      const again = el.querySelector('img[data-brand="logo"]') as HTMLImageElement | null;
      expect(again).not.toBeNull();
      expect(again).toHaveAttribute("src", BRAND.logoSrc);
      expect(again).toHaveAttribute("alt", "Castor");
      expect(again?.style.getPropertyPriority("display")).toBe("important");
    }, settle);
  });

  it("strips hidden / aria-hidden and restores the aria-label", async () => {
    const { el } = renderLock();
    el.setAttribute("hidden", "");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("aria-label", "nothing to see");
    await waitFor(() => {
      expect(el).not.toHaveAttribute("hidden");
      expect(el).not.toHaveAttribute("aria-hidden");
      expect(el).toHaveAttribute("aria-label", BRAND.attribution);
    }, settle);
  });

  it("stops guarding once unmounted", async () => {
    const { el, unmount } = renderLock();
    unmount();
    expect(el.isConnected).toBe(false);
    // Past one tick: a live guard would have re-inserted the node.
    await new Promise((r) => setTimeout(r, 1100));
    expect(el.isConnected).toBe(false);
  });
});

describe("AuthBrand", () => {
  it("carries the same locked attribution under the logo", async () => {
    render(<AuthBrand />);
    const el = screen.getByLabelText(BRAND.attribution);
    expect(el).toHaveTextContent("Castor by IT Leonard");
    expect(el.querySelector('img[data-brand="logo"]')).toHaveAttribute("src", BRAND.logoSrc);
    // Exactly one accessible "Castor" image: the small mark in the attribution
    // line is decorative (alt="") since the large logo names the brand.
    expect(screen.getAllByRole("img", { name: "Castor" })).toHaveLength(1);

    el.style.setProperty("visibility", "hidden");
    await waitFor(() => {
      expect(el.style.getPropertyValue("visibility")).toBe("visible");
      expect(el.style.getPropertyPriority("visibility")).toBe("important");
    }, settle);
  });
});
