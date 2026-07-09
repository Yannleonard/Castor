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

// NetworkSpec is the minimal create-network request. Name is required; Driver
// defaults to "bridge" when empty. Internal and Labels are optional.
type NetworkSpec struct {
	Name     string            `json:"name"`
	Driver   string            `json:"driver"`
	Internal bool              `json:"internal"`
	Labels   map[string]string `json:"labels"`
}

// CreateNetwork creates a network from spec (name + driver, default bridge) and
// returns the normalized summary of the created network.
func (p *DockerProvider) CreateNetwork(ctx context.Context, spec NetworkSpec) (*NetworkInfo, error) {
	driver := spec.Driver
	if driver == "" {
		driver = "bridge"
	}
	resp, err := p.cli.NetworkCreate(ctx, spec.Name, network.CreateOptions{
		Driver:   driver,
		Internal: spec.Internal,
		Labels:   spec.Labels,
	})
	if err != nil {
		return nil, mapResourceErr(err)
	}
	return &NetworkInfo{
		ID:       resp.ID,
		Name:     spec.Name,
		Driver:   driver,
		Scope:    "local",
		Internal: spec.Internal,
	}, nil
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

// VolumeSpec is the minimal create-volume request. Name is required; Driver
// defaults to the daemon's local driver when empty. Labels are optional.
type VolumeSpec struct {
	Name   string            `json:"name"`
	Driver string            `json:"driver"`
	Labels map[string]string `json:"labels"`
}

// CreateVolume creates a volume from spec (name + optional driver) and returns
// the normalized summary of the created volume.
func (p *DockerProvider) CreateVolume(ctx context.Context, spec VolumeSpec) (*VolumeInfo, error) {
	v, err := p.cli.VolumeCreate(ctx, volume.CreateOptions{
		Name:   spec.Name,
		Driver: spec.Driver,
		Labels: spec.Labels,
	})
	if err != nil {
		return nil, mapResourceErr(err)
	}
	var created time.Time
	if v.CreatedAt != "" {
		if t, perr := time.Parse(time.RFC3339, v.CreatedAt); perr == nil {
			created = t.UTC()
		}
	}
	return &VolumeInfo{
		Name:       v.Name,
		Driver:     v.Driver,
		Mountpoint: v.Mountpoint,
		CreatedAt:  created,
	}, nil
}

// DeleteVolume removes a volume by name.
func (p *DockerProvider) DeleteVolume(ctx context.Context, name string, force bool) error {
	if err := p.cli.VolumeRemove(ctx, name, force); err != nil {
		return mapResourceErr(err)
	}
	return nil
}

// PruneReport is the normalized result of a prune operation: the ids/names of
// the removed resources and the disk space reclaimed in bytes (networks report
// no reclaimed space, so SpaceReclaimed is 0 for a network prune).
type PruneReport struct {
	Removed        []string `json:"removed"`
	SpaceReclaimed uint64   `json:"spaceReclaimed"`
}

// PruneImages removes unused images. When dangling is true only untagged
// (dangling) images are removed (the Docker default); when false every image
// not referenced by a container is removed (docker image prune -a).
func (p *DockerProvider) PruneImages(ctx context.Context, dangling bool) (*PruneReport, error) {
	f := filters.NewArgs()
	// The daemon's dangling filter: "true" = only dangling; "false" = all unused.
	if dangling {
		f.Add("dangling", "true")
	} else {
		f.Add("dangling", "false")
	}
	rep, err := p.cli.ImagesPrune(ctx, f)
	if err != nil {
		return nil, err
	}
	removed := make([]string, 0, len(rep.ImagesDeleted))
	for _, d := range rep.ImagesDeleted {
		switch {
		case d.Deleted != "":
			removed = append(removed, d.Deleted)
		case d.Untagged != "":
			removed = append(removed, d.Untagged)
		}
	}
	return &PruneReport{Removed: removed, SpaceReclaimed: rep.SpaceReclaimed}, nil
}

// PruneContainers removes all stopped containers.
func (p *DockerProvider) PruneContainers(ctx context.Context) (*PruneReport, error) {
	rep, err := p.cli.ContainersPrune(ctx, filters.NewArgs())
	if err != nil {
		return nil, err
	}
	removed := append([]string{}, rep.ContainersDeleted...)
	return &PruneReport{Removed: removed, SpaceReclaimed: rep.SpaceReclaimed}, nil
}

// PruneVolumes removes all unused (unreferenced) volumes.
func (p *DockerProvider) PruneVolumes(ctx context.Context) (*PruneReport, error) {
	rep, err := p.cli.VolumesPrune(ctx, filters.NewArgs())
	if err != nil {
		return nil, err
	}
	removed := append([]string{}, rep.VolumesDeleted...)
	return &PruneReport{Removed: removed, SpaceReclaimed: rep.SpaceReclaimed}, nil
}

// PruneNetworks removes all unused networks. The daemon reports no reclaimed
// space for networks, so SpaceReclaimed is always 0 here.
func (p *DockerProvider) PruneNetworks(ctx context.Context) (*PruneReport, error) {
	rep, err := p.cli.NetworksPrune(ctx, filters.NewArgs())
	if err != nil {
		return nil, err
	}
	removed := append([]string{}, rep.NetworksDeleted...)
	return &PruneReport{Removed: removed, SpaceReclaimed: 0}, nil
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
