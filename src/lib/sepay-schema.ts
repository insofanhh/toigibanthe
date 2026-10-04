import { exec } from "./db";

// Additive, idempotent DDL: also upgrades existing MySQL/TiDB deployments.
const statements = [
  `CREATE TABLE IF NOT EXISTS sepay_integrations (
    chef_id VARCHAR(36) PRIMARY KEY, key_hash VARCHAR(64), enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_received_at DATETIME(3), created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sepay_order_settings (
    order_id VARCHAR(36) PRIMARY KEY, automatic BOOLEAN NOT NULL DEFAULT FALSE)`,
  `CREATE TABLE IF NOT EXISTS sepay_transactions (
    chef_id VARCHAR(36) NOT NULL, transaction_id VARCHAR(80) NOT NULL, order_id VARCHAR(36),
    bank_bin VARCHAR(6) NOT NULL, account_number VARCHAR(30) NOT NULL, amount BIGINT NOT NULL,
    transaction_date DATETIME(3) NOT NULL, content TEXT NOT NULL, reference_code VARCHAR(190),
    result VARCHAR(30) NOT NULL, created_at DATETIME(3) NOT NULL,
    PRIMARY KEY(chef_id,transaction_id),
    UNIQUE KEY sepay_bank_transaction(bank_bin,account_number,transaction_id),
    UNIQUE KEY sepay_bank_reference(bank_bin,account_number,reference_code),
    INDEX sepay_order(order_id,result), INDEX sepay_chef(chef_id,created_at))`,
];
let ready: Promise<void> | null = null;
export function ensureSePaySchema() {
  if (!ready)
    ready = (async () => {
      for (const sql of statements) await exec(sql);
    })().catch((error) => {
      ready = null;
      throw error;
    });
  return ready;
}
