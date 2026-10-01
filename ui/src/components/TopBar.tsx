// Castor by IT Leonard
// ui/src/components/TopBar.tsx
//
// Top bar: breadcrumb-ish page title, host switcher, degraded indicator, live
// WebSocket status, and the user menu (profile / logout).

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useHosts } from "../lib/hooks";
import { useHostStore } from "../lib/hostStore";
import { useThemeStore, type ThemePreference } from "../lib/themeStore";
import { useT, useLang, setLang, type Lang } from "../i18n";
import { navDict } from "../i18n/locales/nav";
import { wsClient } from "../lib/ws";
import { toast, toastError } from "../lib/toast";
import { StatusDot } from "./StatusDot";
import { usePaletteStore } from "./CommandPalette";
import {
  IconChevronDown,
  IconHosts,
  IconProfile,
  IconLogout,
  IconAlert,
  IconCheck,
  IconSearch,
  IconSun,
  IconMoon,
  IconMonitor,
} from "./icons";

// Routes that have a translated title in navDict under the `title.<path>` key.
const TITLED_PATHS = new Set([
  "/",
  "/hosts",
  "/workloads",
  "/images",
  "/networks",
  "/volumes",
  "/swarm",
  "/k8s",
  "/audit",
  "/users",
  "/roles",
  "/settings",
  "/profile",
]);

// titleKeyFor maps a pathname to a navDict key (translated at render time). The
// nested workload-detail route and any unknown path fall back to dedicated keys.
function titleKeyFor(pathname: string): string {
  if (pathname.startsWith("/workloads/")) return "title.workloadDetail";
  return TITLED_PATHS.has(pathname) ? `title.${pathname}` : "title.fallback";
}

// Theme menu item cycles Light -> Dark -> System.
const THEME_CYCLE: Record<ThemePreference, ThemePreference> = {
  light: "dark",
  dark: "system",
  system: "light",
};
// navDict key for each theme preference's display name.
const THEME_LABEL_KEY: Record<ThemePreference, string> = {
  light: "theme.light",
  dark: "theme.dark",
  system: "theme.system",
};

export interface TopBarProps {
  /** Whether the mobile navigation drawer is open (drives aria-expanded). */
  sidebarOpen?: boolean;
  /** Toggles the mobile navigation drawer (hamburger, <640px only). */
  onToggleSidebar?: () => void;
}

// Inline hamburger glyph — kept local to the TopBar so the shared icon set is
// untouched. Matches the icons.tsx stroke conventions (24x24, currentColor).
function HamburgerGlyph() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

export function TopBar({ sidebarOpen = false, onToggleSidebar }: TopBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, clear } = useAuth();
  const { data: hosts } = useHosts();
  const { selectedHostId, setSelectedHost } = useHostStore();
  const { theme, setTheme } = useThemeStore();
  const lang = useLang();
  const t = useT(navDict);
  const openPalette = usePaletteStore((s) => s.openPalette);

  const [hostMenu, setHostMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [wsOpen, setWsOpen] = useState(wsClient.isOpen());
  const hostRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => wsClient.onStateChange(setWsOpen), []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) setHostMenu(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const currentHost = (hosts ?? []).find((h) => h.id === selectedHostId);
  const anyDegraded = (hosts ?? []).some((h) => h.degraded || h.status !== "connected");

  const logout = async () => {
    try {
      await api.logout();
    } catch (err) {
      toastError("Logout", err);
    } finally {
      clear();
      toast.info(t("menu.signedOut"));
      navigate("/login", { replace: true });
    }
  };

  const initials = (user?.username ?? "?").slice(0, 2).toUpperCase();

  return (
    <header className="topbar">
      {/* Hamburger: opens the navigation drawer on phones (<640px). Hidden on
          wider viewports where the sidebar/rail is always present. */}
      <button
        className="topbar-hamburger"
        onClick={onToggleSidebar}
        aria-label={t("topbar.toggleNav")}
        aria-expanded={sidebarOpen}
        aria-controls="app-sidebar"
      >
        <HamburgerGlyph />
      </button>

      <div className="crumbs">
        <span className="muted">Castor</span>
        <span className="sep">/</span>
        <span className="current truncate">{t(titleKeyFor(location.pathname))}</span>
      </div>

      {/* Command palette trigger — also opens with Cmd/Ctrl-K. */}
      <button className="cmdk-trigger" onClick={openPalette} aria-label={t("topbar.openPalette")}>
        <IconSearch size={15} />
        <span className="cmdk-trigger-text">{t("topbar.search")}</span>
        <kbd className="cmdk-trigger-kbd">⌘K</kbd>
      </button>

      <span className="spacer" />

      {anyDegraded ? (
        <span className="degraded-pill" title={t("topbar.degradedTitle")}>
          <IconAlert size={13} />
          {t("topbar.degraded")}
        </span>
      ) : null}

      <span className="ws-pill" title={wsOpen ? t("topbar.liveOn") : t("topbar.liveOff")}>
        <StatusDot color={wsOpen ? "var(--success)" : "var(--state-stopped)"} pulse={wsOpen} />
        {t("topbar.live")}
      </span>

      {/* host switcher */}
      <div className="host-switcher" ref={hostRef}>
        <button className="host-btn" onClick={() => setHostMenu((v) => !v)} aria-haspopup="menu">
          <IconHosts size={16} />
          <span className="truncate host-label">
            {currentHost?.name ?? selectedHostId}
          </span>
          {currentHost ? <StatusDot hostStatus={currentHost.status} /> : null}
          <IconChevronDown size={14} />
        </button>
        {hostMenu ? (
          <div className="menu-pop" role="menu">
            <div className="menu-header text-xs muted">{t("menu.hosts")}</div>
            {(hosts ?? []).map((h) => (
              <button
                key={h.id}
                className={`menu-item${h.id === selectedHostId ? " active" : ""}`}
                onClick={() => {
                  setSelectedHost(h.id);
                  setHostMenu(false);
                }}
                role="menuitemradio"
                aria-checked={h.id === selectedHostId}
              >
                <StatusDot hostStatus={h.status} />
                <span className="truncate" style={{ flex: 1 }}>
                  {h.name}
                </span>
                {h.id === selectedHostId ? <IconCheck size={14} /> : null}
              </button>
            ))}
            {(hosts ?? []).length === 0 ? <div className="menu-item muted">{t("menu.noHosts")}</div> : null}
          </div>
        ) : null}
      </div>

      {/* user menu */}
      <div className="host-switcher" ref={userRef}>
        <button className="user-btn" onClick={() => setUserMenu((v) => !v)} aria-haspopup="menu">
          <span className="avatar">{initials}</span>
          <span className="truncate" style={{ maxWidth: 120 }}>
            {user?.username}
          </span>
          <IconChevronDown size={14} />
        </button>
        {userMenu ? (
          <div className="menu-pop" role="menu">
            <div className="menu-header">
              <div className="text-sm" style={{ fontWeight: 600 }}>
                {user?.username}
              </div>
              {user?.email ? <div className="text-xs muted truncate">{user.email}</div> : null}
            </div>
            <div className="menu-divider" />
            <button
              className="menu-item"
              onClick={() => {
                setUserMenu(false);
                navigate("/profile");
              }}
            >
              <IconProfile size={16} />
              {t("menu.profile")}
            </button>
            <button
              className="menu-item"
              onClick={() => setTheme(THEME_CYCLE[theme])}
              title={t("menu.themeTooltip")}
              aria-label={t("menu.themeAria", { theme: t(THEME_LABEL_KEY[theme]) })}
            >
              {theme === "light" ? (
                <IconSun size={16} />
              ) : theme === "dark" ? (
                <IconMoon size={16} />
              ) : (
                <IconMonitor size={16} />
              )}
              {t("menu.theme")}: {t(THEME_LABEL_KEY[theme])}
            </button>
            {/* Language selector — mirrors the theme toggle: EN / FR with the
                active language marked. Persists via the global langStore. Styled
                inline (reusing menu-item hover semantics) to keep the change
                self-contained to this component. */}
            <div className="menu-header text-xs muted">{t("menu.language")}</div>
            {(["en", "fr"] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                className={`menu-item${lang === l ? " active" : ""}`}
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
              >
                <span style={{ width: 16, display: "inline-flex", justifyContent: "center" }}>
                  {lang === l ? <IconCheck size={14} /> : null}
                </span>
                {l === "fr" ? "Français (FR)" : "English (EN)"}
              </button>
            ))}
            <div className="menu-divider" />
            <button className="menu-item" onClick={logout} style={{ color: "var(--danger)" }}>
              <IconLogout size={16} />
              {t("menu.signOut")}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
