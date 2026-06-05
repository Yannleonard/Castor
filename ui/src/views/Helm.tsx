// ui/src/views/Helm.tsx
//
// Helm management (chart repositories + chart catalog + release lifecycle) for
// the selected host. Three tabs:
//   (1) Repositories — list configured repos, add one (name+url, downloads the
//       index), refresh all indexes, remove.
//   (2) Charts — search the cached repo indexes, browse hit cards, and install a
//       chart (release name, target namespace, version, optional YAML values).
//   (3) Releases — list installed releases with a colored status badge, and per
//       release: upgrade, rollback (pick a revision from history), uninstall,
//       and inspect values / history.
//
// Writes are gated client-side with can() on helm.* permissions (a UX affordance
// only — the backend re-checks). YAML values are parsed to an object via a tiny
// dependency-free parser shared by the install/upgrade modals.

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  qk,
  useHelmRepos,
  useHelmCharts,
  useHelmReleases,
  useHelmReleaseHistory,
  useHelmReleaseValues,
} from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { can } from "../lib/rbac";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { Modal } from "../components/Modal";
import { TextField } from "../components/Field";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { EmptyState } from "../components/EmptyState";
import {
  IconStacks,
  IconRefresh,
  IconPlus,
  IconTrash,
  IconSearch,
  IconRestart,
  IconScale,
  IconInspect,
  IconDownload,
  IconExternal,
} from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { timeAgo, prettyJson } from "../lib/format";
import type {
  HelmChart,
  HelmRelease,
  HelmReleaseRevision,
  HelmReleaseStatus,
} from "../lib/types";

type Tab = "repos" | "charts" | "releases";

/* ============================ YAML values helper ============================ */
//
// Helm values come in as `Record<string, unknown>`. The modals let an operator
// paste a flat/nested YAML document; we parse it with a tiny indent-aware reader
// (objects + scalars + simple lists). Anything we cannot parse surfaces as a
// validation error rather than silently dropping keys.

type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

function coerceScalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  // strip matching surrounding quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// Parse a minimal subset of YAML (mappings, nested mappings, block scalars,
// inline `[a, b]` and `- item` lists). Returns the object or throws on a
// structural problem. Empty input => {}.
function parseYamlValues(input: string): Record<string, unknown> {
  const text = input.replace(/\t/g, "  ");
  const rawLines = text.split(/\r?\n/);
  type Line = { indent: number; content: string };
  const lines: Line[] = [];
  for (const ln of rawLines) {
    // drop full-line comments and blank lines
    const noComment = ln.replace(/\s+#.*$/, "");
    if (!noComment.trim() || noComment.trim().startsWith("#")) continue;
    const indent = noComment.length - noComment.trimStart().length;
    lines.push({ indent, content: noComment.trim() });
  }
  if (lines.length === 0) return {};

  let pos = 0;
  function parseBlock(minIndent: number): YamlValue {
    // List block?
    if (pos < lines.length && lines[pos]!.content.startsWith("- ") && lines[pos]!.indent >= minIndent) {
      const arr: YamlValue[] = [];
      const indent = lines[pos]!.indent;
      while (pos < lines.length && lines[pos]!.indent === indent && lines[pos]!.content.startsWith("- ")) {
        arr.push(coerceScalar(lines[pos]!.content.slice(2)));
        pos++;
      }
      return arr;
    }
    // Mapping block.
    const obj: Record<string, YamlValue> = {};
    if (pos >= lines.length) return obj;
    const indent = lines[pos]!.indent;
    while (pos < lines.length && lines[pos]!.indent === indent) {
      const { content } = lines[pos]!;
      const c = content.indexOf(":");
      if (c < 0) throw new Error(`Expected "key: value" near "${content}"`);
      const key = content.slice(0, c).trim();
      const rest = content.slice(c + 1).trim();
      pos++;
      if (rest === "") {
        // nested block (mapping or list) at a deeper indent, else null
        if (pos < lines.length && lines[pos]!.indent > indent) {
          obj[key] = parseBlock(indent + 1);
        } else {
          obj[key] = null;
        }
      } else if (rest.startsWith("[") && rest.endsWith("]")) {
        const inner = rest.slice(1, -1).trim();
        obj[key] = inner === "" ? [] : inner.split(",").map((x) => coerceScalar(x));
      } else {
        obj[key] = coerceScalar(rest);
      }
    }
    return obj;
  }

  const result = parseBlock(lines[0]!.indent);
  if (Array.isArray(result) || result === null || typeof result !== "object") {
    throw new Error("Top-level values must be a mapping (key: value).");
  }
  return result as Record<string, unknown>;
}

/* ============================ Status badge ============================ */

// deployed => success, failed => danger, pending* / uninstalling => warning,
// everything else neutral. Mirrors the LIGHT-theme palette.
function statusColor(status: HelmReleaseStatus | string): string {
  switch (status) {
    case "deployed":
      return "var(--success)";
    case "failed":
      return "var(--danger)";
    case "pending-install":
    case "pending-upgrade":
    case "pending-rollback":
    case "uninstalling":
      return "var(--warning)";
    default:
      return "var(--text-secondary)";
  }
}

function statusBg(status: HelmReleaseStatus | string): string {
  switch (status) {
    case "deployed":
      return "var(--success-bg)";
    case "failed":
      return "var(--danger-bg)";
    case "pending-install":
    case "pending-upgrade":
    case "pending-rollback":
    case "uninstalling":
      return "var(--warning-bg)";
    default:
      return "transparent";
  }
}

function StatusBadge({ status }: { status: HelmReleaseStatus | string }) {
  return (
    <span
      className="pill"
      style={{ color: statusColor(status), background: statusBg(status), borderColor: "transparent" }}
      title={status}
    >
      {status}
    </span>
  );
}

/* ============================ Page ============================ */

export function Helm() {
  const hostId = useSelectedHost();
  const queryClient = useQueryClient();
  const { permissions } = useAuth();

  const [tab, setTab] = useState<Tab>("repos");

  // permission affordances
  const canRepoWrite = can(permissions, "helm.repo.write");
  const canInstall = can(permissions, "helm.release.install");
  const canUpgrade = can(permissions, "helm.release.upgrade");
  const canRollback = can(permissions, "helm.release.rollback");
  const canUninstall = can(permissions, "helm.release.uninstall");

  /* ---- repositories tab ---- */
  const reposQ = useHelmRepos(hostId, tab === "repos");
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [removeRepoTarget, setRemoveRepoTarget] = useState<string | null>(null);
  const [reposBusy, setReposBusy] = useState(false);

  /* ---- charts tab ---- */
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const chartsQ = useHelmCharts(hostId, query, tab === "charts");
  const [installTarget, setInstallTarget] = useState<HelmChart | null>(null);

  /* ---- releases tab ---- */
  const releasesQ = useHelmReleases(hostId, tab === "releases");
  const [upgradeTarget, setUpgradeTarget] = useState<HelmRelease | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<HelmRelease | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<HelmRelease | null>(null);
  const [inspectTarget, setInspectTarget] = useState<HelmRelease | null>(null);

  const invalidateRepos = () => queryClient.invalidateQueries({ queryKey: qk.helmRepos(hostId) });
  const invalidateCharts = () =>
    queryClient.invalidateQueries({ queryKey: ["helm", "charts", hostId], exact: false });
  const invalidateReleases = () => queryClient.invalidateQueries({ queryKey: qk.helmReleases(hostId) });

  const refetch = () => {
    if (tab === "repos") reposQ.refetch();
    else if (tab === "charts") chartsQ.refetch();
    else releasesQ.refetch();
  };

  const updateRepos = async () => {
    setReposBusy(true);
    try {
      await api.helmUpdateRepos(hostId);
      toast.success("Repositories updated", "Chart indexes refreshed.");
      invalidateRepos();
      invalidateCharts();
    } catch (err) {
      toastError("Update failed", err);
    } finally {
      setReposBusy(false);
    }
  };

  const removeRepo = async () => {
    if (!removeRepoTarget) return;
    try {
      await api.helmRemoveRepo(hostId, removeRepoTarget);
      toast.success("Repository removed", removeRepoTarget);
      invalidateRepos();
      invalidateCharts();
    } catch (err) {
      toastError("Remove failed", err);
      throw err;
    }
  };

  const uninstall = async () => {
    if (!uninstallTarget) return;
    try {
      await api.helmUninstall(hostId, uninstallTarget.namespace, uninstallTarget.name);
      toast.success("Release uninstalled", `${uninstallTarget.namespace}/${uninstallTarget.name}`);
      invalidateReleases();
    } catch (err) {
      toastError("Uninstall failed", err);
      throw err;
    }
  };

  /* ---- columns: repositories ---- */
  const repoCols: Column<{ name: string; url: string }>[] = [
    { key: "name", header: "Repository", sortValue: (r) => r.name, cell: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
    {
      key: "url",
      header: "URL",
      sortValue: (r) => r.url,
      cell: (r) => (
        <a className="row mono text-xs" href={r.url} target="_blank" rel="noreferrer" style={{ gap: 4, color: "var(--text-link)" }}>
          <span className="truncate" style={{ maxWidth: 460, display: "inline-block" }}>
            {r.url}
          </span>
          <IconExternal size={13} />
        </a>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "56px",
      cell: (r) => (
        <ActionButton
          size="sm"
          iconOnly
          variant="ghost"
          disabled={!canRepoWrite}
          tooltip={canRepoWrite ? "Remove repository" : "You lack the helm.repo.write permission"}
          aria-label="Remove repository"
          onClick={() => setRemoveRepoTarget(r.name)}
          style={canRepoWrite ? { color: "var(--danger)" } : undefined}
        >
          <IconTrash size={15} />
        </ActionButton>
      ),
    },
  ];

  /* ---- columns: releases ---- */
  const releaseCols: Column<HelmRelease>[] = [
    {
      key: "name",
      header: "Release",
      sortValue: (r) => r.name,
      cell: (r) => (
        <div className="col" style={{ gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{r.name}</span>
          <span className="text-xs muted mono">{r.chart}</span>
        </div>
      ),
    },
    { key: "namespace", header: "Namespace", sortValue: (r) => r.namespace, cell: (r) => <span className="chip">{r.namespace}</span> },
    { key: "revision", header: "Rev", align: "right", sortValue: (r) => r.revision, cell: (r) => <span className="mono">{r.revision}</span> },
    { key: "status", header: "Status", sortValue: (r) => String(r.status), cell: (r) => <StatusBadge status={r.status} /> },
    { key: "appVersion", header: "App version", sortValue: (r) => r.appVersion, cell: (r) => <span className="mono text-xs">{r.appVersion || "—"}</span> },
    { key: "updated", header: "Updated", sortValue: (r) => r.updated, cell: (r) => <span className="text-xs muted nowrap">{r.updated ? timeAgo(r.updated) : "—"}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "180px",
      cell: (r) => (
        <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
          <ActionButton
            size="sm"
            iconOnly
            variant="ghost"
            tooltip="Values & history"
            aria-label="Inspect release"
            onClick={() => setInspectTarget(r)}
          >
            <IconInspect size={15} />
          </ActionButton>
          <ActionButton
            size="sm"
            iconOnly
            variant="ghost"
            disabled={!canUpgrade}
            tooltip={canUpgrade ? "Upgrade" : "You lack the helm.release.upgrade permission"}
            aria-label="Upgrade release"
            onClick={() => setUpgradeTarget(r)}
          >
            <IconScale size={15} />
          </ActionButton>
          <ActionButton
            size="sm"
            iconOnly
            variant="ghost"
            disabled={!canRollback}
            tooltip={canRollback ? "Rollback" : "You lack the helm.release.rollback permission"}
            aria-label="Rollback release"
            onClick={() => setRollbackTarget(r)}
          >
            <IconRestart size={15} />
          </ActionButton>
          <ActionButton
            size="sm"
            iconOnly
            variant="ghost"
            disabled={!canUninstall}
            tooltip={canUninstall ? "Uninstall" : "You lack the helm.release.uninstall permission"}
            aria-label="Uninstall release"
            onClick={() => setUninstallTarget(r)}
            style={canUninstall ? { color: "var(--danger)" } : undefined}
          >
            <IconTrash size={15} />
          </ActionButton>
        </div>
      ),
    },
  ];

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(searchInput.trim());
  };

  return (
    <div className="page">
      <PageHeader
        title="Helm"
        subtitle="Manage chart repositories, browse charts, and operate installed releases."
        actions={
          <div className="row">
            {tab === "repos" ? (
              <>
                <ActionButton
                  variant="default"
                  loading={reposBusy}
                  disabled={!canRepoWrite || reposBusy}
                  tooltip={canRepoWrite ? "Refresh all chart indexes" : "You lack the helm.repo.write permission"}
                  onClick={updateRepos}
                >
                  <IconDownload size={15} />
                  Update
                </ActionButton>
                <ActionButton
                  variant="primary"
                  disabled={!canRepoWrite}
                  tooltip={canRepoWrite ? undefined : "You lack the helm.repo.write permission"}
                  onClick={() => setAddRepoOpen(true)}
                >
                  <IconPlus size={15} />
                  Add repo
                </ActionButton>
              </>
            ) : null}
            <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={refetch}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      <div className="tabs">
        <button className={`tab${tab === "repos" ? " active" : ""}`} onClick={() => setTab("repos")}>
          Repositories
        </button>
        <button className={`tab${tab === "charts" ? " active" : ""}`} onClick={() => setTab("charts")}>
          Charts
        </button>
        <button className={`tab${tab === "releases" ? " active" : ""}`} onClick={() => setTab("releases")}>
          Releases
        </button>
      </div>

      {/* ---------------- Repositories ---------------- */}
      {tab === "repos" ? (
        reposQ.isLoading ? (
          <LoadingFill label="Loading repositories…" />
        ) : (reposQ.data ?? []).length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<IconStacks size={40} />}
              title="No chart repositories"
              message="Add a Helm chart repository (for example Bitnami at https://charts.bitnami.com/bitnami) to browse and install charts."
              action={
                canRepoWrite ? (
                  <ActionButton variant="primary" onClick={() => setAddRepoOpen(true)}>
                    <IconPlus size={15} />
                    Add repository
                  </ActionButton>
                ) : undefined
              }
            />
          </div>
        ) : (
          <DataTable
            columns={repoCols}
            rows={reposQ.data ?? []}
            rowKey={(r) => r.name}
            defaultSortKey="name"
            emptyIcon={<IconStacks size={40} />}
            emptyTitle="No repositories"
          />
        )
      ) : null}

      {/* ---------------- Charts ---------------- */}
      {tab === "charts" ? (
        <>
          <div className="card card-pad">
            <form className="row" onSubmit={submitSearch}>
              <span className="muted">
                <IconSearch size={16} />
              </span>
              <input
                className="input"
                placeholder="Search charts (e.g. postgresql, nginx)…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ maxWidth: 420 }}
              />
              <ActionButton type="submit" variant="default">
                Search
              </ActionButton>
              {query ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setSearchInput("");
                    setQuery("");
                  }}
                >
                  Clear
                </button>
              ) : null}
              <span className="spacer" />
              <span className="text-sm muted">{(chartsQ.data ?? []).length} chart(s)</span>
            </form>
          </div>

          {chartsQ.isLoading ? (
            <LoadingFill label="Searching charts…" />
          ) : (chartsQ.data ?? []).length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<IconSearch size={40} />}
                title="No charts found"
                message="No charts matched. Add a repository and run Update on the Repositories tab, then search again."
              />
            </div>
          ) : (
            <div className="helm-chart-grid">
              {(chartsQ.data ?? []).map((c) => (
                <ChartCard
                  key={`${c.repo}/${c.name}`}
                  chart={c}
                  canInstall={canInstall}
                  onInstall={() => setInstallTarget(c)}
                />
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* ---------------- Releases ---------------- */}
      {tab === "releases" ? (
        releasesQ.isLoading ? (
          <LoadingFill label="Loading releases…" />
        ) : (
          <DataTable
            columns={releaseCols}
            rows={releasesQ.data ?? []}
            rowKey={(r) => `${r.namespace}/${r.name}`}
            defaultSortKey="name"
            emptyIcon={<IconStacks size={40} />}
            emptyTitle="No releases installed"
            emptyMessage="Install a chart from the Charts tab to create your first release."
          />
        )
      ) : null}

      {/* ---------------- Modals / dialogs ---------------- */}
      <AddRepoModal
        open={addRepoOpen}
        hostId={hostId}
        onClose={() => setAddRepoOpen(false)}
        onAdded={() => {
          setAddRepoOpen(false);
          invalidateRepos();
          invalidateCharts();
        }}
      />

      <InstallChartModal
        hostId={hostId}
        chart={installTarget}
        onClose={() => setInstallTarget(null)}
        onInstalled={() => {
          setInstallTarget(null);
          invalidateReleases();
          setTab("releases");
        }}
      />

      <UpgradeReleaseModal
        hostId={hostId}
        target={upgradeTarget}
        onClose={() => setUpgradeTarget(null)}
        onUpgraded={() => {
          setUpgradeTarget(null);
          invalidateReleases();
        }}
      />

      <RollbackReleaseModal
        hostId={hostId}
        target={rollbackTarget}
        onClose={() => setRollbackTarget(null)}
        onRolledBack={() => {
          setRollbackTarget(null);
          invalidateReleases();
        }}
      />

      <InspectReleaseModal hostId={hostId} target={inspectTarget} onClose={() => setInspectTarget(null)} />

      <ConfirmDestructiveDialog
        open={!!uninstallTarget}
        title="Uninstall release"
        variant="danger"
        confirmLabel="Uninstall"
        description={
          <>
            Uninstall <strong className="mono">{uninstallTarget?.name}</strong> from namespace{" "}
            <strong className="mono">{uninstallTarget?.namespace}</strong>? All resources it created are removed. This
            cannot be undone.
          </>
        }
        onConfirm={uninstall}
        onClose={() => setUninstallTarget(null)}
      />

      <ConfirmDestructiveDialog
        open={!!removeRepoTarget}
        title="Remove repository"
        variant="danger"
        confirmLabel="Remove"
        description={
          <>
            Remove repository <strong className="mono">{removeRepoTarget}</strong>? Its cached chart index is dropped;
            installed releases are not affected.
          </>
        }
        onConfirm={removeRepo}
        onClose={() => setRemoveRepoTarget(null)}
      />
    </div>
  );
}

/* ============================ Chart card ============================ */

function ChartCard({
  chart,
  canInstall,
  onInstall,
}: {
  chart: HelmChart;
  canInstall: boolean;
  onInstall: () => void;
}) {
  return (
    <div className="card card-pad col" style={{ gap: "var(--sp-3)", justifyContent: "space-between" }}>
      <div className="col" style={{ gap: "var(--sp-2)" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: "var(--sp-2)" }}>
          <span style={{ fontWeight: 600 }} className="truncate" title={chart.name}>
            {chart.name}
          </span>
          <span className="chip text-xs">{chart.repo}</span>
        </div>
        <div className="row" style={{ gap: "var(--sp-2)", flexWrap: "wrap" }}>
          <span className="text-xs muted">
            chart <span className="mono">{chart.version || "—"}</span>
          </span>
          {chart.appVersion ? (
            <span className="text-xs muted">
              app <span className="mono">{chart.appVersion}</span>
            </span>
          ) : null}
        </div>
        {chart.description ? (
          <p className="text-sm secondary" style={{ margin: 0 }}>
            {chart.description}
          </p>
        ) : null}
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <ActionButton
          size="sm"
          variant="primary"
          disabled={!canInstall}
          tooltip={canInstall ? undefined : "You lack the helm.release.install permission"}
          onClick={onInstall}
        >
          <IconDownload size={14} />
          Install
        </ActionButton>
      </div>
    </div>
  );
}

/* ============================ Add repo modal ============================ */

function AddRepoModal({
  open,
  hostId,
  onClose,
  onAdded,
}: {
  open: boolean;
  hostId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setUrl("");
      setBusy(false);
    }
  }, [open]);

  const valid = name.trim() !== "" && /^https?:\/\//.test(url.trim()) && !busy;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.helmAddRepo(hostId, { name: name.trim(), url: url.trim() });
      toast.success("Repository added", name.trim());
      onAdded();
    } catch (err) {
      toastError("Add repository failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Add chart repository"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            Add
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="text-sm secondary">
          Adding a repository downloads its chart index so its charts become searchable.
        </div>
        <TextField
          label="Name"
          name="helm-repo-name"
          autoFocus
          placeholder="bitnami"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="URL"
          name="helm-repo-url"
          mono
          placeholder="https://charts.bitnami.com/bitnami"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={url.trim() !== "" && !/^https?:\/\//.test(url.trim()) ? "Must be an http(s) URL." : undefined}
        />
      </div>
    </Modal>
  );
}

/* ============================ Install chart modal ============================ */

function InstallChartModal({
  hostId,
  chart,
  onClose,
  onInstalled,
}: {
  hostId: string;
  chart: HelmChart | null;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [release, setRelease] = useState("");
  const [namespace, setNamespace] = useState("default");
  const [version, setVersion] = useState("");
  const [valuesText, setValuesText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (chart) {
      setRelease(chart.name);
      setNamespace("default");
      setVersion(chart.version || "");
      setValuesText("");
      setBusy(false);
    }
  }, [chart]);

  const valuesError = useMemo(() => {
    if (!valuesText.trim()) return null;
    try {
      parseYamlValues(valuesText);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid YAML.";
    }
  }, [valuesText]);

  const valid = release.trim() !== "" && namespace.trim() !== "" && !valuesError && !busy;

  const submit = async () => {
    if (!chart || !valid) return;
    setBusy(true);
    try {
      const values = valuesText.trim() ? parseYamlValues(valuesText) : undefined;
      await api.helmInstall(hostId, {
        release: release.trim(),
        chart: `${chart.repo}/${chart.name}`,
        namespace: namespace.trim(),
        version: version.trim() || undefined,
        values,
      });
      toast.success("Chart installed", `${release.trim()} (${chart.repo}/${chart.name})`);
      onInstalled();
    } catch (err) {
      toastError("Install failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!chart}
      wide
      title="Install chart"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            Install
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          Installing <strong className="mono">{chart ? `${chart.repo}/${chart.name}` : ""}</strong>.
        </div>
        <div className="row" style={{ gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px" }}>
            <TextField label="Release name" name="helm-install-release" value={release} onChange={(e) => setRelease(e.target.value)} />
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <TextField label="Namespace" name="helm-install-ns" value={namespace} onChange={(e) => setNamespace(e.target.value)} />
          </div>
          <div style={{ flex: "0 1 160px" }}>
            <TextField
              label="Version"
              name="helm-install-version"
              mono
              placeholder="latest"
              hint="Blank = latest"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="helm-install-values">
            Values (YAML, optional)
          </label>
          <textarea
            id="helm-install-values"
            className="textarea input-mono"
            spellCheck={false}
            wrap="off"
            value={valuesText}
            onChange={(e) => setValuesText(e.target.value)}
            placeholder={"# overrides only\nreplicaCount: 2\nservice:\n  type: ClusterIP"}
            style={{ minHeight: 200, fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre", tabSize: 2 }}
          />
          {valuesError ? <span className="field-error">{valuesError}</span> : <span className="field-hint">Leave blank to use chart defaults.</span>}
        </div>
      </div>
    </Modal>
  );
}

/* ============================ Upgrade release modal ============================ */

function UpgradeReleaseModal({
  hostId,
  target,
  onClose,
  onUpgraded,
}: {
  hostId: string;
  target: HelmRelease | null;
  onClose: () => void;
  onUpgraded: () => void;
}) {
  const [chart, setChart] = useState("");
  const [version, setVersion] = useState("");
  const [valuesText, setValuesText] = useState("");
  const [busy, setBusy] = useState(false);

  // Derive a "repo/chart" guess from the release's chart ("name-version").
  useEffect(() => {
    if (target) {
      setChart("");
      setVersion("");
      setValuesText("");
      setBusy(false);
    }
  }, [target]);

  const valuesError = useMemo(() => {
    if (!valuesText.trim()) return null;
    try {
      parseYamlValues(valuesText);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid YAML.";
    }
  }, [valuesText]);

  const valid = chart.trim() !== "" && !valuesError && !busy;

  const submit = async () => {
    if (!target || !valid) return;
    setBusy(true);
    try {
      const values = valuesText.trim() ? parseYamlValues(valuesText) : undefined;
      await api.helmUpgrade(hostId, target.namespace, target.name, {
        chart: chart.trim(),
        version: version.trim() || undefined,
        values,
      });
      toast.success("Release upgraded", `${target.namespace}/${target.name}`);
      onUpgraded();
    } catch (err) {
      toastError("Upgrade failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      wide
      title="Upgrade release"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            Upgrade
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          Upgrade <strong className="mono">{target?.name}</strong> in namespace{" "}
          <strong className="mono">{target?.namespace}</strong> (currently revision{" "}
          <span className="mono">{target?.revision}</span>, chart <span className="mono">{target?.chart}</span>).
        </div>
        <div className="row" style={{ gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px" }}>
            <TextField
              label="Chart"
              name="helm-upgrade-chart"
              mono
              placeholder="bitnami/postgresql"
              hint="repo/chart reference"
              value={chart}
              onChange={(e) => setChart(e.target.value)}
            />
          </div>
          <div style={{ flex: "0 1 180px" }}>
            <TextField
              label="Version"
              name="helm-upgrade-version"
              mono
              placeholder="latest"
              hint="Blank = latest"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="helm-upgrade-values">
            Values (YAML, optional)
          </label>
          <textarea
            id="helm-upgrade-values"
            className="textarea input-mono"
            spellCheck={false}
            wrap="off"
            value={valuesText}
            onChange={(e) => setValuesText(e.target.value)}
            placeholder={"# overrides only\nreplicaCount: 3"}
            style={{ minHeight: 180, fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre", tabSize: 2 }}
          />
          {valuesError ? <span className="field-error">{valuesError}</span> : <span className="field-hint">Merged over the release's existing values.</span>}
        </div>
      </div>
    </Modal>
  );
}

/* ============================ Rollback release modal ============================ */

function RollbackReleaseModal({
  hostId,
  target,
  onClose,
  onRolledBack,
}: {
  hostId: string;
  target: HelmRelease | null;
  onClose: () => void;
  onRolledBack: () => void;
}) {
  const historyQ = useHelmReleaseHistory(hostId, target?.namespace ?? "", target?.name ?? "", !!target);
  const [revision, setRevision] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setRevision(0);
      setBusy(false);
    }
  }, [target]);

  // Past revisions (anything below the current one) — newest first.
  const history = historyQ.data ?? [];
  const candidates = useMemo(
    () => history.filter((h) => !target || h.revision < target.revision).sort((a, b) => b.revision - a.revision),
    [history, target],
  );

  const submit = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      await api.helmRollback(hostId, target.namespace, target.name, { revision });
      toast.success(
        "Release rolled back",
        `${target.namespace}/${target.name} → revision ${revision === 0 ? "previous" : revision}`,
      );
      onRolledBack();
    } catch (err) {
      toastError("Rollback failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      wide
      title="Rollback release"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={busy} onClick={submit}>
            Rollback
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          Roll <strong className="mono">{target?.name}</strong> back to an earlier revision. The chosen revision is
          re-applied as a new revision on top.
        </div>

        <div className="field" style={{ maxWidth: 280 }}>
          <label className="field-label" htmlFor="helm-rollback-rev">
            Target revision
          </label>
          <select
            id="helm-rollback-rev"
            className="select"
            value={revision}
            onChange={(e) => setRevision(Number(e.target.value))}
          >
            <option value={0}>Previous revision</option>
            {candidates.map((h) => (
              <option key={h.revision} value={h.revision}>
                #{h.revision} — {h.status} ({h.chart})
              </option>
            ))}
          </select>
        </div>

        {historyQ.isLoading ? (
          <div className="text-sm muted">Loading history…</div>
        ) : candidates.length === 0 ? (
          <div className="text-sm muted">No earlier revisions recorded; "Previous revision" will be used.</div>
        ) : (
          <div className="col" style={{ gap: 4 }}>
            <span className="field-label" style={{ margin: 0 }}>
              History
            </span>
            <table className="dt">
              <thead>
                <tr>
                  <th>Rev</th>
                  <th>Status</th>
                  <th>Chart</th>
                  <th>Updated</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {history
                  .slice()
                  .sort((a, b) => b.revision - a.revision)
                  .map((h: HelmReleaseRevision) => (
                    <tr key={h.revision}>
                      <td className="mono text-sm">{h.revision}</td>
                      <td>
                        <StatusBadge status={h.status} />
                      </td>
                      <td className="mono text-xs">{h.chart}</td>
                      <td className="text-xs muted nowrap">{h.updated ? timeAgo(h.updated) : "—"}</td>
                      <td className="text-xs secondary">{h.description || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ============================ Inspect (values + history) modal ============================ */

function InspectReleaseModal({
  hostId,
  target,
  onClose,
}: {
  hostId: string;
  target: HelmRelease | null;
  onClose: () => void;
}) {
  const [view, setView] = useState<"values" | "history">("values");
  const valuesQ = useHelmReleaseValues(hostId, target?.namespace ?? "", target?.name ?? "", !!target && view === "values");
  const historyQ = useHelmReleaseHistory(hostId, target?.namespace ?? "", target?.name ?? "", !!target && view === "history");

  useEffect(() => {
    if (target) setView("values");
  }, [target]);

  const valuesEmpty = !valuesQ.data || Object.keys(valuesQ.data).length === 0;

  return (
    <Modal
      open={!!target}
      wide
      title={
        <span className="row" style={{ gap: "var(--sp-2)" }}>
          Release
          <span className="mono" style={{ fontWeight: 600 }}>
            {target?.name}
          </span>
          <span className="chip">{target?.namespace}</span>
        </span>
      }
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="tabs">
          <button className={`tab${view === "values" ? " active" : ""}`} onClick={() => setView("values")}>
            Values
          </button>
          <button className={`tab${view === "history" ? " active" : ""}`} onClick={() => setView("history")}>
            History
          </button>
        </div>

        {view === "values" ? (
          valuesQ.isLoading ? (
            <div className="text-sm muted">Loading values…</div>
          ) : valuesEmpty ? (
            <div className="text-sm muted">This release has no user-supplied value overrides (chart defaults in effect).</div>
          ) : (
            <pre
              className="input-mono"
              style={{
                margin: 0,
                padding: "var(--sp-3)",
                background: "var(--bg-surface-2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                fontSize: 12.5,
                lineHeight: 1.5,
                maxHeight: 420,
                overflow: "auto",
                whiteSpace: "pre",
              }}
            >
              {prettyJson(valuesQ.data)}
            </pre>
          )
        ) : historyQ.isLoading ? (
          <div className="text-sm muted">Loading history…</div>
        ) : (historyQ.data ?? []).length === 0 ? (
          <div className="text-sm muted">No revision history recorded.</div>
        ) : (
          <table className="dt">
            <thead>
              <tr>
                <th>Rev</th>
                <th>Status</th>
                <th>Chart</th>
                <th>App</th>
                <th>Updated</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {(historyQ.data ?? [])
                .slice()
                .sort((a, b) => b.revision - a.revision)
                .map((h) => (
                  <tr key={h.revision}>
                    <td className="mono text-sm">{h.revision}</td>
                    <td>
                      <StatusBadge status={h.status} />
                    </td>
                    <td className="mono text-xs">{h.chart}</td>
                    <td className="mono text-xs">{h.appVersion || "—"}</td>
                    <td className="text-xs muted nowrap">{h.updated ? timeAgo(h.updated) : "—"}</td>
                    <td className="text-xs secondary">{h.description || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
