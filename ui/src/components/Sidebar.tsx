// ui/src/components/Sidebar.tsx
//
// Left navigation. Mascot logo at top, nav grouped into Overview / Compute /
// Storage / Orchestrators / Admin (the honest 3-orchestrator layout). Items
// respect the user's permissions: links hide when the user lacks every listed
// permission.

import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { canAny } from "../lib/rbac";
import {
  IconDashboard,
  IconHosts,
  IconWorkloads,
  IconMarketplace,
  IconStacks,
  IconImages,
  IconNetworks,
  IconVolumes,
  IconDownload,
  IconSwarm,
  IconKube,
  IconAudit,
  IconUsers,
  IconRoles,
  IconShield,
  IconSettings,
} from "./icons";
import { BrandLock } from "./BrandLock";

interface NavEntry {
  to: string;
  label: string;
  icon: ReactNode;
  /** show only if the user has any of these perms; empty = always */
  perms?: string[];
}

interface NavGroup {
  label: string;
  items: NavEntry[];
}

const GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: <IconDashboard size={18} /> },
      { to: "/hosts", label: "Hosts", icon: <IconHosts size={18} /> },
    ],
  },
  {
    label: "Compute",
    items: [
      { to: "/workloads", label: "Workloads", icon: <IconWorkloads size={18} /> },
      { to: "/marketplace", label: "Marketplace", icon: <IconMarketplace size={18} /> },
      { to: "/stacks", label: "Stacks", icon: <IconStacks size={18} />, perms: ["docker.container.read"] },
      { to: "/images", label: "Images", icon: <IconImages size={18} />, perms: ["docker.image.read"] },
      { to: "/networks", label: "Networks", icon: <IconNetworks size={18} />, perms: ["docker.network.read"] },
      { to: "/volumes", label: "Volumes", icon: <IconVolumes size={18} />, perms: ["docker.volume.read"] },
    ],
  },
  {
    label: "Storage",
    items: [
      { to: "/backups", label: "Backups", icon: <IconDownload size={18} />, perms: ["docker.volume.read"] },
    ],
  },
  {
    label: "Orchestrators",
    items: [
      { to: "/swarm", label: "Swarm", icon: <IconSwarm size={18} />, perms: ["swarm.service.read"] },
      { to: "/k8s", label: "Kubernetes", icon: <IconKube size={18} />, perms: ["k8s.pod.read"] },
      { to: "/k8s-storage", label: "Storage", icon: <IconVolumes size={18} />, perms: ["k8s.storage.read"] },
      {
        to: "/k8s-cluster",
        label: "Cluster",
        icon: <IconNetworks size={18} />,
        perms: ["k8s.namespace.read", "k8s.service.read", "k8s.hpa.read", "k8s.config.read", "k8s.ingress.read", "k8s.metrics.read"],
      },
      { to: "/helm", label: "Helm", icon: <IconStacks size={18} />, perms: ["helm.release.read"] },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/audit", label: "Audit", icon: <IconAudit size={18} />, perms: ["audit.read"] },
      {
        to: "/users",
        label: "Users",
        icon: <IconUsers size={18} />,
        perms: ["rbac.user.read", "rbac.user.create"],
      },
      {
        to: "/roles",
        label: "Roles",
        icon: <IconRoles size={18} />,
        perms: ["rbac.role.read", "rbac.role.create"],
      },
      {
        to: "/registries",
        label: "Registries",
        icon: <IconImages size={18} />,
        perms: ["marketplace.registry.read", "marketplace.registry.write"],
      },
      {
        to: "/catalogs",
        label: "Catalogs",
        icon: <IconNetworks size={18} />,
        perms: ["marketplace.catalog.read", "marketplace.catalog.write"],
      },
      {
        to: "/authentication",
        label: "Authentication",
        icon: <IconShield size={18} />,
        perms: ["auth.provider.read", "auth.provider.write"],
      },
      { to: "/settings", label: "Settings", icon: <IconSettings size={18} />, perms: ["settings.read"] },
    ],
  },
];

export function Sidebar() {
  const { permissions } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        {/* Logo art already includes the Castor wordmark + tagline. Use the
            natural aspect ratio (sized by .sidebar-brand img in shell.css) so it
            is shown in full, never clipped. */}
        <img src="/brand/castor-logo.jpg" alt="Castor" />
      </div>

      <nav className="sidebar-nav">
        {GROUPS.map((group) => {
          const items = group.items.filter((it) => !it.perms || canAny(permissions, it.perms));
          if (items.length === 0) return null;
          return (
            <div key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              <div className="nav-group">
                {items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    end={it.to === "/"}
                    className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
                  >
                    <span className="nav-icon">{it.icon}</span>
                    <span className="nav-label">{it.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <BrandLock />
    </aside>
  );
}
