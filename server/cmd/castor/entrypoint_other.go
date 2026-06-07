//go:build !linux

// entrypoint_other.go — non-Linux fallback for `castor entrypoint`. These builds
// exist only for local development and tests (the shipped container is always
// Linux); there is no privilege-dropping to do, so we just run the server.
package main

// runEntrypoint runs the server in-process on non-Linux platforms.
func runEntrypoint() {
	runServerInProcess()
}
