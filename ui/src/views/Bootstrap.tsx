// Castor by IT Leonard
// ui/src/views/Bootstrap.tsx
//
// First-run setup. Only reachable in bootstrap mode (GET /bootstrap/status →
// required:true). Creates the first user + global admin binding in one tx.
// On success we log in automatically and offer TOTP enrollment.

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AuthBrand } from "./AuthBrand";
import { TextField } from "../components/Field";
import { ActionButton } from "../components/ActionButton";
import { LoadingFill } from "../components/Spinner";
import { toast } from "../lib/toast";
import { useT, t as tr } from "../i18n";
import { bootstrapDict } from "../i18n/locales/bootstrap";

export function Bootstrap() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const t = useT(bootstrapDict);

  const [checking, setChecking] = useState(true);
  const [required, setRequired] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .bootstrapStatus()
      .then((s) => {
        if (alive) {
          setRequired(s.required);
          setChecking(false);
        }
      })
      .catch(() => {
        if (alive) {
          setRequired(false);
          setChecking(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  if (checking) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <AuthBrand subtitle={t("brand.initializing")} />
          <LoadingFill label={t("loading.checking")} />
        </div>
      </div>
    );
  }

  if (!required) {
    return <Navigate to="/login" replace />;
  }

  const pwOk = password.length >= 10;
  const match = password === confirm;
  const valid = username.trim().length >= 3 && pwOk && match;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setError("");
    setBusy(true);
    try {
      await api.bootstrap({
        username: username.trim(),
        password,
        email: email.trim() || undefined,
        bootstrapToken: token.trim() || undefined,
      });
      // Auto sign-in with the freshly created admin.
      const login = await api.login({ username: username.trim(), password });
      api.setCsrfToken(login.csrfToken);
      await refresh();
      toast.success(tr(bootstrapDict, "toast.readyTitle"), tr(bootstrapDict, "toast.readyBody"));
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "bootstrap_required") {
          // already handled by mode; surface message
          setError(err.message);
        } else if (err.status === 409) {
          setError(tr(bootstrapDict, "error.alreadyInitialized"));
          setRequired(false);
        } else if (err.status === 422) {
          setError(err.message || tr(bootstrapDict, "error.checkForm"));
        } else {
          setError(err.message);
        }
      } else {
        setError(tr(bootstrapDict, "error.unreachable"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 440 }}>
        <AuthBrand subtitle={t("brand.createFirstAdmin")} />
        <form className="auth-form" onSubmit={submit}>
          <TextField
            name="username"
            label={t("form.usernameLabel")}
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            hint={t("form.usernameHint")}
            required
          />
          <TextField
            name="email"
            type="email"
            label={t("form.emailLabel")}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            name="password"
            type="password"
            label={t("form.passwordLabel")}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={password && !pwOk ? t("form.passwordTooShort") : undefined}
            hint={!password ? t("form.passwordHint") : undefined}
            required
          />
          <TextField
            name="confirm"
            type="password"
            label={t("form.confirmLabel")}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={confirm && !match ? t("form.confirmMismatch") : undefined}
            required
          />
          <TextField
            name="bootstrapToken"
            label={t("form.tokenLabel")}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            mono
            hint={t("form.tokenHint")}
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
            disabled={!valid}
          >
            {t("action.create")}
          </ActionButton>
        </form>
      </div>
    </div>
  );
}
