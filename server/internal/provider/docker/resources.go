package docker

import (
	"context"
	"io"
	"strings"
	"time"

	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/api/types/volume"
)

// ImageInfo is the normalized image summary the API exposes.
type ImageInfo struct {
	ID       string   `json:"id"`
	RepoTags []string `json:"repoTags"`
	Size     int64    `json:"size"`
	Created  int64    `json:"created"`
	Dangling bool     `json:"dangling"`
}

// ListImages returns normalized image summaries.
func (p *DockerProvider) ListImages(ctx context.Context) ([]ImageInfo, error) {
	imgs, err := p.cli.ImageList(ctx, image.ListOptions{All: false})
	if err != nil {
		return nil, err
	}
	out := make([]ImageInfo, 0, len(imgs))
	for _, im := range imgs {
		tags := im.RepoTags
		dangling := len(tags) == 0 || (len(tags) == 1 && tags[0] == "<none>:<none>")
		if tags == nil {
			tags = []string{}
		}
		out = append(out, ImageInfo{
			ID:       im.ID,
			RepoTags: tags,
			Size:     im.Size,
			Created:  im.Created,
			Dangling: dangling,
		})
	}
	return out, nil
}

// PullImage pulls an image by reference, returning the daemon's progress stream.
// The ref MUST be validated by the caller (anti-SSRF: image refs only, no URLs).
func (p *DockerProvider) PullImage(ctx context.Context, ref string) (io.ReadCloser, error) {
	return p.cli.ImagePull(ctx, ref, image.PullOptions{})
}

// DeleteImage removes an image by id/ref.
func (p *DockerProvider) DeleteImage(ctx context.Context, id string, force bool) error {
	_, err := p.cli.ImageRemove(ctx, id, image.RemoveOptions{Force: force, PruneChildren: true})
	if err != nil {
		return mapResourceErr(err)
	}
	return nil
}

// NetworkInfo is the normalized network summary the API exposes.
type NetworkInfo struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Driver   string `json:"driver"`
	Scope    string `json:"scope"`
	Internal bool   `json:"internal"`
}

// ListNetworks returns normalized network summaries.
func (p *DockerProvider) ListNetworks(ctx context.Context) ([]NetworkInfo, error) {
	nets, err := p.cli.NetworkList(ctx, network.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]NetworkInfo, 0, len(nets))
	for _, n := range nets {
		out = append(out, NetworkInfo{
			ID:       n.ID,
			Name:     n.Name,
			Driver:   n.Driver,
			Scope:    n.Scope,
			Internal: n.Internal,
		})
	}
	return out, nil
}

// DeleteNetwork removes a network by id.
func (p *DockerProvider) DeleteNetwork(ctx context.Context, id string) error {
	if err := p.cli.NetworkRemove(ctx, id); err != nil {
		return mapResourceErr(err)
	}
	return nil
}

// VolumeInfo is the normalized volume summary the API exposes.
type VolumeInfo struct {
	Name       string    `json:"name"`
	Driver     string    `json:"driver"`
	Mountpoint string    `json:"mountpoint"`
	CreatedAt  time.Time `json:"createdAt"`
}

// ListVolumes returns normalized volume summaries.
func (p *DockerProvider) ListVolumes(ctx context.Context) ([]VolumeInfo, error) {
	resp, err := p.cli.VolumeList(ctx, volume.ListOptions{Filters: filters.NewArgs()})
	if err != nil {
		return nil, err
	}
	out := make([]VolumeInfo, 0, len(resp.Volumes))
	for _, v := range resp.Volumes {
		var created time.Time
		if v.CreatedAt != "" {
			if t, perr := time.Parse(time.RFC3339, v.CreatedAt); perr == nil {
				created = t.UTC()
			}
		}
		out = append(out, VolumeInfo{
			Name:       v.Name,
			Driver:     v.Driver,
			Mountpoint: v.Mountpoint,
			CreatedAt:  created,
		})
	}
	return out, nil
}

// VolumeMountpoint returns a volume's mountpoint (used by the data-volume self
// protection check). Empty if not found.
func (p *DockerProvider) VolumeMountpoint(ctx context.Context, name string) string {
	v, err := p.cli.VolumeInspect(ctx, name)
	if err != nil {
		return ""
	}
	return v.Mountpoint
}

// DeleteVolume removes a volume by name.
func (p *DockerProvider) DeleteVolume(ctx context.Context, name string, force bool) error {
	if err := p.cli.VolumeRemove(ctx, name, force); err != nil {
		return mapResourceErr(err)
	}
	return nil
}

// ValidImageRef reports whether ref looks like a safe image reference (no
// scheme/URL, no whitespace, reasonable charset). Anti-SSRF for image pull.
func ValidImageRef(ref string) bool {
	ref = strings.TrimSpace(ref)
	if ref == "" || len(ref) > 255 {
		return false
	}
	if strings.ContainsAny(ref, " \t\n\r\"'\\") {
		return false
	}
	if strings.Contains(ref, "://") {
		return false
	}
	for _, c := range ref {
		switch {
		case c >= 'a' && c <= 'z',
			c >= 'A' && c <= 'Z',
			c >= '0' && c <= '9':
		case c == '.' || c == '-' || c == '_' || c == '/' || c == ':' || c == '@':
		default:
			return false
		}
	}
	return true
}
