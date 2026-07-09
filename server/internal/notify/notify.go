// Package notify delivers outbound webhook notifications (Discord, Slack,
// ntfy, generic JSON webhooks). The webhook URL embeds a secret token, so no
// error or log line produced here ever contains the URL — errors are redacted
// to the channel type and the underlying transport cause only.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"syscall"
	"time"
)

// sendTimeout caps one webhook delivery end-to-end.
const sendTimeout = 15 * time.Second

// maxDrainBytes bounds how much of a response body is drained (for connection
// reuse); the body is never parsed.
const maxDrainBytes = 4 << 10

// maxRedirects bounds how many redirect hops one delivery may follow. Every
// hop dials through the guarded Transport below, so a redirect cannot reach
// an address the initial request could not.
const maxRedirects = 3

// Destination IP policy. Webhook URLs are user-supplied, so the check must
// run at dial time on the resolved IP — parse-time validation alone is
// defeated by DNS rebinding. Rules:
//
//   - loopback (127.0.0.0/8, ::1): refused, unless the operator sets
//     CASTOR_NOTIFY_ALLOW_LOOPBACK=true (endpoints on the same host).
//   - link-local (169.254.0.0/16, fe80::/10) and unspecified addresses:
//     always refused — cloud metadata services live there.
//   - private ranges (RFC1918 10/8, 172.16/12, 192.168/16; IPv6 ULA
//     fc00::/7): allowed by default — Castor is self-hosted and notification
//     endpoints (ntfy, etc.) commonly live on the LAN — refused when the
//     operator sets CASTOR_NOTIFY_DENY_PRIVATE=true.
func checkDialAddr(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		host = address
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return errors.New("destination address is not a resolved IP")
	}
	return checkDestIP(ip)
}

// checkDestIP applies the destination IP policy documented on checkDialAddr.
func checkDestIP(ip net.IP) error {
	switch {
	case ip.IsLoopback():
		if os.Getenv("CASTOR_NOTIFY_ALLOW_LOOPBACK") == "true" {
			return nil
		}
		return errors.New("loopback addresses are not allowed (set CASTOR_NOTIFY_ALLOW_LOOPBACK=true to permit)")
	case ip.IsLinkLocalUnicast(), ip.IsLinkLocalMulticast(), ip.IsUnspecified():
		return errors.New("link-local addresses are not allowed")
	case ip.IsPrivate():
		if os.Getenv("CASTOR_NOTIFY_DENY_PRIVATE") == "true" {
			return errors.New("private addresses are blocked (CASTOR_NOTIFY_DENY_PRIVATE=true)")
		}
	}
	return nil
}

// CheckLiteralHost applies the destination IP policy to a URL host when it is
// an IP literal, for a clear error at configuration time. Hostnames pass
// unchecked here — the dial-time guard covers them after DNS resolution.
func CheckLiteralHost(host string) error {
	if ip := net.ParseIP(host); ip != nil {
		return checkDestIP(ip)
	}
	return nil
}

// Event is one outbound notification. For type "webhook" channels the full
// struct is POSTed as JSON; the other channel types render Title/Message.
type Event struct {
	Kind    string `json:"kind"` // container.down|update.available|test
	Title   string `json:"title"`
	Message string `json:"message"`
	HostID  string `json:"hostId"`
	Target  string `json:"target"` // container name / image, per kind
	TS      int64  `json:"ts"`     // unix epoch seconds
}

// Sender posts events to webhook endpoints with a bounded timeout.
type Sender struct {
	client *http.Client
}

// NewSender returns a Sender with the default 15s HTTP timeout and the
// destination IP guard (see checkDialAddr).
func NewSender() *Sender {
	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
		// Control runs after DNS resolution with the concrete IP the socket
		// will connect to, so the policy holds even when a hostname's records
		// change between validation and delivery (DNS rebinding).
		Control: func(_, address string, _ syscall.RawConn) error {
			return checkDialAddr(address)
		},
	}
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           dialer.DialContext,
		MaxIdleConns:          10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: time.Second,
		ForceAttemptHTTP2:     true,
	}
	return &Sender{client: &http.Client{
		Timeout:   sendTimeout,
		Transport: transport,
		// Redirect hops dial through the same guarded Transport; the cap only
		// bounds how long a chain a misbehaving endpoint can force.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return errors.New("too many redirects")
			}
			return nil
		},
	}}
}

// Send delivers one event to a channel endpoint. chType is one of
// discord|slack|ntfy|webhook. Non-2xx responses are errors. The returned
// error never contains rawURL.
func (s *Sender) Send(ctx context.Context, chType, rawURL string, ev Event) error {
	var (
		body        []byte
		contentType string
		err         error
	)
	switch chType {
	case "discord":
		body, err = json.Marshal(map[string]string{"content": "**" + ev.Title + "**\n" + ev.Message})
		contentType = "application/json"
	case "slack":
		body, err = json.Marshal(map[string]string{"text": "*" + ev.Title + "*\n" + ev.Message})
		contentType = "application/json"
	case "ntfy":
		body = []byte(ev.Message)
		contentType = "text/plain; charset=utf-8"
	case "webhook":
		body, err = json.Marshal(ev)
		contentType = "application/json"
	default:
		return fmt.Errorf("notify: unknown channel type %q", chType)
	}
	if err != nil {
		return fmt.Errorf("notify: %s: encode payload: %w", chType, err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, bytes.NewReader(body))
	if err != nil {
		// The parse error would echo the URL; redact it.
		return fmt.Errorf("notify: %s: invalid webhook URL", chType)
	}
	req.Header.Set("Content-Type", contentType)
	if chType == "ntfy" {
		req.Header.Set("Title", ev.Title)
		if tags := ntfyTags(ev.Kind); tags != "" {
			req.Header.Set("Tags", tags)
		}
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("notify: %s: request failed: %v", chType, redactURLError(err))
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxDrainBytes))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("notify: %s: webhook returned HTTP %d", chType, resp.StatusCode)
	}
	return nil
}

// ntfyTags maps an event kind to the ntfy Tags header value.
func ntfyTags(kind string) string {
	switch kind {
	case "container.down":
		return "warning"
	case "update.available":
		return "package"
	}
	return ""
}

// redactURLError strips the target URL that *url.Error embeds in its message,
// keeping only the underlying transport cause.
func redactURLError(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) && ue.Err != nil {
		return ue.Err
	}
	return err
}
