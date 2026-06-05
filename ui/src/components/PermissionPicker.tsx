// ui/src/components/PermissionPicker.tsx
//
// Groups the flat permission catalog by domain (docker / swarm / k8s / rbac /
// audit / settings) into collapsible sections with checkboxes. The "*" superuser
// permission is handled specially (selecting it disables the rest visually).

import { useMemo } from "react";
import { IconCheck } from "./icons";

interface Props {
  catalog: string[];
  selected: Set<string>;
  onToggle: (perm: string) => void;
  disabled?: boolean;
}

function groupOf(perm: string): string {
  if (perm === "*") return "Superuser";
  const top = perm.split(".")[0] ?? "other";
  switch (top) {
    case "docker":
      return "Docker";
    case "swarm":
      return "Swarm";
    case "k8s":
      return "Kubernetes";
    case "rbac":
      return "RBAC";
    case "audit":
      return "Audit";
    case "settings":
      return "Settings";
    default:
      return "Other";
  }
}

const GROUP_ORDER = ["Superuser", "Docker", "Swarm", "Kubernetes", "RBAC", "Audit", "Settings", "Other"];

export function PermissionPicker({ catalog, selected, onToggle, disabled }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of catalog) {
      const g = groupOf(p);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, perms: map.get(g)!.sort() }));
  }, [catalog]);

  const hasWildcard = selected.has("*");

  return (
    <div className="col" style={{ gap: "var(--sp-4)" }}>
      {groups.map(({ group, perms }) => {
        const isSuper = group === "Superuser";
        const groupDisabled = disabled || (hasWildcard && !isSuper);
        return (
          <div key={group} className="col" style={{ gap: "var(--sp-2)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="text-sm" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
                {group}
              </span>
              {!isSuper && !disabled ? (
                <span className="text-xs muted">
                  {perms.filter((p) => selected.has(p)).length}/{perms.length}
                </span>
              ) : null}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--sp-1)" }}>
              {perms.map((p) => {
                const checked = selected.has(p) || (hasWildcard && !isSuper);
                return (
                  <label
                    key={p}
                    className="checkbox-row"
                    style={{
                      padding: "4px 6px",
                      borderRadius: "var(--radius-sm)",
                      opacity: groupDisabled ? 0.55 : 1,
                      cursor: groupDisabled ? "not-allowed" : "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={groupDisabled}
                      onChange={() => onToggle(p)}
                    />
                    <span className="mono text-xs">{p}</span>
                    {isSuper && checked ? (
                      <span style={{ color: "var(--warm)", marginLeft: "auto" }}>
                        <IconCheck size={12} />
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      {hasWildcard ? (
        <div className="banner info">
          <IconCheck size={14} />
          <span>The <span className="mono">*</span> superuser permission grants everything; individual toggles are implied.</span>
        </div>
      ) : null}
    </div>
  );
}
