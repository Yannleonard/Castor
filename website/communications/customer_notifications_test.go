package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

type capturedMail struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
}

func newCustomerNotificationTestService(t *testing.T) (*customerService, *[]capturedMail) {
	t.Helper()
	var sent []capturedMail
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/oauth2/v2.0/token") {
			_, _ = io.WriteString(w, `{"access_token":"test-token","token_type":"Bearer"}`)
			return
		}
		var payload struct {
			Message struct {
				Subject string `json:"subject"`
				To      []struct {
					EmailAddress struct {
						Address string `json:"address"`
					} `json:"emailAddress"`
				} `json:"toRecipients"`
			} `json:"message"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode Graph sendMail payload: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if len(payload.Message.To) != 1 {
			t.Errorf("Graph recipients = %d, want 1", len(payload.Message.To))
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		sent = append(sent, capturedMail{To: payload.Message.To[0].EmailAddress.Address, Subject: payload.Message.Subject})
		w.WriteHeader(http.StatusAccepted)
	}))
	t.Cleanup(server.Close)

	root := t.TempDir()
	mailer := newM365Service()
	mailer.path = filepath.Join(root, "m365.json")
	mailer.client = server.Client()
	mailer.tokenEndpoint = server.URL + "/"
	mailer.graphEndpoint = server.URL + "/v1.0"
	if err := mailer.save(m365Config{TenantID: "tenant", ClientID: "client", ClientSecret: "secret", Mailbox: "castor@example.test"}); err != nil {
		t.Fatal(err)
	}
	service := &customerService{
		path:     filepath.Join(root, "customers.json"),
		sessions: make(map[string]customerSession),
		rates:    make(map[string]rateBucket),
		mailer:   mailer,
		data:     customerData{Users: []customerUser{{ID: "user-1", Name: "Test Client", Email: "client@example.test", Company: "Example"}}},
	}
	t.Setenv("CASTOR_CUSTOMER_NOTIFICATION_EMAIL", "yleonard@gtek-it.fr")
	return service, &sent
}

func TestRegistrationSendsExplicitGraphEmailSubjects(t *testing.T) {
	service, sent := newCustomerNotificationTestService(t)
	req := httptest.NewRequest(http.MethodPost, "https://castor.example.test/api/customers/register", strings.NewReader(`{"name":"New Client","email":"new@example.test","company":"Example Co","password":"long-password-123"}`))
	req.Host = "castor.example.test"
	req.Header.Set("Origin", "https://castor.example.test")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	service.register(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("register status = %d body=%s", rec.Code, rec.Body.String())
	}
	if len(*sent) != 2 {
		t.Fatalf("sent %d emails, want internal notification and customer confirmation", len(*sent))
	}
	if (*sent)[0].To != "yleonard@gtek-it.fr" || !strings.HasPrefix((*sent)[0].Subject, "Nouvelle inscription Castor — New Client") {
		t.Errorf("internal email = %+v", (*sent)[0])
	}
	if (*sent)[1].To != "new@example.test" || (*sent)[1].Subject != "Votre inscription à Castor est confirmée" {
		t.Errorf("customer email = %+v", (*sent)[1])
	}
}

func TestCreateTicketSendsExplicitGraphEmailSubjects(t *testing.T) {
	service, sent := newCustomerNotificationTestService(t)
	req := httptest.NewRequest(http.MethodPost, "/api/account/tickets", strings.NewReader(`{"kind":"support","subject":"Connexion impossible","message":"Je ne peux pas me connecter."}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	service.createTicket(rec, req, "user-1")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create ticket status = %d body=%s", rec.Code, rec.Body.String())
	}
	var ticket supportTicket
	if err := json.Unmarshal(rec.Body.Bytes(), &ticket); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 2 {
		t.Fatalf("sent %d emails, want internal notification and customer confirmation", len(*sent))
	}
	if (*sent)[0].To != "yleonard@gtek-it.fr" || !strings.Contains((*sent)[0].Subject, "Nouveau ticket support Castor") || !strings.Contains((*sent)[0].Subject, ticket.ID) || !strings.Contains((*sent)[0].Subject, "Connexion impossible") {
		t.Errorf("internal email = %+v", (*sent)[0])
	}
	if (*sent)[1].To != "client@example.test" || !strings.Contains((*sent)[1].Subject, "Castor a reçu votre demande support") || !strings.Contains((*sent)[1].Subject, ticket.ID) || !strings.Contains((*sent)[1].Subject, "Connexion impossible") {
		t.Errorf("customer email = %+v", (*sent)[1])
	}
}

func TestTicketReplyDoesNotFallBackToSMTP(t *testing.T) {
	service := &customerService{}
	err := service.sendSupportEmail(t.Context(), "client@example.test", "ticket-id", "Sujet", "Réponse")
	if err == nil || err.Error() != "Microsoft Graph mailer is unavailable" {
		t.Fatalf("sendSupportEmail() error = %v, want Graph-unavailable error and no SMTP fallback", err)
	}
}
