// ui/src/lib/version.ts
// UI build version, populated from the backend /healthz at runtime where shown.
// The static short label is a build-time constant; the live version comes from
// healthz and is surfaced in the topbar/footer.
import pkg from "../../package.json";

// Display version shown next to the brand mark in the sidebar footer
// ("Castor by IT Leonard  v1.0.2", see components/BrandLock.tsx; the
// attribution text itself comes from lib/brand.ts).
const DISPLAY_VERSION = "1.0.2";

export const version = {
  ui: (pkg as { version?: string }).version ?? DISPLAY_VERSION,
  short: `v${DISPLAY_VERSION}`,
};
