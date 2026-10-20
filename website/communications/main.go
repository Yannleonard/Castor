// Castor website communications API: a small, persistent source of truth for
// the announcement strip shown by Castor. The public API exposes only one
// currently published message; management routes require their configured authentication.
package main

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed admin.html announcements.js
var assets embed.FS

//go:embed account.html account.js customers-admin.html
var customerAssets embed.FS

const (
	dataDir        = "/data"
	storePath      = dataDir + "/announcements.json"
	tokenPath      = dataDir + "/admin-token"
	maxRequestSize = 900 << 10
	maxImageSize   = 512 << 10
)

type announcement struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Title     string    `json:"title"`
	Message   string    `json:"message"`
	Link      string    `json:"link,omitempty"`
	ImageData string    `json:"imageData,omitempty"`
	ImageType string    `json:"imageType,omitempty"`
	Enabled   bool      `json:"enabled"`
	StartsAt  string    `json:"startsAt,omitempty"`
	EndsAt    string    `json:"endsAt,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type store struct {
	mu    sync.RWMutex
	items []announcement
	path  string
}

func main() {
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		log.Fatal(err)
	}
	if err := ensurePrivateDataDir(dataDir); err != nil {
		log.Fatal(err)
	}
	if token := strings.TrimSpace(os.Getenv("CASTOR_ANNOUNCEMENTS_ADMIN_TOKEN")); len(token) < 32 {
		log.Fatal("CASTOR_ANNOUNCEMENTS_ADMIN_TOKEN must be configured with at least 32 characters")
	}
	token, err := adminToken()
	if err != nil {
		log.Fatal(err)
	}
	s := &store{path: storePath}
	if err := s.load(); err != nil {
		log.Fatal(err)
	}
	if err := ensurePrivateFile(storePath); err != nil {
		log.Fatal(err)
	}
	customers, err := newCustomerService(customerStorePath)
	if err != nil {
		log.Fatal(err)
	}
	if err := ensurePrivateFile(customerStorePath); err != nil {
		log.Fatal(err)
	}
	mailer := newM365Service()
	if err := ensurePrivateFile(m365ConfigPath); err != nil {
		log.Fatal(err)
	}
	customers.mailer = mailer
	customerAdminAuth, err := newCustomerAdminAuth(customerAdminAuthPath)
	if err != nil {
		log.Fatal(err)
	}
	if err := ensurePrivateFile(customerAdminAuthPath); err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok\n")
	})
	mux.HandleFunc("GET /js/announcements.js", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		js, err := assets.ReadFile("announcements.js")
		if err != nil {
			http.Error(w, "announcement script unavailable", http.StatusInternalServerError)
			return
		}
		_, _ = w.Write(js)
	})
	mux.HandleFunc("/", siteHandler("/site"))
	mux.HandleFunc("GET /api/announcements/current", s.current)
	mux.HandleFunc("/api/admin/announcements", withBearer(token, s.manage))
	mux.HandleFunc("/api/admin/announcements/", withBearer(token, s.manage))
	mux.HandleFunc("GET /account", serveEmbeddedPage("account.html"))
	mux.HandleFunc("GET /account/", serveEmbeddedPage("account.html"))
	mux.HandleFunc("GET /account.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		js, err := customerAssets.ReadFile("account.js")
		if err != nil {
			http.Error(w, "account page unavailable", http.StatusInternalServerError)
			return
		}
		_, _ = w.Write(js)
	})
	mux.HandleFunc("/api/account/register", customers.register)
	mux.HandleFunc("/api/account/login", customers.login)
	mux.HandleFunc("/api/account/", customers.account)
	mux.HandleFunc("POST /api/activation/verify", customers.verifyActivation)
	mux.HandleFunc("GET /admin/customers", serveEmbeddedPage("customers-admin.html"))
	mux.HandleFunc("POST /api/admin/auth/login", customerAdminOrigin(customerAdminAuth.login))
	mux.HandleFunc("GET /api/admin/auth/session", customerAdminOrigin(customerAdminAuth.session))
	mux.HandleFunc("/api/admin/auth/totp/enroll", customerAdminOrigin(customerAdminAuth.enroll))
	mux.HandleFunc("GET /api/admin/auth/totp/qr", customerAdminOrigin(customerAdminAuth.enrollmentQRCode))
	mux.HandleFunc("POST /api/admin/auth/totp/confirm", customerAdminOrigin(customerAdminAuth.confirmTOTP))
	mux.HandleFunc("POST /api/admin/auth/logout", customerAdminOrigin(customerAdminAuth.logout))
	mux.HandleFunc("GET /api/admin/mail", customerAdminOrigin(customerAdminAuth.require(mailer.view)))
	mux.HandleFunc("PUT /api/admin/mail", customerAdminOrigin(customerAdminAuth.require(mailer.update)))
	mux.HandleFunc("POST /api/admin/mail/test", customerAdminOrigin(customerAdminAuth.require(mailer.test)))
	mux.HandleFunc("/api/admin/customers", customerAdminOrigin(customerAdminAuth.require(customers.admin)))
	mux.HandleFunc("/api/admin/customers/", customerAdminOrigin(customerAdminAuth.require(customers.admin)))
	mux.HandleFunc("/admin", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin" && r.URL.Path != "/admin/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		page, err := assets.ReadFile("admin.html")
		if err != nil {
			http.Error(w, "admin page unavailable", http.StatusInternalServerError)
			return
		}
		_, _ = w.Write(page)
	})
	mux.HandleFunc("GET /admin/customers/", serveEmbeddedPage("customers-admin.html"))
	addr := ":8099"
	log.Printf("Castor communications API listening on %s; admin token is stored in %s", addr, tokenPath)
	server := &http.Server{
		Addr:              addr,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		// Microsoft 365 test sends make OAuth and Graph requests in sequence.
		// Keep the response connection alive long enough for the handler to
		// return its classified error instead of Nginx reporting a disconnect.
		WriteTimeout:   45 * time.Second,
		IdleTimeout:    60 * time.Second,
		MaxHeaderBytes: 16 << 10,
	}
	log.Fatal(server.ListenAndServe())
}

func adminToken() (string, error) {
	if v := strings.TrimSpace(os.Getenv("CASTOR_ANNOUNCEMENTS_ADMIN_TOKEN")); v != "" {
		if len(v) < 32 {
			return "", errors.New("CASTOR_ANNOUNCEMENTS_ADMIN_TOKEN must be at least 32 characters")
		}
		return v, nil
	}
	if b, err := os.ReadFile(tokenPath); err == nil {
		if err := os.Chmod(tokenPath, 0600); err != nil {
			return "", err
		}
		v := strings.TrimSpace(string(b))
		if len(v) >= 32 {
			return v, nil
		}
		return "", errors.New("stored admin token is invalid; remove /data/admin-token to generate a new one")
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	v := hex.EncodeToString(b)
	if err := os.WriteFile(tokenPath, []byte(v+"\n"), 0600); err != nil {
		return "", err
	}
	return v, nil
}

func ensurePrivateDataDir(path string) error {
	if err := os.Chmod(path, 0700); err != nil {
		return err
	}
	return nil
}

func ensurePrivateFile(path string) error {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	return os.Chmod(path, 0600)
}

func (s *store) load() error {
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(b) > 16<<20 {
		return errors.New("announcement store exceeds 16 MiB")
	}
	return json.Unmarshal(b, &s.items)
}

func (s *store) saveLocked() error {
	b, err := json.MarshalIndent(s.items, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err = os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	if err = os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (s *store) current(w http.ResponseWriter, _ *http.Request) {
	now := time.Now().UTC()
	s.mu.RLock()
	defer s.mu.RUnlock()
	active := make([]announcement, 0, len(s.items))
	for _, a := range s.items {
		if !a.Enabled {
			continue
		}
		if a.StartsAt != "" {
			t, err := time.Parse(time.RFC3339, a.StartsAt)
			if err != nil || now.Before(t) {
				continue
			}
		}
		if a.EndsAt != "" {
			t, err := time.Parse(time.RFC3339, a.EndsAt)
			if err != nil || !now.Before(t) {
				continue
			}
		}
		active = append(active, a)
	}
	if len(active) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	sort.Slice(active, func(i, j int) bool { return active[i].UpdatedAt.After(active[j].UpdatedAt) })
	w.Header().Set("Cache-Control", "public, max-age=30, stale-while-revalidate=60")
	writeJSON(w, http.StatusOK, active[0])
}

func (s *store) manage(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/admin/announcements")
	id = strings.Trim(id, "/")
	switch r.Method {
	case http.MethodGet:
		if id != "" {
			http.NotFound(w, r)
			return
		}
		s.mu.RLock()
		defer s.mu.RUnlock()
		writeJSON(w, http.StatusOK, map[string]any{"announcements": s.items})
	case http.MethodPost:
		if id != "" {
			http.NotFound(w, r)
			return
		}
		a, err := decodeAnnouncement(w, r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			http.Error(w, "could not create id", http.StatusInternalServerError)
			return
		}
		a.ID = hex.EncodeToString(b)
		a.UpdatedAt = time.Now().UTC()
		s.mu.Lock()
		if len(s.items) >= 20 {
			s.mu.Unlock()
			http.Error(w, "maximum of 20 announcements reached", http.StatusConflict)
			return
		}
		s.items = append(s.items, a)
		err = s.saveLocked()
		s.mu.Unlock()
		if err != nil {
			http.Error(w, "could not save announcement", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusCreated, a)
	case http.MethodPut:
		if id == "" {
			http.NotFound(w, r)
			return
		}
		a, err := decodeAnnouncement(w, r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		idx := -1
		for i := range s.items {
			if s.items[i].ID == id {
				idx = i
				break
			}
		}
		if idx < 0 {
			http.NotFound(w, r)
			return
		}
		a.ID = id
		a.UpdatedAt = time.Now().UTC()
		s.items[idx] = a
		if err := s.saveLocked(); err != nil {
			http.Error(w, "could not save announcement", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, a)
	case http.MethodDelete:
		if id == "" {
			http.Error(w, "announcement id is required", http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		for i := range s.items {
			if s.items[i].ID == id {
				s.items = append(s.items[:i], s.items[i+1:]...)
				if err := s.saveLocked(); err != nil {
					http.Error(w, "could not save announcement", http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		http.NotFound(w, r)
	default:
		w.Header().Set("Allow", "GET, POST, PUT, DELETE")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func decodeAnnouncement(w http.ResponseWriter, r *http.Request) (announcement, error) {
	var a announcement
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		return a, errors.New("Content-Type must be application/json")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestSize)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&a); err != nil {
		return a, errors.New("invalid announcement JSON (maximum request size is 900 KiB)")
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return a, errors.New("announcement body must contain a single JSON value")
	}
	a.Kind = strings.TrimSpace(a.Kind)
	a.Title = strings.TrimSpace(a.Title)
	a.Message = strings.TrimSpace(a.Message)
	a.Link = strings.TrimSpace(a.Link)
	if a.Kind != "info" && a.Kind != "update" && a.Kind != "commercial" {
		return a, errors.New("type must be info, update, or commercial")
	}
	if a.Title == "" || len([]rune(a.Title)) > 100 {
		return a, errors.New("title is required and must be at most 100 characters")
	}
	if a.Message == "" || len([]rune(a.Message)) > 300 {
		return a, errors.New("message is required and must be at most 300 characters")
	}
	if a.Link != "" {
		u, err := url.ParseRequestURI(a.Link)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
			return a, errors.New("link must be an absolute HTTPS URL")
		}
	}
	for _, raw := range []string{a.StartsAt, a.EndsAt} {
		if raw != "" {
			if _, err := time.Parse(time.RFC3339, raw); err != nil {
				return a, errors.New("schedule dates must use RFC3339 format")
			}
		}
	}
	if a.StartsAt != "" && a.EndsAt != "" {
		start, _ := time.Parse(time.RFC3339, a.StartsAt)
		end, _ := time.Parse(time.RFC3339, a.EndsAt)
		if !end.After(start) {
			return a, errors.New("end date must be after start date")
		}
	}
	if a.ImageData != "" {
		if !strings.HasPrefix(a.ImageData, "data:") {
			return a, errors.New("image must be a PNG or JPEG data URL")
		}
		comma := strings.IndexByte(a.ImageData, ',')
		if comma < 0 {
			return a, errors.New("invalid image data URL")
		}
		header, data := a.ImageData[:comma], a.ImageData[comma+1:]
		if header != "data:image/png;base64" && header != "data:image/jpeg;base64" {
			return a, errors.New("only PNG and JPEG images are supported")
		}
		b, err := base64.StdEncoding.DecodeString(data)
		if err != nil || len(b) == 0 || len(b) > maxImageSize {
			return a, errors.New("image must be valid base64 and no larger than 512 KiB")
		}
		cfg, _, err := image.DecodeConfig(bytes.NewReader(b))
		if err != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 2400 || cfg.Height > 1200 || int64(cfg.Width)*int64(cfg.Height) > 2_000_000 {
			return a, errors.New("image must be a valid PNG/JPEG no larger than 2400×1200 or 2 megapixels")
		}
		if (header == "data:image/png;base64" && !strings.HasPrefix(http.DetectContentType(b), "image/png")) || (header == "data:image/jpeg;base64" && !strings.HasPrefix(http.DetectContentType(b), "image/jpeg")) {
			return a, errors.New("image format does not match its data URL")
		}
		a.ImageType = strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	} else {
		a.ImageData = ""
		a.ImageType = ""
	}
	return a, nil
}

func customerAdminOrigin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost && r.Method != http.MethodDelete && r.Method != http.MethodPut {
			methodNotAllowed(w)
			return
		}
		fetchSite := r.Header.Get("Sec-Fetch-Site")
		if fetchSite != "" && fetchSite != "same-origin" && fetchSite != "none" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.Host == "" || !strings.EqualFold(u.Host, r.Host) || (u.Scheme != "https" && u.Scheme != "http") {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
				return
			}
		} else if fetchSite != "same-origin" && fetchSite != "none" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
			return
		}
		next(w, r)
	}
}

func withBearer(token string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if len(provided) != len(token) || subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'self'; form-action 'self' https://www.paypal.com; img-src 'self' data: blob: https://www.paypal.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'")
		next.ServeHTTP(w, r)
	})
}

func siteHandler(root string) http.HandlerFunc {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		rootAbs = root
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		rel := strings.TrimPrefix(r.URL.Path, "/")
		if rel == "" {
			rel = "index.html"
		}
		for _, segment := range strings.Split(filepath.ToSlash(rel), "/") {
			if segment == "" || segment == "." || segment == ".." || strings.HasPrefix(segment, ".") {
				serveSiteNotFound(w, r, rootAbs)
				return
			}
		}

		filename := filepath.Join(rootAbs, filepath.FromSlash(rel))
		resolved, err := filepath.EvalSymlinks(filename)
		if err != nil || !sitePathWithinRoot(rootAbs, resolved) {
			serveSiteNotFound(w, r, rootAbs)
			return
		}
		info, err := os.Stat(resolved)
		if err != nil {
			serveSiteNotFound(w, r, rootAbs)
			return
		}
		if info.IsDir() {
			resolved = filepath.Join(resolved, "index.html")
			resolved, err = filepath.EvalSymlinks(resolved)
			if err != nil || !sitePathWithinRoot(rootAbs, resolved) {
				serveSiteNotFound(w, r, rootAbs)
				return
			}
			info, err = os.Stat(resolved)
			if err != nil || info.IsDir() {
				serveSiteNotFound(w, r, rootAbs)
				return
			}
		}

		if filepath.ToSlash(rel) == "index.html" {
			body, err := os.ReadFile(resolved)
			if err != nil {
				serveSiteNotFound(w, r, rootAbs)
				return
			}
			accountLink := []byte(`<a class="btn btn--primary btn--sm" href="/account">Espace client - Support</a>`)
			navActions := []byte(`<div class="nav__actions" id="nav-actions">`)
			oldFloatingLink := []byte(`<a href="/account" style="position:fixed;right:22px;bottom:22px;z-index:9999;padding:11px 16px;border-radius:999px;background:#0a2540;color:#fff;text-decoration:none;font:600 14px system-ui, sans-serif;box-shadow:0 6px 20px #0a254033">Espace client · Support</a>`)
			if bytes.Contains(body, oldFloatingLink) {
				body = bytes.Replace(body, oldFloatingLink, nil, 1)
			}
			if !bytes.Contains(body, []byte(`href="/account"`)) && bytes.Contains(body, navActions) {
				body = bytes.Replace(body, navActions, append(navActions, accountLink...), 1)
			}
			announcementScript := []byte(`<script src="/js/announcements.js" defer></script>`)
			if bytes.Contains(body, []byte("</body>")) {
				body = bytes.Replace(body, []byte("</body>"), append(announcementScript, []byte("\n</body>")...), 1)
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
			w.WriteHeader(http.StatusOK)
			if r.Method != http.MethodHead {
				_, _ = w.Write(body)
			}
			return
		}
		file, err := os.Open(resolved)
		if err != nil {
			serveSiteNotFound(w, r, rootAbs)
			return
		}
		defer file.Close()
		w.Header().Set("Cache-Control", "public, max-age=300")
		http.ServeContent(w, r, filepath.Base(resolved), info.ModTime(), file)
	}
}

func serveEmbeddedPage(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		page, err := customerAssets.ReadFile(name)
		if err != nil {
			http.Error(w, "page unavailable", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		if r.Method != http.MethodHead {
			_, _ = w.Write(page)
		}
	}
}

func sitePathWithinRoot(root, filename string) bool {
	rel, err := filepath.Rel(root, filename)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func serveSiteNotFound(w http.ResponseWriter, r *http.Request, root string) {
	page, err := os.ReadFile(filepath.Join(root, "404.html"))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusNotFound)
	if r.Method != http.MethodHead {
		if err == nil {
			_, _ = w.Write(page)
		} else {
			_, _ = io.WriteString(w, "not found\n")
		}
	}
}
