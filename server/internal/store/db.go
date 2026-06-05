// Package store is the SQLite persistence layer (users, sessions, roles,
// bindings, audit, settings, hosts, recovery codes). It uses database/sql with
// the pure-Go modernc.org/sqlite driver (CGo-free) per ADR-CASTOR-003 §3.3.
package store

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	"github.com/gtek-it/castor/server/internal/config"

	// Register the pure-Go SQLite driver under the database/sql name "sqlite".
	_ "modernc.org/sqlite"
)

// Store wraps the *sql.DB handle plus the configured paths.
type Store struct {
	db *sql.DB
}

// DB returns the underlying *sql.DB (used by typed CRUD methods and tests).
func (s *Store) DB() *sql.DB { return s.db }

// Close closes the database handle.
func (s *Store) Close() error {
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}

// pragmas applied on open per ADR-CASTOR-003 §3.3.
const pragmas = "_pragma=journal_mode(WAL)" +
	"&_pragma=busy_timeout(5000)" +
	"&_pragma=foreign_keys(ON)" +
	"&_pragma=synchronous(NORMAL)"

// Connect opens (and pings) the SQLite database at cfg.DBPath with the required
// pragmas, creating the parent directory if needed.
func Connect(cfg *config.Config) (*Store, error) {
	path := cfg.DBPath
	if path == "" {
		path = "/data/castor.db"
	}
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return nil, fmt.Errorf("store: create db dir %q: %w", dir, err)
		}
	}

	dsn := "file:" + url.PathEscape(path) + "?" + pragmas
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open sqlite: %w", err)
	}
	// modernc+WAL serializes writes; a single connection avoids "database is
	// locked" churn while keeping reads consistent. Mutations stay short.
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("store: ping sqlite: %w", err)
	}
	return &Store{db: db}, nil
}
