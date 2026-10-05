import { exec, rows } from "./db";

let ready: Promise<void> | null = null;
export function ensureEmailVerificationSchema() {
  if (!ready)
    ready = (async () => {
      await rows("SELECT user_id FROM user_email_status LIMIT 0").catch(
        async (error) => {
          if (error.code !== "ER_NO_SUCH_TABLE") throw error;
          await exec(`CREATE TABLE IF NOT EXISTS user_email_status (
        user_id VARCHAR(36) PRIMARY KEY,verification_required BOOLEAN NOT NULL DEFAULT TRUE,
        verified_at DATETIME(3) NULL)`);
        },
      );
      await rows(
        "SELECT token_hash FROM email_verification_tokens LIMIT 0",
      ).catch(async (error) => {
        if (error.code !== "ER_NO_SUCH_TABLE") throw error;
        await exec(`CREATE TABLE IF NOT EXISTS email_verification_tokens (
        token_hash VARCHAR(64) PRIMARY KEY,user_id VARCHAR(36) NOT NULL,email VARCHAR(190) NOT NULL,
        next_path VARCHAR(1000) NOT NULL,expires_at DATETIME(3) NOT NULL,consumed_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,INDEX email_tokens_user(user_id,created_at),INDEX email_tokens_expiry(expires_at))`);
      });
    })().catch((error) => {
      ready = null;
      throw error;
    });
  return ready;
}
