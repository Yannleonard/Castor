package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

const backupCols = `id, kind, host_id, target_name, file_path, size_bytes, status, error, created_by, created_at`

func scanBackup(row interface{ Scan(...any) error }) (*Backup, error) {
	var b Backup
	var errMsg, createdBy sql.NullString
	if err := row.Scan(&b.ID, &b.Kind, &b.HostID, &b.TargetName, &b.FilePath,
		&b.SizeBytes, &b.Status, &errMsg, &createdBy, &b.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	b.Error = errMsg.String
	b.CreatedBy = createdBy.String
	return &b, nil
}

// CreateBackup inserts a backup row. CreatedAt is set if zero.
func (s *Store) CreateBackup(ctx context.Context, b *Backup) error {
	if b.CreatedAt == 0 {
		b.CreatedAt = time.Now().Unix()
	}
	if b.Kind == "" {
		b.Kind = "volume"
	}
	if b.HostID == "" {
		b.HostID = "local"
	}
	if b.Status == "" {
		b.Status = "pending"
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO backups (`+backupCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		b.ID, b.Kind, b.HostID, b.TargetName, b.FilePath, b.SizeBytes, b.Status,
		nullStr(b.Error), nullStr(b.CreatedBy), b.CreatedAt)
	return err
}

// UpdateBackupResult finalizes a backup row after the archive is written:
// status, size and (optional) error message.
func (s *Store) UpdateBackupResult(ctx context.Context, id, status string, sizeBytes int64, errMsg string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE backups SET status = ?, size_bytes = ?, error = ? WHERE id = ?`,
		status, sizeBytes, nullStr(errMsg), id)
	return err
}

// GetBackup returns one backup by id scoped to a host.
func (s *Store) GetBackup(ctx context.Context, hostID, id string) (*Backup, error) {
	return scanBackup(s.db.QueryRowContext(ctx,
		`SELECT `+backupCols+` FROM backups WHERE id = ? AND host_id = ?`, id, hostID))
}

// ListBackups returns all backups for a host, newest first.
func (s *Store) ListBackups(ctx context.Context, hostID string) ([]*Backup, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+backupCols+` FROM backups WHERE host_id = ? ORDER BY created_at DESC`, hostID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*Backup
	for rows.Next() {
		b, err := scanBackup(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// DeleteBackup removes a backup row scoped to a host. It returns ErrNotFound if
// no row matched.
func (s *Store) DeleteBackup(ctx context.Context, hostID, id string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM backups WHERE id = ? AND host_id = ?`, id, hostID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
