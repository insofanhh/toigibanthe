CREATE TABLE IF NOT EXISTS user_email_status (
 user_id VARCHAR(36) PRIMARY KEY,
 verification_required BOOLEAN NOT NULL DEFAULT TRUE,
 verified_at DATETIME(3) NULL
);
CREATE TABLE IF NOT EXISTS email_verification_tokens (
 token_hash VARCHAR(64) PRIMARY KEY,
 user_id VARCHAR(36) NOT NULL,
 email VARCHAR(190) NOT NULL,
 next_path VARCHAR(1000) NOT NULL,
 expires_at DATETIME(3) NOT NULL,
 consumed_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL,
 INDEX email_tokens_user(user_id,created_at),
 INDEX email_tokens_expiry(expires_at)
);

-- Only existing Google identities carry proof of email ownership.
-- Existing password accounts remain usable; do not invent a verification timestamp.
INSERT IGNORE INTO user_email_status (user_id,verification_required,verified_at)
SELECT user_id,FALSE,created_at FROM google_identities;
