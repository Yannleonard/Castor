package authz

import "testing"

func TestHashAndVerifyPassword(t *testing.T) {
	const pw = "correct horse battery staple"
	hash, err := HashPassword(pw)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if len(hash) < 50 || hash[:10] != "$argon2id$" {
		t.Fatalf("unexpected PHC format: %q", hash)
	}
	ok, err := VerifyPassword(pw, hash)
	if err != nil || !ok {
		t.Fatalf("VerifyPassword(correct) = %v, %v; want true,nil", ok, err)
	}
	bad, err := VerifyPassword("wrong password here", hash)
	if err != nil {
		t.Fatalf("VerifyPassword(wrong) err = %v", err)
	}
	if bad {
		t.Fatalf("VerifyPassword(wrong) = true; want false")
	}
}

func TestHashPasswordUsesFreshSalt(t *testing.T) {
	h1, _ := HashPassword("same-password-xx")
	h2, _ := HashPassword("same-password-xx")
	if h1 == h2 {
		t.Fatalf("two hashes of the same password must differ (random salt)")
	}
}

func TestVerifyPasswordRejectsMalformed(t *testing.T) {
	cases := []string{
		"",
		"not-a-hash",
		"$argon2id$v=19$m=19456,t=2,p=1$bad$bad",
		"$argon2i$v=19$m=19456,t=2,p=1$YWJj$YWJj",
	}
	for _, c := range cases {
		if ok, _ := VerifyPassword("x", c); ok {
			t.Errorf("VerifyPassword accepted malformed hash %q", c)
		}
	}
}
