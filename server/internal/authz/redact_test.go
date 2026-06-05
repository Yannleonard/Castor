package authz

import "testing"

func TestIsSecretKey(t *testing.T) {
	secret := []string{"PASSWORD", "db_password", "API_KEY", "authorization", "TOKEN", "MY_SECRET", "session_id", "AWS_ACCESS_KEY"}
	for _, k := range secret {
		if !IsSecretKey(k) {
			t.Errorf("IsSecretKey(%q) = false; want true", k)
		}
	}
	notSecret := []string{"PATH", "HOME", "name", "image", "replicas"}
	for _, k := range notSecret {
		if IsSecretKey(k) {
			t.Errorf("IsSecretKey(%q) = true; want false", k)
		}
	}
}

func TestRedactNestedMap(t *testing.T) {
	in := map[string]any{
		"username": "alice",
		"password": "hunter2",
		"nested": map[string]any{
			"api_key": "abc123",
			"region":  "eu",
		},
		"list": []any{
			map[string]any{"token": "xyz", "ok": true},
		},
	}
	out := RedactMap(in)
	if out["password"] != "[REDACTED]" {
		t.Errorf("password not redacted: %v", out["password"])
	}
	if out["username"] != "alice" {
		t.Errorf("username should be preserved")
	}
	nested := out["nested"].(map[string]any)
	if nested["api_key"] != "[REDACTED]" {
		t.Errorf("nested api_key not redacted")
	}
	if nested["region"] != "eu" {
		t.Errorf("nested region should be preserved")
	}
	list := out["list"].([]any)
	item := list[0].(map[string]any)
	if item["token"] != "[REDACTED]" {
		t.Errorf("list item token not redacted")
	}
	if item["ok"] != true {
		t.Errorf("list item ok should be preserved")
	}
}
