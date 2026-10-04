import type { OrderReportFilter } from "./admin-orders-domain";
// Shared historical completion definition, also consumed by the existing reports.
export const COMPLETED_AT_SQL =
  "CASE WHEN o.status='COMPLETED' THEN COALESCE(e.finished_at,o.updated_at) END";
export const orderRegionSQL = (alias = "o") =>
  `CASE WHEN ${alias}.lat BETWEEN -90 AND 90 AND ${alias}.lng BETWEEN -180 AND 180 AND (${alias}.lat<>0 OR ${alias}.lng<>0) THEN CONCAT(ROUND(${alias}.lat*50),':',ROUND(${alias}.lng*50)) ELSE 'unknown' END`;
export function orderMasterScope(f: OrderReportFilter, alias = "o") {
  const clauses: string[] = [],
    values: unknown[] = [];
  if (f.chef) {
    clauses.push(`${alias}.chef_id=?`);
    values.push(f.chef);
  }
  if (f.meal) {
    clauses.push(`${alias}.meal_id=?`);
    values.push(f.meal);
  }
  if (f.region) {
    clauses.push(`${orderRegionSQL(alias)}=?`);
    values.push(f.region);
  }
  if (f.q) {
    clauses.push(
      `LOCATE(LOWER(?),LOWER(CONCAT_WS(' ',${alias}.code,${alias}.transfer_content,${alias}.recipient,${alias}.phone,c.name,u.name)))>0`,
    );
    values.push(f.q);
  }
  return { sql: clauses.length ? clauses.join(" AND ") : "1=1", values };
}
export function orderLedger(f: OrderReportFilter, id?: string) {
  const scope = orderMasterScope(f);
  if (id) {
    scope.sql += " AND o.id=?";
    scope.values.push(id);
  }
  return {
    values: scope.values,
    sql: `WITH scoped_orders AS (
 SELECT o.*,c.name chef_name,c.user_id chef_user_id,u.name customer_name,${orderRegionSQL()} region
 FROM orders o LEFT JOIN chefs c ON c.id=o.chef_id LEFT JOIN users u ON u.id=o.user_id WHERE ${scope.sql}
), ordered_events AS (
 SELECT e.*,o.status current_status,LAG(e.status) OVER(PARTITION BY e.order_id ORDER BY e.created_at,e.id) previous_status
 FROM order_events e JOIN scoped_orders o ON o.id=e.order_id WHERE e.status IN ('PLACED','PAID','ACCEPTED','PREPARING','DELIVERING','DELIVERED','COMPLETED','CANCELLED','REJECTED','EXPIRED')
), entered_events AS (SELECT * FROM ordered_events WHERE previous_status IS NULL OR previous_status<>status),
 event_times AS (
 SELECT order_id,MIN(CASE WHEN status='PAID' THEN created_at END) paid_event_at,
 MIN(CASE WHEN status='PAID' AND note LIKE 'SePay%' THEN created_at END) auto_paid_at,
 MIN(CASE WHEN status='ACCEPTED' THEN created_at END) accepted_at,
 MIN(CASE WHEN status='PREPARING' THEN created_at END) preparing_at,
 MIN(CASE WHEN status='DELIVERING' THEN created_at END) delivering_at,
 MIN(CASE WHEN status='DELIVERED' THEN created_at END) delivered_at,
 MIN(CASE WHEN status='COMPLETED' THEN created_at END) finished_at,
 MAX(CASE WHEN status=current_status THEN created_at END) entered_at
 FROM entered_events GROUP BY order_id
), stopped_events AS (SELECT e.*,ROW_NUMBER() OVER(PARTITION BY order_id ORDER BY created_at DESC,id DESC) rn FROM entered_events e WHERE status IN ('CANCELLED','REJECTED','EXPIRED')),
 item_totals AS (SELECT i.order_id,SUM(CAST(i.unit_price AS DECIMAL(20,0))*i.quantity) item_gross,SUM(i.quantity) item_quantity,COUNT(DISTINCT i.product_id) dish_count,MAX(NULLIF(i.image_url,'')) dish_image,GROUP_CONCAT(DISTINCT i.name ORDER BY i.name SEPARATOR ', ') dish_names FROM order_items i JOIN scoped_orders o ON o.id=i.order_id GROUP BY i.order_id),
 manual_proofs AS (SELECT entity_id order_id,MIN(created_at) manual_at FROM audit_logs WHERE action='order.payment.manual' GROUP BY entity_id),
 request_rows AS (
 SELECT e.*,COALESCE(CASE WHEN e.status='OPEN' THEN d.reviewed_at WHEN e.status='REVIEW' THEN d.submitted_at END,e.created_at) waiting_at
 FROM payment_exceptions e JOIN scoped_orders o ON o.id=e.order_id LEFT JOIN payment_request_details d ON d.exception_id=e.id WHERE e.actor_id<>o.user_id OR d.exception_id IS NOT NULL
), request_totals AS (
 SELECT order_id,COUNT(*) request_count,SUM(status='OPEN') refund_open,SUM(status='REVIEW') refund_review,
 SUM(status IN ('OPEN','REVIEW')) open_requests,MIN(CASE WHEN status IN ('OPEN','REVIEW') THEN waiting_at END) oldest_request_at,
 MIN(CASE WHEN status='OPEN' THEN waiting_at END) oldest_open_at,MIN(CASE WHEN status='REVIEW' THEN waiting_at END) oldest_review_at
 FROM request_rows GROUP BY order_id
), receipt_totals AS (
 SELECT t.order_id,COUNT(*) transaction_count,SUM(CASE WHEN t.result IN ('PARTIAL','PAID','OVERPAID','LATE','EXTRA_PAYMENT') AND t.chef_id=o.chef_id AND t.bank_bin=o.bank_bin AND t.account_number=o.account_no AND COALESCE(d.sub_account,'')='' THEN t.amount ELSE 0 END) bank_received,
 SUM(t.result IN ('PARTIAL','PAID','OVERPAID','LATE','EXTRA_PAYMENT') AND t.chef_id=o.chef_id AND t.bank_bin=o.bank_bin AND t.account_number=o.account_no AND COALESCE(d.sub_account,'')='') valid_transactions,
 SUM(t.result IN ('LATE','EXTRA_PAYMENT')) extra_transactions,
 SUM(NOT COALESCE(t.result IN ('PARTIAL','PAID','OVERPAID','LATE','EXTRA_PAYMENT') AND t.chef_id=o.chef_id AND t.bank_bin=o.bank_bin AND t.account_number=o.account_no AND COALESCE(d.sub_account,'')='',0)) invalid_transactions
 FROM sepay_transactions t JOIN scoped_orders o ON o.id=t.order_id LEFT JOIN sepay_transaction_details d ON d.chef_id=t.chef_id AND d.transaction_id=t.transaction_id GROUP BY t.order_id
), ledger AS (
 SELECT o.*,COALESCE(e.paid_event_at,o.payment_confirmed_at) paid_at,e.auto_paid_at,e.accepted_at,e.preparing_at,e.delivering_at,e.delivered_at,${COMPLETED_AT_SQL} completed_at,
 e.finished_at IS NULL AND o.status='COMPLETED' legacy_completed,
 CASE WHEN e.auto_paid_at IS NOT NULL THEN 'auto' WHEN mp.manual_at IS NOT NULL OR o.payment_status='PAID_MANUAL' THEN 'manual' WHEN COALESCE(e.paid_event_at,o.payment_confirmed_at) IS NOT NULL THEN 'unknown' ELSE 'unpaid' END payment_source,
 CASE WHEN o.status='PLACED' THEN o.created_at WHEN o.status='PAID' THEN COALESCE(e.entered_at,o.payment_confirmed_at) ELSE e.entered_at END stage_at,
 CASE WHEN o.status='EXPIRED' THEN 'system' WHEN o.status NOT IN ('CANCELLED','REJECTED') THEN 'unknown' WHEN actor.role='admin' THEN 'admin' WHEN se.actor_id=o.user_id THEN 'customer' WHEN se.actor_id=o.chef_user_id THEN 'chef' ELSE 'unknown' END cancel_actor,
 se.note cancel_note,COALESCE(i.item_gross,0) item_gross,COALESCE(i.item_quantity,0) item_quantity,COALESCE(i.dish_count,0) dish_count,i.dish_image,i.dish_names,
 COALESCE(r.request_count,0) request_count,COALESCE(r.refund_open,0) refund_open,COALESCE(r.refund_review,0) refund_review,COALESCE(r.open_requests,0) open_requests,r.oldest_request_at,r.oldest_open_at,r.oldest_review_at,
 COALESCE(t.transaction_count,0) transaction_count,COALESCE(t.bank_received,0) bank_received,COALESCE(t.valid_transactions,0) valid_transactions,COALESCE(t.extra_transactions,0) extra_transactions,COALESCE(t.invalid_transactions,0) invalid_transactions
 FROM scoped_orders o LEFT JOIN event_times e ON e.order_id=o.id LEFT JOIN stopped_events se ON se.order_id=o.id AND se.rn=1 LEFT JOIN users actor ON actor.id=se.actor_id LEFT JOIN item_totals i ON i.order_id=o.id LEFT JOIN request_totals r ON r.order_id=o.id LEFT JOIN receipt_totals t ON t.order_id=o.id LEFT JOIN manual_proofs mp ON mp.order_id=o.id
)`,
  };
}
