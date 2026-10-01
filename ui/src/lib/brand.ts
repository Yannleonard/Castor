// ui/src/lib/brand.ts
//
// Single source of truth for the Castor brand identity shown in the UI: the
// product name, the vendor, the attribution line and the logo asset.
//
// These strings are intentionally NOT routed through i18n. The attribution is
// the project's legal notice (Apache-2.0 section 4(d), see NOTICE at the
// repository root), not user-facing copy, so it must read the same in every
// locale. docs/community/TRADEMARKS.md states what may and may not be changed
// in a redistributed or derived build; the runtime guard in
// components/BrandLock.tsx reads these values and keeps the mark intact.

export const BRAND = Object.freeze({
  /** Product name; also the accessible name of the logo. */
  name: "Castor",
  /** Legal vendor. */
  vendor: "IT Leonard",
  /** Attribution line shown in the sidebar footer and on the auth screens. */
  attribution: "Castor by IT Leonard",
  /** Square logo artwork, served from ui/public/brand. */
  logoSrc: "/brand/castor-logo.jpg",
} as const);
