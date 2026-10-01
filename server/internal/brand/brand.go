// Package brand holds Castor's brand identity and a startup integrity check
// for the embedded UI.
//
// Castor is Apache-2.0 licensed: anyone may fork it, rebuild it and ship the
// result under their own name, within the limits set by NOTICE and
// docs/community/TRADEMARKS.md. This package does not try to prevent that, and
// cannot. Its
// scope is narrower: it makes tampering with the brand inside a distributed
// Castor image detectable and blocking. Verify hashes the embedded logo and
// checks that the UI bundle still carries the attribution literal, so a binary
// whose embedded dist/ was edited after the fact (logo swapped, attribution
// stripped from the JS) refuses to start. A modified recompilation is out of
// scope here and is governed by NOTICE and docs/community/TRADEMARKS.md.
package brand

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"path"
)

const (
	// Name is the product name.
	Name = "Castor"
	// Vendor is the publisher shown in the attribution.
	Vendor = "IT Leonard"
	// Attribution is the exact mark the UI must display. Verify looks for this
	// literal in the built JS bundle.
	Attribution = "Castor by IT Leonard"
	// LogoPath is the logo location inside the embedded UI file system
	// (server/web/dist).
	LogoPath = "brand/castor-logo.jpg"
	// LogoSHA256 is the hex SHA-256 of the reference logo (ui/public/brand/castor-logo.jpg).
	LogoSHA256 = "46d4ed7265fdd3551e53b64bb190b702e75ca7af5c3986eaedad4a5b7bdafd61"
)

// assetsDir is the directory Vite emits the fingerprinted bundle into. Its
// absence means the embedded FS only holds the committed placeholder
// index.html (a `go build` without a prior UI build).
const assetsDir = "assets"

var (
	// ErrNoUIBundle is returned by Verify when the embedded FS has no assets/
	// directory, i.e. the binary was built without the UI (dev builds, unit
	// tests). Callers should treat it as a warning, not a failure: main.go logs
	// it and continues, while any other error from Verify is fatal.
	ErrNoUIBundle = errors.New("brand: no UI bundle embedded")
	// ErrLogo is wrapped by Verify when the logo is absent or its SHA-256 does
	// not match LogoSHA256.
	ErrLogo = errors.New("brand logo missing or altered")
	// ErrAttribution is wrapped by Verify when no JS file under assets/
	// contains the Attribution literal.
	ErrAttribution = errors.New("brand attribution missing from UI bundle")
)

// Identity is the brand information exposed by the API (healthz).
type Identity struct {
	Name        string `json:"name"`
	Vendor      string `json:"vendor"`
	Attribution string `json:"attribution"`
}

// Info returns the brand identity for the API.
func Info() Identity {
	return Identity{Name: Name, Vendor: Vendor, Attribution: Attribution}
}

// Verify checks the brand integrity of the embedded UI file system (the
// dist/ subtree, as returned by web.FS()).
//
// It returns ErrNoUIBundle when ui has no assets/ directory (build without
// UI). Otherwise it returns an error wrapping ErrLogo when LogoPath is missing
// or its SHA-256 differs from LogoSHA256, an error wrapping ErrAttribution
// when no assets/**/*.js contains Attribution, and nil when both checks pass.
//
// Intended use in main.go: ErrNoUIBundle is logged as a warning and startup
// continues; any other error aborts startup.
func Verify(ui fs.FS) error {
	return verify(ui, LogoSHA256)
}

// verify is Verify with the expected logo hash as a parameter so tests can
// exercise the checks with synthetic logo bytes.
func verify(ui fs.FS, wantLogoSHA256 string) error {
	info, err := fs.Stat(ui, assetsDir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return ErrNoUIBundle
		}
		return fmt.Errorf("brand: stat %s: %w", assetsDir, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("%w: %s is not a directory", ErrAttribution, assetsDir)
	}

	if err := verifyLogo(ui, wantLogoSHA256); err != nil {
		return err
	}
	return verifyAttribution(ui)
}

// verifyLogo reads LogoPath and compares its SHA-256 to want.
func verifyLogo(ui fs.FS, want string) error {
	data, err := fs.ReadFile(ui, LogoPath)
	if err != nil {
		return fmt.Errorf("%w: %s: %v", ErrLogo, LogoPath, err)
	}
	sum := sha256.Sum256(data)
	got := hex.EncodeToString(sum[:])
	if got != want {
		return fmt.Errorf("%w: %s: sha256 %s, want %s", ErrLogo, LogoPath, got, want)
	}
	return nil
}

// verifyAttribution walks assets/ and succeeds as soon as one .js file
// contains the Attribution literal.
func verifyAttribution(ui fs.FS) error {
	needle := []byte(Attribution)
	found := false
	err := fs.WalkDir(ui, assetsDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if found || d.IsDir() || path.Ext(p) != ".js" {
			return nil
		}
		data, err := fs.ReadFile(ui, p)
		if err != nil {
			return err
		}
		if bytes.Contains(data, needle) {
			found = true
			return fs.SkipAll
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("%w: walking %s: %v", ErrAttribution, assetsDir, err)
	}
	if !found {
		return fmt.Errorf("%w: no %s/**/*.js contains %q", ErrAttribution, assetsDir, Attribution)
	}
	return nil
}
