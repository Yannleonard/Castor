// Package web embeds the built React UI (Vite output copied to dist/) and
// serves it with SPA fallback. The Docker node stage populates dist/; a
// placeholder dist/index.html is committed so go:embed never fails before a UI
// build has run.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// sub returns the embedded dist/ subtree as an fs.FS.
func sub() fs.FS {
	f, err := fs.Sub(distFS, "dist")
	if err != nil {
		// Embedding guarantees dist/ exists (placeholder committed); panic only
		// on a programming error in the embed directive.
		panic("web: dist subtree missing: " + err.Error())
	}
	return f
}

// Handler returns an http.Handler that serves the embedded SPA. Unknown,
// non-asset routes fall back to index.html so client-side routing works. The
// caller mounts this on the non-/api path space; /api is handled by the router.
func Handler() http.Handler {
	content := sub()
	fileServer := http.FileServer(http.FS(content))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqPath := strings.TrimPrefix(r.URL.Path, "/")
		if reqPath == "" {
			reqPath = "index.html"
		}

		// If the requested file exists, serve it directly with sensible caching.
		if f, err := content.Open(reqPath); err == nil {
			_ = f.Close()
			setCacheHeaders(w, reqPath)
			fileServer.ServeHTTP(w, r)
			return
		}

		// SPA fallback: serve index.html for any unknown non-asset route.
		w.Header().Set("Cache-Control", "no-cache")
		serveIndex(w, r, content)
	})
}

// serveIndex writes dist/index.html (the SPA entrypoint).
func serveIndex(w http.ResponseWriter, r *http.Request, content fs.FS) {
	data, err := fs.ReadFile(content, "index.html")
	if err != nil {
		http.Error(w, "UI not built", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// setCacheHeaders applies long cache for fingerprinted assets, none for HTML.
func setCacheHeaders(w http.ResponseWriter, reqPath string) {
	ext := strings.ToLower(path.Ext(reqPath))
	switch ext {
	case ".html":
		w.Header().Set("Cache-Control", "no-cache")
	case ".js", ".css", ".woff", ".woff2", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".ico":
		// Vite fingerprints asset filenames, so they are safe to cache long-term.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
}
