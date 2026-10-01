// Castor by IT Leonard
// ui/src/components/CommandPalette.tsx
//
// Command palette (Cmd/Ctrl-K). A portalised overlay with a search box and a
// filtered, keyboard-navigable list of commands. Two command sources:
//   - Navigate: one entry per permission-visible NavEntry in Sidebar's GROUPS
//     (the single source of navigation truth), action = navigate(to).
//   - Actions:  quick actions (toggle theme, profile, sign out, open help).
//
// Open state lives in a tiny zustand store (same shape as themeStore) so both
// the global Cmd/Ctrl-K handler in AppShell and the TopBar button can drive it.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { useNavigate } from "react-router-dom";
import { GROUPS } from "./Sidebar";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { canAny } from "../lib/rbac";
import { useThemeStore, type ThemePreference } from "../lib/themeStore";
import { toast, toastError } from "../lib/toast";
import { HelpPanel } from "./HelpPanel";
import {
  IconSearch,
  IconProfile,
  IconLogout,
  IconHelp,
  IconSun,
  IconMoon,
  IconMonitor,
} from "./icons";
import "../styles/command-palette.css";

/* ------------------------------------------------------------------ */
/* Open-state store (clone of the themeStore pattern)                  */
/* ------------------------------------------------------------------ */

interface PaletteState {
  open: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  openPalette: () => set({ open: true }),
  closePalette: () => set({ open: false }),
  togglePalette: () => set((s) => ({ open: !s.open })),
}));

/* ------------------------------------------------------------------ */
/* Command model                                                       */
/* ------------------------------------------------------------------ */

type CommandSection = "Navigate" | "Actions";

interface Command {
  id: string;
  label: string;
  icon: ReactNode;
  section: CommandSection;
  /** Extra text folded into fuzzy matching (e.g. a route path). */
  keywords?: string;
  run: () => void;
}

// Theme menu item cycles Light -> Dark -> System (mirrors TopBar).
const THEME_CYCLE: Record<ThemePreference, ThemePreference> = {
  light: "dark",
  dark: "system",
  system: "light",
};

/* ------------------------------------------------------------------ */
/* Fuzzy match: case-insensitive subsequence, empty query matches all. */
/* ------------------------------------------------------------------ */

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return i === q.length;
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

export function CommandPalette() {
  const open = usePaletteStore((s) => s.open);
  const closePalette = usePaletteStore((s) => s.closePalette);
  const navigate = useNavigate();
  const { permissions, clear } = useAuth();
  const { theme, setTheme } = useThemeStore();

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const signOut = async () => {
    try {
      await api.logout();
    } catch (err) {
      toastError("Logout", err);
    } finally {
      clear();
      toast.info("Signed out");
      navigate("/login", { replace: true });
    }
  };

  // Full command set, rebuilt when permissions/theme change. Navigation entries
  // reuse Sidebar's GROUPS filtered by the same canAny() permission check.
  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = GROUPS.flatMap((group) =>
      group.items
        .filter((it) => !it.perms || canAny(permissions, it.perms))
        .map((it) => ({
          id: `nav:${it.to}`,
          label: it.label,
          icon: it.icon,
          section: "Navigate" as const,
          keywords: `${group.label} ${it.to}`,
          run: () => navigate(it.to),
        })),
    );

    const themeIcon =
      theme === "light" ? <IconSun size={18} /> : theme === "dark" ? <IconMoon size={18} /> : <IconMonitor size={18} />;

    const actions: Command[] = [
      {
        id: "action:theme",
        label: "Toggle theme",
        icon: themeIcon,
        section: "Actions",
        keywords: "dark light system appearance",
        run: () => setTheme(THEME_CYCLE[theme]),
      },
      {
        id: "action:profile",
        label: "Go to Profile",
        icon: <IconProfile size={18} />,
        section: "Actions",
        keywords: "account security /profile",
        run: () => navigate("/profile"),
      },
      {
        id: "action:help",
        label: "Open help",
        icon: <IconHelp size={18} />,
        section: "Actions",
        keywords: "docs guide dashboard",
        run: () => setHelpOpen(true),
      },
      {
        id: "action:signout",
        label: "Sign out",
        icon: <IconLogout size={18} />,
        section: "Actions",
        keywords: "logout leave",
        run: signOut,
      },
    ];

    return [...nav, ...actions];
    // signOut is stable enough for this memo; it only reads store setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions, theme, navigate, setTheme]);

  const filtered = useMemo(
    () => commands.filter((c) => fuzzyMatch(query, `${c.label} ${c.keywords ?? ""}`)),
    [commands, query],
  );

  // Reset transient state whenever the palette (re)opens, and focus the input.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // Keep the active index in range as the filtered list shrinks/grows.
  useEffect(() => {
    setActive((a) => (filtered.length === 0 ? 0 : Math.min(a, filtered.length - 1)));
  }, [filtered.length]);

  // Escape closes; body scroll lock while open (mirrors Modal).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePalette();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, closePalette]);

  // Scroll the active row into view as the selection moves.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, filtered]);

  const runAt = (index: number) => {
    const cmd = filtered[index];
    if (!cmd) return;
    closePalette();
    cmd.run();
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (filtered.length === 0 ? 0 : (a + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (filtered.length === 0 ? 0 : (a - 1 + filtered.length) % filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(active);
    }
  };

  return (
    <>
      {open
        ? createPortal(
            <div
              className="cmdk-scrim"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) closePalette();
              }}
            >
              <div className="cmdk-panel" role="dialog" aria-modal="true" aria-label="Command palette">
                <div className="cmdk-search">
                  <IconSearch size={18} />
                  <input
                    ref={inputRef}
                    className="cmdk-input"
                    type="text"
                    placeholder="Search commands…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onInputKeyDown}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="cmdk-list"
                    aria-autocomplete="list"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>

                <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
                  {filtered.length === 0 ? (
                    <div className="cmdk-empty">No commands found</div>
                  ) : (
                    renderSections(filtered, active, runAt, setActive)
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* Reuse the data-driven help panel; "dashboard" is the general overview card. */}
      <HelpPanel topic="dashboard" open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Section rendering (discreet headers per section, in list order)     */
/* ------------------------------------------------------------------ */

function renderSections(
  filtered: Command[],
  active: number,
  runAt: (index: number) => void,
  setActive: (index: number) => void,
): ReactNode {
  const order: CommandSection[] = ["Navigate", "Actions"];
  return order.map((section) => {
    const rows = filtered
      .map((cmd, index) => ({ cmd, index }))
      .filter(({ cmd }) => cmd.section === section);
    if (rows.length === 0) return null;
    return (
      <div className="cmdk-group" key={section}>
        <div className="cmdk-group-label">{section}</div>
        {rows.map(({ cmd, index }) => (
          <button
            key={cmd.id}
            type="button"
            data-index={index}
            className={`cmdk-item${index === active ? " active" : ""}`}
            role="option"
            aria-selected={index === active}
            onMouseMove={() => setActive(index)}
            onClick={() => runAt(index)}
          >
            <span className="cmdk-item-icon">{cmd.icon}</span>
            <span className="cmdk-item-label">{cmd.label}</span>
          </button>
        ))}
      </div>
    );
  });
}
