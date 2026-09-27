// ui/src/views/settings/tls.test.ts
//
// The client-side pre-checks must agree with tlsmgr: anything they accept
// may still be refused by the server (that is fine), but anything they
// refuse would have been refused by the server too.
import { describe, it, expect } from "vitest";
import {
  MAX_PEM_BYTES,
  expiryTone,
  httpsUrl,
  importReady,
  isEncryptedPrivateKeyPem,
  listenPort,
  normalizeDomain,
  sameDomains,
  shortFingerprint,
  validateAcmeDomain,
  validateAcmeEmail,
  validatePem,
} from "./tls";

const CERT = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n";
const KEY_PKCS8 = "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n";
const KEY_RSA = "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n";
const KEY_EC = "-----BEGIN EC PRIVATE KEY-----\nMHc...\n-----END EC PRIVATE KEY-----\n";
const KEY_ENCRYPTED_PKCS8 = "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIF...\n-----END ENCRYPTED PRIVATE KEY-----\n";
const KEY_ENCRYPTED_LEGACY =
  "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-256-CBC,0102\n\nMIIE...\n-----END RSA PRIVATE KEY-----\n";

describe("validatePem", () => {
  it("accepts a PEM certificate and every unencrypted key type", () => {
    expect(validatePem("cert", CERT)).toBeNull();
    expect(validatePem("chain", `${CERT}${CERT}`)).toBeNull();
    expect(validatePem("key", KEY_PKCS8)).toBeNull();
    expect(validatePem("key", KEY_RSA)).toBeNull();
    expect(validatePem("key", KEY_EC)).toBeNull();
  });

  it("treats an empty part as not-yet-filled, not as an error", () => {
    expect(validatePem("cert", "")).toBeNull();
    expect(validatePem("key", "   \n")).toBeNull();
    expect(validatePem("chain", "")).toBeNull();
  });

  it("flags a non-PEM paste and a swapped certificate/key", () => {
    expect(validatePem("cert", "not a pem")).toBe("notPemCert");
    expect(validatePem("cert", KEY_PKCS8)).toBe("notPemCert");
    expect(validatePem("key", CERT)).toBe("notPemKey");
    expect(validatePem("chain", KEY_PKCS8)).toBe("notPemCert");
  });

  it("flags encrypted keys like tlsmgr (ENCRYPTED type or Proc-Type header)", () => {
    expect(isEncryptedPrivateKeyPem(KEY_ENCRYPTED_PKCS8)).toBe(true);
    expect(isEncryptedPrivateKeyPem(KEY_ENCRYPTED_LEGACY)).toBe(true);
    expect(isEncryptedPrivateKeyPem(KEY_RSA)).toBe(false);
    expect(validatePem("key", KEY_ENCRYPTED_PKCS8)).toBe("keyEncrypted");
    expect(validatePem("key", KEY_ENCRYPTED_LEGACY)).toBe("keyEncrypted");
  });

  it("flags a part over the 64 KiB server cap", () => {
    const big = `${CERT}${"A".repeat(MAX_PEM_BYTES)}`;
    expect(validatePem("cert", big)).toBe("tooLarge");
  });
});

describe("importReady", () => {
  it("needs the leaf and the key, tolerates an empty chain", () => {
    expect(importReady(CERT, KEY_PKCS8, "")).toBe(true);
    expect(importReady(CERT, KEY_PKCS8, CERT)).toBe(true);
    expect(importReady("", KEY_PKCS8, "")).toBe(false);
    expect(importReady(CERT, "", "")).toBe(false);
  });

  it("refuses when any filled part fails its sniff", () => {
    expect(importReady(CERT, KEY_ENCRYPTED_PKCS8, "")).toBe(false);
    expect(importReady(CERT, KEY_PKCS8, "garbage")).toBe(false);
    expect(importReady(KEY_PKCS8, CERT, "")).toBe(false);
  });
});

describe("validateAcmeDomain", () => {
  it("accepts fully-qualified hostnames after normalization", () => {
    expect(validateAcmeDomain("castor.example.com")).toBeNull();
    expect(validateAcmeDomain("  Castor.Example.COM. ")).toBeNull();
    expect(normalizeDomain("  Castor.Example.COM. ")).toBe("castor.example.com");
    expect(validateAcmeDomain("a-b.c1.example")).toBeNull();
  });

  it("refuses what tlsmgr refuses: wildcard, IP, bare label, bad labels", () => {
    expect(validateAcmeDomain("*.example.com")).toBe("wildcard");
    expect(validateAcmeDomain("192.0.2.10")).toBe("ip");
    expect(validateAcmeDomain("2001:db8::1")).toBe("ip");
    expect(validateAcmeDomain("localhost")).toBe("notFqdn");
    expect(validateAcmeDomain("")).toBe("invalid");
    expect(validateAcmeDomain("-bad.example.com")).toBe("invalid");
    expect(validateAcmeDomain("bad_label.example.com")).toBe("invalid");
    expect(validateAcmeDomain("has space.example.com")).toBe("invalid");
    expect(validateAcmeDomain(`${"a".repeat(64)}.example.com`)).toBe("invalid");
  });
});

describe("validateAcmeEmail", () => {
  it("allows no contact and a plausible address, refuses the rest", () => {
    expect(validateAcmeEmail("")).toBe(true);
    expect(validateAcmeEmail("ops@example.com")).toBe(true);
    expect(validateAcmeEmail("nope")).toBe(false);
    expect(validateAcmeEmail("@example.com")).toBe(false);
    expect(validateAcmeEmail("ops@")).toBe(false);
    expect(validateAcmeEmail("o ps@example.com")).toBe(false);
  });
});

describe("presentation helpers", () => {
  it("builds the https URL from the listener port and the page hostname", () => {
    expect(listenPort(":8443")).toBe("8443");
    expect(listenPort("0.0.0.0:8443")).toBe("8443");
    expect(listenPort("[::]:8443")).toBe("8443");
    expect(listenPort("")).toBe("");
    expect(httpsUrl(":8443", "castor.local")).toBe("https://castor.local:8443");
    expect(httpsUrl("[::]:8443", "[::1]")).toBe("https://[::1]:8443");
    expect(httpsUrl(":443", "castor.example.com")).toBe("https://castor.example.com");
    expect(httpsUrl("", "castor.example.com")).toBe("https://castor.example.com");
  });

  it("truncates a colon-separated fingerprint and leaves a short one alone", () => {
    const fp = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, "0").toUpperCase()).join(":");
    expect(shortFingerprint(fp)).toBe("00:07:0E:15:1C:23:2A:31…");
    expect(shortFingerprint("AB:CD")).toBe("AB:CD");
  });

  it("grades expiry: danger past notAfter, warn under 30 days, ok otherwise", () => {
    const now = 1_700_000_000;
    expect(expiryTone({ daysLeft: 0, notAfter: now - 1 }, now)).toBe("danger");
    expect(expiryTone({ daysLeft: 12, notAfter: now + 12 * 86400 }, now)).toBe("warn");
    expect(expiryTone({ daysLeft: 29, notAfter: now + 29 * 86400 }, now)).toBe("warn");
    expect(expiryTone({ daysLeft: 30, notAfter: now + 30 * 86400 }, now)).toBe("ok");
    expect(expiryTone({ daysLeft: 300, notAfter: now + 300 * 86400 }, now)).toBe("ok");
  });

  it("trusts the server's expired verdict over the local clock", () => {
    const now = 1_700_000_000;
    // Server says expired although the browser clock still sees days left.
    expect(expiryTone({ daysLeft: 5, notAfter: now + 5 * 86400, expired: true }, now)).toBe("danger");
    // An explicit false does not override a locally-observed expiry.
    expect(expiryTone({ daysLeft: 0, notAfter: now - 1, expired: false }, now)).toBe("danger");
    expect(expiryTone({ daysLeft: 300, notAfter: now + 300 * 86400, expired: false }, now)).toBe("ok");
  });

  it("compares domain lists in order", () => {
    expect(sameDomains(["a.example", "b.example"], ["a.example", "b.example"])).toBe(true);
    expect(sameDomains(["a.example"], ["a.example", "b.example"])).toBe(false);
    expect(sameDomains(["b.example", "a.example"], ["a.example", "b.example"])).toBe(false);
  });
});
