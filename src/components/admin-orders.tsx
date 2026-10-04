"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { RefreshCw, Settings, ChevronLeft } from "lucide-react";
import { Button, Field, Notice, useLoad } from "./app";
import { useApp, post } from "./providers";
import {
  count,
  stamp,
  ReportBlock as Block,
  ReportTable as Table,
  ReportPager as Pager,
  ReportPending as Pending,
  ReportDialog as Dialog,
  SalesChart,
  type ReportRow as R,
} from "./admin-report-ui";
import {
  ORDER_REPORT_VIEWS,
  ORDER_REPORT_PANELS,
  ORDER_REPORT_GROUPS,
  ORDER_REPORT_SORTS,
  ORDER_DATE_BY,
  ORDER_PAYMENT_LABELS,
  ORDER_ACTORS,
  TRANSACTION_GROUPS,
  TRANSACTION_RESULTS,
} from "@/lib/admin-orders-domain";
import {
  ORDER_LABELS,
  ACTIVE_ORDER_STATUSES,
  PAYMENT_REQUEST_STATUSES,
  PAYMENT_REQUEST_KINDS,
  MEAL_NAMES,
  money,
  serviceDate,
  parseUTC,
} from "@/lib/domain";
import { shiftDate } from "@/lib/analytics-domain";
const Map = dynamic(() => import("./delivery-map").then((m) => m.DeliveryMap));
const minutes = (v: unknown) =>
  v == null ? "Chưa có mốc" : count(Math.round(Number(v))) + " phút";
const source = (v: string) =>
  ({
    auto: "Tự động",
    manual: "Thủ công",
    unknown: "Chưa rõ nguồn",
    unpaid: "Chưa xác nhận",
  })[v] || v;
function stageDuration(o: R, k: string) {
  if (k === "accepted" && o.payment_source === "manual")
    return "Xác nhận thủ công cùng nhận đơn";
  if (k === "completed" && o.legacy_completed) return "Dùng mốc hoàn thành cũ";
  const previous: Record<string, string> = {
    paid: "created",
    accepted: "paid",
    preparing: "accepted",
    delivering: "preparing",
    delivered: "delivering",
    completed: "delivered",
  };
  const start = o[previous[k] + "_at"],
    end = o[k + "_at"];
  if (!start || !end || parseUTC(end) < parseUTC(start))
    return "Thiếu cặp mốc hợp lệ";
  return (
    minutes((parseUTC(end).getTime() - parseUTC(start).getTime()) / 60000) +
    " từ mốc trước"
  );
}
function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </Field>
  );
}
function Tags({ o }: { o: R }) {
  return (
    <div className="orders-tags">
      <span className="status" data-status={o.status}>
        {ORDER_LABELS[o.status] || o.status}
      </span>
      <span className="order-payment-tag" data-status={o.payment_status}>
        {ORDER_PAYMENT_LABELS[o.payment_status] || o.payment_status}
      </span>
      {Number(o.refund_open) > 0 && (
        <span className="status" data-status="OPEN">
          {count(o.refund_open)} chờ xử lý
        </span>
      )}
      {Number(o.refund_review) > 0 && (
        <span className="status" data-status="REVIEW">
          {count(o.refund_review)} chờ hệ thống
        </span>
      )}
    </div>
  );
}
function Transactions({
  items,
  open,
}: {
  items: R[];
  open?: (id: string) => void;
}) {
  return (
    <Table
      headers={[
        "Giao dịch / đơn",
        "Chef",
        "Số tiền",
        "Kết quả hiện tại",
        "Ngân hàng / webhook",
      ]}
    >
      {items.map((t) => (
        <tr key={t.chef_id + ":" + t.transaction_id}>
          <td>
            <strong>#{t.transaction_id}</strong>
            <small>
              {t.order_id && open ? (
                <button
                  className="text-button"
                  onClick={() => open(t.order_id)}
                >
                  Đơn #{t.code || t.order_id}
                </button>
              ) : (
                t.code || "Chưa gắn đơn"
              )}
            </small>
            <small>{t.content}</small>
            <small>{t.reference_code}</small>
          </td>
          <td>
            {t.chef_name || "—"}
            <small>{t.account_mask}</small>
          </td>
          <td>{money(t.amount)}</td>
          <td>
            <span className="order-payment-tag" data-status={t.result}>
              {TRANSACTION_RESULTS[t.result] || t.result}
            </span>
            <small>{t.failure_reason}</small>
          </td>
          <td>
            {stamp(t.transaction_date)}
            <small>Nhận: {stamp(t.created_at)}</small>
          </td>
        </tr>
      ))}
      {!items.length && (
        <tr>
          <td colSpan={5}>Không có giao dịch trong phạm vi này.</td>
        </tr>
      )}
    </Table>
  );
}
function OrdersTable({
  data,
  open,
  advanced,
  onPage,
  onChef,
  onRequests,
  dateBy = "created",
}: {
  data: R;
  open: (id: string, panel?: string) => void;
  advanced: boolean;
  onPage: (n: number) => void;
  onChef: (id: string) => void;
  onRequests: (o: R) => void;
  dateBy?: string;
}) {
  return (
    <>
      <Table
        className="orders-table"
        headers={[
          "Đơn / món đã đặt",
          "Chef / khách",
          "Trạng thái",
          "Giá trị",
          "Theo dõi",
          ...(advanced ? ["Snapshot / mốc"] : []),
          "Thao tác",
        ]}
      >
        {(data.orders || data.alerts || []).map((o: R) => (
          <tr key={o.id}>
            <td>
              <div className="products-identity">
                <img src={o.dish_image || "/icon.svg"} alt="" loading="lazy" />
                <div>
                  <button className="text-button" onClick={() => open(o.id)}>
                    #{o.code}
                  </button>
                  <small>{o.dish_names || "Thiếu món snapshot"}</small>
                  <small>
                    {count(o.dish_count)} món · {count(o.item_quantity)} phần
                  </small>
                  <small>
                    {stamp(
                      o[
                        dateBy === "paid"
                          ? "paid_at"
                          : dateBy === "completed"
                            ? "completed_at"
                            : "created_at"
                      ],
                    )}
                  </small>
                </div>
              </div>
            </td>
            <td>
              <button className="text-button" onClick={() => onChef(o.chef_id)}>
                {o.chef_name || "Bếp thiếu hồ sơ"}
              </button>
              <small>{o.customer_name || o.recipient}</small>
              <small>{MEAL_NAMES[o.meal_id as keyof typeof MEAL_NAMES]}</small>
            </td>
            <td>
              <Tags o={o} />
            </td>
            <td>
              {money(o.subtotal - o.discount)}
              <small>Món sau voucher</small>
              <small>Tổng: {money(o.total)}</small>
              <small>Giao: {money(o.delivery_fee)}</small>
              <small>{source(o.payment_source)}</small>
            </td>
            <td>
              {ACTIVE_ORDER_STATUSES.includes(o.status)
                ? minutes(o.age_minutes)
                : "Đã kết thúc"}
              {o.alerts?.map((a: R) => (
                <button
                  key={a.key}
                  className="orders-alert"
                  onClick={() => open(o.id, a.panel)}
                >
                  {a.label}
                </button>
              ))}
            </td>
            {advanced && (
              <td>
                Voucher: {money(o.discount)}
                <small>Vùng: {o.region}</small>
                <small>
                  Đường thẳng:{" "}
                  {o.distance_km == null
                    ? "—"
                    : Number(o.distance_km).toFixed(2) + " km"}
                </small>
                <small>
                  Đường bộ:{" "}
                  {o.route_distance_km == null
                    ? "—"
                    : Number(o.route_distance_km).toFixed(2) + " km"}
                </small>
                <small>Tiền: {stamp(o.paid_at)}</small>
                <small>Nhận: {stamp(o.accepted_at)}</small>
                <small>Giao: {stamp(o.delivered_at)}</small>
                <small>Hoàn tất: {stamp(o.completed_at)}</small>
              </td>
            )}
            <td>
              <button className="text-button" onClick={() => open(o.id)}>
                Chi tiết
              </button>
              {o.open_requests > 0 && (
                <button className="text-button" onClick={() => onRequests(o)}>
                  Mở đối soát
                </button>
              )}
            </td>
          </tr>
        ))}
        {!(data.orders || data.alerts || []).length && (
          <tr>
            <td colSpan={advanced ? 7 : 6}>Không có đơn phù hợp.</td>
          </tr>
        )}
      </Table>
      <Pager data={data} onPage={onPage} />
    </>
  );
}
function OrderDetail({
  id,
  query,
  params,
  version,
  tick,
  apply,
  close,
  requests,
  onAction,
}: {
  id: string;
  query: string;
  params: URLSearchParams;
  version: string;
  tick: number;
  apply: (p: Record<string, string>, detail?: boolean) => void;
  close: () => void;
  requests: (o: R, request?: string) => void;
  onAction: (o: R, action: string) => void;
}) {
  const panel = params.get("opanel") || "overview",
    [map, setMap] = useState(false),
    q = new URLSearchParams(query);
  q.set("panel", panel);
  q.set("page", params.get("odpage") || "1");
  q.set("stage", params.get("ostage") || "all");
  const report = useLoad<R>(
      "admin/order-analytics/detail/" + id + "?" + q,
      [tick],
      version,
    ),
    d = report.data,
    o = d?.order;
  useEffect(() => setMap(false), [id, panel]);
  return (
    <div className="orders-detail">
      <div className="analytics-block-heading">
        <Button secondary onClick={close}>
          <ChevronLeft size={16} />
          Đóng chi tiết
        </Button>
        {o && <h2>Đơn #{o.code}</h2>}
      </div>
      <nav className="analytics-presets" aria-label="Chi tiết đơn">
        {Object.entries(ORDER_REPORT_PANELS).map(([k, v]) => (
          <button
            key={k}
            className={k === panel ? "active" : ""}
            onClick={() => apply({ panel: k, dpage: "", stage: "" }, true)}
          >
            {v}
          </button>
        ))}
      </nav>
      {report.error && (
        <Notice error>
          {report.error}{" "}
          <button className="text-button" onClick={report.reload}>
            Thử lại
          </button>
        </Notice>
      )}
      {!d ? (
        <Pending error={report.error} retry={report.reload} />
      ) : (
        <>
          <Tags o={o!} />
          <div className="orders-detail-metrics">
            <span>
              Tổng cần trả <strong>{money(o!.total)}</strong>
            </span>
            <span>
              Tiền ngân hàng ghi nhận{" "}
              <strong>
                {o!.valid_transactions
                  ? money(o!.bank_received)
                  : "Chưa có dữ liệu ngân hàng"}
              </strong>
            </span>
            <span>
              Tuổi giai đoạn <strong>{minutes(o!.age_minutes)}</strong>
            </span>
          </div>
          {o!.alerts?.length > 0 && (
            <Notice>{o!.alerts.map((a: R) => a.label).join(" · ")}</Notice>
          )}
          {panel === "overview" && (
            <>
              <Block
                title="Thông tin và món tại lúc đặt"
                caption="Thông tin giá, ngân hàng và vị trí dùng snapshot của đơn."
              >
                <div className="orders-contact-grid">
                  <div>
                    <h3>Khách / người nhận</h3>
                    <p>
                      {o!.customer_name} / {o!.recipient}
                    </p>
                    <a href={"tel:" + o!.phone}>{o!.phone}</a>
                    <p>{o!.address}</p>
                  </div>
                  <div>
                    <h3>Chef</h3>
                    <p>{o!.chef_name || "Thiếu hồ sơ"}</p>
                    {d.contacts.chef_phone && (
                      <a href={"tel:" + d.contacts.chef_phone}>
                        {d.contacts.chef_phone}
                      </a>
                    )}
                    <p>
                      {MEAL_NAMES[o!.meal_id as keyof typeof MEAL_NAMES]} ·{" "}
                      {stamp(o!.created_at)}
                    </p>
                  </div>
                </div>
                <Table headers={["Món", "Đơn giá", "Số phần", "Thành tiền"]}>
                  {d.items.map((i: R) => (
                    <tr key={i.id}>
                      <td>
                        <div className="products-identity">
                          <img src={i.image_url || "/icon.svg"} alt="" />
                          <span>{i.name}</span>
                        </div>
                      </td>
                      <td>{money(i.unit_price)}</td>
                      <td>{count(i.quantity)}</td>
                      <td>{money(i.unit_price * i.quantity)}</td>
                    </tr>
                  ))}
                </Table>
                <p>
                  Món: {money(o!.subtotal)} · Voucher: {money(o!.discount)} ·
                  Giao: {money(o!.delivery_fee)} · Tổng: {money(o!.total)}
                </p>
                {o!.note && <p>Ghi chú: {o!.note}</p>}
              </Block>
              <Block
                title="Can thiệp quản trị"
                caption="Mỗi thay đổi cần lý do, kiểm tra trạng thái mới nhất và gửi thông báo."
              >
                <div className="form-row">
                  {d.actions.map((a: string) => (
                    <Button key={a} secondary onClick={() => onAction(o!, a)}>
                      {ORDER_LABELS[a]}
                    </Button>
                  ))}
                  {!d.actions.length && (
                    <p>Đơn không còn thao tác chuyển trạng thái phù hợp.</p>
                  )}
                </div>
                {o!.status === "PLACED" && !o!.automatic && (
                  <p className="small muted">
                    Nhận đơn ở chế độ thủ công cũng xác nhận đã nhận tiền. Chỉ
                    thực hiện sau khi kiểm tra ngân hàng.
                  </p>
                )}
              </Block>
            </>
          )}
          {panel === "timeline" && (
            <Block
              title="Lịch sử các mốc"
              caption="Mốc thiếu không được nội suy. Chef báo đã giao khác với xác nhận hoàn thành của khách/admin."
            >
              <Select
                label="Bước trong lịch sử"
                value={q.get("stage")!}
                options={{
                  all: "Tất cả mốc",
                  ...ORDER_LABELS,
                  PAYMENT_REPORTED: "Khách báo đã chuyển",
                }}
                onChange={(v) => apply({ stage: v, dpage: "" }, true)}
              />
              <div className="orders-stage-times">
                {[
                  "paid",
                  "accepted",
                  "preparing",
                  "delivering",
                  "delivered",
                  "completed",
                ].map((k) => (
                  <div key={k}>
                    <span>
                      {ORDER_LABELS[k === "paid" ? "PAID" : k.toUpperCase()]}
                    </span>
                    <small>{stamp(o![k + "_at"])}</small>
                    <small>{stageDuration(o!, k)}</small>
                  </div>
                ))}
              </div>
              <Table
                headers={["Mốc", "Thời gian", "Người thực hiện", "Ghi chú"]}
              >
                {d.items.map((e: R) => (
                  <tr key={e.id}>
                    <td>{ORDER_LABELS[e.status] || e.status}</td>
                    <td>{stamp(e.created_at)}</td>
                    <td>
                      {e.actor_name}
                      <small>
                        {
                          ORDER_ACTORS[
                            e.actor_role as keyof typeof ORDER_ACTORS
                          ]
                        }
                      </small>
                    </td>
                    <td>{e.note}</td>
                  </tr>
                ))}
                {!d.items.length && (
                  <tr>
                    <td colSpan={4}>Chưa ghi nhận mốc phù hợp.</td>
                  </tr>
                )}
              </Table>
              <Pager
                data={d}
                onPage={(n) => apply({ dpage: String(n) }, true)}
              />
            </Block>
          )}
          {panel === "payments" && (
            <>
              <Block
                title="Ngân hàng và đối chiếu"
                caption="Giá trị đơn đã xác nhận và tiền ngân hàng ghi nhận là hai tập riêng. Xác nhận tay không tạo giao dịch ngân hàng."
              >
                <p>
                  {o!.bank_name} · {o!.account_no} · {o!.account_name}
                </p>
                <p>
                  Nội dung: <strong>{o!.transfer_content}</strong> · Nguồn:{" "}
                  {source(o!.payment_source)} · Xác nhận: {stamp(o!.paid_at)}
                </p>
                {o!.valid_transactions > 0 && (
                  <p>
                    {o!.bank_received < o!.total
                      ? "Thiếu: " + money(o!.total - o!.bank_received)
                      : "Thừa: " + money(o!.bank_received - o!.total)}
                  </p>
                )}
                <Transactions items={d.transactions.items} />
                <Pager
                  data={d.transactions}
                  onPage={(n) => apply({ dpage: String(n) }, true)}
                />
              </Block>
              <Block
                title="Yêu cầu và bằng chứng"
                caption="Số tiền yêu cầu chưa phải tiền thực hoàn. Đã xử lý không luôn có nghĩa là đã hoàn tiền."
              >
                {d.requests.map((r: R) => (
                  <div className="panel" key={r.id}>
                    <div className="spread">
                      <h3>{PAYMENT_REQUEST_KINDS[r.kind] || r.kind}</h3>
                      <span className="status" data-status={r.status}>
                        {PAYMENT_REQUEST_STATUSES[r.status] || r.status}
                      </span>
                    </div>
                    <p>
                      {money(r.amount)} ·{" "}
                      {r.origin === "customer"
                        ? "Khách gửi"
                        : "Ngoại lệ hệ thống"}{" "}
                      · {stamp(r.created_at)}
                    </p>
                    <p>{r.note}</p>
                    {r.contact_phone && (
                      <a href={"tel:" + r.contact_phone}>{r.contact_phone}</a>
                    )}
                    {r.resolution_note && (
                      <p>
                        Bếp: {r.resolution_note} · {stamp(r.submitted_at)}
                      </p>
                    )}
                    {r.evidence_asset_id && (
                      <a
                        href={"/api/files/" + r.evidence_asset_id}
                        target="_blank"
                        rel="noreferrer"
                        className="text-button"
                      >
                        Xem bằng chứng {r.evidence_name}
                      </a>
                    )}
                    {r.review_note && (
                      <p>
                        Admin: {r.review_note} · {stamp(r.reviewed_at)}
                      </p>
                    )}
                    <button
                      className="text-button"
                      onClick={() => requests(o!, r.id)}
                    >
                      Mở luồng đối soát
                    </button>
                  </div>
                ))}
                {!d.requests.length && <p>Chưa có yêu cầu.</p>}
              </Block>
            </>
          )}
          {panel === "delivery" && (
            <>
              <Block
                title="Tuyến giao snapshot"
                caption="Icon di chuyển được mô phỏng theo trạng thái, không phải GPS người giao hoặc cam kết ETA."
              >
                <p>{o!.address}</p>
                <p>
                  Đường thẳng:{" "}
                  {o!.distance_km == null ? "—" : o!.distance_km + " km"} ·
                  Đường bộ:{" "}
                  {o!.route_distance_km == null
                    ? "Chưa ghi nhận"
                    : o!.route_distance_km + " km"}
                </p>
                {map ? (
                  <Map order={o} />
                ) : (
                  <Button secondary onClick={() => setMap(true)}>
                    Hiển thị bản đồ
                  </Button>
                )}
              </Block>
              <Block title="Phản hồi khách">
                {d.reviews.map((r: R) => (
                  <div className="panel" key={r.id}>
                    <h3>
                      {r.user_name || "Khách"} · {r.rating}/5
                    </h3>
                    <small>{stamp(r.created_at)}</small>
                    <p>{r.body || "Không có nội dung"}</p>
                  </div>
                ))}
                {!d.reviews.length && <p>Chưa có đánh giá.</p>}
              </Block>
            </>
          )}
        </>
      )}
    </div>
  );
}
export function AdminOrders({
  onNavigate,
}: {
  onNavigate: (tab: string, chef?: string) => void;
}) {
  const params = useSearchParams(),
    router = useRouter(),
    { revision, refresh, toast } = useApp(),
    [manual, setManual] = useState(0),
    [tick, setTick] = useState(0),
    [metric, setMetric] = useState("placed"),
    [advanced, setAdvanced] = useState(false),
    [settings, setSettings] = useState(false),
    [action, setAction] = useState<{ order: R; status: string } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const q = new URLSearchParams();
  for (const k of [
    "from",
    "to",
    "region",
    "meal",
    "q",
    "status",
    "payment",
    "source",
    "scope",
    "dateBy",
    "group",
    "sort",
    "view",
    "page",
    "actor",
    "txGroup",
    "txDate",
    "txQ",
    "chefPage",
    "regionPage",
  ]) {
    const v = params.get("o" + k);
    if (v) q.set(k, v);
  }
  if (params.get("chef")) q.set("chef", params.get("chef")!);
  if (
    !q.has("scope") &&
    ["current", "payments"].includes(q.get("view") || "")
  ) {
    q.set("scope", "current");
    if (!q.has("group"))
      q.set("group", q.get("view") === "current" ? "active" : "money");
    if (!q.has("sort")) q.set("sort", "priority");
  }
  if (params.get("filter") === "active" && !q.has("scope")) {
    q.set("scope", "current");
    q.set("group", "active");
  }
  const view = q.get("view") || "list",
    selected = params.get("order"),
    version = revision + ":" + manual,
    query = q.toString(),
    master = new URLSearchParams();
  for (const k of ["from", "to", "region", "meal", "q", "chef"])
    if (q.has(k)) master.set(k, q.get(k)!);
  const summary = useLoad<R>(
      "admin/order-analytics/summary?" + master,
      [tick],
      version,
    ),
    trends = useLoad<R>(
      !selected && view === "list"
        ? "admin/order-analytics/trends?" + master
        : null,
      [],
      version,
    ),
    operations = useLoad<R>(
      !selected && view === "current"
        ? "admin/order-analytics/operations?" +
            master +
            "&page=" +
            (params.get("oalertPage") || 1)
        : null,
      [tick],
      version,
    ),
    listing = useLoad<R>(
      !selected && view !== "performance"
        ? "admin/order-analytics/list?" + query
        : null,
      [tick],
      version,
    ),
    payments = useLoad<R>(
      !selected && view === "payments"
        ? "admin/order-analytics/payments?" +
            master +
            "&txGroup=" +
            (q.get("txGroup") || "linked") +
            "&txDate=" +
            (q.get("txDate") || "bank") +
            "&txQ=" +
            encodeURIComponent(q.get("txQ") || "") +
            "&page=" +
            (params.get("otxPage") || 1)
        : null,
      [tick],
      version,
    ),
    performance = useLoad<R>(
      !selected && view === "performance"
        ? "admin/order-analytics/performance?" +
            master +
            "&chefPage=" +
            (q.get("chefPage") || 1) +
            "&regionPage=" +
            (q.get("regionPage") || 1)
        : null,
      [],
      version,
    ),
    today = serviceDate();
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1);
    }, 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (
      !selected &&
      listing.data &&
      Number(q.get("page") || 1) !== listing.data.page
    ) {
      const p = new URLSearchParams(params.toString());
      p.set("opage", String(listing.data.page));
      router.replace("/admin?" + p, { scroll: false });
    }
  }, [listing.data, selected, query, params, router]);
  function apply(patch: Record<string, string>, detail = false) {
    const p = new URLSearchParams(params.toString());
    p.set("tab", "orders");
    p.delete("filter");
    if (!detail && !Object.hasOwn(patch, "page")) p.delete("opage");
    for (const [k, v] of Object.entries(patch)) {
      const key = k === "chef" ? k : "o" + k;
      if (v && v !== "all") p.set(key, v);
      else p.delete(key);
    }
    if (!detail) {
      p.delete("order");
      p.delete("opanel");
      p.delete("odpage");
      p.delete("ostage");
      if (
        ["from", "to", "chef", "region", "meal", "q"].some((k) =>
          Object.hasOwn(patch, k),
        )
      )
        for (const k of ["txPage", "alertPage", "chefPage", "regionPage"])
          p.delete("o" + k);
    }
    router.push("/admin?" + p, { scroll: false });
  }
  function open(id: string, panel = "overview") {
    const p = new URLSearchParams(params.toString());
    p.set("order", id);
    p.set("opanel", panel);
    p.delete("odpage");
    p.delete("ostage");
    router.push("/admin?" + p, { scroll: false });
  }
  function requests(o: R, request?: string) {
    const p = new URLSearchParams({
      tab: "payments",
      chef: o.chef_id,
      order: o.id,
    });
    if (request) p.set("request", request);
    router.push("/admin?" + p, { scroll: false });
  }
  const reset = {
    status: "all",
    payment: "all",
    source: "all",
    actor: "all",
    group: "all",
    sort: "newest",
  };
  function kpi(key: string) {
    apply({
      ...reset,
      view: "list",
      scope: ["current", "attention"].includes(key) ? "current" : "period",
      dateBy:
        key === "paid"
          ? "paid"
          : ["completed", "gmv"].includes(key)
            ? "completed"
            : "created",
      group:
        key === "current"
          ? "active"
          : key === "attention"
            ? "attention"
            : key === "cancelled"
              ? "cancelled"
              : "all",
      status: ["completed", "gmv"].includes(key)
        ? "COMPLETED"
        : key === "expired"
          ? "EXPIRED"
          : "all",
    });
  }
  async function save(path: string, body: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await post(path, body);
      setAction(null);
      setSettings(false);
      setManual(Date.now());
      refresh();
      toast("Đã cập nhật.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const cards = [
    ["placed", "Đơn phát sinh", "Ngày tạo trong kỳ"],
    ["paid", "Đơn xác nhận tiền", "Ngày xác nhận trong kỳ"],
    ["completed", "Đơn hoàn thành", "Ngày hoàn thành trong kỳ"],
    ["gmv", "Doanh số món", "Sau voucher · Không gồm giao"],
    ["current", "Đang xử lý", "Toàn bộ ngày"],
    ["attention", "Cần chú ý", "Toàn bộ ngày"],
    ["cancelled", "Hủy / từ chối", "Nhóm tạo trong kỳ"],
    ["expired", "Hết hạn", "Nhóm tạo trong kỳ"],
  ];
  const tableProps = {
    open,
    advanced,
    onChef: (id: string) => onNavigate("chefs", id),
    onRequests: requests,
    dateBy: q.get("dateBy") || "created",
  };
  return (
    <div className="admin-orders analytics-overview">
      <div className="analytics-toolbar">
        <div className="analytics-presets">
          {[7, 30, 90].map((n) => (
            <button
              key={n}
              className={
                (q.get("from") || shiftDate(today, -29)) ===
                shiftDate(today, 1 - n)
                  ? "active"
                  : ""
              }
              onClick={() =>
                apply({ from: shiftDate(today, 1 - n), to: today }, !!selected)
              }
            >
              {n} ngày
            </button>
          ))}
        </div>
        <div className="analytics-toolbar-actions">
          <Button secondary onClick={() => setManual(Date.now())}>
            <RefreshCw size={16} />
            Làm mới đơn
          </Button>
          <Button
            secondary
            disabled={!summary.data}
            onClick={() => {
              setError("");
              setSettings(true);
            }}
          >
            <Settings size={16} />
            Ngưỡng cảnh báo
          </Button>
        </div>
      </div>
      <form
        key={master.toString()}
        className="products-filters analytics-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          apply(
            Object.fromEntries(
              ["from", "to", "chef", "region", "meal", "q"].map((k) => [
                k,
                String(f.get(k) || ""),
              ]),
            ),
            !!selected,
          );
        }}
      >
        <Field label="Từ ngày">
          <input
            type="date"
            name="from"
            defaultValue={q.get("from") || shiftDate(today, -29)}
            required
          />
        </Field>
        <Field label="Đến ngày">
          <input
            type="date"
            name="to"
            defaultValue={q.get("to") || today}
            required
          />
        </Field>
        <Field label="Chef">
          <select name="chef" defaultValue={q.get("chef") || ""}>
            <option value="">Tất cả bếp</option>
            {summary.data?.chefs.map((c: R) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Khu vực giao">
          <select name="region" defaultValue={q.get("region") || ""}>
            <option value="">Tất cả vùng giao</option>
            {summary.data?.regions.map((r: R) => (
              <option value={r.id} key={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bữa ăn">
          <select name="meal" defaultValue={q.get("meal") || ""}>
            <option value="">Tất cả bữa</option>
            {Object.entries(MEAL_NAMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tìm đơn / khách / chef">
          <input
            name="q"
            maxLength={100}
            defaultValue={q.get("q") || ""}
            placeholder="Mã đơn, tên, điện thoại…"
          />
        </Field>
        <Button type="submit">Áp dụng</Button>
      </form>
      {summary.error && (
        <Notice error>
          {summary.error}{" "}
          <button className="text-button" onClick={summary.reload}>
            Thử lại
          </button>
        </Notice>
      )}
      {!summary.data && !summary.error ? (
        <Pending retry={summary.reload} />
      ) : (
        summary.data && (
          <>
            <div className="analytics-kpis products-kpis orders-kpis">
              {cards.map(([k, label, caption]) => (
                <button
                  className="analytics-kpi"
                  key={k}
                  onClick={() => kpi(k)}
                >
                  <span className="analytics-kpi-label">{label}</span>
                  <strong>
                    {k === "gmv"
                      ? money(summary.data!.metrics[k])
                      : count(summary.data!.metrics[k])}
                  </strong>
                  <small>{caption}</small>
                  {summary.data!.delta[k] != null && (
                    <small>
                      {summary.data!.delta[k] > 0 ? "+" : ""}
                      {Number(summary.data!.delta[k]).toFixed(1)}% so kỳ trước
                    </small>
                  )}
                </button>
              ))}
            </div>
            <p className="muted small">
              Cập nhật: {stamp(summary.data.updatedAt)} ·{" "}
              {count(summary.data.quality.legacy)} đơn dùng mốc hoàn thành cũ ·{" "}
              {count(summary.data.quality.sourceMissing)} đơn chưa rõ nguồn
              tiền. KPI không đổi theo bộ lọc của bảng.
            </p>
          </>
        )
      )}
      {[trends, operations, payments, performance].map((r, i) =>
        r.data && r.error ? (
          <Notice error key={i}>
            {r.error}{" "}
            <button className="text-button" onClick={r.reload}>
              Thử lại
            </button>
          </Notice>
        ) : null,
      )}
      {selected ? (
        <OrderDetail
          id={selected}
          query={master.toString()}
          params={new URLSearchParams(params.toString())}
          version={version}
          tick={tick}
          apply={apply}
          close={() => {
            const p = new URLSearchParams(params.toString());
            for (const key of ["order", "opanel", "odpage", "ostage"])
              p.delete(key);
            router.push("/admin?" + p, { scroll: false });
          }}
          requests={requests}
          onAction={(order, status) => {
            setError("");
            setAction({ order, status });
          }}
        />
      ) : (
        <>
          <nav className="analytics-presets" aria-label="Báo cáo đơn hàng">
            {Object.entries(ORDER_REPORT_VIEWS).map(([k, v]) => (
              <button
                key={k}
                className={view === k ? "active" : ""}
                onClick={() =>
                  apply({
                    view: k,
                    ...reset,
                    scope: ["current", "payments"].includes(k)
                      ? "current"
                      : "period",
                    group:
                      k === "current"
                        ? "active"
                        : k === "payments"
                          ? "money"
                          : "all",
                    sort: k === "current" ? "priority" : "newest",
                  })
                }
              >
                {v}
              </button>
            ))}
          </nav>
          {view === "list" && (
            <>
              {!trends.data ? (
                <Pending error={trends.error} retry={trends.reload} />
              ) : (
                <div className="analytics-two-columns">
                  <Block
                    title="Xu hướng trong kỳ"
                    caption="So với kỳ trước cùng số ngày, theo từng mốc riêng."
                  >
                    <Select
                      label="Chỉ số biểu đồ"
                      value={metric}
                      options={{
                        placed: "Đơn phát sinh",
                        completed: "Đơn hoàn thành",
                        gmv: "Doanh số món",
                      }}
                      onChange={setMetric}
                    />
                    <SalesChart
                      days={trends.data.days}
                      metric={metric}
                      unit="đơn"
                    />
                  </Block>
                  <Block
                    title="Kết quả nhóm đơn tạo trong kỳ"
                    caption="Kết quả hiện tại của cùng nhóm đơn. Đơn chưa kết thúc vẫn có trong mẫu số."
                  >
                    <Table headers={["Kết quả", "Đơn", "Tỷ trọng"]}>
                      {trends.data.outcomes.map((r: R) => {
                        const total = trends.data!.outcomes.reduce(
                          (n: number, x: R) => n + Number(x.count),
                          0,
                        );
                        return (
                          <tr key={r.status}>
                            <td>
                              <button
                                className="text-button"
                                onClick={() =>
                                  apply({
                                    ...reset,
                                    scope: "period",
                                    dateBy: "created",
                                    status:
                                      r.status === "ACTIVE"
                                        ? "all"
                                        : r.status === "UNKNOWN"
                                          ? "all"
                                          : r.status,
                                    group:
                                      r.status === "ACTIVE"
                                        ? "active"
                                        : r.status === "UNKNOWN"
                                          ? "unknown"
                                          : "all",
                                  })
                                }
                              >
                                {r.status === "ACTIVE"
                                  ? "Còn xử lý"
                                  : ORDER_LABELS[r.status] || "Chưa xác định"}
                              </button>
                            </td>
                            <td>{count(r.count)}</td>
                            <td>
                              <meter
                                aria-label={"Tỷ trọng " + r.status}
                                min={0}
                                max={Math.max(total, 1)}
                                value={r.count}
                              />{" "}
                              {total ? ((100 * r.count) / total).toFixed(1) : 0}
                              %
                            </td>
                          </tr>
                        );
                      })}
                    </Table>
                  </Block>
                </div>
              )}
            </>
          )}
          {view === "current" && (
            <>
              {!operations.data ? (
                <Pending error={operations.error} retry={operations.reload} />
              ) : (
                <>
                  <Block
                    title="Giai đoạn đang xử lý"
                    caption="Giữ toàn bộ đơn đang chờ, kể cả được tạo trước kỳ báo cáo. Ngưỡng là tín hiệu kiểm tra, chưa phải cam kết giao hàng."
                  >
                    <Table
                      headers={[
                        "Giai đoạn",
                        "Đơn",
                        "Vượt ngưỡng",
                        "Tuổi lâu nhất",
                        "Thiếu mốc",
                      ]}
                    >
                      {ACTIVE_ORDER_STATUSES.map((s) => {
                        const r =
                          operations.data!.stages.find(
                            (x: R) => x.status === s,
                          ) || {};
                        return (
                          <tr key={s}>
                            <td>
                              <button
                                className="text-button"
                                onClick={() =>
                                  apply({
                                    ...reset,
                                    scope: "current",
                                    group: "active",
                                    status: s,
                                    sort: "waiting",
                                  })
                                }
                              >
                                {ORDER_LABELS[s]}
                              </button>
                            </td>
                            <td>{count(r.count)}</td>
                            <td>{count(r.overdue)}</td>
                            <td>{minutes(r.oldest_minutes)}</td>
                            <td>{count(r.missing)}</td>
                          </tr>
                        );
                      })}
                    </Table>
                  </Block>
                  <Block
                    title="Đơn cần chú ý"
                    caption="Bao gồm đối soát và đơn kết thúc có vấn đề; ưu tiên cảnh báo rồi tuổi chờ."
                  >
                    <OrdersTable
                      {...tableProps}
                      data={operations.data}
                      onPage={(n) => apply({ alertPage: String(n) })}
                    />
                  </Block>
                </>
              )}
            </>
          )}
          {view === "payments" && (
            <>
              {!payments.data ? (
                <Pending error={payments.error} retry={payments.reload} />
              ) : (
                <>
                  <Block
                    title="Giá trị đơn xác nhận tiền trong kỳ"
                    caption="Theo ngày xác nhận tiền; không phải tổng tiền ngân hàng hay doanh thu nền tảng."
                  >
                    <div className="orders-detail-metrics">
                      <span>
                        Đơn{" "}
                        <strong>{count(payments.data.confirmed.count)}</strong>
                      </span>
                      <span>
                        Giá trị{" "}
                        <strong>
                          {money(payments.data.confirmed.paid_value)}
                        </strong>
                      </span>
                      <span>
                        Tự động / thủ công / chưa rõ{" "}
                        <strong>
                          {count(payments.data.confirmed.auto_count)} /{" "}
                          {count(payments.data.confirmed.manual_count)} /{" "}
                          {count(payments.data.confirmed.unknown_count)}
                        </strong>
                      </span>
                    </div>
                  </Block>
                  {payments.data.requests && (
                    <Notice>
                      Đối soát hiện tại: {count(payments.data.requests.orders)}{" "}
                      đơn · {count(payments.data.requests.count)} yêu cầu ·{" "}
                      {money(payments.data.requests.claimed_amount)} được yêu
                      cầu xử lý. Đây chưa phải số tiền phải hoàn hoặc đã hoàn.
                    </Notice>
                  )}
                  <Block
                    title="Giao dịch ngân hàng"
                    caption="Kết quả theo trạng thái xử lý hiện tại. Mỗi giao dịch chỉ ghi nhận một lần; webhook retry không phải tiền chuyển thêm."
                  >
                    <div className="orders-list-filters">
                      <Select
                        label="Nhóm giao dịch"
                        value={q.get("txGroup") || "linked"}
                        options={TRANSACTION_GROUPS}
                        onChange={(v) => apply({ txGroup: v, txPage: "" })}
                      />
                      <Select
                        label="Mốc giao dịch"
                        value={q.get("txDate") || "bank"}
                        options={{
                          bank: "Ngày ngân hàng",
                          received: "Ngày nhận webhook",
                        }}
                        onChange={(v) => apply({ txDate: v, txPage: "" })}
                      />
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          apply({
                            txQ: String(
                              new FormData(e.currentTarget).get("txQ") || "",
                            ),
                            txPage: "",
                          });
                        }}
                      >
                        <Field label="Tìm giao dịch">
                          <input
                            name="txQ"
                            maxLength={100}
                            defaultValue={q.get("txQ") || ""}
                          />
                        </Field>
                        <Button secondary type="submit">
                          Tìm giao dịch
                        </Button>
                      </form>
                    </div>
                    {q.get("txGroup") === "unmatched" && (
                      <Notice>
                        Khoản chưa gắn đơn chỉ lọc chef, kỳ và tìm giao dịch. Bộ
                        lọc vùng giao, bữa và tìm đơn không áp dụng.
                      </Notice>
                    )}
                    <p>
                      Hợp lệ: {money(payments.data.totals.valid_amount)} · Cần
                      kiểm tra: {money(payments.data.totals.invalid_amount)} ·
                      Chưa gắn đơn:{" "}
                      {money(payments.data.totals.unmatched_amount)}
                    </p>
                    <p className="small muted">
                      {count(payments.data.totals.mismatched_dates)} giao dịch
                      có ngày ngân hàng khác ngày webhook. Dữ liệu ngân hàng có
                      thể chưa đầy đủ; chưa có ledger tiền hoàn.
                    </p>
                    <Transactions
                      items={payments.data.transactions}
                      open={(id) => open(id, "payments")}
                    />
                    <Pager
                      data={payments.data}
                      onPage={(n) => apply({ txPage: String(n) })}
                    />
                  </Block>
                </>
              )}
            </>
          )}
          {view === "performance" && (
            <>
              {!performance.data ? (
                <Pending error={performance.error} retry={performance.reload} />
              ) : (
                <>
                  <Block
                    title="Giờ phát sinh nhu cầu"
                    caption="Thứ và giờ tạo đơn theo giờ Việt Nam. Màu đậm hơn tương ứng nhiều đơn hơn."
                  >
                    <div className="orders-heatmap">
                      {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                        <div className="orders-heatmap-row" key={day}>
                          <span>{day === 6 ? "CN" : "T" + (day + 2)}</span>
                          {Array.from({ length: 24 }, (_, hour) => {
                            const n = Number(
                                performance.data!.heatmap.find(
                                  (r: R) =>
                                    r.weekday === day && r.hour === hour,
                                )?.count || 0,
                              ),
                              max = Math.max(
                                1,
                                ...performance.data!.heatmap.map((r: R) =>
                                  Number(r.count),
                                ),
                              );
                            return (
                              <div
                                key={hour}
                                title={`${day === 6 ? "CN" : "T" + (day + 2)} ${hour}h: ${count(n)} đơn`}
                                style={{
                                  background: n
                                    ? `rgba(33,113,93,${0.15 + (0.8 * n) / max})`
                                    : "#eef2ef",
                                  color: n / max > 0.5 ? "white" : "#42554c",
                                }}
                              >
                                <small>{hour}h</small>
                                {count(n)}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </Block>
                  <Block
                    title="Thời gian từng đoạn"
                    caption="Chỉ tính cặp mốc hợp lệ, theo ngày kết thúc đoạn. P90 cần ít nhất 20 mẫu. Nhận thủ công đồng thời xác nhận tiền được loại khỏi đoạn phản hồi sau tiền."
                  >
                    <Table
                      headers={[
                        "Đoạn",
                        "Mẫu hợp lệ",
                        "Median",
                        "P90",
                        "Thiếu / sai mốc",
                        "Loại trừ",
                      ]}
                    >
                      {[
                        "payment",
                        "accept",
                        "prepare",
                        "dispatch",
                        "delivery",
                        "confirm",
                      ].map((k, i) => {
                        const r =
                          performance.data!.durations.find(
                            (x: R) => x.kind === k,
                          ) || {};
                        return (
                          <tr key={k}>
                            <td>
                              {
                                [
                                  "Tạo → xác nhận tiền",
                                  "PAID tự động → nhận",
                                  "Nhận → chuẩn bị",
                                  "Chuẩn bị → giao",
                                  "Giao → chef báo đã giao",
                                  "Đã giao → hoàn thành",
                                ][i]
                              }
                            </td>
                            <td>{count(r.samples)}</td>
                            <td>
                              {r.median == null
                                ? "Chưa đủ dữ liệu"
                                : minutes(r.median)}
                            </td>
                            <td>
                              {r.p90 == null ? "Chưa đủ mẫu" : minutes(r.p90)}
                            </td>
                            <td>{count(r.missing)}</td>
                            <td>{count(r.excluded)}</td>
                          </tr>
                        );
                      })}
                    </Table>
                  </Block>
                  <Block
                    title="Hiệu quả theo chef"
                    caption="Kết quả của nhóm tạo trong kỳ; doanh số theo đơn hoàn thành trong kỳ. Tỷ lệ chỉ dùng để so sánh khi đủ mẫu."
                  >
                    <Table
                      headers={[
                        "Chef",
                        "Tạo / còn xử lý",
                        "Hoàn thành / đã chốt",
                        "Hủy / từ chối / hết hạn",
                        "Chậm nhận / đối soát",
                        "Nhận sau tiền tự động",
                        "Doanh số món",
                      ]}
                    >
                      {performance.data.chefs.items.map((r: R) => {
                        const closed =
                          Number(r.completed) +
                          Number(r.cancelled) +
                          Number(r.rejected) +
                          Number(r.expired);
                        return (
                          <tr key={r.chef_id}>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => apply({ chef: r.chef_id })}
                              >
                                {r.chef_name}
                              </button>
                            </td>
                            <td>
                              {count(r.placed)} / {count(r.incomplete)}
                              <small>
                                Toàn bộ đang chờ: {count(r.current)}
                              </small>
                            </td>
                            <td>
                              {count(r.completed)} / {count(closed)}
                              <small>
                                Trên nhóm tạo:{" "}
                                {r.placed
                                  ? ((100 * r.completed) / r.placed).toFixed(1)
                                  : "—"}
                                %
                              </small>
                              <small>
                                Trên đã chốt:{" "}
                                {closed
                                  ? ((100 * r.completed) / closed).toFixed(1)
                                  : "—"}
                                %{closed < 20 ? " · Ít mẫu" : ""}
                              </small>
                            </td>
                            <td>
                              {count(r.cancelled)} / {count(r.rejected)} /{" "}
                              {count(r.expired)}
                            </td>
                            <td>
                              {count(r.overdue)} / {count(r.requests)}
                            </td>
                            <td>
                              Median:{" "}
                              {r.latency.median == null
                                ? "—"
                                : minutes(r.latency.median)}
                              <small>
                                P90:{" "}
                                {r.latency.p90 == null
                                  ? "Chưa đủ mẫu"
                                  : minutes(r.latency.p90)}{" "}
                                · {count(r.latency.samples)} mẫu
                              </small>
                            </td>
                            <td>{money(r.gmv)}</td>
                          </tr>
                        );
                      })}
                    </Table>
                    <Pager
                      data={performance.data.chefs}
                      onPage={(n) => apply({ chefPage: String(n) })}
                    />
                  </Block>
                  <Block
                    title="Khu vực giao và bữa"
                    caption="Vùng từ snapshot vị trí giao; không thay khoảng cách thiếu bằng 0."
                  >
                    <Table
                      headers={[
                        "Vùng / bữa",
                        "Tạo / hoàn thành / còn xử lý",
                        "Hủy / từ chối / hết hạn",
                        "Khoảng cách bình quân",
                        "Doanh số món",
                      ]}
                    >
                      {performance.data.regions.items.map((r: R) => (
                        <tr key={r.region + ":" + r.meal_id}>
                          <td>
                            <button
                              className="text-button"
                              onClick={() =>
                                apply({ region: r.region, meal: r.meal_id })
                              }
                            >
                              {r.label}
                            </button>
                            <small>
                              {MEAL_NAMES[r.meal_id as keyof typeof MEAL_NAMES]}
                            </small>
                          </td>
                          <td>
                            {count(r.placed)} / {count(r.completed)} /{" "}
                            {count(r.incomplete)}
                          </td>
                          <td>
                            {count(r.cancelled)} / {count(r.rejected)} /{" "}
                            {count(r.expired)}
                          </td>
                          <td>
                            Thẳng:{" "}
                            {r.distance_km == null
                              ? "—"
                              : Number(r.distance_km).toFixed(2) + " km"}
                            <small>
                              Đường bộ:{" "}
                              {r.route_distance_km == null
                                ? "—"
                                : Number(r.route_distance_km).toFixed(2) +
                                  " km"}
                            </small>
                          </td>
                          <td>{money(r.gmv)}</td>
                        </tr>
                      ))}
                    </Table>
                    <Pager
                      data={performance.data.regions}
                      onPage={(n) => apply({ regionPage: String(n) })}
                    />
                  </Block>
                  <Block
                    title="Hủy, từ chối và hết hạn"
                    caption="Phân theo người thực hiện. Ghi chú ở chi tiết đơn; chưa có phân loại lý do chuẩn."
                  >
                    <Table
                      headers={[
                        "Kết quả",
                        "Thực hiện",
                        "Đơn",
                        "Đã có mốc tiền",
                      ]}
                    >
                      {performance.data.cancellations.map((r: R) => (
                        <tr key={r.status + ":" + r.cancel_actor}>
                          <td>{ORDER_LABELS[r.status]}</td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() =>
                                apply({
                                  ...reset,
                                  view: "list",
                                  scope: "period",
                                  dateBy: "created",
                                  status: r.status,
                                  actor: r.cancel_actor,
                                })
                              }
                            >
                              {
                                ORDER_ACTORS[
                                  r.cancel_actor as keyof typeof ORDER_ACTORS
                                ]
                              }
                            </button>
                          </td>
                          <td>{count(r.count)}</td>
                          <td>{count(r.paid)}</td>
                        </tr>
                      ))}
                    </Table>
                  </Block>
                  <Block title="Thông tin bổ sung">
                    <p>
                      {count(performance.data.secondary.buyers)} khách đặt ·{" "}
                      {count(performance.data.secondary.chefs)} chef có đơn tạo
                      · {count(performance.data.secondary.servings)} phần hoàn
                      thành
                    </p>
                    <p>
                      Phí giao trên đơn hoàn thành:{" "}
                      {money(performance.data.secondary.delivery)} · Voucher:{" "}
                      {money(performance.data.secondary.voucher)} · Giá trị món
                      bình quân:{" "}
                      {performance.data.secondary.completed
                        ? money(
                            performance.data.secondary.gmv /
                              performance.data.secondary.completed,
                          )
                        : "Chưa có đơn hoàn thành"}
                    </p>
                  </Block>
                </>
              )}
            </>
          )}
          {view !== "performance" && (
            <Block
              title={
                view === "payments" ? "Đơn cần kiểm tra tiền" : "Danh sách đơn"
              }
              caption={
                (q.get("scope") || "period") === "current"
                  ? "Toàn bộ ngày, theo bộ lọc hiện trạng. Kỳ báo cáo không che đơn cũ."
                  : "Theo kỳ và mốc ngày đã chọn. Tổng KPI phía trên vẫn theo bộ lọc chung."
              }
            >
              <div className="orders-list-filters">
                <Select
                  label="Phạm vi danh sách"
                  value={q.get("scope") || "period"}
                  options={{ period: "Trong kỳ", current: "Toàn bộ ngày" }}
                  onChange={(v) => apply({ scope: v })}
                />
                <Select
                  label="Mốc ngày danh sách"
                  value={q.get("dateBy") || "created"}
                  options={ORDER_DATE_BY}
                  onChange={(v) => apply({ dateBy: v })}
                />
                <Select
                  label="Trạng thái đơn"
                  value={q.get("status") || "all"}
                  options={{ all: "Tất cả trạng thái", ...ORDER_LABELS }}
                  onChange={(v) => apply({ status: v })}
                />
                <Select
                  label="Trạng thái tiền"
                  value={q.get("payment") || "all"}
                  options={{
                    all: "Tất cả thanh toán",
                    ...ORDER_PAYMENT_LABELS,
                  }}
                  onChange={(v) => apply({ payment: v })}
                />
                <Select
                  label="Nhóm đơn"
                  value={q.get("group") || "all"}
                  options={ORDER_REPORT_GROUPS}
                  onChange={(v) => apply({ group: v })}
                />
                <Select
                  label="Nguồn xác nhận"
                  value={q.get("source") || "all"}
                  options={{
                    all: "Mọi nguồn",
                    auto: "Tự động",
                    manual: "Thủ công",
                    unknown: "Chưa rõ",
                  }}
                  onChange={(v) => apply({ source: v })}
                />
                <Select
                  label="Người hủy / từ chối"
                  value={q.get("actor") || "all"}
                  options={ORDER_ACTORS}
                  onChange={(v) => apply({ actor: v })}
                />
                <Select
                  label="Sắp xếp đơn"
                  value={q.get("sort") || "newest"}
                  options={ORDER_REPORT_SORTS}
                  onChange={(v) => apply({ sort: v })}
                />
              </div>
              <div className="form-row">
                <Button secondary onClick={() => setAdvanced((v) => !v)}>
                  {advanced ? "Ẩn cột nâng cao" : "Cột nâng cao"}
                </Button>
                <Button
                  secondary
                  onClick={() =>
                    apply({ ...reset, scope: "period", dateBy: "created" })
                  }
                >
                  Xóa bộ lọc danh sách
                </Button>
                {view === "current" && (
                  <>
                    <Button
                      secondary
                      onClick={() =>
                        apply({
                          ...reset,
                          scope: "current",
                          group: "active",
                          status: "PAID",
                          sort: "waiting",
                        })
                      }
                    >
                      Chờ chef nhận
                    </Button>
                    <Button
                      secondary
                      onClick={() =>
                        apply({
                          ...reset,
                          scope: "current",
                          group: "active",
                          status: "DELIVERED",
                          sort: "waiting",
                        })
                      }
                    >
                      Chờ khách xác nhận
                    </Button>
                  </>
                )}
              </div>
              {!listing.data ? (
                <Pending error={listing.error} retry={listing.reload} />
              ) : (
                <>
                  {listing.error && <Notice error>{listing.error}</Notice>}
                  <OrdersTable
                    {...tableProps}
                    data={listing.data}
                    onPage={(n) => apply({ page: String(n) })}
                  />
                </>
              )}
            </Block>
          )}
        </>
      )}
      {action && (
        <Dialog
          title={ORDER_LABELS[action.status] + " · #" + action.order.code}
          busy={busy}
          onClose={() => setAction(null)}
        >
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void save("admin/order-analytics/transition/" + action.order.id, {
                action: action.status,
                reason: String(
                  new FormData(e.currentTarget).get("reason") || "",
                ).trim(),
              });
            }}
          >
            <p>
              Trạng thái hiện tại: {ORDER_LABELS[action.order.status]}. Hệ thống
              kiểm tra lại trước khi lưu.
            </p>
            {action.order.status === "PLACED" &&
              action.status === "ACCEPTED" && (
                <Notice>
                  Thao tác này xác nhận tiền thủ công và nhận đơn. Cần đối chiếu
                  tiền đã vào ngân hàng.
                </Notice>
              )}
            <Field label="Lý do">
              <textarea name="reason" required minLength={5} maxLength={500} />
            </Field>
            {error && <Notice error>{error}</Notice>}
            <Button type="submit" disabled={busy}>
              Xác nhận thay đổi
            </Button>
          </form>
        </Dialog>
      )}
      {settings && summary.data && (
        <Dialog
          title="Ngưỡng theo dõi đơn"
          busy={busy}
          onClose={() => setSettings(false)}
        >
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void save(
                "admin/order-analytics/settings",
                Object.fromEntries(
                  Object.keys(summary.data!.thresholds).map((k) => [
                    k,
                    Number(f.get(k)),
                  ]),
                ),
              );
            }}
          >
            <p className="small muted">
              Ngưỡng chỉ tạo cảnh báo. SLA chậm nhận{" "}
              {summary.data.sla.acceptMinutes} phút và đối soát{" "}
              {summary.data.sla.refundHours} giờ dùng cài đặt chung.
            </p>
            {[
              ["acceptedMinutes", "Bếp đã nhận (phút)", 1440],
              ["preparingMinutes", "Đang chuẩn bị (phút)", 1440],
              ["deliveringMinutes", "Đang giao (phút)", 1440],
              ["deliveredMinutes", "Chờ khách xác nhận (phút)", 2880],
              ["expiryGraceMinutes", "Đệm hết hạn (phút)", 60],
            ].map(([k, label, max]) => (
              <Field key={k} label={String(label)}>
                <input
                  name={String(k)}
                  type="number"
                  required
                  min={k === "expiryGraceMinutes" ? 0 : 1}
                  max={max}
                  defaultValue={summary.data!.thresholds[k]}
                />
              </Field>
            ))}
            {error && <Notice error>{error}</Notice>}
            <Button type="submit" disabled={busy}>
              Lưu ngưỡng
            </Button>
          </form>
        </Dialog>
      )}
    </div>
  );
}
