package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
)

const customerStorePath = dataDir + "/customers.json"

const maxCustomerStoreBytes = 10 << 20

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

type customerUser struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Email        string    `json:"email"`
	Company      string    `json:"company,omitempty"`
	PasswordSalt string    `json:"passwordSalt"`
	PasswordHash string    `json:"passwordHash"`
	CreatedAt    time.Time `json:"createdAt"`
}

type activationCredential struct {
	ID          string     `json:"id"`
	UserID      string     `json:"userId"`
	KeyHash     string     `json:"keyHash"`
	CreatedAt   time.Time  `json:"createdAt"`
	RevokedAt   *time.Time `json:"revokedAt,omitempty"`
	InstanceID  string     `json:"instanceId,omitempty"`
	HostName    string     `json:"hostName,omitempty"`
	ActivatedAt *time.Time `json:"activatedAt,omitempty"`
}

type supportMessage struct {
	ID        string    `json:"id"`
	Author    string    `json:"author"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
}

type supportTicket struct {
	ID        string           `json:"id"`
	UserID    string           `json:"userId"`
	Kind      string           `json:"kind"`
	Subject   string           `json:"subject"`
	Status    string           `json:"status"`
	CreatedAt time.Time        `json:"createdAt"`
	UpdatedAt time.Time        `json:"updatedAt"`
	Messages  []supportMessage `json:"messages"`
}

const maxTicketsPerUser = 200
const maxMessagesPerTicket = 200
const maxCustomerRecords = 10000

type customerData struct {
	Users   []customerUser         `json:"users"`
	Keys    []activationCredential `json:"keys"`
	Tickets []supportTicket        `json:"tickets"`
}

type customerSession struct {
	UserID    string
	ExpiresAt time.Time
	CSRFToken string
}

type rateBucket struct {
	Start time.Time
	Count int
}

type customerService struct {
	mu       sync.Mutex
	path     string
	data     customerData
	sessions map[string]customerSession
	rates    map[string]rateBucket
	mailer   *m365Service
}

func newCustomerService(path string) (*customerService, error) {
	s := &customerService{path: path, sessions: make(map[string]customerSession), rates: make(map[string]rateBucket), mailer: newM365Service()}
	b, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		if len(b) > maxCustomerStoreBytes {
			return nil, fmt.Errorf("customer store exceeds %d bytes", maxCustomerStoreBytes)
		}
		if err := json.Unmarshal(b, &s.data); err != nil {
			return nil, fmt.Errorf("decode customer store: %w", err)
		}
	}
	return s, nil
}

func (s *customerService) saveLocked() error {
	b, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	if len(b) > maxCustomerStoreBytes {
		return fmt.Errorf("customer store exceeds %d bytes", maxCustomerStoreBytes)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	file, err := os.OpenFile(tmp, os.O_RDWR, 0)
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (s *customerService) allow(r *http.Request, limit int) bool {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	if ip == "" {
		ip = "unknown"
	}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, bucket := range s.rates {
		if now.Sub(bucket.Start) >= time.Minute {
			delete(s.rates, key)
		}
	}
	bucket := s.rates[ip]
	if now.Sub(bucket.Start) >= time.Minute {
		bucket = rateBucket{Start: now}
	}
	bucket.Count++
	s.rates[ip] = bucket
	return bucket.Count <= limit
}

func (s *customerService) register(w http.ResponseWriter, r *http.Request) {
	if !s.allow(r, 8) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too_many_requests"})
		return
	}
	if r.Header.Get("Sec-Fetch-Site") != "" && r.Header.Get("Sec-Fetch-Site") != "same-origin" && r.Header.Get("Sec-Fetch-Site") != "none" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if !s.sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	var req struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Company  string `json:"company"`
		Password string `json:"password"`
	}
	if err := decodeCustomerJSON(w, r, &req, 8<<10); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	req.Name, req.Email, req.Company = strings.TrimSpace(req.Name), strings.ToLower(strings.TrimSpace(req.Email)), strings.TrimSpace(req.Company)
	if len(req.Name) < 2 || len(req.Name) > 120 || !emailPattern.MatchString(req.Email) || len(req.Email) > 254 || len(req.Company) > 160 || len(req.Password) < 12 || len(req.Password) > 1024 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_fields"})
		return
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		writeJSON(w, 500, map[string]string{"error": "internal_error"})
		return
	}
	user := customerUser{ID: randomID(), Name: req.Name, Email: req.Email, Company: req.Company, PasswordSalt: hex.EncodeToString(salt), PasswordHash: hex.EncodeToString(argon2.IDKey([]byte(req.Password), salt, 2, 64*1024, 2, 32)), CreatedAt: time.Now().UTC()}
	s.mu.Lock()
	if len(s.data.Users) >= maxCustomerRecords {
		s.mu.Unlock()
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "registration_unavailable"})
		return
	}
	for _, existing := range s.data.Users {
		if existing.Email == user.Email {
			s.mu.Unlock()
			writeJSON(w, http.StatusConflict, map[string]string{"error": "email_exists"})
			return
		}
	}
	s.data.Users = append(s.data.Users, user)
	err := s.saveLocked()
	s.mu.Unlock()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "storage_error"})
		return
	}
	s.notifyCustomerEvent(r.Context(), user.Email,
		"Votre inscription à Castor est confirmée",
		fmt.Sprintf("Bonjour %s,\n\nVotre compte Castor a été créé avec succès. Vous pouvez vous connecter à votre espace client pour gérer vos demandes de support et vos clés d’activation.\n\nL’équipe Castor", user.Name),
		"Nouvelle inscription Castor — "+emailSubjectPart(user.Name),
		fmt.Sprintf("Une nouvelle inscription a été créée.\n\nNom : %s\nE-mail : %s\nEntreprise : %s\nDate : %s", user.Name, user.Email, user.Company, user.CreatedAt.Format(time.RFC3339)))
	writeJSON(w, http.StatusCreated, map[string]string{"status": "registered"})
}

func (s *customerService) login(w http.ResponseWriter, r *http.Request) {
	if !s.allow(r, 10) {
		writeJSON(w, 429, map[string]string{"error": "too_many_requests"})
		return
	}
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if r.Header.Get("Sec-Fetch-Site") != "" && r.Header.Get("Sec-Fetch-Site") != "same-origin" && r.Header.Get("Sec-Fetch-Site") != "none" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	if !s.sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeCustomerJSON(w, r, &req, 8<<10); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	s.mu.Lock()
	var user *customerUser
	for i := range s.data.Users {
		if s.data.Users[i].Email == req.Email {
			copy := s.data.Users[i]
			user = &copy
			break
		}
	}
	if user == nil {
		// Perform the same password hash work for unknown users to reduce email
		// enumeration through response timing.
		_ = argon2.IDKey([]byte(req.Password), make([]byte, 16), 2, 64*1024, 2, 32)
		s.mu.Unlock()
		writeJSON(w, 401, map[string]string{"error": "invalid_credentials"})
		return
	}
	salt, err := hex.DecodeString(user.PasswordSalt)
	hash, hashErr := hex.DecodeString(user.PasswordHash)
	var actual []byte
	if err == nil {
		actual = argon2.IDKey([]byte(req.Password), salt, 2, 64*1024, 2, 32)
	}
	valid := err == nil && hashErr == nil && subtle.ConstantTimeCompare(actual, hash) == 1
	if !valid {
		s.mu.Unlock()
		writeJSON(w, 401, map[string]string{"error": "invalid_credentials"})
		return
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		s.mu.Unlock()
		writeJSON(w, 500, map[string]string{"error": "internal_error"})
		return
	}
	token := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(tokenBytes)
	csrfTokenBytes := make([]byte, 32)
	if _, err := rand.Read(csrfTokenBytes); err != nil {
		s.mu.Unlock()
		writeJSON(w, 500, map[string]string{"error": "internal_error"})
		return
	}
	csrfToken := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(csrfTokenBytes)
	s.sessions[token] = customerSession{UserID: user.ID, ExpiresAt: time.Now().Add(7 * 24 * time.Hour), CSRFToken: csrfToken}
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "castor_customer_session", Value: token, Path: "/", HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode, MaxAge: int((7 * 24 * time.Hour).Seconds())})
	writeJSON(w, 200, map[string]any{"user": publicCustomer(user), "csrfToken": csrfToken})
}

func publicCustomer(u *customerUser) map[string]string {
	return map[string]string{"id": u.ID, "name": u.Name, "email": u.Email, "company": u.Company}
}

func (s *customerService) authenticate(r *http.Request) (string, bool, string) {
	token := ""
	if header := strings.TrimSpace(r.Header.Get("Authorization")); strings.HasPrefix(header, "Bearer ") {
		token = strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	} else if cookie, err := r.Cookie("castor_customer_session"); err == nil {
		token = cookie.Value
	}
	if token == "" {
		return "", false, ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[token]
	if !ok || time.Now().After(session.ExpiresAt) {
		delete(s.sessions, token)
		return "", false, ""
	}
	return session.UserID, true, session.CSRFToken
}

func (s *customerService) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return r.Header.Get("Sec-Fetch-Site") == "same-origin" || r.Header.Get("Sec-Fetch-Site") == "none"
	}
	u, err := url.Parse(origin)
	return err == nil && u.Host != "" && strings.EqualFold(u.Host, r.Host) && (u.Scheme == "https" || u.Scheme == "http")
}

func (s *customerService) account(w http.ResponseWriter, r *http.Request) {
	userID, ok, csrfToken := s.authenticate(r)
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost && r.Method != http.MethodDelete {
		methodNotAllowed(w)
		return
	}
	if r.Method == http.MethodPost || r.Method == http.MethodDelete {
		if !s.sameOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
			return
		}
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Castor-CSRF")), []byte(csrfToken)) != 1 {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "csrf_failed"})
			return
		}
	}
	switch r.URL.Path {
	case "/api/account/me":
		if r.Method != http.MethodGet {
			methodNotAllowed(w)
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		for i := range s.data.Users {
			if s.data.Users[i].ID == userID {
				writeJSON(w, 200, map[string]any{"user": publicCustomer(&s.data.Users[i]), "csrfToken": csrfToken})
				return
			}
		}
		writeJSON(w, 404, map[string]string{"error": "not_found"})
	case "/api/account/logout":
		if r.Method != http.MethodPost {
			methodNotAllowed(w)
			return
		}
		token := ""
		if cookie, err := r.Cookie("castor_customer_session"); err == nil {
			token = cookie.Value
		}
		s.mu.Lock()
		delete(s.sessions, token)
		s.mu.Unlock()
		http.SetCookie(w, &http.Cookie{Name: "castor_customer_session", Value: "", Path: "/", HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
		w.WriteHeader(http.StatusNoContent)
	case "/api/account/activation-keys":
		if r.Method == http.MethodPost {
			s.issueKey(w, userID)
			return
		}
		if r.Method == http.MethodGet {
			s.listKeys(w, userID)
			return
		}
		methodNotAllowed(w)
	case "/api/account/tickets":
		if r.Method == http.MethodPost {
			s.createTicket(w, r, userID)
			return
		}
		if r.Method == http.MethodGet {
			s.listTickets(w, userID)
			return
		}
		methodNotAllowed(w)
	default:
		http.NotFound(w, r)
	}
}

func (s *customerService) issueKey(w http.ResponseWriter, userID string) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		writeJSON(w, 500, map[string]string{"error": "internal_error"})
		return
	}
	key := "CASTOR-" + base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)
	h := sha256.Sum256([]byte(key))
	cred := activationCredential{ID: randomID(), UserID: userID, KeyHash: hex.EncodeToString(h[:]), CreatedAt: time.Now().UTC()}
	s.mu.Lock()
	if len(s.data.Keys) >= maxCustomerRecords {
		s.mu.Unlock()
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "key_limit_reached"})
		return
	}
	for _, existing := range s.data.Keys {
		if existing.UserID == userID && existing.RevokedAt == nil && existing.InstanceID == "" {
			s.mu.Unlock()
			writeJSON(w, http.StatusConflict, map[string]string{"error": "active_key_exists"})
			return
		}
	}
	s.data.Keys = append(s.data.Keys, cred)
	err := s.saveLocked()
	s.mu.Unlock()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "storage_error"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": cred.ID, "key": key, "createdAt": cred.CreatedAt})
}

func (s *customerService) listKeys(w http.ResponseWriter, userID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]map[string]any, 0)
	for _, k := range s.data.Keys {
		if k.UserID == userID {
			out = append(out, map[string]any{"id": k.ID, "createdAt": k.CreatedAt, "revoked": k.RevokedAt != nil, "activatedAt": k.ActivatedAt, "instanceId": k.InstanceID, "hostName": k.HostName})
		}
	}
	writeJSON(w, 200, map[string]any{"keys": out})
}

func (s *customerService) verifyActivation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if !s.allow(r, 20) {
		writeJSON(w, 429, map[string]string{"error": "too_many_requests"})
		return
	}
	var req struct {
		Key        string `json:"key"`
		InstanceID string `json:"instanceId"`
		HostName   string `json:"hostName"`
	}
	if err := decodeCustomerJSON(w, r, &req, 8<<10); err != nil || len(req.Key) > 128 || len(req.InstanceID) < 16 || len(req.InstanceID) > 128 || len(req.HostName) > 255 {
		writeJSON(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	req.HostName = strings.TrimSpace(req.HostName)
	h := sha256.Sum256([]byte(strings.TrimSpace(req.Key)))
	hash := hex.EncodeToString(h[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.Keys {
		k := &s.data.Keys[i]
		if subtle.ConstantTimeCompare([]byte(k.KeyHash), []byte(hash)) != 1 {
			continue
		}
		if k.RevokedAt != nil {
			writeJSON(w, 403, map[string]string{"error": "key_revoked"})
			return
		}
		if k.InstanceID != "" && k.InstanceID != req.InstanceID {
			writeJSON(w, 409, map[string]string{"error": "key_already_bound"})
			return
		}
		if req.HostName != "" {
			for j := range s.data.Keys {
				other := &s.data.Keys[j]
				if other.ID != k.ID && other.UserID == k.UserID && other.RevokedAt == nil && other.InstanceID == req.InstanceID {
					if other.HostName == "" {
						other.HostName = req.HostName
						if err := s.saveLocked(); err != nil {
							writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "storage_error"})
							return
						}
					}
					writeJSON(w, http.StatusConflict, map[string]string{"error": "instance_already_bound"})
					return
				}
			}
		}
		var user *customerUser
		for j := range s.data.Users {
			if s.data.Users[j].ID == k.UserID {
				user = &s.data.Users[j]
				break
			}
		}
		if user == nil {
			writeJSON(w, 403, map[string]string{"error": "key_invalid"})
			return
		}
		now := time.Now().UTC()
		k.InstanceID = req.InstanceID
		if req.HostName != "" {
			k.HostName = req.HostName
		}
		if k.ActivatedAt == nil {
			k.ActivatedAt = &now
		}
		if err := s.saveLocked(); err != nil {
			writeJSON(w, 500, map[string]string{"error": "storage_error"})
			return
		}
		writeJSON(w, 200, map[string]any{"valid": true, "activationId": k.ID, "name": user.Name, "email": user.Email, "company": user.Company, "activatedAt": k.ActivatedAt})
		return
	}
	writeJSON(w, 403, map[string]string{"error": "key_invalid"})
}

func (s *customerService) createTicket(w http.ResponseWriter, r *http.Request, userID string) {
	var req struct {
		Kind    string `json:"kind"`
		Subject string `json:"subject"`
		Message string `json:"message"`
	}
	if err := decodeCustomerJSON(w, r, &req, 16<<10); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	req.Kind = strings.TrimSpace(req.Kind)
	req.Subject = strings.TrimSpace(req.Subject)
	req.Message = strings.TrimSpace(req.Message)
	if (req.Kind != "support" && req.Kind != "commercial") || len(req.Subject) < 3 || len(req.Subject) > 160 || len(req.Message) < 5 || len(req.Message) > 8000 {
		writeJSON(w, 400, map[string]string{"error": "invalid_fields"})
		return
	}
	now := time.Now().UTC()
	ticket := supportTicket{ID: randomID(), UserID: userID, Kind: req.Kind, Subject: req.Subject, Status: "open", CreatedAt: now, UpdatedAt: now, Messages: []supportMessage{{ID: randomID(), Author: "customer", Body: req.Message, CreatedAt: now}}}
	s.mu.Lock()
	userTicketCount := 0
	for _, existing := range s.data.Tickets {
		if existing.UserID == userID {
			userTicketCount++
		}
	}
	if userTicketCount >= maxTicketsPerUser {
		s.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "ticket_limit_reached"})
		return
	}
	if len(s.data.Tickets) >= maxCustomerRecords {
		s.mu.Unlock()
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "ticket_limit_reached"})
		return
	}
	var user customerUser
	for _, existing := range s.data.Users {
		if existing.ID == userID {
			user = existing
			break
		}
	}
	if user.ID == "" {
		s.mu.Unlock()
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	s.data.Tickets = append(s.data.Tickets, ticket)
	err := s.saveLocked()
	s.mu.Unlock()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "storage_error"})
		return
	}
	kindLabel := "support"
	if ticket.Kind == "commercial" {
		kindLabel = "commercial"
	}
	safeSubject := emailSubjectPart(ticket.Subject)
	s.notifyCustomerEvent(r.Context(), user.Email,
		fmt.Sprintf("Castor a reçu votre demande %s — #%s — %s", kindLabel, ticket.ID, safeSubject),
		fmt.Sprintf("Bonjour %s,\n\nNous avons bien reçu votre demande « %s » (référence #%s). Notre équipe vous répondra par e-mail. Vous pourrez également suivre la demande depuis votre espace client.\n\nL’équipe Castor", user.Name, ticket.Subject, ticket.ID),
		fmt.Sprintf("Nouveau ticket %s Castor — #%s — %s", kindLabel, ticket.ID, safeSubject),
		fmt.Sprintf("Un nouveau ticket a été créé.\n\nRéférence : #%s\nType : %s\nSujet : %s\nClient : %s\nE-mail : %s\n\nMessage :\n%s", ticket.ID, kindLabel, ticket.Subject, user.Name, user.Email, req.Message))
	writeJSON(w, http.StatusCreated, ticket)
}

func (s *customerService) listTickets(w http.ResponseWriter, userID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]supportTicket, 0)
	for _, t := range s.data.Tickets {
		if t.UserID == userID {
			out = append(out, t)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	writeJSON(w, 200, map[string]any{"tickets": out})
}

func (s *customerService) adminCustomers(token string, next http.HandlerFunc) http.HandlerFunc {
	return withBearer(token, next)
}

func (s *customerService) admin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost && r.Method != http.MethodDelete {
		methodNotAllowed(w)
		return
	}
	if !s.sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/admin/customers"), "/")
	if path == "" && r.Method == http.MethodGet {
		s.adminOverview(w)
		return
	}
	parts := strings.Split(path, "/")
	if len(parts) == 3 && parts[0] == "tickets" && parts[2] == "reply" && r.Method == http.MethodPost {
		s.adminReply(w, r, parts[1])
		return
	}
	if len(parts) == 2 && parts[0] == "keys" && parts[1] != "" && r.Method == http.MethodDelete {
		s.revokeKey(w, parts[1])
		return
	}
	methodNotAllowed(w)
}

func (s *customerService) adminOverview(w http.ResponseWriter) {
	s.mu.Lock()
	defer s.mu.Unlock()
	users := make([]map[string]any, 0, len(s.data.Users))
	for _, u := range s.data.Users {
		instances := make([]map[string]any, 0)
		for _, k := range s.data.Keys {
			if k.UserID != u.ID || k.InstanceID == "" {
				continue
			}
			instances = append(instances, map[string]any{
				"instanceId":  k.InstanceID,
				"hostName":    k.HostName,
				"activatedAt": k.ActivatedAt,
				"revoked":     k.RevokedAt != nil,
			})
		}
		users = append(users, map[string]any{"id": u.ID, "name": u.Name, "email": u.Email, "company": u.Company, "createdAt": u.CreatedAt, "instances": instances})
	}
	keys := make([]map[string]any, 0, len(s.data.Keys))
	for _, k := range s.data.Keys {
		var email string
		for _, u := range s.data.Users {
			if u.ID == k.UserID {
				email = u.Email
				break
			}
		}
		keys = append(keys, map[string]any{"id": k.ID, "email": email, "createdAt": k.CreatedAt, "revoked": k.RevokedAt != nil, "instanceId": k.InstanceID, "hostName": k.HostName, "activatedAt": k.ActivatedAt})
	}
	tickets := append([]supportTicket(nil), s.data.Tickets...)
	sort.Slice(tickets, func(i, j int) bool { return tickets[i].UpdatedAt.After(tickets[j].UpdatedAt) })
	writeJSON(w, 200, map[string]any{"users": users, "keys": keys, "tickets": tickets})
}

func (s *customerService) adminReply(w http.ResponseWriter, r *http.Request, id string) {
	var req struct {
		Body   string `json:"body"`
		Status string `json:"status"`
	}
	if err := decodeCustomerJSON(w, r, &req, 12<<10); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if len(req.Body) < 1 || len(req.Body) > 8000 {
		writeJSON(w, 400, map[string]string{"error": "invalid_message"})
		return
	}
	var user customerUser
	var ticketSubject string
	s.mu.Lock()
	var found bool
	for i := range s.data.Tickets {
		t := &s.data.Tickets[i]
		if t.ID != id {
			continue
		}
		if len(t.Messages) >= maxMessagesPerTicket {
			s.mu.Unlock()
			writeJSON(w, http.StatusConflict, map[string]string{"error": "ticket_message_limit_reached"})
			return
		}
		for _, u := range s.data.Users {
			if u.ID == t.UserID {
				user = u
				found = true
				break
			}
		}
		ticketSubject = t.Subject
		now := time.Now().UTC()
		t.Messages = append(t.Messages, supportMessage{ID: randomID(), Author: "admin", Body: req.Body, CreatedAt: now})
		t.UpdatedAt = now
		if req.Status == "open" || req.Status == "in-progress" || req.Status == "resolved" {
			t.Status = req.Status
		}
		break
	}
	if !found {
		s.mu.Unlock()
		writeJSON(w, 404, map[string]string{"error": "ticket_not_found"})
		return
	}
	err := s.saveLocked()
	s.mu.Unlock()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "storage_error"})
		return
	}
	if err := s.sendSupportEmail(r.Context(), user.Email, id, ticketSubject, req.Body); err != nil {
		writeJSON(w, 202, map[string]string{"status": "saved", "email": "failed"})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "saved", "email": "sent"})
}

func (s *customerService) sendSupportEmail(ctx context.Context, to, id, subject, body string) error {
	if s.mailer == nil {
		return errors.New("Microsoft Graph mailer is unavailable")
	}
	cfg, err := s.mailer.load()
	if err != nil {
		return err
	}
	if err := validateM365Config(cfg, true); err != nil {
		return errors.New("Microsoft Graph mail is not configured")
	}
	return s.mailer.send(ctx, cfg, to, fmt.Sprintf("Réponse Castor à votre ticket #%s — %s", id, emailSubjectPart(subject)), body)
}

func (s *customerService) notifyCustomerEvent(ctx context.Context, customerEmail, customerSubject, customerBody, internalSubject, internalBody string) {
	if s.mailer == nil {
		log.Printf("customer event notification failed: reason=mailer_unavailable")
		return
	}
	cfg, err := s.mailer.load()
	if err != nil || validateM365Config(cfg, true) != nil {
		log.Printf("customer event notification failed: reason=mail_not_configured")
		return
	}
	internalEmail := strings.TrimSpace(os.Getenv("CASTOR_CUSTOMER_NOTIFICATION_EMAIL"))
	if internalEmail == "" {
		internalEmail = "yleonard@gtek-it.fr"
	}
	err = s.mailer.sendMessages(ctx, cfg, []graphMailDelivery{
		{Recipient: internalEmail, Subject: internalSubject, Body: internalBody},
		{Recipient: customerEmail, Subject: customerSubject, Body: customerBody},
	})
	if err != nil {
		log.Printf("customer event email failed: reason=%s", safeMailFailureReason(err))
	}
}

func safeMailFailureReason(err error) string {
	var sendErr *m365SendError
	if errors.As(err, &sendErr) {
		return sendErr.reason
	}
	return "notification_failed"
}

func emailSubjectPart(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) > 120 {
		value = string(runes[:120])
	}
	return value
}

func (s *customerService) revokeKey(w http.ResponseWriter, id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.Keys {
		if s.data.Keys[i].ID == id {
			now := time.Now().UTC()
			s.data.Keys[i].RevokedAt = &now
			if err := s.saveLocked(); err != nil {
				writeJSON(w, 500, map[string]string{"error": "storage_error"})
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	writeJSON(w, 404, map[string]string{"error": "key_not_found"})
}

func decodeCustomerJSON(w http.ResponseWriter, r *http.Request, dst any, max int64) error {
	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		return errors.New("method not allowed")
	}
	mediaType, _, mediaErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaErr != nil || mediaType != "application/json" {
		return errors.New("application/json required")
	}
	r.Body = http.MaxBytesReader(w, r.Body, max)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return errors.New("trailing JSON")
	}
	return nil
}

func methodNotAllowed(w http.ResponseWriter) {
	w.Header().Set("Allow", "GET, POST")
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
}

func randomID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}
