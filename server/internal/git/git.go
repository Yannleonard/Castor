// Package git is Castor's minimal GitOps client for stack deployments. It wraps
// go-git/v5 (pure Go, so it links into the CGO-free distroless image with no git
// binary) to clone/fetch a repository into a per-stack working directory and read
// a compose file out of the checked-out tree at a pinned ref.
//
// The surface is deliberately small: SyncTo clones a repo if the directory is
// empty, otherwise fetches and hard-resets to the requested ref, then returns the
// resolved HEAD commit hash and the bytes of one file. Auth is an optional HTTP
// BasicAuth (a git PAT); nil means an anonymous clone of a public repo.
package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/plumbing/transport"
	githttp "github.com/go-git/go-git/v5/plumbing/transport/http"
)

// defaultTimeout bounds a single sync (clone or fetch+checkout) so a slow or
// unreachable remote cannot wedge a request. Callers may pass a shorter deadline
// via ctx; this is the fallback cap when the incoming ctx has none.
const defaultTimeout = 3 * time.Minute

// ErrEmptyURL is returned when SyncTo is called without a repository URL.
var ErrEmptyURL = errors.New("git: repository URL is required")

// ErrUnsupportedScheme is returned when a repository URL uses a scheme other than
// http/https. Only those two are allowed so a stack cannot be pointed at file://
// (local repo read / LFI), ssh://, or git:// (SSRF into internal hosts).
var ErrUnsupportedScheme = errors.New("git: repository URL must use http:// or https://")

// ValidateRepoURL enforces the repository-URL scheme allowlist. Only http:// and
// https:// (scheme compared case-insensitively) are permitted; every other scheme
// — file://, ssh://, git://, and any scheme-less path — is rejected so the git
// client cannot be steered at a local repository or an internal network endpoint.
// It is called both when a stack is created and before every clone/fetch.
func ValidateRepoURL(url string) error {
	url = strings.TrimSpace(url)
	if url == "" {
		return ErrEmptyURL
	}
	i := strings.Index(url, "://")
	if i < 0 {
		return ErrUnsupportedScheme
	}
	switch strings.ToLower(url[:i]) {
	case "http", "https":
		return nil
	default:
		return ErrUnsupportedScheme
	}
}

// BasicAuth carries optional HTTP basic credentials for a private repository.
// Token is a git personal access token; Username is the account it belongs to
// (many providers accept any non-empty username, but GitHub wants the login or
// the literal "x-access-token"). A nil *BasicAuth means an anonymous clone.
type BasicAuth struct {
	Username string
	Token    string
}

// authMethod converts the optional BasicAuth to a go-git transport.AuthMethod.
// It returns nil (anonymous) when no token is set.
func (a *BasicAuth) authMethod() transport.AuthMethod {
	if a == nil || strings.TrimSpace(a.Token) == "" {
		return nil
	}
	user := strings.TrimSpace(a.Username)
	if user == "" {
		// go-git's HTTP basic auth rejects an empty username; a non-empty
		// placeholder is the conventional value when only a token matters.
		user = "git"
	}
	return &githttp.BasicAuth{Username: user, Password: a.Token}
}

// SyncResult is the outcome of a successful SyncTo: the resolved HEAD commit and
// the raw bytes of the requested file at that commit.
type SyncResult struct {
	Commit  string
	Content []byte
}

// SyncTo makes dir reflect url at ref and reads the file at composePath from the
// checked-out tree. If dir has no repository yet it clones; otherwise it fetches
// and hard-resets the working tree to ref. ref may be a branch name, a tag, or a
// full commit hash; empty means the remote's default branch. It returns the
// resolved HEAD hash and the file bytes.
//
// A corrupt or partially-cloned directory is removed and re-cloned rather than
// failing permanently, so a crash mid-clone self-heals on the next sync.
func SyncTo(ctx context.Context, dir, url, ref, composePath string, auth *BasicAuth) (*SyncResult, error) {
	if err := ValidateRepoURL(url); err != nil {
		return nil, err
	}
	ctx, cancel := withTimeout(ctx)
	defer cancel()

	repo, err := openOrClone(ctx, dir, url, ref, auth)
	if err != nil {
		return nil, err
	}

	head, err := checkoutRef(ctx, repo, url, ref, auth)
	if err != nil {
		return nil, err
	}

	content, err := readFileAt(repo, head, composePath)
	if err != nil {
		return nil, err
	}
	return &SyncResult{Commit: head.String(), Content: content}, nil
}

// openOrClone opens the repository already in dir, or clones a fresh one when the
// directory is absent, empty, or holds a broken repository. A broken repository
// is wiped and re-cloned so a crash mid-clone self-heals.
func openOrClone(ctx context.Context, dir, url, ref string, auth *BasicAuth) (*gogit.Repository, error) {
	repo, err := gogit.PlainOpen(dir)
	if err == nil {
		return repo, nil
	}
	if !errors.Is(err, gogit.ErrRepositoryNotExists) {
		// The directory exists but is not a valid repository (e.g. a truncated
		// clone). Remove it and fall through to a clean clone.
		if rmErr := os.RemoveAll(dir); rmErr != nil {
			return nil, fmt.Errorf("git: clear corrupt clone dir: %w", rmErr)
		}
	}
	return clone(ctx, dir, url, ref, auth)
}

// clone performs a fresh clone into dir. When ref names a branch or tag we clone
// that reference directly; a bare commit hash is fetched by cloning the default
// branch and letting checkoutRef resolve+reset to the commit afterwards.
func clone(ctx context.Context, dir, url, ref string, auth *BasicAuth) (*gogit.Repository, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("git: create clone dir: %w", err)
	}
	opts := &gogit.CloneOptions{
		URL:  url,
		Auth: auth.authMethod(),
		Tags: gogit.AllTags,
	}
	if rn := branchRefName(ref); rn != "" {
		opts.ReferenceName = rn
		opts.SingleBranch = false
	}
	repo, err := gogit.PlainCloneContext(ctx, dir, false, opts)
	if err != nil {
		// A ref-specific clone can fail when ref is a commit hash (not a branch/
		// tag); retry a default clone so checkoutRef can resolve the commit.
		if opts.ReferenceName != "" {
			_ = os.RemoveAll(dir)
			if mkErr := os.MkdirAll(dir, 0o750); mkErr != nil {
				return nil, fmt.Errorf("git: recreate clone dir: %w", mkErr)
			}
			repo, err = gogit.PlainCloneContext(ctx, dir, false, &gogit.CloneOptions{
				URL:  url,
				Auth: auth.authMethod(),
				Tags: gogit.AllTags,
			})
		}
		if err != nil {
			_ = os.RemoveAll(dir)
			return nil, wrapTransport(err)
		}
	}
	return repo, nil
}

// checkoutRef fetches the latest refs then resolves ref and hard-resets the
// working tree to it, returning the resolved commit hash. An empty ref keeps the
// current HEAD (default branch) after fetching.
func checkoutRef(ctx context.Context, repo *gogit.Repository, url, ref string, auth *BasicAuth) (plumbing.Hash, error) {
	// Fetch so an existing clone sees new commits/tags. Force so non-fast-forward
	// branch moves are still mirrored locally.
	err := repo.FetchContext(ctx, &gogit.FetchOptions{
		RemoteName: "origin",
		Auth:       auth.authMethod(),
		Tags:       gogit.AllTags,
		Force:      true,
		RefSpecs: []config.RefSpec{
			"+refs/heads/*:refs/remotes/origin/*",
			"+refs/tags/*:refs/tags/*",
		},
	})
	if err != nil && !errors.Is(err, gogit.NoErrAlreadyUpToDate) {
		return plumbing.ZeroHash, wrapTransport(err)
	}

	hash, err := resolveRef(repo, ref)
	if err != nil {
		return plumbing.ZeroHash, err
	}

	wt, err := repo.Worktree()
	if err != nil {
		return plumbing.ZeroHash, fmt.Errorf("git: open worktree: %w", err)
	}
	if err := wt.Reset(&gogit.ResetOptions{Commit: hash, Mode: gogit.HardReset}); err != nil {
		return plumbing.ZeroHash, fmt.Errorf("git: reset to %s: %w", shortRef(ref), err)
	}
	return hash, nil
}

// resolveRef maps ref (branch, tag, or full/short commit hash; empty=default
// branch) to a concrete commit hash using the fetched remote refs.
func resolveRef(repo *gogit.Repository, ref string) (plumbing.Hash, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		head, err := repo.Head()
		if err != nil {
			return plumbing.ZeroHash, fmt.Errorf("git: resolve default HEAD: %w", err)
		}
		return head.Hash(), nil
	}

	// Try, in order: remote-tracking branch, tag, then a raw revision (hash).
	candidates := []plumbing.ReferenceName{
		plumbing.NewRemoteReferenceName("origin", ref),
		plumbing.NewTagReferenceName(ref),
	}
	for _, name := range candidates {
		if r, err := repo.Reference(name, true); err == nil {
			return r.Hash(), nil
		}
	}
	if h, err := repo.ResolveRevision(plumbing.Revision(ref)); err == nil && h != nil {
		return *h, nil
	}
	return plumbing.ZeroHash, fmt.Errorf("git: ref %q not found in repository", ref)
}

// readFileAt reads the bytes of path from the tree of commit hash. path is
// interpreted relative to the repository root; leading "./" or "/" are trimmed.
func readFileAt(repo *gogit.Repository, hash plumbing.Hash, path string) ([]byte, error) {
	clean := strings.TrimPrefix(strings.TrimSpace(path), "./")
	clean = strings.TrimPrefix(clean, "/")
	if clean == "" {
		return nil, fmt.Errorf("git: compose path is empty")
	}
	commit, err := repo.CommitObject(hash)
	if err != nil {
		return nil, fmt.Errorf("git: load commit %s: %w", hash.String(), err)
	}
	tree, err := commit.Tree()
	if err != nil {
		return nil, fmt.Errorf("git: load tree: %w", err)
	}
	f, err := tree.File(clean)
	if err != nil {
		if errors.Is(err, object.ErrFileNotFound) {
			return nil, fmt.Errorf("git: compose file %q not found at ref", clean)
		}
		return nil, fmt.Errorf("git: open %q: %w", clean, err)
	}
	contents, err := f.Contents()
	if err != nil {
		return nil, fmt.Errorf("git: read %q: %w", clean, err)
	}
	return []byte(contents), nil
}

// branchRefName returns the plumbing reference name for a branch/tag ref, or ""
// when ref is empty or looks like a commit hash (which is checked out post-clone).
func branchRefName(ref string) plumbing.ReferenceName {
	ref = strings.TrimSpace(ref)
	if ref == "" || looksLikeHash(ref) {
		return ""
	}
	return plumbing.NewBranchReferenceName(ref)
}

// looksLikeHash reports whether ref is a hex string of plausible commit-hash
// length (7..40 chars), so clone can skip pinning it as a branch name.
func looksLikeHash(ref string) bool {
	if len(ref) < 7 || len(ref) > 40 {
		return false
	}
	for _, c := range ref {
		isHex := (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
		if !isHex {
			return false
		}
	}
	return true
}

// shortRef renders a ref for error messages without leaking anything sensitive
// (a ref is a branch/tag/commit, never a credential).
func shortRef(ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "default branch"
	}
	return ref
}

// withTimeout returns ctx unchanged when it already has a deadline, otherwise a
// derived context bounded by defaultTimeout.
func withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	if _, ok := ctx.Deadline(); ok {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, defaultTimeout)
}

// wrapTransport normalizes go-git transport errors to a stable, non-leaky
// message. A repository URL may embed credentials; we never echo the raw error's
// URL, only a short reason.
func wrapTransport(err error) error {
	switch {
	case errors.Is(err, transport.ErrAuthenticationRequired):
		return errors.New("git: authentication required (set a token)")
	case errors.Is(err, transport.ErrAuthorizationFailed):
		return errors.New("git: authentication failed (bad token or no access)")
	case errors.Is(err, transport.ErrRepositoryNotFound):
		return errors.New("git: repository not found")
	case errors.Is(err, context.DeadlineExceeded):
		return errors.New("git: timed out contacting the repository")
	default:
		return fmt.Errorf("git: %s", sanitize(err.Error()))
	}
}

// sanitize strips anything after the first "://" host boundary that could carry
// an embedded credential, and collapses the message to a single line.
func sanitize(msg string) string {
	msg = strings.TrimSpace(msg)
	if i := strings.IndexByte(msg, '\n'); i >= 0 {
		msg = msg[:i]
	}
	// Redact a userinfo@ credential if a URL leaked into the message.
	if at := strings.Index(msg, "@"); at >= 0 {
		if scheme := strings.Index(msg, "://"); scheme >= 0 && scheme < at {
			msg = msg[:scheme+3] + "***@" + msg[at+1:]
		}
	}
	return msg
}
