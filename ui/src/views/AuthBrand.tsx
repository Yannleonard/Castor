// Castor by IT Leonard
// ui/src/views/AuthBrand.tsx — shared brand header for auth screens
// (login, bootstrap, TOTP challenge).
import { BeaverMascot } from "../components/icons";
import { BrandMark } from "../components/BrandLock";

export function AuthBrand(_props: { subtitle?: string }) {
  // The logo already contains the "Castor" wordmark and the
  // "Gérer · Déployer · Orchestrer" tagline, so no title is repeated here.
  return (
    <div className="auth-brand">
      {/* Large enough that the "Castor" wordmark + the
          "Gérer · Déployer · Orchestrer" tagline baked into the logo are
          legible on the login / bootstrap screens (~2x the previous size). */}
      <BeaverMascot size={320} style={{ width: "100%", maxWidth: 360, height: "auto" }} />
      {/* Attribution line, small and muted, but guarded by the same runtime
          lock as the sidebar footer (see BrandLock.tsx). The small logo is
          decorative (alt="") because the large one above already names the
          brand; the attribution text is the node's own label. */}
      <BrandMark className="auth-attribution muted" logoSize={16} logoAlt="" />
    </div>
  );
}
