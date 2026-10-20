package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gtek-it/castor/server/internal/config"
)

const announcementResponseLimit = 900 << 10

type announcementResponse struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Title     string    `json:"title"`
	Message   string    `json:"message"`
	Link      string    `json:"link,omitempty"`
	ImageData string    `json:"imageData,omitempty"`
	ImageType string    `json:"imageType,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// CurrentAnnouncement returns the active Website announcement via a fixed
// server-side URL. The Website remains the sole source of truth.
func (s *Server) CurrentAnnouncement(w http.ResponseWriter, r *http.Request) {
	proxyCurrentAnnouncement(w, r, config.AnnouncementServiceURL)
}

func proxyCurrentAnnouncement(w http.ResponseWriter, r *http.Request, baseURL string) {
	u, err := url.Parse(baseURL + "/api/announcements/current")
	if err != nil {
		http.Error(w, "announcement service unavailable", http.StatusBadGateway)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		http.Error(w, "announcement service unavailable", http.StatusBadGateway)
		return
	}
	resp, err := (&http.Client{Timeout: 2 * time.Second}).Do(req)
	if err != nil {
		http.Error(w, "announcement service unavailable", http.StatusBadGateway)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusNotFound {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if resp.StatusCode != http.StatusOK {
		http.Error(w, "announcement service unavailable", http.StatusBadGateway)
		return
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, announcementResponseLimit+1))
	if err != nil || len(body) > announcementResponseLimit {
		http.Error(w, "announcement service returned an invalid response", http.StatusBadGateway)
		return
	}
	var a announcementResponse
	if err := json.Unmarshal(body, &a); err != nil || !validAnnouncement(a) {
		http.Error(w, "announcement service returned an invalid response", http.StatusBadGateway)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=30, stale-while-revalidate=60")
	ok(w, a)
}

func validAnnouncement(a announcementResponse) bool {
	if a.ID == "" || (a.Kind != "info" && a.Kind != "update" && a.Kind != "commercial") || strings.TrimSpace(a.Title) == "" || len([]rune(a.Title)) > 100 || strings.TrimSpace(a.Message) == "" || len([]rune(a.Message)) > 300 {
		return false
	}
	if a.Link != "" {
		u, err := url.ParseRequestURI(a.Link)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
			return false
		}
	}
	if a.ImageData == "" {
		return a.ImageType == ""
	}
	comma := strings.IndexByte(a.ImageData, ',')
	if comma < 0 || comma > 64 {
		return false
	}
	header, data := a.ImageData[:comma], a.ImageData[comma+1:]
	if header != "data:image/png;base64" && header != "data:image/jpeg;base64" {
		return false
	}
	if a.ImageType != strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64") {
		return false
	}
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil || len(b) == 0 || len(b) > 512<<10 {
		return false
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil || (format != "png" && format != "jpeg") || cfg.Width > 2400 || cfg.Height > 1200 || int64(cfg.Width)*int64(cfg.Height) > 2_000_000 {
		return false
	}
	return (header == "data:image/png;base64" && format == "png") || (header == "data:image/jpeg;base64" && format == "jpeg")
}
