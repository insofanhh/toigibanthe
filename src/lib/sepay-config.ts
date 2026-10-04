import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { exec, rows, sqlDate, transaction, type DB } from "./db";
import { AppError } from "./http";
import { ensureSePaySchema } from "./sepay-schema";
export const webhookKeyHash = (key: string) =>
  createHash("sha256").update(key).digest("hex");
export const generateWebhookKey = () => "sp_" + randomBytes(32).toString("hex");
export async function automaticPayment(chefId: string, db?: DB) {
  const setting = (
    await rows<{ enabled: number; key_hash: string | null }>(
      "SELECT enabled,key_hash FROM sepay_integrations WHERE chef_id=?",
      [chefId],
      db,
    )
  )[0];
  return Boolean(setting?.enabled && setting.key_hash);
}
export async function sepayConfig(chefId: string, origin: string) {
  await ensureSePaySchema();
  const setting = (
    await rows<any>(
      "SELECT enabled,key_hash IS NOT NULL configured,last_received_at FROM sepay_integrations WHERE chef_id=?",
      [chefId],
    )
  )[0];
  return {
    enabled: Boolean(setting?.enabled),
    configured: Boolean(setting?.configured),
    lastReceivedAt: setting?.last_received_at || null,
    webhookUrl: `${origin}/api/webhooks/sepay/${chefId}`,
    transactions: await rows(
      "SELECT transaction_id,order_id,amount,content,result,created_at FROM sepay_transactions WHERE chef_id=? ORDER BY created_at DESC LIMIT 10",
      [chefId],
    ),
  };
}
export async function saveSePayConfig(
  chefId: string,
  actorId: string,
  input: unknown,
) {
  await ensureSePaySchema();
  const b = z
    .object({
      enabled: z.boolean(),
      apiKey: z
        .string()
        .trim()
        .min(32)
        .max(128)
        .regex(/^[A-Za-z0-9_-]+$/)
        .optional(),
    })
    .parse(input);
  await transaction(async (db) => {
    const chef = (
      await rows<any>(
        "SELECT bank_bin,account_no,account_name FROM chefs WHERE id=? FOR UPDATE",
        [chefId],
        db,
      )
    )[0];
    if (
      b.enabled &&
      (!chef?.bank_bin || !chef.account_no || !chef.account_name)
    )
      throw new AppError("Lưu tài khoản ngân hàng trước khi bật SePay.");
    const old = (
      await rows<any>(
        "SELECT key_hash FROM sepay_integrations WHERE chef_id=? FOR UPDATE",
        [chefId],
        db,
      )
    )[0];
    const hash = b.apiKey ? webhookKeyHash(b.apiKey) : old?.key_hash;
    if (b.enabled && !hash)
      throw new AppError("Tạo hoặc nhập API Key webhook trước khi bật SePay.");
    const now = sqlDate();
    await exec(
      "INSERT INTO sepay_integrations (chef_id,key_hash,enabled,created_at,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE key_hash=VALUES(key_hash),enabled=VALUES(enabled),updated_at=VALUES(updated_at)",
      [chefId, hash || null, b.enabled, now, now],
      db,
    );
    await exec(
      "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
      [
        randomBytes(16).toString("hex"),
        actorId,
        "sepay.updated",
        chefId,
        JSON.stringify({ enabled: b.enabled, keyChanged: Boolean(b.apiKey) }),
        now,
      ],
      db,
    );
  });
  return { ok: true };
}
