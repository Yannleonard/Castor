package tlsmgr

import (
	"net"
	"net/http"
	"strings"
)

// HealthzPath is served on the plain-HTTP listener without redirection so the
// container HEALTHCHECK (`castor healthcheck`) keeps working when TLS is on.
const HealthzPath = "/api/v1/healthz"

// RedirectHandler is the plain-HTTP handler used when TLS is active. It passes
// through untouched: HealthzPath, ACME HTTP-01 challenges (the CA fetches them
// on port 80 and must never be bounced), and, when trustProxy is set, requests
// the upstream proxy already received over HTTPS (X-Forwarded-Proto: https;
// redirecting those would loop through the proxy). Everything else gets a 308
// to PublicHTTPSURL plus the request path and query. The redirect carries
// Cache-Control: no-store so a browser does not pin it after the operator
// switches TLS off again.
func RedirectHandler(httpsAddr string, trustProxy bool, app http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if passThrough(r.URL.Path) || (trustProxy && forwardedHTTPS(r)) {
			app.ServeHTTP(w, r)
			return
		}
		target := PublicHTTPSURL(httpsAddr, r.Host) + r.URL.RequestURI()
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, target, http.StatusPermanentRedirect)
	})
}

// passThrough reports whether path is always answered on plain HTTP.
func passThrough(path string) bool {
	return path == HealthzPath || strings.HasPrefix(path, ACMEChallengePrefix)
}

// forwardedHTTPS reports whether the first hop recorded in X-Forwarded-Proto
// is https, i.e. the proxy terminated TLS for this request. Only meaningful
// when the proxy is trusted.
func forwardedHTTPS(r *http.Request) bool {
	proto := r.Header.Get("X-Forwarded-Proto")
	if i := strings.IndexByte(proto, ','); i >= 0 {
		proto = proto[:i]
	}
	return strings.EqualFold(strings.TrimSpace(proto), "https")
}

// PublicHTTPSURL returns the HTTPS origin (no trailing slash) a client that
// reached the plain-HTTP listener with the given Host header should use. It is
// the rule the redirect applies and the URL the Settings UI advertises:
//
//   - Host without a port, or on port 80: the deployment publishes the standard
//     ports (80 -> HTTP listener, 443 -> HTTPS listener), so https://host.
//   - Any other port: the listeners are published as-is, so the HTTPS listen
//     port of httpsAddr is used (omitted when it is 443).
//
// An empty Host yields localhost.
func PublicHTTPSURL(httpsAddr, host string) string {
	_, httpsPort, _ := net.SplitHostPort(httpsAddr)
	h, p := splitHostPort(host)
	if h == "" {
		h = "localhost"
	}
	if p == "" || p == "80" {
		return "https://" + bracket(h)
	}
	return "https://" + joinHostPort(h, httpsPort)
}

// PublicHTTPSURL applies the package-level rule with the manager's HTTPS
// listen address.
func (m *Manager) PublicHTTPSURL(host string) string {
	return PublicHTTPSURL(m.httpsAddr, host)
}

// splitHostPort splits a Host header into host (IPv6 brackets stripped) and
// port, the latter empty when absent ("[::1]:8080" -> "::1", "8080").
func splitHostPort(hostport string) (host, port string) {
	if h, p, err := net.SplitHostPort(hostport); err == nil {
		return h, p
	}
	return strings.Trim(hostport, "[]"), ""
}

// bracket formats host for a URL authority, bracketing IPv6 literals.
func bracket(host string) string {
	if strings.Contains(host, ":") {
		return "[" + host + "]"
	}
	return host
}

// joinHostPort formats host:port for a URL authority, omitting the port when it
// is the HTTPS default.
func joinHostPort(host, port string) string {
	host = bracket(host)
	if port == "" || port == "443" {
		return host
	}
	return host + ":" + port
}

// HTTPHandler returns the handler for the plain-HTTP listener while TLS is
// active. ACME HTTP-01 challenges are answered by the current autocert manager
// when ACME is configured. Everything else goes to RedirectHandler when
// redirect is true, or straight to app (dual HTTP + HTTPS) when false.
func (m *Manager) HTTPHandler(app http.Handler, redirect bool) http.Handler {
	fallback := app
	if redirect {
		fallback = RedirectHandler(m.httpsAddr, m.trustProxy, app)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, ACMEChallengePrefix) {
			if st := m.state.Load(); st.acme != nil && st.acme.http != nil {
				st.acme.http.ServeHTTP(w, r)
				return
			}
		}
		fallback.ServeHTTP(w, r)
	})
}
