// Castor by IT Leonard
package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Stack is a row of the stacks table: a deployed multi-container compose stack.
// ComposeYAML is the validated source document. Status is the lifecycle marker
// (pending|running|partial|stopped|error). ProjectName is the compose project
// label (com.docker.compose.project) used to enumerate/teardown the containers.
//
// The Git* fields are the optional GitOps source of truth (migration 0006).
// GitTokenEnc holds a git PAT sealed with AES-256-GCM by the API layer (never
// serialized — json:"-", surfaced only as HasGitToken); the store treats it as
// an opaque BLOB and never imports the crypto/authz package. WebhookSecretHash
// is the hex SHA-256 of the redeploy webhook secret (raw secret shown once,
// never persisted). AutoDeploy gates the public redeploy hook.
type Stack struct {
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

	// GitOps (migration 0006).
	GitRepoURL        string `json:"gitRepoUrl"`
	GitRef            string `json:"gitRef"`
	GitPath           string `json:"gitPath"`
	GitTokenEnc       []byte `json:"-"`
	WebhookSecretHash string `json:"-"`
	LastSyncedCommit  string `json:"lastSyncedCommit"`
	AutoDeploy        bool   `json:"autoDeploy"`
}

// HasGitToken reports whether a sealed git PAT is stored (drives the API's
// hasGitToken flag without ever exposing the token itself).
func (st *Stack) HasGitToken() bool { return len(st.GitTokenEnc) > 0 }

// GitConfigured reports whether this stack tracks a git repository.
func (st *Stack) GitConfigured() bool { return st.GitRepoURL != "" }

const stackCols = `id, name, project_name, host_id, compose_yaml, status, service_count, created_by, created_at, updated_at, git_repo_url, git_ref, git_path, git_token_enc, webhook_secret_hash, last_synced_commit, auto_deploy`

func scanStack(row interface{ Scan(...any) error }) (*Stack, error) {
	var s Stack
	var createdBy, gitRepoURL, gitRef, gitPath, webhookHash, lastCommit sql.NullString
	var gitToken []byte
	var autoDeploy int
	if err := row.Scan(&s.ID, &s.Name, &s.ProjectName, &s.HostID, &s.ComposeYAML,
		&s.Status, &s.ServiceCount, &createdBy, &s.CreatedAt, &s.UpdatedAt,
		&gitRepoURL, &gitRef, &gitPath, &gitToken, &webhookHash, &lastCommit, &autoDeploy); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	s.CreatedBy = createdBy.String
	s.GitRepoURL = gitRepoURL.String
	s.GitRef = gitRef.String
	s.GitPath = gitPath.String
	s.GitTokenEnc = gitToken
	s.WebhookSecretHash = webhookHash.String
	s.LastSyncedCommit = lastCommit.String
	s.AutoDeploy = autoDeploy != 0
	return &s, nil
}

// ListStacks returns all stacks for a host, newest first.
func (s *Store) ListStacks(ctx context.Context, hostID string) ([]*Stack, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+stackCols+` FROM stacks WHERE host_id = ? ORDER BY created_at DESC, name ASC`, hostID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*Stack
	for rows.Next() {
		st, err := scanStack(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

// GetStack returns one stack by id.
func (s *Store) GetStack(ctx context.Context, id string) (*Stack, error) {
	return scanStack(s.db.QueryRowContext(ctx,
		`SELECT `+stackCols+` FROM stacks WHERE id = ?`, id))
}

// GetStackByProject returns one stack by its (unique) project name.
func (s *Store) GetStackByProject(ctx context.Context, project string) (*Stack, error) {
	return scanStack(s.db.QueryRowContext(ctx,
		`SELECT `+stackCols+` FROM stacks WHERE project_name = ?`, project))
}

// GetStackByWebhookHash returns the stack whose redeploy webhook secret hashes to
// hash. It is the lookup for the public redeploy hook; callers still verify the
// secret in constant time and check auto_deploy. Returns ErrNotFound when no row
// matches (the empty hash never matches: the column is NULL for stacks without a
// webhook, and the caller passes a non-empty hash).
func (s *Store) GetStackByWebhookHash(ctx context.Context, hash string) (*Stack, error) {
	if hash == "" {
		return nil, ErrNotFound
	}
	return scanStack(s.db.QueryRowContext(ctx,
		`SELECT `+stackCols+` FROM stacks WHERE webhook_secret_hash = ?`, hash))
}

// CreateStack inserts a new stack row. The caller assigns st.ID (store.NewUUID())
// before calling; created_at/updated_at are set to now (unix seconds). The Git*
// fields are persisted as-is: GitTokenEnc must already be sealed by the caller
// (authz.SealSecret) or nil. A UNIQUE(project_name) violation surfaces as the raw
// driver error so the API can map it to a 409.
func (s *Store) CreateStack(ctx context.Context, st *Stack) error {
	now := time.Now().Unix()
	st.CreatedAt, st.UpdatedAt = now, now
	if st.HostID == "" {
		st.HostID = "local"
	}
	if st.Status == "" {
		st.Status = "pending"
	}
	if st.GitPath == "" {
		st.GitPath = "docker-compose.yml"
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO stacks (`+stackCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		st.ID, st.Name, st.ProjectName, st.HostID, st.ComposeYAML,
		st.Status, st.ServiceCount, nullStr(st.CreatedBy), now, now,
		nullStr(st.GitRepoURL), nullStr(st.GitRef), st.GitPath, nullBlob(st.GitTokenEnc),
		nullStr(st.WebhookSecretHash), nullStr(st.LastSyncedCommit), boolInt(st.AutoDeploy))
	return err
}

// UpdateStackStatus updates a stack's status (and bumps updated_at). Returns
// ErrNotFound when no row matched.
func (s *Store) UpdateStackStatus(ctx context.Context, id, status string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE stacks SET status = ?, updated_at = ? WHERE id = ?`,
		status, time.Now().Unix(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// StackGitUpdate carries the git-config fields to persist on a stack. Token uses
// pointer semantics like registry secrets: nil keeps the stored token, a pointer
// to "" clears it, a pointer to a sealed BLOB replaces it. WebhookSecretHash uses
// the same pointer semantics. RepoURL/Ref/Path/AutoDeploy are always written.
type StackGitUpdate struct {
	RepoURL           string
	Ref               string
	Path              string
	AutoDeploy        bool
	GitTokenEnc       *[]byte // nil=keep, &[]byte(nil)/&empty=clear, &value=replace
	WebhookSecretHash *string // nil=keep, &""=clear, &value=set
}

// UpdateStackGit replaces a stack's git configuration. The sealed token and
// webhook hash follow pointer semantics (see StackGitUpdate). Returns ErrNotFound
// when no row matched.
func (s *Store) UpdateStackGit(ctx context.Context, id string, upd StackGitUpdate) error {
	path := upd.Path
	if path == "" {
		path = "docker-compose.yml"
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE stacks SET git_repo_url = ?, git_ref = ?, git_path = ?, auto_deploy = ?, updated_at = ? WHERE id = ?`,
		nullStr(upd.RepoURL), nullStr(upd.Ref), path, boolInt(upd.AutoDeploy), time.Now().Unix(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if upd.GitTokenEnc != nil {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE stacks SET git_token_enc = ? WHERE id = ?`,
			nullBlob(*upd.GitTokenEnc), id); err != nil {
			return err
		}
	}
	if upd.WebhookSecretHash != nil {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE stacks SET webhook_secret_hash = ? WHERE id = ?`,
			nullStr(*upd.WebhookSecretHash), id); err != nil {
			return err
		}
	}
	return nil
}

// UpdateStackSynced records the outcome of a git sync+deploy: the compose text
// pulled from the repo, the resolved commit, the new service count, and the
// resulting status. Returns ErrNotFound when no row matched.
func (s *Store) UpdateStackSynced(ctx context.Context, id, composeYAML, commit, status string, serviceCount int) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE stacks SET compose_yaml = ?, last_synced_commit = ?, status = ?, service_count = ?, updated_at = ? WHERE id = ?`,
		composeYAML, nullStr(commit), status, serviceCount, time.Now().Unix(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteStack removes a stack row by id. Returns ErrNotFound when no row matched.
func (s *Store) DeleteStack(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM stacks WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
