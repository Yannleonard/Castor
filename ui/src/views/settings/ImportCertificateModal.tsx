// ui/src/views/settings/ImportCertificateModal.tsx
//
// Import an operator certificate (DigiCert, Thawte, an internal CA…): the PEM
// leaf, its unencrypted PEM private key and the optional PEM chain, each
// pasted or loaded from a file (read client-side as text; nothing leaves the
// browser before submit). The only checks here are the PEM sniffs of ./tls.ts;
// the real validation happens server-side and a refusal surfaces through
// toastError, localized by code (tls_key_mismatch, tls_certificate_expired,
// tls_invalid_certificate). The private key travels once in the POST body and
// is never echoed: not in a toast, not in the status the server answers with.

import { useRef, useState, type ChangeEvent } from "react";
import { api } from "../../lib/api";
import { Modal } from "../../components/Modal";
import { ActionButton } from "../../components/ActionButton";
import { FieldWrap } from "../../components/Field";
import { toast, toastError } from "../../lib/toast";
import { useT } from "../../i18n";
import { settingsDict } from "../../i18n/locales/settings";
import { commonDict } from "../../i18n/locales/common";
import type { TlsStatus } from "../../lib/types";
import { importReady, validatePem, type PemKind } from "./tls";

interface Props {
  onClose: () => void;
  /** Receives the status the import answered with (mode already "custom"). */
  onImported: (status: TlsStatus) => void;
}

export function ImportCertificateModal({ onClose, onImported }: Props) {
  const t = useT(settingsDict);
  const tc = useT(commonDict);
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const [chainPem, setChainPem] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = importReady(certPem, keyPem, chainPem);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const status = await api.tlsImportCertificate({
        certPem: certPem.trim(),
        keyPem: keyPem.trim(),
        chainPem: chainPem.trim(),
      });
      // The reply carries public metadata only; the subject is safe to show.
      toast.success(t("tls.toast.imported"), status.custom?.subject);
      onImported(status);
      onClose();
    } catch (err) {
      toastError(t("tls.toast.importFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      title={t("tls.import.title")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {tc("cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("tls.import.submit")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <span className="text-xs muted">{t("tls.import.intro")}</span>
        <PemField
          kind="cert"
          label={t("tls.import.cert")}
          hint={t("tls.import.certHint")}
          value={certPem}
          onChange={setCertPem}
          accept=".pem,.crt,.cer,.cert"
          autoFocus
        />
        <PemField
          kind="key"
          label={t("tls.import.key")}
          hint={t("tls.import.keyHint")}
          value={keyPem}
          onChange={setKeyPem}
          accept=".pem,.key"
        />
        <PemField
          kind="chain"
          label={t("tls.import.chain")}
          hint={t("tls.import.chainHint")}
          value={chainPem}
          onChange={setChainPem}
          accept=".pem,.crt,.cer,.ca-bundle"
        />
      </div>
    </Modal>
  );
}

interface PemFieldProps {
  kind: PemKind;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  /** accept attribute of the hidden file input */
  accept: string;
  autoFocus?: boolean;
}

// One PEM part: a monospace textarea plus a "Load from file…" button feeding
// the same textarea, so a loaded file can still be inspected or trimmed before
// submit. The file input hides behind the button and is reset after each pick
// so the same file can be chosen again after a fix.
function PemField({ kind, label, hint, value, onChange, accept, autoFocus }: PemFieldProps) {
  const t = useT(settingsDict);
  const tc = useT(commonDict);
  const fileRef = useRef<HTMLInputElement>(null);
  const error = validatePem(kind, value);
  const inputId = `tls-import-${kind}`;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      onChange(await file.text());
    } catch {
      toast.error(t("tls.import.fileReadFailed"));
    }
  };

  return (
    <FieldWrap label={label} hint={hint} error={error ? t(`tls.import.${error}`) : undefined} htmlFor={inputId}>
      <textarea
        id={inputId}
        className="textarea input-mono"
        rows={5}
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={kind === "key" ? "-----BEGIN PRIVATE KEY-----" : "-----BEGIN CERTIFICATE-----"}
        style={{ fontSize: "var(--fs-xs)" }}
      />
      <div className="row" style={{ gap: "var(--sp-2)", marginTop: 4 }}>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          style={{ display: "none" }}
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFile}
        />
        <ActionButton size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
          {t("tls.import.loadFile")}
        </ActionButton>
        {value ? (
          <button className="btn btn-sm btn-ghost" onClick={() => onChange("")}>
            {tc("reset")}
          </button>
        ) : null}
      </div>
    </FieldWrap>
  );
}
