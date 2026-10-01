// Castor by IT Leonard
// ui/src/components/AppShell.tsx
//
// The authenticated layout: sidebar + topbar + routed <Outlet>. Also hosts the
// fleet-wide events WS subscription that invalidates React Query caches so lists
// stay reactive within ~1s (ADR-001 events channel).

import { useCallback, useEffect, useRef, useState } from "react";
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
  // Element that held focus before the drawer opened, so we can restore it on close.
  const drawerRestoreFocus = useRef<HTMLElement | null>(null);

  // Close the drawer whenever the route changes (navigating from within it).
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // While the drawer is open: lock body scroll, trap focus inside it, and let
  // Escape close it — mirroring the CommandPalette overlay so the two modal
  // surfaces behave identically. All effects here no-op when closed.
  useEffect(() => {
    if (!drawerOpen) return;

    const drawer = document.getElementById("app-sidebar");
    // Query focusables lazily inside the handler so nav-permission changes or
    // async renders don't leave us trapping against a stale list.
    const focusables = (): HTMLElement[] =>
      drawer
        ? Array.from(
            drawer.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      if (e.key !== "Tab" || !drawer) return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const activeInDrawer = drawer.contains(document.activeElement);
      // Wrap the cycle at both ends, and pull focus in if it escaped the drawer.
      if (e.shiftKey) {
        if (document.activeElement === first || !activeInDrawer) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !activeInDrawer) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);

    // Mark the drawer as a modal dialog for assistive tech while it is open.
    // (Set here rather than on Sidebar so the semantics apply only when the
    // off-canvas drawer is actually presented.)
    if (drawer) {
      drawer.setAttribute("role", "dialog");
      drawer.setAttribute("aria-modal", "true");
      drawer.setAttribute("aria-label", "Navigation menu");
    }

    // Body scroll lock (restored to the prior inline value on cleanup).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the drawer, remembering where it was so we can return it.
    drawerRestoreFocus.current = document.activeElement as HTMLElement | null;
    const raf = window.requestAnimationFrame(() => focusables()[0]?.focus());

    return () => {
      window.removeEventListener("keydown", onKey);
      window.cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      if (drawer) {
        drawer.removeAttribute("role");
        drawer.removeAttribute("aria-modal");
        drawer.removeAttribute("aria-label");
      }
      // Restore focus to the trigger (e.g. the hamburger) on close/unmount.
      drawerRestoreFocus.current?.focus?.();
      drawerRestoreFocus.current = null;
    };
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
