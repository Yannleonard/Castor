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
import { HelpButton } from "../components/HelpButton";
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
import { useT, t as tr } from "../i18n";
import { helmDict } from "../i18n/locales/helm";
import type {
  HelmChart,
  HelmRelease,
  HelmReleaseRevision,
  HelmReleaseStatus,
  HelmUpgradePreview,
} from "../lib/types";

type Tab = "repos" | "charts" | "releases";

/* ============================ Unified diff helper ============================ */
//
// The upgrade preview returns two rendered manifests (current + pending). We
// compute a classic line-oriented unified diff between them with an LCS so the
// UpgradeReleaseModal can render added / removed / context lines. An install
// preview arrives with current === "" and every pending line shows as added.

type DiffLine = { kind: "add" | "del" | "ctx"; text: string };

function diffLines(current: string, pending: string): DiffLine[] {
  // Split, dropping a single trailing newline's empty tail so a manifest that
  // ends in "\n" does not contribute a phantom blank line.
  const split = (s: string): string[] => {
    if (s === "") return [];
    const parts = s.split("\n");
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    return parts;
  };
  const a = split(current);
  const b = split(pending);

  // LCS length table (rows = a, cols = b). Kept simple/O(n*m); manifests are
  // small enough that this is fine.
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "ctx", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "del", text: a[i]! });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++]! });
  while (j < m) out.push({ kind: "add", text: b[j++]! });
  return out;
}

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
  const t = useT(helmDict);
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
      toast.success(tr(helmDict, "toast.updatedTitle"), tr(helmDict, "toast.updatedBody"));
      invalidateRepos();
      invalidateCharts();
    } catch (err) {
      toastError(tr(helmDict, "toast.updateFailed"), err);
    } finally {
      setReposBusy(false);
    }
  };

  const removeRepo = async () => {
    if (!removeRepoTarget) return;
    try {
      await api.helmRemoveRepo(hostId, removeRepoTarget);
      toast.success(tr(helmDict, "toast.repoRemovedTitle"), removeRepoTarget);
      invalidateRepos();
      invalidateCharts();
    } catch (err) {
      toastError(tr(helmDict, "toast.removeFailed"), err);
      throw err;
    }
  };

  const uninstall = async () => {
    if (!uninstallTarget) return;
    try {
      await api.helmUninstall(hostId, uninstallTarget.namespace, uninstallTarget.name);
      toast.success(tr(helmDict, "toast.uninstalledTitle"), `${uninstallTarget.namespace}/${uninstallTarget.name}`);
      invalidateReleases();
    } catch (err) {
      toastError(tr(helmDict, "toast.uninstallFailed"), err);
      throw err;
    }
  };

  /* ---- columns: repositories ---- */
  const repoCols: Column<{ name: string; url: string }>[] = [
    { key: "name", header: t("repo.colName"), sortValue: (r) => r.name, cell: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
    {
      key: "url",
      header: t("repo.colUrl"),
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
          tooltip={canRepoWrite ? t("repo.remove") : t("repo.removeNoPerm")}
          aria-label={t("repo.remove")}
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
      header: t("release.colName"),
      sortValue: (r) => r.name,
      cell: (r) => (
        <div className="col" style={{ gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{r.name}</span>
          <span className="text-xs muted mono">{r.chart}</span>
        </div>
      ),
    },
    { key: "namespace", header: t("release.colNamespace"), sortValue: (r) => r.namespace, cell: (r) => <span className="chip">{r.namespace}</span> },
    { key: "revision", header: t("release.colRevision"), align: "right", sortValue: (r) => r.revision, cell: (r) => <span className="mono">{r.revision}</span> },
    { key: "status", header: t("release.colStatus"), sortValue: (r) => String(r.status), cell: (r) => <StatusBadge status={r.status} /> },
    { key: "appVersion", header: t("release.colAppVersion"), sortValue: (r) => r.appVersion, cell: (r) => <span className="mono text-xs">{r.appVersion || "—"}</span> },
    { key: "updated", header: t("release.colUpdated"), sortValue: (r) => r.updated, cell: (r) => <span className="text-xs muted nowrap">{r.updated ? timeAgo(r.updated) : "—"}</span> },
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
            tooltip={t("release.inspect")}
            aria-label={t("release.inspectAria")}
            onClick={() => setInspectTarget(r)}
          >
            <IconInspect size={15} />
          </ActionButton>
          <ActionButton
            size="sm"
            iconOnly
            variant="ghost"
            disabled={!canUpgrade}
            tooltip={canUpgrade ? t("release.upgrade") : t("release.upgradeNoPerm")}
            aria-label={t("release.upgradeAria")}
            onClick={() => setUpgradeTarget(r)}
          >
            <IconScale size={15} />
          </ActionButton>
          <ActionButton
            size="sm"
            iconOnly
            variant="ghost"
            disabled={!canRollback}
            tooltip={canRollback ? t("release.rollback") : t("release.rollbackNoPerm")}
            aria-label={t("release.rollbackAria")}
            onClick={() => setRollbackTarget(r)}
          >
            <IconRestart size={15} />
          </ActionButton>
          <ActionButton
            size="sm"
            iconOnly
            variant="ghost"
            disabled={!canUninstall}
            tooltip={canUninstall ? t("release.uninstall") : t("release.uninstallNoPerm")}
            aria-label={t("release.uninstallAria")}
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
        title={t("header.title")}
        subtitle={t("header.subtitle")}
        actions={
          <div className="row">
            {tab === "repos" ? (
              <>
                <ActionButton
                  variant="default"
                  loading={reposBusy}
                  disabled={!canRepoWrite || reposBusy}
                  tooltip={canRepoWrite ? t("header.updateTooltip") : t("header.noRepoWrite")}
                  onClick={updateRepos}
                >
                  <IconDownload size={15} />
                  {t("header.update")}
                </ActionButton>
                <ActionButton
                  variant="primary"
                  disabled={!canRepoWrite}
                  tooltip={canRepoWrite ? undefined : t("header.noRepoWrite")}
                  onClick={() => setAddRepoOpen(true)}
                >
                  <IconPlus size={15} />
                  {t("header.addRepo")}
                </ActionButton>
              </>
            ) : null}
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} aria-label={t("header.refresh")} onClick={refetch}>
              <IconRefresh size={16} />
            </ActionButton>
            <HelpButton topic="helm" />
          </div>
        }
      />

      <div className="tabs">
        <button className={`tab${tab === "repos" ? " active" : ""}`} onClick={() => setTab("repos")}>
          {t("tab.repos")}
        </button>
        <button className={`tab${tab === "charts" ? " active" : ""}`} onClick={() => setTab("charts")}>
          {t("tab.charts")}
        </button>
        <button className={`tab${tab === "releases" ? " active" : ""}`} onClick={() => setTab("releases")}>
          {t("tab.releases")}
        </button>
      </div>

      {/* ---------------- Repositories ---------------- */}
      {tab === "repos" ? (
        reposQ.isLoading ? (
          <LoadingFill label={t("repo.loading")} />
        ) : (reposQ.data ?? []).length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<IconStacks size={40} />}
              title={t("repo.emptyTitle")}
              message={t("repo.emptyMessage")}
              action={
                canRepoWrite ? (
                  <ActionButton variant="primary" onClick={() => setAddRepoOpen(true)}>
                    <IconPlus size={15} />
                    {t("repo.emptyAction")}
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
            emptyTitle={t("repo.emptyTableTitle")}
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
                placeholder={t("chart.searchPlaceholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ maxWidth: 420 }}
              />
              <ActionButton type="submit" variant="default">
                {t("chart.search")}
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
                  {t("chart.clear")}
                </button>
              ) : null}
              <span className="spacer" />
              <span className="text-sm muted">{t("chart.count", { n: (chartsQ.data ?? []).length })}</span>
            </form>
          </div>

          {chartsQ.isLoading ? (
            <LoadingFill label={t("chart.searching")} />
          ) : (chartsQ.data ?? []).length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<IconSearch size={40} />}
                title={t("chart.noneTitle")}
                message={t("chart.noneMessage")}
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
          <LoadingFill label={t("release.loading")} />
        ) : (
          <DataTable
            columns={releaseCols}
            rows={releasesQ.data ?? []}
            rowKey={(r) => `${r.namespace}/${r.name}`}
            defaultSortKey="name"
            emptyIcon={<IconStacks size={40} />}
            emptyTitle={t("release.emptyTitle")}
            emptyMessage={t("release.emptyMessage")}
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
        title={t("dialog.uninstallTitle")}
        variant="danger"
        confirmLabel={t("dialog.uninstallConfirm")}
        description={
          <>
            {t("dialog.uninstallDescPrefix")} <strong className="mono">{uninstallTarget?.name}</strong>{" "}
            {t("dialog.uninstallDescMid")} <strong className="mono">{uninstallTarget?.namespace}</strong>
            {t("dialog.uninstallDescSuffix")}
          </>
        }
        onConfirm={uninstall}
        onClose={() => setUninstallTarget(null)}
      />

      <ConfirmDestructiveDialog
        open={!!removeRepoTarget}
        title={t("dialog.removeRepoTitle")}
        variant="danger"
        confirmLabel={t("dialog.removeRepoConfirm")}
        description={
          <>
            {t("dialog.removeRepoDescPrefix")} <strong className="mono">{removeRepoTarget}</strong>
            {t("dialog.removeRepoDescSuffix")}
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
  const t = useT(helmDict);
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
            {t("chart.cardChart")} <span className="mono">{chart.version || "—"}</span>
          </span>
          {chart.appVersion ? (
            <span className="text-xs muted">
              {t("chart.cardApp")} <span className="mono">{chart.appVersion}</span>
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
          tooltip={canInstall ? undefined : t("chart.installNoPerm")}
          onClick={onInstall}
        >
          <IconDownload size={14} />
          {t("chart.install")}
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
  const t = useT(helmDict);
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
      toast.success(tr(helmDict, "toast.repoAddedTitle"), name.trim());
      onAdded();
    } catch (err) {
      toastError(tr(helmDict, "toast.addRepoFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("repo.addTitle")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("repo.cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("repo.add")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="text-sm secondary">
          {t("repo.addIntro")}
        </div>
        <TextField
          label={t("repo.fieldName")}
          name="helm-repo-name"
          autoFocus
          placeholder="bitnami"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label={t("repo.fieldUrl")}
          name="helm-repo-url"
          mono
          placeholder="https://charts.bitnami.com/bitnami"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={url.trim() !== "" && !/^https?:\/\//.test(url.trim()) ? t("repo.urlError") : undefined}
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
  const t = useT(helmDict);
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
      return err instanceof Error ? err.message : tr(helmDict, "chart.invalidYaml");
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
      toast.success(tr(helmDict, "toast.installedTitle"), `${release.trim()} (${chart.repo}/${chart.name})`);
      onInstalled();
    } catch (err) {
      toastError(tr(helmDict, "toast.installFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!chart}
      wide
      title={t("chart.installTitle")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("chart.installCancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("chart.installConfirm")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          {t("chart.installIntroPrefix")} <strong className="mono">{chart ? `${chart.repo}/${chart.name}` : ""}</strong>.
        </div>
        <div className="row" style={{ gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px" }}>
            <TextField label={t("chart.releaseName")} name="helm-install-release" value={release} onChange={(e) => setRelease(e.target.value)} />
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <TextField label={t("chart.namespace")} name="helm-install-ns" value={namespace} onChange={(e) => setNamespace(e.target.value)} />
          </div>
          <div style={{ flex: "0 1 160px" }}>
            <TextField
              label={t("chart.version")}
              name="helm-install-version"
              mono
              placeholder={t("chart.versionPlaceholder")}
              hint={t("chart.versionHint")}
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="helm-install-values">
            {t("chart.valuesLabel")}
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
          {valuesError ? <span className="field-error">{valuesError}</span> : <span className="field-hint">{t("chart.valuesHint")}</span>}
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
  const t = useT(helmDict);
  const [chart, setChart] = useState("");
  const [version, setVersion] = useState("");
  const [valuesText, setValuesText] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState<HelmUpgradePreview | null>(null);

  // Derive a "repo/chart" guess from the release's chart ("name-version").
  useEffect(() => {
    if (target) {
      setChart("");
      setVersion("");
      setValuesText("");
      setBusy(false);
      setPreviewBusy(false);
      setPreview(null);
    }
  }, [target]);

  // Editing any input invalidates a stale preview so the diff never lags the form.
  useEffect(() => {
    setPreview(null);
  }, [chart, version, valuesText]);

  const valuesError = useMemo(() => {
    if (!valuesText.trim()) return null;
    try {
      parseYamlValues(valuesText);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : tr(helmDict, "upgrade.invalidYaml");
    }
  }, [valuesText]);

  const valid = chart.trim() !== "" && !valuesError && !busy;

  // Same body as the upgrade — chart/version/parsed values — sent to the
  // dry-run preview endpoint. Nothing is applied; we diff current vs pending.
  const runPreview = async () => {
    if (!target || !valid || previewBusy) return;
    setPreviewBusy(true);
    try {
      const values = valuesText.trim() ? parseYamlValues(valuesText) : undefined;
      const result = await api.helmPreviewUpgrade(hostId, target.namespace, target.name, {
        chart: chart.trim(),
        version: version.trim() || undefined,
        values,
      });
      setPreview(result);
    } catch (err) {
      setPreview(null);
      toastError(tr(helmDict, "toast.previewFailed"), err);
    } finally {
      setPreviewBusy(false);
    }
  };

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
      toast.success(tr(helmDict, "toast.upgradedTitle"), `${target.namespace}/${target.name}`);
      onUpgraded();
    } catch (err) {
      toastError(tr(helmDict, "toast.upgradeFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      wide
      title={t("upgrade.title")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("upgrade.cancel")}
          </button>
          <ActionButton
            variant="default"
            loading={previewBusy}
            disabled={!valid || previewBusy}
            tooltip={t("upgrade.previewTooltip")}
            onClick={runPreview}
          >
            <IconInspect size={15} />
            {t("upgrade.preview")}
          </ActionButton>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("upgrade.confirm")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          {t("upgrade.introPrefix")} <strong className="mono">{target?.name}</strong> {t("upgrade.introNamespace")}{" "}
          <strong className="mono">{target?.namespace}</strong> {t("upgrade.introRevision")}{" "}
          <span className="mono">{target?.revision}</span>{t("upgrade.introChart")}{" "}
          <span className="mono">{target?.chart}</span>).
        </div>
        <div className="row" style={{ gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px" }}>
            <TextField
              label={t("upgrade.fieldChart")}
              name="helm-upgrade-chart"
              mono
              placeholder="bitnami/postgresql"
              hint={t("upgrade.chartHint")}
              value={chart}
              onChange={(e) => setChart(e.target.value)}
            />
          </div>
          <div style={{ flex: "0 1 180px" }}>
            <TextField
              label={t("upgrade.fieldVersion")}
              name="helm-upgrade-version"
              mono
              placeholder={t("upgrade.versionPlaceholder")}
              hint={t("upgrade.versionHint")}
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="helm-upgrade-values">
            {t("upgrade.valuesLabel")}
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
          {valuesError ? <span className="field-error">{valuesError}</span> : <span className="field-hint">{t("upgrade.valuesHint")}</span>}
        </div>

        {preview ? <UpgradeDiff preview={preview} /> : null}
      </div>
    </Modal>
  );
}

/* ============================ Upgrade diff view ============================ */
//
// Renders the current→pending manifest diff produced by the preview endpoint as
// a scrollable unified diff, reusing the InspectReleaseModal values <pre> style.
// Added lines are var(--success), removed var(--danger), context muted gray.
// An install preview (current === "") shows as a pure-addition diff.

function UpgradeDiff({ preview }: { preview: HelmUpgradePreview }) {
  const t = useT(helmDict);
  const lines = useMemo(() => diffLines(preview.current, preview.pending), [preview]);
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "del").length;
  const noChange = added === 0 && removed === 0;
  const isInstall = preview.current.trim() === "";

  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row" style={{ gap: "var(--sp-2)", alignItems: "baseline" }}>
        <span className="field-label" style={{ margin: 0 }}>
          {t("upgrade.previewDiff")}
        </span>
        <span className="text-xs" style={{ color: "var(--success)" }}>
          +{added}
        </span>
        <span className="text-xs" style={{ color: "var(--danger)" }}>
          −{removed}
        </span>
        {isInstall ? <span className="text-xs muted">{t("upgrade.firstInstall")}</span> : null}
      </div>
      {noChange ? (
        <div className="text-sm muted">{t("upgrade.noChange")}</div>
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
          {lines.map((l, idx) => {
            const color =
              l.kind === "add" ? "var(--success)" : l.kind === "del" ? "var(--danger)" : "var(--text-secondary)";
            const sign = l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ";
            return (
              <div key={idx} style={{ color }}>
                {sign} {l.text}
              </div>
            );
          })}
        </pre>
      )}
    </div>
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
  const t = useT(helmDict);
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
      const revLabel = revision === 0 ? tr(helmDict, "toast.rolledBackPrevious") : String(revision);
      toast.success(
        tr(helmDict, "toast.rolledBackTitle"),
        tr(helmDict, "toast.rolledBackBody", { target: `${target.namespace}/${target.name}`, rev: revLabel }),
      );
      onRolledBack();
    } catch (err) {
      toastError(tr(helmDict, "toast.rollbackFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      wide
      title={t("rollback.title")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("rollback.cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={busy} onClick={submit}>
            {t("rollback.confirm")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          {t("rollback.introPrefix")} <strong className="mono">{target?.name}</strong> {t("rollback.introSuffix")}
        </div>

        <div className="field" style={{ maxWidth: 280 }}>
          <label className="field-label" htmlFor="helm-rollback-rev">
            {t("rollback.targetRevision")}
          </label>
          <select
            id="helm-rollback-rev"
            className="select"
            value={revision}
            onChange={(e) => setRevision(Number(e.target.value))}
          >
            <option value={0}>{t("rollback.previousRevision")}</option>
            {candidates.map((h) => (
              <option key={h.revision} value={h.revision}>
                #{h.revision} — {h.status} ({h.chart})
              </option>
            ))}
          </select>
        </div>

        {historyQ.isLoading ? (
          <div className="text-sm muted">{t("rollback.loadingHistory")}</div>
        ) : candidates.length === 0 ? (
          <div className="text-sm muted">{t("rollback.noEarlier")}</div>
        ) : (
          <div className="col" style={{ gap: 4 }}>
            <span className="field-label" style={{ margin: 0 }}>
              {t("rollback.history")}
            </span>
            <table className="dt">
              <thead>
                <tr>
                  <th>{t("rollback.colRev")}</th>
                  <th>{t("rollback.colStatus")}</th>
                  <th>{t("rollback.colChart")}</th>
                  <th>{t("rollback.colUpdated")}</th>
                  <th>{t("rollback.colDescription")}</th>
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
  const t = useT(helmDict);
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
          {t("inspect.releaseLabel")}
          <span className="mono" style={{ fontWeight: 600 }}>
            {target?.name}
          </span>
          <span className="chip">{target?.namespace}</span>
        </span>
      }
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          {t("inspect.close")}
        </button>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="tabs">
          <button className={`tab${view === "values" ? " active" : ""}`} onClick={() => setView("values")}>
            {t("inspect.tabValues")}
          </button>
          <button className={`tab${view === "history" ? " active" : ""}`} onClick={() => setView("history")}>
            {t("inspect.tabHistory")}
          </button>
        </div>

        {view === "values" ? (
          valuesQ.isLoading ? (
            <div className="text-sm muted">{t("inspect.loadingValues")}</div>
          ) : valuesEmpty ? (
            <div className="text-sm muted">{t("inspect.valuesEmpty")}</div>
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
          <div className="text-sm muted">{t("inspect.loadingHistory")}</div>
        ) : (historyQ.data ?? []).length === 0 ? (
          <div className="text-sm muted">{t("inspect.historyEmpty")}</div>
        ) : (
          <table className="dt">
            <thead>
              <tr>
                <th>{t("inspect.colRev")}</th>
                <th>{t("inspect.colStatus")}</th>
                <th>{t("inspect.colChart")}</th>
                <th>{t("inspect.colApp")}</th>
                <th>{t("inspect.colUpdated")}</th>
                <th>{t("inspect.colDescription")}</th>
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
