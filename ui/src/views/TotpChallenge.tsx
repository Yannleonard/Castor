// ui/src/views/TotpChallenge.tsx
//
// Second factor step. The session already exists at amr=pwd. The user submits a
// 6-digit TOTP code or a recovery code; on success the session upgrades to
// pwd+totp and we route to the original destination.

import { useState, type FormEvent } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AuthBrand } from "./AuthBrand";
import { TextField } from "../components/Field";
import { ActionButton } from "../components/ActionButton";

interface LocationState {
  from?: { pathname: string };
}

export function TotpChallenge() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const from = (location.state as LocationState | null)?.from?.pathname ?? "/";

  // If there is no pending pwd session, bounce to login.
  if (auth.status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }
  // Already fully authenticated → home.
  if (auth.status === "authenticated" && auth.amr === "pwd+totp") {
    return <Navigate to={from} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const me = await api.totpVerify(code.trim());
      auth.applySession({
        csrfToken: me.csrfToken,
        user: me.user,
        amr: me.amr,
        permissions: me.permissions,
        roles: me.roles,
      });
      auth.setNeedsTotp(false);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(useRecovery ? "Invalid recovery code." : "Invalid authentication code.");
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unable to reach the server.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <AuthBrand subtitle="Two-factor authentication" />
        <form className="auth-form" onSubmit={submit}>
          <TextField
            name="code"
            label={useRecovery ? "Recovery code" : "Authentication code"}
            inputMode={useRecovery ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoFocus
            mono
            placeholder={useRecovery ? "xxxx-xxxx-xx" : "123456"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            hint={
              useRecovery
                ? "Enter one of your saved single-use recovery codes."
                : "Open your authenticator app and enter the 6-digit code."
            }
            required
          />
          {error ? (
            <div className="banner danger" role="alert">
              {error}
            </div>
          ) : null}
          <ActionButton
            type="submit"
            variant="primary"
            size="lg"
            className="btn-block"
            loading={busy}
            disabled={!code}
          >
            Verify
          </ActionButton>
        </form>
        <div className="auth-footnote">
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => {
              setUseRecovery((v) => !v);
              setCode("");
              setError("");
            }}
          >
            {useRecovery ? "Use authenticator app instead" : "Use a recovery code"}
          </button>
        </div>
      </div>
    </div>
  );
}
