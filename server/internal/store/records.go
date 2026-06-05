package store

// records.go holds the typed row structs for the store package. Sensitive
// fields (password hashes, encrypted TOTP secrets, recovery code hashes, raw
// session ids) are tagged json:"-" so they are NEVER serialized into an API
// response or log line, defense-in-depth with the redaction layer.

// User is a row of the users table.
//
// auth_source / external_id / external_provider_id (added in migration 0003)
// mark externally-provisioned identities. A local user keeps a real
// PasswordHash and AuthSource=="local"; an LDAP/OIDC user is JIT-provisioned
// with AuthSource set, ExternalID = the stable IdP subject (LDAP entryUUID/DN
// or OIDC oid/sub) and PasswordHash left as the non-usable sentinel "!" so
// authz.VerifyPassword can never succeed for them (they auth only via the IdP).
type User struct {
	ID                 string `json:"id"`
	Username           string `json:"username"`
	Email              string `json:"email"`
	PasswordHash       string `json:"-"`
	TOTPSecretEnc      []byte `json:"-"`
	TOTPEnabled        bool   `json:"totpEnabled"`
	TOTPConfirmedAt    *int64 `json:"-"`
	IsActive           bool   `json:"isActive"`
	MustChangePW       bool   `json:"mustChangePassword"`
	FailedLogins       int    `json:"-"`
	LockedUntil        *int64 `json:"-"`
	LastLoginAt        *int64 `json:"lastLoginAt,omitempty"`
	AuthSource         string `json:"authSource"`           // local|ldap|oidc
	ExternalID         string `json:"-"`                    // IdP subject (empty for local)
	ExternalProviderID string `json:"externalProviderId,omitempty"` // -> auth_providers.id
	CreatedAt          int64  `json:"createdAt"`
	UpdatedAt          int64  `json:"updatedAt"`
}

// IsExternal reports whether the user is provisioned from an external IdP
// (LDAP/OIDC) and therefore cannot authenticate with a local password.
func (u *User) IsExternal() bool { return u.AuthSource != "" && u.AuthSource != "local" }

// ExternalPasswordSentinel is the non-usable password_hash stored for external
// (LDAP/OIDC) users. It is not a valid argon2id encoded hash, so
// authz.VerifyPassword always fails — external users can only auth via their IdP.
const ExternalPasswordSentinel = "!"

// Session is a row of the sessions table. The id stored is SHA-256(rawID); the
// raw id lives only in the cookie and is never persisted nor serialized.
type Session struct {
	ID         string `json:"-"`
	UserID     string `json:"userId"`
	CSRFToken  string `json:"-"`
	UserAgent  string `json:"-"`
	IP         string `json:"-"`
	AMR        string `json:"amr"`
	CreatedAt  int64  `json:"createdAt"`
	LastSeenAt int64  `json:"lastSeenAt"`
	ExpiresAt  int64  `json:"expiresAt"`
	RevokedAt  *int64 `json:"-"`
}

// Role is a row of the roles table. Permissions are stored as a JSON array.
type Role struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	IsBuiltin   bool     `json:"isBuiltin"`
	Permissions []string `json:"permissions"`
	CreatedAt   int64    `json:"createdAt"`
	UpdatedAt   int64    `json:"updatedAt"`
}

// Binding is a row of the role_bindings table.
type Binding struct {
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	RoleID    string `json:"roleId"`
	ScopeType string `json:"scopeType"`
	ScopeID   string `json:"scopeId"`
	CreatedAt int64  `json:"createdAt"`
}

// AuditEntry is a row of the audit_log table (append-only).
type AuditEntry struct {
	ID         int64  `json:"id"`
	TS         int64  `json:"tsEpoch"`
	ActorID    string `json:"actorId"`
	ActorName  string `json:"actorName"`
	ActorIP    string `json:"actorIp"`
	Action     string `json:"action"`
	TargetType string `json:"targetType"`
	TargetID   string `json:"targetId"`
	TargetName string `json:"targetName"`
	ScopeType  string `json:"scopeType"`
	ScopeID    string `json:"scopeId"`
	Result     string `json:"result"`
	HTTPStatus int    `json:"httpStatus"`
	Detail     string `json:"-"`
	RequestID  string `json:"requestId"`
}

// Host is a row of the registered_hosts table.
type Host struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Connection string `json:"connection"`
	Endpoint   string `json:"endpoint"`
	Status     string `json:"status"`
	LastSeenAt *int64 `json:"lastSeenAt,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
}

// Backup is a row of the backups table: a volume tar archive produced by
// exporting a Docker volume's contents. FilePath is the server-side path of the
// archive and is never returned to clients (json:"-").
type Backup struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	HostID     string `json:"hostId"`
	TargetName string `json:"targetName"`
	FilePath   string `json:"-"`
	SizeBytes  int64  `json:"sizeBytes"`
	Status     string `json:"status"`
	Error      string `json:"error,omitempty"`
	CreatedBy  string `json:"createdBy,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
}

// RecoveryCode is a row of the recovery_codes table.
type RecoveryCode struct {
	ID        string `json:"-"`
	UserID    string `json:"-"`
	CodeHash  string `json:"-"`
	UsedAt    *int64 `json:"-"`
	CreatedAt int64  `json:"-"`
}
