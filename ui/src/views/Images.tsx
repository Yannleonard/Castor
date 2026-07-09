// ui/src/views/Images.tsx
//
// Docker images: read + gated writes. Pull opens a modal accepting an image ref
// (validated client-side; backend re-validates, anti-SSRF). Delete is admin-gated
// (docker.image.delete) and gated by CapImages.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useImages, useCapabilityLookup } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { LoadingFill } from "../components/Spinner";
import { Modal } from "../components/Modal";
import { ActionButton } from "../components/ActionButton";
import { HelpButton } from "../components/HelpButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { TextField } from "../components/Field";
import { IconImages, IconPlus, IconTrash, IconRefresh, IconSearch, IconPrune, IconAlert } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { formatBytes, shortId, timeAgo } from "../lib/format";
import { useT, t as tr } from "../i18n";
import { imagesDict } from "../i18n/locales/images";
import type { DockerImage } from "../lib/types";

const EMPTY_IMAGES: DockerImage[] = [];

const IMAGE_REF_RE =/^[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*(:[\w][\w.-]{0,127})?(@sha256:[a-f0-9]{64})?$/i;

export function Images() {
  const t = useT(imagesDict);
  const hostId = useSelectedHost();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { capsForKind } = useCapabilityLookup();
  const caps = capsForKind("docker");

  const query = useImages(hostId);
  const [search, setSearch] = useState("");
  const [pullOpen, setPullOpen] = useState(false);
  const [pullRef, setPullRef] = useState("");
  const [pulling, setPulling] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<DockerImage | null>(null);
  const [pruneOpen, setPruneOpen] = useState(false);
  const [removeAll, setRemoveAll] = useState(false);
  const [pruning, setPruning] = useState(false);

  const canPull = caps?.includes("images") && can("docker.image.pull");
  const canDelete = caps?.includes("images") && can("docker.image.delete");
  const canPrune = can("docker.system.prune");

  const images = query.data ?? EMPTY_IMAGES;
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return images;
    return images.filter((i) => `${i.repoTags.join(" ")} ${i.id}`.toLowerCase().includes(s));
  }, [images, search]);

  const refRegexOk = pullRef.trim().length > 0 && IMAGE_REF_RE.test(pullRef.trim());

  const doPull = async () => {
    if (!refRegexOk) return;
    setPulling(true);
    try {
      await api.imagePull(hostId, pullRef.trim());
      toast.success(tr(imagesDict, "toast.pullStartedTitle"), tr(imagesDict, "toast.pullStartedBody", { ref: pullRef.trim() }));
      setPullOpen(false);
      setPullRef("");
      queryClient.invalidateQueries({ queryKey: ["images", hostId] });
    } catch (err) {
      toastError(tr(imagesDict, "toast.pullFailed"), err);
    } finally {
      setPulling(false);
    }
  };

  const doPrune = async () => {
    setPruning(true);
    try {
      const res = await api.prune(hostId, { target: "images", dangling: !removeAll });
      toast.success(
        tr(imagesDict, "toast.prunedTitle"),
        tr(imagesDict, "toast.prunedBody", { count: res.removed.length, reclaimed: formatBytes(res.spaceReclaimed) }),
      );
      setPruneOpen(false);
      queryClient.invalidateQueries({ queryKey: ["images", hostId] });
    } catch (err) {
      toastError(tr(imagesDict, "toast.pruneFailed"), err);
    } finally {
      setPruning(false);
    }
  };

  const doRemove = async () => {
    if (!removeTarget) return;
    try {
      await api.imageDelete(hostId, removeTarget.id, false);
      toast.success(tr(imagesDict, "toast.deletedTitle"), removeTarget.repoTags[0] ?? shortId(removeTarget.id));
      queryClient.invalidateQueries({ queryKey: ["images", hostId] });
    } catch (err) {
      toastError(tr(imagesDict, "toast.deleteFailed"), err);
      throw err;
    }
  };

  const columns: Column<DockerImage>[] = [
    {
      key: "repo",
      header: t("col.repoTag"),
      sortValue: (i) => i.repoTags[0] ?? i.id,
      cell: (i) => (
        <div className="col" style={{ gap: 2 }}>
          {i.repoTags.length ? (
            i.repoTags.map((t) => (
              <span key={t} className="mono text-sm">
                {t}
              </span>
            ))
          ) : (
            <span className="muted">&lt;none&gt;</span>
          )}
          {i.dangling ? (
            <span className="pill" style={{ color: "var(--warning)", background: "var(--warning-bg)", borderColor: "transparent" }}>
              {t("badge.dangling")}
            </span>
          ) : null}
        </div>
      ),
    },
    { key: "id", header: t("col.imageId"), sortValue: (i) => i.id, cell: (i) => <span className="mono text-xs muted">{shortId(i.id)}</span> },
    { key: "size", header: t("col.size"), align: "right", sortValue: (i) => i.size, cell: (i) => <span className="mono">{formatBytes(i.size)}</span> },
    { key: "created", header: t("col.created"), sortValue: (i) => i.created, cell: (i) => <span className="text-xs muted nowrap">{timeAgo(i.created)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "60px",
      cell: (i) => (
        <CapabilityGate
          allowed={!!canDelete}
          reason={!caps?.includes("images") ? t("gate.noImagesProvider") : t("gate.needDelete")}
        >
          {(allowed, reason) => (
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              disabled={!allowed}
              tooltip={allowed ? t("row.deleteImage") : reason}
              aria-label={t("row.deleteImage")}
              onClick={() => setRemoveTarget(i)}
              style={allowed ? { color: "var(--danger)" } : undefined}
            >
              <IconTrash size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title={t("header.title")}
        subtitle={t("header.subtitle")}
        actions={
          <div className="row">
            <CapabilityGate
              allowed={!!canPull}
              reason={!caps?.includes("images") ? t("gate.noImagesProvider") : t("gate.needPull")}
            >
              {(allowed, reason) => (
                <ActionButton variant="primary" disabled={!allowed} tooltip={allowed ? undefined : reason} onClick={() => setPullOpen(true)}>
                  <IconPlus size={15} />
                  {t("header.pull")}
                </ActionButton>
              )}
            </CapabilityGate>
            <CapabilityGate allowed={canPrune} reason={t("gate.needPrune")}>
              {(allowed, reason) => (
                <ActionButton
                  variant="ghost"
                  disabled={!allowed}
                  tooltip={allowed ? undefined : reason}
                  onClick={() => {
                    setRemoveAll(false);
                    setPruneOpen(true);
                  }}
                >
                  <IconPrune size={15} />
                  {t("header.prune")}
                </ActionButton>
              )}
            </CapabilityGate>
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} aria-label={t("header.refresh")} onClick={() => query.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
            <HelpButton topic="images" />
          </div>
        }
      />

      <div className="card card-pad">
        <div className="row">
          <span className="muted">
            <IconSearch size={16} />
          </span>
          <input className="input" placeholder={t("filter.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 360 }} />
          <span className="spacer" />
          <span className="text-sm muted">
            {t("filter.count", { shown: filtered.length, total: images.length })}
          </span>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label={t("list.loading")} />
      ) : images.length === 0 ? (
        // No images on the host: open the existing pull modal directly (only
        // when the caller may pull).
        <div className="card">
          <EmptyState
            icon={<IconImages size={40} />}
            title={t("empty.title")}
            message={t("empty.message")}
            action={
              canPull ? (
                <ActionButton variant="primary" onClick={() => setPullOpen(true)}>
                  <IconPlus size={15} />
                  {t("empty.action")}
                </ActionButton>
              ) : undefined
            }
          />
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(i) => i.id}
          defaultSortKey="repo"
          emptyIcon={<IconImages size={40} />}
          emptyTitle={t("empty.title")}
          emptyMessage={t("empty.tableMessage")}
        />
      )}

      <Modal
        open={pullOpen}
        title={t("pull.title")}
        busy={pulling}
        onClose={() => setPullOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setPullOpen(false)} disabled={pulling}>
              {t("pull.cancel")}
            </button>
            <ActionButton variant="primary" loading={pulling} disabled={!refRegexOk} onClick={doPull}>
              {t("pull.confirm")}
            </ActionButton>
          </>
        }
      >
        <div className="col" style={{ gap: "var(--sp-3)" }}>
          <TextField
            label={t("pull.refLabel")}
            mono
            autoFocus
            placeholder="nginx:latest"
            value={pullRef}
            onChange={(e) => setPullRef(e.target.value)}
            error={pullRef && !refRegexOk ? t("pull.refError") : undefined}
            hint={t("pull.refHint")}
          />
        </div>
      </Modal>

      {/* Custom prune dialog: ConfirmDestructiveDialog only offers fixed force/volumes
          toggles, so the remove-all checkbox needs its own modal (same destructive style). */}
      <Modal
        open={pruneOpen}
        title={
          <span className="row">
            <span style={{ color: "var(--danger)" }}>
              <IconAlert size={18} />
            </span>
            {t("prune.title")}
          </span>
        }
        busy={pruning}
        onClose={() => setPruneOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setPruneOpen(false)} disabled={pruning}>
              {t("prune.cancel")}
            </button>
            <ActionButton variant="danger" loading={pruning} onClick={doPrune}>
              {t("prune.confirm")}
            </ActionButton>
          </>
        }
      >
        <div className="col" style={{ gap: "var(--sp-4)" }}>
          <div className="text-sm secondary">{t("prune.description")}</div>
          <label className="checkbox-row">
            <input type="checkbox" checked={removeAll} onChange={(e) => setRemoveAll(e.target.checked)} />
            <span>{t("prune.removeAll")}</span>
          </label>
        </div>
      </Modal>

      <ConfirmDestructiveDialog
        open={!!removeTarget}
        title={t("remove.title")}
        variant="danger"
        confirmLabel={t("remove.confirm")}
        description={
          <>
            {t("remove.confirmPrefix")} <strong className="mono">{removeTarget?.repoTags[0] ?? shortId(removeTarget?.id)}</strong>
            {t("remove.confirmSuffix")} {t("remove.warning")}
          </>
        }
        onConfirm={doRemove}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}
