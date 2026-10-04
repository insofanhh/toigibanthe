"use client";
import { AnimatedValue } from "./animated-value";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Utensils,
  CheckCircle2,
  ShoppingBag,
  ChartNoAxesColumn,
  Wallet,
  Plus,
  TriangleAlert,
  RefreshCw,
  Search,
  Settings,
  ChevronRight,
} from "lucide-react";
import { Button, Field, Notice, useLoad } from "./app";
import { useApp, post } from "./providers";
import { Link } from "./page-motion";
import {
  count,
  stamp,
  ReportBlock as Block,
  ReportTable as Table,
  ReportPending as Pending,
  ReportPager as Pager,
  ReportDialog as Dialog,
  SalesChart,
  type ReportRow as R,
} from "./admin-report-ui";
import {
  PRODUCT_GROUPS,
  PRODUCT_PANELS,
  PRODUCT_SORTS,
  PRODUCT_STATUSES,
  PRODUCT_VIEWS,
  type ProductRow,
} from "@/lib/admin-products-domain";
import {
  serviceDate,
  money,
  MEAL_NAMES,
  ORDER_LABELS,
  parseUTC,
  PAYMENT_REQUEST_STATUSES,
} from "@/lib/domain";
import { shiftDate } from "@/lib/analytics-domain";
function State({ p }: { p: ProductRow }) {
  return (
    <>
      <span
        className="product-status"
        data-state={p.missing ? "missing" : p.active ? "active" : "hidden"}
      >
        {p.missing ? "Thiếu liên kết" : p.active ? "Đang bật" : "Đã ẩn"}
      </span>
      <span
        className="product-operation"
        data-state={
          p.ready
            ? "ready"
            : p.operation === "Không còn suất khả dụng"
              ? "stock"
              : p.active &&
                  !p.missing &&
                  (p.chef_status !== "approved" ||
                    !p.owner_active ||
                    !p.bank_ready)
                ? "blocked"
                : "idle"
        }
      >
        {p.operation}
      </span>
    </>
  );
}
function Identity({ p, onOpen }: { p: R; onOpen: () => void }) {
  return (
    <div className="products-identity">
      <img src={p.image_url || "/icon.svg"} alt="" loading="lazy" />
      <div>
        <button className="text-button" onClick={onOpen}>
          {p.name}
        </button>
        <small>{p.chef_name || "Bếp không còn liên kết"}</small>
        <small>{p.area}</small>
      </div>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <span>{label}</span>
      <strong>
        <AnimatedValue>{value}</AnimatedValue>
      </strong>
    </div>
  );
}
function ProductDetail({
  id,
  query,
  panel,
  page,
  focus,
  dateBy,
  reviewSort,
  version,
  tick,
  onChange,
  onClose,
  onAction,
  onNavigate,
}: {
  id: string;
  query: string;
  panel: string;
  page: number;
  focus: string;
  dateBy: string;
  reviewSort: string;
  version: string;
  tick: number;
  onChange: (p: Record<string, string>) => void;
  onClose: () => void;
  onAction: (p: ProductRow) => void;
  onNavigate: (t: string, chef?: string) => void;
}) {
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    detailRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [id]);
  const q = new URLSearchParams(query);
  q.set("panel", panel);
  q.set("page", String(page));
  q.set("focus", focus);
  q.set("dateBy", dateBy);
  q.set("reviewSort", reviewSort);
  const report = useLoad<R>(
      "admin/product-analytics/detail/" + encodeURIComponent(id) + "?" + q,
      [tick],
      version,
    ),
    p = report.data?.product as ProductRow | undefined;
  return (
    <section ref={detailRef} className="analytics-block products-detail">
      <div className="analytics-block-heading">
        <div>
          <h2>{p?.name || "Chi tiết món"}</h2>
          {p && (
            <p>
              {p.chef_name} · {p.area}
            </p>
          )}
        </div>
        <Button secondary onClick={onClose}>
          Đóng chi tiết
        </Button>
      </div>
      {p && (
        <>
          <div className="products-detail-header">
            <img src={p.image_url || "/icon.svg"} alt={p.name} />
            <div>
              <State p={p} />
              <p className="small muted">
                <AnimatedValue>
                  {p.missing
                    ? "Giá theo từng đơn lịch sử"
                    : "Giá gốc hiện tại: " + money(p.price)}
                </AnimatedValue>
              </p>
              <div className="actions">
                <Button
                  secondary
                  onClick={() => onNavigate("chefs", p.chef_id)}
                >
                  Hồ sơ chef
                </Button>
                {!p.missing && (
                  <Button secondary onClick={() => onAction(p)}>
                    {p.active ? "Ẩn món" : "Cho hiển thị"}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <nav
            className="dashboard-tabs chefs-detail-tabs"
            aria-label="Chi tiết sản phẩm"
          >
            {Object.entries(PRODUCT_PANELS).map(([key, label]) => (
              <button
                key={key}
                className={key === panel ? "active" : ""}
                onClick={() =>
                  onChange({ panel: key, dpage: "1", focus: "period" })
                }
              >
                {label}
              </button>
            ))}
          </nav>
        </>
      )}
      {!report.data || report.error ? (
        <Pending error={report.error} retry={report.reload} />
      ) : (
        p && (
          <>
            {panel === "overview" && (
              <>
                <div className="chefs-detail-metrics">
                  <Metric
                    label="Phần đã bán trong kỳ"
                    value={count(p.servings)}
                  />
                  <Metric label="Doanh số phân bổ" value={money(p.gmv)} />
                  <Metric
                    label="Đơn có món hoàn thành"
                    value={count(p.orders)}
                  />
                  <Metric
                    label="Khách mua trong kỳ"
                    value={count(report.data.buyers.buyers)}
                  />
                  <Metric
                    label="Khách quay lại cùng món"
                    value={count(report.data.buyers.repeat_buyers)}
                  />
                  <Metric
                    label="Giá thực bán bình quân / phần"
                    value={
                      p.servings ? money(p.gmv / p.servings) : "Chưa có mẫu"
                    }
                  />
                </div>
                <p className="analytics-footnote">
                  Khách quay lại theo các đơn hoàn thành khác nhau của cùng món;
                  một khách có thể mua lần đầu và quay lại trong cùng kỳ. Doanh
                  số sau voucher, không gồm giao hàng hoặc khấu trừ hoàn tiền.
                </p>
                <div className="products-facts">
                  <p>{p.description || "Chưa có mô tả"}</p>
                  <p>Thành phần: {p.ingredients || "Chưa có thông tin"}</p>
                  <p>Ngày tạo: {stamp(p.created_at)}</p>
                  <p>
                    Thực đơn đầu ghi nhận: {p.first_menu || "Chưa có"} · Gần
                    nhất: {p.last_menu || "Chưa có"}
                  </p>
                  <p>
                    Hoàn thành đầu: {stamp(p.first_completed_at)} · Gần nhất:{" "}
                    {stamp(p.last_completed_at)}
                  </p>
                  <p>
                    Ngày có thực đơn trong kỳ:{" "}
                    <AnimatedValue>{count(p.menu_days)}</AnimatedValue>. Đây
                    không phải số ngày thực sự mở bán.
                  </p>
                  <p>
                    Đánh giá từ đơn có món này trong kỳ:{" "}
                    <AnimatedValue>
                      {p.period_rating === null
                        ? "Chưa có"
                        : Number(p.period_rating).toFixed(1) + " ★"}
                    </AnimatedValue>{" "}
                    · <AnimatedValue>{count(p.review_count)}</AnimatedValue>{" "}
                    lượt. Toàn thời gian:{" "}
                    <AnimatedValue>
                      {p.lifetime_rating === null
                        ? "Chưa có"
                        : Number(p.lifetime_rating).toFixed(1) + " ★"}
                    </AnimatedValue>{" "}
                    ·{" "}
                    <AnimatedValue>
                      {count(p.lifetime_review_count)}
                    </AnimatedValue>{" "}
                    lượt.
                  </p>
                </div>
                {p.legacy_orders > 0 && (
                  <Notice>
                    <AnimatedValue>{count(p.legacy_orders)}</AnimatedValue> đơn
                    cũ dùng thời gian cập nhật thay mốc hoàn thành bị thiếu.
                  </Notice>
                )}
                {p.allocation_warnings > 0 && (
                  <Notice error>
                    <AnimatedValue>
                      {count(p.allocation_warnings)}
                    </AnimatedValue>{" "}
                    đơn có tổng dòng món không khớp subtotal; cần kiểm tra dữ
                    liệu nhập cũ.
                  </Notice>
                )}
                {p.missing && (
                  <Notice>
                    Đây là lịch sử món thiếu liên kết catalog. Giá và doanh số
                    vẫn theo snapshot đơn; không thể thay trạng thái món.
                  </Notice>
                )}
                {p.alerts.map((a) => (
                  <button
                    key={a.key}
                    className="chefs-alert products-inline-alert"
                    data-priority={a.priority}
                    onClick={() =>
                      onChange({
                        panel: a.panel,
                        dpage: "1",
                        focus: a.key.startsWith("refund") ? "issues" : "period",
                      })
                    }
                  >
                    <span>
                      {a.label} ·{" "}
                      <AnimatedValue>{count(a.count)}</AnimatedValue>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </>
            )}
            {panel === "menu" && (
              <>
                <h3 className="users-subheading">Phiên bán hiện tại</h3>
                <p className="analytics-footnote">
                  Suất khả dụng có thể đã trừ phần đang giữ cho đơn chờ thanh
                  toán. Bữa qua nửa đêm giữ ngày dịch vụ trước.
                </p>
                {report.data.offers.length ? (
                  <Table
                    headers={[
                      "Ngày / bữa",
                      "Giá hiện tại",
                      "Suất khả dụng",
                      "Điều kiện",
                      "Hết nhận",
                    ]}
                  >
                    {report.data.offers.map((m: R) => (
                      <tr key={m.id}>
                        <td>
                          {m.service_date}
                          <small>
                            {MEAL_NAMES[m.meal_id as keyof typeof MEAL_NAMES]}
                          </small>
                        </td>
                        <td>
                          <AnimatedValue>
                            {money(m.current_price)}
                          </AnimatedValue>
                        </td>
                        <td>
                          <AnimatedValue>{count(m.stock)}</AnimatedValue>
                        </td>
                        <td>
                          <span
                            className="product-status"
                            data-state={m.ready ? "active" : "hidden"}
                          >
                            {m.ready ? "Đang nhận đơn" : "Chưa nhận được đơn"}
                          </span>
                          <small>
                            {!p.active && "Món ẩn · "}
                            {p.chef_status !== "approved" &&
                              "Bếp chưa hoạt động · "}
                            {!p.owner_active && "Chủ bị khóa · "}
                            {!p.bank_ready && "Thiếu ngân hàng · "}
                            {!m.is_open && "Bếp chưa mở · "}
                            {!m.enabled && "Phiên tắt · "}
                            {m.expired && "Đã hết giờ · "}
                            {m.stock <= 0 && "Không còn suất"}
                          </small>
                        </td>
                        <td>{stamp(m.cutoff_at)}</td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <p className="analytics-empty">
                    Chưa có phiên bán phù hợp hôm nay.
                  </p>
                )}
                <h3 className="users-subheading">Thực đơn trong kỳ</h3>
                <p className="analytics-footnote">
                  Giá, bật/tắt và suất dưới đây là trạng thái hiện tại của bản
                  ghi; không tái tạo tồn kho hoặc giá cũ.
                </p>
                {report.data.items.length ? (
                  <Table
                    headers={[
                      "Ngày / bữa",
                      "Bếp / phiên",
                      "Suất",
                      "Giá gốc / sale nhập",
                      "Cutoff",
                    ]}
                  >
                    {report.data.items.map((m: R) => (
                      <tr key={m.id}>
                        <td>
                          {m.service_date}
                          <small>
                            {MEAL_NAMES[m.meal_id as keyof typeof MEAL_NAMES]}
                          </small>
                        </td>
                        <td>
                          {m.is_open ? "Bếp bật" : "Bếp tắt"}
                          <small>
                            {m.enabled ? "Phiên bật" : "Phiên tắt"} ·{" "}
                            {m.active ? "Món bật" : "Món ẩn"}
                          </small>
                        </td>
                        <td>
                          <AnimatedValue>{count(m.stock)}</AnimatedValue>
                        </td>
                        <td>
                          <AnimatedValue>{money(m.price)}</AnimatedValue>
                          <small>
                            <AnimatedValue>
                              {m.sale_price
                                ? "Sale nhập: " + money(m.sale_price)
                                : "Chưa nhập sale"}
                            </AnimatedValue>
                          </small>
                        </td>
                        <td>{stamp(m.cutoff_at)}</td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <p className="analytics-empty">
                    Chưa có thực đơn trong kỳ/bữa đã chọn.
                  </p>
                )}
                <Pager
                  data={report.data}
                  onPage={(n) => onChange({ dpage: String(n) })}
                />
              </>
            )}
            {panel === "orders" && (
              <>
                <div className="products-order-filters">
                  <Field label="Nhóm đơn">
                    <select
                      value={focus}
                      onChange={(e) =>
                        onChange({ focus: e.target.value, dpage: "1" })
                      }
                    >
                      <option value="period">Trong kỳ</option>
                      <option value="issues">
                        Đối soát đang chờ, mọi ngày
                      </option>
                    </select>
                  </Field>
                  <Field label="Mốc ngày đơn">
                    <select
                      value={dateBy}
                      disabled={focus === "issues"}
                      onChange={(e) =>
                        onChange({ dateBy: e.target.value, dpage: "1" })
                      }
                    >
                      <option value="created">Ngày tạo</option>
                      <option value="completed">Ngày hoàn thành</option>
                    </select>
                  </Field>
                </div>
                <p className="analytics-footnote">
                  Đơn chứa món bị hủy/đối soát chưa xác định lỗi ở món này. Tổng
                  thanh toán là toàn đơn; doanh số phân bổ bên dưới chỉ là món
                  đang xem.
                </p>
                {report.data.items.length ? (
                  <Table
                    headers={[
                      "Đơn / món",
                      "Trạng thái",
                      "Phần / giá trị dòng",
                      "Doanh số phân bổ",
                      "Thời gian",
                      "Hủy / đối soát",
                    ]}
                  >
                    {report.data.items.map((o: R) => (
                      <tr key={o.id}>
                        <td>
                          <Link
                            className="text-button"
                            href={"/orders/" + o.id}
                          >
                            {o.code}
                          </Link>
                          <small>{o.item_name}</small>
                        </td>
                        <td>
                          <span className="status" data-status={o.status}>
                            {ORDER_LABELS[
                              o.status as keyof typeof ORDER_LABELS
                            ] || o.status}
                          </span>
                          <small>
                            Tổng đơn:{" "}
                            <AnimatedValue>{money(o.total)}</AnimatedValue>
                          </small>
                        </td>
                        <td>
                          <AnimatedValue>{count(o.quantity)}</AnimatedValue>{" "}
                          phần
                          <small>
                            <AnimatedValue>{money(o.gross)}</AnimatedValue>
                          </small>
                        </td>
                        <td>
                          <AnimatedValue>{money(o.amount)}</AnimatedValue>
                          <small>
                            {o.status === "COMPLETED"
                              ? "Đã hoàn thành"
                              : "Chưa ghi nhận doanh số"}
                          </small>
                        </td>
                        <td>
                          Đặt: {stamp(o.created_at)}
                          <small>
                            Hoàn thành: {stamp(o.completed_at)}
                            {o.legacy_completed ? " (mốc thay thế)" : ""}
                          </small>
                        </td>
                        <td>
                          {o.chef_rejected
                            ? "Chef từ chối"
                            : o.user_cancelled
                              ? "Khách hủy"
                              : o.other_cancelled
                                ? "Admin / tác nhân khác"
                                : o.status === "EXPIRED"
                                  ? "Hết hạn thanh toán"
                                  : "—"}
                          {o.request_status?.split(",").map((s: string) => (
                            <span
                              key={s}
                              className="status products-request-tag"
                              data-status={s}
                            >
                              {PAYMENT_REQUEST_STATUSES[s] || s}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <p className="analytics-empty">Không có đơn phù hợp.</p>
                )}
                <Pager
                  data={report.data}
                  onPage={(n) => onChange({ dpage: String(n) })}
                />
                <Button
                  secondary
                  onClick={() => onNavigate("payments", p.chef_id)}
                >
                  Mở quản lý đối soát của bếp
                </Button>
              </>
            )}
            {panel === "reviews" && (
              <>
                <p className="analytics-footnote">
                  Đánh giá từ đơn có món này; khách hiện chưa chấm riêng từng
                  món. Mỗi đơn chỉ là một mẫu cho món đang xem.
                </p>
                <div className="chefs-rating-summary">
                  {[5, 4, 3, 2, 1].map((star) => (
                    <span key={star}>
                      {star} ★ ·{" "}
                      <AnimatedValue>
                        {count(
                          report.data!.distribution.find(
                            (r: R) => r.rating === star,
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
                {report.data.items.length ? (
                  <Table
                    headers={[
                      "Người đánh giá",
                      "Rating",
                      "Món trong đơn",
                      "Nội dung",
                      "Thời gian",
                    ]}
                  >
                    {report.data.items.map((r: R) => (
                      <tr key={r.id}>
                        <td>{r.user_name}</td>
                        <td>
                          <AnimatedValue>{r.rating}</AnimatedValue> ★
                        </td>
                        <td>
                          {r.dishes}
                          <small>
                            <Link
                              className="text-button"
                              href={"/orders/" + r.order_id}
                            >
                              {r.code}
                            </Link>
                          </small>
                        </td>
                        <td>{r.body || "Không có nội dung"}</td>
                        <td>{stamp(r.created_at)}</td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <p className="analytics-empty">
                    Chưa có đánh giá trong kỳ/bữa đã chọn.
                  </p>
                )}
                <Pager
                  data={report.data}
                  onPage={(n) => onChange({ dpage: String(n) })}
                />
              </>
            )}
            {panel === "history" && (
              <>
                <div className="chefs-detail-metrics">
                  <Metric
                    label="Phiên xem chi tiết trong kỳ"
                    value={count(p.views)}
                  />
                  <Metric
                    label="Phiên thêm giỏ trong kỳ"
                    value={count(p.adds)}
                  />
                  <Metric
                    label="Người đang thích món"
                    value={count(p.favorites)}
                  />
                </div>
                <p className="analytics-footnote">
                  Số phiên độc lập, chưa là tỷ lệ chuyển đổi. Khách có thể thêm
                  giỏ trực tiếp từ thẻ món. Theo dõi đầu ghi nhận:{" "}
                  {stamp(report.data.trackingStartedAt)}.
                </p>
                <h3 className="users-subheading">Lịch sử món</h3>
                {report.data.items.length ? (
                  <Table
                    headers={[
                      "Thời gian",
                      "Thao tác",
                      "Người thực hiện",
                      "Thông tin ghi nhận",
                    ]}
                  >
                    {report.data.items.map((h: R) => {
                      const d =
                        typeof h.detail === "string"
                          ? JSON.parse(h.detail)
                          : h.detail;
                      return (
                        <tr key={h.id}>
                          <td>{stamp(h.created_at)}</td>
                          <td>
                            {h.action === "product.created"
                              ? "Tạo món"
                              : h.action === "product.active"
                                ? "Ẩn / hiển thị"
                                : "Cập nhật món"}
                          </td>
                          <td>{h.actor_name || "Hệ thống"}</td>
                          <td>
                            {d?.name}
                            {d?.price !== undefined && (
                              <small>
                                Giá gốc:{" "}
                                <AnimatedValue>{money(d.price)}</AnimatedValue>
                              </small>
                            )}
                            {d?.active !== undefined && (
                              <small>{d.active ? "Đang bật" : "Đã ẩn"}</small>
                            )}
                            <small>{d?.reason}</small>
                          </td>
                        </tr>
                      );
                    })}
                  </Table>
                ) : (
                  <p className="analytics-empty">
                    Chưa có lịch sử được ghi nhận.
                  </p>
                )}
                <Pager
                  data={report.data}
                  onPage={(n) => onChange({ dpage: String(n) })}
                />
                <p className="analytics-footnote">
                  Audit chef tạo/sửa món bắt đầu từ bản cập nhật này; không khôi
                  phục được các giá trị trước thời điểm ghi nhận.
                </p>
              </>
            )}
          </>
        )
      )}
    </section>
  );
}
export function AdminProducts({
  onNavigate,
}: {
  onNavigate: (tab: string, chef?: string) => void;
}) {
  const params = useSearchParams(),
    router = useRouter(),
    { revision, refresh, toast } = useApp(),
    [manual, setManual] = useState(0),
    [tick, setTick] = useState(0),
    [salesMetric, setSalesMetric] = useState("servings"),
    [topMetric, setTopMetric] = useState("servings"),
    [supplyMetric, setSupplyMetric] = useState("products"),
    [advanced, setAdvanced] = useState(false),
    [category, setCategory] = useState("all"),
    [action, setAction] = useState<ProductRow | null>(null),
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
    const v = params.get("p" + key);
    if (v) q.set(key, v);
  }
  if (params.get("chef")) q.set("chef", params.get("chef")!);
  const query = q.toString(),
    reportQ = new URLSearchParams(q);
  for (const key of ["status", "group", "sort", "view", "page"])
    reportQ.delete(key);
  const selected = params.get("product"),
    view = q.get("view") || "list",
    version = String(revision) + ":" + String(manual),
    summary = useLoad<R>(
      "admin/product-analytics/summary?" + reportQ,
      [tick],
      version,
    ),
    trends = useLoad<R>(
      !selected && view === "list"
        ? "admin/product-analytics/trends?" + reportQ
        : null,
      [],
      version,
    ),
    operations = useLoad<R>(
      !selected && view === "list"
        ? "admin/product-analytics/operations?" +
            reportQ +
            "&category=" +
            category
        : null,
      [tick],
      version,
    ),
    list = useLoad<R>(
      !selected && view !== "supply"
        ? "admin/product-analytics/list?" + query
        : null,
      [tick],
      version,
    ),
    supply = useLoad<R>(
      !selected && view === "supply"
        ? "admin/product-analytics/supply?" + reportQ
        : null,
      [tick],
      version,
    ),
    today = serviceDate();
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (
      !selected &&
      list.data &&
      Number(q.get("page") || 1) !== list.data.page
    ) {
      const p = new URLSearchParams(params.toString());
      p.set("ppage", String(list.data.page));
      router.replace("/admin?" + p, { scroll: false });
    }
  }, [list.data, selected, query, params, router]);
  function apply(patch: Record<string, string>, detail = false) {
    const p = new URLSearchParams(params.toString());
    p.set("tab", "products");
    if (!Object.hasOwn(patch, "page") && !detail) p.delete("ppage");
    for (const [key, v] of Object.entries(patch)) {
      const k = key === "chef" ? "chef" : "p" + key;
      if (v && v !== "all") p.set(k, v);
      else p.delete(k);
    }
    if (!detail) {
      p.delete("product");
      for (const key of ["panel", "dpage", "focus", "dateBy", "reviewSort"])
        p.delete("p" + key);
    }
    router.push("/admin?" + p, { scroll: false });
  }
  function open(id: string, panel = "overview", focus = "period") {
    const p = new URLSearchParams(params.toString());
    p.set("tab", "products");
    p.set("product", id);
    p.set("ppanel", panel);
    p.set("pfocus", focus);
    p.delete("pdpage");
    p.delete("previewSort");
    p.delete("pdateBy");
    router.push("/admin?" + p, { scroll: false });
  }
  async function saveAction(reason: string) {
    if (!action || busy) return;
    setBusy(true);
    setError("");
    try {
      await post("admin/products/" + action.id, {
        active: !action.active,
        reason,
      });
      setAction(null);
      setManual(Date.now());
      refresh();
      toast("Đã cập nhật trạng thái món.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const cards = [
    [
      "total",
      "Tổng món",
      Utensils,
      "Catalog hiện tại",
      { group: "all", status: "all" },
    ],
    [
      "active",
      "Món đang bật",
      CheckCircle2,
      "Trạng thái hiện tại",
      { group: "all", status: "active" },
    ],
    [
      "ready",
      "Món nhận được đơn",
      ShoppingBag,
      "Phiên bán hợp lệ hiện tại",
      { group: "ready", status: "all" },
    ],
    [
      "sold",
      "Món đã bán",
      ChartNoAxesColumn,
      "Đơn hoàn thành trong kỳ",
      { group: "sales", status: "all" },
    ],
    [
      "servings",
      "Phần đã bán",
      Utensils,
      "Trong kỳ và bữa đã chọn",
      { group: "sales", sort: "servings", status: "all" },
    ],
    [
      "gmv",
      "Doanh số món",
      Wallet,
      "Sau voucher · Không gồm giao",
      { group: "sales", sort: "gmv", status: "all" },
    ],
    ["new", "Món mới", Plus, "Tạo trong kỳ", { group: "new", status: "all" }],
    [
      "attention",
      "Món cần chú ý",
      TriangleAlert,
      "Có tác vụ cần kiểm tra",
      { group: "attention", status: "all" },
    ],
  ] as const;
  return (
    <div className="admin-products analytics-overview">
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
              <AnimatedValue>{n}</AnimatedValue> ngày
            </button>
          ))}
        </div>
        <div className="analytics-toolbar-actions">
          <Button secondary onClick={() => setManual(Date.now())}>
            <RefreshCw size={16} />
            Làm mới món
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
        className="analytics-filters products-filters"
        key={[
          q.get("from"),
          q.get("to"),
          q.get("region"),
          q.get("meal"),
          q.get("q"),
          q.get("chef"),
        ].join("|")}
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          apply(
            Object.fromEntries(
              [...d.entries()].map(([k, v]) => [k, String(v)]),
            ),
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
            {q.get("region") &&
              !summary.data?.regions.some(
                (r: R) => r.id === q.get("region"),
              ) && <option value={q.get("region")!}>{q.get("region")}</option>}
            {summary.data?.regions.map((r: R) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Chef">
          <select name="chef" defaultValue={q.get("chef") || ""}>
            <option value="">Tất cả bếp</option>
            {q.get("chef") &&
              !summary.data?.chefs.some((c: R) => c.id === q.get("chef")) && (
                <option value={q.get("chef")!}>Bếp đã chọn</option>
              )}
            {summary.data?.chefs.map((c: R) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
        <Field label="Tìm món">
          <input
            name="q"
            type="search"
            maxLength={100}
            defaultValue={q.get("q") || ""}
            placeholder="Món, bếp, mã sản phẩm"
          />
        </Field>
        <Button type="submit">
          <Search size={16} />
          Áp dụng
        </Button>
      </form>
      <p className="analytics-footnote">
        Ngày theo giờ Việt Nam. Khu vực là vị trí bếp. Bữa áp dụng thực
        đơn/đơn/tương tác; tổng món và trạng thái bật vẫn gồm món chưa có thực
        đơn. Trạng thái/nhóm/thứ tự chỉ lọc bảng.
      </p>
      {selected ? (
        <ProductDetail
          id={selected}
          query={reportQ.toString()}
          panel={params.get("ppanel") || "overview"}
          page={Number(params.get("pdpage") || 1)}
          focus={params.get("pfocus") || "period"}
          dateBy={params.get("pdateBy") || "created"}
          reviewSort={params.get("previewSort") || "recent"}
          version={version}
          tick={tick}
          onChange={(patch) => apply(patch, true)}
          onClose={() => apply({ page: q.get("page") || "1" })}
          onAction={(p) => {
            setError("");
            setAction(p);
          }}
          onNavigate={onNavigate}
        />
      ) : (
        <>
          {!summary.data || summary.error ? (
            <Pending error={summary.error} retry={summary.reload} />
          ) : (
            <>
              <div className="analytics-kpis products-kpis">
                {cards.map(([key, label, Icon, hint, patch]) => (
                  <button
                    key={key}
                    className="analytics-kpi users-kpi"
                    onClick={() => apply({ ...patch, view: "list" })}
                  >
                    <span className="analytics-kpi-label">
                      {label}
                      <Icon size={18} />
                    </span>
                    <strong>
                      <AnimatedValue>
                        {key === "gmv"
                          ? money(summary.data!.metrics[key])
                          : count(summary.data!.metrics[key])}
                      </AnimatedValue>
                    </strong>
                    <small>{hint}</small>
                    {["sold", "servings", "gmv", "new"].includes(key) && (
                      <small>
                        <AnimatedValue>
                          {summary.data!.delta[key] === null
                            ? "Chưa có kỳ đối chiếu"
                            : (summary.data!.delta[key] > 0 ? "+" : "") +
                              summary.data!.delta[key].toFixed(1) +
                              "% so kỳ trước"}
                        </AnimatedValue>
                      </small>
                    )}
                    <span className="users-filter-hint">
                      Lọc danh sách
                      <ChevronRight size={12} />
                    </span>
                  </button>
                ))}
              </div>
              {summary.data.missingProducts > 0 && (
                <Notice>
                  <AnimatedValue>
                    {count(summary.data.missingProducts)}
                  </AnimatedValue>{" "}
                  món có doanh số nhưng thiếu liên kết catalog.{" "}
                  <button
                    className="text-button"
                    onClick={() =>
                      apply({ group: "legacy", status: "all", view: "list" })
                    }
                  >
                    Xem lịch sử thiếu liên kết
                  </button>
                </Notice>
              )}
            </>
          )}
          <nav
            className="dashboard-tabs products-main-tabs"
            aria-label="Báo cáo sản phẩm"
          >
            {Object.entries(PRODUCT_VIEWS).map(([key, label]) => (
              <button
                key={key}
                className={view === key ? "active" : ""}
                onClick={() => apply({ view: key })}
              >
                {label}
              </button>
            ))}
          </nav>
          {view === "list" && (
            <>
              <Block
                title="Món cần theo dõi"
                caption="Cảnh báo giúp kiểm tra nội dung, vận hành và đơn liên quan; không tự động ẩn món."
                action={
                  <select
                    aria-label="Nhóm cảnh báo"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="all">Tất cả cảnh báo</option>
                    <option value="operation">Vận hành</option>
                    <option value="content">Nội dung</option>
                    <option value="performance">Hiệu quả</option>
                  </select>
                }
              >
                {!operations.data || operations.error ? (
                  <Pending error={operations.error} retry={operations.reload} />
                ) : (
                  <>
                    <div className="chefs-alerts">
                      {operations.data.alerts
                        .filter(
                          (a: R) =>
                            category === "all" || a.category === category,
                        )
                        .map((a: R) => (
                          <button
                            className="chefs-alert"
                            key={a.productId + a.key}
                            data-priority={a.priority}
                            onClick={() =>
                              open(
                                a.productId,
                                a.panel,
                                a.key.startsWith("refund")
                                  ? "issues"
                                  : "period",
                              )
                            }
                          >
                            <span>
                              <strong>{a.productName}</strong>
                              <small>
                                {a.chefName} · {a.label} ·{" "}
                                <AnimatedValue>{count(a.count)}</AnimatedValue>
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
                      <AnimatedValue>
                        {count(operations.data.products)}
                      </AnimatedValue>{" "}
                      món ·{" "}
                      <AnimatedValue>
                        {count(operations.data.total)}
                      </AnimatedValue>{" "}
                      cảnh báo. Hiển thị tối đa 30 cảnh báo ưu tiên trong nhóm
                      đã chọn.
                    </p>
                    {!operations.data.alerts.filter(
                      (a: R) => category === "all" || a.category === category,
                    ).length && (
                      <p className="analytics-empty">
                        Không có cảnh báo trong nhóm đã chọn.
                      </p>
                    )}
                  </>
                )}
              </Block>
              <div className="analytics-grid analytics-chart-grid">
                <Block
                  title="Sức bán theo thời gian"
                  caption="Đơn hoàn thành; kỳ trước có cùng số ngày."
                >
                  <Field label="Chỉ số sức bán">
                    <select
                      value={salesMetric}
                      onChange={(e) => setSalesMetric(e.target.value)}
                    >
                      <option value="servings">Số phần</option>
                      <option value="gmv">Doanh số món</option>
                    </select>
                  </Field>
                  {!trends.data || trends.error ? (
                    <Pending error={trends.error} retry={trends.reload} />
                  ) : (
                    <>
                      <SalesChart
                        days={trends.data.days}
                        metric={salesMetric}
                      />
                      {trends.data.quality.legacyOrders > 0 && (
                        <p className="analytics-footnote">
                          <AnimatedValue>
                            {count(trends.data.quality.legacyOrders)}
                          </AnimatedValue>{" "}
                          đơn dùng mốc hoàn thành thay thế.
                        </p>
                      )}
                      {trends.data.quality.allocationWarnings > 0 && (
                        <Notice error>
                          <AnimatedValue>
                            {count(trends.data.quality.allocationWarnings)}
                          </AnimatedValue>{" "}
                          đơn nhập cũ có tổng dòng món không khớp subtotal.
                        </Notice>
                      )}
                    </>
                  )}
                </Block>
                <Block
                  title="Top món"
                  caption="Không gộp món cùng tên của nhiều chef."
                >
                  <Field label="Xếp hạng món">
                    <select
                      value={topMetric}
                      onChange={(e) => setTopMetric(e.target.value)}
                    >
                      <option value="servings">Phần đã bán</option>
                      <option value="gmv">Doanh số món</option>
                      <option value="orders">Đơn hoàn thành</option>
                    </select>
                  </Field>
                  {!trends.data || trends.error ? (
                    <Pending error={trends.error} retry={trends.reload} />
                  ) : trends.data.tops[topMetric].length ? (
                    <div className="products-top-chart">
                      {trends.data.tops[topMetric].map(
                        (p: R, i: number, all: R[]) => (
                          <button key={p.id} onClick={() => open(p.id)}>
                            <img
                              src={p.image_url || "/icon.svg"}
                              alt=""
                              loading="lazy"
                            />
                            <span>
                              <span className="spread">
                                <span>
                                  {p.name}
                                  <small>{p.chef_name}</small>
                                </span>
                                <strong>
                                  <AnimatedValue>
                                    {topMetric === "gmv"
                                      ? money(p.gmv)
                                      : count(p[topMetric]) +
                                        (topMetric === "orders"
                                          ? " đơn"
                                          : " phần")}
                                  </AnimatedValue>
                                </strong>
                              </span>
                              <span className="users-group-track">
                                <i
                                  style={{
                                    width:
                                      Math.max(
                                        1,
                                        (p[topMetric] /
                                          Math.max(1, all[0][topMetric])) *
                                          100,
                                      ) + "%",
                                  }}
                                />
                              </span>
                            </span>
                          </button>
                        ),
                      )}
                    </div>
                  ) : (
                    <p className="analytics-empty">Chưa có món bán trong kỳ.</p>
                  )}
                </Block>
              </div>
            </>
          )}
          {view === "supply" && (
            <Block
              title="Nguồn cung theo bữa / khu vực"
              caption="Hiện trạng ở vị trí bếp; giao được tới khách còn phụ thuộc bán kính và địa chỉ checkout."
            >
              {!supply.data || supply.error ? (
                <Pending error={supply.error} retry={supply.reload} />
              ) : (
                <>
                  <Field label="Chỉ số nguồn cung">
                    <select
                      value={supplyMetric}
                      onChange={(e) => setSupplyMetric(e.target.value)}
                    >
                      <option value="products">
                        Món nhận được đơn hiện tại
                      </option>
                      <option value="chefs">
                        Chef có món nhận đơn hiện tại
                      </option>
                      <option value="stock">Suất khả dụng hiện tại</option>
                      <option value="menu_days">
                        Ngày có thực đơn trong kỳ
                      </option>
                    </select>
                  </Field>
                  <Table
                    headers={["Khu vực bếp", ...Object.values(MEAL_NAMES)]}
                  >
                    {[
                      ...new Map(
                        supply.data.cells.map((c: R) => [c.region, c.label]),
                      ).entries(),
                    ].map(([region, label]) => (
                      <tr key={String(region)}>
                        <td>{String(label)}</td>
                        {Object.keys(MEAL_NAMES).map((meal) => (
                          <td key={meal}>
                            <AnimatedValue>
                              {count(
                                supply.data!.cells.find(
                                  (c: R) =>
                                    c.region === region && c.meal_id === meal,
                                )?.[supplyMetric],
                              )}
                            </AnimatedValue>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Table>
                  <p className="analytics-footnote">
                    Suất khả dụng có thể đã trừ suất giữ chỗ; ngày có thực đơn
                    khác với ngày thực sự mở bán. Một món có nhiều bữa có thể
                    xuất hiện ở nhiều ô.
                  </p>
                  <h3 className="users-subheading">Sức bán theo thứ / bữa</h3>
                  <p className="analytics-footnote">
                    Số phần bán trên đơn hoàn thành; thứ theo ngày hoàn thành
                    tại Việt Nam, bữa theo đơn. Không đại diện toàn bộ nhu cầu.
                  </p>
                  <Table
                    className="products-heatmap"
                    headers={["Thứ", ...Object.values(MEAL_NAMES)]}
                  >
                    {[
                      "Thứ 2",
                      "Thứ 3",
                      "Thứ 4",
                      "Thứ 5",
                      "Thứ 6",
                      "Thứ 7",
                      "Chủ nhật",
                    ].map((label, day) => (
                      <tr key={label}>
                        <td>{label}</td>
                        {Object.keys(MEAL_NAMES).map((meal) => {
                          const v = Number(
                              supply.data!.heatmap.find(
                                (r: R) =>
                                  r.weekday === day && r.meal_id === meal,
                              )?.servings || 0,
                            ),
                            max = Math.max(
                              1,
                              ...supply.data!.heatmap.map((r: R) => r.servings),
                            );
                          return (
                            <td key={meal}>
                              <span
                                style={{
                                  background: `rgba(33,113,93,${v ? 0.08 + (v / max) * 0.35 : 0})`,
                                }}
                              >
                                <AnimatedValue>{count(v)}</AnimatedValue>
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Table>
                  {!supply.data.cells.length && (
                    <p className="analytics-empty">
                      Chưa có nguồn cung/thực đơn trong phạm vi đã chọn.
                    </p>
                  )}
                </>
              )}
            </Block>
          )}
          {view !== "supply" && (
            <Block
              title={
                view === "behavior" ? "Hiệu quả & hành vi" : "Danh sách món"
              }
              caption={
                view === "behavior"
                  ? "Phiên xem, thêm giỏ là số phiên độc lập; chưa trình bày tỷ lệ chuyển đổi."
                  : "Tổng hợp đầy đủ; 20 món mỗi trang, có thứ tự ổn định."
              }
            >
              {view === "behavior" && summary.data && (
                <p className="analytics-footnote">
                  Theo dõi đầu ghi nhận: {stamp(summary.data.trackingStartedAt)}
                  .{" "}
                  <AnimatedValue>
                    {count(summary.data.trackingCoverage.tracked)}
                  </AnimatedValue>
                  /
                  <AnimatedValue>
                    {count(summary.data.trackingCoverage.orders)}
                  </AnimatedValue>{" "}
                  đơn tạo trong kỳ có analytics context; dữ liệu tài chính vẫn
                  gồm đơn không có context.
                </p>
              )}
              <div className="users-list-filters">
                <Field label="Trạng thái món">
                  <select
                    value={q.get("status") || "all"}
                    onChange={(e) => apply({ status: e.target.value })}
                  >
                    {Object.entries(PRODUCT_STATUSES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Nhóm món">
                  <select
                    value={q.get("group") || "all"}
                    onChange={(e) => apply({ group: e.target.value })}
                  >
                    {Object.entries(PRODUCT_GROUPS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Sắp xếp món">
                  <select
                    value={q.get("sort") || "newest"}
                    onChange={(e) => apply({ sort: e.target.value })}
                  >
                    {Object.entries(PRODUCT_SORTS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  className="text-button"
                  onClick={() =>
                    apply({ status: "all", group: "all", sort: "newest" })
                  }
                >
                  Xóa bộ lọc danh sách
                </button>
              </div>
              {view === "list" && (
                <label className="products-columns">
                  <input
                    type="checkbox"
                    checked={advanced}
                    onChange={(e) => setAdvanced(e.target.checked)}
                  />
                  Hiển thị thông tin nâng cao
                </label>
              )}
              {!list.data || list.error ? (
                <Pending error={list.error} retry={list.reload} />
              ) : (
                <>
                  <p className="analytics-meta">
                    <AnimatedValue>{count(list.data.total)}</AnimatedValue> món
                    phù hợp
                  </p>
                  <p className="users-table-hint">
                    Vuốt ngang để xem đầy đủ số liệu và thao tác.
                  </p>
                  {list.data.products.length ? (
                    <Table
                      className="products-table"
                      headers={
                        view === "behavior"
                          ? [
                              "Món / chef",
                              "Phiên xem",
                              "Phiên thêm giỏ",
                              "Người đang thích",
                              "Phần đã bán",
                              "Doanh số",
                              "Theo dõi đầu ghi nhận",
                            ]
                          : [
                              "Món / chef",
                              "Giá hiện tại",
                              "Trạng thái / khả năng bán",
                              "Bữa / suất",
                              "Phần đã bán",
                              "Doanh số món",
                              "Đánh giá từ đơn",
                              ...(advanced
                                ? [
                                    "Đơn / khách",
                                    "Thích / tương tác",
                                    "Thực đơn / lần bán gần nhất",
                                  ]
                                : []),
                              "Theo dõi",
                              "Thao tác",
                            ]
                      }
                    >
                      {list.data.products.map((p: ProductRow) => (
                        <tr key={p.id}>
                          <td>
                            <Identity p={p} onOpen={() => open(p.id)} />
                          </td>
                          {view === "behavior" ? (
                            <>
                              <td>
                                <AnimatedValue>{count(p.views)}</AnimatedValue>
                              </td>
                              <td>
                                <AnimatedValue>{count(p.adds)}</AnimatedValue>
                              </td>
                              <td>
                                <AnimatedValue>
                                  {count(p.favorites)}
                                </AnimatedValue>
                              </td>
                              <td>
                                <AnimatedValue>
                                  {count(p.servings)}
                                </AnimatedValue>
                              </td>
                              <td>
                                <AnimatedValue>{money(p.gmv)}</AnimatedValue>
                              </td>
                              <td>{stamp(p.tracking_started_at)}</td>
                            </>
                          ) : (
                            <>
                              <td>
                                <AnimatedValue>
                                  {p.missing ? "Theo đơn" : money(p.price)}
                                </AnimatedValue>
                                {p.price_min !== null && (
                                  <small>
                                    Đang bán:{" "}
                                    <AnimatedValue>
                                      {money(p.price_min)}
                                    </AnimatedValue>
                                    <AnimatedValue>
                                      {p.price_max !== p.price_min
                                        ? " – " + money(p.price_max)
                                        : ""}
                                    </AnimatedValue>
                                  </small>
                                )}
                              </td>
                              <td>
                                <State p={p} />
                              </td>
                              <td>
                                {p.meals
                                  .map(
                                    (m: string) =>
                                      MEAL_NAMES[m as keyof typeof MEAL_NAMES],
                                  )
                                  .join(", ") || "—"}
                                <small>
                                  <AnimatedValue>
                                    {count(p.available_stock)}
                                  </AnimatedValue>{" "}
                                  suất khả dụng
                                </small>
                              </td>
                              <td>
                                <AnimatedValue>
                                  {count(p.servings)}
                                </AnimatedValue>
                              </td>
                              <td>
                                <AnimatedValue>{money(p.gmv)}</AnimatedValue>
                              </td>
                              <td>
                                <AnimatedValue>
                                  {p.period_rating === null
                                    ? "Chưa có"
                                    : Number(p.period_rating).toFixed(1) + " ★"}
                                </AnimatedValue>
                                <small>
                                  <AnimatedValue>
                                    {count(p.review_count)}
                                  </AnimatedValue>{" "}
                                  lượt trong kỳ
                                </small>
                              </td>
                              {advanced && (
                                <>
                                  <td>
                                    <AnimatedValue>
                                      {count(p.orders)}
                                    </AnimatedValue>{" "}
                                    đơn
                                    <small>
                                      <AnimatedValue>
                                        {count(p.buyers)}
                                      </AnimatedValue>{" "}
                                      khách
                                    </small>
                                  </td>
                                  <td>
                                    <AnimatedValue>
                                      {count(p.favorites)}
                                    </AnimatedValue>{" "}
                                    thích
                                    <small>
                                      <AnimatedValue>
                                        {count(p.views)}
                                      </AnimatedValue>{" "}
                                      xem ·{" "}
                                      <AnimatedValue>
                                        {count(p.adds)}
                                      </AnimatedValue>{" "}
                                      thêm giỏ
                                    </small>
                                  </td>
                                  <td>
                                    <AnimatedValue>
                                      {count(p.menu_days)}
                                    </AnimatedValue>{" "}
                                    ngày có thực đơn
                                    <small>{stamp(p.last_completed_at)}</small>
                                  </td>
                                </>
                              )}
                              <td>
                                {p.alerts.map((a) => (
                                  <button
                                    key={a.key}
                                    className="chefs-alert-tag"
                                    onClick={() =>
                                      open(
                                        p.id,
                                        a.panel,
                                        a.key.startsWith("refund")
                                          ? "issues"
                                          : "period",
                                      )
                                    }
                                  >
                                    {a.label} ·{" "}
                                    <AnimatedValue>
                                      {count(a.count)}
                                    </AnimatedValue>
                                  </button>
                                ))}
                              </td>
                              <td>
                                <div className="chefs-row-actions">
                                  <Button secondary onClick={() => open(p.id)}>
                                    Chi tiết
                                  </Button>
                                  <Button
                                    secondary
                                    onClick={() =>
                                      onNavigate("chefs", p.chef_id)
                                    }
                                  >
                                    Chef
                                  </Button>
                                  {!p.missing && (
                                    <Button
                                      secondary
                                      onClick={() => {
                                        setError("");
                                        setAction(p);
                                      }}
                                    >
                                      {p.active ? "Ẩn món" : "Cho hiển thị"}
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </Table>
                  ) : (
                    <p className="analytics-empty">Không có món phù hợp.</p>
                  )}
                  <Pager
                    data={list.data}
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
          title={
            (action.active ? "Ẩn món" : "Cho hiển thị") + " · " + action.name
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
            <p className="small muted">
              Cho hiển thị không tự mở bếp/bữa. Chef và admin đang dùng chung
              trạng thái bật/ẩn.
            </p>
            <Field label="Lý do">
              <textarea name="reason" required minLength={3} maxLength={500} />
            </Field>
            {error && <Notice error>{error}</Notice>}
            <Button type="submit" disabled={busy}>
              {busy ? "Đang lưu…" : "Xác nhận"}
            </Button>
          </form>
        </Dialog>
      )}
      {settings && summary.data && (
        <Dialog
          title="Ngưỡng theo dõi món"
          busy={busy}
          onClose={() => setSettings(false)}
        >
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                await post(
                  "admin/product-analytics/settings",
                  Object.fromEntries(
                    [...d.entries()].map(([k, v]) => [k, Number(v)]),
                  ),
                );
                setSettings(false);
                setManual(Date.now());
                refresh();
                toast("Đã lưu ngưỡng cảnh báo món.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {[
              ["lowRating", "Rating thấp hơn", 1, 5, 0.1],
              ["minReviews", "Số đánh giá tối thiểu", 1, 1000, 1],
              ["minMenuDays", "Ngày có thực đơn tối thiểu", 1, 90, 1],
              ["minAgeDays", "Số ngày từ thực đơn đầu tối thiểu", 1, 365, 1],
            ].map(([key, label, min, max, step]) => (
              <Field key={key} label={String(label)}>
                <input
                  name={String(key)}
                  type="number"
                  required
                  min={Number(min)}
                  max={Number(max)}
                  step={Number(step)}
                  defaultValue={summary.data!.thresholds[key]}
                />
              </Field>
            ))}
            <p className="analytics-footnote">
              Cảnh báo đối soát dùng SLA {summary.data.sla.refundHours} giờ mỗi
              giai đoạn từ Tổng quan. Không tự động ẩn món từ cảnh báo.
            </p>
            {error && <Notice error>{error}</Notice>}
            <Button type="submit" disabled={busy}>
              {busy ? "Đang lưu…" : "Lưu ngưỡng"}
            </Button>
          </form>
        </Dialog>
      )}
      <p className="analytics-footnote">
        Đánh giá lấy từ đơn có món; suất hiện tại không đo tỷ lệ bán hết. Số
        liệu tự kiểm tra mỗi phút khi tab hiển thị, báo cáo lịch sử cache 20
        giây.
      </p>
    </div>
  );
}
