package docker

import (
	"context"
	"io"
	"sync"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"

	"github.com/gtek-it/castor/server/internal/provider"
)

// Exec creates and attaches to an exec instance, returning a bidirectional
// ExecStream. The caller writes stdin, reads merged output, resizes the TTY and
// fetches the exit code. The WS hub demultiplexes stdout/stderr itself for
// non-TTY execs using DemuxLogs semantics; for a TTY exec the daemon already
// merges the streams.
func (p *DockerProvider) Exec(ctx context.Context, id string, opts provider.ExecOptions) (provider.ExecStream, error) {
	cmd := opts.Cmd
	if len(cmd) == 0 {
		cmd = []string{"/bin/sh"}
	}
	created, err := p.cli.ContainerExecCreate(ctx, id, container.ExecOptions{
		Cmd:          cmd,
		Tty:          opts.Tty,
		Env:          opts.Env,
		WorkingDir:   opts.WorkingDir,
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
	})
	if err != nil {
		return nil, mapNotFound(err)
	}

	att, err := p.cli.ContainerExecAttach(ctx, created.ID, container.ExecAttachOptions{Tty: opts.Tty})
	if err != nil {
		return nil, mapNotFound(err)
	}

	return &execStream{
		cli:    p.cli,
		execID: created.ID,
		att:    att,
		tty:    opts.Tty,
	}, nil
}

// execStream wraps a types.HijackedResponse to satisfy provider.ExecStream.
type execStream struct {
	cli    *client.Client
	execID string
	att    types.HijackedResponse
	tty    bool

	closeOnce sync.Once
}

// Read proxies the (possibly multiplexed) daemon output stream to the caller.
func (e *execStream) Read(p []byte) (int, error) { return e.att.Reader.Read(p) }

// Write sends stdin to the exec'd process.
func (e *execStream) Write(p []byte) (int, error) { return e.att.Conn.Write(p) }

// Close tears down the hijacked connection.
func (e *execStream) Close() error {
	e.closeOnce.Do(func() {
		e.att.Close()
	})
	return nil
}

// Resize updates the exec TTY size.
func (e *execStream) Resize(ctx context.Context, rows, cols uint16) error {
	return e.cli.ContainerExecResize(ctx, e.execID, container.ResizeOptions{
		Height: uint(rows),
		Width:  uint(cols),
	})
}

// ExitCode inspects the exec instance and returns the process exit code. It
// returns -1 if the process is still running or the code is unknown.
func (e *execStream) ExitCode(ctx context.Context) (int, error) {
	insp, err := e.cli.ContainerExecInspect(ctx, e.execID)
	if err != nil {
		return -1, err
	}
	if insp.Running {
		return -1, nil
	}
	return insp.ExitCode, nil
}

// IsTTY reports whether this exec was allocated a TTY (used by the WS hub to
// decide whether to stdcopy-demux the output).
func (e *execStream) IsTTY() bool { return e.tty }

// CloseWrite signals EOF on stdin if the underlying connection supports it.
func (e *execStream) CloseWrite() error {
	if cw, ok := e.att.Conn.(interface{ CloseWrite() error }); ok {
		return cw.CloseWrite()
	}
	return nil
}

// ensure io import stays meaningful (CloseWrite/io interplay in the WS layer).
var _ io.Writer = (*execStream)(nil)
