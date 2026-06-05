// ui/src/components/AppShell.tsx
//
// The authenticated layout: sidebar + topbar + routed <Outlet>. Also hosts the
// fleet-wide events WS subscription that invalidates React Query caches so lists
// stay reactive within ~1s (ADR-001 events channel).

import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { subscribeEvents } from "../lib/ws";
import { useSelectedHost } from "../lib/hostStore";

export function AppShell() {
  const queryClient = useQueryClient();
  const hostId = useSelectedHost();

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
      <Sidebar />
      <div className="app-main">
        <TopBar />
        <main className="app-content">
          <div className="content-inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
