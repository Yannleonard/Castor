package docker

import (
	"context"
	"io"
	"strconv"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/pkg/stdcopy"

	"github.com/gtek-it/castor/server/internal/provider"
)

// Logs returns the raw multiplexed log stream for a container. The caller (the
// WS hub or the one-shot REST handler) demultiplexes it with DemuxLogs.
func (p *DockerProvider) Logs(ctx context.Context, id string, opts provider.LogOptions) (io.ReadCloser, error) {
	logOpts := container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     opts.Follow,
		Timestamps: opts.Timestamps,
	}
	if opts.Tail > 0 {
		logOpts.Tail = strconv.Itoa(opts.Tail)
	}
	if !opts.Since.IsZero() {
		logOpts.Since = opts.Since.UTC().Format("2006-01-02T15:04:05.000000000Z07:00")
	}
	rc, err := p.cli.ContainerLogs(ctx, id, logOpts)
	if err != nil {
		return nil, mapNotFound(err)
	}
	return rc, nil
}

// LogLine is one demultiplexed log line with its source stream.
type LogLine struct {
	Stream string // "stdout" | "stderr"
	Line   string
}

// DemuxLogs reads a Docker multiplexed log stream and invokes fn for each line,
// labelling stdout/stderr. It returns when the stream ends or fn returns false.
// The container's logs are NOT TTY-multiplexed when ShowStdout && ShowStderr are
// both set and the container has no TTY; stdcopy handles both cases via the
// frame header, falling back to raw copy for TTY containers.
func DemuxLogs(r io.Reader, hasTTY bool, fn func(LogLine) bool) error {
	if hasTTY {
		return demuxRaw(r, fn)
	}
	stdoutW := &lineWriter{stream: "stdout", emit: fn}
	stderrW := &lineWriter{stream: "stderr", emit: fn}
	_, err := stdcopy.StdCopy(stdoutW, stderrW, r)
	stdoutW.flush()
	stderrW.flush()
	if stdoutW.stopped || stderrW.stopped {
		return nil
	}
	if err == io.EOF {
		return nil
	}
	return err
}

// demuxRaw treats the stream as a single (TTY) stdout stream, splitting lines.
func demuxRaw(r io.Reader, fn func(LogLine) bool) error {
	w := &lineWriter{stream: "stdout", emit: fn}
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return werr
			}
			if w.stopped {
				return nil
			}
		}
		if err != nil {
			w.flush()
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

// lineWriter buffers bytes and emits complete (newline-terminated) lines via fn.
type lineWriter struct {
	stream  string
	emit    func(LogLine) bool
	buf     []byte
	stopped bool
}

func (w *lineWriter) Write(p []byte) (int, error) {
	if w.stopped {
		return len(p), nil
	}
	w.buf = append(w.buf, p...)
	for {
		idx := indexByte(w.buf, '\n')
		if idx < 0 {
			break
		}
		line := string(w.buf[:idx])
		w.buf = w.buf[idx+1:]
		if !w.emit(LogLine{Stream: w.stream, Line: line}) {
			w.stopped = true
			return len(p), nil
		}
	}
	return len(p), nil
}

func (w *lineWriter) flush() {
	if w.stopped || len(w.buf) == 0 {
		return
	}
	line := string(w.buf)
	w.buf = nil
	w.emit(LogLine{Stream: w.stream, Line: line})
}

func indexByte(b []byte, c byte) int {
	for i := range b {
		if b[i] == c {
			return i
		}
	}
	return -1
}

// ContainerHasTTY reports whether a container was started with a TTY (affects
// log demuxing). Errors are treated as "no TTY" (use stdcopy).
func (p *DockerProvider) ContainerHasTTY(ctx context.Context, id string) bool {
	cj, err := p.cli.ContainerInspect(ctx, id)
	if err != nil || cj.Config == nil {
		return false
	}
	return cj.Config.Tty
}
