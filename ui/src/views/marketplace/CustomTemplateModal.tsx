// ui/src/views/marketplace/CustomTemplateModal.tsx
//
// Admin editor for operator-authored (custom) marketplace templates. Create
// (POST /templates) or edit (PUT /templates/{id}) a template's metadata plus its
// default ports / env (with a "required" toggle) / volumes. Built-in templates
// are never editable here — only source:"custom" entries reach the edit path.

import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { Modal } from "../../components/Modal";
import { ActionButton } from "../../components/ActionButton";
import { TextField, TextAreaField } from "../../components/Field";
import { toast, toastError } from "../../lib/toast";
import type { Template, TemplateWriteRequest } from "../../lib/types";
import {
  EnvRowsEditor,
  PortRowsEditor,
  VolRowsEditor,
  type EnvRow,
  type PortRow,
  type VolRow,
} from "./RowEditors";

// Loosely mirrors docker.ValidImageRef on the server (re-validated there).
const IMAGE_REF_RE =
  /^[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*(:[\w][\w.-]{0,127})?(@sha256:[a-f0-9]{64})?$/i;

// Mirror of the server's normalizeSlug: lowercase, keep [a-z0-9-], collapse runs.
function normalizeSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface Props {
  mode: "create" | "edit";
  template?: Template;
  onClose: () => void;
  onDone: () => void;
}

export function CustomTemplateModal({ mode, template, onClose, onDone }: Props) {
  const [name, setName] = useState(template?.name ?? "");
  const [slug, setSlug] = useState(template?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [category, setCategory] = useState(template?.category ?? "");
  const [image, setImage] = useState(template?.image ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [logoUrl, setLogoUrl] = useState(template?.logo ?? "");
  const [ports, setPorts] = useState<PortRow[]>(
    () => template?.ports.map((p) => ({ host: String(p), container: String(p), proto: "tcp" })) ?? [],
  );
  const [env, setEnv] = useState<EnvRow[]>(
    () => template?.env.map((e) => ({ key: e.key, value: e.value, required: e.required })) ?? [],
  );
  const [volumes, setVolumes] = useState<VolRow[]>(
    () => template?.volumes.map((v) => ({ source: "", target: v })) ?? [],
  );
  const [busy, setBusy] = useState(false);

  // Auto-derive the slug from the name until the user edits the slug directly.
  const onNameChange = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(normalizeSlug(v));
  };

  const effectiveSlug = normalizeSlug(slug);
  const imageOk = image.trim() !== "" && IMAGE_REF_RE.test(image.trim());
  const envKeysOk = env.every((e) => e.key.trim() !== "");
  const valid = name.trim() !== "" && effectiveSlug !== "" && imageOk && envKeysOk;

  const invalidHint = useMemo(() => {
    if (name.trim() === "") return "Name is required.";
    if (effectiveSlug === "") return "A valid slug is required.";
    if (!imageOk) return "A valid image reference is required.";
    if (!envKeysOk) return "Every environment row needs a key.";
    return undefined;
  }, [name, effectiveSlug, imageOk, envKeysOk]);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const body: TemplateWriteRequest = {
        name: name.trim(),
        slug: effectiveSlug,
        category: category.trim(),
        image: image.trim(),
        description: description.trim(),
        // Custom templates store only the container port; deploy publishes 1:1.
        ports: ports
          .filter((p) => p.container.trim() !== "")
          .map((p) => Number(p.container)),
        env: env
          .filter((e) => e.key.trim() !== "")
          .map((e) => ({ key: e.key.trim(), value: e.value, required: e.required })),
        volumes: volumes.filter((v) => v.target.trim() !== "").map((v) => v.target.trim()),
        logoUrl: logoUrl.trim(),
      };
      if (mode === "create") {
        await api.templateCreate(body);
        toast.success("Template created", body.name);
      } else if (template) {
        await api.templateUpdate(template.id, body);
        toast.success("Template updated", body.name);
      }
      onDone();
      onClose();
    } catch (err) {
      toastError(mode === "create" ? "Create failed" : "Update failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      busy={busy}
      title={mode === "create" ? "Add custom template" : `Edit ${template?.name ?? "template"}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} tooltip={invalidHint} onClick={submit}>
            {mode === "create" ? "Create" : "Save"}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-5)" }}>
        <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
          <div style={{ flex: "1 1 220px" }}>
            <TextField label="Name" autoFocus value={name} onChange={(e) => onNameChange(e.target.value)} />
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <TextField
              label="Slug"
              mono
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              error={slug && effectiveSlug === "" ? "Use a-z, 0-9, -" : undefined}
              hint={!slug || effectiveSlug === slug ? "Used for deploy + URLs." : `Stored as: ${effectiveSlug}`}
            />
          </div>
        </div>

        <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
          <div style={{ flex: "1 1 160px" }}>
            <TextField
              label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="database, web…"
            />
          </div>
          <div style={{ flex: "2 1 240px" }}>
            <TextField
              label="Image"
              mono
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="nginx:latest"
              error={image && !imageOk ? "Enter a valid image reference (e.g. registry/name:tag)." : undefined}
            />
          </div>
        </div>

        <TextAreaField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="One-line summary shown on the card."
        />

        <TextField
          label="Logo URL (optional)"
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          placeholder="/templates/logos/my-app.svg or https://…"
          hint="Leave blank to show an auto-generated initials tile."
        />

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="mkt-section-label">Default ports</span>
          <PortRowsEditor rows={ports} onChange={setPorts} />
          <span className="field-hint">Container ports published on deploy (host:container default 1:1).</span>
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="mkt-section-label">
            <span>Default environment</span>
            <span className="text-xs muted">required</span>
          </span>
          <EnvRowsEditor rows={env} onChange={setEnv} editableKeys showRequiredToggle />
          <span className="field-hint">Mark variables the operator must fill in before deploy.</span>
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="mkt-section-label">Default volumes</span>
          <VolRowsEditor rows={volumes} onChange={setVolumes} />
          <span className="field-hint">Only the container path is stored; deploy creates a named volume per path.</span>
        </div>
      </div>
    </Modal>
  );
}
