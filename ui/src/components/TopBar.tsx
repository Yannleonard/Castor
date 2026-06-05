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
import { wsClient } from "../lib/ws";
import { toast, toastError } from "../lib/toast";
import { StatusDot } from "./StatusDot";
import {
  IconChevronDown,
  IconHosts,
  IconProfile,
  IconLogout,
  IconAlert,
  IconCheck,
} from "./icons";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/hosts": "Hosts",
  "/workloads": "Workloads",
  "/images": "Images",
  "/networks": "Networks",
  "/volumes": "Volumes",
  "/swarm": "Swarm",
  "/k8s": "Kubernetes",
  "/audit": "Audit log",
  "/users": "Users",
  "/roles": "Roles",
  "/settings": "Settings",
  "/profile": "Profile",
};

function titleFor(pathname: string): string {
  if (pathname.startsWith("/workloads/")) return "Workload detail";
  return TITLES[pathname] ?? "Castor";
}

export function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, clear } = useAuth();
  const { data: hosts } = useHosts();
  const { selectedHostId, setSelectedHost } = useHostStore();

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
      toast.info("Signed out");
      navigate("/login", { replace: true });
    }
  };

  const initials = (user?.username ?? "?").slice(0, 2).toUpperCase();

  return (
    <header className="topbar">
      <div className="crumbs">
        <span className="muted">Castor</span>
        <span className="sep">/</span>
        <span className="current truncate">{titleFor(location.pathname)}</span>
      </div>

      <span className="spacer" />

      {anyDegraded ? (
        <span className="degraded-pill" title="One or more hosts/providers are degraded">
          <IconAlert size={13} />
          Degraded
        </span>
      ) : null}

      <span className="ws-pill" title={wsOpen ? "Live updates connected" : "Live updates offline"}>
        <StatusDot color={wsOpen ? "var(--success)" : "var(--state-stopped)"} pulse={wsOpen} />
        Live
      </span>

      {/* host switcher */}
      <div className="host-switcher" ref={hostRef}>
        <button className="host-btn" onClick={() => setHostMenu((v) => !v)} aria-haspopup="menu">
          <IconHosts size={16} />
          <span className="truncate" style={{ maxWidth: 160 }}>
            {currentHost?.name ?? selectedHostId}
          </span>
          {currentHost ? <StatusDot hostStatus={currentHost.status} /> : null}
          <IconChevronDown size={14} />
        </button>
        {hostMenu ? (
          <div className="menu-pop" role="menu">
            <div className="menu-header text-xs muted">Hosts</div>
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
            {(hosts ?? []).length === 0 ? <div className="menu-item muted">No hosts</div> : null}
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
              Profile & security
            </button>
            <button className="menu-item" onClick={logout} style={{ color: "var(--danger)" }}>
              <IconLogout size={16} />
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
