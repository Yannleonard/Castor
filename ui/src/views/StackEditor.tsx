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
      toast.success("Compose valid", `${res.serviceCount} service(s).`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_failed") {
        setValidationError(err.message);
      } else {
        toastError("Validation failed", err);
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
        toast.success("Stack created", `${created.name} — save the webhook secret.`);
        setWebhookReveal(created);
      } else {
        toast.success(
          gitOn ? "Stack created from Git" : "Stack deployed",
          `${created.name} — ${created.serviceCount} service(s).`,
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
      toastError("Deploy failed", err);
    } finally {
      setDeploying(false);
    }
  };

  const doGenerate = async () => {
    const built = toBuilderServices(services);
    if (built.length === 0 || built.some((s) => !s.name || !s.image)) {
      toast.warning("Incomplete services", "Every service needs a name and an image.");
      return;
    }
    setGenerating(true);
    try {
      const project = (name.trim() || "stack").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
      const res = await api.stackBuilderGenerate({ projectName: project, services: built });
      setYamlText(res.yaml);
      resetValidation();
      setTab("yaml");
      toast.success("YAML generated", "Review it in the YAML tab, then validate and deploy.");
    } catch (err) {
      toastError("Generate failed", err);
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
        "Synced from Git",
        updated.lastSyncedCommit
          ? `Deployed ${shortCommit(updated.lastSyncedCommit)} — ${updated.serviceCount} service(s).`
          : `${updated.serviceCount} service(s).`,
      );
      // Refetch the detail (and the list) so the badge + YAML reflect the new commit.
      queryClient.invalidateQueries({ queryKey: qk.stack(hostId, stackId) });
      queryClient.invalidateQueries({ queryKey: qk.stacks(hostId) });
      setDiff(null); // a stale diff no longer reflects the deployed state
    } catch (err) {
      toastError("Sync failed", err);
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
      toastError("Diff failed", err);
    } finally {
      setDiffing(false);
    }
  };

  if (isView && detailQuery.isLoading) {
    return <LoadingFill label="Loading stack…" />;
  }

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="row" style={{ gap: "var(--sp-3)" }}>
            <IconStacks size={20} />
            {isView ? detail?.name ?? "Stack" : "Deploy stack"}
          </span>
        }
        subtitle={
          isView ? (
            <span className="mono text-xs">{detail?.projectName}</span>
          ) : (
            "Define a compose document, validate it, then deploy."
          )
        }
        actions={
          <div className="row">
            <ActionButton variant="ghost" onClick={() => navigate("/stacks")}>
              Back to stacks
            </ActionButton>
            <HelpButton topic="stacks" />
          </div>
        }
      />

      <div className="tabs">
        <button className={`tab${tab === "yaml" ? " active" : ""}`} onClick={() => setTab("yaml")}>
          YAML
        </button>
        {!isView ? (
          <button className={`tab${tab === "builder" ? " active" : ""}`} onClick={() => setTab("builder")}>
            Builder
          </button>
        ) : null}
      </div>

      {tab === "yaml" ? (
        <div className="col" style={{ gap: "var(--sp-4)" }}>
          {!isView ? (
            <div className="card card-pad">
              <TextField
                label="Stack name"
                placeholder="my-app"
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={name && !nameOk ? "Letters, digits, space, dot, dash, underscore (max 63)." : undefined}
                hint="Used to derive the compose project name."
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
                Compose document
              </span>
              <span className="spacer" />
              {isView ? (
                <span className="text-xs muted">
                  {isGitStack ? "Tracked from Git — sync to redeploy." : "Read-only — deploy from a new stack."}
                </span>
              ) : gitOn ? (
                <span className="text-xs muted">Optional — pulled from the repo on first sync.</span>
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
                Validate
              </ActionButton>
              <span className="spacer" />
              {!isView ? (
                <ActionButton
                  variant="primary"
                  loading={deploying}
                  disabled={!sourceOk || !nameOk || !canDeploy || hostBindBlocksDeploy}
                  tooltip={
                    !canDeploy
                      ? "Requires docker.container.create"
                      : git.enabled && !gitUrlOk
                        ? "Enter a valid repository URL (https:// or git@…)"
                        : gitOn && !nameOk
                          ? "Enter a stack name"
                          : blockedBinds.length
                            ? "Remove the protected host path mount to deploy"
                            : optInBinds.length && !isSuperuser
                              ? "Host path mounts require an administrator"
                              : optInBinds.length && !allowHostMounts
                                ? "Tick “Allow host path mounts” to deploy with a host bind"
                                : undefined
                  }
                  onClick={doDeploy}
                >
                  {gitOn ? "Create from Git" : "Deploy"}
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
                  Invalid compose document
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
                  <strong>Protected host path.</strong> A service binds{" "}
                  {blockedBinds.map((s, i) => (
                    <span key={i}>
                      {i > 0 ? ", " : ""}
                      <span className="mono">{s}</span>
                    </span>
                  ))}
                  , which is never allowed (it would grant the container control of the host). Remove it to deploy.
                </span>
              </div>
            ) : !isView && optInBinds.length > 0 ? (
              !isSuperuser ? (
                <div className="banner danger" style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start" }}>
                  <IconAlert size={16} />
                  <span>
                    This stack mounts a host path ({optInBinds.join(", ")}). Host binds are root-equivalent, so only an
                    administrator may deploy them — the server will reject this with a{" "}
                    <span className="mono">403 forbidden</span>. Use named volumes instead.
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
                    A service binds a host path ({optInBinds.join(", ")}), giving the container access to the host
                    filesystem. As an administrator you may opt in; protected paths (docker.sock, /, /etc, …) stay
                    blocked regardless.
                  </span>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={allowHostMounts} onChange={(e) => setAllowHostMounts(e.target.checked)} />
                    <span>Allow host path mounts for this stack</span>
                  </label>
                </div>
              )
            ) : null}
          </div>

          {/* View mode: show the live containers enumerated by project label. */}
          {isView && detail ? (
            <div className="card card-pad col" style={{ gap: "var(--sp-2)" }}>
              <span className="field-label" style={{ margin: 0 }}>
                Containers ({detail.containers.length})
              </span>
              {detail.containers.length === 0 ? (
                <span className="text-sm muted">No live containers for this stack.</span>
              ) : (
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Name</th>
                      <th>State</th>
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
              <span className="text-xs muted">Created {timeAgo(detail.createdAt)}.</span>
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
          Deploy from Git (GitOps)
        </span>
        <span className="spacer" />
        {git.enabled ? (
          <span className="pill" style={{ color: "var(--accent)", borderColor: "var(--accent)", background: "transparent" }}>
            on
          </span>
        ) : null}
        <IconChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>

      {open ? (
        <div className="col" style={{ gap: "var(--sp-3)" }}>
          <span className="text-xs secondary">
            Track a compose file in a git repository. Castor pulls it on the first sync and can redeploy on demand — or
            automatically on push, via a webhook.
          </span>
          <TextField
            label="Repository URL"
            mono
            placeholder="https://github.com/acme/infra.git"
            value={git.repoUrl}
            onChange={(e) => patch({ repoUrl: e.target.value })}
            error={git.repoUrl.trim() && !urlOk ? "Use https://…, git@…, or ssh://…" : undefined}
            hint="HTTPS or SSH clone URL of the repo holding your compose file."
          />
          <div className="row" style={{ gap: "var(--sp-3)", flexWrap: "wrap", alignItems: "flex-start" }}>
            <TextField
              label="Branch / ref"
              mono
              placeholder="main"
              value={git.ref}
              onChange={(e) => patch({ ref: e.target.value })}
              hint="Branch, tag, or commit to pin."
              style={{ minWidth: 180 }}
            />
            <TextField
              label="Compose path"
              mono
              placeholder="docker-compose.yml"
              value={git.path}
              onChange={(e) => patch({ path: e.target.value })}
              hint="Path to the compose file within the repo."
              style={{ minWidth: 240 }}
            />
          </div>
          <TextField
            label="Git token (optional)"
            type="password"
            autoComplete="off"
            placeholder="ghp_…"
            value={git.token}
            onChange={(e) => patch({ token: e.target.value })}
            hint="PAT read-only pour repo privé. Sent once, never returned."
          />
          <label className="checkbox-row">
            <input type="checkbox" checked={git.autoDeploy} onChange={(e) => patch({ autoDeploy: e.target.checked })} />
            <span>Auto-deploy on push (webhook)</span>
          </label>
          {git.autoDeploy ? (
            <span className="text-xs muted">
              A redeploy webhook secret will be generated and shown once after the stack is created.
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
  return (
    <div className="card card-pad col" style={{ gap: "var(--sp-3)" }}>
      <div className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
        <IconExternal size={16} />
        <span className="field-label" style={{ margin: 0 }}>
          GitOps
        </span>
        <span className="spacer" />
        {detail.lastSyncedCommit ? (
          <span
            className="pill"
            title={`Last synced commit ${detail.lastSyncedCommit}`}
            style={{ color: "var(--success)", background: "var(--success-bg)", borderColor: "transparent" }}
          >
            <IconCheck size={12} /> {shortCommit(detail.lastSyncedCommit)}
          </span>
        ) : (
          <span className="pill" style={{ color: "var(--text-secondary)", background: "var(--bg-surface-2)", borderColor: "transparent" }}>
            not yet synced
          </span>
        )}
      </div>

      <div className="row" style={{ gap: "var(--sp-4)", flexWrap: "wrap" }}>
        <span className="text-xs">
          <span className="muted">Repo </span>
          <span className="mono">{detail.gitRepoUrl}</span>
        </span>
        <span className="text-xs">
          <span className="muted">Ref </span>
          <span className="mono">{detail.gitRef || "main"}</span>
        </span>
        <span className="text-xs">
          <span className="muted">Path </span>
          <span className="mono">{detail.gitPath || "docker-compose.yml"}</span>
        </span>
      </div>

      <div className="row" style={{ gap: "var(--sp-2)" }}>
        <ActionButton
          variant="primary"
          loading={syncing}
          disabled={!canSync}
          tooltip={canSync ? "Pull the pinned ref and redeploy" : "Requires docker.container.create"}
          onClick={onSync}
        >
          <IconRefresh size={15} />
          Sync now
        </ActionButton>
        <ActionButton variant="default" loading={diffing} onClick={onDiff}>
          <IconInspect size={15} />
          View diff
        </ActionButton>
        {diff ? (
          <ActionButton variant="ghost" size="sm" onClick={onCloseDiff}>
            Hide diff
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
  const lines = useMemo(() => diffLines(diff.current, diff.incoming), [diff]);
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "del").length;

  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row" style={{ gap: "var(--sp-2)", alignItems: "baseline" }}>
        <span className="field-label" style={{ margin: 0 }}>
          Diff (current → incoming)
        </span>
        <span className="text-xs" style={{ color: "var(--success)" }}>
          +{added}
        </span>
        <span className="text-xs" style={{ color: "var(--danger)" }}>
          −{removed}
        </span>
        {diff.commit ? <span className="text-xs muted">incoming {shortCommit(diff.commit)}</span> : null}
      </div>
      {!diff.changed ? (
        <div className="text-sm muted">Up to date — the stored compose matches the repo.</div>
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
  const secret = created.webhookSecret ?? "";
  // The redeploy hook is served under the API base at a stable path. Build an
  // absolute URL from the current origin so it can be pasted verbatim.
  const webhookUrl = `${window.location.origin}/api/v1/hooks/stacks/${encodeURIComponent(created.id)}/redeploy`;
  const [copied, setCopied] = useState<"" | "url" | "secret">("");

  const copy = async (what: "url" | "secret", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      toast.success(what === "url" ? "Webhook URL copied" : "Token copied");
      setTimeout(() => setCopied(""), 1600);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <Modal
      open
      title="Save your webhook secret"
      // Shown exactly once — Escape/scrim/X must not lose it.
      dismissable={false}
      onClose={onClose}
      footer={
        <ActionButton variant="primary" onClick={onClose}>
          I've saved the webhook secret
        </ActionButton>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="banner warning">
          <IconLock size={16} />
          <span>
            Copy this secret now — it is shown only once. Auto-deploy is enabled for{" "}
            <strong>{created.name}</strong> (host <span className="mono">{hostId}</span>).
          </span>
        </div>

        <div className="col" style={{ gap: "var(--sp-1)" }}>
          <span className="text-xs muted">Webhook URL (POST)</span>
          <div className="row" style={{ gap: "var(--sp-2)" }}>
            <code
              className="code-block"
              style={{ padding: "var(--sp-2) var(--sp-3)", flex: 1, whiteSpace: "normal", wordBreak: "break-all" }}
            >
              {webhookUrl}
            </code>
            <ActionButton size="sm" variant="ghost" iconOnly tooltip="Copy URL" aria-label="Copy webhook URL" onClick={() => copy("url", webhookUrl)}>
              {copied === "url" ? <IconCheck size={15} /> : <IconCopy size={15} />}
            </ActionButton>
          </div>
        </div>

        <div className="col" style={{ gap: "var(--sp-1)" }}>
          <span className="text-xs muted">
            Secret — send it in the <code>X-Castor-Token</code> request header
          </span>
          <div className="row" style={{ gap: "var(--sp-2)" }}>
            <code
              className="code-block"
              style={{ padding: "var(--sp-2) var(--sp-3)", flex: 1, whiteSpace: "normal", wordBreak: "break-all" }}
            >
              {secret}
            </code>
            <ActionButton size="sm" variant="ghost" iconOnly tooltip="Copy secret" aria-label="Copy webhook secret" onClick={() => copy("secret", secret)}>
              {copied === "secret" ? <IconCheck size={15} /> : <IconCopy size={15} />}
            </ActionButton>
          </div>
        </div>

        <div className="col" style={{ gap: "var(--sp-1)" }}>
          <span className="text-xs secondary" style={{ fontWeight: 600 }}>
            Where to paste it
          </span>
          <span className="text-xs secondary">
            In your repo's webhook settings (GitHub: <span className="mono">Settings → Webhooks → Add webhook</span>;
            GitLab: <span className="mono">Settings → Webhooks</span>), set the <strong>Payload URL</strong> to the URL
            above and add a request header <code>X-Castor-Token</code> with the secret as its value. Choose the{" "}
            <em>push</em> event. Castor redeploys the stack from the pinned ref on each matching push.
          </span>
        </div>
      </div>
    </Modal>
  );
}

/* ============================ validation summary ============================ */

function ValidationSummary({ result }: { result: StackValidateResponse }) {
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
        Valid — {result.serviceCount} service(s)
      </div>
      {result.deployOrder.length > 0 ? (
        <div className="row" style={{ gap: "var(--sp-2)", flexWrap: "wrap" }}>
          <span className="text-xs muted">Deploy order:</span>
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
            <th>Service</th>
            <th>Image</th>
            <th>Ports</th>
            <th>Volumes</th>
            <th>Restart</th>
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
  return (
    <div className="col" style={{ gap: "var(--sp-4)" }}>
      <div className="text-sm muted">
        Build services visually, then generate a compose document. The YAML tab remains the deploy source of truth.
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
          Add service
        </ActionButton>
        <span className="spacer" />
        <ActionButton variant="primary" loading={generating} onClick={onGenerate}>
          Generate YAML
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
          Service {index + 1}
        </span>
        <span className="spacer" />
        <ActionButton
          size="sm"
          iconOnly
          variant="ghost"
          disabled={!canRemove}
          tooltip={canRemove ? "Remove service" : "A stack needs at least one service"}
          aria-label="Remove service"
          onClick={onRemove}
          style={canRemove ? { color: "var(--danger)" } : undefined}
        >
          <IconTrash size={15} />
        </ActionButton>
      </div>

      <div className="row" style={{ gap: "var(--sp-3)", alignItems: "flex-start", flexWrap: "wrap" }}>
        <TextField
          label="Name"
          placeholder="web"
          value={svc.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          style={{ minWidth: 180 }}
        />
        <TextField
          label="Image"
          mono
          placeholder="nginx:latest"
          value={svc.image}
          onChange={(e) => onPatch({ image: e.target.value })}
          style={{ minWidth: 240 }}
        />
        <SelectField label="Restart" value={svc.restart} onChange={(e) => onPatch({ restart: e.target.value })}>
          {RESTART_OPTIONS.map((r) => (
            <option key={r || "default"} value={r}>
              {r === "" ? "(default)" : r}
            </option>
          ))}
        </SelectField>
      </div>

      {/* ports */}
      <div className="col" style={{ gap: "var(--sp-2)" }}>
        <span className="field-label" style={{ margin: 0 }}>
          Ports
        </span>
        {svc.ports.map((p, pi) => (
          <div key={pi} className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
            <input
              className="input"
              type="number"
              min={0}
              placeholder="host"
              value={p.host || ""}
              onChange={(e) => setPort(pi, { host: Number(e.target.value) || 0 })}
              style={{ width: 96 }}
              aria-label="Host port"
            />
            <span className="muted">:</span>
            <input
              className="input"
              type="number"
              min={1}
              placeholder="container"
              value={p.container || ""}
              onChange={(e) => setPort(pi, { container: Number(e.target.value) || 0 })}
              style={{ width: 110 }}
              aria-label="Container port"
            />
            <select
              className="select"
              value={p.proto || "tcp"}
              onChange={(e) => setPort(pi, { proto: e.target.value })}
              style={{ width: 90 }}
              aria-label="Protocol"
            >
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
            </select>
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              aria-label="Remove port"
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
            Add port
          </ActionButton>
        </div>
      </div>

      {/* env */}
      <div className="col" style={{ gap: "var(--sp-2)" }}>
        <span className="field-label" style={{ margin: 0 }}>
          Environment
        </span>
        {svc.env.map((e, ei) => (
          <div key={ei} className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
            <input
              className="input input-mono"
              placeholder="KEY"
              value={e.key}
              onChange={(ev) => setEnv(ei, { key: ev.target.value })}
              style={{ width: 200 }}
              aria-label="Env key"
            />
            <span className="muted">=</span>
            <input
              className="input input-mono"
              placeholder="value"
              value={e.value}
              onChange={(ev) => setEnv(ei, { value: ev.target.value })}
              style={{ flex: 1, minWidth: 160 }}
              aria-label="Env value"
            />
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              aria-label="Remove env var"
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
            Add variable
          </ActionButton>
        </div>
      </div>

      {/* volumes */}
      <div className="col" style={{ gap: "var(--sp-2)" }}>
        <span className="field-label" style={{ margin: 0 }}>
          Volumes
        </span>
        {svc.volumes.map((v, vi) => (
          <div key={vi} className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
            <input
              className="input input-mono"
              placeholder="source (named or /host/path)"
              value={v.source}
              onChange={(ev) => setVol(vi, { source: ev.target.value })}
              style={{ flex: 1, minWidth: 180 }}
              aria-label="Volume source"
            />
            <span className="muted">:</span>
            <input
              className="input input-mono"
              placeholder="/container/path"
              value={v.target}
              onChange={(ev) => setVol(vi, { target: ev.target.value })}
              style={{ flex: 1, minWidth: 160 }}
              aria-label="Volume target"
            />
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              aria-label="Remove volume"
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
            Add volume
          </ActionButton>
        </div>
      </div>

      {/* depends_on */}
      <TextField
        label="Depends on"
        mono
        placeholder="db cache"
        value={svc.dependsOn}
        onChange={(e) => onPatch({ dependsOn: e.target.value })}
        hint="Other service names this one starts after (space or comma separated)."
      />
    </div>
  );
}
