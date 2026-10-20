package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestVerifyAdminTOTPUsesRFC6238SHA1(t *testing.T) {
	secret := "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	if !verifyAdminTOTP(secret, "287082", time.Unix(59, 0)) {
		t.Fatal("valid six-digit RFC 6238 code was rejected")
	}
	if verifyAdminTOTP(secret, "287083", time.Unix(59, 0)) {
		t.Fatal("invalid TOTP code was accepted")
	}
}

func TestCustomerAdminRequiresPasswordAndTOTP(t *testing.T) {
	t.Setenv("CASTOR_CUSTOMERS_ADMIN_USERNAME", "support-admin")
	t.Setenv("CASTOR_CUSTOMERS_ADMIN_PASSWORD", "correct horse battery staple")
	path := filepath.Join(t.TempDir(), "admin-auth.json")
	auth, err := newCustomerAdminAuth(path)
	if err != nil {
		t.Fatal(err)
	}

	login := func(code string) (*httptest.ResponseRecorder, *http.Request) {
		payload, _ := json.Marshal(map[string]string{"username": "support-admin", "password": "correct horse battery staple", "code": code})
		req := httptest.NewRequest(http.MethodPost, "/api/admin/auth/login", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = "192.0.2.1:1234"
		rec := httptest.NewRecorder()
		auth.login(rec, req)
		return rec, req
	}

	first, _ := login("")
	if first.Code != http.StatusOK {
		t.Fatalf("initial login status=%d body=%s", first.Code, first.Body.String())
	}
	var firstBody struct {
		RequiresTOTPSetup bool   `json:"requiresTOTPSetup"`
		CSRFToken         string `json:"csrfToken"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstBody); err != nil || !firstBody.RequiresTOTPSetup || firstBody.CSRFToken == "" {
		t.Fatalf("initial login response=%s", first.Body.String())
	}
	cookie := first.Result().Cookies()[0]

	enrollRequest := httptest.NewRequest(http.MethodGet, "/api/admin/auth/totp/enroll", nil)
	enrollRequest.AddCookie(cookie)
	enrollRequest.Header.Set("X-Castor-CSRF", firstBody.CSRFToken)
	enrollRequest.RemoteAddr = "192.0.2.1:1234"
	enrollResponse := httptest.NewRecorder()
	auth.enroll(enrollResponse, enrollRequest)
	if enrollResponse.Code != http.StatusOK {
		t.Fatalf("TOTP enrollment status=%d body=%s", enrollResponse.Code, enrollResponse.Body.String())
	}
	var enrollment struct {
		Secret     string `json:"secret"`
		OTPAuthURL string `json:"otpauthUrl"`
	}
	if err := json.Unmarshal(enrollResponse.Body.Bytes(), &enrollment); err != nil || enrollment.Secret == "" || enrollment.OTPAuthURL == "" {
		t.Fatalf("TOTP enrollment response=%s", enrollResponse.Body.String())
	}
	qrRequest := httptest.NewRequest(http.MethodGet, "/api/admin/auth/totp/qr", nil)
	qrRequest.AddCookie(cookie)
	qrRequest.Header.Set("X-Castor-CSRF", firstBody.CSRFToken)
	qrResponse := httptest.NewRecorder()
	auth.enrollmentQRCode(qrResponse, qrRequest)
	if qrResponse.Code != http.StatusOK || qrResponse.Header().Get("Content-Type") != "image/png" || !bytes.HasPrefix(qrResponse.Body.Bytes(), []byte("\x89PNG\r\n\x1a\n")) {
		t.Fatalf("QR response status=%d content-type=%q body-size=%d", qrResponse.Code, qrResponse.Header().Get("Content-Type"), qrResponse.Body.Len())
	}
	if _, err := url.Parse(enrollment.OTPAuthURL); err != nil {
		t.Fatalf("invalid otpauth URI: %v", err)
	}

	code := testAdminTOTP(enrollment.Secret, time.Now())
	confirmPayload, _ := json.Marshal(map[string]string{"code": code})
	confirmRequest := httptest.NewRequest(http.MethodPost, "/api/admin/auth/totp/confirm", bytes.NewReader(confirmPayload))
	confirmRequest.Header.Set("Content-Type", "application/json")
	confirmRequest.AddCookie(cookie)
	confirmRequest.Header.Set("X-Castor-CSRF", firstBody.CSRFToken)
	confirmRequest.RemoteAddr = "192.0.2.1:1234"
	confirmResponse := httptest.NewRecorder()
	auth.confirmTOTP(confirmResponse, confirmRequest)
	if confirmResponse.Code != http.StatusOK {
		t.Fatalf("TOTP confirmation status=%d body=%s", confirmResponse.Code, confirmResponse.Body.String())
	}

	badCode := testAdminTOTP(enrollment.Secret, time.Now())
	badCode = fmt.Sprintf("%06d", (mustParseTOTP(badCode)+1)%1_000_000)
	bad, _ := login(badCode)
	if bad.Code != http.StatusUnauthorized {
		t.Fatalf("login with wrong TOTP status=%d; want 401", bad.Code)
	}
	valid, _ := login(testAdminTOTP(enrollment.Secret, time.Now()))
	if valid.Code != http.StatusOK {
		t.Fatalf("login with password and TOTP status=%d body=%s", valid.Code, valid.Body.String())
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("auth state was not persisted: %v", err)
	}
}

func mustParseTOTP(code string) int {
	value := 0
	for _, digit := range code {
		value = value*10 + int(digit-'0')
	}
	return value
}

func testAdminTOTP(secret string, now time.Time) string {
	key, _ := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	step := now.Unix() / 30
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(counter[:])
	sum := mac.Sum(nil)
	index := sum[len(sum)-1] & 0x0f
	value := (binary.BigEndian.Uint32(sum[index:index+4]) & 0x7fffffff) % 1_000_000
	return fmt.Sprintf("%06d", value)
}
