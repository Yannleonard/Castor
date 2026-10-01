// Castor by IT Leonard
// ui/src/views/marketplace/DeployTemplateModal.tsx
//
// Guided one-click deploy for a marketplace template. Seeds the container name
// from the slug and the ports / env / volume rows from the template defaults,
// lets the operator tweak them and attach the container to existing host
// networks (static IPv4 / aliases), validates required env and addresses, then
// POSTs /hosts/{hostID}/templates/deploy and routes to /workloads on success.

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
import { useNetworks } from "../../lib/hooks";
import { useT, t as tr } from "../../i18n";
import { mktDeployTemplateDict } from "../../i18n/locales/mktDeployTemplate";
import type { DeployNetworkAttach, DeployPortMap, DeployVolMount, DockerNetwork, Template } from "../../lib/types";
import { TemplateLogo } from "./TemplateLogo";
import {
  EnvRowsEditor,
  NetRowsEditor,
  PortRowsEditor,
  VolRowsEditor,
  isIPv4,
  type EnvRow,
  type NetRow,
  type PortRow,
  type VolRow,
} from "./RowEditors";

const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

// Networks a container cannot join alongside others: "host" shares the host
// stack and "none" (driver "null") has no stack at all.
const UNATTACHABLE_NETWORKS = new Set(["host", "none"]);
const EMPTY_NETWORKS: DockerNetwork[] = [];

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
  // Network attachments start empty: no row means the default bridge.
  const [netRows, setNetRows] = useState<NetRow[]>([]);
  const [allowHostMounts, setAllowHostMounts] = useState(false);
  const [busy, setBusy] = useState(false);

  const t = useT(mktDeployTemplateDict);
  const { can } = useAuth();
  const isSuperuser = can("*");

  const networksQ = useNetworks(hostId);
  const hostNetworks = networksQ.data ?? EMPTY_NETWORKS;
  // Selectable networks: drop host/none (by name and by driver) and sort so
  // the list stays stable across polls.
  const attachableNetworks = useMemo(
    () =>
      hostNetworks
        .filter((n) => !UNATTACHABLE_NETWORKS.has(n.name) && n.driver !== "host" && n.driver !== "null")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [hostNetworks],
  );

  const nameOk = name.trim() === "" || CONTAINER_NAME_RE.test(name.trim());
  const missingRequired = useMemo(
    () => env.filter((e) => e.required && e.value.trim() === "").map((e) => e.key),
    [env],
  );
  // Static addresses are checked client-side for shape only; the daemon still
  // rejects one outside the subnet or on the default bridge.
  const badIPv4 = useMemo(
    () => netRows.map((r) => r.ipv4.trim()).filter((ip) => ip !== "" && !isIPv4(ip)),
    [netRows],
  );
  // The editor hides other rows' picks, but a stale list can still collide.
  const duplicateNetworks = useMemo(() => {
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const r of netRows) {
      const n = r.name.trim();
      if (n === "") continue;
      if (seen.has(n)) dups.add(n);
      seen.add(n);
    }
    return [...dups];
  }, [netRows]);

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

  const valid =
    nameOk &&
    missingRequired.length === 0 &&
    !hostBindBlocksSubmit &&
    badIPv4.length === 0 &&
    duplicateNetworks.length === 0;

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
      // Rows without a network are dropped; blank ipv4/aliases are omitted so
      // the server only sees what the operator set.
      const netAttach: DeployNetworkAttach[] = netRows
        .filter((r) => r.name.trim() !== "")
        .map((r) => {
          const ipv4 = r.ipv4.trim();
          const aliases = r.aliases
            .split(",")
            .map((a) => a.trim())
            .filter((a) => a !== "");
          return {
            name: r.name.trim(),
            ...(ipv4 ? { ipv4 } : {}),
            ...(aliases.length ? { aliases } : {}),
          };
        });
      const rsc = resourcesFromDraft(resources);

      const res = await api.templateDeploy(hostId, {
        templateSlug: template.slug,
        name: name.trim() || undefined,
        ports: portMaps,
        env: envMap,
        volumes: volMounts,
        // Only sent when a network was attached; omitted => default bridge.
        networks: netAttach.length ? netAttach : undefined,
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
      toast.success(
        tr(mktDeployTemplateDict, "toast.deployingTitle"),
        tr(mktDeployTemplateDict, "toast.deployingBody", {
          name: res.name || template.name,
          image: res.image,
        }),
      );
      onDeployed();
    } catch (err) {
      toastError(tr(mktDeployTemplateDict, "toast.failedTitle"), err);
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
            <span>{t("title.deploy", { name: template.name })}</span>
            <span className="text-xs muted mono">{template.image}</span>
          </span>
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("action.cancel")}
          </button>
          <ActionButton
            variant="primary"
            loading={busy}
            disabled={!valid}
            tooltip={
              !nameOk
                ? t("tooltip.invalidName")
                : missingRequired.length
                  ? t("tooltip.fillRequired", { fields: missingRequired.join(", ") })
                  : blockedBinds.length
                    ? t("tooltip.removeProtected")
                    : optInBinds.length && !isSuperuser
                      ? t("tooltip.needAdmin")
                      : optInBinds.length && !allowHostMounts
                        ? t("tooltip.tickAllow")
                        : badIPv4.length
                          ? t("tooltip.fixIPv4")
                          : duplicateNetworks.length
                            ? t("tooltip.dedupeNetworks")
                            : undefined
            }
            onClick={submit}
          >
            {t("action.deploy")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-5)" }}>
        <TextField
          label={t("form.nameLabel")}
          mono
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={!nameOk ? t("form.nameError") : undefined}
          hint={nameOk ? t("form.nameHint") : undefined}
        />

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="mkt-section-label">{t("section.ports")}</span>
          <PortRowsEditor rows={ports} onChange={setPorts} />
          <span className="field-hint">{t("hint.ports")}</span>
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="mkt-section-label">{t("section.env")}</span>
          <EnvRowsEditor rows={env} onChange={setEnv} />
          {missingRequired.length ? (
            <span className="field-error">{t("form.envRequiredError", { fields: missingRequired.join(", ") })}</span>
          ) : (
            <span className="field-hint">{t("hint.envMasked")}</span>
          )}
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="mkt-section-label">{t("section.volumes")}</span>
          <VolRowsEditor rows={volumes} onChange={setVolumes} />
          <span className="field-hint">{t("hint.volumes")}</span>

          {/* Host-bind security UX (mirrors the server policy). */}
          {blockedBinds.length > 0 ? (
            <div className="banner danger" style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start" }}>
              <IconAlert size={16} />
              <span>
                <strong>{t("banner.protectedTitle")}</strong> {t("banner.protectedBefore")}{" "}
                {blockedBinds.map((v, i) => (
                  <span key={i}>
                    {i > 0 ? ", " : ""}
                    <span className="mono">{v.source}</span>
                  </span>
                ))}{" "}
                {t("banner.protectedAfter")}
              </span>
            </div>
          ) : optInBinds.length > 0 ? (
            !isSuperuser ? (
              <div className="banner danger" style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start" }}>
                <IconAlert size={16} />
                <span>
                  {t("banner.nonAdminBefore")}
                  {optInBinds.map((v, i) => (
                    <span key={i}>
                      {i > 0 ? ", " : ""}
                      <span className="mono">{v.source}</span>
                    </span>
                  ))}
                  {t("banner.nonAdminMiddle")} <span className="mono">403 forbidden</span>
                  {t("banner.nonAdminAfter")}
                </span>
              </div>
            ) : (
              <div
                className="card-pad col"
                style={{ gap: "var(--sp-2)", border: "1px solid var(--warning)", borderRadius: "var(--radius-sm, 8px)" }}
              >
                <div className="row" style={{ gap: "var(--sp-2)", color: "var(--warning)", fontWeight: 600 }}>
                  <IconLock size={15} />
                  {t("banner.adminTitle")}
                </div>
                <span className="text-xs secondary">
                  {t("banner.adminBody", { paths: optInBinds.map((v) => v.source).join(", ") })}
                </span>
                <label className="checkbox-row">
                  <input type="checkbox" checked={allowHostMounts} onChange={(e) => setAllowHostMounts(e.target.checked)} />
                  <span>{t("banner.adminCheckbox")}</span>
                </label>
              </div>
            )
          ) : null}
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="mkt-section-label">{t("section.networks")}</span>
          <NetRowsEditor
            rows={netRows}
            onChange={setNetRows}
            networks={attachableNetworks}
            loading={networksQ.isLoading}
          />
          {badIPv4.length ? (
            <span className="field-error">{t("form.networksIPv4Error", { values: badIPv4.join(", ") })}</span>
          ) : duplicateNetworks.length ? (
            <span className="field-error">
              {t("form.networksDuplicateError", { names: duplicateNetworks.join(", ") })}
            </span>
          ) : (
            <span className="field-hint">{t("hint.networks")}</span>
          )}
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="mkt-section-label">{t("section.resources")}</span>
          <DockerSwarmResourceFields draft={resources} onChange={setResources} />
        </div>
      </div>
    </Modal>
  );
}
