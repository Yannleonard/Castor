// Command govulncheck-gate reads `govulncheck -format json` output on stdin and
// exits non-zero if ANY *called* vulnerability is found that is not on a small,
// explicitly-justified allow-list (rationale in SECURITY.md).
//
// This is stricter than `govulncheck || true`: every reachable finding that is
// NOT allow-listed re-fails the build, so a newly-introduced or newly-disclosed
// vulnerability still breaks CI. It is written in Go (no jq/bash dependency) so it
// runs identically on every platform.
//
// Usage (CI):
//
//	govulncheck -format json ./... | go run ./scripts/govulncheck-gate
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
)

// allowList holds OSV IDs assessed as NOT APPLICABLE to Castor. Keep minimal and
// re-review on every dependency bump. See SECURITY.md for the written rationale.
//
//	GO-2026-4887 (CVE-2026-34040): daemon AuthZ-plugin bypass — Castor is a client,
//	                               runs no AuthZ plugins. No fix in docker/docker.
//	GO-2026-4883 (CVE-2026-33997): daemon legacy-plugin privilege off-by-one —
//	                               Castor installs/validates no plugins. No fix.
var allowList = map[string]string{
	"GO-2026-4887": "daemon AuthZ-plugin bypass; Castor is a client with no AuthZ plugins (SECURITY.md)",
	"GO-2026-4883": "daemon legacy-plugin privilege off-by-one; Castor uses no plugins (SECURITY.md)",
}

// govulncheck streams newline-delimited JSON objects, each with one top-level key.
// We only care about "finding" entries that have at least one trace frame with a
// non-empty function (i.e. the vulnerable symbol is actually called/reachable).
type message struct {
	Finding *struct {
		OSV   string `json:"osv"`
		Trace []struct {
			Function string `json:"function"`
		} `json:"trace"`
	} `json:"finding"`
}

func main() {
	called := map[string]bool{}

	dec := json.NewDecoder(bufio.NewReader(os.Stdin))
	for {
		var m message
		if err := dec.Decode(&m); err != nil {
			break // EOF or end of stream
		}
		if m.Finding == nil || m.Finding.OSV == "" {
			continue
		}
		for _, f := range m.Finding.Trace {
			if f.Function != "" { // reachable
				called[m.Finding.OSV] = true
				break
			}
		}
	}

	if len(called) == 0 {
		fmt.Println("govulncheck-gate: ✅ no called vulnerabilities found.")
		return
	}

	ids := make([]string, 0, len(called))
	for id := range called {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	var violations []string
	for _, id := range ids {
		if reason, ok := allowList[id]; ok {
			fmt.Printf("govulncheck-gate: ⚠️  allow-listed (not applicable): %s — %s\n", id, reason)
			continue
		}
		violations = append(violations, id)
	}

	if len(violations) > 0 {
		fmt.Printf("govulncheck-gate: ❌ FAIL — %d non-allow-listed vulnerability(ies):\n", len(violations))
		for _, v := range violations {
			fmt.Printf("    - %s  (details: https://pkg.go.dev/vuln/%s)\n", v, v)
		}
		fmt.Println("govulncheck-gate: fix the dependency, or — only if genuinely not applicable —")
		fmt.Println("                  add it to allowList with a written rationale in SECURITY.md.")
		os.Exit(1)
	}

	fmt.Println("govulncheck-gate: ✅ pass — only allow-listed, non-applicable advisories remain.")
}
