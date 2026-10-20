package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCurrentReturnsOnlyActiveAnnouncement(t *testing.T) {
	now := time.Now().UTC()
	s := &store{items: []announcement{
		{ID: "expired", Kind: "info", Title: "Expired", Message: "Old", Enabled: true, EndsAt: now.Add(-time.Minute).Format(time.RFC3339), UpdatedAt: now},
		{ID: "scheduled", Kind: "update", Title: "Later", Message: "Not live", Enabled: true, StartsAt: now.Add(time.Hour).Format(time.RFC3339), UpdatedAt: now.Add(time.Minute)},
		{ID: "live", Kind: "commercial", Title: "Offer", Message: "Active", Enabled: true, UpdatedAt: now},
	}}
	w := httptest.NewRecorder()
	s.current(w, httptest.NewRequest(http.MethodGet, "/api/announcements/current", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var got announcement
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ID != "live" {
		t.Fatalf("current id = %q, want live", got.ID)
	}
}

func TestCurrentReturnsNoContentWithoutActiveAnnouncement(t *testing.T) {
	s := &store{items: []announcement{{ID: "off", Enabled: false}}}
	w := httptest.NewRecorder()
	s.current(w, httptest.NewRequest(http.MethodGet, "/api/announcements/current", nil))
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
}

func TestManagementRequiresBearerToken(t *testing.T) {
	handler := withBearer(strings.Repeat("a", 32), (&store{}).manage)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/admin/announcements", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestCustomerAdminOriginAcceptsSameOriginPUT(t *testing.T) {
	called := false
	handler := customerAdminOrigin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(http.StatusNoContent) }))
	req := httptest.NewRequest(http.MethodPut, "https://castor.example.test/api/admin/mail", nil)
	req.Host = "castor.example.test"
	req.Header.Set("Origin", "https://castor.example.test")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if !called || rec.Code != http.StatusNoContent {
		t.Fatalf("handler called=%v status=%d", called, rec.Code)
	}
}

func TestCustomerAdminOriginRejectsCrossOriginPUT(t *testing.T) {
	handler := customerAdminOrigin(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("cross-origin request reached handler") }))
	req := httptest.NewRequest(http.MethodPut, "https://castor.example.test/api/admin/mail", nil)
	req.Host = "castor.example.test"
	req.Header.Set("Origin", "https://attacker.example")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestVerifyActivationStoresHostNameAndListsItForAccount(t *testing.T) {
	key := "CASTOR-TEST-ACTIVATION-KEY-1234567890"
	hash := sha256.Sum256([]byte(key))
	service := &customerService{
		path:     filepath.Join(t.TempDir(), "customers.json"),
		sessions: make(map[string]customerSession),
		rates:    make(map[string]rateBucket),
		data: customerData{
			Users: []customerUser{{ID: "user-1", Name: "Castor User", Email: "user@example.test"}},
			Keys:  []activationCredential{{ID: "key-1", UserID: "user-1", KeyHash: hex.EncodeToString(hash[:]), CreatedAt: time.Now().UTC()}},
		},
	}

	verifyReq := httptest.NewRequest(http.MethodPost, "/api/activation/verify", strings.NewReader(`{"key":"`+key+`","instanceId":"instance-id-00000001","hostName":"castor-prod-01"}`))
	verifyReq.Header.Set("Content-Type", "application/json")
	verifyRec := httptest.NewRecorder()
	service.verifyActivation(verifyRec, verifyReq)
	if verifyRec.Code != http.StatusOK {
		t.Fatalf("verify status = %d, body=%s", verifyRec.Code, verifyRec.Body.String())
	}

	listRec := httptest.NewRecorder()
	service.listKeys(listRec, "user-1")
	var result struct {
		Keys []struct {
			HostName string `json:"hostName"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Keys) != 1 || result.Keys[0].HostName != "castor-prod-01" {
		t.Fatalf("listed activation keys = %+v; want host castor-prod-01", result.Keys)
	}
}

func TestVerifyActivationRejectsSecondKeyForSameInstance(t *testing.T) {
	key := "CASTOR-TEST-ACTIVATION-KEY-SECOND-1234567890"
	hash := sha256.Sum256([]byte(key))
	service := &customerService{
		path:     filepath.Join(t.TempDir(), "customers.json"),
		sessions: make(map[string]customerSession),
		rates:    make(map[string]rateBucket),
		data: customerData{
			Users: []customerUser{{ID: "user-1", Name: "Castor User", Email: "user@example.test"}},
			Keys: []activationCredential{
				{ID: "existing", UserID: "user-1", KeyHash: "other", InstanceID: "instance-id-00000001", HostName: "castor-prod-01"},
				{ID: "new", UserID: "user-1", KeyHash: hex.EncodeToString(hash[:]), CreatedAt: time.Now().UTC()},
			},
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/api/activation/verify", strings.NewReader(`{"key":"`+key+`","instanceId":"instance-id-00000001","hostName":"castor-prod-01"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	service.verifyActivation(rec, req)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "instance_already_bound") {
		t.Fatalf("verify status = %d, body=%s; want 409 instance_already_bound", rec.Code, rec.Body.String())
	}
}

func TestAdminOverviewGroupsInstanceIDsUnderTheirAccount(t *testing.T) {
	activatedAt := time.Now().UTC()
	service := &customerService{data: customerData{
		Users: []customerUser{{ID: "user-1", Name: "Yann", Email: "yleonard@gtek-it.fr"}, {ID: "user-2", Name: "Other", Email: "other@example.test"}},
		Keys: []activationCredential{{ID: "key-1", UserID: "user-1", InstanceID: "873779d6-197a-4b19-afe2-d28021a3687f", HostName: "castor-prod", ActivatedAt: &activatedAt}},
	}}
	rec := httptest.NewRecorder()
	service.adminOverview(rec)
	var result struct {
		Users []struct {
			Email     string `json:"email"`
			Instances []struct {
				InstanceID string `json:"instanceId"`
				HostName   string `json:"hostName"`
			} `json:"instances"`
		} `json:"users"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Users) != 2 || result.Users[0].Email != "yleonard@gtek-it.fr" || len(result.Users[0].Instances) != 1 {
		t.Fatalf("users = %+v; expected first account to have one instance", result.Users)
	}
	instance := result.Users[0].Instances[0]
	if instance.InstanceID != "873779d6-197a-4b19-afe2-d28021a3687f" || instance.HostName != "castor-prod" {
		t.Fatalf("instance = %+v; got wrong account association", instance)
	}
	if len(result.Users[1].Instances) != 0 {
		t.Fatalf("unrelated account unexpectedly has instances: %+v", result.Users[1].Instances)
	}
}

func TestManagementCreatesPersistentAnnouncement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "announcements.json")
	s := &store{path: path}
	payload := `{"kind":"update","title":"Castor 2","message":"Available now","link":"https://example.com/releases","enabled":true}`
	req := httptest.NewRequest(http.MethodPost, "/api/admin/announcements", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.manage(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	loaded := &store{path: path}
	if err := loaded.load(); err != nil {
		t.Fatal(err)
	}
	if len(loaded.items) != 1 || loaded.items[0].Title != "Castor 2" {
		t.Fatalf("stored announcements = %#v", loaded.items)
	}
}

func TestDecodeAnnouncementRejectsUnsafeLinkAndSVG(t *testing.T) {
	for _, payload := range []string{
		`{"kind":"info","title":"Notice","message":"Body","link":"javascript:alert(1)"}`,
		`{"kind":"info","title":"Notice","message":"Body","imageData":"data:image/svg+xml;base64,PHN2Zz4="}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		if _, err := decodeAnnouncement(httptest.NewRecorder(), req); err == nil {
			t.Errorf("accepted unsafe payload %s", payload)
		}
	}
}

func TestDecodeAnnouncementAcceptsSmallPNG(t *testing.T) {
	var encoded bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 10, A: 255})
	if err := png.Encode(&encoded, img); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(announcement{Kind: "info", Title: "Image", Message: "Safe image", ImageData: "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	got, err := decodeAnnouncement(httptest.NewRecorder(), req)
	if err != nil {
		t.Fatal(err)
	}
	if got.ImageType != "image/png" {
		t.Fatalf("ImageType = %q", got.ImageType)
	}
}

func TestDecodeAnnouncementRejectsTrailingJSON(t *testing.T) {
	payload := `{"kind":"info","title":"Notice","message":"Body"} {}`
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	if _, err := decodeAnnouncement(httptest.NewRecorder(), req); err == nil {
		t.Fatal("accepted trailing JSON value")
	}
}

func TestSiteHandlerServesHomepageAndAnnouncementScript(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("<html><body>Castor</body></html>"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "404.html"), []byte("missing"), 0600); err != nil {
		t.Fatal(err)
	}
	handler := siteHandler(root)

	res := httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "Castor") || !strings.Contains(res.Body.String(), "/js/announcements.js") {
		t.Fatalf("GET / = %d, body %q; want homepage with account link and announcements script", res.Code, res.Body.String())
	}
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte(`<html><body><header><div class="nav__actions" id="nav-actions"></div></header><main>Castor</main></body></html>`), 0600); err != nil {
		t.Fatal(err)
	}
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))
	if !strings.Contains(res.Body.String(), `href="/account"`) || !strings.Contains(res.Body.String(), "Espace client - Support") {
		t.Fatalf("GET / missing account nav link: %q", res.Body.String())
	}

	res = httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/unknown", nil))
	if res.Code != http.StatusNotFound || res.Body.String() != "missing" {
		t.Fatalf("GET /unknown = %d, body %q; want branded 404", res.Code, res.Body.String())
	}

	res = httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/", nil))
	if res.Code != http.StatusMethodNotAllowed || res.Header().Get("Allow") != "GET, HEAD" {
		t.Fatalf("POST / = %d, Allow %q; want 405 GET, HEAD", res.Code, res.Header().Get("Allow"))
	}
}
