package docker

import (
	"context"
	"encoding/json"
	"io"
	"time"

	"github.com/docker/docker/api/types/container"

	"github.com/gtek-it/castor/server/internal/provider"
)

// Stats opens a streaming stats reader and emits a normalized StatSample on the
// returned channel until ctx is cancelled or the stream ends. CPU% is computed
// from the cpu/precpu deltas. The channel is closed on termination.
func (p *DockerProvider) Stats(ctx context.Context, id string) (<-chan provider.StatSample, error) {
	resp, err := p.cli.ContainerStats(ctx, id, true)
	if err != nil {
		return nil, mapNotFound(err)
	}

	out := make(chan provider.StatSample, 1)
	go func() {
		defer close(out)
		defer func() { _ = resp.Body.Close() }()

		dec := json.NewDecoder(resp.Body)
		for {
			if ctx.Err() != nil {
				return
			}
			var raw container.StatsResponse
			if err := dec.Decode(&raw); err != nil {
				if err == io.EOF || ctx.Err() != nil {
					return
				}
				// Transient decode error: stop the stream rather than spin.
				return
			}
			sample := toStatSample(&raw)
			select {
			case out <- sample:
			case <-ctx.Done():
				return
			}
		}
	}()
	return out, nil
}

// toStatSample converts a raw Docker stats frame into a normalized StatSample.
func toStatSample(s *container.StatsResponse) provider.StatSample {
	ts := s.Read
	if ts.IsZero() {
		ts = time.Now()
	}
	sample := provider.StatSample{
		Timestamp:     ts.UTC(),
		CPUPercent:    calcCPUPercent(s),
		MemUsageBytes: memUsage(s),
		MemLimitBytes: s.MemoryStats.Limit,
	}
	for _, nw := range s.Networks {
		sample.NetRxBytes += nw.RxBytes
		sample.NetTxBytes += nw.TxBytes
	}
	sample.BlkReadBytes, sample.BlkWriteBytes = blkIO(s)
	return sample
}

// calcCPUPercent computes the CPU percentage (0..100*nCPU) from cpu/precpu deltas.
func calcCPUPercent(s *container.StatsResponse) float64 {
	cpuDelta := float64(s.CPUStats.CPUUsage.TotalUsage) - float64(s.PreCPUStats.CPUUsage.TotalUsage)
	sysDelta := float64(s.CPUStats.SystemUsage) - float64(s.PreCPUStats.SystemUsage)
	if sysDelta <= 0 || cpuDelta < 0 {
		return 0
	}
	cpus := float64(s.CPUStats.OnlineCPUs)
	if cpus == 0 {
		cpus = float64(len(s.CPUStats.CPUUsage.PercpuUsage))
	}
	if cpus == 0 {
		cpus = 1
	}
	return (cpuDelta / sysDelta) * cpus * 100.0
}

// memUsage returns the working-set memory (usage minus cache where available).
func memUsage(s *container.StatsResponse) uint64 {
	usage := s.MemoryStats.Usage
	// cgroup v1 exposes "cache"; v2 exposes "inactive_file". Subtract page cache
	// to better reflect actual working set, mirroring `docker stats`.
	if cache, ok := s.MemoryStats.Stats["cache"]; ok && cache <= usage {
		return usage - cache
	}
	if inactive, ok := s.MemoryStats.Stats["inactive_file"]; ok && inactive <= usage {
		return usage - inactive
	}
	return usage
}

// blkIO sums block read/write bytes across devices.
func blkIO(s *container.StatsResponse) (read, write uint64) {
	for _, e := range s.BlkioStats.IoServiceBytesRecursive {
		switch e.Op {
		case "Read", "read":
			read += e.Value
		case "Write", "write":
			write += e.Value
		}
	}
	return read, write
}
