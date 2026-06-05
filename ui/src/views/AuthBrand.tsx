// ui/src/views/AuthBrand.tsx — shared brand header for auth screens.
import { BeaverMascot } from "../components/icons";

export function AuthBrand(_props: { subtitle?: string }) {
  // The logo already contains the "Castor" wordmark and the
  // "Gérer · Déployer · Orchestrer" tagline, so we show only the logo here.
  return (
    <div className="auth-brand">
      {/* Large enough that the "Castor" wordmark + the
          "Gérer · Déployer · Orchestrer" tagline baked into the logo are
          legible on the login / bootstrap screens (~2x the previous size). */}
      <BeaverMascot size={320} style={{ width: "100%", maxWidth: 360, height: "auto" }} />
    </div>
  );
}
