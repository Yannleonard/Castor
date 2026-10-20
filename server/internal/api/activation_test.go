package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFetchActivationIdentityOnlyUsesOfficialHTTPSHost(t *testing.T) {
	for _, endpoint := range []string{
		"http://castor.gtek-it.fr/api/activation/verify",
		"https://example.test/api/activation/verify",
		"https://user@castor.gtek-it.fr/api/activation/verify",
		"https://castor.gtek-it.fr/api/activation/verify?target=other",
	} {
		t.Run(endpoint, func(t *testing.T) {
			var identity map[string]any
			if err := fetchActivationIdentity(context.Background(), endpoint, strings.Repeat("K", 40), "instance-1234567890", "host-01", &identity); err == nil {
				t.Fatal("expected endpoint to be rejected")
			}
		})
	}
}
func TestFetchActivationIdentityPostsOnlyKeyAndInstanceID(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if len(body) != 3 || body["key"] != strings.Repeat("K", 40) || body["instanceId"] != "instance-1234567890" || body["hostName"] != "host-01" {
			t.Errorf("request fields = %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"valid":true,"name":"Castor User","email":"user@example.test","company":"Example"}`))
	}))
	defer server.Close()

	var identity map[string]any
	if err := fetchActivationIdentityWithClient(context.Background(), server.URL, strings.Repeat("K", 40), "instance-1234567890", "host-01", &identity, server.Client()); err != nil {
		t.Fatal(err)
	}
	if identity["valid"] != true {
		t.Fatalf("identity = %#v", identity)
	}
}

func TestFetchActivationIdentityRejectsNonSuccessAndOversizedPayload(t *testing.T) {
	for _, tc := range []struct {
		name       string
		statusCode int
		body       string
	}{
		{name: "server error", statusCode: http.StatusServiceUnavailable, body: `{"valid":true}`},
		{name: "oversized response", statusCode: http.StatusOK, body: `{"valid":true}` + strings.Repeat(" ", 20<<10)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.statusCode)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			var identity map[string]any
			if err := fetchActivationIdentityWithClient(context.Background(), server.URL, "key", "instance", "host-01", &identity, server.Client()); err == nil {
				t.Fatal("expected upstream response to be rejected")
			}
		})
	}
}


