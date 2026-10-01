// Castor by IT Leonard
package brand

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

// testLogo is a synthetic logo payload; its hash stands in for LogoSHA256 in
// the hermetic tests so they do not depend on the real asset.
var testLogo = []byte("castor-test-logo\x00\x01\x02")

func testLogoSHA256() string {
	sum := sha256.Sum256(testLogo)
	return hex.EncodeToString(sum[:])
}

// goodFS returns an embedded-UI lookalike that passes every check when
// verified against testLogoSHA256().
func goodFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":     {Data: []byte("<!doctype html><div id=app></div>")},
		LogoPath:         {Data: testLogo},
		"assets/app.js":  {Data: []byte(`console.log("` + Attribution + `");`)},
		"assets/app.css": {Data: []byte("body{}")},
	}
}

func TestVerifyOK(t *testing.T) {
	if err := verify(goodFS(), testLogoSHA256()); err != nil {
		t.Fatalf("verify(good) = %v, want nil", err)
	}
}

func TestVerifyAlteredLogo(t *testing.T) {
	ui := goodFS()
	ui[LogoPath] = &fstest.MapFile{Data: append([]byte(nil), append(testLogo, 'x')...)}
	err := verify(ui, testLogoSHA256())
	if !errors.Is(err, ErrLogo) {
		t.Fatalf("verify(altered logo) = %v, want ErrLogo", err)
	}
}

func TestVerifyMissingLogo(t *testing.T) {
	ui := goodFS()
	delete(ui, LogoPath)
	err := verify(ui, testLogoSHA256())
	if !errors.Is(err, ErrLogo) {
		t.Fatalf("verify(missing logo) = %v, want ErrLogo", err)
	}
}

func TestVerifyMissingAttribution(t *testing.T) {
	ui := goodFS()
	ui["assets/app.js"] = &fstest.MapFile{Data: []byte(`console.log("Castor by Someone Else");`)}
	err := verify(ui, testLogoSHA256())
	if !errors.Is(err, ErrAttribution) {
		t.Fatalf("verify(no attribution) = %v, want ErrAttribution", err)
	}
	if errors.Is(err, ErrLogo) {
		t.Fatalf("verify(no attribution) must not report ErrLogo: %v", err)
	}
}

func TestVerifyAttributionOnlyInNonJS(t *testing.T) {
	ui := goodFS()
	ui["assets/app.js"] = &fstest.MapFile{Data: []byte(`console.log("x");`)}
	ui["assets/app.css"] = &fstest.MapFile{Data: []byte(`/* ` + Attribution + ` */`)}
	if err := verify(ui, testLogoSHA256()); !errors.Is(err, ErrAttribution) {
		t.Fatalf("attribution in .css only must not count, got %v", err)
	}
}

func TestVerifyAttributionInNestedJS(t *testing.T) {
	ui := goodFS()
	ui["assets/app.js"] = &fstest.MapFile{Data: []byte(`console.log("x");`)}
	ui["assets/chunks/brand-abc123.js"] = &fstest.MapFile{Data: []byte(`"` + Attribution + `"`)}
	if err := verify(ui, testLogoSHA256()); err != nil {
		t.Fatalf("attribution in nested chunk must pass, got %v", err)
	}
}

func TestVerifyNoUIBundle(t *testing.T) {
	ui := fstest.MapFS{
		"index.html": {Data: []byte("<!doctype html><title>Castor</title>")},
	}
	err := verify(ui, testLogoSHA256())
	if !errors.Is(err, ErrNoUIBundle) {
		t.Fatalf("verify(placeholder only) = %v, want ErrNoUIBundle", err)
	}
	// The sentinel must be returned as-is so callers can compare with ==.
	if err != ErrNoUIBundle {
		t.Fatalf("verify(placeholder only) must return the bare sentinel, got %v", err)
	}
}

func TestVerifyNoUIBundleTakesPrecedenceOverLogo(t *testing.T) {
	// A logo without an assets/ directory is still "no bundle": the dev
	// caller must get the warning-grade sentinel, not a fatal logo error.
	ui := fstest.MapFS{
		"index.html": {Data: []byte("<!doctype html>")},
		LogoPath:     {Data: []byte("whatever")},
	}
	if err := verify(ui, testLogoSHA256()); !errors.Is(err, ErrNoUIBundle) {
		t.Fatalf("verify(logo, no assets) = %v, want ErrNoUIBundle", err)
	}
}

func TestVerifyUsesLogoSHA256Constant(t *testing.T) {
	// The exported Verify must reject the synthetic logo, whose hash differs
	// from LogoSHA256; this pins Verify to the constant.
	if err := Verify(goodFS()); !errors.Is(err, ErrLogo) {
		t.Fatalf("Verify(synthetic logo) = %v, want ErrLogo", err)
	}
}

func TestInfo(t *testing.T) {
	got := Info()
	want := Identity{Name: "Castor", Vendor: "IT Leonard", Attribution: "Castor by IT Leonard"}
	if got != want {
		t.Fatalf("Info() = %+v, want %+v", got, want)
	}
	if Attribution != Name+" by "+Vendor {
		t.Fatalf("Attribution %q must be Name + \" by \" + Vendor", Attribution)
	}
}

// TestLogoSHA256MatchesSourceAsset pins LogoSHA256 to the reference asset in
// the repository. It is skipped when the asset is not reachable (e.g. the
// package is tested outside the source tree).
func TestLogoSHA256MatchesSourceAsset(t *testing.T) {
	src := filepath.Join("..", "..", "..", "ui", "public", "brand", "castor-logo.jpg")
	data, err := os.ReadFile(src)
	if err != nil {
		t.Skipf("reference logo not available: %v", err)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != LogoSHA256 {
		t.Fatalf("LogoSHA256 = %s but %s hashes to %s; update the constant or restore the asset", LogoSHA256, src, got)
	}

	// The exported Verify must accept the real logo alongside a bundle that
	// carries the attribution.
	ui := goodFS()
	ui[LogoPath] = &fstest.MapFile{Data: data}
	if err := Verify(ui); err != nil {
		t.Fatalf("Verify(real logo) = %v, want nil", err)
	}
}
