// ui/src/views/networks/CreateNetworkModal.tsx
//
// Create-network form: name, driver (macvlan/ipvlan only offered to a
// superuser, with the mandatory parent interface), the internal / attachable
// / IPv6 flags, a collapsible IPAM section (subnet, gateway, range, auxiliary
// addresses per pool) and a collapsible advanced section (driver options).
// Every field is validated live against the backend rules (./validate.ts) and
// the submit stays disabled until the draft is valid; backend refusals surface
// through toastError (localized by error code).

import { useMemo, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Modal } from "../../components/Modal";
import { ActionButton } from "../../components/ActionButton";
import { TextField, SelectField } from "../../components/Field";
import { IconChevronDown, IconLock, IconPlus, IconTrash } from "../../components/icons";
import { toast, toastError } from "../../lib/toast";
import { useT, t as tr } from "../../i18n";
import { networksDict } from "../../i18n/locales/networks";
import { commonDict } from "../../i18n/locales/common";
import type { DockerNetworkInfo } from "../../lib/types";
import { KeyValueRows } from "./KeyValueRows";
import {
  NETWORK_DRIVERS,
  buildCreateRequest,
  emptyCreateDraft,
  emptyPool,
  isL2Driver,
  subnetFamily,
  validateCreateDraft,
  type CreateNetworkDraft,
  type IPAMPoolDraft,
  type PoolErrors,
} from "./validate";

interface Props {
  hostId: string;
  onClose: () => void;
  onCreated: (info: DockerNetworkInfo) => void;
}

export function CreateNetworkModal({ hostId, onClose, onCreated }: Props) {
  const t = useT(networksDict);
  const tc = useT(commonDict);
  const { can } = useAuth();
  const isSuperuser = can("*");

  const [draft, setDraft] = useState<CreateNetworkDraft>(emptyCreateDraft);
  const [ipamOpen, setIpamOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const errors = useMemo(() => validateCreateDraft(draft, { isSuperuser }), [draft, isSuperuser]);
  const describe = (code: string) => t(`validation.${code}`);

  const drivers = isSuperuser ? NETWORK_DRIVERS : NETWORK_DRIVERS.filter((d) => !isL2Driver(d));
  const l2 = isL2Driver(draft.driver);

  const patch = (p: Partial<CreateNetworkDraft>) => setDraft((d) => ({ ...d, ...p }));
  const patchPool = (i: number, p: Partial<IPAMPoolDraft>) =>
    setDraft((d) => ({ ...d, pools: d.pools.map((pool, idx) => (idx === i ? { ...pool, ...p } : pool)) }));
  const removePool = (i: number) => setDraft((d) => ({ ...d, pools: d.pools.filter((_, idx) => idx !== i) }));
  const addPool = () => setDraft((d) => ({ ...d, pools: [...d.pools, emptyPool()] }));

  const configuredPools = draft.pools.filter((p) => p.subnet.trim() !== "").length;

  const submit = async () => {
    if (!errors.valid || busy) return;
    setBusy(true);
    try {
      const info = await api.networkCreate(hostId, buildCreateRequest(draft));
      const subnets = info.subnets?.length ? ` (${info.subnets.join(", ")})` : "";
      toast.success(tr(networksDict, "toast.createdTitle"), `${info.name}${subnets}`);
      onCreated(info);
    } catch (err) {
      toastError(tr(networksDict, "toast.createFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  // Required-field errors stay hidden while the field is still pristine and
  // empty: the disabled submit already says the form is incomplete.
  const nameError = errors.name && (errors.name !== "name.required" || draft.name !== "") ? describe(errors.name) : undefined;
  const parentError = errors.parent && (errors.parent !== "parent.required" || draft.parent !== "") ? describe(errors.parent) : undefined;

  return (
    <Modal
      open
      wide
      busy={busy}
      title={t("form.title")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {tc("cancel")}
          </button>
          <ActionButton
            variant="primary"
            loading={busy}
            disabled={!errors.valid}
            tooltip={errors.valid ? undefined : t("form.fixErrors")}
            onClick={submit}
          >
            {t("form.create")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <TextField
          label={t("form.name")}
          mono
          autoFocus
          placeholder={t("form.namePlaceholder")}
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          error={nameError}
        />

        <SelectField
          label={t("form.driver")}
          value={draft.driver}
          onChange={(e) => patch({ driver: e.target.value })}
          hint={t(`form.driverHint.${draft.driver}`)}
          error={errors.driver ? describe(errors.driver) : undefined}
        >
          {drivers.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>

        {l2 ? (
          <div className="col" style={{ gap: "var(--sp-2)" }}>
            <TextField
              label={t("form.parent")}
              mono
              placeholder={t("form.parentPlaceholder")}
              value={draft.parent}
              onChange={(e) => patch({ parent: e.target.value })}
              error={parentError}
            />
            <div className="banner warning" style={{ alignItems: "flex-start" }}>
              <IconLock size={15} style={{ flex: "0 0 auto", marginTop: 2 }} />
              <span className="text-xs">{t("form.parentHint")}</span>
            </div>
          </div>
        ) : null}

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.internal} onChange={(e) => patch({ internal: e.target.checked })} />
            <span>{t("form.internal")}</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.attachable} onChange={(e) => patch({ attachable: e.target.checked })} />
            <span>{t("form.attachable")}</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.enableIPv6} onChange={(e) => patch({ enableIPv6: e.target.checked })} />
            <span>{t("form.enableIPv6")}</span>
          </label>
        </div>

        <Disclosure
          title={t("form.ipamTitle")}
          summary={configuredPools > 0 ? t("form.ipamSummary", { count: configuredPools }) : t("form.ipamAuto")}
          open={ipamOpen}
          onToggle={() => setIpamOpen((v) => !v)}
        >
          <span className="field-hint">{t("form.ipamHint")}</span>
          {draft.pools.map((pool, i) => (
            <PoolEditor
              key={i}
              index={i}
              pool={pool}
              errors={errors.pools[i]}
              enableIPv6={draft.enableIPv6}
              describe={describe}
              onChange={(p) => patchPool(i, p)}
              onRemove={() => removePool(i)}
            />
          ))}
          <button type="button" className="btn btn-sm" onClick={addPool} style={{ alignSelf: "flex-start" }}>
            <IconPlus size={13} />
            {t("form.addPool")}
          </button>
        </Disclosure>

        <Disclosure
          title={t("form.advancedTitle")}
          summary={draft.options.filter((o) => o.key.trim() !== "").length > 0 ? t("form.optionsSummary", { count: draft.options.filter((o) => o.key.trim() !== "").length }) : undefined}
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((v) => !v)}
        >
          <div className="col" style={{ gap: "var(--sp-2)" }}>
            <span className="field-label">{t("form.optionsTitle")}</span>
            <span className="field-hint">{isSuperuser ? t("form.optionsHint") : `${t("form.optionsHint")} ${t("form.optionsHintParent")}`}</span>
          </div>
          <KeyValueRows
            rows={draft.options}
            onChange={(options) => patch({ options })}
            errors={errors.options}
            describe={describe}
            keyLabel={t("form.optionKeyLabel")}
            valueLabel={t("form.optionValueLabel")}
            keyPlaceholder={t("form.optionKeyPlaceholder")}
            valuePlaceholder={t("form.optionValuePlaceholder")}
            addLabel={t("form.optionAdd")}
            removeLabel={t("form.optionRemove")}
          />
        </Disclosure>
      </div>
    </Modal>
  );
}

/* ---------------- IPAM pool ---------------- */

function PoolEditor({
  index,
  pool,
  errors,
  enableIPv6,
  describe,
  onChange,
  onRemove,
}: {
  index: number;
  pool: IPAMPoolDraft;
  errors: PoolErrors | undefined;
  enableIPv6: boolean;
  describe: (code: string) => string;
  onChange: (patch: Partial<IPAMPoolDraft>) => void;
  onRemove: () => void;
}) {
  const t = useT(networksDict);
  // An IPv6 pool on a network without the IPv6 flag is refused by the daemon;
  // the backend does not pre-check it, so this is a hint rather than an error.
  const ipv6Hint = !enableIPv6 && subnetFamily(pool.subnet) === 6 ? t("form.ipv6PoolHint") : undefined;

  return (
    <div className="col card-pad" style={{ gap: "var(--sp-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
      <div className="row">
        <span className="text-sm" style={{ fontWeight: 600 }}>
          {t("form.poolTitle", { n: index + 1 })}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          onClick={onRemove}
          aria-label={t("form.removePool")}
          title={t("form.removePool")}
          style={{ color: "var(--danger)" }}
        >
          <IconTrash size={14} />
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--sp-3)" }}>
        <TextField
          label={t("form.subnet")}
          mono
          placeholder={t("form.subnetPlaceholder")}
          value={pool.subnet}
          onChange={(e) => onChange({ subnet: e.target.value })}
          error={errors?.subnet ? describe(errors.subnet) : undefined}
          hint={ipv6Hint ? <span style={{ color: "var(--warning)" }}>{ipv6Hint}</span> : undefined}
        />
        <TextField
          label={t("form.gateway")}
          mono
          placeholder={t("form.gatewayPlaceholder")}
          value={pool.gateway}
          onChange={(e) => onChange({ gateway: e.target.value })}
          error={errors?.gateway ? describe(errors.gateway) : undefined}
        />
        <TextField
          label={t("form.ipRange")}
          mono
          placeholder={t("form.ipRangePlaceholder")}
          value={pool.ipRange}
          onChange={(e) => onChange({ ipRange: e.target.value })}
          error={errors?.ipRange ? describe(errors.ipRange) : undefined}
          hint={t("form.ipRangeHint")}
        />
      </div>
      <div className="col" style={{ gap: "var(--sp-2)" }}>
        <span className="field-label">{t("form.auxTitle")}</span>
        <span className="field-hint">{t("form.auxHint")}</span>
        <KeyValueRows
          rows={pool.aux}
          onChange={(aux) => onChange({ aux })}
          errors={errors?.aux}
          describe={describe}
          keyLabel={t("form.auxKeyLabel")}
          valueLabel={t("form.auxValueLabel")}
          keyPlaceholder={t("form.auxKeyPlaceholder")}
          valuePlaceholder={t("form.auxValuePlaceholder")}
          addLabel={t("form.auxAdd")}
          removeLabel={t("form.auxRemove")}
        />
      </div>
    </div>
  );
}

/* ---------------- Collapsible section ---------------- */

function Disclosure({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="card" style={{ boxShadow: "none" }}>
      <button
        type="button"
        className="card-header"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          borderBottom: open ? "1px solid var(--border)" : "none",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span className="card-title" style={{ fontSize: "var(--fs-sm)" }}>
          {title}
        </span>
        <span className="row" style={{ gap: "var(--sp-2)" }}>
          {summary ? <span className="text-xs muted">{summary}</span> : null}
          <IconChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 150ms" }} />
        </span>
      </button>
      {open ? (
        <div className="card-body col" style={{ gap: "var(--sp-4)" }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
