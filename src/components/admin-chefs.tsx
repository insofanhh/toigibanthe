"use client";
import { AnimatedValue } from "./animated-value";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChefHat,
  Clock,
  CheckCircle2,
  Utensils,
  ShoppingBag,
  UserPlus,
  PauseCircle,
  TriangleAlert,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  Settings,
} from "lucide-react";
import { useApp, post } from "./providers";
import {
  Button,
  Field,
  Notice,
  PageLoading,
  useLoad,
  BackgroundRefreshNotice,
} from "./app";
import { Link } from "./page-motion";
import {
  CHEF_STATUSES,
  CHEF_GROUPS,
  CHEF_SORTS,
  CHEF_DETAIL_TABS,
  type ChefRow,
} from "@/lib/admin-chefs-domain";
import {
  serviceDate,
  money,
  MEAL_NAMES,
  parseUTC,
  ORDER_LABELS,
  PAYMENT_REQUEST_KINDS,
  PAYMENT_REQUEST_STATUSES,
} from "@/lib/domain";
import { shiftDate } from "@/lib/analytics-domain";
type Row = Record<string, any>;
const count = (n: unknown) => Number(n || 0).toLocaleString("vi-VN"),
  stamp = (s: string | null) =>
    s
      ? parseUTC(s).toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          dateStyle: "short",
          timeStyle: "short",
        })
      : "—";
const pct = (n: number | null) =>
  n === null ? "Chưa đủ dữ liệu" : n.toFixed(1) + "%";
function elapsed(from: string | null, to: string | null) {
  if (!from || !to || parseUTC(to) < parseUTC(from)) return "Thiếu mốc hợp lệ";
  return (
    ((parseUTC(to).getTime() - parseUTC(from).getTime()) / 86400000).toFixed(
      1,
    ) + " ngày"
  );
}
function ProfileStatus({ status }: { status: string }) {
  return (
    <span className="status chef-profile-status" data-chef-status={status}>
      {CHEF_STATUSES[status as keyof typeof CHEF_STATUSES] || status}
    </span>
  );
}
function Block({
  title,
  caption,
  children,
  action,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="analytics-block">
      <div className="analytics-block-heading">
        <div>
          <h2>{title}</h2>
          {caption && <p>{caption}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Pending({
  error,
  retry,
}: {
  error?: string | null;
  retry: () => void;
}) {
  return error ? (
    <Notice error>
      {error}{" "}
      <button className="text-button" onClick={retry}>
        Thử lại
      </button>
    </Notice>
  ) : (
    <PageLoading label="Đang tải dữ liệu bếp…" />
  );
}
function Table({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="analytics-table-wrap">
      <table className="analytics-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Pager({
  data,
  onPage,
}: {
  data: Row;
  onPage: (page: number) => void;
}) {
  return (
    <div className="users-pagination">
      <Button
        secondary
        disabled={data.page <= 1}
        onClick={() => onPage(data.page - 1)}
      >
        <ChevronLeft size={16} /> Trước
      </Button>
      <span>
        Trang <AnimatedValue>{count(data.page)}</AnimatedValue> /{" "}
        <AnimatedValue>{count(data.pages)}</AnimatedValue> ·{" "}
        <AnimatedValue>{count(data.total)}</AnimatedValue> bản ghi
      </span>
      <Button
        secondary
        disabled={data.page >= data.pages}
        onClick={() => onPage(data.page + 1)}
      >
        Sau <ChevronRight size={16} />
      </Button>
    </div>
  );
}
function OrderStatus({ value }: { value: string }) {
  return (
    <span className="status" data-status={value}>
      {ORDER_LABELS[value] || value}
    </span>
  );
}
function GrowthChart({ days }: { days: Row[] }) {
  const [hover, setHover] = useState<number | null>(null),
    max = Math.max(1, ...days.flatMap((d) => [d.submitted, d.approved])),
    x = (i: number) =>
      45 + (days.length === 1 ? 0.5 : i / (days.length - 1)) * 710,
    y = (n: number) => 180 - (n / max) * 145;
  return (
    <>
      <div className="analytics-chart-legend">
        <span>
          <i style={{ background: "#21715d" }} />
          Hồ sơ mới
        </span>
        <span>
          <i style={{ background: "#b68c40" }} />
          Duyệt lần đầu ghi nhận
        </span>
      </div>
      <div className="analytics-chart" onMouseLeave={() => setHover(null)}>
        <svg
          viewBox="0 0 800 220"
          role="img"
          aria-label="Hồ sơ mới và bếp duyệt lần đầu theo ngày"
        >
          {[0, 0.5, 1].map((n) => (
            <g key={n}>
              <line
                x1="45"
                x2="755"
                y1={y(n * max)}
                y2={y(n * max)}
                stroke="#e7ede9"
              />
              <text x="36" y={y(n * max) + 4} textAnchor="end">
                <AnimatedValue as="tspan">{Math.round(n * max)}</AnimatedValue>
              </text>
            </g>
          ))}
          {["submitted", "approved"].map((key, j) => (
            <g key={key}>
              <polyline
                points={days.map((d, i) => `${x(i)},${y(d[key])}`).join(" ")}
                fill="none"
                stroke={j ? "#b68c40" : "#21715d"}
                strokeWidth="3"
              />
              {days.length === 1 && (
                <circle
                  cx={x(0)}
                  cy={y(days[0][key])}
                  r="4"
                  fill={j ? "#b68c40" : "#21715d"}
                />
              )}
            </g>
          ))}
          {days.map((d, i) => (
            <g
              key={d.day}
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <title>
                {d.day}: {d.submitted} hồ sơ mới, {d.approved} duyệt mới
              </title>
              <rect
                x={x(i) - 8}
                y="22"
                width="16"
                height="172"
                fill="transparent"
              />
              {(i === 0 ||
                i === days.length - 1 ||
                i % Math.max(1, Math.ceil(days.length / 6)) === 0) && (
                <text x={x(i)} y="211" textAnchor="middle">
                  {d.day.slice(8, 10) + "/" + d.day.slice(5, 7)}
                </text>
              )}
            </g>
          ))}
        </svg>
        {hover !== null && days[hover] && (
          <div className="analytics-chart-tooltip">
            {days[hover].day} · Hồ sơ:{" "}
            <AnimatedValue>{count(days[hover].submitted)}</AnimatedValue> ·
            Duyệt: <AnimatedValue>{count(days[hover].approved)}</AnimatedValue>
          </div>
        )}
      </div>
      <details className="analytics-details">
        <summary>Xem số liệu biểu đồ</summary>
        <Table headers={["Ngày", "Hồ sơ mới", "Duyệt lần đầu", "Lượt gửi lại"]}>
          {days.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>
                <AnimatedValue>{count(d.submitted)}</AnimatedValue>
              </td>
              <td>
                <AnimatedValue>{count(d.approved)}</AnimatedValue>
              </td>
              <td>
                <AnimatedValue>{count(d.resubmitted)}</AnimatedValue>
              </td>
            </tr>
          ))}
        </Table>
      </details>
    </>
  );
}
function Dialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="chefs-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="analytics-block-heading">
        <h2>{title}</h2>
        <Button secondary disabled={busy} onClick={onClose}>
          Đóng
        </Button>
      </div>
      {children}
    </dialog>
  );
}
function Detail({
  id,
  query,
  tab,
  page,
  focus,
  kind,
  payment,
  reviewSort,
  onChange,
  onClose,
  onAction,
  onNavigate,
  revision,
  loadVersion,
}: {
  id: string;
  query: string;
  tab: string;
  page: number;
  focus: string;
  kind: string;
  payment: string;
  reviewSort: string;
  onChange: (patch: Record<string, string>) => void;
  onClose: () => void;
  onAction: (chef: ChefRow, status: string) => void;
  onNavigate: (tab: string, chef?: string) => void;
  revision: number;
  loadVersion: string;
}) {
  const q = new URLSearchParams(query);
  q.set("panel", tab);
  q.set("page", String(page));
  if (focus) q.set("focus", focus);
  q.set("kind", kind);
  q.set("payment", payment);
  q.set("reviewSort", reviewSort);
  const result = useLoad<Row>(
    "admin/chef-analytics/detail/" + encodeURIComponent(id) + "?" + q,
    [revision],
    loadVersion,
  );
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [id]);
  const c: ChefRow | undefined = result.data?.chef;
  const profileOnly =
    !!c && !["approved", "suspended"].includes(c.status) && tab !== "profile";
  useEffect(() => {
    if (profileOnly) onChange({ panel: "profile", dpage: "1" });
  }, [profileOnly, onChange]);
  return (
    <section className="chefs-detail analytics-block" ref={ref}>
      <div className="analytics-block-heading">
        <div>
          <h2>{c?.name || "Chi tiết bếp"}</h2>
          {c && (
            <p>
              {c.owner_name} · {c.email} · {c.phone || "Chưa có số điện thoại"}
            </p>
          )}
        </div>
        <Button secondary onClick={onClose}>
          Đóng hồ sơ
        </Button>
      </div>
      {c && (
        <>
          <div className="chefs-detail-status">
            <ProfileStatus status={c.status} />
            <span className="chefs-operation" data-ready={c.ready}>
              {c.operation}
            </span>
            {c.phone && (
              <a className="text-button" href={"tel:" + c.phone}>
                Gọi chủ bếp
              </a>
            )}
          </div>
          {c.status === "pending" && (
            <div className="actions chefs-review-actions">
              <Button onClick={() => onAction(c, "approved")}>Duyệt</Button>
              <Button secondary onClick={() => onAction(c, "needs_changes")}>
                Yêu cầu bổ sung
              </Button>
              <Button secondary onClick={() => onAction(c, "rejected")}>
                Từ chối
              </Button>
            </div>
          )}
          <nav
            className="dashboard-tabs chefs-detail-tabs"
            aria-label="Chi tiết bếp"
          >
            {Object.entries(CHEF_DETAIL_TABS)
              .filter(
                ([key]) =>
                  ["approved", "suspended"].includes(c.status) ||
                  key === "profile",
              )
              .map(([key, label]) => (
                <button
                  key={key}
                  className={tab === key ? "active" : ""}
                  onClick={() =>
                    onChange({ panel: key, dpage: "1", focus: "" })
                  }
                >
                  {label}
                </button>
              ))}
          </nav>
        </>
      )}
      <BackgroundRefreshNotice loads={[result]} />
      {!result.data || profileOnly ? (
        <Pending error={result.error} retry={result.reload} />
      ) : (
        <>
          {tab === "overview" && (
            <>
              <div className="chefs-detail-metrics">
                {[
                  ["Đơn hoàn thành", count(c!.completed)],
                  ["Doanh số món", money(c!.gmv)],
                  ["Phí giao trên đơn hoàn thành", money(c!.delivery)],
                  ["Đơn đang xử lý", count(c!.active_orders)],
                  [
                    "Trung vị nhận đơn",
                    c!.accept_median === null
                      ? "Chưa có mẫu"
                      : c!.accept_median.toFixed(1) + " phút",
                  ],
                  ["Ngày có thực đơn", count(c!.menu_days)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>
                      <AnimatedValue>{value}</AnimatedValue>
                    </strong>
                  </div>
                ))}
              </div>
              <p className="analytics-footnote">
                Trong kỳ và bữa đã chọn; đơn đang xử lý là hiện tại. Thời gian
                nhận có{" "}
                <AnimatedValue>{count(c!.accept_samples)}</AnimatedValue> mẫu.
              </p>
              <div className="chefs-facts">
                <p>Duyệt đầu tiên ghi nhận: {stamp(c!.approved_at)}</p>
                <p>Đơn trả tiền đầu tiên: {stamp(c!.first_paid_at)}</p>
                <p>Đơn hoàn thành đầu tiên: {stamp(c!.first_completed_at)}</p>
                <p>
                  Từ duyệt đến đơn trả tiền đầu:{" "}
                  {elapsed(c!.approved_at, c!.first_paid_at)}
                </p>
                <p>
                  Từ duyệt đến đơn hoàn thành đầu:{" "}
                  {elapsed(c!.approved_at, c!.first_completed_at)}
                </p>
                <p>Lần có thực đơn gần nhất: {c!.last_menu || "Chưa có"}</p>
                <p>
                  Từ chối bởi chef:{" "}
                  <AnimatedValue>{count(c!.chef_rejected)}</AnimatedValue> /{" "}
                  <AnimatedValue>{count(c!.paid_outcomes)}</AnimatedValue> đơn
                  trả tiền có kết quả trong kỳ{" "}
                  <AnimatedValue>
                    {c!.paid_outcomes
                      ? "(" +
                        pct((c!.chef_rejected / c!.paid_outcomes) * 100) +
                        ")"
                      : ""}
                  </AnimatedValue>
                </p>
                <p>
                  Mua lại tại bếp trong 30 ngày:{" "}
                  <AnimatedValue>
                    {pct(result.data.retention.rate)}
                  </AnimatedValue>{" "}
                  ·{" "}
                  <AnimatedValue>
                    {count(result.data.retention.returned)}
                  </AnimatedValue>{" "}
                  /{" "}
                  <AnimatedValue>
                    {count(result.data.retention.eligible)}
                  </AnimatedValue>{" "}
                  khách đủ 30 ngày
                </p>
              </div>
              {result.data.legacyCompletions > 0 && (
                <Notice>
                  <AnimatedValue>
                    {count(result.data.legacyCompletions)}
                  </AnimatedValue>{" "}
                  đơn cũ dùng thời gian cập nhật thay mốc hoàn thành bị thiếu.
                </Notice>
              )}
              {c!.active_orders > 0 && (
                <Button
                  secondary
                  onClick={() =>
                    onChange({ panel: "orders", focus: "active", dpage: "1" })
                  }
                >
                  Xem đơn đang xử lý
                </Button>
              )}
              <p className="analytics-footnote">
                Mốc đầu tiên và lần có thực đơn gần nhất là toàn thời gian.
                Doanh số món sau voucher, phí giao hiển thị riêng. Ngày có thực
                đơn không đo thời gian bếp mở bán.
              </p>
            </>
          )}
          {tab === "menu" && (
            <>
              <div className="dashboard-tabs">
                <button
                  className={kind === "menu" ? "active" : ""}
                  onClick={() => onChange({ kind: "menu", dpage: "1" })}
                >
                  Thực đơn trong kỳ
                </button>
                <button
                  className={kind === "products" ? "active" : ""}
                  onClick={() => onChange({ kind: "products", dpage: "1" })}
                >
                  Sản phẩm toàn thời gian
                </button>
              </div>
              {result.data.items.length ? (
                <Table
                  headers={
                    kind === "menu"
                      ? [
                          "Món",
                          "Ngày / bữa",
                          "Suất hiện tại",
                          "Giờ ngừng nhận",
                          "Trạng thái",
                        ]
                      : ["Món", "Giá gốc", "Trạng thái", "Đánh giá"]
                  }
                >
                  {result.data.items.map((m: Row) => (
                    <tr key={m.id}>
                      <td>
                        <div className="chefs-dish">
                          <img src={m.image_url || "/icon.svg"} alt="" />
                          <span>{m.name}</span>
                        </div>
                      </td>
                      {kind === "menu" ? (
                        <>
                          <td>
                            {m.service_date}
                            <small>
                              {MEAL_NAMES[
                                m.meal_id as keyof typeof MEAL_NAMES
                              ] || m.meal_id}
                            </small>
                          </td>
                          <td>
                            <AnimatedValue>{count(m.stock)}</AnimatedValue>
                          </td>
                          <td>{stamp(m.cutoff_at)}</td>
                          <td>
                            {!m.active
                              ? "Sản phẩm đã ẩn"
                              : !m.enabled
                                ? "Món bị tắt"
                                : parseUTC(m.cutoff_at) <= new Date()
                                  ? "Đã hết giờ"
                                  : !m.stock
                                    ? "Hết suất"
                                    : !m.is_open
                                      ? "Bếp chưa bật"
                                      : "Còn suất"}
                          </td>
                        </>
                      ) : (
                        <>
                          <td>
                            <AnimatedValue>
                              {money(Number(m.price))}
                            </AnimatedValue>
                          </td>
                          <td>{m.active ? "Đang dùng" : "Đã ẩn"}</td>
                          <td>
                            <AnimatedValue>
                              {Number(m.rating).toFixed(1)}
                            </AnimatedValue>{" "}
                            ★ ·{" "}
                            <AnimatedValue>
                              {count(m.rating_count)}
                            </AnimatedValue>{" "}
                            lượt
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </Table>
              ) : (
                <p className="analytics-empty">Chưa có món phù hợp.</p>
              )}
              <Pager
                data={result.data}
                onPage={(p) => onChange({ dpage: String(p) })}
              />
              <p className="analytics-footnote">
                Suất là dữ liệu hiện tại của bản ghi thực đơn, không phải số
                suất đã bán hoặc lượng suất ban đầu.
              </p>
            </>
          )}
          {tab === "orders" && (
            <>
              <div className="dashboard-tabs">
                <button
                  className={!focus ? "active" : ""}
                  onClick={() => onChange({ focus: "", dpage: "1" })}
                >
                  Đơn tạo trong kỳ
                </button>
                <button
                  className={focus === "active" ? "active" : ""}
                  onClick={() => onChange({ focus: "active", dpage: "1" })}
                >
                  Đang xử lý
                </button>
                <button
                  className={focus === "late" ? "active" : ""}
                  onClick={() => onChange({ focus: "late", dpage: "1" })}
                >
                  Chậm nhận
                </button>
              </div>
              <p className="analytics-footnote">
                {focus
                  ? "Đơn hiện tại ở mọi ngày; áp dụng bữa đã chọn."
                  : "Theo ngày tạo đơn trong kỳ và bữa đã chọn."}
              </p>
              <div className="users-order-counts">
                {result.data.counts.map((s: Row) => (
                  <span
                    className="status"
                    data-status={s.status}
                    key={s.status}
                  >
                    {ORDER_LABELS[s.status] || s.status}:{" "}
                    <AnimatedValue>{count(s.count)}</AnimatedValue>
                  </span>
                ))}
              </div>
              {result.data.items.length ? (
                <Table
                  headers={[
                    "Đơn / món",
                    "Trạng thái",
                    "Tổng thanh toán",
                    "Đặt lúc",
                    "Trả tiền / nhận",
                    "Hủy / từ chối",
                  ]}
                >
                  {result.data.items.map((o: Row) => (
                    <tr key={o.id}>
                      <td>
                        <Link className="text-button" href={"/orders/" + o.id}>
                          {o.code}
                        </Link>
                        <small>{o.summary}</small>
                      </td>
                      <td>
                        <OrderStatus value={o.status} />
                      </td>
                      <td>
                        <AnimatedValue>{money(Number(o.total))}</AnimatedValue>
                      </td>
                      <td>{stamp(o.created_at)}</td>
                      <td>
                        {stamp(o.paid_at)}
                        <small>Nhận: {stamp(o.accepted_at)}</small>
                      </td>
                      <td>
                        {o.status === "EXPIRED"
                          ? "Hết hạn thanh toán"
                          : o.chef_rejected
                            ? "Chef từ chối"
                            : o.user_cancelled
                              ? "Khách hủy"
                              : o.other_cancelled
                                ? "Admin / tác nhân khác"
                                : ["CANCELLED", "REJECTED"].includes(o.status)
                                  ? "Chưa có dữ liệu người thực hiện"
                                  : "—"}
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <p className="analytics-empty">Không có đơn phù hợp.</p>
              )}
              <Pager
                data={result.data}
                onPage={(p) => onChange({ dpage: String(p) })}
              />
              <p className="analytics-footnote">
                Thời gian trạng thái do chef/khách cập nhật; chưa có dữ liệu để
                kết luận giao đúng hạn.
              </p>
            </>
          )}
          {tab === "customers" && (
            <>
              <div className="chefs-detail-metrics">
                {[
                  ["Khách mua trong kỳ", result.data.buyers.buyers],
                  ["Khách mua lần đầu tại bếp", result.data.buyers.new_buyers],
                  [
                    "Khách mua lại tại bếp",
                    result.data.buyers.returning_buyers,
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>
                      <AnimatedValue>{count(value)}</AnimatedValue>
                    </strong>
                  </div>
                ))}
              </div>
              <p className="analytics-footnote">
                Theo đơn hoàn thành tại chính bếp. Một khách có thể vừa mua lần
                đầu vừa mua lại trong kỳ.
              </p>
              <div className="chefs-rating-summary">
                <span>
                  Trọn đời:{" "}
                  <AnimatedValue>{c!.rating.toFixed(1)}</AnimatedValue> ★ ·{" "}
                  <AnimatedValue>{count(c!.rating_count)}</AnimatedValue> lượt
                </span>
                <span>
                  Trong kỳ:{" "}
                  <AnimatedValue>
                    {result.data.ratings.reduce(
                      (n: number, r: Row) => n + Number(r.count),
                      0,
                    )}
                  </AnimatedValue>{" "}
                  lượt
                </span>
                {[5, 4, 3, 2, 1].map((star) => (
                  <span key={star}>
                    {star} ★:{" "}
                    <AnimatedValue>
                      {count(
                        result.data!.ratings.find(
                          (r: Row) => Number(r.rating) === star,
                        )?.count,
                      )}
                    </AnimatedValue>
                  </span>
                ))}
              </div>
              <Field label="Sắp xếp đánh giá">
                <select
                  value={reviewSort}
                  onChange={(e) =>
                    onChange({ reviewSort: e.target.value, dpage: "1" })
                  }
                >
                  <option value="recent">Mới nhất</option>
                  <option value="highest">Rating cao đến thấp</option>
                  <option value="lowest">Rating thấp đến cao</option>
                </select>
              </Field>
              {result.data.items.length ? (
                <Table
                  headers={[
                    "Người đánh giá",
                    "Rating",
                    "Món / đơn",
                    "Nội dung",
                    "Thời gian",
                  ]}
                >
                  {result.data.items.map((r: Row) => (
                    <tr key={r.id}>
                      <td>{r.user_name}</td>
                      <td>
                        <AnimatedValue>{r.rating}</AnimatedValue> ★
                      </td>
                      <td>
                        {r.dishes}
                        <small>{r.code}</small>
                      </td>
                      <td>{r.body || "Không có nội dung"}</td>
                      <td>{stamp(r.created_at)}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <p className="analytics-empty">
                  Chưa có đánh giá trong kỳ và bữa đã chọn.
                </p>
              )}
              <Pager
                data={result.data}
                onPage={(p) => onChange({ dpage: String(p) })}
              />
            </>
          )}
          {tab === "payments" && (
            <>
              <p className="analytics-footnote">
                Yêu cầu toàn thời gian, áp dụng bữa đã chọn để giữ các tồn đọng
                cũ.
              </p>
              <div className="dashboard-tabs">
                {[
                  ["all", "Tất cả"],
                  ["OPEN", "Chờ chef"],
                  ["REVIEW", "Chờ admin"],
                  ["RESOLVED", "Đã xử lý"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={payment === value ? "active" : ""}
                    onClick={() => onChange({ payment: value, dpage: "1" })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {result.data.items.length ? (
                <Table
                  headers={[
                    "Đơn",
                    "Yêu cầu / số tiền",
                    "Trạng thái",
                    "Liên hệ",
                    "Bằng chứng / thời gian",
                  ]}
                >
                  {result.data.items.map((r: Row) => (
                    <tr key={r.id}>
                      <td>
                        <Link
                          className="text-button"
                          href={"/orders/" + r.order_id}
                        >
                          {r.code}
                        </Link>
                      </td>
                      <td>
                        {PAYMENT_REQUEST_KINDS[r.kind] || r.kind}
                        <small>
                          <AnimatedValue>
                            {money(Number(r.amount))}
                          </AnimatedValue>
                        </small>
                      </td>
                      <td>
                        <span className="status" data-status={r.status}>
                          {PAYMENT_REQUEST_STATUSES[r.status] || r.status}
                        </span>
                      </td>
                      <td>
                        {r.contact_phone ? (
                          <a
                            className="text-button"
                            href={"tel:" + r.contact_phone}
                          >
                            {r.contact_phone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {r.evidence_asset_id && (
                          <a
                            className="text-button"
                            href={"/api/files/" + r.evidence_asset_id}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Xem bằng chứng
                          </a>
                        )}
                        <small>{r.resolution_note}</small>
                        <small>Gửi: {stamp(r.created_at)}</small>
                        {r.submitted_at && (
                          <small>Chef nộp: {stamp(r.submitted_at)}</small>
                        )}
                        {r.reviewed_at && (
                          <small>Admin xem: {stamp(r.reviewed_at)}</small>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <p className="analytics-empty">Không có yêu cầu phù hợp.</p>
              )}
              <Pager
                data={result.data}
                onPage={(p) => onChange({ dpage: String(p) })}
              />
              <Button secondary onClick={() => onNavigate("payments", id)}>
                Mở quản lý đối soát
              </Button>
            </>
          )}
          {tab === "profile" && (
            <>
              <div className="chefs-facts">
                <p>Địa chỉ: {c!.address || "Chưa có"}</p>
                <p>
                  Bán kính giao: <AnimatedValue>{c!.radius_km}</AnimatedValue>{" "}
                  km
                </p>
                <p>{c!.bio}</p>
                <p>Gửi gần nhất: {stamp(c!.submitted_at)}</p>
                <p>
                  Ngân hàng: {c!.bank_name || "Chưa cấu hình"} ·{" "}
                  {c!.account_no || ""} · {c!.account_name || ""}
                </p>
                <p>
                  SePay:{" "}
                  {result.data.sepay.enabled && result.data.sepay.configured
                    ? "Đã bật và có key cấu hình"
                    : "Chưa bật / chưa có key"}{" "}
                  · Webhook gần nhất:{" "}
                  {stamp(result.data.sepay.last_received_at)}
                </p>
              </div>
              {c!.rejection_reason && <Notice>{c!.rejection_reason}</Notice>}
              <h3 className="users-subheading">Tài liệu xác minh</h3>
              {result.data.assets.length ? (
                result.data.assets.map((a: Row) => (
                  <p key={a.id}>
                    <a
                      className="text-button"
                      href={"/api/files/" + a.id}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {a.original_name}
                    </a>{" "}
                    <small>{stamp(a.created_at)}</small>
                  </p>
                ))
              ) : (
                <p className="analytics-empty">Chưa có tài liệu.</p>
              )}
              <h3 className="users-subheading">Lịch sử hồ sơ gần nhất</h3>
              {result.data.history.length ? (
                <Table
                  headers={[
                    "Thời gian",
                    "Thao tác",
                    "Người thực hiện",
                    "Nội dung",
                  ]}
                >
                  {result.data.history.map((h: Row) => (
                    <tr key={h.id}>
                      <td>{stamp(h.created_at)}</td>
                      <td>
                        {h.action === "chef.application"
                          ? "Gửi hồ sơ"
                          : "Cập nhật hồ sơ"}
                      </td>
                      <td>{h.actor_name || "Hệ thống"}</td>
                      <td>
                        {h.detail?.status ? (
                          <ProfileStatus status={h.detail.status} />
                        ) : h.detail?.resubmitted ? (
                          "Gửi lại"
                        ) : (
                          "Đăng ký mới"
                        )}
                        <small>{h.detail?.reason}</small>
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <p className="analytics-empty">
                  Chưa có lịch sử được ghi nhận.
                </p>
              )}
              <p className="analytics-footnote">
                Hiển thị tối đa 100 sự kiện hồ sơ gần nhất. Trạng thái cấu hình
                SePay không xác nhận ngân hàng đang đồng bộ.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}

export function AdminChefs({
  onNavigate,
}: {
  onNavigate: (tab: string, chef?: string, orderFilter?: string) => void;
}) {
  const params = useSearchParams(),
    router = useRouter(),
    { revision, refresh, toast } = useApp(),
    [manual, setManual] = useState(0),
    [tick, setTick] = useState(0),
    [topMetric, setTopMetric] = useState("gmv"),
    [action, setAction] = useState<{ chef: ChefRow; status: string } | null>(
      null,
    ),
    [settings, setSettings] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const q = new URLSearchParams();
  for (const key of [
    "from",
    "to",
    "region",
    "meal",
    "q",
    "status",
    "group",
    "sort",
    "view",
    "page",
  ]) {
    const v = params.get("c" + key);
    if (v) q.set(key, v);
  }
  const loadVersion = String(revision) + ":" + String(manual);
  const selected = params.get("chef"),
    query = q.toString(),
    reportQ = new URLSearchParams(q);
  for (const key of ["status", "group", "sort", "view", "page"])
    reportQ.delete(key);
  const summary = useLoad<Row>(
      "admin/chef-analytics/summary?" + reportQ,
      [revision, manual, tick],
      loadVersion,
    ),
    trends = useLoad<Row>(
      selected ? null : "admin/chef-analytics/trends?" + reportQ,
      [revision, manual],
      loadVersion,
    ),
    operations = useLoad<Row>(
      selected ? null : "admin/chef-analytics/operations?" + reportQ,
      [revision, manual, tick],
      loadVersion,
    ),
    list = useLoad<Row>(
      selected ? null : "admin/chef-analytics/list?" + query,
      [revision, manual, tick],
      loadVersion,
    );
  const today = serviceDate(),
    panel = params.get("cpanel") || "overview",
    view = q.get("view") || "list",
    group = q.get("group") || "all",
    status = q.get("status") || "all";
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (list.data && Number(q.get("page") || 1) !== list.data.page) {
      const p = new URLSearchParams(params.toString());
      p.set("cpage", String(list.data.page));
      router.replace("/admin?" + p, { scroll: false });
    }
  }, [list.data, query, params, router]);
  function apply(patch: Record<string, string>, keepDetail = false) {
    const p = new URLSearchParams(params.toString());
    p.set("tab", "chefs");
    if (!Object.hasOwn(patch, "page")) p.delete("cpage");
    for (const [k, v] of Object.entries(patch)) {
      if (v && v !== "all") p.set("c" + k, v);
      else p.delete("c" + k);
    }
    if (!keepDetail) {
      p.delete("chef");
      for (const key of [
        "panel",
        "dpage",
        "focus",
        "kind",
        "payment",
        "reviewSort",
      ])
        p.delete("c" + key);
    }
    router.push("/admin?" + p, { scroll: false });
  }
  function open(
    id: string,
    tab = "overview",
    focus = "",
    payment = "all",
    kind = "menu",
  ) {
    const p = new URLSearchParams(params.toString());
    p.set("tab", "chefs");
    p.set("chef", id);
    p.set("cpanel", tab);
    p.delete("cdpage");
    p.delete("cfocus");
    p.delete("cpayment");
    p.delete("ckind");
    p.delete("creviewSort");
    if (kind !== "menu") p.set("ckind", kind);
    if (focus) p.set("cfocus", focus);
    if (payment !== "all") p.set("cpayment", payment);
    router.push("/admin?" + p, { scroll: false });
  }
  function detailChange(patch: Record<string, string>) {
    apply({ ...patch, page: q.get("page") || "1" }, true);
  }
  function runAction(chef: ChefRow, status: string) {
    setError("");
    setAction({ chef, status });
  }
  async function saveAction(reason: string) {
    if (!action || busy) return;
    setBusy(true);
    setError("");
    try {
      await post("admin/chefs/" + action.chef.id, {
        status: action.status,
        reason,
      });
      setAction(null);
      setManual(Date.now());
      refresh();
      toast("Đã cập nhật hồ sơ bếp.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const cards = [
    [
      "total",
      "Tổng hồ sơ",
      ChefHat,
      "Toàn bộ hồ sơ",
      { view: "list", status: "all", group: "all" },
    ],
    [
      "pending",
      "Chờ duyệt",
      Clock,
      "Hiện tại",
      { view: "approvals", status: "pending", group: "all" },
    ],
    [
      "approved",
      "Đã duyệt",
      CheckCircle2,
      "Trạng thái hiện tại",
      { view: "list", status: "approved", group: "all" },
    ],
    [
      "ready",
      "Đang nhận đơn",
      Utensils,
      "Đủ điều kiện bán hiện tại",
      { view: "list", status: "approved", group: "ready" },
    ],
    [
      "sales",
      "Có đơn hoàn thành",
      ShoppingBag,
      "Trong kỳ và bữa đã chọn",
      { view: "list", status: "all", group: "sales" },
    ],
    [
      "new",
      "Duyệt mới ghi nhận",
      UserPlus,
      "Lần duyệt đầu ghi nhận trong kỳ",
      { view: "list", status: "all", group: "new" },
    ],
    [
      "suspended",
      "Tạm ngưng",
      PauseCircle,
      "Hiện tại",
      { view: "list", status: "suspended", group: "all" },
    ],
    [
      "attention",
      "Cần chú ý",
      TriangleAlert,
      "Bếp có ít nhất một cảnh báo",
      { view: "list", status: "all", group: "attention" },
    ],
  ] as const;
  return (
    <div className="admin-chefs analytics-overview">
      <BackgroundRefreshNotice loads={[summary, operations, trends, list]} />
      <div className="analytics-toolbar">
        <div className="analytics-presets">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              className={
                (q.get("from") || shiftDate(today, -29)) ===
                  shiftDate(today, 1 - days) && (q.get("to") || today) === today
                  ? "active"
                  : ""
              }
              onClick={() =>
                apply(
                  { from: shiftDate(today, 1 - days), to: today },
                  !!selected,
                )
              }
            >
              <AnimatedValue>{days}</AnimatedValue> ngày
            </button>
          ))}
        </div>
        <div className="analytics-toolbar-actions">
          <Button
            secondary
            onClick={() => {
              setManual(Date.now());
            }}
          >
            <RefreshCw size={16} /> Làm mới bếp
          </Button>
          <Button
            secondary
            disabled={!summary.data}
            onClick={() => {
              setError("");
              setSettings(true);
            }}
          >
            <Settings size={16} /> Ngưỡng cảnh báo
          </Button>
        </div>
      </div>
      <form
        className="analytics-filters chefs-filters"
        key={[
          q.get("from"),
          q.get("to"),
          q.get("region"),
          q.get("meal"),
          q.get("q"),
        ].join("|")}
        onSubmit={(e) => {
          e.preventDefault();
          apply(
            Object.fromEntries(
              Array.from(new FormData(e.currentTarget).entries()).map(
                ([k, v]) => [k, String(v)],
              ),
            ),
            !!selected,
          );
        }}
      >
        <Field label="Từ ngày">
          <input
            name="from"
            type="date"
            required
            max={today}
            defaultValue={q.get("from") || shiftDate(today, -29)}
          />
        </Field>
        <Field label="Đến ngày">
          <input
            name="to"
            type="date"
            required
            max={today}
            defaultValue={q.get("to") || today}
          />
        </Field>
        <Field label="Khu vực bếp">
          <select name="region" defaultValue={q.get("region") || ""}>
            <option value="">Tất cả khu vực</option>
            {summary.data?.regions.map((r: Row) => (
              <option value={r.id} key={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bữa ăn">
          <select name="meal" defaultValue={q.get("meal") || ""}>
            <option value="">Tất cả bữa</option>
            {Object.entries(MEAL_NAMES).map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tìm bếp">
          <input
            name="q"
            type="search"
            maxLength={100}
            placeholder="Bếp, chủ, email, số điện thoại"
            defaultValue={q.get("q") || ""}
          />
        </Field>
        <Button type="submit">
          <Search size={16} /> Áp dụng
        </Button>
      </form>
      <p className="analytics-footnote">
        Ngày theo giờ Việt Nam. Khu vực là vị trí bếp. Bữa áp dụng cho đơn, thực
        đơn và vận hành; tổng hồ sơ/trạng thái duyệt vẫn gồm bếp chưa có thực
        đơn.
      </p>
      {selected ? (
        <Detail
          id={selected}
          query={reportQ.toString()}
          tab={panel}
          page={Number(params.get("cdpage") || 1)}
          focus={params.get("cfocus") || ""}
          kind={params.get("ckind") || "menu"}
          payment={params.get("cpayment") || "all"}
          reviewSort={params.get("creviewSort") || "recent"}
          revision={revision + manual + tick}
          loadVersion={loadVersion}
          onChange={detailChange}
          onClose={() => apply({ page: q.get("page") || "1" })}
          onAction={runAction}
          onNavigate={onNavigate}
        />
      ) : (
        <>
          {!summary.data ? (
            <Pending error={summary.error} retry={summary.reload} />
          ) : (
            <>
              <div className="analytics-kpis chefs-kpis">
                {cards.map(([key, label, Icon, hint, patch]) => (
                  <button
                    key={key}
                    className="analytics-kpi users-kpi"
                    onClick={() => apply({ ...patch })}
                    aria-pressed={
                      group === "all"
                        ? key === "total"
                          ? status === "all"
                          : key === status
                        : group === key
                    }
                  >
                    <span className="analytics-kpi-label">
                      {label}
                      <Icon size={18} />
                    </span>
                    <strong>
                      <AnimatedValue>
                        {count(summary.data!.metrics[key])}
                      </AnimatedValue>
                    </strong>
                    <small>{hint}</small>
                    <span className="users-filter-hint">
                      Lọc danh sách <ChevronRight size={12} />
                    </span>
                  </button>
                ))}
              </div>
              <p className="analytics-footnote">
                Kích hoạt trong {summary.data.activation.days} ngày từ duyệt:{" "}
                <AnimatedValue>
                  {pct(summary.data.activation.rate)}
                </AnimatedValue>{" "}
                ·{" "}
                <AnimatedValue>
                  {count(summary.data.activation.activated)}
                </AnimatedValue>
                /
                <AnimatedValue>
                  {count(summary.data.activation.eligible)}
                </AnimatedValue>{" "}
                bếp đủ thời gian trong nhóm duyệt của kỳ;{" "}
                <AnimatedValue>
                  {count(summary.data.activation.waiting)}
                </AnimatedValue>{" "}
                bếp đang chờ đủ thời gian.{" "}
                <AnimatedValue>
                  {count(summary.data.activation.unknown)}
                </AnimatedValue>{" "}
                hồ sơ thiếu mốc duyệt hợp lệ. Chỉ số nhận đơn và cảnh báo là
                hiện tại.
              </p>
            </>
          )}
          <Block
            title="Bếp cần theo dõi"
            caption="Tồn đọng hiện tại không giới hạn ngày tạo. Bấm để mở đúng hồ sơ, đơn hoặc đối soát."
          >
            {!operations.data ? (
              <Pending error={operations.error} retry={operations.reload} />
            ) : operations.data.alerts.length ? (
              <>
                <div className="chefs-alerts">
                  {operations.data.alerts.map((a: Row) => (
                    <button
                      key={a.chefId + a.key}
                      className="chefs-alert"
                      data-priority={a.priority}
                      onClick={() =>
                        open(
                          a.chefId,
                          a.detailTab,
                          a.key === "late" ? "late" : "",
                          a.key === "refund_open"
                            ? "OPEN"
                            : a.key === "refund_review"
                              ? "REVIEW"
                              : "all",
                        )
                      }
                    >
                      <span>
                        <strong>{a.chefName}</strong>
                        <small>
                          {a.label} ·{" "}
                          <AnimatedValue>{count(a.count)}</AnimatedValue>
                          {a.key === "late" && a.oldestPaidAt
                            ? " · Trả tiền từ " + stamp(a.oldestPaidAt)
                            : ""}
                          {a.key.startsWith("refund") && a.refundOverdue
                            ? " · Có yêu cầu quá hạn"
                            : ""}
                          <AnimatedValue>
                            {a.waitingSince
                              ? " · Chờ " +
                                Math.max(
                                  0,
                                  (Date.now() -
                                    parseUTC(a.waitingSince).getTime()) /
                                    3600000,
                                ).toFixed(1) +
                                " giờ"
                              : ""}
                          </AnimatedValue>
                        </small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </div>
                <p className="analytics-footnote">
                  <AnimatedValue>{count(operations.data.chefs)}</AnimatedValue>{" "}
                  bếp ·{" "}
                  <AnimatedValue>{count(operations.data.total)}</AnimatedValue>{" "}
                  loại cảnh báo. Hiển thị tối đa 30 cảnh báo ưu tiên.
                </p>
              </>
            ) : (
              <p className="analytics-empty">
                Không có cảnh báo trong phạm vi đã chọn.
              </p>
            )}
          </Block>
          <div className="analytics-grid analytics-chart-grid">
            <Block
              title="Tăng trưởng bếp"
              caption="Hồ sơ mới theo lần đăng ký đầu; hồ sơ gửi lại không cộng thành chef mới."
            >
              {!trends.data ? (
                <Pending error={trends.error} retry={trends.reload} />
              ) : (
                <GrowthChart days={trends.data.days} />
              )}
            </Block>
            <Block
              title="Hiệu quả bán hàng"
              caption="Đơn hoàn thành trong kỳ; doanh số món sau voucher."
            >
              <Field label="Xếp hạng bếp">
                <select
                  value={topMetric}
                  onChange={(e) => setTopMetric(e.target.value)}
                >
                  <option value="gmv">Doanh số món</option>
                  <option value="completed">Đơn hoàn thành</option>
                </select>
              </Field>
              {!trends.data ? (
                <Pending error={trends.error} retry={trends.reload} />
              ) : (
                <div className="chefs-top-chart">
                  {(topMetric === "gmv"
                    ? trends.data.topSales
                    : trends.data.topOrders
                  ).length ? (
                    (topMetric === "gmv"
                      ? trends.data.topSales
                      : trends.data.topOrders
                    ).map((c: Row, i: number, all: Row[]) => (
                      <button key={c.id} onClick={() => open(c.id)}>
                        <span>
                          {c.name}
                          <strong>
                            <AnimatedValue>
                              {topMetric === "gmv"
                                ? money(Number(c.gmv))
                                : count(c.completed) + " đơn"}
                            </AnimatedValue>
                          </strong>
                        </span>
                        <span className="users-group-track">
                          <i
                            style={{
                              width:
                                Math.max(
                                  1,
                                  (c[topMetric] /
                                    Math.max(1, all[0][topMetric])) *
                                    100,
                                ) + "%",
                              background: "#21715d",
                            }}
                          />
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="analytics-empty">
                      Chưa có bếp có đơn hoàn thành trong kỳ.
                    </p>
                  )}
                </div>
              )}
            </Block>
          </div>
          <Block
            title={view === "approvals" ? "Duyệt hồ sơ" : "Danh sách bếp"}
            caption="Thông tin hồ sơ/vận hành là hiện tại; đơn và doanh số theo kỳ. Rating trọn đời có số mẫu."
          >
            <div className="dashboard-tabs">
              <button
                className={view === "list" ? "active" : ""}
                onClick={() =>
                  apply({ view: "list", status: "all", group: "all" })
                }
              >
                Danh sách bếp
              </button>
              <button
                className={view === "approvals" ? "active" : ""}
                onClick={() =>
                  apply({ view: "approvals", status: "pending", group: "all" })
                }
              >
                Duyệt hồ sơ (
                <AnimatedValue>
                  {count(summary.data?.metrics.pending)}
                </AnimatedValue>
                )
              </button>
            </div>
            <div className="users-list-filters">
              <Field label="Trạng thái hồ sơ">
                <select
                  value={status}
                  onChange={(e) =>
                    apply({ status: e.target.value, group: "all" })
                  }
                >
                  {Object.entries(CHEF_STATUSES)
                    .filter(
                      ([key]) =>
                        view !== "approvals" ||
                        [
                          "all",
                          "pending",
                          "needs_changes",
                          "rejected",
                        ].includes(key),
                    )
                    .map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Nhóm bếp">
                <select
                  value={group}
                  onChange={(e) => apply({ group: e.target.value })}
                >
                  {Object.entries(CHEF_GROUPS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sắp xếp bếp">
                <select
                  value={q.get("sort") || "newest"}
                  onChange={(e) => apply({ sort: e.target.value })}
                >
                  {Object.entries(CHEF_SORTS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                className="text-button"
                onClick={() =>
                  apply({
                    status: "all",
                    group: "all",
                    view: "list",
                    sort: "newest",
                  })
                }
              >
                Xóa bộ lọc danh sách
              </button>
            </div>
            {!list.data ? (
              <Pending error={list.error} retry={list.reload} />
            ) : (
              <>
                <p className="analytics-meta">
                  <AnimatedValue>{count(list.data.total)}</AnimatedValue> bếp
                  phù hợp
                </p>
                <p className="users-table-hint">
                  Vuốt ngang để xem đầy đủ chỉ số và thao tác.
                </p>
                {list.data.chefs.length ? (
                  <div className="analytics-table-wrap">
                    <table className="analytics-table chefs-table">
                      <thead>
                        <tr>
                          {[
                            "Bếp / chủ",
                            "Hồ sơ / vận hành",
                            "Món nhận được đơn",
                            "Đơn hoàn thành",
                            "Doanh số món",
                            "Đánh giá",
                            "Theo dõi",
                            "Thao tác",
                          ].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {list.data.chefs.map((c: ChefRow) => (
                          <tr key={c.id}>
                            <td>
                              <div className="chefs-identity">
                                <img src={c.avatar_url || "/icon.svg"} alt="" />
                                <div>
                                  {["approved", "suspended"].includes(
                                    c.status,
                                  ) ? (
                                    <button
                                      className="text-button"
                                      onClick={() => open(c.id)}
                                    >
                                      {c.name}
                                    </button>
                                  ) : (
                                    <span>{c.name}</span>
                                  )}
                                  <small>
                                    {c.owner_name} ·{" "}
                                    {c.area || "Chưa có khu vực"}
                                  </small>
                                  <small>{c.email}</small>
                                  <small>
                                    {c.phone || "Chưa có số điện thoại"}
                                  </small>
                                </div>
                              </div>
                              {c.rejection_reason && (
                                <small>{c.rejection_reason}</small>
                              )}
                            </td>
                            <td>
                              <ProfileStatus status={c.status} />
                              <span
                                className="chefs-operation"
                                data-ready={c.ready}
                              >
                                {c.operation}
                              </span>
                            </td>
                            <td>
                              <AnimatedValue>
                                {count(c.ready ? c.dishes : 0)}
                              </AnimatedValue>
                              <small>
                                <AnimatedValue>
                                  {count(c.ready ? c.servings : 0)}
                                </AnimatedValue>{" "}
                                suất hiện tại
                              </small>
                            </td>
                            <td>
                              <AnimatedValue>
                                {count(c.completed)}
                              </AnimatedValue>
                            </td>
                            <td>
                              <AnimatedValue>{money(c.gmv)}</AnimatedValue>
                            </td>
                            <td>
                              <AnimatedValue>
                                {c.rating_count
                                  ? c.rating.toFixed(1) + " ★"
                                  : "Chưa có"}
                              </AnimatedValue>
                              <small>
                                <AnimatedValue>
                                  {count(c.rating_count)}
                                </AnimatedValue>{" "}
                                lượt
                              </small>
                            </td>
                            <td>
                              {c.alerts.length
                                ? c.alerts.map((a) => (
                                    <span
                                      className="chefs-alert-tag"
                                      key={a.key}
                                    >
                                      {a.label}:{" "}
                                      <AnimatedValue>
                                        {count(a.count)}
                                      </AnimatedValue>
                                    </span>
                                  ))
                                : "—"}
                            </td>
                            <td>
                              <div className="chefs-row-actions">
                                {c.status === "pending" ? (
                                  <>
                                    <Button
                                      secondary
                                      onClick={() => open(c.id, "profile")}
                                    >
                                      Xem yêu cầu
                                    </Button>
                                    <Button
                                      onClick={() => runAction(c, "approved")}
                                    >
                                      Duyệt
                                    </Button>
                                    <Button
                                      secondary
                                      onClick={() =>
                                        runAction(c, "needs_changes")
                                      }
                                    >
                                      Bổ sung
                                    </Button>
                                    <Button
                                      secondary
                                      onClick={() => runAction(c, "rejected")}
                                    >
                                      Từ chối
                                    </Button>
                                  </>
                                ) : ["approved", "suspended"].includes(
                                    c.status,
                                  ) ? (
                                  <>
                                    <Button
                                      secondary
                                      onClick={() => open(c.id, "profile")}
                                    >
                                      Hồ sơ
                                    </Button>
                                    <Button
                                      secondary
                                      onClick={() => {
                                        open(
                                          c.id,
                                          "menu",
                                          "",
                                          "all",
                                          "products",
                                        );
                                      }}
                                    >
                                      Sản phẩm
                                    </Button>
                                    <Button
                                      secondary
                                      onClick={() => open(c.id, "orders")}
                                    >
                                      Đơn & doanh số
                                    </Button>
                                    <Button
                                      secondary
                                      onClick={() =>
                                        runAction(
                                          c,
                                          c.status === "suspended"
                                            ? "approved"
                                            : "suspended",
                                        )
                                      }
                                    >
                                      {c.status === "suspended"
                                        ? "Mở lại"
                                        : "Tạm ngưng"}
                                    </Button>
                                  </>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="analytics-empty">Không có bếp phù hợp.</p>
                )}
                <Pager
                  data={list.data}
                  onPage={(page) => apply({ page: String(page) })}
                />
              </>
            )}
          </Block>
        </>
      )}
      {action && (
        <Dialog
          title={
            (action.status === "approved"
              ? "Duyệt / mở lại"
              : action.status === "needs_changes"
                ? "Yêu cầu bổ sung"
                : action.status === "rejected"
                  ? "Từ chối"
                  : "Tạm ngưng") +
            " · " +
            action.chef.name
          }
          busy={busy}
          onClose={() => setAction(null)}
        >
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveAction(
                String(new FormData(e.currentTarget).get("reason") || ""),
              );
            }}
          >
            {action.status === "approved" ? (
              <p>
                Kiểm tra thông tin và giấy tờ bếp trước khi duyệt. Bếp cần tự
                bật và tạo thực đơn để nhận đơn.
              </p>
            ) : (
              <Field label="Lý do">
                <textarea
                  name="reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  placeholder="Nội dung gửi cho chef"
                />
              </Field>
            )}
            {error && <Notice error>{error}</Notice>}
            <Button type="submit" disabled={busy}>
              {busy ? "Đang lưu…" : "Xác nhận"}
            </Button>
          </form>
        </Dialog>
      )}
      {settings && summary.data && (
        <Dialog
          title="Ngưỡng theo dõi bếp"
          busy={busy}
          onClose={() => setSettings(false)}
        >
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                await post(
                  "admin/chef-analytics/settings",
                  Object.fromEntries(
                    Array.from(data.entries()).map(([k, v]) => [k, Number(v)]),
                  ),
                );
                setSettings(false);
                setManual(Date.now());
                refresh();
                toast("Đã lưu ngưỡng cảnh báo.");
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {[
              ["activationDays", "Chưa có đơn đầu sau số ngày", 1, 90, 1],
              ["lowRating", "Rating thấp hơn", 1, 5, 0.1],
              ["minReviews", "Số đánh giá tối thiểu", 1, 1000, 1],
              ["rejectRate", "Tỷ lệ từ chối vượt (%)", 0, 100, 0.1],
              ["minPaid", "Đơn đã trả tiền có kết quả tối thiểu", 1, 10000, 1],
            ].map(([key, label, min, max, step]) => (
              <Field key={key} label={String(label)}>
                <input
                  type="number"
                  name={String(key)}
                  min={Number(min)}
                  max={Number(max)}
                  step={Number(step)}
                  required
                  defaultValue={summary.data!.thresholds[key]}
                />
              </Field>
            ))}
            <p className="analytics-footnote">
              Ngưỡng nhận đơn, duyệt hồ sơ và đối soát dùng SLA ở Tổng quan:{" "}
              <AnimatedValue>{summary.data.sla.acceptMinutes}</AnimatedValue>{" "}
              phút /{" "}
              <AnimatedValue>{summary.data.sla.profileHours}</AnimatedValue> giờ
              / <AnimatedValue>{summary.data.sla.refundHours}</AnimatedValue>{" "}
              giờ. Cảnh báo để theo dõi; không tự tạm ngưng bếp.
            </p>
            {error && <Notice error>{error}</Notice>}
            <Button type="submit" disabled={busy}>
              {busy ? "Đang lưu…" : "Lưu ngưỡng"}
            </Button>
          </form>
        </Dialog>
      )}
      <p className="analytics-footnote">
        Bếp chưa mở không mặc nhiên vi phạm lịch làm việc. Dữ liệu mốc duyệt cũ
        có thể thiếu; giờ cập nhật đơn chưa đo giao đúng hạn. Báo cáo lịch sử
        cache tối đa 20 giây, cảnh báo tự làm mới mỗi phút khi tab đang hiển
        thị.
      </p>
    </div>
  );
}
