// Package version exposes build metadata, set via -ldflags at build time.
package version

// These vars are overridden at build time with:
//
//	-ldflags "-X github.com/gtek-it/castor/server/internal/version.Version=v1.0.0 \
//	          -X github.com/gtek-it/castor/server/internal/version.Commit=<sha>"
var (
	// Version is the semantic version of this build.
	Version = "dev"
	// Commit is the git commit sha of this build.
	Commit = "none"
)
