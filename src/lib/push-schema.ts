import { exec } from "./db";
export const PUSH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
  id VARCHAR(36) PRIMARY KEY, endpoint_hash VARCHAR(64) NOT NULL UNIQUE,
  user_id VARCHAR(36) NOT NULL, session_hash VARCHAR(64) NOT NULL,
  endpoint TEXT NOT NULL, p256dh VARCHAR(100) NOT NULL, auth VARCHAR(40) NOT NULL,
  vapid_hash VARCHAR(64) NOT NULL, orders BOOLEAN NOT NULL DEFAULT TRUE,
  news BOOLEAN NOT NULL DEFAULT TRUE, promotions BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL, last_test_at DATETIME(3),
  INDEX push_user(user_id,active), INDEX push_session(session_hash))`,
  `CREATE TABLE IF NOT EXISTS push_deliveries (
  id VARCHAR(36) PRIMARY KEY, notification_id VARCHAR(36) NOT NULL,
  subscription_id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL,
  state VARCHAR(20) NOT NULL DEFAULT 'PENDING', attempts INT NOT NULL DEFAULT 0,
  next_at DATETIME(3) NOT NULL, expires_at DATETIME(3) NOT NULL,
  lease_token VARCHAR(36), lease_until DATETIME(3), sent_at DATETIME(3),
  last_error VARCHAR(40), created_at DATETIME(3) NOT NULL,
  UNIQUE KEY push_once(notification_id,subscription_id),
  INDEX push_ready(state,next_at), INDEX push_device(subscription_id,state),
  INDEX push_expiry(expires_at))`,
] as const;
let ready: Promise<void> | null = null;
export function ensurePushSchema() {
  if (!ready)
    ready = (async () => {
      for (const s of PUSH_SCHEMA) await exec(s);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}
