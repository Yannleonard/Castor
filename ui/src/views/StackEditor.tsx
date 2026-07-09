// ui/src/views/StackEditor.tsx
//
// Two-tab compose stack editor:
//   - YAML: a styled monospace textarea bound to the compose document. "Validate"
//     posts to /hosts/{hostID}/stacks/validate and renders either the validation
//     error or the normalized per-service summary + deploy order. "Deploy" posts
//     to /hosts/{hostID}/stacks {name, composeYaml}. The YAML tab is the single
//     source of truth for what gets deployed.
//   - Builder: a structured form (add/remove services with image, ports, env,
//     volumes, restart, dependsOn). "Generate YAML" posts the structured services
//     to /stacks/builder/generate and drops the result into the YAML tab.
//
// Route:
//   /stacks/new            -> create mode (editable name + compose, deploy enabled)
//   /stacks/:hostId/:id    -> view mode (loads the stored compose + live
//                             containers; deploy is disabled since the project
//                             name is unique and already deployed).

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStackDetail, qk } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { isHostBindSource, isAlwaysBlockedHostPath } from "../lib/mounts";
import { PageHeader } from "../components/PageHeader";
import { HelpButton } from "../components/HelpButton";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { Modal } from "../components/Modal";
import { TextField, SelectField } from "../components/Field";
import {
  IconStacks,
  IconPlus,
  IconTrash,
  IconCheck,
  IconAlert,
  IconLock,
  IconChevronDown,
  IconRefresh,
  IconInspect,
  IconCopy,
  IconExternal,
} from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { timeAgo } from "../lib/format";
import { useT, t as tr } from "../i18n";
import { stackEditorDict } from "../i18n/locales/stackEditor";
import type {
  BuilderEnv,
  BuilderPort,
  BuilderService,
  BuilderVolume,
  CreateStackRequest,
  StackCreateResponse,
  StackDiff,
  StackValidateResponse,
} from "../lib/types";

type Tab = "yaml" | "builder";

// Local form model for the GitOps "Deploy from Git" section (create mode).
interface GitForm {
  enabled: boolean;
  repoUrl: string;
  ref: string;
  path: string;
  token: string;
  autoDeploy: boolean;
}

function blankGit(): GitForm {
  return { enabled: false, repoUrl: "", ref: "main", path: "docker-compose.yml", token: "", autoDeploy: false };
}

// shortCommit abbreviates a full SHA to its first 7 chars for the badge/toast.
function shortCommit(sha: string): string {
  const s = sha.trim();
  return s.length > 7 ? s.slice(0, 7) : s;
}

const RESTART_OPTIONS = ["", "no", "always", "on-failure", "unless-stopped"] as const;

// Stack name: keep it simple and aligned with what the backend slugifies into a
// compose project name (letters, digits, separators).
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,62}$/;

// --- builder local form model (BuilderService with always-present arrays) ---

interface FormService {
  name: string;
  image: string;
  ports: BuilderPort[];
  env: BuilderEnv[];
  volumes: BuilderVolume[];
  restart: string;
  dependsOn: string; // comma/space separated; split on submit
}

function blankService(): FormService {
  return { name: "", image: "", ports: [], env: [], volumes: [], restart: "", dependsOn: "" };
}

function toBuilderServices(rows: FormService[]): BuilderService[] {
  return rows.map((r) => ({
    name: r.name.trim(),
    image: r.image.trim(),
    ports: r.ports
      .filter((p) => p.container > 0)
      .map((p) => ({ host: p.host || 0, container: p.container, proto: p.proto || "tcp" })),
    env: r.env.filter((e) => e.key.trim() !== "").map((e) => ({ key: e.key.trim(), value: e.value })),
    volumes: r.volumes
      .filter((v) => v.target.trim() !== "")
      .map((v) => ({ source: v.source.trim(), target: v.target.trim() })),
    restart: r.restart,
    dependsOn: r.dependsOn
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  }));
}

// composeVolumeSource extracts the SOURCE (left of the first ':') from a raw
// compose volume string, ignoring the leading drive letter on Windows paths
// ("C:\data:/x"). Returns "" for an anonymous volume ("/data" with no target is
// still a source). Used only to flag host binds for the deploy UX.
function composeVolumeSource(vol: string): string {
  const s = vol.trim();
  if (s === "") return "";
  // Windows drive path "C:\..." or "C:/..." — the first ':' is the drive sep.
  if (s.length >= 3 && /[a-zA-Z]/.test(s[0]!) && s[1] === ":" && (s[2] === "\\" || s[2] === "/")) {
    const rest = s.slice(2);
    const i = rest.indexOf(":");
    return s.slice(0, 2) + (i < 0 ? rest : rest.slice(0, i));
  }
  const i = s.indexOf(":");
  return i < 0 ? s : s.slice(0, i);
}

export function StackEditor() {
  const t = useT(stackEditorDict);
  const params = useParams<{ hostId?: string; id?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const selectedHost = useSelectedHost();
  const isSuperuser = can("*");

  // In view mode the route carries the host; in create mode use the global host.
  const routeHost = params.hostId ? decodeURIComponent(params.hostId) : "";
  const stackId = params.id ? decodeURIComponent(params.id) : "";
  const isView = !!stackId;
  const hostId = isView ? routeHost : selectedHost;

  const canDeploy = can("docker.container.create");

  const [tab, setTab] = useState<Tab>("yaml");
  const [name, setName] = useState("");
  const [yamlText, setYamlText] = useState("");

  const [validating, setValidating] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [validation, setValidation] = useState<StackValidateResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [allowHostMounts, setAllowHostMounts] = useState(false);

  // GitOps create form + the one-time webhook-secret reveal (see WebhookSecretModal).
  const [git, setGit] = useState<GitForm>(blankGit);
  const [webhookReveal, setWebhookReveal] = useState<StackCreateResponse | null>(null);

  const [services, setServices] = useState<FormService[]>([blankService()]);

  // Host-bind detection over the LAST validation result (raw compose volume
  // strings). Mirrors the server policy so we can warn + surface the admin opt-in
  // before deploy. Empty until the document is validated.
  const hostBinds = useMemo(() => {
    const out: string[] = [];
    for (const svc of validation?.services ?? []) {
      for (const vol of svc.volumes) {
        const src = composeVolumeSource(vol);
        if (isHostBindSource(src)) out.push(src);
      }
    }
    return out;
  }, [validation]);
  const blockedBinds = useMemo(() => hostBinds.filter((s) => isAlwaysBlockedHostPath(s)), [hostBinds]);
  const optInBinds = useMemo(() => hostBinds.filter((s) => !isAlwaysBlockedHostPath(s)), [hostBinds]);
  // A blocked path is rejected for everyone; an ordinary host bind needs the admin
  // opt-in. When the document has NOT been validated we don't block (the server
  // still enforces) — the warning only appears after a validate pass reveals binds.
  const hostBindBlocksDeploy =
    blockedBinds.length > 0 || (optInBinds.length > 0 && (!isSuperuser || !allowHostMounts));

  // Load an existing stack (view mode): seed the YAML from the stored document.
  const detailQuery = useStackDetail(hostId, stackId, { enabled: isView });
  const detail = detailQuery.data;
  useEffect(() => {
    if (detail) {
      setName(detail.name);
      setYamlText(detail.composeYaml);
    }
  }, [detail]);

  const nameOk = isView || (name.trim().length > 0 && NAME_RE.test(name.trim()));
  const yamlOk = yamlText.trim().length > 0;

  // GitOps (create mode): a repo URL enables the git-backed path. When set, the
  // compose is pulled from the repo on first sync, so an inline YAML document is
  // optional — the deploy source is the repo, not the textarea.
  const gitOn = !isView && git.enabled && git.repoUrl.trim().length > 0;
  const gitRepoUrl = git.repoUrl.trim();
  // A very light URL sanity check so we don't submit obvious garbage; the server
  // is the authority. Accept http(s):// and scp-like git@host:owner/repo forms.
  const gitUrlOk = !git.enabled || gitRepoUrl === "" || /^(https?:\/\/|git@|ssh:\/\/)/i.test(gitRepoUrl);
  // With git on, the YAML textarea is optional; otherwise it must be non-empty.
  const sourceOk = gitOn ? gitUrlOk : yamlOk;

  // Reset the validation panel whenever the document changes. The host-mount
  // opt-in is cleared too — it must be re-affirmed against a fresh validation.
  const resetValidation = () => {
    setValidation(null);
    setValidationError(null);
    setAllowHostMounts(false);
  };

  const doValidate = async () => {
    if (!yamlOk) return;
    setValidating(true);
    resetValidation();
    try {
      const res = await api.stackValidate(hostId, { composeYaml: yamlText });
      setValidation(res);
      toast.success(tr(stackEditorDict, "toast.composeValidTitle"), tr(stackEditorDict, "toast.composeValidBody", { count: res.serviceCount }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_failed") {
        setValidationError(err.message);
      } else {
        toastError(tr(stackEditorDict, "toast.validationFailed"), err);
      }
    } finally {
      setValidating(false);
    }
  };

  const doDeploy = async () => {
    if (!sourceOk || !nameOk || !canDeploy || hostBindBlocksDeploy) return;
    setDeploying(true);
    try {
      const body: CreateStackRequest = {
        name: name.trim(),
        composeYaml: yamlText,
        // Admin-only opt-in for ordinary host binds (only meaningful when a
        // superuser ticked the box and the validated doc has an opt-in bind). The
        // server still rejects always-blocked paths and non-admins regardless.
        allowHostMounts: isSuperuser && allowHostMounts && optInBinds.length > 0 ? true : undefined,
      };
      // GitOps: point the stack at a repo. The compose is pulled on first sync,
      // so an empty textarea is fine here. gitToken is a write-only PAT for a
      // private repo. When autoDeploy is on the create response carries the
      // one-time webhookSecret (revealed below).
      if (gitOn) {
        body.gitRepoUrl = gitRepoUrl;
        if (git.ref.trim()) body.gitRef = git.ref.trim();
        if (git.path.trim()) body.gitPath = git.path.trim();
        if (git.token.trim()) body.gitToken = git.token.trim();
        if (git.autoDeploy) body.autoDeploy = true;
      }
      const created = await api.stackCreate(hostId, body);
      queryClient.invalidateQueries({ queryKey: qk.stacks(hostId) });
      // If the server minted a redeploy webhook secret, reveal it once (the
      // stack list refresh already happened). Otherwise go straight back.
      if (created.webhookSecret) {
        toast.success(tr(stackEditorDict, "toast.stackCreatedTitle"), tr(stackEditorDict, "toast.stackCreatedSaveSecret", { name: created.name }));
        setWebhookReveal(created);
      } else {
        toast.success(
          gitOn ? tr(stackEditorDict, "toast.stackCreatedFromGitTitle") : tr(stackEditorDict, "toast.stackDeployedTitle"),
          tr(stackEditorDict, "toast.stackDeployedBody", { name: created.name, count: created.serviceCount }),
        );
        navigate("/stacks");
      }
    } catch (err) {
      // A 422 here means the document failed validation at deploy time; surface it
      // in the validation panel too so the operator sees exactly what's wrong. A
      // 403 forbidden is the host-mount policy denial — its message explains why.
      if (err instanceof ApiError && err.code === "validation_failed") {
        setValidationError(err.message);
      }
      toastError(tr(stackEditorDict, "toast.deployFailed"), err);
    } finally {
      setDeploying(false);
    }
  };

  const doGenerate = async () => {
    const built = toBuilderServices(services);
    if (built.length === 0 || built.some((s) => !s.name || !s.image)) {
      toast.warning(tr(stackEditorDict, "toast.incompleteTitle"), tr(stackEditorDict, "toast.incompleteBody"));
      return;
    }
    setGenerating(true);
    try {
      const project = (name.trim() || "stack").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
      const res = await api.stackBuilderGenerate({ projectName: project, services: built });
      setYamlText(res.yaml);
      resetValidation();
      setTab("yaml");
      toast.success(tr(stackEditorDict, "toast.yamlGeneratedTitle"), tr(stackEditorDict, "toast.yamlGeneratedBody"));
    } catch (err) {
      toastError(tr(stackEditorDict, "toast.generateFailed"), err);
    } finally {
      setGenerating(false);
    }
  };

  // ---- builder mutators ----
  const patchService = (i: number, patch: Partial<FormService>) =>
    setServices((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addService = () => setServices((prev) => [...prev, blankService()]);
  const removeService = (i: number) => setServices((prev) => prev.filter((_, idx) => idx !== i));

  // ---- GitOps view-mode actions (git-backed stacks only) ----
  const isGitStack = isView && !!detail?.gitRepoUrl;
  const [syncing, setSyncing] = useState(false);
  const [diffing, setDiffing] = useState(false);
  const [diff, setDiff] = useState<StackDiff | null>(null);

  const doSync = async () => {
    if (!isGitStack || syncing || !canDeploy) return;
    setSyncing(true);
    try {
      const updated = await api.stackSync(hostId, stackId);
      toast.success(
        tr(stackEditorDict, "toast.syncedTitle"),
        updated.lastSyncedCommit
          ? tr(stackEditorDict, "toast.syncedDeployed", { commit: shortCommit(updated.lastSyncedCommit), count: updated.serviceCount })
          : tr(stackEditorDict, "toast.syncedBody", { count: updated.serviceCount }),
      );
      // Refetch the detail (and the list) so the badge + YAML reflect the new commit.
      queryClient.invalidateQueries({ queryKey: qk.stack(hostId, stackId) });
      queryClient.invalidateQueries({ queryKey: qk.stacks(hostId) });
      setDiff(null); // a stale diff no longer reflects the deployed state
    } catch (err) {
      toastError(tr(stackEditorDict, "toast.syncFailed"), err);
    } finally {
      setSyncing(false);
    }
  };

  const doDiff = async () => {
    if (!isGitStack || diffing) return;
    setDiffing(true);
    try {
      const res = await api.stackDiff(hostId, stackId);
      setDiff(res);
    } catch (err) {
      toastError(tr(stackEditorDict, "toast.diffFailed"), err);
    } finally {
      setDiffing(false);
    }
  };

  if (isView && detailQuery.isLoading) {
    return <LoadingFill label={t("loading.stack")} />;
  }

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="row" style={{ gap: "var(--sp-3)" }}>
            <IconStacks size={20} />
            {isView ? detail?.name ?? t("header.stack") : t("header.deploy")}
          </span>
        }
        subtitle={
          isView ? (
            <span className="mono text-xs">{detail?.projectName}</span>
          ) : (
            t("header.subtitle")
          )
        }
        actions={
          <div className="row">
            <ActionButton variant="ghost" onClick={() => navigate("/stacks")}>
              {t("header.back")}
            </ActionButton>
            <HelpButton topic="stacks" />
          </div>
        }
      />

      <div className="tabs">
        <button className={`tab${tab === "yaml" ? " active" : ""}`} onClick={() => setTab("yaml")}>
          {t("tab.yaml")}
        </button>
        {!isView ? (
          <button className={`tab${tab === "builder" ? " active" : ""}`} onClick={() => setTab("builder")}>
            {t("tab.builder")}
          </button>
        ) : null}
      </div>

      {tab === "yaml" ? (
        <div className="col" style={{ gap: "var(--sp-4)" }}>
          {!isView ? (
            <div className="card card-pad">
              <TextField
                label={t("form.nameLabel")}
                placeholder={t("form.namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={name && !nameOk ? t("form.nameError") : undefined}
                hint={t("form.nameHint")}
                style={{ maxWidth: 360 }}
              />
            </div>
          ) : null}

          {/* Create mode: GitOps — deploy from a repository instead of pasting YAML. */}
          {!isView ? <GitSection git={git} onChange={setGit} urlOk={gitUrlOk} /> : null}

          {/* View mode: git-backed stack controls (sync / diff / last commit). */}
          {isGitStack && detail ? (
            <GitStackPanel
              detail={detail}
              canSync={canDeploy}
              syncing={syncing}
              diffing={diffing}
              diff={diff}
              onSync={doSync}
              onDiff={doDiff}
              onCloseDiff={() => setDiff(null)}
            />
          ) : null}

          <div className="card card-pad col" style={{ gap: "var(--sp-3)" }}>
            <div className="row">
              <span className="field-label" style={{ margin: 0 }}>
                {t("form.composeLabel")}
              </span>
              <span className="spacer" />
              {isView ? (
                <span className="text-xs muted">
                  {isGitStack ? t("form.composeReadonlyGit") : t("form.composeReadonly")}
                </span>
              ) : gitOn ? (
                <span className="text-xs muted">{t("form.composeOptionalGit")}</span>
              ) : null}
            </div>
            <textarea
              className="textarea input-mono"
              spellCheck={false}
              wrap="off"
              readOnly={isView}
              value={yamlText}
              onChange={(e) => {
                setYamlText(e.target.value);
                resetValidation();
              }}
              placeholder={"services:\n  web:\n    image: nginx:latest\n    ports:\n      - \"8080:80\""}
              style={{
                minHeight: 360,
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: "pre",
                tabSize: 2,
              }}
            />

            <div className="row">
              <ActionButton variant="default" loading={validating} disabled={!yamlOk} onClick={doValidate}>
                <IconCheck size={15} />
                {t("action.validate")}
              </ActionButton>
              <span className="spacer" />
              {!isView ? (
                <ActionButton
                  variant="primary"
                  loading={deploying}
                  disabled={!sourceOk || !nameOk || !canDeploy || hostBindBlocksDeploy}
                  tooltip={
                    !canDeploy
                      ? t("action.tooltipNeedCreate")
                      : git.enabled && !gitUrlOk
                        ? t("action.tooltipNeedUrl")
                        : gitOn && !nameOk
                          ? t("action.tooltipNeedName")
                          : blockedBinds.length
                            ? t("action.tooltipBlockedBind")
                            : optInBinds.length && !isSuperuser
                              ? t("action.tooltipBindAdmin")
                              : optInBinds.length && !allowHostMounts
                                ? t("action.tooltipBindOptIn")
                                : undefined
                  }
                  onClick={doDeploy}
                >
                  {gitOn ? t("action.createFromGit") : t("action.deploy")}
                </ActionButton>
              ) : null}
            </div>

            {validationError ? (
              <div
                className="card-pad"
                style={{
                  border: "1px solid var(--danger)",
                  borderRadius: "var(--radius-sm, 8px)",
                  background: "var(--danger-bg)",
                }}
              >
                <div className="row" style={{ gap: "var(--sp-2)", color: "var(--danger)", fontWeight: 600 }}>
                  <IconAlert size={16} />
                  {t("validation.invalidTitle")}
                </div>
                <pre className="mono text-xs" style={{ whiteSpace: "pre-wrap", margin: "var(--sp-2) 0 0" }}>
                  {validationError}
                </pre>
              </div>
            ) : null}

            {validation ? <ValidationSummary result={validation} /> : null}

            {/* Host-bind security UX (only after validation reveals the volumes). */}
            {!isView && blockedBinds.length > 0 ? (
              <div className="banner danger" style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start" }}>
                <IconAlert size={16} />
                <span>
                  <strong>{t("bind.protectedTitle")}</strong> {t("bind.protectedPrefix")}{" "}
                  {blockedBinds.map((s, i) => (
                    <span key={i}>
                      {i > 0 ? ", " : ""}
                      <span className="mono">{s}</span>
                    </span>
                  ))}
                  {t("bind.protectedBody")}
                </span>
              </div>
            ) : !isView && optInBinds.length > 0 ? (
              !isSuperuser ? (
                <div className="banner danger" style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start" }}>
                  <IconAlert size={16} />
                  <span>
                    {t("bind.optInNonAdminPrefix", { paths: optInBinds.join(", ") })}{" "}
                    <span className="mono">403 forbidden</span>{t("bind.optInNonAdminSuffix")}
                  </span>
                </div>
              ) : (
                <div
                  className="card-pad col"
                  style={{ gap: "var(--sp-2)", border: "1px solid var(--warning)", borderRadius: "var(--radius-sm, 8px)" }}
                >
                  <div className="row" style={{ gap: "var(--sp-2)", color: "var(--warning)", fontWeight: 600 }}>
                    <IconLock size={15} />
                    {t("bind.optInTitle")}
                  </div>
                  <span className="text-xs secondary">
                    {t("bind.optInBody", { paths: optInBinds.join(", ") })}
                  </span>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={allowHostMounts} onChange={(e) => setAllowHostMounts(e.target.checked)} />
                    <span>{t("bind.optInCheckbox")}</span>
                  </label>
                </div>
              )
            ) : null}
          </div>

          {/* View mode: show the live containers enumerated by project label. */}
          {isView && detail ? (
            <div className="card card-pad col" style={{ gap: "var(--sp-2)" }}>
              <span className="field-label" style={{ margin: 0 }}>
                {t("containers.label", { count: detail.containers.length })}
              </span>
              {detail.containers.length === 0 ? (
                <span className="text-sm muted">{t("containers.empty")}</span>
              ) : (
                <table className="dt">
                  <thead>
                    <tr>
                      <th>{t("containers.colService")}</th>
                      <th>{t("containers.colName")}</th>
                      <th>{t("containers.colState")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.containers.map((c) => (
                      <tr key={c.id}>
                        <td className="mono text-sm">{c.service}</td>
                        <td className="mono text-sm">{c.name}</td>
                        <td>
                          <span className="chip">{c.state}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <span className="text-xs muted">{t("containers.created", { ago: timeAgo(detail.createdAt) })}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <BuilderForm
          services={services}
          onPatch={patchService}
          onAdd={addService}
          onRemove={removeService}
          onGenerate={doGenerate}
          generating={generating}
        />
      )}

      {/* One-time reveal of the redeploy webhook secret (git + auto-deploy). Closing
          it returns to the stack list. Non-dismissable — the secret is shown once. */}
      {webhookReveal ? (
        <WebhookSecretModal
          created={webhookReveal}
          hostId={hostId}
          onClose={() => {
            setWebhookReveal(null);
            navigate("/stacks");
          }}
        />
      ) : null}
    </div>
  );
}

/* ============================ GitOps: create-mode section ============================ */

// GitSection is the collapsible "Deploy from Git (GitOps)" block shown in create
// mode. Toggling it on points the stack at a repository; the fields feed the
// CreateStackRequest git.* keys. The compose document textarea becomes optional
// (the compose is pulled from the repo on first sync).
function GitSection({
  git,
  onChange,
  urlOk,
}: {
  git: GitForm;
  onChange: (g: GitForm) => void;
  urlOk: boolean;
}) {
  const t = useT(stackEditorDict);
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<GitForm>) => onChange({ ...git, ...p });

  return (
    <div className="card card-pad col" style={{ gap: git.enabled ? "var(--sp-4)" : 0 }}>
      <button
        type="button"
        className="row"
        onClick={() => {
          const next = !open;
          setOpen(next);
          // Opening the section arms the git path; closing it disarms it so a
          // collapsed section never silently submits a repo URL.
          patch({ enabled: next });
        }}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "inherit",
          textAlign: "left",
          width: "100%",
          gap: "var(--sp-2)",
        }}
        aria-expanded={open}
      >
        <IconExternal size={16} />
        <span className="field-label" style={{ margin: 0 }}>
          {t("git.sectionTitle")}
        </span>
        <span className="spacer" />
        {git.enabled ? (
          <span className="pill" style={{ color: "var(--accent)", borderColor: "var(--accent)", background: "transparent" }}>
            {t("git.badgeOn")}
          </span>
        ) : null}
        <IconChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>

      {open ? (
        <div className="col" style={{ gap: "var(--sp-3)" }}>
          <span className="text-xs secondary">
            {t("git.intro")}
          </span>
          <TextField
            label={t("git.repoUrlLabel")}
            mono
            placeholder={t("git.repoUrlPlaceholder")}
            value={git.repoUrl}
            onChange={(e) => patch({ repoUrl: e.target.value })}
            error={git.repoUrl.trim() && !urlOk ? t("git.repoUrlError") : undefined}
            hint={t("git.repoUrlHint")}
          />
          <div className="row" style={{ gap: "var(--sp-3)", flexWrap: "wrap", alignItems: "flex-start" }}>
            <TextField
              label={t("git.refLabel")}
              mono
              placeholder={t("git.refPlaceholder")}
              value={git.ref}
              onChange={(e) => patch({ ref: e.target.value })}
              hint={t("git.refHint")}
              style={{ minWidth: 180 }}
            />
            <TextField
              label={t("git.pathLabel")}
              mono
              placeholder={t("git.pathPlaceholder")}
              value={git.path}
              onChange={(e) => patch({ path: e.target.value })}
              hint={t("git.pathHint")}
              style={{ minWidth: 240 }}
            />
          </div>
          <TextField
            label={t("git.tokenLabel")}
            type="password"
            autoComplete="off"
            placeholder={t("git.tokenPlaceholder")}
            value={git.token}
            onChange={(e) => patch({ token: e.target.value })}
            hint={t("git.tokenHint")}
          />
          <label className="checkbox-row">
            <input type="checkbox" checked={git.autoDeploy} onChange={(e) => patch({ autoDeploy: e.target.checked })} />
            <span>{t("git.autoDeploy")}</span>
          </label>
          {git.autoDeploy ? (
            <span className="text-xs muted">
              {t("git.autoDeployHint")}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ============================ GitOps: view-mode panel ============================ */

// GitStackPanel is the control strip for a git-backed stack in view mode: a
// "Sync now" button (redeploys from the pinned ref, gated docker.container.create),
// a "View diff" button (stored vs incoming compose), the repo/ref/path metadata,
// and the last-synced-commit badge. The diff panel renders a line-oriented diff.
function GitStackPanel({
  detail,
  canSync,
  syncing,
  diffing,
  diff,
  onSync,
  onDiff,
  onCloseDiff,
}: {
  detail: { gitRepoUrl: string; gitRef: string; gitPath: string; lastSyncedCommit: string };
  canSync: boolean;
  syncing: boolean;
  diffing: boolean;
  diff: StackDiff | null;
  onSync: () => void;
  onDiff: () => void;
  onCloseDiff: () => void;
}) {
  const t = useT(stackEditorDict);
  return (
    <div className="card card-pad col" style={{ gap: "var(--sp-3)" }}>
      <div className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
        <IconExternal size={16} />
        <span className="field-label" style={{ margin: 0 }}>
          {t("git.panelTitle")}
        </span>
        <span className="spacer" />
        {detail.lastSyncedCommit ? (
          <span
            className="pill"
            title={t("git.lastSynced", { commit: detail.lastSyncedCommit })}
            style={{ color: "var(--success)", background: "var(--success-bg)", borderColor: "transparent" }}
          >
            <IconCheck size={12} /> {shortCommit(detail.lastSyncedCommit)}
          </span>
        ) : (
          <span className="pill" style={{ color: "var(--text-secondary)", background: "var(--bg-surface-2)", borderColor: "transparent" }}>
            {t("git.notSynced")}
          </span>
        )}
      </div>

      <div className="row" style={{ gap: "var(--sp-4)", flexWrap: "wrap" }}>
        <span className="text-xs">
          <span className="muted">{t("git.repo")} </span>
          <span className="mono">{detail.gitRepoUrl}</span>
        </span>
        <span className="text-xs">
          <span className="muted">{t("git.ref")} </span>
          <span className="mono">{detail.gitRef || "main"}</span>
        </span>
        <span className="text-xs">
          <span className="muted">{t("git.path")} </span>
          <span className="mono">{detail.gitPath || "docker-compose.yml"}</span>
        </span>
      </div>

      <div className="row" style={{ gap: "var(--sp-2)" }}>
        <ActionButton
          variant="primary"
          loading={syncing}
          disabled={!canSync}
          tooltip={canSync ? t("git.syncTooltip") : t("action.tooltipNeedCreate")}
          onClick={onSync}
        >
          <IconRefresh size={15} />
          {t("git.syncNow")}
        </ActionButton>
        <ActionButton variant="default" loading={diffing} onClick={onDiff}>
          <IconInspect size={15} />
          {t("git.viewDiff")}
        </ActionButton>
        {diff ? (
          <ActionButton variant="ghost" size="sm" onClick={onCloseDiff}>
            {t("git.hideDiff")}
          </ActionButton>
        ) : null}
      </div>

      {diff ? <StackDiffView diff={diff} /> : null}
    </div>
  );
}

/* ============================ GitOps: diff rendering ============================ */

type DiffLine = { kind: "add" | "del" | "ctx"; text: string };

// diffLines computes a classic line-oriented unified diff (LCS backtrack) between
// the stored compose (current) and the incoming compose at the repo's ref. The
// documents are small, so the O(n*m) table is fine. Mirrors the Helm preview diff.
function diffLines(current: string, incoming: string): DiffLine[] {
  const split = (s: string): string[] => {
    if (s === "") return [];
    const parts = s.split("\n");
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    return parts;
  };
  const a = split(current);
  const b = split(incoming);
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

// StackDiffView renders current (stored) vs incoming (repo HEAD of the pinned ref)
// as a line-by-line diff: additions in var(--success), removals in var(--danger).
function StackDiffView({ diff }: { diff: StackDiff }) {
  const t = useT(stackEditorDict);
  const lines = useMemo(() => diffLines(diff.current, diff.incoming), [diff]);
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "del").length;

  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row" style={{ gap: "var(--sp-2)", alignItems: "baseline" }}>
        <span className="field-label" style={{ margin: 0 }}>
          {t("diff.title")}
        </span>
        <span className="text-xs" style={{ color: "var(--success)" }}>
          +{added}
        </span>
        <span className="text-xs" style={{ color: "var(--danger)" }}>
          −{removed}
        </span>
        {diff.commit ? <span className="text-xs muted">{t("diff.incoming", { commit: shortCommit(diff.commit) })}</span> : null}
      </div>
      {!diff.changed ? (
        <div className="text-sm muted">{t("diff.upToDate")}</div>
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

/* ============================ GitOps: webhook-secret reveal ============================ */

// WebhookSecretModal shows the redeploy webhook secret exactly once, right after a
// git-backed stack is created with auto-deploy. It is NON-dismissable: only the
// explicit footer button closes it, because the secret is never shown again. It
// surfaces the full webhook POST URL, the X-Castor-Token header, and where to
// paste them (GitHub / GitLab webhook settings).
function WebhookSecretModal({
  created,
  hostId,
  onClose,
}: {
  created: StackCreateResponse;
  hostId: string;
  onClose: () => void;
}) {
  const t = useT(stackEditorDict);
  const secret = created.webhookSecret ?? "";
  // The redeploy hook is served under the API base at a stable path. Build an
  // absolute URL from the current origin so it can be pasted verbatim.
  const webhookUrl = `${window.location.origin}/api/v1/hooks/stacks/${encodeURIComponent(created.id)}/redeploy`;
  const [copied, setCopied] = useState<"" | "url" | "secret">("");

  const copy = async (what: "url" | "secret", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      toast.success(what === "url" ? t("toast.urlCopied") : t("toast.tokenCopied"));
      setTimeout(() => setCopied(""), 1600);
    } catch {
      toast.error(t("toast.copyFailed"));
    }
  };

  return (
    <Modal
      open
      title={t("webhook.modalTitle")}
      // Shown exactly once — Escape/scrim/X must not lose it.
      dismissable={false}
      onClose={onClose}
      footer={
        <ActionButton variant="primary" onClick={onClose}>
          {t("webhook.confirm")}
        </ActionButton>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="banner warning">
          <IconLock size={16} />
          <span>
            {t("webhook.warningPrefix")}{" "}
            <strong>{created.name}</strong> ({t("webhook.warningHost")} <span className="mono">{hostId}</span>).
          </span>
        </div>

        <div className="col" style={{ gap: "var(--sp-1)" }}>
          <span className="text-xs muted">{t("webhook.urlLabel")}</span>
          <div className="row" style={{ gap: "var(--sp-2)" }}>
            <code
              className="code-block"
              style={{ padding: "var(--sp-2) var(--sp-3)", flex: 1, whiteSpace: "normal", wordBreak: "break-all" }}
            >
              {webhookUrl}
            </code>
            <ActionButton size="sm" variant="ghost" iconOnly tooltip={t("webhook.copyUrl")} aria-label={t("webhook.copyUrlAria")} onClick={() => copy("url", webhookUrl)}>
              {copied === "url" ? <IconCheck size={15} /> : <IconCopy size={15} />}
            </ActionButton>
          </div>
        </div>

        <div className="col" style={{ gap: "var(--sp-1)" }}>
          <span className="text-xs muted">
            {t("webhook.secretLabelPrefix")} <code>X-Castor-Token</code> {t("webhook.secretLabelSuffix")}
          </span>
          <div className="row" style={{ gap: "var(--sp-2)" }}>
            <code
              className="code-block"
              style={{ padding: "var(--sp-2) var(--sp-3)", flex: 1, whiteSpace: "normal", wordBreak: "break-all" }}
            >
              {secret}
            </code>
            <ActionButton size="sm" variant="ghost" iconOnly tooltip={t("webhook.copySecret")} aria-label={t("webhook.copySecretAria")} onClick={() => copy("secret", secret)}>
              {copied === "secret" ? <IconCheck size={15} /> : <IconCopy size={15} />}
            </ActionButton>
          </div>
        </div>

        <div className="col" style={{ gap: "var(--sp-1)" }}>
          <span className="text-xs secondary" style={{ fontWeight: 600 }}>
            {t("webhook.whereTitle")}
          </span>
          <span className="text-xs secondary">
            {t("webhook.whereBody1")} <span className="mono">Settings → Webhooks → Add webhook</span>{t("webhook.whereBody2")}{" "}
            <span className="mono">Settings → Webhooks</span>{t("webhook.whereBody3")} <strong>{t("webhook.wherePayloadUrl")}</strong> {t("webhook.whereBody4")}{" "}
            <code>X-Castor-Token</code> {t("webhook.whereBody5")}{" "}
            <em>{t("webhook.wherePush")}</em>{t("webhook.whereBody6")}
          </span>
        </div>
      </div>
    </Modal>
  );
}

/* ============================ validation summary ============================ */

function ValidationSummary({ result }: { result: StackValidateResponse }) {
  const t = useT(stackEditorDict);
  return (
    <div
      className="card-pad col"
      style={{
        gap: "var(--sp-3)",
        border: "1px solid var(--success-bg)",
        borderRadius: "var(--radius-sm, 8px)",
        background: "var(--success-bg)",
      }}
    >
      <div className="row" style={{ gap: "var(--sp-2)", color: "var(--success, var(--state-running))", fontWeight: 600 }}>
        <IconCheck size={16} />
        {t("validation.validTitle", { count: result.serviceCount })}
      </div>
      {result.deployOrder.length > 0 ? (
        <div className="row" style={{ gap: "var(--sp-2)", flexWrap: "wrap" }}>
          <span className="text-xs muted">{t("validation.deployOrder")}</span>
          {result.deployOrder.map((s, i) => (
            <span key={`${s}-${i}`} className="chip mono">
              {i + 1}. {s}
            </span>
          ))}
        </div>
      ) : null}
      <table className="dt">
        <thead>
          <tr>
            <th>{t("validation.colService")}</th>
            <th>{t("validation.colImage")}</th>
            <th>{t("validation.colPorts")}</th>
            <th>{t("validation.colVolumes")}</th>
            <th>{t("validation.colRestart")}</th>
          </tr>
        </thead>
        <tbody>
          {result.services.map((s) => (
            <tr key={s.name}>
              <td className="mono text-sm" style={{ fontWeight: 600 }}>
                {s.name}
              </td>
              <td className="mono text-xs">{s.image}</td>
              <td className="mono text-xs">{s.ports.length ? s.ports.join(", ") : "—"}</td>
              <td className="mono text-xs">{s.volumes.length ? s.volumes.join(", ") : "—"}</td>
              <td className="text-xs">{s.restart || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================ builder form ============================ */

interface BuilderFormProps {
  services: FormService[];
  onPatch: (i: number, patch: Partial<FormService>) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onGenerate: () => void;
  generating: boolean;
}

function BuilderForm({ services, onPatch, onAdd, onRemove, onGenerate, generating }: BuilderFormProps) {
  const t = useT(stackEditorDict);
  return (
    <div className="col" style={{ gap: "var(--sp-4)" }}>
      <div className="text-sm muted">
        {t("builder.intro")}
      </div>

      {services.map((svc, i) => (
        <ServiceCard
          key={i}
          index={i}
          svc={svc}
          canRemove={services.length > 1}
          onPatch={(patch) => onPatch(i, patch)}
          onRemove={() => onRemove(i)}
        />
      ))}

      <div className="row">
        <ActionButton variant="ghost" onClick={onAdd}>
          <IconPlus size={15} />
          {t("builder.addService")}
        </ActionButton>
        <span className="spacer" />
        <ActionButton variant="primary" loading={generating} onClick={onGenerate}>
          {t("builder.generate")}
        </ActionButton>
      </div>
    </div>
  );
}

interface ServiceCardProps {
  index: number;
  svc: FormService;
  canRemove: boolean;
  onPatch: (patch: Partial<FormService>) => void;
  onRemove: () => void;
}

function ServiceCard({ index, svc, canRemove, onPatch, onRemove }: ServiceCardProps) {
  const t = useT(stackEditorDict);
  // ports
  const setPort = (pi: number, patch: Partial<BuilderPort>) =>
    onPatch({ ports: svc.ports.map((p, idx) => (idx === pi ? { ...p, ...patch } : p)) });
  const addPort = () => onPatch({ ports: [...svc.ports, { host: 0, container: 0, proto: "tcp" }] });
  const removePort = (pi: number) => onPatch({ ports: svc.ports.filter((_, idx) => idx !== pi) });

  // env
  const setEnv = (ei: number, patch: Partial<BuilderEnv>) =>
    onPatch({ env: svc.env.map((e, idx) => (idx === ei ? { ...e, ...patch } : e)) });
  const addEnv = () => onPatch({ env: [...svc.env, { key: "", value: "" }] });
  const removeEnv = (ei: number) => onPatch({ env: svc.env.filter((_, idx) => idx !== ei) });

  // volumes
  const setVol = (vi: number, patch: Partial<BuilderVolume>) =>
    onPatch({ volumes: svc.volumes.map((v, idx) => (idx === vi ? { ...v, ...patch } : v)) });
  const addVol = () => onPatch({ volumes: [...svc.volumes, { source: "", target: "" }] });
  const removeVol = (vi: number) => onPatch({ volumes: svc.volumes.filter((_, idx) => idx !== vi) });

  return (
    <div className="card card-pad col" style={{ gap: "var(--sp-4)" }}>
      <div className="row">
        <span className="field-label" style={{ margin: 0 }}>
          {t("builder.serviceN", { n: index + 1 })}
        </span>
        <span className="spacer" />
        <ActionButton
          size="sm"
          iconOnly
          variant="ghost"
          disabled={!canRemove}
          tooltip={canRemove ? t("builder.removeService") : t("builder.removeServiceDisabled")}
          aria-label={t("builder.removeServiceAria")}
          onClick={onRemove}
          style={canRemove ? { color: "var(--danger)" } : undefined}
        >
          <IconTrash size={15} />
        </ActionButton>
      </div>

      <div className="row" style={{ gap: "var(--sp-3)", alignItems: "flex-start", flexWrap: "wrap" }}>
        <TextField
          label={t("builder.nameLabel")}
          placeholder={t("builder.namePlaceholder")}
          value={svc.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          style={{ minWidth: 180 }}
        />
        <TextField
          label={t("builder.imageLabel")}
          mono
          placeholder={t("builder.imagePlaceholder")}
          value={svc.image}
          onChange={(e) => onPatch({ image: e.target.value })}
          style={{ minWidth: 240 }}
        />
        <SelectField label={t("builder.restartLabel")} value={svc.restart} onChange={(e) => onPatch({ restart: e.target.value })}>
          {RESTART_OPTIONS.map((r) => (
            <option key={r || "default"} value={r}>
              {r === "" ? t("builder.restartDefault") : r}
            </option>
          ))}
        </SelectField>
      </div>

      {/* ports */}
      <div className="col" style={{ gap: "var(--sp-2)" }}>
        <span className="field-label" style={{ margin: 0 }}>
          {t("builder.ports")}
        </span>
        {svc.ports.map((p, pi) => (
          <div key={pi} className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
            <input
              className="input"
              type="number"
              min={0}
              placeholder={t("builder.portHost")}
              value={p.host || ""}
              onChange={(e) => setPort(pi, { host: Number(e.target.value) || 0 })}
              style={{ width: 96 }}
              aria-label={t("builder.portHostAria")}
            />
            <span className="muted">:</span>
            <input
              className="input"
              type="number"
              min={1}
              placeholder={t("builder.portContainer")}
              value={p.container || ""}
              onChange={(e) => setPort(pi, { container: Number(e.target.value) || 0 })}
              style={{ width: 110 }}
              aria-label={t("builder.portContainerAria")}
            />
            <select
              className="select"
              value={p.proto || "tcp"}
              onChange={(e) => setPort(pi, { proto: e.target.value })}
              style={{ width: 90 }}
              aria-label={t("builder.protoAria")}
            >
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
            </select>
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              aria-label={t("builder.removePortAria")}
              onClick={() => removePort(pi)}
              style={{ color: "var(--danger)" }}
            >
              <IconTrash size={14} />
            </ActionButton>
          </div>
        ))}
        <div>
          <ActionButton size="sm" variant="ghost" onClick={addPort}>
            <IconPlus size={14} />
            {t("builder.addPort")}
          </ActionButton>
        </div>
      </div>

      {/* env */}
      <div className="col" style={{ gap: "var(--sp-2)" }}>
        <span className="field-label" style={{ margin: 0 }}>
          {t("builder.env")}
        </span>
        {svc.env.map((e, ei) => (
          <div key={ei} className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
            <input
              className="input input-mono"
              placeholder="KEY"
              value={e.key}
              onChange={(ev) => setEnv(ei, { key: ev.target.value })}
              style={{ width: 200 }}
              aria-label={t("builder.envKeyAria")}
            />
            <span className="muted">=</span>
            <input
              className="input input-mono"
              placeholder={t("builder.envValuePlaceholder")}
              value={e.value}
              onChange={(ev) => setEnv(ei, { value: ev.target.value })}
              style={{ flex: 1, minWidth: 160 }}
              aria-label={t("builder.envValueAria")}
            />
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              aria-label={t("builder.removeEnvAria")}
              onClick={() => removeEnv(ei)}
              style={{ color: "var(--danger)" }}
            >
              <IconTrash size={14} />
            </ActionButton>
          </div>
        ))}
        <div>
          <ActionButton size="sm" variant="ghost" onClick={addEnv}>
            <IconPlus size={14} />
            {t("builder.addVariable")}
          </ActionButton>
        </div>
      </div>

      {/* volumes */}
      <div className="col" style={{ gap: "var(--sp-2)" }}>
        <span className="field-label" style={{ margin: 0 }}>
          {t("builder.volumes")}
        </span>
        {svc.volumes.map((v, vi) => (
          <div key={vi} className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
            <input
              className="input input-mono"
              placeholder={t("builder.volumeSourcePlaceholder")}
              value={v.source}
              onChange={(ev) => setVol(vi, { source: ev.target.value })}
              style={{ flex: 1, minWidth: 180 }}
              aria-label={t("builder.volumeSourceAria")}
            />
            <span className="muted">:</span>
            <input
              className="input input-mono"
              placeholder={t("builder.volumeTargetPlaceholder")}
              value={v.target}
              onChange={(ev) => setVol(vi, { target: ev.target.value })}
              style={{ flex: 1, minWidth: 160 }}
              aria-label={t("builder.volumeTargetAria")}
            />
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              aria-label={t("builder.removeVolumeAria")}
              onClick={() => removeVol(vi)}
              style={{ color: "var(--danger)" }}
            >
              <IconTrash size={14} />
            </ActionButton>
          </div>
        ))}
        <div>
          <ActionButton size="sm" variant="ghost" onClick={addVol}>
            <IconPlus size={14} />
            {t("builder.addVolume")}
          </ActionButton>
        </div>
      </div>

      {/* depends_on */}
      <TextField
        label={t("builder.dependsOnLabel")}
        mono
        placeholder={t("builder.dependsOnPlaceholder")}
        value={svc.dependsOn}
        onChange={(e) => onPatch({ dependsOn: e.target.value })}
        hint={t("builder.dependsOnHint")}
      />
    </div>
  );
}
