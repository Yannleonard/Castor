package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const m365ConfigPath = dataDir + "/m365-smtp.json"
const m365TokenEndpoint = "https://login.microsoftonline.com/"
const graphSendMailEndpoint = "https://graph.microsoft.com/v1.0"

type m365Config struct {
	TenantID     string `json:"tenantId"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret,omitempty"`
	Mailbox      string `json:"mailbox"`
}

type m365ConfigView struct {
	Configured bool   `json:"configured"`
	TenantID   string `json:"tenantId,omitempty"`
	ClientID   string `json:"clientId,omitempty"`
	Mailbox    string `json:"mailbox,omitempty"`
}

type graphMailRequest struct {
	Message graphMailMessage `json:"message"`
}

type graphMailDelivery struct {
	Recipient string
	Subject   string
	Body      string
}

type graphMailMessage struct {
	Subject      string               `json:"subject"`
	Body         graphMailBody        `json:"body"`
	ToRecipients []graphMailRecipient `json:"toRecipients"`
}

type graphMailBody struct {
	ContentType string `json:"contentType"`
	Content     string `json:"content"`
}

type graphMailRecipient struct {
	EmailAddress graphMailAddress `json:"emailAddress"`
}

type graphMailAddress struct {
	Address string `json:"address"`
}

type m365Service struct {
	mu            sync.Mutex
	path          string
	client        *http.Client
	tokenEndpoint string
	graphEndpoint string
}

func newM365Service() *m365Service {
	return &m365Service{
		path:          m365ConfigPath,
		client:        &http.Client{Timeout: 10 * time.Second},
		tokenEndpoint: m365TokenEndpoint,
		graphEndpoint: graphSendMailEndpoint,
	}
}

func (s *m365Service) load() (m365Config, error) {
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return m365Config{}, nil
	}
	if err != nil {
		return m365Config{}, err
	}
	if len(b) > 16<<10 {
		return m365Config{}, errors.New("Microsoft 365 configuration is too large")
	}
	var cfg m365Config
	if err := json.Unmarshal(b, &cfg); err != nil {
		return m365Config{}, errors.New("Microsoft 365 configuration is invalid")
	}
	if cfg.ClientSecret != "" {
		if err := validateM365Config(cfg, true); err != nil {
			return m365Config{}, errors.New("Microsoft 365 configuration is invalid")
		}
	}
	return cfg, nil
}

func (s *m365Service) save(cfg m365Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(cfg)
}

func (s *m365Service) saveLocked(cfg m365Config) error {
	if err := validateM365Config(cfg, true); err != nil {
		return err
	}
	cfg.TenantID, cfg.ClientID, cfg.Mailbox = strings.TrimSpace(cfg.TenantID), strings.TrimSpace(cfg.ClientID), strings.TrimSpace(cfg.Mailbox)
	b, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	file, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err = file.Write(b); err != nil {
		_ = file.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err = file.Sync(); err != nil {
		_ = file.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err = file.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (s *m365Service) updateFromRequest(cfg m365Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, err := s.load()
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if strings.TrimSpace(cfg.ClientSecret) == "" {
		cfg.ClientSecret = previous.ClientSecret
	}
	return s.saveLocked(cfg)
}

func validateM365Config(cfg m365Config, requireSecret bool) error {
	cfg.TenantID, cfg.ClientID, cfg.Mailbox = strings.TrimSpace(cfg.TenantID), strings.TrimSpace(cfg.ClientID), strings.TrimSpace(cfg.Mailbox)
	if cfg.TenantID == "" || len(cfg.TenantID) > 128 || strings.ContainsAny(cfg.TenantID, "/\\?#") || strings.Contains(cfg.TenantID, "..") || cfg.ClientID == "" || len(cfg.ClientID) > 128 || len(cfg.ClientSecret) > 2048 || (requireSecret && cfg.ClientSecret == "") {
		return errors.New("tenant, client and secret are required")
	}
	addr, err := mail.ParseAddress(cfg.Mailbox)
	if err != nil || addr.Address != cfg.Mailbox {
		return errors.New("mailbox must be a valid email address")
	}
	return nil
}

func (s *m365Service) view(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	s.mu.Lock()
	cfg, err := s.load()
	s.mu.Unlock()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "mail_config_unavailable"})
		return
	}
	writeJSON(w, 200, m365ConfigView{Configured: cfg.ClientSecret != "" && cfg.TenantID != "" && cfg.ClientID != "" && cfg.Mailbox != "", TenantID: cfg.TenantID, ClientID: cfg.ClientID, Mailbox: cfg.Mailbox})
}

func (s *m365Service) update(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		methodNotAllowed(w)
		return
	}
	var req m365Config
	if err := decodeCustomerJSON(w, r, &req, 8<<10); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	if err := validateM365Config(req, false); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid_fields"})
		return
	}
	if err := s.updateFromRequest(req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "client_secret_required"})
		return
	}
	writeJSON(w, 200, m365ConfigView{Configured: true, TenantID: req.TenantID, ClientID: req.ClientID, Mailbox: req.Mailbox})
}

func (s *m365Service) test(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var req struct {
		To string `json:"to"`
	}
	if err := decodeCustomerJSON(w, r, &req, 4<<10); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	to, err := mail.ParseAddress(strings.TrimSpace(req.To))
	if err != nil || to.Address != strings.TrimSpace(req.To) {
		writeJSON(w, 400, map[string]string{"error": "invalid_recipient"})
		return
	}
	s.mu.Lock()
	cfg, err := s.load()
	s.mu.Unlock()
	if err != nil || validateM365Config(cfg, true) != nil {
		writeJSON(w, 409, map[string]string{"error": "mail_not_configured"})
		return
	}
	if err := s.send(r.Context(), cfg, to.Address, "Test de configuration Microsoft 365", "Cet e-mail confirme la configuration Microsoft 365 de Castor."); err != nil {
		var sendErr *m365SendError
		if errors.As(err, &sendErr) {
			writeJSON(w, 502, map[string]string{"error": "mail_test_failed", "reason": sendErr.reason})
			return
		}
		writeJSON(w, 502, map[string]string{"error": "mail_test_failed", "reason": "graph_send_failed"})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "sent"})
}

func (s *m365Service) send(ctx context.Context, cfg m365Config, to, subject, body string) error {
	return s.sendMessages(ctx, cfg, []graphMailDelivery{{Recipient: to, Subject: subject, Body: body}})
}

func (s *m365Service) sendMessages(ctx context.Context, cfg m365Config, deliveries []graphMailDelivery) error {
	token, err := s.accessToken(ctx, cfg)
	if err != nil {
		var tokenErr *m365SendError
		if errors.As(err, &tokenErr) {
			return tokenErr
		}
		return &m365SendError{reason: "token_endpoint_unreachable", err: err}
	}
	if len(token) > 8192 || strings.ContainsAny(token, "\r\n") {
		return &m365SendError{reason: "token_response_invalid", err: errors.New("invalid access token response")}
	}
	var sendErr error
	for _, delivery := range deliveries {
		if err := s.sendWithToken(ctx, cfg.Mailbox, token, delivery.Recipient, delivery.Subject, delivery.Body); err != nil && sendErr == nil {
			sendErr = err
		}
	}
	return sendErr
}

func (s *m365Service) sendWithToken(ctx context.Context, mailbox, token, to, subject, body string) error {
	recipient, err := mail.ParseAddress(to)
	if err != nil || recipient.Address != to {
		return &m365SendError{reason: "graph_recipient_invalid", err: errors.New("recipient address is invalid")}
	}
	requestBody := graphMailRequest{Message: graphMailMessage{
		Subject: subject,
		Body:    graphMailBody{ContentType: "Text", Content: body},
		ToRecipients: []graphMailRecipient{{
			EmailAddress: graphMailAddress{Address: recipient.Address},
		}},
	}}

	encodedBody, err := json.Marshal(requestBody)
	if err != nil {
		return &m365SendError{reason: "graph_request_invalid", err: err}
	}
	endpoint := strings.TrimRight(s.graphEndpoint, "/") + "/users/" + url.PathEscape(mailbox) + "/sendMail"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(encodedBody)))
	if err != nil {
		return &m365SendError{reason: "graph_request_invalid", err: err}
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return &m365SendError{reason: "graph_unreachable", err: err}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		var graphError struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		_ = json.Unmarshal(responseBody, &graphError)
		reason := graphSendFailureReason(resp.StatusCode, graphError.Error.Code)
		return &m365SendError{reason: reason, err: fmt.Errorf("Microsoft Graph returned %d (%s)", resp.StatusCode, graphError.Error.Code)}
	}
	return nil
}

func graphSendFailureReason(status int, code string) string {
	switch status {
	case http.StatusUnauthorized:
		return "graph_authentication_rejected"
	case http.StatusForbidden:
		return "graph_permission_rejected"
	case http.StatusNotFound:
		return "graph_mailbox_not_found"
	case http.StatusTooManyRequests:
		return "graph_throttled"
	case http.StatusServiceUnavailable, http.StatusBadGateway, http.StatusGatewayTimeout:
		return "graph_service_unavailable"
	default:
		return "graph_send_failed"
	}
}

type m365SendError struct {
	reason string
	err    error
}

func (e *m365SendError) Error() string { return e.reason }
func (e *m365SendError) Unwrap() error { return e.err }

func (s *m365Service) accessToken(ctx context.Context, cfg m365Config) (string, error) {
	cfg.TenantID = strings.TrimSpace(cfg.TenantID)
	if strings.ContainsAny(cfg.TenantID, "/\\?#") || strings.Contains(cfg.TenantID, "..") {
		return "", errors.New("Microsoft tenant ID is invalid")
	}
	endpoint := s.tokenEndpoint + url.PathEscape(cfg.TenantID) + "/oauth2/v2.0/token"
	form := url.Values{"client_id": {cfg.ClientID}, "client_secret": {cfg.ClientSecret}, "scope": {"https://graph.microsoft.com/.default"}, "grant_type": {"client_credentials"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.client.Do(req)
	if err != nil {
		return "", &m365SendError{reason: "token_endpoint_unreachable", err: err}
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		var oauthError struct {
			Code string `json:"error"`
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		_ = json.Unmarshal(body, &oauthError)
		reason := "entra_token_request_rejected"
		switch oauthError.Code {
		case "invalid_client":
			reason = "entra_client_credentials_rejected"
		case "unauthorized_client":
			reason = "entra_app_permission_rejected"
		case "invalid_scope":
			reason = "entra_scope_invalid"
		}
		return "", &m365SendError{reason: reason, err: fmt.Errorf("Microsoft token endpoint returned %d", resp.StatusCode)}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, (16<<10)+1))
	if err != nil || len(body) > 16<<10 {
		return "", &m365SendError{reason: "token_response_invalid", err: errors.New("Microsoft token response was invalid")}
	}
	var result struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
	}
	if err := json.Unmarshal(body, &result); err != nil || result.AccessToken == "" || !strings.EqualFold(result.TokenType, "Bearer") {
		return "", &m365SendError{reason: "token_response_invalid", err: errors.New("Microsoft token response was invalid")}
	}
	return result.AccessToken, nil
}
