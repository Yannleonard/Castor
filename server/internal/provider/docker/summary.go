package docker

import (
	"context"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/api/types/volume"
)

// HostSummary holds aggregate counts for the host overview endpoint.
type HostSummary struct {
	Containers int `json:"containers"`
	Running    int `json:"running"`
	Images     int `json:"images"`
	Networks   int `json:"networks"`
	Volumes    int `json:"volumes"`
}

// Summary returns aggregate Docker counts for the host overview. Best-effort:
// individual count failures yield zero for that field rather than an error.
func (p *DockerProvider) Summary(ctx context.Context) (HostSummary, error) {
	var s HostSummary
	if cs, err := p.cli.ContainerList(ctx, container.ListOptions{All: true}); err == nil {
		s.Containers = len(cs)
		for _, c := range cs {
			if c.State == "running" {
				s.Running++
			}
		}
	}
	if imgs, err := p.cli.ImageList(ctx, image.ListOptions{}); err == nil {
		s.Images = len(imgs)
	}
	if nets, err := p.cli.NetworkList(ctx, network.ListOptions{}); err == nil {
		s.Networks = len(nets)
	}
	if vols, err := p.cli.VolumeList(ctx, volume.ListOptions{}); err == nil {
		s.Volumes = len(vols.Volumes)
	}
	return s, nil
}
