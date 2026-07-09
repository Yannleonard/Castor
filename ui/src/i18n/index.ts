// ui/src/i18n/index.ts
//
// Public entrypoint for Castor's i18n. Views and components should import from
// here rather than reaching into ./core or ../lib/langStore directly.
//
//   import { useT, defineDict, useLang, setLang } from "../i18n";
//
// There is intentionally NO dictionary registry here — each view imports its own
// locale file (ui/src/i18n/locales/*) and passes it to `useT`. The only shared
// state is the language store re-exported below.

export { useT, defineDict, translate, t } from "./core";
export type { Dict, Vars } from "./core";
export { useLang, setLang, getLang } from "../lib/langStore";
export type { Lang } from "../lib/langStore";
