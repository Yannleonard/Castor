// Castor by IT Leonard
// ui/src/i18n/core.ts
//
// Minimal, dependency-free i18n primitives for Castor.
//
// DESIGN — no central dictionary registry. The ONLY shared state is the language
// store (ui/src/lib/langStore.ts). Each view/component owns and imports its OWN
// `Dict` (an { en, fr } pair) and passes it to `useT`. This is deliberate: dozens
// of views can be translated independently, each editing only its own locale
// file, with no shared file to conflict on.
//
//   // in a view:
//   import { useT } from "../i18n";
//   import { auditDict } from "../i18n/locales/audit";
//   const t = useT(auditDict);
//   return <h1>{t("header.title")}</h1>;
//
// Resolution order for a key: dict[lang][key] → dict.en[key] → key. A key that
// exists in English but not French therefore falls back to English rather than
// leaking the raw key. Interpolation replaces {name} tokens from `vars`.

import { useLang, getLang } from "../lib/langStore";
import type { Lang } from "../lib/langStore";

/** A translation dictionary: one flat string map per supported language. */
export type Dict = {
  en: Record<string, string>;
  fr: Record<string, string>;
};

/** Values that can be interpolated into a translated string. */
export type Vars = Record<string, string | number>;

/**
 * Typed identity helper for authoring dictionaries. Using it gives every locale
 * file the same shape and lets editors flag a missing `en`/`fr` half.
 */
export function defineDict(d: Dict): Dict {
  return d;
}

// interpolate replaces {token} occurrences with the matching value from `vars`.
// Unmatched tokens are left intact so authoring mistakes are visible, not silent.
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole,
  );
}

/**
 * Pure translation lookup. Resolves `dict[lang][key]`, falling back to the
 * English string, then to the raw key, and interpolates `vars`.
 *
 * Prefer `useT` inside components (it re-renders on language change). Use this
 * directly only in non-render code paths that already have a `lang` in hand.
 */
export function translate(dict: Dict, lang: Lang, key: string, vars?: Vars): string {
  const template = dict[lang]?.[key] ?? dict.en[key] ?? key;
  return interpolate(template, vars);
}

/**
 * Component hook: subscribes to the active language and returns a translator
 * bound to `dict`. The returned `t(key, vars?)` re-renders its component when the
 * language changes because `useLang()` is a live store selector.
 */
export function useT(dict: Dict): (key: string, vars?: Vars) => string {
  const lang = useLang();
  return (key: string, vars?: Vars) => translate(dict, lang, key, vars);
}

/**
 * Non-reactive translator for handlers/hooks running outside React render (e.g.
 * building a toast string). Reads the language imperatively via `getLang()`.
 */
export function t(dict: Dict, key: string, vars?: Vars): string {
  return translate(dict, getLang(), key, vars);
}
