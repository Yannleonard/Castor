// Castor by IT Leonard
package store

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestTLSCertificateSingleActiveRow(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	if _, err := st.GetTLSCertificate(ctx); !errors.Is(err, ErrNotFound) {
		t.Fatalf("empty table err = %v want ErrNotFound", err)
	}
	if err := st.DeleteTLSCertificate(ctx); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete on empty err = %v want ErrNotFound", err)
	}

	first := &TLSCertificate{
		CertPEM: "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n",
		KeyEnc:  []byte{1, 2, 3}, Subject: "CN=one", Issuer: "CN=ca",
		NotBefore: 100, NotAfter: 200, FingerprintSHA256: "AA:BB",
	}
	if err := st.UpsertTLSCertificate(ctx, first); err != nil {
		t.Fatalf("Upsert first: %v", err)
	}
	if first.ID == "" || first.CreatedAt == 0 {
		t.Errorf("Upsert must assign id and created_at: %+v", first)
	}
	got, err := st.GetTLSCertificate(ctx)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.ID != first.ID || got.Subject != "CN=one" || got.ChainPEM != "" || string(got.KeyEnc) != "\x01\x02\x03" || got.NotAfter != 200 {
		t.Errorf("round-trip mismatch: %+v", got)
	}

	second := &TLSCertificate{
		CertPEM: "cert2", ChainPEM: "chain2", KeyEnc: []byte{9}, Subject: "CN=two", Issuer: "CN=ca",
		NotBefore: 300, NotAfter: 400, FingerprintSHA256: "CC:DD", CreatedAt: first.CreatedAt + 10,
	}
	if err := st.UpsertTLSCertificate(ctx, second); err != nil {
		t.Fatalf("Upsert second: %v", err)
	}
	var n int
	if err := st.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM tls_certificates`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("rows = %d want exactly 1 after upsert", n)
	}
	got, _ = st.GetTLSCertificate(ctx)
	if got.ID != second.ID || got.Subject != "CN=two" || got.ChainPEM != "chain2" {
		t.Errorf("active row not replaced: %+v", got)
	}

	if err := st.DeleteTLSCertificate(ctx); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := st.GetTLSCertificate(ctx); !errors.Is(err, ErrNotFound) {
		t.Errorf("after delete err = %v want ErrNotFound", err)
	}
}

func TestParseAndFormatTLSDomains(t *testing.T) {
	cases := map[string][]string{
		"":                                   nil,
		"   ":                                nil,
		"app.example.test":                   {"app.example.test"},
		"App.Example.Test, api.example.test": {"app.example.test", "api.example.test"},
		"a.example.test;b.example.test\nc.example.test  a.example.test": {"a.example.test", "b.example.test", "c.example.test"},
		`["x.example.test", "Y.example.test", "x.example.test"]`:        {"x.example.test", "y.example.test"},
		`[not json`: nil,
	}
	for in, want := range cases {
		if got := ParseTLSDomains(in); !reflect.DeepEqual(got, want) {
			t.Errorf("ParseTLSDomains(%q) = %v want %v", in, got, want)
		}
	}
	if got := FormatTLSDomains([]string{" B.example.test", "a.example.test", "b.example.test"}); got != "b.example.test,a.example.test" {
		t.Errorf("FormatTLSDomains = %q", got)
	}
	if got := FormatTLSDomains(nil); got != "" {
		t.Errorf("FormatTLSDomains(nil) = %q", got)
	}
}
