// Command castor-agent connects a Linux Docker host to Castor over verified WSS.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"golang.org/x/term"

	"github.com/gtek-it/castor/server/internal/agent"
)

func main() {
	serverURL := flag.String("server", "", "fixed Castor WSS URL (wss://host/api/v1/agent/ws)")
	statePath := flag.String("state", "/var/lib/castor-agent/identity.json", "private identity state file")
	caFile := flag.String("ca", "", "additional CA PEM for private/self-signed Castor TLS")
	flag.Parse()
	if *serverURL == "" || *serverURL != strings.TrimSpace(*serverURL) {
		fmt.Fprintln(os.Stderr, "castor-agent: -server is required")
		os.Exit(2)
	}

	// Read the one-time credential only from an interactive terminal so it is
	// not present in process arguments, shell history, or environment dumps.
	var token string
	if f, err := os.OpenFile("/dev/tty", os.O_RDWR, 0); err == nil {
		defer f.Close()
		fmt.Fprint(f, "Enrollment token (leave empty to reconnect): ")
		line, readErr := term.ReadPassword(int(f.Fd()))
		fmt.Fprintln(f)
		if readErr != nil {
			fmt.Fprintln(os.Stderr, "castor-agent: could not read enrollment token")
			os.Exit(2)
		}
		token = strings.TrimSpace(string(line))
	} else {
		fmt.Fprintln(os.Stderr, "castor-agent: enrollment requires a secure interactive terminal")
		os.Exit(2)
	}

	client, err := agent.New(*serverURL, *statePath, token, *caFile)
	if err != nil {
		fmt.Fprintln(os.Stderr, "castor-agent: invalid configuration")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := client.Run(ctx); err != nil && err != context.Canceled {
		// Deliberately omit details: transport errors can contain URLs or secrets.
		fmt.Fprintln(os.Stderr, "castor-agent: stopped")
		os.Exit(1)
	}
}
