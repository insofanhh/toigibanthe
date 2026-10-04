import { exec, rows } from "./db";
const indexes = [
  ["orders", "report_orders_created", "created_at,id"],
  ["orders", "report_orders_paid", "payment_confirmed_at,id"],
  ["orders", "report_orders_chef_created", "chef_id,created_at,id"],
  ["order_events", "report_events_status", "status,created_at,order_id"],
  ["sepay_transactions", "report_sepay_bank_date", "chef_id,transaction_date"],
] as const;
let ready: Promise<void> | null = null;
// Additive indexes only. Existing business records are never changed by a report.
export function ensureOrderReportIndexes() {
  if (!ready)
    ready = (async () => {
      const existing = await rows<{
        table_name: string;
        index_name: string;
        columns_list: string;
      }>(
        "SELECT TABLE_NAME table_name,INDEX_NAME index_name,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') columns_list FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('orders','order_events','sepay_transactions') GROUP BY TABLE_NAME,INDEX_NAME",
      );
      const seen = new Set(
        existing.map((r) => r.table_name + ":" + r.index_name),
      );
      for (const [table, name, columns] of indexes)
        if (
          !seen.has(table + ":" + name) &&
          !existing.some(
            (i) =>
              i.table_name === table &&
              (i.columns_list === columns ||
                i.columns_list.startsWith(columns + ",")),
          )
        ) {
          try {
            await exec(`CREATE INDEX ${name} ON ${table} (${columns})`);
          } catch (e) {
            if ((e as any).errno !== 1061) throw e;
          }
        }
    })().catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}
