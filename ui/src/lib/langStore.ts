// Castor by IT Leonard
// ui/src/lib/langStore.ts
// Language preference store (same pattern as themeStore). The stored preference
// is "en" | "fr"; it drives which side of every view's { en, fr } dictionary is
// rendered (see ui/src/i18n/). The default is derived once from the browser:
// the first entry of navigator.languages that starts with "fr" selects French,
// otherwise English. The preference persists in localStorage under "castor.lang"
// and is applied to <html lang="…"> at module load — before the first React
// render — for accessibility/SEO and to keep the document attribute in sync.
//
// Alignment note: the Lang type is the same union as ui/src/help/types.ts. It is
// re-exported here so i18n consumers have a single import, and the two stay
// structurally identical ("en" | "fr").
import { create } from "zustand";
import type { Lang as HelpLang } from "../help/types";

/** UI language. Structurally identical to help/types.ts `Lang`. */
export type Lang = HelpLang; // "en" | "fr"

const STORAGE_KEY = "castor.lang";

function detectDefault(): Lang {
  // First browser-preferred language that starts with "fr" wins; else English.
  try {
    const langs =
      typeof navigator !== "undefined"
        ? navigator.languages ?? (navigator.language ? [navigator.language] : [])
        : [];
    for (const l of langs) {
      if (typeof l === "string" && l.toLowerCase().startsWith("fr")) return "fr";
    }
  } catch {
    // navigator unavailable (non-browser env) — fall through to default.
  }
  return "en";
}

function readStored(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "fr") return v;
  } catch {
    // Storage unavailable (private mode, tests) — fall through to detection.
  }
  return detectDefault();
}

function applyLang(lang: Lang): void {
  // Reflect the active language onto <html lang="…"> for a11y and SEO.
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("lang", lang);
  }
}

interface LangState {
  /** Active UI language. */
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const initial = readStored();

export const useLangStore = create<LangState>((set) => ({
  lang: initial,
  setLang: (lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Persisting is best-effort; the in-memory state still updates.
    }
    applyLang(lang);
    set({ lang });
  },
}));

/** Active language ("en" | "fr"), reactive — components re-render on change. */
export function useLang(): Lang {
  return useLangStore((s) => s.lang);
}

/** Set the active language. Persists, updates <html lang>, notifies subscribers. */
export function setLang(lang: Lang): void {
  useLangStore.getState().setLang(lang);
}

/**
 * Read the current language imperatively (outside React render), e.g. from an
 * event handler or a hook that builds a toast message. Prefer `useLang()` in
 * components so they re-render when the language changes.
 */
export function getLang(): Lang {
  return useLangStore.getState().lang;
}

// Module-level init: main.tsx imports App synchronously, which (transitively)
// imports this module, so <html lang> is set before ReactDOM renders anything.
applyLang(initial);
