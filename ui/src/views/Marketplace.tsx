// ui/src/views/Marketplace.tsx
//
// The marketplace centerpiece: a searchable, category-filtered grid of app
// templates (built-in COLOR logos + operator-authored custom templates). Each
// card deploys to the selected Docker host in one click via a guided modal that
// edits ports / env / volumes before POST /hosts/{hostID}/templates/deploy.
//
// Custom templates (source:"custom") are operator-authored and editable/removable
// by admins holding marketplace.template.* — built-ins are read-only. Deploy is
// gated by docker.container.create (host-scoped).

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTemplates, useCapabilityLookup } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { PageHeader } from "../components/PageHeader";
import { LoadingFill } from "../components/Spinner";
import { EmptyState } from "../components/EmptyState";
import { ActionButton } from "../components/ActionButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import {
  IconMarketplace,
  IconSearch,
  IconRefresh,
  IconPlus,
  IconPlay,
  IconTrash,
} from "../components/icons";
import { toast, toastError } from "../lib/toast";
import type { Template } from "../lib/types";
import { DeployTemplateModal } from "./marketplace/DeployTemplateModal";
import { CustomTemplateModal } from "./marketplace/CustomTemplateModal";
import { TemplateLogo } from "./marketplace/TemplateLogo";

const EMPTY: Template[] = [];
const ALL = "__all__";

export function Marketplace() {
  const hostId = useSelectedHost();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { capsForKind } = useCapabilityLookup();
  const caps = capsForKind("docker");

  const query = useTemplates();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>(ALL);

  const [deployTarget, setDeployTarget] = useState<Template | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Template | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);

  // Deploy needs the provider's create capability AND the permission. The docker
  // provider exposes lifecycle caps; "start" is the closest proxy for "can run
  // containers" (there is no dedicated "create" capability token in V1).
  const canDeploy = !!caps && caps.includes("start") && can("docker.container.create");
  const deployReason = !caps?.includes("start")
    ? "This provider cannot create containers"
    : "Requires docker.container.create";

  const canCreate = can("marketplace.template.create");
  const canUpdate = can("marketplace.template.update");
  const canDelete = can("marketplace.template.delete");

  const templates = query.data ?? EMPTY;

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of templates) {
      const c = (t.category || "other").trim() || "other";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [templates]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (category !== ALL && (t.category || "other") !== category) return false;
      if (!s) return true;
      return (
        t.name.toLowerCase().includes(s) ||
        t.description.toLowerCase().includes(s) ||
        t.image.toLowerCase().includes(s)
      );
    });
  }, [templates, search, category]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["templates"] });

  return (
    <div className="page">
      <PageHeader
        title="Marketplace"
        subtitle="Deploy curated app templates to your host in one click, or publish your own."
        actions={
          <div className="row">
            <ActionButton
              variant="primary"
              disabled={!canCreate}
              tooltip={canCreate ? undefined : "Requires marketplace.template.create (admin)"}
              onClick={() => setCreateOpen(true)}
            >
              <IconPlus size={15} />
              Add template
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={() => query.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      {/* search + category filter pills */}
      <div className="card card-pad col" style={{ gap: "var(--sp-4)" }}>
        <div className="row">
          <span className="muted">
            <IconSearch size={16} />
          </span>
          <input
            className="input"
            placeholder="Search by name, description or image…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 420 }}
          />
          <span className="spacer" />
          <span className="text-sm muted">
            {filtered.length} of {templates.length}
          </span>
        </div>
        <div className="mkt-filters">
          <button
            className={`mkt-pill${category === ALL ? " active" : ""}`}
            onClick={() => setCategory(ALL)}
            type="button"
          >
            All <span className="mkt-pill-count">{templates.length}</span>
          </button>
          {categories.map(([cat, count]) => (
            <button
              key={cat}
              className={`mkt-pill${category === cat ? " active" : ""}`}
              onClick={() => setCategory(cat)}
              type="button"
            >
              {cat} <span className="mkt-pill-count">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label="Loading templates…" />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconMarketplace size={40} />}
            title={templates.length === 0 ? "No templates" : "No matching templates"}
            message={
              templates.length === 0
                ? "The catalog is empty. Add a custom template to get started."
                : "Try a different search term or category."
            }
          />
        </div>
      ) : (
        <div className="mkt-grid">
          {filtered.map((t) => (
            <TemplateCard
              key={`${t.source}:${t.slug}:${t.id}`}
              t={t}
              canDeploy={canDeploy}
              deployReason={deployReason}
              canEdit={t.source === "custom" && canUpdate}
              canRemove={t.source === "custom" && canDelete}
              onDeploy={() => setDeployTarget(t)}
              onEdit={() => setEditTarget(t)}
              onDelete={() => setDeleteTarget(t)}
            />
          ))}
        </div>
      )}

      {deployTarget ? (
        <DeployTemplateModal
          template={deployTarget}
          hostId={hostId}
          onClose={() => setDeployTarget(null)}
          onDeployed={() => {
            setDeployTarget(null);
            navigate("/workloads");
          }}
        />
      ) : null}

      {createOpen ? (
        <CustomTemplateModal mode="create" onClose={() => setCreateOpen(false)} onDone={invalidate} />
      ) : null}

      {editTarget ? (
        <CustomTemplateModal
          mode="edit"
          template={editTarget}
          onClose={() => setEditTarget(null)}
          onDone={invalidate}
        />
      ) : null}

      <ConfirmDestructiveDialog
        open={!!deleteTarget}
        title="Delete template"
        variant="danger"
        confirmLabel="Delete"
        description={
          <>
            Delete the custom template <strong>{deleteTarget?.name}</strong>? Containers already deployed from it are
            not affected.
          </>
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.templateDelete(deleteTarget.id);
            toast.success("Template deleted", deleteTarget.name);
            invalidate();
          } catch (err) {
            toastError("Delete failed", err);
            throw err;
          }
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

interface CardProps {
  t: Template;
  canDeploy: boolean;
  deployReason: string;
  canEdit: boolean;
  canRemove: boolean;
  onDeploy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function TemplateCard({ t, canDeploy, deployReason, canEdit, canRemove, onDeploy, onEdit, onDelete }: CardProps) {
  return (
    <div className="mkt-card">
      <div className="mkt-card-head">
        <TemplateLogo name={t.name} logo={t.logo} />
        <div className="col" style={{ gap: 4, minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 6, justifyContent: "space-between" }}>
            <span className="mkt-card-title truncate" title={t.name}>
              {t.name}
            </span>
            {t.source === "custom" ? (
              <span className="pill" style={{ color: "var(--warm)", background: "rgba(139,94,60,0.16)" }}>
                custom
              </span>
            ) : null}
          </div>
          <span className="chip text-xs" style={{ textTransform: "capitalize", alignSelf: "flex-start" }}>
            {t.category || "other"}
          </span>
        </div>
      </div>

      <p className="mkt-card-desc">{t.description || "No description provided."}</p>

      <div className="mkt-card-foot">
        <span className="mkt-card-image mono" title={t.image}>
          {t.image}
        </span>
        <span className="row" style={{ gap: 4 }}>
          {canEdit ? (
            <ActionButton size="sm" variant="ghost" tooltip="Edit template" onClick={onEdit}>
              Edit
            </ActionButton>
          ) : null}
          {canRemove ? (
            <ActionButton
              size="sm"
              variant="ghost"
              iconOnly
              aria-label="Delete template"
              tooltip="Delete template"
              onClick={onDelete}
              style={{ color: "var(--danger)" }}
            >
              <IconTrash size={14} />
            </ActionButton>
          ) : null}
          <CapabilityGate allowed={canDeploy} reason={deployReason}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                variant="primary"
                disabled={!allowed}
                tooltip={allowed ? "Deploy to host" : reason}
                onClick={onDeploy}
              >
                <IconPlay size={13} />
                Deploy
              </ActionButton>
            )}
          </CapabilityGate>
        </span>
      </div>
    </div>
  );
}
