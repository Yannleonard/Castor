package kube

// exec.go implements interactive pod exec for the Kubernetes provider via the
// client-go SPDY remotecommand executor. Unlike the other k8s-native writes
// (scale/restart/delete/apply in write.go) this satisfies the GENERIC
// provider.Provider.Exec seam — the WS exec hub (api/ws.go) calls Exec on the
// resolved provider exactly as it does for Docker, so a K8s pod target gets a
// real terminal. CapExec is therefore set in Capabilities() (kube.go).
//
// remotecommand.StreamWithContext is a single blocking call that owns the SPDY
// streams for the whole session, whereas the ExecStream contract is a
// non-blocking io.ReadWriteCloser (the hub reads in one goroutine and writes
// stdin/resize from another). We bridge the two shapes with a pair of io.Pipes:
//   - client stdin  (ExecStream.Write) -> inWriter -> inReader  (StreamOptions.Stdin)
//   - pod stdout+err (StreamOptions.Stdout/Stderr) -> outWriter -> outReader (ExecStream.Read)
// Resize events feed a buffered TerminalSizeQueue channel. The stream runs in a
// goroutine; its terminal error (incl. CommandExecError carrying the exit code)
// is captured so ExitCode can report it after Read returns io.EOF.

import (
	"context"
	"errors"
	"io"
	"sync"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"
	exec "k8s.io/client-go/util/exec"

	"github.com/gtek-it/castor/server/internal/provider"
)

// Exec opens an interactive exec session inside a pod container. id is the
// "<ns>/<pod>" pod ref; opts.WorkingDir/opts.Env are ignored (the pods/exec
// subresource does not accept them — env is fixed by the container spec and a
// working dir is not part of PodExecOptions). The target container is selected
// via opts.Container ("" => the apiserver picks the pod's default/first
// container). The returned ExecStream is wired into the WS hub like Docker's.
func (p *KubeProvider) Exec(ctx context.Context, id string, opts provider.ExecOptions) (provider.ExecStream, error) {
	ns, name, err := splitPodID(id)
	if err != nil {
		return nil, provider.ErrNotFound
	}
	cmd := opts.Cmd
	if len(cmd) == 0 {
		cmd = []string{"/bin/sh"}
	}

	req := p.clientset.CoreV1().RESTClient().
		Post().
		Resource("pods").
		Name(name).
		Namespace(ns).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: opts.Container,
			Command:   cmd,
			Stdin:     true,
			Stdout:    true,
			Stderr:    !opts.Tty, // with a TTY the kernel merges stderr into stdout
			TTY:       opts.Tty,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(p.restConfig, "POST", req.URL())
	if err != nil {
		return nil, mapKubeWriteErr(err)
	}

	inReader, inWriter := io.Pipe()
	outReader, outWriter := io.Pipe()

	s := &kubeExecStream{
		inWriter:  inWriter,
		outReader: outReader,
		resizeCh:  make(chan remotecommand.TerminalSize, 4),
		done:      make(chan struct{}),
		tty:       opts.Tty,
		exitCode:  -1,
	}

	streamOpts := remotecommand.StreamOptions{
		Stdin:  inReader,
		Stdout: outWriter,
		Tty:    opts.Tty,
	}
	if !opts.Tty {
		streamOpts.Stderr = outWriter
	}
	if opts.Tty {
		streamOpts.TerminalSizeQueue = s
	}

	go func() {
		// StreamWithContext blocks until the remote command exits or ctx is
		// cancelled. Closing outWriter unblocks the hub's Read loop (-> io.EOF);
		// closing inReader stops any pending stdin copy. The terminal error is
		// recorded (with the exit code when the apiserver reports one) before done
		// is signalled so ExitCode can surface it.
		runErr := executor.StreamWithContext(ctx, streamOpts)
		s.mu.Lock()
		s.runErr = runErr
		var codeErr exec.CodeExitError
		if errors.As(runErr, &codeErr) {
			s.exitCode = codeErr.Code
		} else if runErr == nil {
			s.exitCode = 0
		}
		s.mu.Unlock()
		_ = outWriter.CloseWithError(io.EOF)
		_ = inReader.Close()
		close(s.done)
	}()

	return s, nil
}

// kubeExecStream adapts the blocking remotecommand stream to provider.ExecStream.
type kubeExecStream struct {
	inWriter  *io.PipeWriter // client stdin -> StreamOptions.Stdin
	outReader *io.PipeReader // StreamOptions.Stdout/Stderr -> client reads
	resizeCh  chan remotecommand.TerminalSize
	done      chan struct{} // closed when the remote command exits

	tty bool

	mu       sync.Mutex
	runErr   error
	exitCode int

	closeOnce sync.Once
}

// Read returns merged pod output; io.EOF once the command exits / stream closes.
func (s *kubeExecStream) Read(p []byte) (int, error) { return s.outReader.Read(p) }

// Write forwards client stdin keystrokes to the pod process.
func (s *kubeExecStream) Write(p []byte) (int, error) { return s.inWriter.Write(p) }

// Close tears the session down: closing the stdin writer signals EOF to the pod
// and closing the output reader unblocks any in-flight Read. The executor
// goroutine then returns and closes done.
func (s *kubeExecStream) Close() error {
	s.closeOnce.Do(func() {
		_ = s.inWriter.Close()
		_ = s.outReader.Close()
	})
	return nil
}

// Resize enqueues a new terminal size; consumed by the remotecommand size queue.
// A full channel (resize storm) drops the event rather than blocking the caller.
func (s *kubeExecStream) Resize(ctx context.Context, rows, cols uint16) error {
	if !s.tty {
		return nil
	}
	select {
	case s.resizeCh <- remotecommand.TerminalSize{Width: cols, Height: rows}:
	case <-s.done:
	case <-ctx.Done():
	default:
	}
	return nil
}

// Next implements remotecommand.TerminalSizeQueue: it blocks until the next
// resize or the session ends (returning nil, which the executor treats as "stop
// watching"). The first send primes the PTY with the client's initial size.
func (s *kubeExecStream) Next() *remotecommand.TerminalSize {
	select {
	case size := <-s.resizeCh:
		return &size
	case <-s.done:
		return nil
	}
}

// ExitCode blocks until the command has exited, then returns its code (-1 if
// the executor failed before/without a CodeExitError, e.g. a transport error).
func (s *kubeExecStream) ExitCode(ctx context.Context) (int, error) {
	select {
	case <-s.done:
	case <-ctx.Done():
		return -1, ctx.Err()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exitCode, nil
}
