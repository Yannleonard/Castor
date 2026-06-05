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
	"github.com/gtek-it/castor/server/internal/store"
)

// stackDeployTimeout caps a single create+up so a stuck image pull cannot wedge
// the request indefinitely. Compose stacks may pull several images, so this is
// generous relative to a single-container action.
const stackDeployTimeout = 10 * time.Minute

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
type createStackRequest struct {
	Name            string `json:"name"`
	ComposeYAML     string `json:"composeYaml"`
	AllowHostMounts bool   `json:"allowHostMounts"`
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

// stackView is a stack row as returned by the list/detail/create endpoints.
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

// CreateStack validates the compose document, creates+starts every container in
// dependency order on the local Docker engine (attaching each to a per-stack
// bridge network), and persists the stack row. Partial failures roll the row to
// status "partial"/"error" with the already-created containers left in place for
// inspection. Perm docker.container.create at host scope.
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

	model, plan, err := s.parseAndPlan(req.ComposeYAML, name)
	if err != nil {
		authz.WriteError(w, r, mapComposeErr(err))
		return
	}
	authz.SetAuditTarget(r, "stack", plan.Project, name)

	// Host-mount escalation guard: reject host bind mounts declared anywhere in
	// the compose document for non-admins (403, audited); for a global superuser
	// that opted in, stamp every spec so the provider permits ordinary host binds
	// (the always-blocked host paths still fail in ValidateMounts).
	if err := s.authorizePlanHostMounts(r, plan, req.AllowHostMounts); err != nil {
		authz.WriteError(w, r, err)
		return
	}

	// Reject a duplicate project up front (the UNIQUE constraint would catch it
	// anyway, but this avoids creating containers we then can't record).
	if _, gerr := s.store.GetStackByProject(r.Context(), plan.Project); gerr == nil {
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "A stack with project name "+plan.Project+" already exists."))
		return
	}

	// Persist the row first (status=pending) so a deploy that crashes mid-way is
	// still recorded and teardownable by project label.
	st := &store.Stack{
		ID:           store.NewUUID(),
		Name:         name,
		ProjectName:  plan.Project,
		HostID:       hostID,
		ComposeYAML:  req.ComposeYAML,
		Status:       "pending",
		ServiceCount: len(model.Services),
	}
	if u := authz.UserFrom(r); u != nil {
		st.CreatedBy = u.ID
	}
	if err := s.store.CreateStack(r.Context(), st); err != nil {
		writeMapped(w, r, mapStackConflict(err))
		return
	}

	// Deploy on a background-derived timeout (decoupled from the request cancel so
	// a client disconnect mid-pull doesn't orphan a half-built stack).
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

	stored, err := s.store.GetStack(r.Context(), st.ID)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	created(w, toStackView(stored))
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
	dp := s.manager.Docker()

	conts, lerr := dp.ListProjectContainers(ctx, st.ProjectName)
	if lerr != nil {
		writeMapped(w, r, lerr)
		return
	}
	for _, c := range conts {
		if rmErr := dp.StopAndRemoveContainer(ctx, c.ID); rmErr != nil {
			writeMapped(w, r, rmErr)
			return
		}
	}

	// Remove the project networks (default + any project-scoped extras). Best
	// effort across the project's known network names; failures (e.g. still in
	// use by an unrelated container) surface as a conflict.
	_ = dp.RemoveNetworkByName(ctx, st.ProjectName+"_default")
	// Re-derive explicit networks from the stored compose so extras are cleaned.
	if _, plan, perr := s.parseAndPlan(st.ComposeYAML, st.Name); perr == nil {
		for _, n := range plan.Networks {
			_ = dp.RemoveNetworkByName(ctx, n)
		}
	}

	if delErr := s.store.DeleteStack(r.Context(), st.ID); delErr != nil {
		writeMapped(w, r, delErr)
		return
	}
	ok2(w)
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
		ID:           st.ID,
		Name:         st.Name,
		ProjectName:  st.ProjectName,
		HostID:       st.HostID,
		ComposeYAML:  st.ComposeYAML,
		Status:       st.Status,
		ServiceCount: st.ServiceCount,
		CreatedBy:    st.CreatedBy,
		CreatedAt:    st.CreatedAt,
		UpdatedAt:    st.UpdatedAt,
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
