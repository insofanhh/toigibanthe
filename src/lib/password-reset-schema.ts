import { exec, rows } from "./db";

let ready: Promise<void> | null = null;

export function ensurePasswordResetSchema() {
  if (!ready)
    ready = rows("SELECT token_hash FROM password_reset_tokens LIMIT 0")
      .then(() => {})
      .catch(async (error) => {
        if (error.code !== "ER_NO_SUCH_TABLE") throw error;
        await exec(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
          token_hash VARCHAR(64) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL,
          email VARCHAR(190) NOT NULL,
          expires_at DATETIME(3) NOT NULL,
          consumed_at DATETIME(3) NULL,
          created_at DATETIME(3) NOT NULL,
          INDEX password_reset_user(user_id,created_at),
          INDEX password_reset_expiry(expires_at)
        )`);
      })
      .catch((error) => {
        ready = null;
        throw error;
      });
  return ready;
}
