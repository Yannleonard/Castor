// ui/src/views/settings/TlsCard.tsx
//
// Settings > "HTTPS & certificates": which certificate Castor serves and how
// it is obtained. Three sources — the self-signed default, an imported
// operator certificate (DigiCert, Thawte, internal CA…) and Let's Encrypt
// (ACME) — plus the read-only "off" mode when HTTPS is disabled by
// environment (CASTOR_TLS_MODE=off, reverse proxy terminating TLS): the
// server then reports managedByEnv and refuses every mutation, so the card
// offers none. Every action is an immediate call against /settings/tls (mode
// switch, import/removal, ACME renewal) that answers the fresh status,
// written straight into the query cache; nothing goes through the page-level
// "Save changes" button. The API only ever returns public certificate
// metadata — the private key of an imported certificate is sent once by the
// import modal and never comes back.
//
// Leaving a trusted certificate (custom or Let's Encrypt) for the self-signed
// one is confirmed first: while a trusted certificate is served Castor sends
// HSTS (max-age one day), so browsers that visited meanwhile refuse the
// self-signed certificate until that window lapses.

import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { qk, useTlsStatus } from "../../lib/hooks";
import { formatDateTime, timeAgo } from "../../lib/format";
import { ActionButton } from "../../components/ActionButton";
import { ConfirmDestructiveDialog } from "../../components/ConfirmDestructiveDialog";
import { TextField } from "../../components/Field";
import {
  IconAlert,
  IconCheck,
  IconClose,
  IconCopy,
  IconDownload,
  IconLock,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "../../components/icons";
import { toast, toastError } from "../../lib/toast";
import { useT } from "../../i18n";
import { settingsDict } from "../../i18n/locales/settings";
import type { TlsCertificateInfo, TlsMode, TlsStatus } from "../../lib/types";
import { ImportCertificateModal } from "./ImportCertificateModal";
import {
  expiryTone,
  httpsUrl,
  isSelfSignedCustom,
  normalizeDomain,
  sameDomains,
  shortFingerprint,
  validateAcmeDomain,
  validateAcmeEmail,
  type ExpiryTone,
} from "./tls";

interface Tint {
  fg: string;
  bg: string;
}

// Badge tint per effective mode: trusted sources read as healthy, the
// self-signed default as a warning (browsers do warn), off as inert.
const MODE_TINT: Record<TlsMode, Tint> = {
  "self-signed": { fg: "var(--warning)", bg: "var(--warning-bg)" },
  custom: { fg: "var(--success)", bg: "var(--success-bg)" },
  acme: { fg: "var(--success)", bg: "var(--success-bg)" },
  off: { fg: "var(--text-muted)", bg: "var(--bg-inset)" },
};

const EXPIRY_TINT: Record<ExpiryTone, Tint> = {
  ok: MODE_TINT.custom,
  warn: MODE_TINT["self-signed"],
  danger: { fg: "var(--danger)", bg: "var(--danger-bg)" },
};

// Which action is in flight; every other control is disabled meanwhile.
type Pending = "mode" | "acme" | "renew" | null;

// Which back-to-self-signed action awaits the HSTS lock-out confirmation:
// the self-signed radio, or disabling Let's Encrypt with no imported
// certificate to fall back on.
type SelfSignedIntent = "mode" | "acme" | null;

export function TlsCard() {
  const t = useT(settingsDict);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canRead = can("settings.read");
  const canUpdate = can("settings.update");
  // The status endpoint needs settings.read; don't fetch (and 403) without it.
  const tlsQ = useTlsStatus({ enabled: canRead });
  const status = tlsQ.data;

  const [importOpen, setImportOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [selfSignedIntent, setSelfSignedIntent] = useState<SelfSignedIntent>(null);
  const [pending, setPending] = useState<Pending>(null);

  // ACME draft, seeded from the persisted configuration once it is known and
  // re-seeded after each mutation reply. The 60s poll never touches it: a
  // domain list being typed must not vanish under the operator.
  const [domains, setDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [email, setEmail] = useState("");
  const [staging, setStaging] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!status || seeded) return;
    setDomains(status.acme.domains);
    setEmail(status.acme.email);
    setStaging(status.acme.staging);
    setSeeded(true);
  }, [status, seeded]);

  // Mutations answer the full status: write it to the cache instead of
  // refetching, and align the ACME draft with what was persisted.
  const applyStatus = (next: TlsStatus) => {
    queryClient.setQueryData(qk.tls, next);
    setDomains(next.acme.domains);
    setEmail(next.acme.email);
    setStaging(next.acme.staging);
  };

  const busy = pending !== null;
  // CASTOR_TLS_MODE=off forces the mode and the API answers 409 to every
  // change: the card is read-only rather than offering switches that would
  // be refused. mode "off" only ever occurs that way (kept as a fallback for
  // a status predating managedByEnv).
  const locked = !!status && (status.managedByEnv || status.mode === "off");
  // No bound HTTPS listener: an ACME issuance could never be served, so the
  // Let's Encrypt actions are held back with an explanation.
  const listenerOff = !!status && !status.serving;
  // Visitors currently get a browser-trusted certificate, so HSTS was sent:
  // falling back to self-signed is confirmed with the lock-out warning.
  const trustedNow = status?.effectiveMode === "custom" || status?.effectiveMode === "acme";
  const canAct = canUpdate && !locked && !busy;
  const deniedTooltip = !canUpdate ? t("tls.actionDenied") : locked ? t("tls.managedByEnv") : undefined;
  const acmeTooltip = deniedTooltip ?? (listenerOff ? t("tls.listenerOff") : undefined);

  const emailOk = validateAcmeEmail(email);
  const acmeDraftValid = domains.length > 0 && emailOk;
  const acmeDirty =
    !!status &&
    (!sameDomains(domains, status.acme.domains) ||
      email.trim() !== status.acme.email ||
      staging !== status.acme.staging);

  const candidate = normalizeDomain(newDomain);
  const domainError =
    newDomain.trim() === ""
      ? null
      : validateAcmeDomain(newDomain) ?? (domains.includes(candidate) ? "duplicate" : null);

  const addDomain = () => {
    if (newDomain.trim() === "" || domainError) return;
    setDomains((prev) => [...prev, candidate]);
    setNewDomain("");
  };
  const removeDomain = (d: string) => setDomains((prev) => prev.filter((x) => x !== d));

  // The PUT behind every plain mode change. Failures are toasted and
  // rethrown so a confirmation dialog stays open on a refusal.
  const switchMode = async (mode: TlsMode, toastTitle: string) => {
    setPending("mode");
    try {
      applyStatus(await api.tlsUpdate({ mode }));
      toast.success(toastTitle, t(`tls.mode.${mode}`));
    } catch (err) {
      toastError(t("tls.toast.modeFailed"), err);
      throw err;
    } finally {
      setPending(null);
    }
  };

  // Self-signed / custom switch. "custom" needs an imported certificate (the
  // radio is disabled otherwise, and the server answers 409 regardless).
  // Going back to self-signed from a trusted certificate asks first.
  const setMode = (mode: TlsMode) => {
    if (!status || mode === status.mode) return;
    if (mode === "self-signed" && trustedNow) {
      setSelfSignedIntent("mode");
      return;
    }
    void switchMode(mode, t("tls.toast.modeChanged")).catch(() => undefined);
  };

  // Enable Let's Encrypt, or re-apply an edited domain list while it is
  // active: both are the same PUT with the draft, which (re)starts the
  // issuance in the background. The status poll reports the outcome.
  const applyAcme = async () => {
    if (!acmeDraftValid) return;
    setPending("acme");
    try {
      applyStatus(await api.tlsUpdate({ mode: "acme", acme: { domains, email: email.trim(), staging } }));
      toast.success(t("tls.toast.acmeEnabled"), t("tls.toast.acmeEnabledBody"));
    } catch (err) {
      toastError(t("tls.toast.modeFailed"), err);
    } finally {
      setPending(null);
    }
  };

  // Renew waits up to ~20s server-side; a 202 (CA still silent) resolves like
  // a 200 with ready=false and the issuance keeps running in the background.
  const renewAcme = async () => {
    setPending("renew");
    try {
      const next = await api.tlsRenewAcme();
      applyStatus(next);
      if (next.acme.ready) toast.success(t("tls.toast.acmeRenewed"), next.certificate?.subject);
      else toast.info(t("tls.toast.acmePending"), t("tls.toast.acmePendingBody"));
    } catch (err) {
      toastError(t("tls.toast.acmeFailed"), err);
    } finally {
      setPending(null);
    }
  };

  // Leaving acme falls back to the imported certificate when there is one,
  // else to self-signed — never to "off". The self-signed fallback from a
  // served Let's Encrypt certificate asks first.
  const disableAcme = () => {
    if (!status) return;
    const fallback: TlsMode = status.hasCustomCertificate ? "custom" : "self-signed";
    if (fallback === "self-signed" && trustedNow) {
      setSelfSignedIntent("acme");
      return;
    }
    void switchMode(fallback, t("tls.toast.acmeDisabled")).catch(() => undefined);
  };

  // Confirmed lock-out dialog: the same PUT, titled after what was asked.
  const confirmSelfSigned = () =>
    switchMode("self-signed", selfSignedIntent === "acme" ? t("tls.toast.acmeDisabled") : t("tls.toast.modeChanged"));

  const removeCustom = async () => {
    try {
      applyStatus(await api.tlsRemoveCertificate());
      toast.success(t("tls.toast.removed"));
    } catch (err) {
      toastError(t("tls.toast.removeFailed"), err);
      throw err;
    }
  };

  const modeLabel = (mode: TlsMode) => t(`tls.mode.${mode}`);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">
          <span className="row" style={{ gap: 6 }}>
            <IconLock size={15} /> {t("tls.title")}
          </span>
        </span>
        {status ? (
          <span className="row" style={{ gap: 6 }}>
            <ModeBadge mode={status.effectiveMode} label={modeLabel(status.effectiveMode)} />
            {status.certificate?.expired ? <ExpiredBadge /> : null}
          </span>
        ) : null}
      </div>
      <div className="card-body col" style={{ gap: "var(--sp-5)" }}>
        <span className="text-xs muted" style={{ maxWidth: 540 }}>
          {t("tls.intro")}
        </span>

        {!canRead ? (
          <span className="text-sm muted">{t("tls.noPermission")}</span>
        ) : tlsQ.isLoading ? (
          <span className="text-sm muted">{t("tls.loading")}</span>
        ) : tlsQ.isError || !status ? (
          <span className="text-sm" style={{ color: "var(--danger)" }}>
            {t("tls.loadError")}
          </span>
        ) : (
          <>
            {locked ? (
              <div className="banner info" style={{ alignItems: "flex-start" }}>
                <IconAlert size={16} style={{ flex: "0 0 auto", marginTop: 2 }} />
                <span>
                  <strong>{t("tls.managedByEnv")}</strong> — {t("tls.managedByEnvHint")}
                </span>
              </div>
            ) : null}

            {/* ---- overview: effective mode, address, served certificate ---- */}
            <dl className="dl">
              <dt>{t("tls.effective")}</dt>
              <dd>
                <span className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
                  <ModeBadge mode={status.effectiveMode} label={modeLabel(status.effectiveMode)} />
                  {status.certificate?.expired ? <ExpiredBadge /> : null}
                  {status.mode !== status.effectiveMode && status.effectiveMode === "self-signed" ? (
                    <span className="text-xs muted">{t("tls.fallbackSelfSigned")}</span>
                  ) : null}
                </span>
              </dd>
              {status.effectiveMode !== "off" ? (
                <>
                  <dt>{t("tls.url")}</dt>
                  <dd>
                    <span className="col" style={{ gap: 2 }}>
                      {/* The server computes the URL with the redirect rule
                          (request host, HTTPS port only when needed); the
                          local rebuild only covers a status without it. */}
                      <span className="mono">
                        {status.publicHttpsUrl || httpsUrl(status.httpsAddr, window.location.hostname)}
                      </span>
                      <span className="text-xs muted">{t("tls.urlHint")}</span>
                      <span className="text-xs muted">
                        {status.redirect
                          ? t("tls.redirect", { addr: status.httpAddr })
                          : t("tls.noRedirect", { addr: status.httpAddr })}
                      </span>
                      {status.hsts ? <span className="text-xs muted">{t("tls.hstsOn")}</span> : null}
                    </span>
                  </dd>
                </>
              ) : null}
            </dl>

            {status.restartRequired ? (
              <div className="banner warning">
                <IconAlert size={16} />
                <span>{t("tls.restartRequired")}</span>
              </div>
            ) : null}

            <Section title={t("tls.cert.title")}>
              {status.certificate ? (
                <CertificateDetails cert={status.certificate} />
              ) : (
                <span className="text-sm muted">{t("tls.cert.none")}</span>
              )}
            </Section>

            {status.effectiveMode === "self-signed" ? (
              <div className="banner info" style={{ alignItems: "flex-start" }}>
                <IconAlert size={16} style={{ flex: "0 0 auto", marginTop: 2 }} />
                <div className="col" style={{ gap: "var(--sp-2)" }}>
                  <span>{t("tls.selfSigned.callout")}</span>
                  <div className="row-wrap" style={{ gap: "var(--sp-3)", alignItems: "center" }}>
                    <a
                      className="btn btn-sm"
                      href={api.tlsCertificateDownloadUrl()}
                      download="castor.crt"
                      style={{ textDecoration: "none" }}
                    >
                      <IconDownload size={14} />
                      {t("tls.selfSigned.download")}
                    </a>
                    <span className="text-xs muted">{t("tls.selfSigned.trust")}</span>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ---- certificate source ---- */}
            <Section title={t("tls.select.title")}>
              <div className="col" style={{ gap: "var(--sp-2)" }}>
                <ModeOption
                  mode="self-signed"
                  label={modeLabel("self-signed")}
                  hint={t("tls.select.selfSignedHint")}
                  checked={status.mode === "self-signed"}
                  disabled={!canAct}
                  tooltip={deniedTooltip}
                  onSelect={() => setMode("self-signed")}
                />
                <ModeOption
                  mode="custom"
                  label={modeLabel("custom")}
                  hint={
                    status.hasCustomCertificate
                      ? t("tls.select.customHint")
                      : `${t("tls.select.customHint")} ${t("tls.select.customNeedsImport")}`
                  }
                  checked={status.mode === "custom"}
                  disabled={!canAct || !status.hasCustomCertificate}
                  tooltip={deniedTooltip ?? (status.hasCustomCertificate ? undefined : t("tls.select.customNeedsImport"))}
                  onSelect={() => setMode("custom")}
                />
                <ModeOption
                  mode="acme"
                  label={modeLabel("acme")}
                  hint={
                    acmeDraftValid
                      ? t("tls.select.acmeHint")
                      : `${t("tls.select.acmeHint")} ${t("tls.select.acmeNeedsDomain")}`
                  }
                  checked={status.mode === "acme"}
                  disabled={!canAct || listenerOff || !acmeDraftValid}
                  tooltip={acmeTooltip ?? (acmeDraftValid ? undefined : t("tls.select.acmeNeedsDomain"))}
                  onSelect={applyAcme}
                />
                <ModeOption
                  mode="off"
                  label={t("tls.select.offLabel")}
                  hint={t("tls.select.offHint")}
                  checked={status.mode === "off"}
                  disabled
                  onSelect={() => undefined}
                />
              </div>
            </Section>

            {/* ---- custom certificate ---- */}
            <Section title={t("tls.custom.title")}>
              <span className="text-xs muted" style={{ maxWidth: 540 }}>
                {t("tls.custom.intro")}
              </span>
              {status.custom ? (
                <div className="col" style={{ gap: "var(--sp-2)" }}>
                  <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
                    <span className="text-sm" style={{ fontWeight: 600 }}>
                      {t("tls.custom.installed")}
                    </span>
                    {status.effectiveMode === "custom" ? (
                      <span className="pill" style={{ color: MODE_TINT.custom.fg, background: MODE_TINT.custom.bg }}>
                        <IconCheck size={12} />
                        {t("tls.custom.served")}
                      </span>
                    ) : (
                      <span className="text-xs muted">{t("tls.custom.notServed")}</span>
                    )}
                  </div>
                  <CertificateDetails cert={status.custom} />
                  {/* Accepted without a chain because it signs itself: served,
                      but no browser trusts it until it is in the trust store. */}
                  {isSelfSignedCustom(status.custom) ? (
                    <div className="banner warning" style={{ alignItems: "flex-start" }}>
                      <IconAlert size={16} style={{ flex: "0 0 auto", marginTop: 2 }} />
                      <span>{t("tls.custom.selfSignedWarn")}</span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <span className="text-sm muted">{t("tls.custom.none")}</span>
              )}
              <div className="row-wrap" style={{ gap: "var(--sp-2)" }}>
                <ActionButton
                  size="sm"
                  variant={status.custom ? "default" : "primary"}
                  disabled={!canAct}
                  tooltip={deniedTooltip}
                  onClick={() => setImportOpen(true)}
                >
                  <IconPlus size={14} />
                  {status.custom ? t("tls.custom.replace") : t("tls.custom.import")}
                </ActionButton>
                {status.hasCustomCertificate ? (
                  <ActionButton
                    size="sm"
                    variant="ghost"
                    disabled={!canAct}
                    tooltip={deniedTooltip}
                    style={{ color: "var(--danger)" }}
                    onClick={() => setRemoveOpen(true)}
                  >
                    <IconTrash size={14} />
                    {t("tls.custom.remove")}
                  </ActionButton>
                ) : null}
              </div>
            </Section>

            {/* ---- Let's Encrypt ---- */}
            <Section title={t("tls.acme.title")}>
              <span className="text-xs muted" style={{ maxWidth: 540 }}>
                {t("tls.acme.intro")}
              </span>
              <div className="banner warning" style={{ alignItems: "flex-start" }}>
                <IconAlert size={16} style={{ flex: "0 0 auto", marginTop: 2 }} />
                <span>{t("tls.acme.prereq", { http: status.httpAddr, https: status.httpsAddr })}</span>
              </div>

              <div className="col" style={{ gap: "var(--sp-2)" }}>
                <span className="text-sm" style={{ fontWeight: 600 }}>
                  {t("tls.acme.domains")}
                </span>
                <div className="row-wrap" style={{ gap: 6 }}>
                  {domains.map((d) => (
                    <span key={d} className="chip chip-mono">
                      {d}
                      {canAct ? (
                        <button
                          className="toast-close"
                          style={{ marginLeft: 4 }}
                          onClick={() => removeDomain(d)}
                          aria-label={t("tls.acme.removeDomain", { domain: d })}
                        >
                          <IconClose size={12} />
                        </button>
                      ) : null}
                    </span>
                  ))}
                  {domains.length === 0 ? <span className="muted text-sm">{t("tls.acme.noDomains")}</span> : null}
                </div>
                {canAct ? (
                  <div className="col" style={{ gap: 4 }}>
                    <div className="row" style={{ gap: "var(--sp-2)" }}>
                      <input
                        className="input input-mono"
                        style={{ maxWidth: 320 }}
                        placeholder={t("tls.acme.domainPlaceholder")}
                        value={newDomain}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setNewDomain(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addDomain()}
                      />
                      <ActionButton variant="ghost" size="sm" onClick={addDomain} disabled={newDomain.trim() === "" || !!domainError}>
                        <IconPlus size={14} />
                        {t("tls.acme.addDomain")}
                      </ActionButton>
                    </div>
                    {domainError ? <span className="field-error">{t(`tls.acme.domain.${domainError}`)}</span> : null}
                  </div>
                ) : null}
              </div>

              <TextField
                label={t("tls.acme.email")}
                type="email"
                value={email}
                disabled={!canAct}
                autoComplete="off"
                style={{ maxWidth: 320 }}
                onChange={(e) => setEmail(e.target.value)}
                error={emailOk ? undefined : t("tls.acme.emailInvalid")}
                hint={t("tls.acme.emailHint")}
              />

              <label className="checkbox-row">
                <input type="checkbox" checked={staging} disabled={!canAct} onChange={(e) => setStaging(e.target.checked)} />
                <span>{t("tls.acme.staging")}</span>
              </label>

              {status.mode === "acme" ? (
                <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
                  {status.acme.ready ? (
                    <span className="pill" style={{ color: MODE_TINT.acme.fg, background: MODE_TINT.acme.bg }}>
                      <IconCheck size={12} />
                      {t("tls.acme.ready")}
                    </span>
                  ) : (
                    <span className="pill" style={{ color: MODE_TINT["self-signed"].fg, background: MODE_TINT["self-signed"].bg }}>
                      {t("tls.acme.pending")}
                    </span>
                  )}
                  {status.acme.lastIssued ? (
                    <span className="text-xs muted" title={formatDateTime(status.acme.lastIssued)}>
                      {t("tls.acme.lastIssued", { when: timeAgo(status.acme.lastIssued) })}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {status.acme.lastError ? (
                <div className="banner danger" style={{ alignItems: "flex-start" }}>
                  <IconAlert size={16} style={{ flex: "0 0 auto", marginTop: 2 }} />
                  <span style={{ wordBreak: "break-word" }}>
                    <strong>{t("tls.acme.lastError")}</strong>
                    {status.acme.lastErrorAt ? ` (${timeAgo(status.acme.lastErrorAt)})` : ""}
                    {": "}
                    <span className="mono">{status.acme.lastError}</span>
                  </span>
                </div>
              ) : null}

              <div className="row-wrap" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
                {status.mode === "acme" ? (
                  <>
                    <ActionButton
                      size="sm"
                      variant="primary"
                      loading={pending === "acme"}
                      disabled={!canAct || listenerOff || !acmeDraftValid || !acmeDirty}
                      tooltip={acmeTooltip}
                      onClick={applyAcme}
                    >
                      {t("tls.acme.apply")}
                    </ActionButton>
                    <ActionButton
                      size="sm"
                      loading={pending === "renew"}
                      disabled={!canAct || listenerOff}
                      tooltip={acmeTooltip}
                      onClick={renewAcme}
                    >
                      <IconRefresh size={14} />
                      {t("tls.acme.renew")}
                    </ActionButton>
                    <ActionButton
                      size="sm"
                      variant="ghost"
                      disabled={!canAct}
                      tooltip={deniedTooltip ?? t("tls.acme.disableHint")}
                      onClick={disableAcme}
                    >
                      {t("tls.acme.disable")}
                    </ActionButton>
                    <span className="text-xs muted">{t("tls.acme.disableHint")}</span>
                  </>
                ) : (
                  <ActionButton
                    size="sm"
                    variant="primary"
                    loading={pending === "acme"}
                    disabled={!canAct || listenerOff || !acmeDraftValid}
                    tooltip={acmeTooltip ?? (acmeDraftValid ? undefined : t("tls.select.acmeNeedsDomain"))}
                    onClick={applyAcme}
                  >
                    <IconLock size={14} />
                    {t("tls.acme.enable")}
                  </ActionButton>
                )}
              </div>
            </Section>
          </>
        )}
      </div>

      {importOpen ? <ImportCertificateModal onClose={() => setImportOpen(false)} onImported={applyStatus} /> : null}

      {/* Removing the served custom certificate falls back to self-signed:
          same lock-out warning as the explicit switch. */}
      <ConfirmDestructiveDialog
        open={removeOpen}
        title={t("tls.dialog.removeTitle")}
        variant="danger"
        confirmLabel={t("tls.dialog.removeConfirm")}
        description={
          <div className="col" style={{ gap: "var(--sp-3)" }}>
            <span>{t("tls.dialog.removeBody")}</span>
            {status?.effectiveMode === "custom" ? <HstsWarning /> : null}
          </div>
        }
        onConfirm={removeCustom}
        onClose={() => setRemoveOpen(false)}
      />

      <ConfirmDestructiveDialog
        open={selfSignedIntent !== null}
        title={t("tls.dialog.selfSignedTitle")}
        variant="danger"
        confirmLabel={t("tls.dialog.selfSignedConfirm")}
        description={
          <div className="col" style={{ gap: "var(--sp-3)" }}>
            <span>{selfSignedIntent === "acme" ? t("tls.dialog.acmeDisableBody") : t("tls.dialog.selfSignedBody")}</span>
            <HstsWarning />
          </div>
        }
        onConfirm={confirmSelfSigned}
        onClose={() => setSelfSignedIntent(null)}
      />
    </div>
  );
}

/* ===================== pieces ===================== */

// The HSTS lock-out callout shared by the back-to-self-signed dialogs.
function HstsWarning() {
  const t = useT(settingsDict);
  return (
    <div className="banner warning" style={{ alignItems: "flex-start" }}>
      <IconAlert size={16} style={{ flex: "0 0 auto", marginTop: 2 }} />
      <span>{t("tls.dialog.hstsWarn")}</span>
    </div>
  );
}

// Red "Expired" pill, shown beside the mode badge whenever the served
// certificate is past its validity (the server's verdict).
function ExpiredBadge() {
  const t = useT(settingsDict);
  return (
    <span className="pill" style={{ color: EXPIRY_TINT.danger.fg, background: EXPIRY_TINT.danger.bg }}>
      <IconAlert size={12} />
      {t("tls.cert.expired")}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="col" style={{ gap: "var(--sp-3)", paddingTop: "var(--sp-4)", borderTop: "1px solid var(--border)" }}>
      <span className="text-sm" style={{ fontWeight: 600 }}>
        {title}
      </span>
      {children}
    </div>
  );
}

function ModeBadge({ mode, label }: { mode: TlsMode; label: string }) {
  const tint = MODE_TINT[mode] ?? MODE_TINT.off;
  return (
    <span className="pill" style={{ color: tint.fg, background: tint.bg }}>
      {mode !== "off" ? <IconLock size={12} /> : null}
      {label}
    </span>
  );
}

interface ModeOptionProps {
  mode: TlsMode;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  tooltip?: string;
  onSelect: () => void;
}

// One radio of the certificate-source selector. Selecting it performs the
// switch at once (the radio reflects the server's configured mode, not a
// staged choice), so the radios are disabled while a call is in flight.
function ModeOption({ mode, label, hint, checked, disabled, tooltip, onSelect }: ModeOptionProps) {
  return (
    <label
      className="checkbox-row"
      title={disabled ? tooltip : undefined}
      style={{ alignItems: "flex-start", opacity: disabled && !checked ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      <input
        type="radio"
        name="tls-mode"
        value={mode}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        style={{ marginTop: 2 }}
      />
      <span className="col" style={{ gap: 2 }}>
        <span className="text-sm" style={{ fontWeight: 600, color: "var(--text-primary)" }}>
          {label}
        </span>
        <span className="text-xs muted">{hint}</span>
      </span>
    </label>
  );
}

// Public description of a certificate: subject, issuer, expiry (with the
// warn/danger badge), truncated SHA-256 fingerprint with a copy button, SANs.
function CertificateDetails({ cert }: { cert: TlsCertificateInfo }) {
  const t = useT(settingsDict);
  const tone = expiryTone(cert);
  const tint = EXPIRY_TINT[tone];
  const expiryLabel =
    tone === "danger"
      ? t("tls.cert.expired")
      : tone === "warn"
        ? t("tls.cert.expiringSoon", { days: cert.daysLeft })
        : t("tls.cert.daysLeft", { days: cert.daysLeft });

  const copyFingerprint = async () => {
    try {
      await navigator.clipboard.writeText(cert.fingerprintSha256);
      toast.success(t("tls.cert.copied"));
    } catch {
      toast.error(t("tls.cert.copyFailed"));
    }
  };

  return (
    <dl className="dl">
      <dt>{t("tls.cert.subject")}</dt>
      <dd className="mono">{cert.subject || "—"}</dd>
      <dt>{t("tls.cert.issuer")}</dt>
      <dd className="mono">{cert.issuer || "—"}</dd>
      <dt>{t("tls.cert.expires")}</dt>
      <dd>
        <span className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          <span>{formatDateTime(cert.notAfter)}</span>
          <span className="pill" style={{ color: tint.fg, background: tint.bg }}>
            {tone !== "ok" ? <IconAlert size={12} /> : null}
            {expiryLabel}
          </span>
        </span>
      </dd>
      <dt>{t("tls.cert.fingerprint")}</dt>
      <dd>
        <span className="row" style={{ gap: 6 }}>
          <span className="mono" title={cert.fingerprintSha256}>
            {shortFingerprint(cert.fingerprintSha256)}
          </span>
          <ActionButton
            size="sm"
            variant="ghost"
            iconOnly
            tooltip={t("tls.cert.copyFingerprint")}
            aria-label={t("tls.cert.copyFingerprint")}
            onClick={copyFingerprint}
          >
            <IconCopy size={14} />
          </ActionButton>
        </span>
      </dd>
      <dt>{t("tls.cert.sans")}</dt>
      <dd>
        {cert.sans.length > 0 ? (
          <span className="row-wrap" style={{ gap: 6 }}>
            {cert.sans.map((san) => (
              <span key={san} className="chip chip-mono">
                {san}
              </span>
            ))}
          </span>
        ) : (
          <span className="muted">{t("tls.cert.noSans")}</span>
        )}
      </dd>
    </dl>
  );
}
