CREATE TABLE IF NOT EXISTS revoked_sessions (
 token_hash VARCHAR(64) PRIMARY KEY,
 user_id VARCHAR(36) NOT NULL,
 reason VARCHAR(32) NOT NULL,
 expires_at DATETIME(3) NOT NULL,
 INDEX revoked_session_user(user_id),
 INDEX revoked_session_expiry(expires_at)
);
