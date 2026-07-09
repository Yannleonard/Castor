// ui/src/components/AppShell.tsx
//
// The authenticated layout: sidebar + topbar + routed <Outlet>. Also hosts the
// fleet-wide events WS subscription that invalidates React Query caches so lists
// stay reactive within ~1s (ADR-001 events channel).

import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { CommandPalette, usePaletteStore } from "./CommandPalette";
import { subscribeEvents } from "../lib/ws";
import { useSelectedHost } from "../lib/hostStore";

export function AppShell() {
  const queryClient = useQueryClient();
  const hostId = useSelectedHost();
  const location = useLocation();
  const togglePalette = usePaletteStore((s) => s.togglePalette);

  // Mobile navigation drawer (<640px). Hidden above that breakpoint by CSS, so
  // the state is inert on desktop. TopBar's hamburger toggles it; the scrim and
  // navigation both close it.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Close the drawer whenever the route changes (navigating from within it).
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Escape closes the drawer (same cleanup pattern as the palette handler).
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Global Cmd/Ctrl-K opens (toggles) the command palette. Same cleanup pattern
  // as Modal's Escape handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette]);

  // Fleet-wide events subscription → invalidate workload/resource caches.
  useEffect(() => {
    const sub = subscribeEvents(hostId, {
      onData: (payload) => {
        // Targeted invalidation by event kind keeps refetches cheap.
        switch (payload.kind) {
          case "container":
            queryClient.invalidateQueries({ queryKey: ["workloads", hostId] });
            queryClient.invalidateQueries({ queryKey: ["host", hostId] });
            break;
          case "network":
            queryClient.invalidateQueries({ queryKey: ["networks", hostId] });
            break;
          case "volume":
            queryClient.invalidateQueries({ queryKey: ["volumes", hostId] });
            break;
          default:
            break;
        }
      },
    });
    return () => sub.close();
  }, [hostId, queryClient]);

  return (
    <div className="app-shell">
      <Sidebar open={drawerOpen} onNavigate={closeDrawer} />
      {/* Scrim behind the open drawer — only present on phones (CSS-gated) and
          only while open; a tap closes the drawer. */}
      {drawerOpen ? <div className="sidebar-scrim" onClick={closeDrawer} aria-hidden="true" /> : null}
      <div className="app-main">
        <TopBar sidebarOpen={drawerOpen} onToggleSidebar={() => setDrawerOpen((v) => !v)} />
        <main className="app-content">
          <div className="content-inner">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
