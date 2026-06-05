// ui/src/views/Login.tsx
//
// Username/password login + enterprise SSO. On local success:
//   - requiresTotp=false → session authenticated, refresh /auth/me, go to "/".
//   - requiresTotp=true  → session minted at amr=pwd, route to /totp.
// Errors are uniform (no enumeration): bad creds → unauthenticated; locked →
// forbidden with code account_locked.
//
// Below the local form we render any ENABLED external providers from
// GET /auth/providers (public): OIDC providers become "Sign in with Microsoft"
// buttons that do a FULL-PAGE redirect to /api/v1/auth/oidc/start?provider=<id>
// (the callback sets the session cookie and 302s back to "/"); LDAP providers
// surface a compact directory username/password form posting to
// /auth/ldap/login. A failed OIDC round-trip returns to "/login?sso_error=<code>"
// which we surface as a banner.

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useLocation, useSearchParams, Link } from "react-router-dom";
import { api, ApiError, API_BASE } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AuthBrand } from "./AuthBrand";
import { TextField } from "../components/Field";
import { ActionButton } from "../components/ActionButton";
import { IconMicrosoft, IconDirectory } from "../components/icons";
import type { LoginResponse, PublicAuthProvider } from "../lib/types";

interface LocationState {
  from?: { pathname: string };
}

// Friendly text for the bounded ?sso_error codes emitted by the OIDC callback.
const SSO_ERROR_TEXT: Record<string, string> = {
  invalid_state: "Your sign-in session expired or was already used. Please try again.",
  invalid_request: "The sign-in response was malformed. Please try again.",
  provider_unavailable: "That sign-in method is no longer available. Contact an administrator.",
  idp_unreachable: "The identity provider could not be reached. Please try again shortly.",
  code_exchange_failed: "Sign-in could not be completed with the identity provider. Please try again.",
  token_verification_failed: "The identity provider's response could not be verified. Please try again.",
  access_denied: "Sign-in was cancelled.",
  server_error: "Something went wrong completing sign-in. Please try again.",
};

function ssoErrorText(code: string): string {
  return SSO_ERROR_TEXT[code] ?? "Single sign-on failed. Please try again or use another method.";
}

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { applySession, setNeedsTotp, refresh } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Enabled external providers for the login screen (best-effort; the page works
  // without them). Split by kind for rendering.
  const [providers, setProviders] = useState<PublicAuthProvider[]>([]);
  // Which LDAP directory the credential form targets (when more than one).
  const [ldapProviderId, setLdapProviderId] = useState("");

  const from = (location.state as LocationState | null)?.from?.pathname ?? "/";

  // First-run gate: if the instance has never been initialized (no admin yet),
  // there is nothing to sign in to — send the operator straight to the
  // create-the-first-administrator screen instead of showing an empty login.
  // This makes a freshly pulled image boot directly into admin creation.
  const [bootChecked, setBootChecked] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .bootstrapStatus()
      .then((s) => {
        if (!alive) return;
        if (s.required) {
          navigate("/bootstrap", { replace: true });
        } else {
          setBootChecked(true);
        }
      })
      .catch(() => {
        // If the status probe fails, fall back to showing the login form.
        if (alive) setBootChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [navigate]);

  // Surface a failed OIDC redirect (callback bounced back with ?sso_error=).
  const ssoError = searchParams.get("sso_error");
  useEffect(() => {
    if (ssoError) setError(ssoErrorText(ssoError));
  }, [ssoError]);

  // Load enabled providers once. Pre-auth, tolerant of failure (login still works
  // with local credentials).
  useEffect(() => {
    let alive = true;
    api
      .authProviders()
      .then((list) => {
        if (!alive) return;
        setProviders(list);
        const firstLdap = list.find((p) => p.kind === "ldap");
        if (firstLdap) setLdapProviderId(firstLdap.id);
      })
      .catch(() => {
        /* providers are optional; ignore */
      });
    return () => {
      alive = false;
    };
  }, []);

  const oidcProviders = providers.filter((p) => p.kind === "oidc");
  const ldapProviders = providers.filter((p) => p.kind === "ldap");

  // Apply a freshly minted session (shared by local + LDAP login).
  const applyAndContinue = async (res: LoginResponse) => {
    applySession({
      csrfToken: res.csrfToken,
      user: res.user,
      amr: res.amr,
      permissions: res.permissions,
      roles: [],
    });
    if (res.requiresTotp) {
      setNeedsTotp(true);
      navigate("/totp", { replace: true, state: { from: { pathname: from } } });
      return;
    }
    await refresh();
    navigate(from, { replace: true });
  };

  const handleAuthError = (err: unknown) => {
    if (err instanceof ApiError) {
      if (err.code === "account_locked") {
        setError("This account is temporarily locked. Try again later.");
      } else if (err.status === 401) {
        setError("Invalid username or password.");
      } else if (err.code === "bootstrap_required") {
        navigate("/bootstrap", { replace: true });
        return;
      } else {
        setError(err.message);
      }
    } else {
      setError("Unable to reach the server.");
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api.login({ username: username.trim(), password });
      await applyAndContinue(res);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setBusy(false);
    }
  };

  // LDAP credential submit: posts to /auth/ldap/login with the selected directory.
  const submitLdap = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api.ldapLogin({
        username: username.trim(),
        password,
        provider: ldapProviderId || undefined,
      });
      await applyAndContinue(res);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setBusy(false);
    }
  };

  // OIDC: full-page navigation to the start endpoint (it 302s to the IdP). We do
  // NOT use the XHR client — this must be a top-level browser navigation.
  const startOidc = (providerId: string) => {
    const target = `${API_BASE}/auth/oidc/start?provider=${encodeURIComponent(providerId)}`;
    window.location.assign(target);
  };

  const hasLdap = ldapProviders.length > 0;
  const hasOidc = oidcProviders.length > 0;
  const hasSso = hasLdap || hasOidc;
  // When an LDAP directory is offered, the username/password form can target
  // either local auth or the directory; show both submit affordances.
  const credsDisabled = !username || !password || busy;

  // While we probe bootstrap status, hold the login form back so a fresh
  // instance never flashes the sign-in screen before redirecting to setup.
  if (!bootChecked) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <AuthBrand />
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <AuthBrand />
        <form className="auth-form" onSubmit={submit}>
          <TextField
            name="username"
            label="Username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <TextField
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error ? (
            <div className="banner danger" role="alert">
              {error}
            </div>
          ) : null}
          <ActionButton type="submit" variant="primary" size="lg" className="btn-block" loading={busy} disabled={!username || !password}>
            Sign in
          </ActionButton>
        </form>

        {hasSso ? (
          <div className="auth-sso col" style={{ gap: "var(--sp-3)", marginTop: "var(--sp-4)" }}>
            <div className="auth-divider">
              <span>or continue with</span>
            </div>

            {oidcProviders.map((p) => (
              <ActionButton
                key={p.id}
                type="button"
                size="lg"
                className="btn-block"
                disabled={busy}
                onClick={() => startOidc(p.id)}
              >
                <IconMicrosoft size={18} />
                Sign in with {p.name || "Microsoft"}
              </ActionButton>
            ))}

            {hasLdap ? (
              <div className="col" style={{ gap: "var(--sp-2)" }}>
                {ldapProviders.length > 1 ? (
                  <select
                    className="select"
                    value={ldapProviderId}
                    onChange={(e) => setLdapProviderId(e.target.value)}
                    aria-label="Directory"
                  >
                    {ldapProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <ActionButton
                  type="button"
                  size="lg"
                  className="btn-block"
                  disabled={credsDisabled}
                  tooltip={credsDisabled ? "Enter your directory username and password above" : undefined}
                  onClick={(e) => submitLdap(e)}
                >
                  <IconDirectory size={16} />
                  Sign in with {ldapProviders.length === 1 ? ldapProviders[0].name : "directory"} (LDAP)
                </ActionButton>
                <span className="field-hint">
                  Use the username and password fields above with your corporate directory credentials.
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="auth-footnote">
          First time here? <Link to="/bootstrap">Initialize Castor</Link>
        </div>
      </div>
    </div>
  );
}
