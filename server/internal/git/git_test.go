// Castor by IT Leonard
package git

import (
	"context"
	"errors"
	"testing"
)

// TestValidateRepoURL asserts the scheme allowlist: only http:// and https://
// (case-insensitive) are accepted, and every other scheme — file://, ssh://,
// git://, and scheme-less input — is rejected so a stack cannot be pointed at a
// local repository (LFI) or an internal network endpoint (SSRF).
func TestValidateRepoURL(t *testing.T) {
	ok := []string{
		"http://example.com/repo.git",
		"https://example.com/repo.git",
		"HTTPS://Example.com/repo.git", // scheme compared case-insensitively
		"HtTp://example.com/repo",
	}
	for _, u := range ok {
		if err := ValidateRepoURL(u); err != nil {
			t.Errorf("ValidateRepoURL(%q) = %v, want nil", u, err)
		}
	}

	bad := []string{
		"file:///etc/passwd",
		"file://./local-repo",
		"ssh://git@example.com/repo.git",
		"git://example.com/repo.git",
		"ftp://example.com/repo.git",
		"/tmp/local/repo",         // no scheme
		"git@github.com:org/repo", // scp-style, no ://
		"example.com/repo.git",    // no scheme
	}
	for _, u := range bad {
		if err := ValidateRepoURL(u); !errors.Is(err, ErrUnsupportedScheme) {
			t.Errorf("ValidateRepoURL(%q) = %v, want ErrUnsupportedScheme", u, err)
		}
	}

	if err := ValidateRepoURL(""); !errors.Is(err, ErrEmptyURL) {
		t.Errorf("ValidateRepoURL(\"\") = %v, want ErrEmptyURL", err)
	}
	if err := ValidateRepoURL("   "); !errors.Is(err, ErrEmptyURL) {
		t.Errorf("ValidateRepoURL(spaces) = %v, want ErrEmptyURL", err)
	}
}

// TestSyncToRejectsNonHTTPScheme confirms SyncTo enforces the allowlist before it
// touches the filesystem or the network: a file:// URL must fail fast with
// ErrUnsupportedScheme and never open a local repository.
func TestSyncToRejectsNonHTTPScheme(t *testing.T) {
	dir := t.TempDir()
	_, err := SyncTo(context.Background(), dir, "file://"+dir, "", "docker-compose.yml", nil)
	if !errors.Is(err, ErrUnsupportedScheme) {
		t.Fatalf("SyncTo(file://...) = %v, want ErrUnsupportedScheme", err)
	}

	_, err = SyncTo(context.Background(), dir, "ssh://git@example.com/x.git", "", "docker-compose.yml", nil)
	if !errors.Is(err, ErrUnsupportedScheme) {
		t.Fatalf("SyncTo(ssh://...) = %v, want ErrUnsupportedScheme", err)
	}
}
