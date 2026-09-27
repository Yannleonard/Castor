package api

import (
	"net/http"
	"testing"

	"github.com/gtek-it/castor/server/internal/brand"
)

// TestHealthzBrand pins the public brand block on /api/v1/healthz: the
// attribution reported by a running instance must be the one the brand
// package defines (and the startup check verifies in the embedded UI).
func TestHealthzBrand(t *testing.T) {
	e := newTestEnv(t)
	rec := e.do(t, http.MethodGet, "/api/v1/healthz", nil, nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("healthz code = %d, body %s", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)

	b, ok := body["brand"].(map[string]any)
	if !ok {
		t.Fatalf("healthz body has no brand object: %v", body)
	}
	if got := b["attribution"]; got != "Castor by IT Leonard" {
		t.Errorf("brand.attribution = %v, want %q", got, "Castor by IT Leonard")
	}
	if got := b["name"]; got != brand.Name {
		t.Errorf("brand.name = %v, want %q", got, brand.Name)
	}
	if got := b["vendor"]; got != brand.Vendor {
		t.Errorf("brand.vendor = %v, want %q", got, brand.Vendor)
	}
}
