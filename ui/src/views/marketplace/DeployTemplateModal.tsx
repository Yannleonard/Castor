// ui/src/views/marketplace/DeployTemplateModal.tsx
//
// Guided one-click deploy for a marketplace template. Seeds the container name
// from the slug and the ports / env / volume rows from the template defaults,
// lets the operator tweak them, validates required env, then POSTs
// /hosts/{hostID}/templates/deploy and routes to /workloads on success.

import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { isHostBindSource, isAlwaysBlockedHostPath } from "../../lib/mounts";
import { Modal } from "../../components/Modal";
import { ActionButton } from "../../components/ActionButton";
import { TextField } from "../../components/Field";
import { IconAlert, IconLock } from "../../components/icons";
import {
  DockerSwarmResourceFields,
  draftFromResources,
  resourcesFromDraft,
  type DockerSwarmResourcesDraft,
} from "../../components/ResourceFields";
import { toast, toastError } from "../../lib/toast";
import type { DeployPortMap, DeployVolMount, Template } from "../../lib/types";
import { TemplateLogo } from "./TemplateLogo";
import {
  EnvRowsEditor,
  PortRowsEditor,
  VolRowsEditor,
  type EnvRow,
  type PortRow,
  type VolRow,
} from "./RowEditors";

const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

interface Props {
  template: Template;
  hostId: string;
  onClose: () => void;
  onDeployed: () => void;
}

export function DeployTemplateModal({ template, hostId, onClose, onDeployed }: Props) {
  const [name, setName] = useState(template.slug);
  const [ports, setPorts] = useState<PortRow[]>(() =>
    template.ports.map((p) => ({ host: String(p), container: String(p), proto: "tcp" })),
  );
  const [env, setEnv] = useState<EnvRow[]>(() =>
    template.env.map((e) => ({ key: e.key, value: e.value, required: e.required })),
  );
  const [volumes, setVolumes] = useState<VolRow[]>(() =>
    template.volumes.map((v) => ({ source: "", target: v })),
  );
  const [resources, setResources] = useState<DockerSwarmResourcesDraft>(() =>
    draftFromResources(undefined),
  );
  const [allowHostMounts, setAllowHostMounts] = useState(false);
  const [busy, setBusy] = useState(false);

  const { can } = useAuth();
  const isSuperuser = can("*");

  const nameOk = name.trim() === "" || CONTAINER_NAME_RE.test(name.trim());
  const missingRequired = useMemo(
    () => env.filter((e) => e.required && e.value.trim() === "").map((e) => e.key),
    [env],
  );

  // Classify the volume sources into host binds (root-equivalent) so we can warn
  // before submit. The backend is the enforcer; this mirrors its policy for UX.
  const hostBinds = useMemo(
    () => volumes.filter((v) => v.target.trim() !== "" && isHostBindSource(v.source)),
    [volumes],
  );
  const blockedBinds = useMemo(() => hostBinds.filter((v) => isAlwaysBlockedHostPath(v.source)), [hostBinds]);
  // Ordinary host binds (not the always-blocked set): an admin may opt in.
  const optInBinds = useMemo(() => hostBinds.filter((v) => !isAlwaysBlockedHostPath(v.source)), [hostBinds]);

  // A blocked path is rejected for everyone. An ordinary host bind needs the
  // admin opt-in; a non-admin can never deploy one through the marketplace.
  const hostBindBlocksSubmit =
    blockedBinds.length > 0 ||
    (optInBinds.length > 0 && (!isSuperuser || !allowHostMounts));

  const valid = nameOk && missingRequired.length === 0 && !hostBindBlocksSubmit;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const portMaps: DeployPortMap[] = ports
        .filter((p) => p.container.trim() !== "")
        .map((p) => ({
          host: p.host.trim() === "" ? 0 : Number(p.host),
          container: Number(p.container),
          proto: p.proto || "tcp",
        }));
      const envMap: Record<string, string> = {};
      for (const e of env) {
        const k = e.key.trim();
        if (k) envMap[k] = e.value;
      }
      const volMounts: DeployVolMount[] = volumes
        .filter((v) => v.target.trim() !== "")
        .map((v) => ({ source: v.source.trim(), target: v.target.trim() }));
      const rsc = resourcesFromDraft(resources);

      const res = await api.templateDeploy(hostId, {
        templateSlug: template.slug,
        name: name.trim() || undefined,
        ports: portMaps,
        env: envMap,
        volumes: volMounts,
        // Resource limits/reservations (0 => left unset server-side).
        cpuLimit: rsc.cpuLimit || undefined,
        memoryLimitBytes: rsc.memoryLimitBytes || undefined,
        cpuReservation: rsc.cpuReservation || undefined,
        memoryReservationBytes: rsc.memoryReservationBytes || undefined,
        // Admin-only opt-in for ordinary host binds. Only sent when a superuser
        // actually ticked the box AND a host bind is present; the backend still
        // rejects the always-blocked paths and non-admins regardless.
        allowHostMounts: isSuperuser && allowHostMounts && optInBinds.length > 0 ? true : undefined,
      });
      toast.success("Deploying", `${res.name || template.name} is starting from ${res.image}.`);
      onDeployed();
    } catch (err) {
      toastError("Deploy failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      busy={busy}
      title={
        <span className="row" style={{ gap: "var(--sp-3)" }}>
          <TemplateLogo name={template.name} logo={template.logo} />
          <span className="col" style={{ gap: 0 }}>
            <span>Deploy {template.name}</span>
            <span className="text-xs muted mono">{template.image}</span>
          </span>
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton
            variant="primary"
            loading={busy}
            disabled={!valid}
            tooltip={
              !nameOk
                ? "Invalid container name"
                : missingRequired.length
                  ? `Fill required: ${missingRequired.join(", ")}`
                  : blockedBinds.length
                    ? "Remove the protected host path mount to deploy"
                    : optInBinds.length && !isSuperuser
                      ? "Host path mounts require an administrator"
                      : optInBinds.length && !allowHostMounts
                        ? "Tick “Allow host path mounts” to deploy with a host bind"
                        : undefined
            }
            onClick={submit}
          >
            Deploy
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-5)" }}>
        <TextField
          label="Container name"
          mono
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={!nameOk ? "Use letters, digits, and _ . - (must start alphanumeric)." : undefined}
          hint={nameOk ? "Leave blank to let Docker assign a random name." : undefined}
        />

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="mkt-section-label">Port mappings</span>
          <PortRowsEditor rows={ports} onChange={setPorts} />
          <span className="field-hint">host : container — leave host blank to publish on a random port.</span>
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="mkt-section-label">Environment</span>
          <EnvRowsEditor rows={env} onChange={setEnv} />
          {missingRequired.length ? (
            <span className="field-error">Required variables need a value: {missingRequired.join(", ")}.</span>
          ) : (
            <span className="field-hint">Values for KEY/TOKEN/SECRET/PASSWORD names are masked.</span>
          )}
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="mkt-section-label">Volumes</span>
          <VolRowsEditor rows={volumes} onChange={setVolumes} />
          <span className="field-hint">
            Source is a named volume (auto-created) or an absolute host path; target is the in-container path.
          </span>

          {/* Host-bind security UX (mirrors the server policy). */}
          {blockedBinds.length > 0 ? (
            <div className="banner danger" style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start" }}>
              <IconAlert size={16} />
              <span>
                <strong>Protected host path.</strong> Mounting{" "}
                {blockedBinds.map((v, i) => (
                  <span key={i}>
                    {i > 0 ? ", " : ""}
                    <span className="mono">{v.source}</span>
                  </span>
                ))}{" "}
                is never allowed — it would grant the container control of the host. Remove it to deploy.
              </span>
            </div>
          ) : optInBinds.length > 0 ? (
            !isSuperuser ? (
              <div className="banner danger" style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start" }}>
                <IconAlert size={16} />
                <span>
                  This deploy uses a host path mount (
                  {optInBinds.map((v, i) => (
                    <span key={i}>
                      {i > 0 ? ", " : ""}
                      <span className="mono">{v.source}</span>
                    </span>
                  ))}
                  ). Host binds are root-equivalent, so only an administrator may use them — the server will reject this
                  with a <span className="mono">403 forbidden</span>. Use a named volume instead.
                </span>
              </div>
            ) : (
              <div
                className="card-pad col"
                style={{ gap: "var(--sp-2)", border: "1px solid var(--warning)", borderRadius: "var(--radius-sm, 8px)" }}
              >
                <div className="row" style={{ gap: "var(--sp-2)", color: "var(--warning)", fontWeight: 600 }}>
                  <IconLock size={15} />
                  Host path mount detected
                </div>
                <span className="text-xs secondary">
                  Binding a host path ({optInBinds.map((v) => v.source).join(", ")}) gives the container access to the
                  host filesystem. As an administrator you may opt in; protected paths (docker.sock, /, /etc, …) stay
                  blocked regardless.
                </span>
                <label className="checkbox-row">
                  <input type="checkbox" checked={allowHostMounts} onChange={(e) => setAllowHostMounts(e.target.checked)} />
                  <span>Allow host path mounts for this deploy</span>
                </label>
              </div>
            )
          ) : null}
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="mkt-section-label">Resources</span>
          <DockerSwarmResourceFields draft={resources} onChange={setResources} />
        </div>
      </div>
    </Modal>
  );
}
