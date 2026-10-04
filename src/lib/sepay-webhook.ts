import { timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { exec, rows, transaction, sqlDate } from "./db";
import { AppError } from "./http";
import { ensureSePaySchema } from "./sepay-schema";
import { webhookKeyHash } from "./sepay-config";
import { sepayBankBin, sepayOrderCode } from "./sepay-qr";
import { expirePendingOrder, type OrderRecord } from "./orders";
import { notify } from "./notifications";
import { parseUTC, TERMINAL } from "./domain";

export const sepayPayloadSchema = z.object({
  id: z
    .union([
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      z.string().regex(/^\d{1,80}$/),
    ])
    .transform(String),
  gateway: z.string().min(1).max(100),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
  accountNumber: z.string().regex(/^\d{6,30}$/),
  code: z.string().max(100).nullish(),
  content: z.string().max(4000),
  description: z.string().max(4000).nullish(),
  transferType: z.enum(["in", "out"]),
  transferAmount: z.number().int().positive().max(2147483647),
  referenceCode: z.string().max(190).nullish(),
  subAccount: z.string().max(100).nullish(),
});

function authenticate(header: string | null, hash: string | null) {
  const key = header?.match(/^Apikey ([A-Za-z0-9_-]{32,128})$/i)?.[1];
  if (
    !key ||
    !hash ||
    !/^[a-f0-9]{64}$/.test(hash) ||
    !timingSafeEqual(
      Buffer.from(webhookKeyHash(key), "hex"),
      Buffer.from(hash, "hex"),
    )
  )
    throw new AppError("API Key webhook không hợp lệ.", 401);
}

export async function receiveSePay(chefId: string, request: Request) {
  z.uuid().parse(chefId);
  await ensureSePaySchema();
  const config = (
    await rows<{ enabled: number; key_hash: string }>(
      "SELECT enabled,key_hash FROM sepay_integrations WHERE chef_id=?",
      [chefId],
    )
  )[0];
  authenticate(request.headers.get("authorization"), config?.key_hash);
  if (!config?.enabled)
    throw new AppError("Webhook của bếp chưa được bật.", 403);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 16384)
    throw new AppError("Webhook quá lớn.", 413);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AppError("JSON webhook chưa hợp lệ.");
  }
  const b = sepayPayloadSchema.parse(data);
  const date = new Date(b.transactionDate.replace(" ", "T") + "+07:00");
  if (
    !Number.isFinite(date.getTime()) ||
    sqlDate(new Date(date.getTime() + 7 * 3600000))
      .slice(0, 19)
      .replace("T", " ") !== b.transactionDate
  )
    throw new AppError("Thời gian giao dịch chưa hợp lệ.");
  const bankBin = sepayBankBin(b.gateway);
  if (b.transferType !== "in" || !bankBin)
    return { success: true, result: "IGNORED" };
  return transaction(async (db) => {
    const current = (
      await rows<any>(
        "SELECT enabled,key_hash FROM sepay_integrations WHERE chef_id=? FOR UPDATE",
        [chefId],
        db,
      )
    )[0];
    authenticate(request.headers.get("authorization"), current?.key_hash);
    if (!current.enabled)
      throw new AppError("Webhook của bếp chưa được bật.", 403);
    await exec(
      "UPDATE sepay_integrations SET last_received_at=? WHERE chef_id=?",
      [sqlDate(), chefId],
      db,
    );
    const inserted = await exec(
      "INSERT IGNORE INTO sepay_transactions (chef_id,transaction_id,bank_bin,account_number,amount,transaction_date,content,reference_code,result,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        chefId,
        b.id,
        bankBin,
        b.accountNumber,
        b.transferAmount,
        sqlDate(date),
        b.content,
        b.referenceCode?.trim() || null,
        "RECEIVED",
        sqlDate(),
      ],
      db,
    );
    if (!inserted.affectedRows) return { success: true, result: "DUPLICATE" };
    const code = sepayOrderCode(b);
    const order = code
      ? (
          await rows<OrderRecord>(
            "SELECT o.*,c.user_id chef_user_id FROM orders o JOIN chefs c ON c.id=o.chef_id WHERE o.chef_id=? AND o.code=? FOR UPDATE",
            [chefId, code],
            db,
          )
        )[0]
      : null;
    async function result(value: string) {
      await exec(
        "UPDATE sepay_transactions SET order_id=?,result=? WHERE chef_id=? AND transaction_id=?",
        [order?.id || null, value, chefId, b.id],
        db,
      );
      return { success: true, result: value };
    }
    if (!order) return result("UNMATCHED");
    if (
      order.bank_bin !== bankBin ||
      order.account_no !== b.accountNumber ||
      b.subAccount?.trim()
    )
      return result("ACCOUNT_MISMATCH");
    if (
      date.getTime() < parseUTC(order.created_at).getTime() - 60000 ||
      date.getTime() > Date.now() + 5 * 60000
    )
      return result("INVALID_DATE");
    await expirePendingOrder(db, order);
    async function exception(kind: string, note: string) {
      await exec(
        "INSERT INTO payment_exceptions (id,order_id,actor_id,kind,amount,note,created_at) VALUES (?,?,?,?,?,?,?)",
        [
          randomUUID(),
          order!.id,
          order!.chef_user_id,
          kind,
          b.transferAmount,
          `${note} · SePay #${b.id}`,
          sqlDate(),
        ],
        db,
      );
      await notify(
        db,
        order!.chef_user_id,
        "order",
        "Giao dịch cần đối soát",
        `Đơn ${order!.code}: ${note}`,
        `/orders/${order!.id}`,
      );
      await notify(
        db,
        order!.user_id,
        "order",
        "Thanh toán cần kiểm tra",
        `Đơn ${order!.code}: ${note}`,
        `/orders/${order!.id}`,
      );
    }
    if (
      order.status === "COMPLETED" ||
      (!TERMINAL.includes(order.status) &&
        (order.payment_status.startsWith("PAID") ||
          ["PAID", "ACCEPTED", "PREPARING", "DELIVERING", "DELIVERED"].includes(
            order.status,
          )))
    ) {
      await exception(
        "DUPLICATE",
        "Nhận thêm một giao dịch cho đơn đã thanh toán.",
      );
      return result("EXTRA_PAYMENT");
    }
    if (TERMINAL.includes(order.status)) {
      await exec(
        'UPDATE orders SET payment_status="REFUND_PENDING",updated_at=? WHERE id=?',
        [sqlDate(), order.id],
        db,
      );
      await exception(
        "LATE",
        "Đã nhận tiền cho đơn đã hết hạn, hủy hoặc kết thúc. Cần đối soát/hoàn tiền.",
      );
      return result("LATE");
    }
    if (order.status !== "PLACED") return result("UNMATCHED");
    const prior = (
      await rows<{ amount: number }>(
        'SELECT COALESCE(SUM(amount),0) amount FROM sepay_transactions WHERE order_id=? AND result IN ("PARTIAL","PAID","OVERPAID")',
        [order.id],
        db,
      )
    )[0];
    const received = Number(prior.amount) + b.transferAmount;
    if (received > order.total || order.payment_status === "PAYMENT_REVIEW") {
      await exec(
        'UPDATE orders SET payment_status="PAYMENT_REVIEW",updated_at=? WHERE id=?',
        [sqlDate(), order.id],
        db,
      );
      await exception(
        "OVERPAID",
        "Số tiền nhận không khớp tổng đơn. Cần đối soát trước khi nhận đơn.",
      );
      return result("OVERPAID");
    }
    if (received < order.total) {
      await exec(
        'UPDATE orders SET payment_status="PARTIAL",updated_at=? WHERE id=?',
        [sqlDate(), order.id],
        db,
      );
      await notify(
        db,
        order.user_id,
        "order",
        "Đã nhận một phần thanh toán",
        `Đơn ${order.code} còn thiếu ${order.total - received} đồng.`,
        `/orders/${order.id}`,
      );
      return result("PARTIAL");
    }
    await exec(
      'UPDATE orders SET status="PAID",payment_status="PAID_AUTO",payment_confirmed_at=?,updated_at=? WHERE id=?',
      [sqlDate(), sqlDate(), order.id],
      db,
    );
    await exec(
      "INSERT INTO order_events VALUES (?,?,?,?,?,?)",
      [
        randomUUID(),
        order.id,
        order.chef_user_id,
        "PAID",
        `SePay xác nhận đủ tiền · giao dịch #${b.id}`,
        sqlDate(),
      ],
      db,
    );
    await notify(
      db,
      order.user_id,
      "order",
      "Thanh toán thành công",
      `Đơn ${order.code} đã được xác nhận thanh toán. Đang chờ bếp nhận đơn.`,
      `/orders/${order.id}`,
    );
    await notify(
      db,
      order.chef_user_id,
      "order",
      "Đơn đã thanh toán",
      `Đơn ${order.code} đã nhận đủ tiền. Bạn có thể nhận đơn để chuẩn bị.`,
      `/orders/${order.id}`,
    );
    return result("PAID");
  });
}
