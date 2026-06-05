package docker

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/pkg/stdcopy"
)

// helperImage is the throwaway image used to tar/untar volume contents. The
// distroless Castor image ships no tar, so backup/restore is delegated to a
// short-lived helper container that mounts the target volume.
const helperImage = "alpine:3.20"

// ensureHelperImage pulls helperImage if it is not present locally. The pull
// progress is drained and discarded; failures to find it cause a pull, and a
// pull failure is returned.
func (p *DockerProvider) ensureHelperImage(ctx context.Context) error {
	imgs, err := p.cli.ImageList(ctx, image.ListOptions{All: false})
	if err == nil {
		for _, im := range imgs {
			for _, tag := range im.RepoTags {
				if tag == helperImage {
					return nil
				}
			}
		}
	}
	rc, perr := p.cli.ImagePull(ctx, helperImage, image.PullOptions{})
	if perr != nil {
		return fmt.Errorf("docker: pull helper image %s: %w", helperImage, perr)
	}
	defer func() { _ = rc.Close() }()
	// Drain the progress stream so the pull runs to completion.
	_, _ = io.Copy(io.Discard, rc)
	return nil
}

// BackupVolume streams a gzip-compressed tar of the named volume's contents to
// w and returns the number of bytes written. It runs a throwaway alpine helper
// with the volume mounted read-only at /from, attaches to its stdout (the tar
// stream), demultiplexes it (the helper has no TTY, so stdout/stderr are
// multiplexed per the Docker attach framing), and waits for a clean exit before
// removing the helper.
func (p *DockerProvider) BackupVolume(ctx context.Context, volumeName string, w io.Writer) (int64, error) {
	if err := p.ensureHelperImage(ctx); err != nil {
		return 0, err
	}

	created, err := p.cli.ContainerCreate(ctx, &container.Config{
		Image:        helperImage,
		Cmd:          []string{"tar", "czf", "-", "-C", "/from", "."},
		AttachStdout: true,
		AttachStderr: true,
		Tty:          false,
	}, &container.HostConfig{
		AutoRemove: false,
		Mounts: []mount.Mount{{
			Type:     mount.TypeVolume,
			Source:   volumeName,
			Target:   "/from",
			ReadOnly: true,
		}},
	}, nil, nil, "")
	if err != nil {
		return 0, fmt.Errorf("docker: create backup helper: %w", mapNotFound(err))
	}
	helperID := created.ID
	// Always remove the helper, even on error paths.
	defer func() {
		_ = p.cli.ContainerRemove(context.WithoutCancel(ctx), helperID, container.RemoveOptions{Force: true})
	}()

	// Attach to stdout/stderr BEFORE starting so no output frame is missed.
	att, err := p.cli.ContainerAttach(ctx, helperID, container.AttachOptions{
		Stream: true,
		Stdout: true,
		Stderr: true,
	})
	if err != nil {
		return 0, fmt.Errorf("docker: attach backup helper: %w", err)
	}
	defer att.Close()

	if err := p.cli.ContainerStart(ctx, helperID, container.StartOptions{}); err != nil {
		return 0, fmt.Errorf("docker: start backup helper: %w", mapNotFound(err))
	}

	// Demux: stdout carries the tar bytes, stderr carries tar diagnostics.
	cw := &countWriter{w: w}
	var stderrBuf capWriter
	copyErr := make(chan error, 1)
	go func() {
		_, e := stdcopy.StdCopy(cw, &stderrBuf, att.Reader)
		copyErr <- e
	}()

	// Wait for the helper to exit while the copy goroutine drains stdout.
	waitCh, errCh := p.cli.ContainerWait(ctx, helperID, container.WaitConditionNotRunning)
	var exit int64 = -1
	select {
	case werr := <-errCh:
		if werr != nil {
			return cw.n, fmt.Errorf("docker: wait backup helper: %w", werr)
		}
	case res := <-waitCh:
		if res.Error != nil {
			return cw.n, fmt.Errorf("docker: backup helper wait error: %s", res.Error.Message)
		}
		exit = res.StatusCode
	}

	// Drain the remaining stdout after exit so the tar is complete.
	if cerr := <-copyErr; cerr != nil && !errors.Is(cerr, io.EOF) {
		return cw.n, fmt.Errorf("docker: stream backup tar: %w", cerr)
	}
	if exit != 0 {
		return cw.n, fmt.Errorf("docker: backup helper exited %d: %s", exit, stderrBuf.String())
	}
	return cw.n, nil
}

// RestoreVolume untars a gzip-compressed tar (as produced by BackupVolume) from
// r into the named volume. It runs a throwaway alpine helper with the volume
// mounted read-write at /to, pipes r into the helper's stdin, and waits for a
// clean exit before removing the helper. The caller is responsible for ensuring
// the volume exists / is safe to overwrite.
func (p *DockerProvider) RestoreVolume(ctx context.Context, volumeName string, r io.Reader) error {
	if err := p.ensureHelperImage(ctx); err != nil {
		return err
	}

	created, err := p.cli.ContainerCreate(ctx, &container.Config{
		Image:       helperImage,
		Cmd:         []string{"sh", "-c", "tar xzf - -C /to"},
		AttachStdin: true,
		OpenStdin:   true,
		StdinOnce:   true,
		Tty:         false,
	}, &container.HostConfig{
		AutoRemove: false,
		Mounts: []mount.Mount{{
			Type:   mount.TypeVolume,
			Source: volumeName,
			Target: "/to",
		}},
	}, nil, nil, "")
	if err != nil {
		return fmt.Errorf("docker: create restore helper: %w", mapNotFound(err))
	}
	helperID := created.ID
	defer func() {
		_ = p.cli.ContainerRemove(context.WithoutCancel(ctx), helperID, container.RemoveOptions{Force: true})
	}()

	// Attach to stdin (and stderr for diagnostics) BEFORE start so the helper's
	// `tar` reads the full archive from the hijacked connection.
	att, err := p.cli.ContainerAttach(ctx, helperID, container.AttachOptions{
		Stream: true,
		Stdin:  true,
		Stderr: true,
	})
	if err != nil {
		return fmt.Errorf("docker: attach restore helper: %w", err)
	}
	defer att.Close()

	if err := p.cli.ContainerStart(ctx, helperID, container.StartOptions{}); err != nil {
		return fmt.Errorf("docker: start restore helper: %w", mapNotFound(err))
	}

	// Collect stderr for error reporting while we feed stdin.
	var stderrBuf capWriter
	copyErr := make(chan error, 1)
	go func() {
		_, e := stdcopy.StdCopy(io.Discard, &stderrBuf, att.Reader)
		copyErr <- e
	}()

	// Stream the archive into the helper's stdin, then signal EOF so tar finishes.
	_, cpErr := io.Copy(att.Conn, r)
	if cwErr := att.CloseWrite(); cwErr != nil && cpErr == nil {
		cpErr = cwErr
	}
	if cpErr != nil {
		return fmt.Errorf("docker: stream restore tar: %w", cpErr)
	}

	waitCh, errCh := p.cli.ContainerWait(ctx, helperID, container.WaitConditionNotRunning)
	var exit int64 = -1
	select {
	case werr := <-errCh:
		if werr != nil {
			return fmt.Errorf("docker: wait restore helper: %w", werr)
		}
	case res := <-waitCh:
		if res.Error != nil {
			return fmt.Errorf("docker: restore helper wait error: %s", res.Error.Message)
		}
		exit = res.StatusCode
	}
	<-copyErr // ensure stderr drained
	if exit != 0 {
		return fmt.Errorf("docker: restore helper exited %d: %s", exit, stderrBuf.String())
	}
	return nil
}

// countWriter counts bytes copied through to the underlying writer.
type countWriter struct {
	w io.Writer
	n int64
}

func (c *countWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.n += int64(n)
	return n, err
}

// capWriter buffers up to capWriterMax bytes of (stderr) diagnostics for error
// messages, discarding the rest to avoid unbounded memory growth.
const capWriterMax = 4096

type capWriter struct {
	buf []byte
}

func (c *capWriter) Write(p []byte) (int, error) {
	if rem := capWriterMax - len(c.buf); rem > 0 {
		if len(p) <= rem {
			c.buf = append(c.buf, p...)
		} else {
			c.buf = append(c.buf, p[:rem]...)
		}
	}
	return len(p), nil
}

func (c *capWriter) String() string { return string(c.buf) }
