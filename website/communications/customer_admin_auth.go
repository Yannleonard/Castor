package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	qrcode "github.com/skip2/go-qrcode"
	"golang.org/x/crypto/argon2"
)

const (
	customerAdminAuthPath = dataDir + "/customer-admin-auth.json"
	customerAdminCookie   = "castor_customer_admin_session"
	adminSessionLifetime  = 8 * time.Hour
)

type customerAdminAuthData struct {
	PasswordSalt string `json:"passwordSalt"`
	TOTPSecret   string `json:"totpSecret"`
	TOTPEnabled  bool   `json:"totpEnabled"`
}

type customerAdminSession struct {
	ExpiresAt   time.Time
	CSRFToken   string
	PendingTOTP bool
}

type customerAdminAuth struct {
	mu           sync.Mutex
	username     string
	passwordHash []byte
	passwordSalt []byte
	dataPath     string
	data         customerAdminAuthData
	sessions     map[string]customerAdminSession
	rates        map[string]rateBucket
}

func newCustomerAdminAuth(path string) (*customerAdminAuth, error) {
	username := strings.TrimSpace(os.Getenv("CASTOR_CUSTOMERS_ADMIN_USERNAME"))
	password := os.Getenv("CASTOR_CUSTOMERS_ADMIN_PASSWORD")
	if password == "" {
		// Backward-compatible bootstrap: the previous installation already had
		// a high-entropy customer-admin bearer secret. Accept it as the initial
		// password so the authentication migration can roll out without lockout.
		password = strings.TrimSpace(os.Getenv("CASTOR_CUSTOMERS_ADMIN_TOKEN"))
		if username == "" && password != "" {
			username = "admin"
		}
	}
	if username == "" || len(username) > 254 || len(password) < 12 || len(password) > 1024 {
		return nil, errors.New("CASTOR_CUSTOMERS_ADMIN_USERNAME and a 12+ character CASTOR_CUSTOMERS_ADMIN_PASSWORD must be configured")
	}
	a := &customerAdminAuth{
		username: username,
		dataPath: path, sessions: make(map[string]customerAdminSession), rates: make(map[string]rateBucket),
	}
	b, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		if len(b) > 4096 || json.Unmarshal(b, &a.data) != nil {
			return nil, errors.New("customer admin authentication data is invalid")
		}
		if a.data.TOTPEnabled {
			secret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(a.data.TOTPSecret)
			if err != nil || len(secret) < 20 {
				return nil, errors.New("customer admin TOTP secret is invalid")
			}
		}
	}
	if a.data.PasswordSalt == "" {
		salt := make([]byte, 16)
		if _, err := rand.Read(salt); err != nil {
			return nil, err
		}
		a.data.PasswordSalt = base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(salt)
		if err := a.saveLocked(); err != nil {
			return nil, err
		}
	}
	a.passwordSalt, err = base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(a.data.PasswordSalt)
	if err != nil || len(a.passwordSalt) < 16 {
		return nil, errors.New("customer admin password salt is invalid")
	}
	a.passwordHash = argon2.IDKey([]byte(password), a.passwordSalt, 2, 19*1024, 1, 32)
	return a, nil
}

func (a *customerAdminAuth) saveLocked() error {
	b, err := json.Marshal(a.data)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(a.dataPath), 0700); err != nil {
		return err
	}
	tmp := a.dataPath + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	if err := os.Rename(tmp, a.dataPath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (a *customerAdminAuth) allow(r *http.Request, limit int) bool {
	ip, _, err := netSplitHostPort(r.RemoteAddr)
	if err != nil || ip == "" {
		ip = "unknown"
	}
	now := time.Now()
	a.mu.Lock()
	defer a.mu.Unlock()
	for key, bucket := range a.rates {
		if now.Sub(bucket.Start) >= time.Minute {
			delete(a.rates, key)
		}
	}
	bucket := a.rates[ip]
	if now.Sub(bucket.Start) >= time.Minute {
		bucket = rateBucket{Start: now}
	}
	bucket.Count++
	a.rates[ip] = bucket
	return bucket.Count <= limit
}

func (a *customerAdminAuth) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if !a.allow(r, 8) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too_many_requests"})
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if err := decodeCustomerJSON(w, r, &req, 8<<10); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	passwordHash := argon2.IDKey([]byte(req.Password), a.passwordSalt, 2, 19*1024, 1, 32)
	valid := subtle.ConstantTimeCompare([]byte(strings.TrimSpace(req.Username)), []byte(a.username)) == 1 && subtle.ConstantTimeCompare(passwordHash, a.passwordHash) == 1
	a.mu.Lock()
	enabled, secret := a.data.TOTPEnabled, a.data.TOTPSecret
	a.mu.Unlock()
	if valid && enabled {
		valid = verifyAdminTOTP(secret, req.Code, time.Now())
	} else if valid && req.Code != "" {
		valid = false
	}
	if !valid {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_credentials"})
		return
	}
	if enabled {
		csrf, ok := a.setSession(w, false)
		if !ok {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "csrfToken": csrf})
		return
	}
	csrf, ok := a.setSession(w, true)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"requiresTOTPSetup": true, "csrfToken": csrf})
}

func (a *customerAdminAuth) setSession(w http.ResponseWriter, pending bool) (string, bool) {
	tokenBytes := make([]byte, 32)
	csrfBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", false
	}
	if _, err := rand.Read(csrfBytes); err != nil {
		return "", false
	}
	token := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(tokenBytes)
	csrf := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(csrfBytes)
	a.mu.Lock()
	a.sessions[token] = customerAdminSession{ExpiresAt: time.Now().Add(adminSessionLifetime), CSRFToken: csrf, PendingTOTP: pending}
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: customerAdminCookie, Value: token, Path: "/", HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode, MaxAge: int(adminSessionLifetime.Seconds())})
	return csrf, true
}

func (a *customerAdminAuth) session(w http.ResponseWriter, r *http.Request) {
	_, session, ok := a.getSession(r)
	if !ok || session.PendingTOTP {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"csrfToken": session.CSRFToken})
}

func (a *customerAdminAuth) enroll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	_, session, ok := a.getSession(r)
	if !ok || !session.PendingTOTP {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Castor-CSRF")), []byte(session.CSRFToken)) != 1 {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "csrf_failed"})
		return
	}
	if r.Method == http.MethodPost {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.data.TOTPEnabled || a.data.TOTPSecret == "" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "enrollment_unavailable"})
			return
		}
		a.data.TOTPSecret = ""
		if err := a.saveLocked(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "storage_error"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "reset"})
		return
	}
	a.mu.Lock()
	if a.data.TOTPEnabled {
		a.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "totp_already_enabled"})
		return
	}
	if a.data.TOTPSecret == "" {
		secretBytes := make([]byte, 20)
		if _, err := rand.Read(secretBytes); err != nil {
			a.mu.Unlock()
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
			return
		}
		a.data.TOTPSecret = base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secretBytes)
		if err := a.saveLocked(); err != nil {
			a.data.TOTPSecret = ""
			a.mu.Unlock()
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "storage_error"})
			return
		}
	}
	secret := a.data.TOTPSecret
	a.mu.Unlock()
	label := url.QueryEscape("Castor customers admin:" + a.username)
	uri := "otpauth://totp/" + label + "?secret=" + secret + "&issuer=Castor&algorithm=SHA1&digits=6&period=30"
	writeJSON(w, http.StatusOK, map[string]string{"secret": secret, "otpauthUrl": uri})
}

func (a *customerAdminAuth) enrollmentQRCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	_, session, ok := a.getSession(r)
	if !ok || !session.PendingTOTP || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Castor-CSRF")), []byte(session.CSRFToken)) != 1 {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "csrf_failed"})
		return
	}
	a.mu.Lock()
	secret := a.data.TOTPSecret
	a.mu.Unlock()
	if secret == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "enrollment_unavailable"})
		return
	}
	label := url.QueryEscape("Castor customers admin:" + a.username)
	uri := "otpauth://totp/" + label + "?secret=" + secret + "&issuer=Castor&algorithm=SHA1&digits=6&period=30"
	png, err := qrcode.Encode(uri, qrcode.Medium, 256)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "qr_generation_failed"})
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(png)
}

func (a *customerAdminAuth) confirmTOTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if !a.allow(r, 8) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too_many_requests"})
		return
	}
	token, session, ok := a.getSession(r)
	if !ok || !session.PendingTOTP || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Castor-CSRF")), []byte(session.CSRFToken)) != 1 {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "csrf_failed"})
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := decodeCustomerJSON(w, r, &req, 2<<10); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	a.mu.Lock()
	if a.data.TOTPSecret == "" || !verifyAdminTOTP(a.data.TOTPSecret, req.Code, time.Now()) {
		a.mu.Unlock()
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_code"})
		return
	}
	a.data.TOTPEnabled = true
	if err := a.saveLocked(); err != nil {
		a.data.TOTPEnabled = false
		a.mu.Unlock()
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "storage_error"})
		return
	}
	csrf := session.CSRFToken
	a.sessions[token] = customerAdminSession{ExpiresAt: time.Now().Add(adminSessionLifetime), CSRFToken: csrf}
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: customerAdminCookie, Value: token, Path: "/", HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode, MaxAge: int(adminSessionLifetime.Seconds())})
	writeJSON(w, http.StatusOK, map[string]string{"csrfToken": csrf})
}

func (a *customerAdminAuth) logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	token, session, ok := a.getSession(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Castor-CSRF")), []byte(session.CSRFToken)) != 1 {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "csrf_failed"})
		return
	}
	deleteCookie := &http.Cookie{Name: customerAdminCookie, Value: "", Path: "/", HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode, MaxAge: -1}
	a.mu.Lock()
	delete(a.sessions, token)
	a.mu.Unlock()
	http.SetCookie(w, deleteCookie)
	w.WriteHeader(http.StatusNoContent)
}

func (a *customerAdminAuth) getSession(r *http.Request) (string, customerAdminSession, bool) {
	cookie, err := r.Cookie(customerAdminCookie)
	if err != nil || cookie.Value == "" {
		return "", customerAdminSession{}, false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	session, ok := a.sessions[cookie.Value]
	if !ok || time.Now().After(session.ExpiresAt) {
		delete(a.sessions, cookie.Value)
		return "", customerAdminSession{}, false
	}
	return cookie.Value, session, true
}

func (a *customerAdminAuth) require(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, session, ok := a.getSession(r)
		if !ok || session.PendingTOTP {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if r.Method != http.MethodGet {
			csrf := r.Header.Get("X-Castor-CSRF")
			if !a.allow(r, 40) || subtle.ConstantTimeCompare([]byte(csrf), []byte(session.CSRFToken)) != 1 {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "csrf_failed"})
				return
			}
		}
		next(w, r)
	}
}

func verifyAdminTOTP(secret, code string, now time.Time) bool {
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return false
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			return false
		}
	}
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.TrimRight(strings.ToUpper(secret), "="))
	if err != nil || len(key) < 20 {
		return false
	}
	valid := 0
	step := now.Unix() / 30
	for offset := int64(-1); offset <= 1; offset++ {
		var counter [8]byte
		binary.BigEndian.PutUint64(counter[:], uint64(step+offset))
		mac := hmac.New(sha1.New, key)
		_, _ = mac.Write(counter[:])
		sum := mac.Sum(nil)
		index := sum[len(sum)-1] & 0x0f
		value := (binary.BigEndian.Uint32(sum[index:index+4]) & 0x7fffffff) % 1_000_000
		expected := fmt.Sprintf("%06d", value)
		valid |= subtle.ConstantTimeCompare([]byte(code), []byte(expected))
	}
	return valid == 1
}

// netSplitHostPort is a variable to make rate-limit client address parsing
// consistently testable without trusting forwarded headers.
var netSplitHostPort = func(value string) (string, string, error) {
	return net.SplitHostPort(value)
}
