import { exec, rows, sqlDate } from "./db";

let ready: Promise<void> | null = null;
export function ensureSessionRevocationSchema() {
  if (!ready)
    ready = rows("SELECT token_hash FROM revoked_sessions LIMIT 0")
      .then(() => {})
      .catch(async (error) => {
        if (error.code !== "ER_NO_SUCH_TABLE") throw error;
        await exec(`CREATE TABLE IF NOT EXISTS revoked_sessions (
          token_hash VARCHAR(64) PRIMARY KEY,user_id VARCHAR(36) NOT NULL,
          reason VARCHAR(32) NOT NULL,expires_at DATETIME(3) NOT NULL,
          INDEX revoked_session_user(user_id),INDEX revoked_session_expiry(expires_at))`);
      })
      .catch((error) => {
        ready = null;
        throw error;
      });
  return ready;
}

export async function sessionRevocationReason(tokenHash: string) {
  await ensureSessionRevocationSchema();
  const [entry] = await rows<{ reason: string }>(
    "SELECT reason FROM revoked_sessions WHERE token_hash=? AND expires_at>?",
    [tokenHash, sqlDate()],
  );
  return entry?.reason === "ACCOUNT_DELETED" ? "ACCOUNT_DELETED" : null;
}
