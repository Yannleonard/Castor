// Castor by IT Leonard
package tlsmgr

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRedirectHandler(t *testing.T) {
	app := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	cases := []struct {
		name       string
		httpsAddr  string
		trustProxy bool
		method     string
		host       string
		target     string
		xfp        string
		wantCode   int
		wantLoc    string
	}{
		// Contract cases.
		{"bare host -> default https port", ":8443", false, http.MethodGet, "castor.example.com", "/", "", http.StatusPermanentRedirect, "https://castor.example.com/"},
		{"explicit port -> https listen port", ":8443", false, http.MethodGet, "localhost:8080", "/", "", http.StatusPermanentRedirect, "https://localhost:8443/"},
		{"proxied https is not redirected", ":8443", true, http.MethodGet, "castor.example.com", "/", "https", http.StatusOK, ""},
		{"untrusted proxy header is ignored", ":8443", false, http.MethodGet, "castor.example.com", "/", "https", http.StatusPermanentRedirect, "https://castor.example.com/"},
		{"trusted proxy on http still redirects", ":8443", true, http.MethodGet, "castor.example.com", "/", "http", http.StatusPermanentRedirect, "https://castor.example.com/"},
		{"proxy chain first hop https", ":8443", true, http.MethodGet, "castor.example.com", "/", "https, http", http.StatusOK, ""},
		{"port 80 counts as default", ":8443", false, http.MethodGet, "castor.example.com:80", "/x", "", http.StatusPermanentRedirect, "https://castor.example.com/x"},
		// Path/query preservation and formatting.
		{"path and query kept", ":8443", false, http.MethodGet, "castor.local:8080", "/foo?x=1", "", http.StatusPermanentRedirect, "https://castor.local:8443/foo?x=1"},
		{"https on 443 omits port", ":443", false, http.MethodGet, "castor.local:8080", "/dash", "", http.StatusPermanentRedirect, "https://castor.local/dash"},
		{"explicit bind host ignored", "0.0.0.0:9443", false, http.MethodGet, "castor.local:8080", "/a/b", "", http.StatusPermanentRedirect, "https://castor.local:9443/a/b"},
		{"ipv6 host with port", ":8443", false, http.MethodGet, "[::1]:8080", "/", "", http.StatusPermanentRedirect, "https://[::1]:8443/"},
		{"ipv6 host bare", ":8443", false, http.MethodGet, "[::1]", "/", "", http.StatusPermanentRedirect, "https://[::1]/"},
		{"ipv4 host", ":8443", false, http.MethodGet, "192.0.2.5:8080", "/x", "", http.StatusPermanentRedirect, "https://192.0.2.5:8443/x"},
		{"post preserved by 308", ":8443", false, http.MethodPost, "castor.local:8080", "/api/v1/stacks", "", http.StatusPermanentRedirect, "https://castor.local:8443/api/v1/stacks"},
		// Pass-through paths.
		{"healthz passes", ":8443", false, http.MethodGet, "castor.local:8080", HealthzPath, "", http.StatusOK, ""},
		{"healthz with query passes", ":8443", false, http.MethodGet, "castor.local:8080", HealthzPath + "?probe=1", "", http.StatusOK, ""},
		{"acme challenge passes", ":8443", false, http.MethodGet, "castor.local:8080", ACMEChallengePrefix + "token", "", http.StatusOK, ""},
		{"other api paths redirect", ":8443", false, http.MethodGet, "castor.local:8080", "/api/v1/hosts", "", http.StatusPermanentRedirect, "https://castor.local:8443/api/v1/hosts"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := RedirectHandler(c.httpsAddr, c.trustProxy, app)
			req := httptest.NewRequest(c.method, "http://"+c.host+c.target, nil)
			req.Host = c.host
			if c.xfp != "" {
				req.Header.Set("X-Forwarded-Proto", c.xfp)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != c.wantCode {
				t.Fatalf("code = %d want %d", rec.Code, c.wantCode)
			}
			if got := rec.Header().Get("Location"); got != c.wantLoc {
				t.Errorf("Location = %q want %q", got, c.wantLoc)
			}
			if c.wantCode == http.StatusPermanentRedirect && rec.Header().Get("Cache-Control") != "no-store" {
				t.Errorf("redirect must carry Cache-Control: no-store")
			}
			if c.wantCode == http.StatusOK && rec.Body.String() != `{"ok":true}` {
				t.Errorf("pass-through body = %q", rec.Body.String())
			}
		})
	}
}

func TestRedirectHandlerEmptyHost(t *testing.T) {
	h := RedirectHandler(":8443", false, http.NotFoundHandler())
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Host = ""
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusPermanentRedirect || rec.Header().Get("Location") != "https://localhost/" {
		t.Errorf("empty Host: code=%d location=%q", rec.Code, rec.Header().Get("Location"))
	}
}

// TestPublicHTTPSURL pins the origin rule the redirect and the Settings UI
// share: no trailing slash, default ports collapse, listen port otherwise.
func TestPublicHTTPSURL(t *testing.T) {
	cases := []struct{ httpsAddr, host, want string }{
		{":8443", "castor.example.com", "https://castor.example.com"},
		{":8443", "castor.example.com:80", "https://castor.example.com"},
		{":8443", "localhost:8080", "https://localhost:8443"},
		{":443", "localhost:8080", "https://localhost"},
		{"0.0.0.0:9443", "10.0.0.5:8080", "https://10.0.0.5:9443"},
		{":8443", "[::1]:8080", "https://[::1]:8443"},
		{":8443", "", "https://localhost"},
	}
	for _, c := range cases {
		if got := PublicHTTPSURL(c.httpsAddr, c.host); got != c.want {
			t.Errorf("PublicHTTPSURL(%q, %q) = %q want %q", c.httpsAddr, c.host, got, c.want)
		}
	}
	m := newTestManager(t, "self-signed")
	if got := m.PublicHTTPSURL("castor.local:8080"); got != "https://castor.local:8443" {
		t.Errorf("Manager.PublicHTTPSURL = %q", got)
	}
}
