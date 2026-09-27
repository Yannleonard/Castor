// ui/src/views/settings/ImportCertificateModal.tsx
//
// Import an operator certificate (DigiCert, Thawte, an internal CA…). Two ways
// to hand over the material, both pasted or loaded from files read client-side
// as text (nothing leaves the browser before submit):
//   - "Single file" (default): the combined PEM export most providers and
//     openssl produce — certificate, unencrypted private key and CA chain in
//     one text, in any order. It travels untouched in certPem; the server
//     splits the blocks and sorts them (one key, the matching leaf, the rest
//     as chain).
//   - "Separate files": the PEM leaf, its PEM private key and the optional
//     PEM chain in three zones.
// The only checks here are the PEM sniffs of ./tls.ts; the real validation
// happens server-side and a refusal surfaces through toastError, which shows
// the localized code followed by the server's precise reason (missing SAN,
// encrypted key, chain that does not sign the leaf…). The private key travels
// once in the POST body and is never echoed: not in a toast, not in the
// status the server answers with.

import { useRef, useState, type ChangeEvent } from "react";
import { api } from "../../lib/api";
import { Modal } from "../../components/Modal";
import { ActionButton } from "../../components/ActionButton";
import { FieldWrap } from "../../components/Field";
import { toast, toastError } from "../../lib/toast";
import { useT } from "../../i18n";
import { settingsDict } from "../../i18n/locales/settings";
import { commonDict } from "../../i18n/locales/common";
import type { ImportCertificateRequest, TlsStatus } from "../../lib/types";
import { combinedImportReady, importReady, validateCombinedPem, validatePem, type ImportMode, type PemKind } from "./tls";

interface Props {
  onClose: () => void;
  /** Receives the status the import answered with (mode already "custom"). */
  onImported: (status: TlsStatus) => void;
}

export function ImportCertificateModal({ onClose, onImported }: Props) {
  const t = useT(settingsDict);
  const tc = useT(commonDict);
  const [mode, setMode] = useState<ImportMode>("single");
  const [combinedPem, setCombinedPem] = useState("");
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const [chainPem, setChainPem] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = mode === "single" ? combinedImportReady(combinedPem) : importReady(certPem, keyPem, chainPem);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const body: ImportCertificateRequest =
        mode === "single"
          ? { certPem: combinedPem.trim() }
          : { certPem: certPem.trim(), keyPem: keyPem.trim(), chainPem: chainPem.trim() };
      const status = await api.tlsImportCertificate(body);
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

        {/* Each mode keeps its own draft, so switching back and forth loses nothing. */}
        <div className="row-wrap" style={{ gap: "var(--sp-4)", alignItems: "center" }} role="radiogroup" aria-label={t("tls.import.mode")}>
          <span className="text-xs muted">{t("tls.import.mode")}</span>
          <label className="checkbox-row">
            <input type="radio" name="tls-import-mode" value="single" checked={mode === "single"} disabled={busy} onChange={() => setMode("single")} />
            <span>{t("tls.import.modeSingle")}</span>
          </label>
          <label className="checkbox-row">
            <input type="radio" name="tls-import-mode" value="separate" checked={mode === "separate"} disabled={busy} onChange={() => setMode("separate")} />
            <span>{t("tls.import.modeSeparate")}</span>
          </label>
        </div>

        {mode === "single" ? (
          <PemField
            kind="combined"
            label={t("tls.import.combined")}
            hint={t("tls.import.combinedHint")}
            value={combinedPem}
            onChange={setCombinedPem}
            accept=".pem,.crt,.cer,.key,.txt"
            rows={12}
            multiple
            autoFocus
          />
        ) : (
          <>
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
          </>
        )}
      </div>
    </Modal>
  );
}

interface PemFieldProps {
  /** One part of the separate mode, or the whole combined export. */
  kind: PemKind | "combined";
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  /** accept attribute of the hidden file input */
  accept: string;
  rows?: number;
  /** Let several files be picked at once; their texts are concatenated. */
  multiple?: boolean;
  autoFocus?: boolean;
}

const PLACEHOLDER: Record<PemKind | "combined", string> = {
  cert: "-----BEGIN CERTIFICATE-----",
  key: "-----BEGIN PRIVATE KEY-----",
  chain: "-----BEGIN CERTIFICATE-----",
  combined: "-----BEGIN CERTIFICATE-----\n…\n-----BEGIN PRIVATE KEY-----\n…\n-----BEGIN CERTIFICATE-----",
};

// One PEM zone: a monospace textarea plus a "Load from file…" button feeding
// the same textarea, so a loaded file can still be inspected or trimmed before
// submit. The file input hides behind the button and is reset after each pick
// so the same file can be chosen again after a fix. Picking replaces the zone;
// with `multiple`, the chosen files are joined in selection order.
function PemField({ kind, label, hint, value, onChange, accept, rows = 5, multiple, autoFocus }: PemFieldProps) {
  const t = useT(settingsDict);
  const tc = useT(commonDict);
  const fileRef = useRef<HTMLInputElement>(null);
  const error = kind === "combined" ? validateCombinedPem(value) : validatePem(kind, value);
  const inputId = `tls-import-${kind}`;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    try {
      const texts = await Promise.all(files.map((f) => f.text()));
      onChange(texts.map((s) => s.trim()).join("\n"));
    } catch {
      toast.error(t("tls.import.fileReadFailed"));
    }
  };

  return (
    <FieldWrap label={label} hint={hint} error={error ? t(`tls.import.${error}`) : undefined} htmlFor={inputId}>
      <textarea
        id={inputId}
        className="textarea input-mono"
        rows={rows}
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={PLACEHOLDER[kind]}
        style={{ fontSize: "var(--fs-xs)" }}
      />
      <div className="row" style={{ gap: "var(--sp-2)", marginTop: 4 }}>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          multiple={multiple}
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
