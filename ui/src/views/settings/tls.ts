// ui/src/views/settings/tls.ts
//
// Pure helpers behind the HTTPS & certificates card. PEM sniffing keeps the
// import form honest before the round trip (the real validation — key/leaf
// match, validity window, key strength — is server-side, in tlsmgr); the ACME
// pre-checks mirror tlsmgr's domain and e-mail rules so an obviously rejected
// value is flagged in the field rather than by a 422; the rest are small
// presentation helpers (https URL, fingerprint, expiry tone).

import type { TlsCertificateInfo } from "../../lib/types";

/** Server-side cap on each PEM part (tlsmgr.MaxPEMBytes). PEM is ASCII, so
 *  the string length is the byte count. */
export const MAX_PEM_BYTES = 64 * 1024;

/** Days-left threshold under which the expiry badge turns to a warning. */
export const EXPIRY_WARN_DAYS = 30;

const CERT_BLOCK = /-----BEGIN CERTIFICATE-----/;
// "PRIVATE KEY" (PKCS#8), "RSA PRIVATE KEY", "EC PRIVATE KEY"…
const KEY_BLOCK = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
// tlsmgr refuses a block type containing ENCRYPTED or a Proc-Type header
// (legacy OpenSSL "Proc-Type: 4,ENCRYPTED").
const ENCRYPTED_BLOCK = /-----BEGIN (?:[A-Z0-9]+ )*ENCRYPTED(?: [A-Z0-9]+)*-----/;
const PROC_TYPE = /^Proc-Type:/m;

export function looksLikeCertificatePem(text: string): boolean {
  return CERT_BLOCK.test(text);
}

export function looksLikePrivateKeyPem(text: string): boolean {
  return KEY_BLOCK.test(text);
}

export function isEncryptedPrivateKeyPem(text: string): boolean {
  return ENCRYPTED_BLOCK.test(text) || PROC_TYPE.test(text);
}

export type PemKind = "cert" | "key" | "chain";

/** Field-level problem with a PEM part; keys map to settingsDict tls.import.*. */
export type PemError = "notPemCert" | "notPemKey" | "keyEncrypted" | "tooLarge";

/**
 * Validates one pasted/loaded PEM part. An empty value is not an error here:
 * the submit gate handles the required parts (the chain is optional).
 */
export function validatePem(kind: PemKind, text: string): PemError | null {
  const v = text.trim();
  if (v === "") return null;
  if (v.length > MAX_PEM_BYTES) return "tooLarge";
  if (kind === "key") {
    if (isEncryptedPrivateKeyPem(v)) return "keyEncrypted";
    return looksLikePrivateKeyPem(v) ? null : "notPemKey";
  }
  return looksLikeCertificatePem(v) ? null : "notPemCert";
}

/** Whether the import form can be submitted: leaf + key present and every
 *  part sniffs as PEM. */
export function importReady(certPem: string, keyPem: string, chainPem: string): boolean {
  return (
    certPem.trim() !== "" &&
    keyPem.trim() !== "" &&
    validatePem("cert", certPem) === null &&
    validatePem("key", keyPem) === null &&
    validatePem("chain", chainPem) === null
  );
}

/* ---- single-file import ---- */

/** How the import modal collects the material: one combined PEM (the export
 *  most providers and openssl produce) or the three parts separately. */
export type ImportMode = "single" | "separate";

/** Problem with the combined paste; keys map to settingsDict tls.import.*. */
export type CombinedPemError = "notPem" | "missingKey" | "missingCert" | "keyEncrypted" | "tooLarge";

/**
 * Validates the single-file paste. The server splits the text into PEM
 * blocks and sorts them itself (exactly one private key, the certificate
 * matching it as the leaf, the rest as the chain), so the only client-side
 * requirements are one certificate block and one unencrypted key block, under
 * the per-field cap. An empty value is not an error (the submit gate is).
 */
export function validateCombinedPem(text: string): CombinedPemError | null {
  const v = text.trim();
  if (v === "") return null;
  if (v.length > MAX_PEM_BYTES) return "tooLarge";
  const hasCert = looksLikeCertificatePem(v);
  const hasKey = looksLikePrivateKeyPem(v);
  if (!hasCert && !hasKey) return "notPem";
  if (isEncryptedPrivateKeyPem(v)) return "keyEncrypted";
  if (!hasKey) return "missingKey";
  if (!hasCert) return "missingCert";
  return null;
}

/** Submit gate of the single-file mode. */
export function combinedImportReady(text: string): boolean {
  return text.trim() !== "" && validateCombinedPem(text) === null;
}

/**
 * Whether an imported certificate is self-signed, i.e. imported without a
 * chain and signed with its own key: the server accepts it but browsers will
 * not trust it. selfSignedCustom is the server's explicit verdict; a status
 * predating it falls back to the generic selfSigned flag.
 */
export function isSelfSignedCustom(
  cert: Pick<TlsCertificateInfo, "selfSigned"> & Partial<Pick<TlsCertificateInfo, "selfSignedCustom">>,
): boolean {
  return cert.selfSignedCustom ?? cert.selfSigned;
}

/* ---- ACME ---- */

/** Problem with an ACME domain; keys map to settingsDict tls.acme.domain.*. */
export type DomainError = "wildcard" | "ip" | "notFqdn" | "invalid";

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Lower-cases, trims and drops a trailing dot, as tlsmgr does before validating. */
export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Mirrors tlsmgr.validateDomains: a fully-qualified hostname (at least one
 * dot), no wildcard (DNS-01 is not supported), no IP address, RFC 1123 labels.
 */
export function validateAcmeDomain(input: string): DomainError | null {
  const d = normalizeDomain(input);
  if (d === "") return "invalid";
  if (d.includes("*")) return "wildcard";
  if (IPV4.test(d) || d.includes(":")) return "ip";
  if (!d.includes(".")) return "notFqdn";
  if (d.length > 253) return "invalid";
  return d.split(".").every((label) => HOST_LABEL.test(label)) ? null : "invalid";
}

/** Mirrors tlsmgr.validateEmail: empty is fine (no contact), otherwise a
 *  single "@" with something on both sides and no whitespace. */
export function validateAcmeEmail(email: string): boolean {
  const e = email.trim();
  if (e === "") return true;
  const at = e.lastIndexOf("@");
  return at >= 1 && at < e.length - 1 && !/\s/.test(e);
}

/** Order-sensitive list equality, for the "draft differs from persisted" gate. */
export function sameDomains(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/* ---- presentation ---- */

/** The port of a listen address (":8443", "0.0.0.0:8443", "[::]:8443"), "" when none. */
export function listenPort(addr: string): string {
  const i = addr.lastIndexOf(":");
  return i < 0 ? "" : addr.slice(i + 1);
}

/**
 * The https URL visitors use, from the listener address and the hostname the
 * page was opened with (window.location.hostname keeps IPv6 brackets). 443
 * is implicit.
 */
export function httpsUrl(httpsAddr: string, hostname: string): string {
  const port = listenPort(httpsAddr);
  return port && port !== "443" ? `https://${hostname}:${port}` : `https://${hostname}`;
}

/** Keeps the first `bytes` pairs of a colon-separated fingerprint ("AB:CD:…"). */
export function shortFingerprint(fingerprint: string, bytes = 8): string {
  const parts = fingerprint.split(":");
  if (parts.length <= bytes) return fingerprint;
  return `${parts.slice(0, bytes).join(":")}…`;
}

export type ExpiryTone = "ok" | "warn" | "danger";

/**
 * danger when the server says the certificate is expired or notAfter has
 * passed, warn under EXPIRY_WARN_DAYS, ok otherwise. The server's verdict is
 * authoritative (its clock decides what is served); the local comparison only
 * covers a status computed before the boundary was crossed.
 */
export function expiryTone(
  cert: Pick<TlsCertificateInfo, "daysLeft" | "notAfter"> & Partial<Pick<TlsCertificateInfo, "expired">>,
  nowSeconds = Date.now() / 1000,
): ExpiryTone {
  if (cert.expired || cert.notAfter <= nowSeconds) return "danger";
  return cert.daysLeft < EXPIRY_WARN_DAYS ? "warn" : "ok";
}
