import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ActionButton } from "../../components/ActionButton";
import { TextField } from "../../components/Field";
import { toast, toastError } from "../../lib/toast";
import { useT } from "../../i18n";
import { settingsDict } from "../../i18n/locales/settings";
import type { ActivationStatus } from "../../lib/types";

export function ActivationCard() {
  const t = useT(settingsDict);
  const { can } = useAuth();
  const canUpdate = can("settings.update");
  const [status, setStatus] = useState<ActivationStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.activationStatus().then((result) => { if (!cancelled) setStatus(result); })
      .catch((err) => toastError(t("activation.loadFailed"), err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [t]);

  const activate = async () => {
    setBusy(true);
    try {
      const result = await api.activateInstance(key.trim());
      setStatus(result);
      setKey("");
      toast.success(t("activation.success"));
    } catch (err) {
      toastError(t("activation.failed"), err);
    } finally { setBusy(false); }
  };

  return <section className="card">
    <div className="card-header"><span className="card-title">{t("activation.title")}</span></div>
    <div className="card-body col" style={{ gap: "var(--sp-4)" }}>
      <p className="text-sm muted">{t("activation.privacy")}</p>
      {loading ? <span className="text-sm muted">{t("activation.loading")}</span> : status?.active ? <div className="col" style={{ gap: "var(--sp-2)" }}>
        <span className="chip" style={{ color: "var(--state-success, var(--text-primary))" }}>{t("activation.active")}</span>
        {status.hostName ? <span className="text-sm">{t("activation.hostName", { name: status.hostName })}</span> : null}
        {status.owner ? <span className="text-sm">{status.owner}</span> : null}
        {status.activatedAt ? <span className="text-xs muted">{t("activation.activatedAt", { date: new Date(status.activatedAt).toLocaleString() })}</span> : null}
      </div> : <span className="text-sm muted">{t("activation.inactive")}</span>}
      {!status?.active && canUpdate ? <div className="col" style={{ gap: "var(--sp-2)", maxWidth: 560 }}>
        <TextField label={t("activation.keyLabel")} value={key} onChange={(event) => setKey(event.target.value)} placeholder="CASTOR-…" autoComplete="off" />
        <span className="text-xs muted">{t("activation.keyHint")}</span>
        <div><ActionButton variant="primary" disabled={!key.trim() || busy || loading} loading={busy} onClick={activate}>{t("activation.button")}</ActionButton></div>
      </div> : null}
    </div>
  </section>;
}
