// ui/src/lib/themeStore.ts
// Theme preference store (same pattern as hostStore). The stored preference is
// "light" | "dark" | "system"; the *resolved* theme is what actually gets
// applied by toggling the `dark` class on <html> (tokens.css defines the
// html.dark overrides). "system" follows prefers-color-scheme with a live
// listener. The preference persists in localStorage under "castor.theme" and
// is applied at module load — before the first React render — to avoid a
// light-to-dark flash.
import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "castor.theme";

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // Storage unavailable (private mode, tests) — fall through to default.
  }
  return "system";
}

function systemPrefersDark(): boolean {
  // matchMedia is absent in some test environments (jsdom); default to light.
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

interface ThemeState {
  /** Stored user preference (may be "system"). */
  theme: ThemePreference;
  /** Effective theme currently applied to <html>. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const initial = readStored();

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initial,
  resolvedTheme: resolveTheme(initial),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Persisting is best-effort; the in-memory state still updates.
    }
    const resolved = resolveTheme(theme);
    applyTheme(resolved);
    set({ theme, resolvedTheme: resolved });
  },
}));

/** Effective theme ("light" | "dark"), reactive to preference and OS changes. */
export function useResolvedTheme(): ResolvedTheme {
  return useThemeStore((s) => s.resolvedTheme);
}

// Follow OS scheme changes while the preference is "system".
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (useThemeStore.getState().theme !== "system") return;
    const resolved = resolveTheme("system");
    applyTheme(resolved);
    useThemeStore.setState({ resolvedTheme: resolved });
  });
}

// Module-level init: main.tsx imports App synchronously, which imports this
// module, so the class lands on <html> before ReactDOM renders anything.
applyTheme(resolveTheme(initial));
