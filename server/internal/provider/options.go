package provider

import (
	"context"
	"io"
	"time"
)

// ListOptions filters/paginates ListWorkloads. All fields optional.
type ListOptions struct {
	All           bool              // include stopped/terminal workloads (docker All=true)
	LabelSelector map[string]string // label/annotation equality filters
	Namespace     string            // k8s only; "" = all namespaces the kubeconfig can read
}

// LogOptions controls Logs streaming.
type LogOptions struct {
	Follow     bool
	Tail       int       // 0 = all; N = last N lines
	Since      time.Time // zero = from start
	Timestamps bool
	Container  string // k8s: which container in the pod ("" = first/default)
}

// RemoveOptions controls Remove (Docker only in V1).
type RemoveOptions struct {
	Force         bool
	RemoveVolumes bool
}

// ExecOptions controls Exec. Env/WorkingDir apply to Docker; Container applies
// to Kubernetes (which container in a multi-container pod to exec into, "" =>
// the pod's default/first container — Docker ignores it).
type ExecOptions struct {
	Cmd        []string
	Tty        bool
	Env        []string
	WorkingDir string
	Container  string
}

// ExecStream is the bidirectional exec attachment.
type ExecStream interface {
	io.ReadWriteCloser
	// Resize updates the TTY size (rows, cols).
	Resize(ctx context.Context, rows, cols uint16) error
	// ExitCode blocks until the command exits and returns its code (-1 if unknown).
	ExitCode(ctx context.Context) (int, error)
}

// StatSample is one normalized resource sample emitted by Stats.
type StatSample struct {
	Timestamp     time.Time `json:"timestamp"`
	CPUPercent    float64   `json:"cpuPercent"` // 0..(100*nCPU)
	MemUsageBytes uint64    `json:"memUsageBytes"`
	MemLimitBytes uint64    `json:"memLimitBytes"` // 0 if unlimited/unknown
	NetRxBytes    uint64    `json:"netRxBytes"`
	NetTxBytes    uint64    `json:"netTxBytes"`
	BlkReadBytes  uint64    `json:"blkReadBytes"`
	BlkWriteBytes uint64    `json:"blkWriteBytes"`
}
