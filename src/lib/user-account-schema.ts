import { exec, rows } from "./db";

let ready: Promise<void> | null = null;
export function ensureUserAccountSchema() {
  if (!ready)
    ready = rows("SELECT user_id FROM user_account_details LIMIT 0")
      .then(() => {})
      .catch(async (error) => {
        if (error.code !== "ER_NO_SUCH_TABLE") throw error;
        await exec(`CREATE TABLE IF NOT EXISTS user_account_details (
          user_id VARCHAR(36) PRIMARY KEY,avatar_asset_id VARCHAR(36) NULL,
          deleted_at DATETIME(3) NULL)`);
      })
      .catch((error) => {
        ready = null;
        throw error;
      });
  return ready;
}
