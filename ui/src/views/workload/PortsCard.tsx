import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ActionButton } from "../../components/ActionButton";
import { IconPlus, IconTrash } from "../../components/icons";
import { Modal } from "../../components/Modal";
import { SelectField, TextField } from "../../components/Field";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/api";
import type { Capability, Port, WorkloadDetail } from "../../lib/types";
import { toast, toastError } from "../../lib/toast";
import { useT } from "../../i18n";
import { wlOverviewTabDict } from "../../i18n/locales/wlOverviewTab";
import { commonDict } from "../../i18n/locales/common";

interface Props {
  hostId: string;
  detail: WorkloadDetail;
  caps: Capability[] | undefined;
}

export function PortsCard({ hostId, detail, caps }: Props) {
  const t = useT(wlOverviewTabDict);
  const tc = useT(commonDict);
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ports, setPorts] = useState<Port[]>([]);

  const editable = caps?.includes("port-update") && can("docker.container.update");
  const beginEdit = () => {
    setPorts((detail.ports ?? []).map((port) => ({ ...port, hostIp: port.hostIp ?? "" })));
    setOpen(true);
  };
  const updatePort = (index: number, patch: Partial<Port>) =>
    setPorts((current) => current.map((port, i) => (i === index ? { ...port, ...patch } : port)));
  const removePort = (index: number) => setPorts((current) => current.filter((_, i) => i !== index));
  const addPort = () => setPorts((current) => [...current, { private: 80, public: 0, protocol: "tcp", hostIp: "" }]);

  const valid = ports.every((port) =>
    Number.isInteger(port.private) && port.private >= 1 && port.private <= 65535 &&
    Number.isInteger(port.public ?? 0) && (port.public ?? 0) >= 0 && (port.public ?? 0) <= 65535 &&
    ["tcp", "udp", "sctp"].includes(port.protocol),
  );

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.workloadPortsUpdate(hostId, detail.id, ports.map((port) => ({
        ...port,
        public: port.public || undefined,
        hostIp: port.hostIp?.trim() || undefined,
      })));
      setOpen(false);
      toast.success(t("toast.portsUpdated"), detail.name);
      await queryClient.invalidateQueries({ queryKey: ["workloads", hostId] });
      // Docker assigned a new container ID during the required recreate.
      navigate("/workloads");
    } catch (err) {
      toastError(t("toast.portsUpdateFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{t("card.ports")}</span>
        {editable ? (
          <ActionButton variant="ghost" size="sm" onClick={beginEdit} disabled={detail.protected} tooltip={detail.protected ? t("gate.protected") : undefined}>
            {t("action.editPorts")}
          </ActionButton>
        ) : null}
      </div>
      <div className="card-body">
        {detail.ports?.length ? (
          <div className="row-wrap">
            {detail.ports.map((port, i) => (
              <span key={`${port.private}/${port.protocol}/${port.hostIp ?? ""}/${port.public ?? 0}/${i}`} className="chip chip-mono">
                {port.hostIp ? `${port.hostIp}:` : ""}{port.public ? `${port.public} → ` : ""}{port.private}/{port.protocol}
              </span>
            ))}
          </div>
        ) : <span className="muted text-sm">{t("empty.ports")}</span>}
      </div>

      <Modal
        open={open}
        title={t("ports.title")}
        onClose={() => setOpen(false)}
        busy={busy}
        wide
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)} disabled={busy}>{tc("cancel")}</button>
            <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
              {t("ports.submit")}
            </ActionButton>
          </>
        }
      >
        <div className="col" style={{ gap: "var(--sp-4)" }}>
          <div className="port-editor-warning" role="note">
            <span className="port-editor-warning-icon" aria-hidden="true">!</span>
            <span>{t("ports.recreateWarning")}</span>
          </div>
          {ports.map((port, index) => (
            <div key={index} className="port-editor-row">
              <TextField
                type="number" min={0} max={65535} label={t("ports.hostPort")}
                hint={t("ports.ephemeralHint")}
                value={port.public || ""} onChange={(e) => updatePort(index, { public: Number(e.target.value) })}
                style={{ minWidth: 0 }}
              />
              <TextField
                type="number" min={1} max={65535} label={t("ports.containerPort")}
                value={port.private || ""} onChange={(e) => updatePort(index, { private: Number(e.target.value) })}
                style={{ minWidth: 0 }}
              />
              <SelectField label={t("ports.protocol")} value={port.protocol} onChange={(e) => updatePort(index, { protocol: e.target.value })} style={{ minWidth: 0 }}>
                <option value="tcp">TCP</option><option value="udp">UDP</option><option value="sctp">SCTP</option>
              </SelectField>
              <TextField
                label={t("ports.hostIp")} placeholder="0.0.0.0" value={port.hostIp ?? ""}
                onChange={(e) => updatePort(index, { hostIp: e.target.value })} style={{ minWidth: 0 }}
              />
              <button className="port-editor-remove" type="button" onClick={() => removePort(index)} aria-label={t("ports.remove")} title={t("ports.remove")}>
                <IconTrash size={16} />
              </button>
            </div>
          ))}
          <div>
            <button className="port-editor-add" type="button" onClick={addPort}>
              <IconPlus size={15} />{t("ports.add")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
