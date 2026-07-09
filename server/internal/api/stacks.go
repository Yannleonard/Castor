package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"gopkg.in/yaml.v3"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/compose"
	"github.com/gtek-it/castor/server/internal/git"
	"github.com/gtek-it/castor/server/internal/store"
)

// stackDeployTimeout caps a single create+up so a stuck image pull cannot wedge
// the request indefinitely. Compose stacks may pull several images, so this is
// generous relative to a single-container action.
const stackDeployTimeout = 10 * time.Minute

// gitSyncTimeout bounds the git clone/fetch portion of a sync separately from the
// deploy so a slow remote fails fast before any container work begins.
const gitSyncTimeout = 3 * time.Minute

// webhookTokenHeader carries the redeploy webhook secret on the public hook. The
// secret may also be passed as the "token" query parameter.
const webhookTokenHeader = "X-Castor-Token"

// --- request/response shapes (camelCase, mirrored in ui/src/lib/types.ts) ---

// composeRequest carries a raw compose YAML document.
type composeRequest struct {
	ComposeYAML string `json:"composeYaml"`
}

// createStackRequest is the POST /hosts/{hostID}/stacks body: a name plus the
// compose document to deploy. AllowHostMounts is an admin-only opt-in (same
// semantics as the template-deploy flag) to permit ordinary host bind mounts
// declared in the compose volumes; non-admins are denied 403 if any service
// declares a host bind, and the always-blocked host paths stay denied for all.
//
// The Git* fields are optional GitOps configuration. When GitRepoURL is set the
// stack is created from that repo: composeYaml may be omitted (it is pulled on
// the first sync) and the stack is not deployed at creation. GitToken is a git
// PAT for a private repo — write-only, sealed at rest, never returned. AutoDeploy
// enables the public redeploy webhook; when both a repo and auto-deploy are set,
// the create response includes the generated webhook secret exactly once.
type createStackRequest struct {
	Name            string `json:"name"`
	ComposeYAML     string `json:"composeYaml"`
	AllowHostMounts bool   `json:"allowHostMounts"`

	GitRepoURL string `json:"gitRepoUrl"`
	GitRef     string `json:"gitRef"`
	GitPath    string `json:"gitPath"`
	GitToken   string `json:"gitToken"`
	AutoDeploy bool   `json:"autoDeploy"`
}

// stackServiceView is one normalized service in a validate/summary response.
type stackServiceView struct {
	Name          string   `json:"name"`
	Image         string   `json:"image"`
	ContainerName string   `json:"containerName"`
	Ports         []string `json:"ports"`
	Environment   []string `json:"environment"`
	Volumes       []string `json:"volumes"`
	Networks      []string `json:"networks"`
	Restart       string   `json:"restart"`
	Command       []string `json:"command"`
	DependsOn     []string `json:"dependsOn"`
}

// stackValidateResponse is returned by POST .../stacks/validate on success: the
// normalized service summary plus the deploy order.
type stackValidateResponse struct {
	Valid        bool               `json:"valid"`
	ServiceCount int                `json:"serviceCount"`
	Services     []stackServiceView `json:"services"`
	DeployOrder  []string           `json:"deployOrder"`
}

// stackView is a stack row as returned by the list/detail/create endpoints. The
// git PAT and webhook secret hash are never included (write-only at rest); the
// view exposes only HasGitToken and the repo/ref/path/auto-deploy config plus the
// last synced commit.
type stackView struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ProjectName  string `json:"projectName"`
	HostID       string `json:"hostId"`
	ComposeYAML  string `json:"composeYaml"`
	Status       string `json:"status"`
	ServiceCount int    `json:"serviceCount"`
	CreatedBy    string `json:"createdBy"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`

	GitRepoURL       string `json:"gitRepoUrl"`
	GitRef           string `json:"gitRef"`
	GitPath          string `json:"gitPath"`
	HasGitToken      bool   `json:"hasGitToken"`
	AutoDeploy       bool   `json:"autoDeploy"`
	LastSyncedCommit string `json:"lastSyncedCommit"`
}

// stackCreateView is the create response: a stackView plus, exactly once, the
// generated webhook secret when the stack was created with git + auto-deploy. The
// secret is omitted from every other response (it is not stored in plaintext).
type stackCreateView struct {
	stackView
	WebhookSecret string `json:"webhookSecret,omitempty"`
}

// stackContainerView lists a deployed container of a stack (detail endpoint).
type stackContainerView struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Service string `json:"service"`
	State   string `json:"state"`
}

// stackDetailView extends stackView with the live containers enumerated by the
// compose project label.
type stackDetailView struct {
	stackView
	Containers []stackContainerView `json:"containers"`
}

// --- builder/generate shapes ---

type builderPort struct {
	Host      int    `json:"host"`
	Container int    `json:"container"`
	Proto     string `json:"proto"`
}

type builderEnv struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type builderVolume struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type builderService struct {
	Name          string          `json:"name"`
	Image         string          `json:"image"`
	ContainerName string          `json:"containerName"`
	Ports         []builderPort   `json:"ports"`
	Env           []builderEnv    `json:"env"`
	Volumes       []builderVolume `json:"volumes"`
	Networks      []string        `json:"networks"`
	Restart       string          `json:"restart"`
	Command       []string        `json:"command"`
	DependsOn     []string        `json:"dependsOn"`
}

type builderRequest struct {
	ProjectName string           `json:"projectName"`
	Services    []builderService `json:"services"`
}

type builderResponse struct {
	YAML string `json:"yaml"`
}

// ValidateStack parses the posted compose YAML and returns either a 422 with the
// validation error or a 200 normalized service summary + deploy order. Pure: no
// daemon access. Perm docker.container.create at host scope (only operators who
// can deploy may validate).
func (s *Server) ValidateStack(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	if _, ok := s.manager.Store().Get(hostID); !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}

	var req composeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}

	model, plan, err := s.parseAndPlan(req.ComposeYAML, "validate")
	if err != nil {
		authz.WriteError(w, r, mapComposeErr(err))
		return
	}

	ok(w, stackValidateResponse{
		Valid:        true,
		ServiceCount: len(model.Services),
		Services:     serviceViews(model),
		DeployOrder:  deployOrder(plan),
	})
}

// CreateStack persists a stack row and, when a compose document is supplied,
// creates+starts every container in dependency order on the local Docker engine
// (attaching each to a per-stack bridge network). Partial failures roll the row
// to status "partial"/"error" with the already-created containers left in place
// for inspection. Perm docker.container.create at host scope.
//
// GitOps: when gitRepoUrl is set the stack is created from a repository. The git
// PAT (if any) is sealed via authz.SealSecret; the compose may be omitted (it is
// pulled by the first /sync) in which case no containers are deployed at create.
// If both a repo and autoDeploy are set, a redeploy webhook secret is generated
// and returned exactly once in the create response (only its hash is stored).
func (s *Server) CreateStack(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	if _, ok := s.manager.Store().Get(hostID); !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}

	var req createStackRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Stack name is required."))
		return
	}
	gitURL := strings.TrimSpace(req.GitRepoURL)
	hasCompose := strings.TrimSpace(req.ComposeYAML) != ""

	// A stack must have a source: an inline compose document, a git repo, or both.
	if !hasCompose && gitURL == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Provide a compose document or a git repository URL."))
		return
	}

	// Enforce the repo-URL scheme allowlist at creation (http/https only) so a
	// stack can never be persisted pointing at file://, ssh:// or git:// — this is
	// re-checked before every clone in the git package as a defense in depth.
	if gitURL != "" {
		if err := git.ValidateRepoURL(gitURL); err != nil {
			authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "The git repository URL must use http:// or https://."))
			return
		}
	}

	// Resolve the project name. When a compose document is present we plan it now
	// (which validates it and derives the project); a git-only create derives the
	// project from the stack name alone.
	var (
		model        *compose.Model
		plan         *compose.Plan
		project      string
		serviceCount int
	)
	if hasCompose {
		var perr error
		model, plan, perr = s.parseAndPlan(req.ComposeYAML, name)
		if perr != nil {
			authz.WriteError(w, r, mapComposeErr(perr))
			return
		}
		project = plan.Project
		serviceCount = len(model.Services)
	} else {
		project = compose.SanitizeProjectName(name)
		if project == "" {
			authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Invalid stack name (use letters, digits, '-' or '_')."))
			return
		}
	}
	authz.SetAuditTarget(r, "stack", project, name)

	// Host-mount escalation guard runs only when there is a compose plan to check;
	// a git-only stack is guarded on its first sync instead.
	if hasCompose {
		if err := s.authorizePlanHostMounts(r, plan, req.AllowHostMounts); err != nil {
			authz.WriteError(w, r, err)
			return
		}
	}

	// Reject a duplicate project up front (the UNIQUE constraint would catch it
	// anyway, but this avoids creating containers we then can't record).
	if _, gerr := s.store.GetStackByProject(r.Context(), project); gerr == nil {
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "A stack with project name "+project+" already exists."))
		return
	}

	// Persist the row first (status=pending) so a deploy that crashes mid-way is
	// still recorded and teardownable by project label.
	st := &store.Stack{
		ID:           store.NewUUID(),
		Name:         name,
		ProjectName:  project,
		HostID:       hostID,
		ComposeYAML:  req.ComposeYAML,
		Status:       "pending",
		ServiceCount: serviceCount,
		GitRepoURL:   gitURL,
		GitRef:       strings.TrimSpace(req.GitRef),
		GitPath:      strings.TrimSpace(req.GitPath),
		AutoDeploy:   req.AutoDeploy,
	}
	if u := authz.UserFrom(r); u != nil {
		st.CreatedBy = u.ID
	}

	// Seal the git PAT in the API layer (the store never imports the crypto
	// package), mirroring the registry credential path.
	if tok := strings.TrimSpace(req.GitToken); tok != "" {
		if gitURL == "" {
			authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "A git token requires a git repository URL."))
			return
		}
		sealed, serr := authz.SealSecret(s.cfg.SecretKey, []byte(tok))
		if serr != nil {
			authz.WriteError(w, r, authz.ErrInternal)
			return
		}
		st.GitTokenEnc = sealed
	}

	// Generate a redeploy webhook secret when the stack is git-backed AND opts into
	// auto-deploy. Only the hash is persisted; the raw secret is returned once.
	var webhookSecret string
	if gitURL != "" && req.AutoDeploy {
		raw, gerr := authz.RandomToken(32)
		if gerr != nil {
			authz.WriteError(w, r, authz.ErrInternal)
			return
		}
		webhookSecret = raw
		st.WebhookSecretHash = authz.HashSessionID(raw)
	}

	if err := s.store.CreateStack(r.Context(), st); err != nil {
		writeMapped(w, r, mapStackConflict(err))
		return
	}

	// Deploy only when a compose document was supplied. A git-only stack stays
	// "pending" until its first /sync pulls and deploys the compose.
	if hasCompose {
		// Deploy on a background-derived timeout (decoupled from the request cancel
		// so a client disconnect mid-pull doesn't orphan a half-built stack).
		ctx, cancel := context.WithTimeout(context.Background(), stackDeployTimeout)
		defer cancel()

		status, derr := s.deployPlan(ctx, plan)
		_ = s.store.UpdateStackStatus(r.Context(), st.ID, status)
		st.Status = status

		if derr != nil {
			// The row is kept (status reflects the failure) so the operator can see
			// and tear it down. Surface the mapped error.
			writeMapped(w, r, derr)
			return
		}
	}

	stored, err := s.store.GetStack(r.Context(), st.ID)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	created(w, stackCreateView{stackView: toStackView(stored), WebhookSecret: webhookSecret})
}

// authorizePlanHostMounts applies the host-mount escalation guard to a whole
// compose plan. It collects the host bind sources declared across all services;
// a non-admin requesting any host bind (or that set the opt-in flag) is denied
// 403 (audited). For a global superuser that opted in, it stamps AllowHostMounts
// on every spec so the provider permits ordinary host binds (the always-blocked
// host paths still fail in docker.ValidateMounts for everyone).
func (s *Server) authorizePlanHostMounts(r *http.Request, plan *compose.Plan, requested bool) error {
	hostPaths := plan.HostMountSources()
	actor := authz.UserFrom(r)
	isAdmin := actor != nil && actor.HasGlobalSuperuser()

	if !isAdmin && (len(hostPaths) > 0 || requested) {
		authz.AddAuditDetail(r, "denied", "host_mount")
		if len(hostPaths) > 0 {
			authz.AddAuditDetail(r, "hostPaths", hostPaths)
		}
		authz.SetAuditResult(r, "denied")
		return authz.Errorf(authz.ErrForbidden,
			"This stack declares host bind mounts, which require administrator privileges; use named volumes instead.")
	}

	allow := isAdmin && requested
	for i := range plan.Specs {
		plan.Specs[i].AllowHostMounts = allow
	}
	if len(hostPaths) > 0 {
		authz.AddAuditDetail(r, "hostMounts", hostPaths)
	}
	return nil
}

// deployPlan creates the project network(s) then creates+starts every spec in
// order, connecting each container to the project network with its service-name
// aliases. It returns the final stack status and, on failure, the mapped error.
func (s *Server) deployPlan(ctx context.Context, plan *compose.Plan) (status string, err error) {
	dp := s.manager.Docker()
	netLabels := map[string]string{
		compose.LabelProject:       plan.Project,
		compose.LabelCastorStack:   plan.Project,
		compose.LabelCastorManaged: "true",
	}

	// Default project network (every service joins this).
	defaultNet, nerr := dp.EnsureProjectNetwork(ctx, plan.DefaultNetworkName(), netLabels)
	if nerr != nil {
		return "error", mapError(nerr)
	}
	// Any explicit user-declared networks.
	extraNetIDs := map[string]string{}
	for _, n := range plan.Networks {
		id, eerr := dp.EnsureProjectNetwork(ctx, n, netLabels)
		if eerr != nil {
			return "error", mapError(eerr)
		}
		extraNetIDs[n] = id
	}

	deployed := 0
	for _, spec := range plan.Specs {
		id, cerr := dp.ContainerCreateAndStart(ctx, spec)
		if cerr != nil {
			if deployed == 0 {
				return "error", mapError(cerr)
			}
			return "partial", mapError(cerr)
		}
		deployed++

		// Attach to the default project network with the service aliases so peers
		// resolve it by service name.
		aliases := plan.Aliases[spec.Name]
		if connErr := dp.ConnectToNetwork(ctx, defaultNet, id, aliases); connErr != nil {
			return "partial", mapError(connErr)
		}
		// Attach to any explicit networks the service declared.
		for _, n := range plan.ExtraNetworks[spec.Name] {
			if nid, ok := extraNetIDs[n]; ok {
				if connErr := dp.ConnectToNetwork(ctx, nid, id, aliases); connErr != nil {
					return "partial", mapError(connErr)
				}
			}
		}
	}
	return "running", nil
}

// ListStacks returns the stacks registered for a host. Perm docker.container.read.
func (s *Server) ListStacks(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	if _, ok := s.manager.Store().Get(hostID); !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	rows, err := s.store.ListStacks(r.Context(), hostID)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	out := make([]stackView, 0, len(rows))
	for _, st := range rows {
		out = append(out, toStackView(st))
	}
	ok(w, out)
}

// StackDetail returns one stack plus the live containers enumerated by its
// compose project label. Perm docker.container.read.
func (s *Server) StackDetail(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	id := chi.URLParam(r, "id")
	st, err := s.store.GetStack(r.Context(), id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if st.HostID != hostID {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}

	view := stackDetailView{stackView: toStackView(st), Containers: []stackContainerView{}}
	if conts, derr := s.manager.Docker().ListProjectContainers(r.Context(), st.ProjectName); derr == nil {
		for _, c := range conts {
			view.Containers = append(view.Containers, stackContainerView{
				ID: c.ID, Name: c.Name, Service: c.Service, State: c.State,
			})
		}
	}
	ok(w, view)
}

// DeleteStack tears a stack down: it enumerates the stack's containers by the
// compose project label, stops+removes each, removes the project network(s),
// and deletes the row. Perm docker.container.remove at host scope.
func (s *Server) DeleteStack(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	id := chi.URLParam(r, "id")
	st, err := s.store.GetStack(r.Context(), id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if st.HostID != hostID {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	authz.SetAuditTarget(r, "stack", st.ProjectName, st.Name)

	ctx, cancel := contextWithTimeout(r, 2*time.Minute)
	defer cancel()

	// Re-derive explicit networks from the stored compose so project-scoped extras
	// are cleaned alongside the default network.
	var extraNets []string
	if _, plan, perr := s.parseAndPlan(st.ComposeYAML, st.Name); perr == nil {
		extraNets = plan.Networks
	}
	if err := s.teardownProject(ctx, st.ProjectName, extraNets); err != nil {
		writeMapped(w, r, err)
		return
	}

	if delErr := s.store.DeleteStack(r.Context(), st.ID); delErr != nil {
		writeMapped(w, r, delErr)
		return
	}
	ok2(w)
}

// teardownProject stops and removes every container of a compose project (by the
// compose project label) and removes the project's networks (default plus any
// extra network names passed in). It does NOT remove named data volumes: it only
// deletes containers and networks, so both a full delete and a re-sync preserve
// the stack's persistent data. Container removal drops only anonymous volumes
// (StopAndRemoveContainer), never named ones.
//
// It is shared by DeleteStack (a full teardown before dropping the row) and
// syncAndDeploy (a teardown before re-deploying, so container recreation does not
// collide on deterministic names). A container-removal failure is returned so the
// caller can surface it; network removal is best-effort (an in-use network from an
// unrelated container must not fail the operation).
func (s *Server) teardownProject(ctx context.Context, project string, extraNetworks []string) error {
	dp := s.manager.Docker()

	conts, lerr := dp.ListProjectContainers(ctx, project)
	if lerr != nil {
		return lerr
	}
	for _, c := range conts {
		if rmErr := dp.StopAndRemoveContainer(ctx, c.ID); rmErr != nil {
			return rmErr
		}
	}

	// Remove the project networks (default + any project-scoped extras). Best
	// effort: a failure (e.g. still in use by an unrelated container) is ignored
	// here so it cannot block a re-deploy; EnsureProjectNetwork re-adopts an
	// existing network on the way back up.
	_ = dp.RemoveNetworkByName(ctx, project+"_default")
	for _, n := range extraNetworks {
		_ = dp.RemoveNetworkByName(ctx, n)
	}
	return nil
}

// --- GitOps: sync / diff / redeploy webhook ---

// stackDiffView is the body of GET .../stacks/{id}/diff: the compose document
// currently stored on the stack vs the one at the repo's ref, and whether they
// differ. The textual diff is computed by the UI.
type stackDiffView struct {
	Current  string `json:"current"`
	Incoming string `json:"incoming"`
	Changed  bool   `json:"changed"`
	Commit   string `json:"commit"`
}

// SyncStack pulls the compose document from the stack's git repository at its
// pinned ref, validates it against Castor's supported compose subset, deploys it,
// and records the resolved commit. Perm docker.container.create at host scope
// (deploy-grade, identical to CreateStack — a sync re-creates containers). A
// compose that exceeds the supported subset returns a clear 422, never a crash.
func (s *Server) SyncStack(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	id := chi.URLParam(r, "id")
	st, err := s.store.GetStack(r.Context(), id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if st.HostID != hostID {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	authz.SetAuditTarget(r, "stack", st.ProjectName, st.Name)

	if !st.GitConfigured() {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "This stack is not configured with a git repository."))
		return
	}

	status, commit, err := s.syncAndDeploy(r.Context(), st, r, false)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.AddAuditDetail(r, "commit", commit)
	authz.AddAuditDetail(r, "status", status)

	stored, gerr := s.store.GetStack(r.Context(), st.ID)
	if gerr != nil {
		writeMapped(w, r, gerr)
		return
	}
	ok(w, toStackView(stored))
}

// StackDiff fetches the compose document from the stack's git repository at HEAD
// of the pinned ref and returns it alongside the stack's stored compose so the UI
// can render a diff. It does not deploy. Perm docker.container.read at host scope.
func (s *Server) StackDiff(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	id := chi.URLParam(r, "id")
	st, err := s.store.GetStack(r.Context(), id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if st.HostID != hostID {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	if !st.GitConfigured() {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "This stack is not configured with a git repository."))
		return
	}

	auth, aerr := s.stackGitAuth(st)
	if aerr != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	ctx, cancel := contextWithTimeout(r, gitSyncTimeout)
	defer cancel()

	res, serr := git.SyncTo(ctx, s.cfg.StackCloneDir(st.ID), st.GitRepoURL, st.GitRef, stackGitPath(st), auth)
	if serr != nil {
		authz.WriteError(w, r, mapGitErr(serr))
		return
	}
	incoming := string(res.Content)
	ok(w, stackDiffView{
		Current:  st.ComposeYAML,
		Incoming: incoming,
		Changed:  incoming != st.ComposeYAML,
		Commit:   res.Commit,
	})
}

// RedeployWebhook is the PUBLIC redeploy hook (no session/CSRF; mounted next to
// /healthz). It reads a secret from the X-Castor-Token header (or ?token=), looks
// up the stack by the secret's hash, and — only when the stack has auto_deploy
// and the secret matches in constant time — runs the same sync+deploy as
// SyncStack with the audit actor recorded as "webhook". Any miss returns a
// generic 404 so the endpoint never reveals whether a stack or secret exists.
func (s *Server) RedeployWebhook(w http.ResponseWriter, r *http.Request) {
	secret := strings.TrimSpace(r.Header.Get(webhookTokenHeader))
	if secret == "" {
		secret = strings.TrimSpace(r.URL.Query().Get("token"))
	}
	// Record the actor as "webhook" on the audit row (the route has no session).
	authz.AddAuditDetail(r, "actor", "webhook")

	// A generic 404 for every failure path (no secret, no match, wrong secret,
	// auto_deploy off) so the hook leaks nothing about stack/secret existence.
	deny := func() { authz.WriteError(w, r, authz.ErrNotFound) }

	if secret == "" {
		deny()
		return
	}
	st, err := s.store.GetStackByWebhookHash(r.Context(), authz.HashSessionID(secret))
	if err != nil || st == nil {
		deny()
		return
	}
	// Constant-time confirm of the stored hash vs the presented secret's hash, and
	// require auto_deploy + a configured repo. Both hashes are already fixed-width
	// hex, so the compare does not leak the secret.
	if !st.AutoDeploy || !st.GitConfigured() ||
		!authz.ConstantTimeEqualString(st.WebhookSecretHash, authz.HashSessionID(secret)) {
		deny()
		return
	}
	authz.SetAuditTarget(r, "stack", st.ProjectName, st.Name)

	status, commit, derr := s.syncAndDeploy(r.Context(), st, r, true)
	if derr != nil {
		writeMapped(w, r, derr)
		return
	}
	authz.AddAuditDetail(r, "commit", commit)
	authz.AddAuditDetail(r, "status", status)
	ok(w, map[string]any{"ok": true, "status": status, "commit": commit})
}

// syncAndDeploy is the shared sync path for SyncStack and RedeployWebhook: it
// pulls the compose from git, validates+plans it, enforces the host-mount guard,
// deploys it, and records compose+commit+status on the row. When public is true
// the caller is the anonymous webhook, so host bind mounts are always rejected
// (there is no admin to opt in). It returns the resulting status and commit.
func (s *Server) syncAndDeploy(ctx context.Context, st *store.Stack, r *http.Request, public bool) (status, commit string, err error) {
	// Per-stack lock: SyncStack, the webhook, and a double-click all target the
	// same clone dir and recreate the same containers. Rather than block and pile
	// up concurrent syncs, a sync already in flight for this stack fails fast with a
	// 409 — for the webhook this avoids queueing redundant redeploys, and for the
	// button it is a clear "already in progress" signal. TryLock keeps this
	// non-blocking for both callers.
	mu := s.stackMutex(st.ID)
	if !mu.TryLock() {
		return "", "", authz.Errorf(authz.ErrConflict, "A sync is already in progress for this stack.")
	}
	defer mu.Unlock()

	auth, aerr := s.stackGitAuth(st)
	if aerr != nil {
		return "", "", authz.ErrInternal
	}

	gctx, gcancel := context.WithTimeout(ctx, gitSyncTimeout)
	res, serr := git.SyncTo(gctx, s.cfg.StackCloneDir(st.ID), st.GitRepoURL, st.GitRef, stackGitPath(st), auth)
	gcancel()
	if serr != nil {
		return "", "", mapGitErr(serr)
	}
	composeYAML := string(res.Content)

	// Parse+plan the pulled compose. A document outside Castor's supported subset
	// is a clean 422 (ErrValidation), never a panic.
	model, plan, perr := s.parseAndPlan(composeYAML, st.Name)
	if perr != nil {
		return "", "", mapComposeErr(perr)
	}

	// Host-mount escalation guard. A host bind mount is admin-only; the public
	// webhook and any non-admin sync are rejected (403). For an interactive sync
	// by a global superuser the binds are permitted (still subject to the
	// always-blocked host paths in the provider).
	if err := s.authorizeSyncHostMounts(plan, r, public); err != nil {
		return "", "", err
	}

	// Deploy on a background-derived timeout so a client disconnect mid-pull does
	// not orphan a half-built stack.
	dctx, dcancel := context.WithTimeout(context.Background(), stackDeployTimeout)
	defer dcancel()

	// Tear down the project's existing containers before recreating them. deployPlan
	// recreates containers at deterministic names (container_name or
	// <project>-<service>); without a teardown ContainerCreate collides on the name
	// at every re-sync. The teardown removes only containers + project networks, not
	// named data volumes, so a sync preserves the stack's persistent data. On a
	// teardown failure the row keeps its prior state and we report an error rather
	// than deploying on top of a half-removed project.
	if terr := s.teardownProject(dctx, plan.Project, plan.Networks); terr != nil {
		return "error", res.Commit, terr
	}

	status, derr := s.deployPlan(dctx, plan)

	// Persist the synced compose + commit + status regardless of deploy outcome so
	// the row reflects what was applied and is teardownable by project label. Use
	// the detached deploy context (dctx), not the request context: the deploy ran on
	// dctx, so a client disconnect mid-deploy must not cancel the write recording
	// what was actually applied.
	_ = s.store.UpdateStackSynced(dctx, st.ID, composeYAML, res.Commit, status, len(model.Services))
	if derr != nil {
		return status, res.Commit, derr
	}
	return status, res.Commit, nil
}

// authorizeSyncHostMounts applies the host-mount escalation guard to a synced
// plan. The public webhook (public=true) has no principal, so any host bind is
// rejected. An interactive sync consults the request's user: a global superuser
// may deploy host binds; everyone else is denied 403.
func (s *Server) authorizeSyncHostMounts(plan *compose.Plan, r *http.Request, public bool) error {
	hostPaths := plan.HostMountSources()
	if len(hostPaths) == 0 {
		return nil
	}
	isAdmin := false
	if !public {
		if u := authz.UserFrom(r); u != nil {
			isAdmin = u.HasGlobalSuperuser()
		}
	}
	if !isAdmin {
		if r != nil {
			authz.AddAuditDetail(r, "denied", "host_mount")
		}
		return authz.Errorf(authz.ErrForbidden,
			"The synced compose declares host bind mounts, which require administrator privileges; use named volumes instead.")
	}
	for i := range plan.Specs {
		plan.Specs[i].AllowHostMounts = true
	}
	return nil
}

// stackGitAuth builds the optional git BasicAuth from a stack's sealed PAT. It
// returns nil (anonymous) when no token is stored. The plaintext token is used
// only to construct the auth and is never logged or returned.
func (s *Server) stackGitAuth(st *store.Stack) (*git.BasicAuth, error) {
	if !st.HasGitToken() {
		return nil, nil
	}
	tok, err := authz.OpenSecret(s.cfg.SecretKey, st.GitTokenEnc)
	if err != nil {
		return nil, err
	}
	// The username is not stored; a git PAT authenticates as basic-auth password
	// with a placeholder username (providers ignore it for token auth).
	return &git.BasicAuth{Username: "castor", Token: string(tok)}, nil
}

// stackGitPath returns the compose path to read from the repo, defaulting to the
// conventional file when the stack stored none.
func stackGitPath(st *store.Stack) string {
	if p := strings.TrimSpace(st.GitPath); p != "" {
		return p
	}
	return "docker-compose.yml"
}

// mapGitErr maps a git-package error to the API envelope. A git error is
// operator-facing (bad ref, auth, missing file) and already sanitized of
// credentials by the git package, so it surfaces as a 422 so the caller can fix
// the repo/ref/token without a 5xx.
func mapGitErr(err error) error {
	if err == nil {
		return nil
	}
	return authz.Errorf(authz.ErrValidation, err.Error())
}

// BuilderGenerate turns a structured service list into a compose YAML document.
// Pure: it builds a compose.Model, marshals it with yaml.v3, and returns the
// document. No validation against a daemon and no deploy. Perm
// docker.container.create (only operators who can deploy use the builder).
func (s *Server) BuilderGenerate(w http.ResponseWriter, r *http.Request) {
	var req builderRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if len(req.Services) == 0 {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "At least one service is required."))
		return
	}

	model := compose.Model{Services: make(map[string]compose.Service, len(req.Services))}
	seen := map[string]struct{}{}
	for _, svc := range req.Services {
		name := strings.TrimSpace(svc.Name)
		if name == "" {
			authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Every service needs a name."))
			return
		}
		if _, dup := seen[name]; dup {
			authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Duplicate service name: "+name))
			return
		}
		seen[name] = struct{}{}
		if strings.TrimSpace(svc.Image) == "" {
			authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Service "+name+" needs an image."))
			return
		}
		model.Services[name] = compose.Service{
			Image:         strings.TrimSpace(svc.Image),
			ContainerName: strings.TrimSpace(svc.ContainerName),
			Ports:         builderPortStrings(svc.Ports),
			Environment:   builderEnvStrings(svc.Env),
			Volumes:       builderVolumeStrings(svc.Volumes),
			Networks:      trimAll(svc.Networks),
			Restart:       strings.TrimSpace(svc.Restart),
			Command:       svc.Command,
			DependsOn:     trimAll(svc.DependsOn),
		}
	}

	doc, err := marshalCompose(&model)
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	ok(w, builderResponse{YAML: doc})
}

// --- helpers ---

// parseAndPlan parses the compose YAML and builds a deployment plan for the
// given (raw) project name. Both compose.ValidationError and plan errors are
// returned for the caller to map.
func (s *Server) parseAndPlan(yamlSrc, project string) (*compose.Model, *compose.Plan, error) {
	model, err := compose.Parse([]byte(yamlSrc))
	if err != nil {
		return nil, nil, err
	}
	plan, err := compose.BuildPlan(project, model)
	if err != nil {
		return nil, nil, err
	}
	return model, plan, nil
}

// serviceViews builds the normalized per-service summary in deterministic order.
func serviceViews(m *compose.Model) []stackServiceView {
	names := m.ServiceNamesSorted()
	out := make([]stackServiceView, 0, len(names))
	for _, n := range names {
		svc := m.Services[n]
		out = append(out, stackServiceView{
			Name:          n,
			Image:         svc.Image,
			ContainerName: svc.ContainerName,
			Ports:         normStrs(svc.Ports),
			Environment:   normStrs(svc.Environment),
			Volumes:       normStrs(svc.Volumes),
			Networks:      normStrs(svc.Networks),
			Restart:       svc.Restart,
			Command:       normStrs(svc.Command),
			DependsOn:     normStrs(svc.DependsOn),
		})
	}
	return out
}

// deployOrder returns the spec names in topological deploy order.
func deployOrder(plan *compose.Plan) []string {
	out := make([]string, 0, len(plan.Specs))
	for _, sp := range plan.Specs {
		// The spec name is "<project>-<service>" or container_name; the service
		// label is the authoritative service name.
		out = append(out, sp.Labels[compose.LabelService])
	}
	return out
}

func toStackView(st *store.Stack) stackView {
	return stackView{
		ID:               st.ID,
		Name:             st.Name,
		ProjectName:      st.ProjectName,
		HostID:           st.HostID,
		ComposeYAML:      st.ComposeYAML,
		Status:           st.Status,
		ServiceCount:     st.ServiceCount,
		CreatedBy:        st.CreatedBy,
		CreatedAt:        st.CreatedAt,
		UpdatedAt:        st.UpdatedAt,
		GitRepoURL:       st.GitRepoURL,
		GitRef:           st.GitRef,
		GitPath:          st.GitPath,
		HasGitToken:      st.HasGitToken(),
		AutoDeploy:       st.AutoDeploy,
		LastSyncedCommit: st.LastSyncedCommit,
	}
}

// builderPortStrings turns structured ports into compose "host:container[/proto]"
// strings (or "container[/proto]" when no host port is given).
func builderPortStrings(ports []builderPort) []string {
	if len(ports) == 0 {
		return nil
	}
	out := make([]string, 0, len(ports))
	for _, p := range ports {
		if p.Container <= 0 {
			continue
		}
		s := ""
		if p.Host > 0 {
			s = strconv.Itoa(p.Host) + ":" + strconv.Itoa(p.Container)
		} else {
			s = strconv.Itoa(p.Container)
		}
		proto := strings.ToLower(strings.TrimSpace(p.Proto))
		if proto != "" && proto != "tcp" {
			s += "/" + proto
		}
		out = append(out, s)
	}
	return out
}

func builderEnvStrings(env []builderEnv) []string {
	if len(env) == 0 {
		return nil
	}
	out := make([]string, 0, len(env))
	for _, e := range env {
		k := strings.TrimSpace(e.Key)
		if k == "" {
			continue
		}
		out = append(out, k+"="+e.Value)
	}
	return out
}

func builderVolumeStrings(vols []builderVolume) []string {
	if len(vols) == 0 {
		return nil
	}
	out := make([]string, 0, len(vols))
	for _, v := range vols {
		t := strings.TrimSpace(v.Target)
		if t == "" {
			continue
		}
		src := strings.TrimSpace(v.Source)
		if src == "" {
			out = append(out, t)
		} else {
			out = append(out, src+":"+t)
		}
	}
	return out
}

func trimAll(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// marshalCompose renders a compose Model to YAML with a top-level "version"
// header for familiarity. The environment list form is preferred (it round-trips
// cleanly). yaml.v3 emits service maps in sorted key order.
func marshalCompose(m *compose.Model) (string, error) {
	// Wrap with a stable top-level shape so the output reads like a real file.
	doc := struct {
		Services map[string]compose.Service `yaml:"services"`
	}{Services: m.Services}
	b, err := yaml.Marshal(doc)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// mapComposeErr maps a compose validation error to a 422; any other error to the
// generic mapper.
func mapComposeErr(err error) error {
	if err == nil {
		return nil
	}
	if compose.IsValidation(err) {
		return authz.Errorf(authz.ErrValidation, err.Error())
	}
	return mapError(err)
}

// mapStackConflict turns a UNIQUE(project_name) violation into a 409.
func mapStackConflict(err error) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "unique") || strings.Contains(msg, "constraint") {
		return authz.Errorf(authz.ErrConflict, "A stack with that project name already exists.")
	}
	return err
}
