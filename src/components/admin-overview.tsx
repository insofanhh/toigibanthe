"use client";
import { AnimatedValue } from "./animated-value";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChefHat,
  ChevronRight,
  Download,
  RefreshCw,
  ShoppingBag,
  Target,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useApp, post, request } from "./providers";
import { useLoad, Button, Field, Notice, BackgroundRefreshNotice } from "./app";
import { Link } from "./page-motion";
import {
  money,
  MEAL_NAMES,
  ORDER_LABELS,
  PAYMENT_REQUEST_KINDS,
  PAYMENT_REQUEST_STATUSES,
  serviceDate,
  type MealId,
} from "@/lib/domain";
import {
  csvDocument,
  GOAL_METRICS,
  metricDelta,
  ratio,
  shiftDate,
  regionLabel,
  type AnalyticsFilter,
} from "@/lib/analytics-domain";

type Row = Record<string, any>;
const count = (n: unknown) => Number(n || 0).toLocaleString("vi-VN");
const pct = (n: unknown) =>
  n === null || n === undefined ? "—" : Number(n).toFixed(1) + "%";
const stamp = (s: string | null) =>
  s
    ? new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z").toLocaleString(
        "vi-VN",
        {
          timeZone: "Asia/Ho_Chi_Minh",
          dateStyle: "short",
          timeStyle: "short",
        },
      )
    : "—";
const dayLabel = (s: string) => s.slice(8, 10) + "/" + s.slice(5, 7);
const unit = (key: string, value: unknown) =>
  value === null || value === undefined
    ? "Chưa đủ dữ liệu"
    : ["gmv", "aov"].includes(key)
      ? money(Math.round(Number(value)))
      : ["cancelRate", "repeat30", "completionRate"].includes(key)
        ? pct(value)
        : count(value);
function Block({
  title,
  caption,
  children,
  action,
  className = "",
}: {
  title: string;
  caption?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={"analytics-block " + className}>
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
function Pending({ error, retry }: { error?: string; retry: () => void }) {
  return error ? (
    <Notice error>
      {error}{" "}
      <button className="text-button" onClick={retry}>
        Thử lại
      </button>
    </Notice>
  ) : (
    <div className="analytics-skeleton" aria-label="Đang tải báo cáo">
      <span />
      <span />
      <span />
    </div>
  );
}
function Nothing({
  children = "Chưa có dữ liệu trong khoảng thời gian đã chọn.",
}: {
  children?: ReactNode;
}) {
  return <p className="analytics-empty">{children}</p>;
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
function Status({ value }: { value: string }) {
  return (
    <span className="status" data-status={value}>
      {ORDER_LABELS[value] || PAYMENT_REQUEST_STATUSES[value] || value}
    </span>
  );
}
function Delta({
  value,
  inverse = false,
}: {
  value: number | null;
  inverse?: boolean;
}) {
  if (value === null)
    return (
      <span className="analytics-delta neutral">Chưa có kỳ đối chiếu</span>
    );
  const good = inverse ? value <= 0 : value >= 0;
  return (
    <span className={"analytics-delta " + (good ? "good" : "bad")}>
      {value >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{" "}
      <AnimatedValue>{Math.abs(value).toFixed(1)}</AnimatedValue>% so với kỳ
      trước
    </span>
  );
}
function Kpi({
  label,
  value,
  previous,
  metric,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number | null;
  previous: number | null;
  metric: string;
  hint: string;
  icon: typeof Users;
}) {
  return (
    <article className="analytics-kpi">
      <div className="analytics-kpi-label">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>
        <AnimatedValue>{unit(metric, value)}</AnimatedValue>
      </strong>
      <Delta
        value={metricDelta(value, previous)}
        inverse={metric === "cancelRate"}
      />
      <small>{hint}</small>
    </article>
  );
}

function TrendChart({
  rows,
  metric,
}: {
  rows: Row[];
  metric: "orders" | "gmv" | "customers";
}) {
  const keys =
    metric === "orders"
      ? ["placed", "completed"]
      : metric === "gmv"
        ? ["gmv"]
        : ["new_buyers", "returning_buyers"];
  const labels: Record<string, string> = {
    placed: "Đơn tạo mới",
    completed: "Hoàn thành",
    gmv: "Doanh số món",
    new_buyers: "Khách mua lần đầu",
    returning_buyers: "Khách đã từng mua",
  };
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.length || rows.every((r) => keys.every((k) => !Number(r[k]))))
    return <Nothing />;
  const max = Math.max(
    1,
    ...rows.flatMap((r) => keys.map((k) => Number(r[k] || 0))),
  );
  const point = (n: number, i: number) =>
    `${48 + (rows.length === 1 ? 0.5 : i / (rows.length - 1)) * 720},${190 - (n / max) * 160}`;
  return (
    <>
      <div className="analytics-chart-legend">
        {keys.map((k, i) => (
          <span key={k}>
            <i style={{ background: i ? "#93c5b8" : "#21715d" }} />
            {labels[k]}
          </span>
        ))}
      </div>
      <div className="analytics-chart" onMouseLeave={() => setHover(null)}>
        <svg
          viewBox="0 0 800 225"
          role="img"
          aria-label={keys.map((k) => labels[k]).join(", ") + " theo ngày"}
        >
          {[0, 0.5, 1].map((n) => (
            <g key={n}>
              <line
                x1="48"
                x2="768"
                y1={190 - n * 160}
                y2={190 - n * 160}
                stroke="#e7ede9"
              />
              <text x="42" y={194 - n * 160} textAnchor="end">
                <AnimatedValue as="tspan">
                  {metric === "gmv"
                    ? count(Math.round((max * n) / 1000)) + "k"
                    : count(Math.round(max * n))}
                </AnimatedValue>
              </text>
            </g>
          ))}
          {keys.map((k, i) => (
            <polyline
              key={k}
              points={rows.map((r, j) => point(Number(r[k] || 0), j)).join(" ")}
              fill="none"
              stroke={i ? "#93c5b8" : "#21715d"}
              strokeWidth="3"
              strokeLinejoin="round"
            />
          ))}
          {rows.map((r, i) => (
            <g
              key={r.day}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              tabIndex={0}
            >
              <title>
                {dayLabel(r.day) +
                  ": " +
                  keys
                    .map((k) => labels[k] + " " + unit(k, Number(r[k] || 0)))
                    .join(", ")}
              </title>
              <rect
                x={
                  48 +
                  (rows.length === 1 ? 0.5 : i / (rows.length - 1)) * 720 -
                  10
                }
                y="22"
                width="20"
                height="178"
                fill="transparent"
              />
              {(i === 0 ||
                i === rows.length - 1 ||
                i % Math.max(1, Math.ceil(rows.length / 6)) === 0) && (
                <text
                  x={
                    48 + (rows.length === 1 ? 0.5 : i / (rows.length - 1)) * 720
                  }
                  y="216"
                  textAnchor="middle"
                >
                  {dayLabel(r.day)}
                </text>
              )}
            </g>
          ))}
        </svg>
        {hover !== null && (
          <div className="analytics-chart-tooltip">
            {dayLabel(rows[hover].day)} ·{" "}
            {keys.map((k, i) => (
              <span key={k}>
                {i > 0 && " · "}
                {labels[k]}:{" "}
                <AnimatedValue>
                  {unit(k, Number(rows[hover][k] || 0))}
                </AnimatedValue>
              </span>
            ))}
          </div>
        )}
      </div>
      <details className="analytics-details">
        <summary>Xem số liệu biểu đồ</summary>
        <Table headers={["Ngày", ...keys.map((k) => labels[k])]}>
          {rows.map((r) => (
            <tr key={r.day}>
              <td>{dayLabel(r.day)}</td>
              {keys.map((k) => (
                <td key={k}>
                  <AnimatedValue>{unit(k, Number(r[k] || 0))}</AnimatedValue>
                </td>
              ))}
            </tr>
          ))}
        </Table>
      </details>
    </>
  );
}

function Performance({
  data,
  growth,
  onNavigate,
}: {
  data: Row;
  growth?: Row | null;
  onNavigate: (tab: string, chef?: string, orderFilter?: string) => void;
}) {
  const [chefMode, setChefMode] = useState("all"),
    [sort, setSort] = useState("gmv");
  const views = new Map<string, Row>(
    (growth?.productViews || []).map((r: Row) => [r.product_id, r]),
  );
  const chefs = (data.chefs || [])
    .filter(
      (c: Row) =>
        chefMode === "all" ||
        (chefMode === "no-orders"
          ? c.status === "approved" && !Number(c.completed)
          : chefMode === "attention"
            ? Number(c.requests) > 0 || Number(c.cancelled) > 0
            : c.status === "approved" &&
              (!c.last_menu || c.last_menu < shiftDate(serviceDate(), -7))),
    )
    .sort((a: Row, b: Row) => Number(b[sort] || 0) - Number(a[sort] || 0));
  const regions = data.regions || [];
  return (
    <>
      <Block
        title="Hiệu suất chef"
        caption="Ngày có thực đơn phản ánh lịch đã tạo; thời gian nhận đơn tính từ xác nhận thanh toán."
        action={
          <div className="analytics-inline-controls">
            <select
              aria-label="Nhóm chef"
              value={chefMode}
              onChange={(e) => setChefMode(e.target.value)}
            >
              <option value="all">Tất cả chef</option>
              <option value="no-orders">
                Đã duyệt, chưa có đơn hoàn thành trong kỳ
              </option>
              <option value="attention">Có hủy hoặc đối soát</option>
              <option value="inactive">Chưa tạo thực đơn trong 7 ngày</option>
            </select>
            <select
              aria-label="Sắp xếp chef"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="gmv">Doanh số cao nhất</option>
              <option value="completed">Nhiều đơn hoàn thành</option>
              <option value="requests">Nhiều đối soát</option>
            </select>
          </div>
        }
      >
        {!chefs.length ? (
          <Nothing />
        ) : (
          <Table
            headers={[
              "Chef",
              "Thực đơn",
              "Đơn hoàn thành",
              "Doanh số món",
              "Nhận đơn",
              "Hủy / từ chối",
              "Đánh giá",
              "Đối soát",
              "Đơn đầu tiên",
            ]}
          >
            {chefs.map((c: Row) => (
              <tr key={c.id}>
                <td>
                  <button
                    className="text-button"
                    onClick={() => onNavigate("chefs", c.id)}
                  >
                    {c.name}
                  </button>
                  <small>{c.area}</small>
                  <span
                    className="chef-profile-status status"
                    data-chef-status={c.status}
                  >
                    {
                      (
                        {
                          approved: "Đã duyệt",
                          pending: "Chờ duyệt",
                          suspended: "Tạm ngưng",
                          rejected: "Từ chối",
                          needs_changes: "Cần bổ sung",
                        } as Record<string, string>
                      )[c.status]
                    }
                  </span>
                </td>
                <td>
                  <AnimatedValue>{count(c.menu_days)}</AnimatedValue> ngày
                </td>
                <td>
                  <AnimatedValue>{count(c.completed)}</AnimatedValue>
                </td>
                <td>
                  <AnimatedValue>
                    {money(Math.round(Number(c.gmv)))}
                  </AnimatedValue>
                </td>
                <td>
                  <AnimatedValue>
                    {c.accept_minutes === null
                      ? "—"
                      : Number(c.accept_minutes).toFixed(1) + " phút"}
                  </AnimatedValue>
                </td>
                <td>
                  <AnimatedValue>
                    {pct(ratio(Number(c.cancelled), Number(c.placed)))}
                  </AnimatedValue>
                  <small>
                    <AnimatedValue>{count(c.cancelled)}</AnimatedValue> /{" "}
                    <AnimatedValue>{count(c.placed)}</AnimatedValue> đơn tạo
                  </small>
                </td>
                <td>
                  <AnimatedValue>
                    {Number(c.rating_count)
                      ? Number(c.rating).toFixed(1) + " ★"
                      : "—"}
                  </AnimatedValue>
                  <small>
                    <AnimatedValue>{count(c.rating_count)}</AnimatedValue> lượt
                    · toàn thời gian
                  </small>
                </td>
                <td>
                  <AnimatedValue>{count(c.requests)}</AnimatedValue>
                  <small>Đang mở · hiện tại</small>
                </td>
                <td>
                  {stamp(c.first_order_at)}
                  {c.approved_at && c.first_order_at && (
                    <small>
                      <AnimatedValue>
                        {Math.max(
                          0,
                          Math.round(
                            (Date.parse(
                              c.first_order_at.replace(" ", "T") + "Z",
                            ) -
                              Date.parse(
                                c.approved_at.replace(" ", "T") + "Z",
                              )) /
                              86400000,
                          ),
                        )}
                      </AnimatedValue>{" "}
                      ngày từ duyệt
                    </small>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Block>
      <div className="analytics-grid">
        <Block
          title="Món được đặt nhiều"
          caption="Top 30 theo số suất. Doanh số phân bổ voucher theo giá trị từng món."
        >
          {!data.products?.length ? (
            <Nothing />
          ) : (
            <Table
              headers={[
                "Món",
                "Suất / đơn",
                "Doanh số",
                "Xem / thêm giỏ",
                "Đánh giá",
              ]}
            >
              {data.products.map((p: Row) => (
                <tr key={p.id}>
                  <td>
                    <div className="analytics-product">
                      <img src={p.image_url} alt="" loading="lazy" />
                      <div>
                        {p.name}
                        <small>{p.chef_name}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <AnimatedValue>{count(p.servings)}</AnimatedValue> suất
                    <small>
                      <AnimatedValue>{count(p.orders)}</AnimatedValue> đơn
                    </small>
                  </td>
                  <td>
                    <AnimatedValue>
                      {money(Math.round(Number(p.gmv)))}
                    </AnimatedValue>
                  </td>
                  <td>
                    {views.has(p.id) ? (
                      <>
                        <AnimatedValue>
                          {count(views.get(p.id)?.views)}
                        </AnimatedValue>{" "}
                        /{" "}
                        <AnimatedValue>
                          {count(views.get(p.id)?.adds)}
                        </AnimatedValue>
                      </>
                    ) : (
                      "Chưa ghi nhận"
                    )}
                    <small>Phiên theo dõi trong kỳ</small>
                  </td>
                  <td>
                    <AnimatedValue>
                      {Number(p.rating_count)
                        ? Number(p.rating).toFixed(1) + " ★"
                        : "—"}
                    </AnimatedValue>
                    <small>
                      <AnimatedValue>{count(p.rating_count)}</AnimatedValue>{" "}
                      lượt · toàn thời gian
                    </small>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Block>
        <Block
          title="Đơn theo khu vực giao"
          caption="Ô tọa độ khoảng 2 km, theo vị trí khách. Kết quả của nhóm đơn tạo trong kỳ."
        >
          {!regions.length ? (
            <Nothing />
          ) : (
            <Table
              headers={[
                "Khu vực",
                "Đơn tạo / hoàn thành",
                "Khách / bếp",
                "Hủy",
                "Khoảng cách",
              ]}
            >
              {regions.map((r: Row) => (
                <tr key={r.region}>
                  <td>{r.label}</td>
                  <td>
                    <AnimatedValue>{count(r.placed)}</AnimatedValue> /{" "}
                    <AnimatedValue>{count(r.completed)}</AnimatedValue>
                  </td>
                  <td>
                    <AnimatedValue>{count(r.buyers)}</AnimatedValue> /{" "}
                    <AnimatedValue>{count(r.chefs)}</AnimatedValue>
                  </td>
                  <td>
                    <AnimatedValue>
                      {pct(ratio(Number(r.cancelled), Number(r.placed)))}
                    </AnimatedValue>
                  </td>
                  <td>
                    <AnimatedValue>
                      {Number(r.distance).toFixed(1)}
                    </AnimatedValue>{" "}
                    km<small>Đường thẳng</small>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Block>
      </div>
    </>
  );
}

export function AdminOverview({
  onNavigate,
}: {
  onNavigate: (tab: string, chef?: string, orderFilter?: string) => void;
}) {
  const { revision, toast } = useApp(),
    params = useSearchParams(),
    router = useRouter();
  const [preset, setPreset] = useState(params.get("from") ? "custom" : "30"),
    [manual, setManual] = useState(0),
    [tick, setTick] = useState(0),
    [chart, setChart] = useState<"orders" | "gmv" | "customers">("orders"),
    [modal, setModal] = useState<"goal" | "cost" | "sla" | null>(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  const today = serviceDate();
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const filter: AnalyticsFilter = {
    from: params.get("from") || shiftDate(today, -29),
    to: params.get("to") || today,
    region: params.get("region") || "",
    meal: params.get("meal") || "",
  };
  const [draft, setDraft] = useState(filter);
  useEffect(
    () => setDraft(filter),
    [filter.from, filter.to, filter.region, filter.meal],
  );
  const qs = new URLSearchParams(filter).toString();
  const requestVersion = `${revision}:${manual}`;
  const summary = useLoad<Row>(
    "admin/analytics/summary?" + qs,
    [revision, manual],
    requestVersion,
  );
  const trends = useLoad<Row>(
    "admin/analytics/trends?" + qs,
    [revision, manual],
    requestVersion,
  );
  const ops = useLoad<Row>(
    "admin/analytics/operations?" + qs,
    [revision, manual, tick],
    requestVersion,
  );
  const perf = useLoad<Row>(
    "admin/analytics/performance?" + qs,
    [revision, manual],
    requestVersion,
  );
  const growth = useLoad<Row>(
    "admin/analytics/growth?" + qs,
    [revision, manual],
    requestVersion,
  );
  const goals = useLoad<Row>(
    "admin/analytics/goals?" + qs,
    [revision, manual],
    requestVersion,
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(".analytics-modal");
    const nodes = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ) || [],
      );
    nodes()
      .find((e) => e.tagName === "INPUT" || e.tagName === "SELECT")
      ?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape" && !busyRef.current) {
        e.preventDefault();
        setModal(null);
      }
      if (e.key === "Tab") {
        const n = nodes(),
          first = n[0],
          last = n[n.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [modal]);
  function apply(next: AnalyticsFilter) {
    const p = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) p.set(key, value);
      else p.delete(key);
    }
    router.replace("/admin?" + p.toString(), { scroll: false });
  }
  function choosePreset(value: string) {
    setPreset(value);
    if (value === "custom") return;
    const from =
      value === "month"
        ? today.slice(0, 8) + "01"
        : shiftDate(today, 1 - Number(value));
    apply({ ...filter, from, to: today });
  }
  const series = useMemo(() => {
    if (!trends.data) return [];
    const m = new Map<string, Row>();
    for (const r of trends.data.placed) m.set(r.day, { ...r });
    for (const r of trends.data.completed)
      m.set(r.day, { ...m.get(r.day), ...r });
    const list: Row[] = [];
    for (let d = filter.from; d <= filter.to; d = shiftDate(d, 1)) {
      if (list.length >= 366) break;
      list.push({ day: d, ...m.get(d) });
    }
    return list;
  }, [trends.data, filter.from, filter.to]);
  function refreshAll() {
    setManual(Date.now());
  }
  function exportCSV() {
    if (!summary.data || !trends.data || !perf.data || !growth.data) {
      toast("Chờ các báo cáo tải xong để xuất dữ liệu.");
      return;
    }
    const out: unknown[][] = [
      [
        "Báo cáo hệ thống",
        "Từ",
        filter.from,
        "Đến",
        filter.to,
        "Khu vực",
        filter.region || "Tất cả",
        "Bữa",
        filter.meal || "Tất cả",
      ],
      ["Cập nhật", summary.data.updatedAt],
      ["Chỉ số", "Giá trị", "Kỳ trước"],
    ];
    for (const [key, label] of Object.entries({
      ...GOAL_METRICS,
      placed: "Đơn tạo mới",
      new_buyers: "Khách mua lần đầu",
      aov: "Giá trị món / đơn",
    }))
      out.push([label, summary.data.current[key], summary.data.previous[key]]);
    out.push(
      [],
      [
        "Ngày",
        "Đơn tạo",
        "Đơn hoàn thành",
        "Doanh số món",
        "Khách lần đầu",
        "Khách từng mua",
      ],
    );
    for (const r of series)
      out.push([
        r.day,
        r.placed || 0,
        r.completed || 0,
        r.gmv || 0,
        r.new_buyers || 0,
        r.returning_buyers || 0,
      ]);
    out.push(
      [],
      [
        "Chef",
        "Khu vực",
        "Đơn tạo",
        "Hoàn thành",
        "Doanh số",
        "Hủy",
        "Ngày có thực đơn",
        "Đối soát",
      ],
    );
    for (const c of perf.data.chefs)
      out.push([
        c.name,
        c.area,
        c.placed,
        c.completed,
        c.gmv,
        c.cancelled,
        c.menu_days,
        c.requests,
      ]);
    out.push([], ["Món", "Chef", "Suất", "Đơn", "Doanh số"]);
    for (const p of perf.data.products)
      out.push([p.name, p.chef_name, p.servings, p.orders, p.gmv]);
    out.push(
      [],
      [
        "Vùng nhu cầu",
        "Phiên",
        "Phiên có lần không có món",
        "Bếp đang phục vụ (ước tính)",
      ],
    );
    for (const r of growth.data.demand)
      out.push([r.label, r.sessions, r.empty_sessions, r.serving_chefs]);
    out.push(
      [],
      [
        "Voucher",
        "Đơn hoàn thành",
        "Doanh số",
        "Tiền giảm",
        "Bên chịu chi phí",
      ],
    );
    for (const v of growth.data.vouchers)
      out.push([v.code, v.completed, v.gmv, v.discount, "Chef"]);
    out.push(
      [],
      [
        "Chiến dịch sale",
        "Đơn hoàn thành",
        "Doanh số",
        "Tiền giảm",
        "Bên chịu chi phí",
      ],
    );
    for (const c of growth.data.campaigns)
      out.push([c.name, c.completed, c.gmv, c.discount, "Chef"]);
    out.push(
      [],
      ["Nhóm khách mua lần đầu", "Khách", "Đủ 30 ngày", "Quay lại", "Tỷ lệ"],
    );
    for (const c of growth.data.cohorts)
      out.push([
        c.month,
        c.buyers,
        c.eligible,
        c.returned,
        ratio(Number(c.returned), Number(c.eligible)),
      ]);
    out.push([], ["Chi phí", "Loại", "Ngày", "Số tiền", "Nguồn"]);
    for (const c of growth.data.costs)
      out.push([c.title, c.kind, c.spent_on, c.amount, c.source]);
    const blob = new Blob([csvDocument(out)], {
        type: "text/csv;charset=utf-8",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `tong-quan-${filter.from}-${filter.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    const f = new FormData(e.currentTarget);
    let action: string;
    let body: Row;
    if (modal === "goal") {
      action = "goals";
      body = {
        title: f.get("title"),
        metric: f.get("metric"),
        baseline: Number(f.get("baseline")),
        target: Number(f.get("target")),
        from: f.get("from"),
        to: f.get("to"),
        region: f.get("region"),
        meal: f.get("meal"),
      };
    } else if (modal === "cost") {
      action = "costs";
      body = {
        title: f.get("title"),
        kind: f.get("kind"),
        amount: Number(f.get("amount")),
        spentOn: f.get("date"),
        source: f.get("source"),
        region: f.get("region"),
        meal: f.get("meal"),
      };
    } else {
      action = "sla";
      body = {
        acceptMinutes: Number(f.get("acceptMinutes")),
        profileHours: Number(f.get("profileHours")),
        refundHours: Number(f.get("refundHours")),
      };
    }
    try {
      await post("admin/analytics/" + action, body);
      setModal(null);
      refreshAll();
      toast("Đã lưu.");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(kind: "goals" | "costs", id: string) {
    if (
      !window.confirm(
        kind === "goals" ? "Xóa mục tiêu này?" : "Xóa khoản chi này?",
      )
    )
      return;
    try {
      await request(`admin/analytics/${kind}/${id}`, { method: "DELETE" });
      refreshAll();
      toast("Đã xóa bản ghi.");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  const current = summary.data?.current,
    previous = summary.data?.previous,
    o = ops.data,
    g = growth.data;
  const costsTotal = (g?.costs || []).reduce(
      (s: number, c: Row) => s + Number(c.amount),
      0,
    ),
    marketingTotal = (g?.costs || [])
      .filter((c: Row) => c.kind === "marketing")
      .reduce((s: number, c: Row) => s + Number(c.amount), 0);
  const noMatch = (g?.demand || []).reduce(
    (s: number, r: Row) => s + Number(r.empty_sessions),
    0,
  );
  const sourceCosts = new Map<string, number>();
  for (const c of g?.costs || [])
    if (c.kind === "marketing" && c.source)
      sourceCosts.set(
        c.source,
        (sourceCosts.get(c.source) || 0) + Number(c.amount),
      );
  return (
    <div className="analytics-overview">
      <BackgroundRefreshNotice
        loads={[summary, trends, ops, perf, growth, goals]}
      />
      <div className="analytics-toolbar">
        <div className="analytics-presets" aria-label="Khoảng thời gian">
          {[
            ["1", "Hôm nay"],
            ["7", "7 ngày"],
            ["30", "30 ngày"],
            ["month", "Tháng này"],
            ["custom", "Tùy chọn"],
          ].map(([v, l]) => (
            <button
              key={v}
              type="button"
              aria-pressed={preset === v}
              className={preset === v ? "active" : ""}
              onClick={() => choosePreset(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="analytics-toolbar-actions">
          <button
            className="button secondary"
            onClick={refreshAll}
            aria-label="Làm mới báo cáo"
          >
            <RefreshCw size={16} />
            Làm mới
          </button>
          <button
            className="button secondary"
            onClick={exportCSV}
            disabled={!summary.data || !trends.data || !perf.data || !g}
          >
            <Download size={16} />
            Xuất CSV
          </button>
        </div>
      </div>
      <form
        className="analytics-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setPreset("custom");
          apply(draft);
        }}
      >
        <Field label="Từ ngày">
          <input
            type="date"
            max={today}
            required
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </Field>
        <Field label="Đến ngày">
          <input
            type="date"
            max={today}
            min={draft.from}
            required
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </Field>
        <Field label="Khu vực giao">
          <select
            value={draft.region}
            onChange={(e) => setDraft({ ...draft, region: e.target.value })}
          >
            <option value="">Tất cả khu vực</option>
            {summary.data?.regions.map((r: Row) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bữa ăn">
          <select
            value={draft.meal}
            onChange={(e) => setDraft({ ...draft, meal: e.target.value })}
          >
            <option value="">Tất cả bữa</option>
            {Object.entries(MEAL_NAMES).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit">Áp dụng</Button>
      </form>
      <div className="analytics-meta">
        <span>
          {summary.data
            ? `So sánh ${dayLabel(summary.data.previousFilter.from)} – ${dayLabel(summary.data.previousFilter.to)} · Giờ Việt Nam`
            : "Thống kê toàn hệ thống"}
        </span>
        <span>Cập nhật: {stamp(summary.data?.updatedAt || null)}</span>
      </div>
      {summary.data && (
        <div className="analytics-live analytics-system-totals">
          <span>Quy mô toàn thời gian:</span>
          <button className="text-button" onClick={() => onNavigate("users")}>
            <AnimatedValue>{count(summary.data.totals.users)}</AnimatedValue>{" "}
            tài khoản
          </button>
          <button className="text-button" onClick={() => onNavigate("chefs")}>
            <AnimatedValue>{count(summary.data.totals.chefs)}</AnimatedValue>{" "}
            bếp
          </button>
          <button
            className="text-button"
            onClick={() => onNavigate("products")}
          >
            <AnimatedValue>{count(summary.data.totals.products)}</AnimatedValue>{" "}
            sản phẩm
          </button>
        </div>
      )}
      <Block
        title="Đang cần xử lý"
        caption="Tình hình hiện tại · cập nhật khi có sự kiện đơn hàng và tự làm mới mỗi phút."
        action={
          <button
            className="text-button"
            onClick={() => {
              setFormError("");
              setModal("sla");
            }}
          >
            Cài đặt ngưỡng
          </button>
        }
      >
        {!o ? (
          <Pending error={ops.error} retry={ops.reload} />
        ) : (
          <>
            <div className="analytics-alerts">
              <button
                className="analytics-alert"
                data-tone={Number(o.overduePaid) ? "danger" : "neutral"}
                onClick={() =>
                  document
                    .getElementById("analytics-late-orders")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                <ShoppingBag size={19} />
                <strong>
                  <AnimatedValue>{count(o.overduePaid)}</AnimatedValue>
                </strong>
                <span>Đã trả tiền, chậm nhận</span>
                <small>
                  Quá <AnimatedValue>{o.sla.acceptMinutes}</AnimatedValue> phút
                </small>
                <ChevronRight size={16} />
              </button>
              <button
                className="analytics-alert"
                data-tone={
                  o.refunds.some(
                    (r: Row) => r.status === "OPEN" && Number(r.count),
                  )
                    ? "warning"
                    : "neutral"
                }
                onClick={() => onNavigate("payments")}
              >
                <Wallet size={19} />
                <strong>
                  <AnimatedValue>
                    {count(
                      o.refunds.find((r: Row) => r.status === "OPEN")?.count,
                    )}
                  </AnimatedValue>
                </strong>
                <span>Chờ chef đối soát</span>
                <small>
                  <AnimatedValue>
                    {count(
                      o.refunds.find((r: Row) => r.status === "OPEN")?.overdue,
                    )}
                  </AnimatedValue>{" "}
                  quá <AnimatedValue>{o.sla.refundHours}</AnimatedValue> giờ
                </small>
                <ChevronRight size={16} />
              </button>
              <button
                className="analytics-alert"
                data-tone={
                  o.refunds.some(
                    (r: Row) => r.status === "REVIEW" && Number(r.count),
                  )
                    ? "info"
                    : "neutral"
                }
                onClick={() => onNavigate("payments")}
              >
                <Activity size={19} />
                <strong>
                  <AnimatedValue>
                    {count(
                      o.refunds.find((r: Row) => r.status === "REVIEW")?.count,
                    )}
                  </AnimatedValue>
                </strong>
                <span>Bằng chứng chờ duyệt</span>
                <small>
                  <AnimatedValue>
                    {count(
                      o.refunds.find((r: Row) => r.status === "REVIEW")
                        ?.overdue,
                    )}
                  </AnimatedValue>{" "}
                  quá <AnimatedValue>{o.sla.refundHours}</AnimatedValue> giờ
                </small>
                <ChevronRight size={16} />
              </button>
              <button
                className="analytics-alert"
                data-tone={Number(o.pending.count) ? "warning" : "neutral"}
                onClick={() => onNavigate("chefs")}
              >
                <ChefHat size={19} />
                <strong>
                  <AnimatedValue>{count(o.pending.count)}</AnimatedValue>
                </strong>
                <span>Hồ sơ chờ duyệt</span>
                <small>
                  <AnimatedValue>{count(o.pending.overdue)}</AnimatedValue> quá{" "}
                  <AnimatedValue>{o.sla.profileHours}</AnimatedValue> giờ · toàn
                  hệ thống
                </small>
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="analytics-live">
              <span>
                <i />{" "}
                <AnimatedValue>{count(o.supply.open_chefs)}</AnimatedValue> bếp
                có món nhận đặt
              </span>
              <span>
                <AnimatedValue>{count(o.supply.dishes)}</AnimatedValue> món ·{" "}
                <AnimatedValue>{count(o.supply.servings)}</AnimatedValue> suất
              </span>
              <button
                className="text-button"
                onClick={() => onNavigate("orders", undefined, "active")}
              >
                <AnimatedValue>{count(o.live.active)}</AnimatedValue> đơn đang
                xử lý
              </button>
              <span>
                <AnimatedValue>{count(o.unmatched)}</AnimatedValue> giao dịch
                cần kiểm tra trong 7 ngày
              </span>
            </div>
          </>
        )}
      </Block>
      {!current ? (
        <Pending error={summary.error} retry={summary.reload} />
      ) : (
        <div className="analytics-kpis">
          {[
            ["placed", "Đơn tạo mới", "Theo ngày tạo đơn", ShoppingBag],
            [
              "completed",
              "Đơn hoàn thành",
              "Theo ngày xác nhận hoàn thành",
              ShoppingBag,
            ],
            [
              "gmv",
              "Doanh số món",
              "Sau giảm giá · không gồm phí giao",
              Wallet,
            ],
            [
              "aov",
              "Giá trị món / đơn",
              "Trung bình trên đơn hoàn thành",
              Wallet,
            ],
            ["buyers", "Khách mua", "Có đơn hoàn thành trong kỳ", Users],
            [
              "new_buyers",
              "Khách mua lần đầu",
              "Đơn hoàn thành đầu tiên trên hệ thống",
              Users,
            ],
            [
              "sellers",
              "Bếp có đơn hoàn thành",
              "Số chef có giao dịch hoàn thành",
              ChefHat,
            ],
            [
              "cancelRate",
              "Tỷ lệ hủy / từ chối",
              "Nhóm đơn tạo trong kỳ · còn có thể thay đổi",
              Activity,
            ],
          ].map(([key, label, hint, Icon]) => (
            <Kpi
              key={String(key)}
              label={String(label)}
              metric={String(key)}
              value={current[String(key)]}
              previous={previous?.[String(key)]}
              hint={String(hint)}
              icon={Icon as typeof Users}
            />
          ))}
        </div>
      )}
      {current && (
        <div className="analytics-footnote">
          Phí giao của đơn hoàn thành:{" "}
          <b>
            <AnimatedValue>{money(Number(current.delivery))}</AnimatedValue>
          </b>{" "}
          · Tỷ lệ hoàn thành của nhóm đơn tạo trong kỳ:{" "}
          <b>
            <AnimatedValue>{pct(current.completionRate)}</AnimatedValue>
          </b>{" "}
          · <AnimatedValue>{count(current.unresolved)}</AnimatedValue> đơn trong
          nhóm còn xử lý. Nền tảng hiện chưa thu phí; doanh số không phải doanh
          thu nền tảng.
          {Number(summary.data?.legacyCompletions) > 0 && (
            <span>
              {" "}
              <AnimatedValue>
                {count(summary.data?.legacyCompletions)}
              </AnimatedValue>{" "}
              đơn cũ thiếu sự kiện hoàn thành dùng ngày cập nhật làm mốc thay
              thế.
            </span>
          )}
          <span>
            {" "}
            Giá trị đơn đã xác nhận thanh toán trong kỳ:{" "}
            <b>
              <AnimatedValue>
                {money(Number(summary.data?.payments?.amount || 0))}
              </AnimatedValue>
            </b>{" "}
            (
            <AnimatedValue>
              {count(summary.data?.payments?.confirmed)}
            </AnimatedValue>{" "}
            đơn;{" "}
            <AnimatedValue>
              {count(summary.data?.payments?.automatic)}
            </AnimatedValue>{" "}
            tự động SePay,{" "}
            <AnimatedValue>
              {count(
                Number(summary.data?.payments?.confirmed || 0) -
                  Number(summary.data?.payments?.automatic || 0),
              )}
            </AnimatedValue>{" "}
            xác nhận khác). Đây là giá trị đơn được xác nhận, chưa trừ hoàn tiền
            và không phải số dư ngân hàng.
          </span>
        </div>
      )}
      <div className="analytics-grid analytics-chart-grid">
        <Block
          title="Xu hướng hoạt động"
          caption="Đơn tạo và hoàn thành dùng mốc thời gian riêng; khách có thể xuất hiện ở cả hai nhóm trong ngày."
          action={
            <select
              aria-label="Loại biểu đồ"
              value={chart}
              onChange={(e) => setChart(e.target.value as typeof chart)}
            >
              <option value="orders">Số đơn</option>
              <option value="gmv">Doanh số món</option>
              <option value="customers">Khách hàng</option>
            </select>
          }
        >
          {!trends.data ? (
            <Pending error={trends.error} retry={trends.reload} />
          ) : (
            <TrendChart rows={series} metric={chart} />
          )}
        </Block>
        <Block
          title="Phân bố trạng thái"
          caption="Trạng thái hiện tại của các đơn tạo trong kỳ."
        >
          {!trends.data ? (
            <Pending error={trends.error} retry={trends.reload} />
          ) : !trends.data.statuses.length ? (
            <Nothing />
          ) : (
            <div className="analytics-bars">
              {trends.data.statuses.map((r: Row) => (
                <div className="analytics-bar-row" key={r.status}>
                  <Status value={r.status} />
                  <div>
                    <i
                      style={{
                        width: `${ratio(Number(r.count), Number(current?.placed)) || 0}%`,
                      }}
                    />
                  </div>
                  <strong>
                    <AnimatedValue>{count(r.count)}</AnimatedValue>
                  </strong>
                </div>
              ))}
            </div>
          )}
        </Block>
      </div>
      <div className="analytics-grid">
        <Block
          title="Nhu cầu theo bữa"
          caption="Kết quả của nhóm đơn tạo trong kỳ."
        >
          {!trends.data ? (
            <Pending error={trends.error} retry={trends.reload} />
          ) : !trends.data.meals.length ? (
            <Nothing />
          ) : (
            <Table headers={["Bữa", "Đơn tạo", "Hoàn thành", "Bếp có đơn"]}>
              {trends.data.meals.map((r: Row) => (
                <tr key={r.meal_id}>
                  <td>{MEAL_NAMES[r.meal_id as MealId]}</td>
                  <td>
                    <AnimatedValue>{count(r.placed)}</AnimatedValue>
                  </td>
                  <td>
                    <AnimatedValue>{count(r.completed)}</AnimatedValue>
                  </td>
                  <td>
                    <AnimatedValue>{count(r.chefs)}</AnimatedValue>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Block>
        <Block
          title="Bữa ăn theo ngày trong tuần"
          caption="Số đơn tạo. Màu đậm hơn tương ứng nhiều đơn hơn."
        >
          {!trends.data ? (
            <Pending error={trends.error} retry={trends.reload} />
          ) : (
            <div className="analytics-heatmap">
              <Table headers={["Ngày", ...Object.values(MEAL_NAMES)]}>
                {[
                  "Thứ 2",
                  "Thứ 3",
                  "Thứ 4",
                  "Thứ 5",
                  "Thứ 6",
                  "Thứ 7",
                  "Chủ nhật",
                ].map((day, i) => (
                  <tr key={day}>
                    <td>{day}</td>
                    {Object.keys(MEAL_NAMES).map((meal) => {
                      const n = Number(
                          trends.data?.weekdays.find(
                            (r: Row) =>
                              Number(r.weekday) === i && r.meal_id === meal,
                          )?.placed || 0,
                        ),
                        max = Math.max(
                          1,
                          ...trends.data!.weekdays.map((r: Row) =>
                            Number(r.placed),
                          ),
                        );
                      return (
                        <td key={meal}>
                          <span
                            style={{
                              background: n
                                ? `rgba(33,113,93,${0.08 + (n / max) * 0.35})`
                                : "#f4f6f4",
                            }}
                          >
                            <AnimatedValue>{count(n)}</AnimatedValue>
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Block>
      </div>
      <Block
        title="Đơn chậm nhận"
        caption="Tối đa 30 đơn, ưu tiên thời gian chờ lâu nhất. Không suy đoán giao trễ khi chưa có thời gian giao cam kết."
        className="analytics-late-block"
      >
        <div id="analytics-late-orders" />
        {!o ? (
          <Pending error={ops.error} retry={ops.reload} />
        ) : !o.late.length ? (
          <Nothing>
            Không có đơn đã thanh toán chậm nhận theo ngưỡng hiện tại.
          </Nothing>
        ) : (
          <Table
            headers={[
              "Đơn",
              "Chef",
              "Số tiền",
              "Trạng thái",
              "Chờ",
              "Thao tác",
            ]}
          >
            {o.late.map((r: Row) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.chef_name}</td>
                <td>
                  <AnimatedValue>{money(Number(r.total))}</AnimatedValue>
                </td>
                <td>
                  <Status value={r.status} />
                </td>
                <td>
                  <AnimatedValue>{count(r.waiting_minutes)}</AnimatedValue> phút
                </td>
                <td>
                  <Link className="text-button" href={"/orders/" + r.id}>
                    Xem đơn
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Block>
      {!perf.data ? (
        <Block title="Hiệu suất chef và món">
          <Pending error={perf.error} retry={perf.reload} />
        </Block>
      ) : (
        <Performance data={perf.data} growth={g} onNavigate={onNavigate} />
      )}
      <div className="analytics-grid">
        <Block
          title="Hành trình đặt hàng"
          caption="Theo phiên có món → thêm giỏ → đặt hàng theo thứ tự. Xem chi tiết là bước tùy chọn, khách có thể thêm ngay từ thẻ món."
        >
          {!g ? (
            <Pending error={growth.error} retry={growth.reload} />
          ) : !Number(g.funnel.tracked) ? (
            <Nothing>
              Chưa có phiên được theo dõi. Báo cáo sẽ xuất hiện khi khách sử
              dụng ứng dụng sau cập nhật.
            </Nothing>
          ) : (
            <>
              <div className="analytics-funnel">
                {[
                  ["catalog", "Có món phù hợp"],
                  ["viewed", "Xem món (tùy chọn)"],
                  ["cart", "Thêm giỏ"],
                  ["checkout", "Vào đặt hàng"],
                  ["ordered", "Tạo đơn"],
                  ["paid", "Thanh toán"],
                  ["completed", "Hoàn thành"],
                ].map(([k, label]) => (
                  <div key={k}>
                    <span>{label}</span>
                    <div>
                      <i
                        style={{
                          width: `${ratio(Number(g.funnel[k]), Number(g.funnel.catalog)) || 0}%`,
                        }}
                      />
                    </div>
                    <b>
                      <AnimatedValue>{count(g.funnel[k])}</AnimatedValue>
                    </b>
                  </div>
                ))}
              </div>
              <p className="analytics-footnote">
                Gồm cả thêm giỏ trực tiếp từ thẻ món. Các bước được nối với đơn
                bằng phiên thực tế. Dữ liệu bắt đầu:{" "}
                {stamp(g.trackingStartedAt)}.
              </p>
            </>
          )}
        </Block>
        <Block
          title="Khách quay lại trong 30 ngày"
          caption="Nhóm theo tháng của đơn hoàn thành đầu tiên. Mua lại được tính trên toàn nền tảng."
        >
          {!g ? (
            <Pending error={growth.error} retry={growth.reload} />
          ) : !g.cohorts.length ? (
            <Nothing />
          ) : (
            <>
              <div className="analytics-retention">
                <strong>
                  <AnimatedValue>{pct(current?.repeat30)}</AnimatedValue>
                </strong>
                <span>
                  <AnimatedValue>
                    {count(current?.repeatReturned)}
                  </AnimatedValue>{" "}
                  /{" "}
                  <AnimatedValue>
                    {count(current?.repeatEligible)}
                  </AnimatedValue>{" "}
                  khách đủ 30 ngày quan sát
                </span>
              </div>
              <Table
                headers={[
                  "Nhóm khách",
                  "Khách mới",
                  "Đủ 30 ngày",
                  "Mua lại",
                  "Tỷ lệ",
                ]}
              >
                {g.cohorts.map((r: Row) => (
                  <tr key={r.month}>
                    <td>{r.month}</td>
                    <td>
                      <AnimatedValue>{count(r.buyers)}</AnimatedValue>
                    </td>
                    <td>
                      <AnimatedValue>{count(r.eligible)}</AnimatedValue>
                    </td>
                    <td>
                      <AnimatedValue>{count(r.returned)}</AnimatedValue>
                    </td>
                    <td>
                      <AnimatedValue>
                        {Number(r.eligible)
                          ? pct(ratio(Number(r.returned), Number(r.eligible)))
                          : "Chưa đủ 30 ngày"}
                      </AnimatedValue>
                    </td>
                  </tr>
                ))}
              </Table>
            </>
          )}
        </Block>
      </div>
      <Block
        title="Nhu cầu và khả năng phục vụ"
        caption="Top 30 ô vị trí theo phiên không có món. Bếp phục vụ là ước tính hiện tại tại tâm ô khoảng 2 km; điều kiện đặt đơn vẫn kiểm tra tọa độ chính xác."
      >
        {!g ? (
          <Pending error={growth.error} retry={growth.reload} />
        ) : !g.demand.length ? (
          <Nothing>Chưa có dữ liệu tìm món theo khu vực.</Nothing>
        ) : (
          <Table
            headers={[
              "Khu vực khách",
              "Phiên tìm món",
              "Có lần không có món",
              "Tỷ lệ",
              "Bếp có thể phục vụ hiện tại",
            ]}
          >
            {g.demand.map((r: Row) => (
              <tr key={r.region}>
                <td>
                  {r.label}
                  <small>{regionLabel(r.region)}</small>
                </td>
                <td>
                  <AnimatedValue>{count(r.sessions)}</AnimatedValue>
                </td>
                <td>
                  <AnimatedValue>{count(r.empty_sessions)}</AnimatedValue>
                </td>
                <td>
                  <AnimatedValue>
                    {pct(ratio(Number(r.empty_sessions), Number(r.sessions)))}
                  </AnimatedValue>
                </td>
                <td>
                  <span
                    className={
                      "analytics-pill " +
                      (!Number(r.serving_chefs) ? "warning" : "")
                    }
                  >
                    <AnimatedValue>{count(r.serving_chefs)}</AnimatedValue> bếp
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Block>
      <div className="analytics-grid">
        <Block
          title="Đối soát đang mở"
          caption="Hiện tại · 20 yêu cầu ưu tiên chờ duyệt, sau đó thời gian gửi lâu nhất."
          action={
            <button
              className="text-button"
              onClick={() => onNavigate("payments")}
            >
              Quản lý đối soát <ChevronRight size={15} />
            </button>
          }
        >
          {!o ? (
            <Pending error={ops.error} retry={ops.reload} />
          ) : !o.payments.length ? (
            <Nothing>Không có yêu cầu đang mở.</Nothing>
          ) : (
            <Table
              headers={[
                "Đơn / chef",
                "Loại",
                "Số tiền",
                "Trạng thái",
                "Gửi lúc",
              ]}
            >
              {o.payments.map((r: Row) => (
                <tr key={r.id}>
                  <td>
                    <Link
                      className="text-button"
                      href={"/orders/" + r.order_id}
                    >
                      {r.code}
                    </Link>
                    <small>{r.chef_name}</small>
                  </td>
                  <td>{PAYMENT_REQUEST_KINDS[r.kind] || r.kind}</td>
                  <td>
                    <AnimatedValue>{money(Number(r.amount))}</AnimatedValue>
                  </td>
                  <td>
                    <Status value={r.status} />
                    {r.evidence_asset_id && <small>Đã có bằng chứng</small>}
                  </td>
                  <td>{stamp(r.created_at)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Block>
        <Block
          title="Giao dịch SePay cần kiểm tra"
          caption="20 giao dịch gần nhất có sai lệch trong 7 ngày; gồm cả giao dịch đã được xử lý. Giao dịch chưa khớp đơn chỉ có trong bộ lọc toàn khu vực / bữa."
        >
          {!o ? (
            <Pending error={ops.error} retry={ops.reload} />
          ) : !o.transactions.length ? (
            <Nothing>
              Không có giao dịch sai lệch được ghi nhận trong 7 ngày.
            </Nothing>
          ) : (
            <Table
              headers={["Giao dịch / chef", "Số tiền", "Kết quả", "Thời gian"]}
            >
              {o.transactions.map((r: Row) => (
                <tr key={r.chef_id + ":" + r.transaction_id}>
                  <td>
                    {r.transaction_id}
                    <small>{r.chef_name}</small>
                  </td>
                  <td>
                    <AnimatedValue>{money(Number(r.amount))}</AnimatedValue>
                  </td>
                  <td>
                    {(
                      {
                        UNMATCHED: "Chưa khớp đơn",
                        ACCOUNT_MISMATCH: "Sai tài khoản",
                        OVERPAID: "Chuyển thừa",
                        PARTIAL: "Chuyển thiếu",
                        PAYMENT_REVIEW: "Cần đối soát",
                      } as Record<string, string>
                    )[r.result] || r.result}
                    {r.failure_reason && <small>{r.failure_reason}</small>}
                  </td>
                  <td>{stamp(r.created_at)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Block>
      </div>
      <Block
        title="Khuyến mãi"
        caption="Kết quả gắn với ưu đãi, chưa kết luận số đơn tăng thêm do chiến dịch. Các ưu đãi hiện do chef chịu chi phí."
      >
        {!g ? (
          <Pending error={growth.error} retry={growth.reload} />
        ) : !g.vouchers.length && !g.campaigns.length ? (
          <Nothing>
            Chưa có đơn hoàn thành áp dụng voucher hoặc chiến dịch được ghi
            nhận.
          </Nothing>
        ) : (
          <Table
            headers={[
              "Ưu đãi",
              "Loại",
              "Đơn hoàn thành",
              "Khách mua lần đầu",
              "Mua lại 30 ngày",
              "Doanh số món",
              "Tiền giảm",
              "Bên chịu chi phí",
            ]}
          >
            {g.vouchers.map((r: Row) => (
              <tr key={r.id}>
                <td>
                  {r.code}
                  <small>{r.title}</small>
                </td>
                <td>Voucher</td>
                <td>
                  <AnimatedValue>{count(r.completed)}</AnimatedValue>
                </td>
                <td>
                  <AnimatedValue>{count(r.new_buyers)}</AnimatedValue>
                </td>
                <td>
                  <AnimatedValue>
                    {Number(r.eligible)
                      ? pct(ratio(Number(r.returned), Number(r.eligible)))
                      : "Chưa đủ dữ liệu"}
                  </AnimatedValue>
                  <small>
                    <AnimatedValue>{count(r.returned)}</AnimatedValue> /{" "}
                    <AnimatedValue>{count(r.eligible)}</AnimatedValue> khách mới
                    đủ 30 ngày
                  </small>
                </td>
                <td>
                  <AnimatedValue>{money(Number(r.gmv))}</AnimatedValue>
                </td>
                <td>
                  <AnimatedValue>{money(Number(r.discount))}</AnimatedValue>
                </td>
                <td>Chef</td>
              </tr>
            ))}
            {g.campaigns.map((r: Row) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>Sale</td>
                <td>
                  <AnimatedValue>{count(r.completed)}</AnimatedValue>
                </td>
                <td>
                  <AnimatedValue>{count(r.new_buyers)}</AnimatedValue>
                </td>
                <td>
                  <AnimatedValue>
                    {Number(r.eligible)
                      ? pct(ratio(Number(r.returned), Number(r.eligible)))
                      : "Chưa đủ dữ liệu"}
                  </AnimatedValue>
                  <small>
                    <AnimatedValue>{count(r.returned)}</AnimatedValue> /{" "}
                    <AnimatedValue>{count(r.eligible)}</AnimatedValue> khách mới
                    đủ 30 ngày
                  </small>
                </td>
                <td>
                  <AnimatedValue>{money(Number(r.gmv))}</AnimatedValue>
                </td>
                <td>
                  <AnimatedValue>{money(Number(r.discount))}</AnimatedValue>
                </td>
                <td>Chef</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="analytics-footnote">
          Chiến dịch sale dùng thông tin lưu tại lúc đặt đơn từ cập nhật này.
          Không suy luận ưu đãi cũ từ giá hiện tại.
        </p>
      </Block>
      <Block
        title="Chi phí và nguồn khách"
        caption="Chi phí nhập thực tế. Nguồn khách dùng utm_source của phiên đặt đơn; đơn cũ có thể chưa có nguồn."
        action={
          <button
            className="button secondary"
            onClick={() => {
              setFormError("");
              setModal("cost");
            }}
          >
            Thêm chi phí
          </button>
        }
      >
        {!g ? (
          <Pending error={growth.error} retry={growth.reload} />
        ) : (
          <>
            <div className="analytics-small-stats">
              <div>
                <span>Chi phí đã nhập</span>
                <strong>
                  <AnimatedValue>{money(costsTotal)}</AnimatedValue>
                </strong>
              </div>
              <div>
                <span>Chi phí marketing</span>
                <strong>
                  <AnimatedValue>{money(marketingTotal)}</AnimatedValue>
                </strong>
              </div>
              <div>
                <span>Chi phí marketing / khách mới</span>
                <strong>
                  <AnimatedValue>
                    {marketingTotal && Number(current?.new_buyers)
                      ? money(
                          Math.round(
                            marketingTotal / Number(current?.new_buyers),
                          ),
                        )
                      : "Chưa đủ dữ liệu"}
                  </AnimatedValue>
                </strong>
                <small>Ước tính gộp · không phải CAC theo kênh</small>
              </div>
            </div>
            <div className="analytics-grid">
              {!g.sources.length ? (
                <Nothing>Chưa có đơn hoàn thành để phân tích nguồn.</Nothing>
              ) : (
                <Table
                  headers={[
                    "Nguồn",
                    "Đơn",
                    "Khách mới",
                    "Doanh số",
                    "Chi phí / khách mới",
                  ]}
                >
                  {g.sources.map((r: Row) => (
                    <tr key={r.source}>
                      <td>{r.source}</td>
                      <td>
                        <AnimatedValue>{count(r.completed)}</AnimatedValue>
                      </td>
                      <td>
                        <AnimatedValue>{count(r.new_buyers)}</AnimatedValue>
                      </td>
                      <td>
                        <AnimatedValue>{money(Number(r.gmv))}</AnimatedValue>
                      </td>
                      <td>
                        <AnimatedValue>
                          {sourceCosts.has(r.source) && Number(r.new_buyers)
                            ? money(
                                Math.round(
                                  sourceCosts.get(r.source)! /
                                    Number(r.new_buyers),
                                ),
                              )
                            : "Chưa đủ dữ liệu"}
                        </AnimatedValue>
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
              {!g.costs.length ? (
                <Nothing>Chưa nhập chi phí trong kỳ.</Nothing>
              ) : (
                <Table headers={["Khoản chi", "Ngày", "Số tiền", "Thao tác"]}>
                  {g.costs.map((r: Row) => (
                    <tr key={r.id}>
                      <td>
                        {r.title}
                        <small>
                          {
                            (
                              {
                                marketing: "Marketing",
                                platform: "Vận hành nền tảng",
                                promotion: "Khuyến mãi nền tảng",
                              } as Record<string, string>
                            )[r.kind]
                          }
                          {r.source && " · " + r.source}
                        </small>
                      </td>
                      <td>{dayLabel(r.spent_on)}</td>
                      <td>
                        <AnimatedValue>{money(Number(r.amount))}</AnimatedValue>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          aria-label={"Xóa chi phí " + r.title}
                          onClick={() => remove("costs", r.id)}
                        >
                          Xóa
                        </button>
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
            <p className="analytics-footnote">
              Bộ lọc khu vực/bữa chỉ lấy chi phí được gắn đúng khu vực/bữa; chi
              phí chung được xem ở bộ lọc toàn hệ thống.
            </p>
          </>
        )}
      </Block>
      <Block
        title="Mục tiêu"
        caption="Mỗi mục tiêu có kỳ và phạm vi riêng, độc lập với bộ lọc báo cáo phía trên."
        action={
          <button
            className="button secondary"
            onClick={() => {
              setFormError("");
              setModal("goal");
            }}
          >
            <Target size={16} />
            Thêm mục tiêu
          </button>
        }
      >
        {!goals.data ? (
          <Pending error={goals.error} retry={goals.reload} />
        ) : !goals.data.goals.length ? (
          <Nothing>
            Chưa đặt mục tiêu. Dùng số liệu thực tế làm mốc ban đầu trước khi
            đặt mục tiêu tháng hoặc quý.
          </Nothing>
        ) : (
          <div className="analytics-goals">
            {goals.data.goals.map((r: Row) => {
              const progress =
                r.current === null
                  ? null
                  : Math.max(
                      0,
                      Math.min(
                        100,
                        ((Number(r.current) - Number(r.baseline)) /
                          (Number(r.target) - Number(r.baseline))) *
                          100,
                      ),
                    );
              return (
                <article key={r.id}>
                  <div className="spread">
                    <h3>{r.title}</h3>
                    <button
                      className="icon-button"
                      aria-label={"Xóa mục tiêu " + r.title}
                      onClick={() => remove("goals", r.id)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <small>
                    {GOAL_METRICS[r.metric as keyof typeof GOAL_METRICS]} ·{" "}
                    {dayLabel(r.from_date)} – {dayLabel(r.to_date)}
                    {r.region && " · " + regionLabel(r.region)}
                    {r.meal_id && " · " + MEAL_NAMES[r.meal_id as MealId]}
                  </small>
                  <div className="analytics-goal-values">
                    <span>
                      Mốc{" "}
                      <AnimatedValue>
                        {unit(r.metric, r.baseline)}
                      </AnimatedValue>
                    </span>
                    <strong>
                      <AnimatedValue>{unit(r.metric, r.current)}</AnimatedValue>
                    </strong>
                    <span>
                      Mục tiêu{" "}
                      <AnimatedValue>{unit(r.metric, r.target)}</AnimatedValue>
                    </span>
                  </div>
                  <div
                    className="analytics-progress"
                    role="progressbar"
                    aria-label={r.title}
                    aria-valuenow={progress ?? undefined}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <i style={{ width: (progress || 0) + "%" }} />
                  </div>
                  <small>
                    <AnimatedValue>
                      {progress === null
                        ? "Chưa đủ dữ liệu"
                        : pct(progress) + " tiến độ"}
                    </AnimatedValue>{" "}
                    ·{" "}
                    {r.to_date < today
                      ? "Đã kết thúc"
                      : r.from_date > today
                        ? "Chưa bắt đầu"
                        : "Đang theo dõi"}
                  </small>
                </article>
              );
            })}
          </div>
        )}
      </Block>
      <Block
        title="Gợi ý từ dữ liệu"
        caption="Các tín hiệu cần xem xét; admin kiểm tra nguyên nhân trước khi quyết định."
      >
        <div className="analytics-insights">
          {g && noMatch > 0 && (
            <p>
              <b>Nguồn cung:</b> <AnimatedValue>{count(noMatch)}</AnimatedValue>{" "}
              lượt phiên theo khu vực có lúc không tìm được món. Kiểm tra vùng
              thiếu bếp và bữa cần bổ sung.
            </p>
          )}
          {current && Number(current.cancelled) > 0 && (
            <p>
              <b>Vận hành:</b>{" "}
              <AnimatedValue>{count(current.cancelled)}</AnimatedValue> đơn hủy
              hoặc bị từ chối. Kiểm tra lý do và chef liên quan trước khi tăng
              quảng bá.
            </p>
          )}
          {current && current.repeat30 !== null && (
            <p>
              <b>Giữ khách:</b>{" "}
              <AnimatedValue>{pct(current.repeat30)}</AnimatedValue> khách đủ
              thời gian quan sát mua lại trong 30 ngày. Theo dõi xu hướng qua
              các nhóm khách.
            </p>
          )}
          {perf.data && Number(current?.gmv) > 0 && (
            <p>
              <b>Nguồn cung tập trung:</b> 3 bếp doanh số cao nhất chiếm{" "}
              <AnimatedValue>
                {pct(
                  ratio(
                    perf.data.chefs
                      .slice(0, 3)
                      .reduce((s: number, c: Row) => s + Number(c.gmv), 0),
                    Number(current?.gmv),
                  ),
                )}
              </AnimatedValue>{" "}
              doanh số món trong kỳ.
            </p>
          )}
          {!Number(current?.placed) && (
            <p>
              Chưa đủ giao dịch để đánh giá tăng trưởng. Theo dõi bếp có món
              nhận đặt, nhu cầu theo bữa và đơn hoàn thành đầu tiên.
            </p>
          )}
        </div>
      </Block>
      <Block
        title="Đơn gần đây"
        caption="8 đơn mới nhất, theo phạm vi khu vực và bữa đã chọn."
        action={
          <button className="text-button" onClick={() => onNavigate("orders")}>
            Xem danh sách <ChevronRight size={15} />
          </button>
        }
      >
        {!o ? (
          <Pending error={ops.error} retry={ops.reload} />
        ) : !o.recent.length ? (
          <Nothing>Chưa có đơn.</Nothing>
        ) : (
          <Table
            headers={[
              "Đơn",
              "Chef",
              "Số suất",
              "Tổng thanh toán",
              "Trạng thái",
              "Đặt lúc",
            ]}
          >
            {o.recent.map((r: Row) => (
              <tr key={r.id}>
                <td>
                  <Link className="text-button" href={"/orders/" + r.id}>
                    {r.code}
                  </Link>
                </td>
                <td>{r.chef_name}</td>
                <td>
                  <AnimatedValue>{count(r.servings)}</AnimatedValue>
                </td>
                <td>
                  <AnimatedValue>{money(Number(r.total))}</AnimatedValue>
                </td>
                <td>
                  <Status value={r.status} />
                </td>
                <td>{stamp(r.created_at)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Block>
      {modal && (
        <div
          className="analytics-modal-backdrop"
          onClick={() => !busy && setModal(null)}
        >
          <section
            className="analytics-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="analytics-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="spread">
              <h2 id="analytics-dialog-title">
                {modal === "goal"
                  ? "Thêm mục tiêu"
                  : modal === "cost"
                    ? "Thêm chi phí"
                    : "Ngưỡng cảnh báo"}
              </h2>
              <button
                className="icon-button"
                aria-label="Đóng"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>
            <form className="form" onSubmit={save}>
              {modal === "sla" ? (
                <>
                  <Field label="Đã thanh toán, chưa nhận (phút)">
                    <input
                      name="acceptMinutes"
                      type="number"
                      required
                      min="1"
                      max="240"
                      defaultValue={o?.sla.acceptMinutes || 10}
                    />
                  </Field>
                  <Field label="Hồ sơ chờ duyệt (giờ)">
                    <input
                      name="profileHours"
                      type="number"
                      required
                      min="1"
                      max="720"
                      defaultValue={o?.sla.profileHours || 48}
                    />
                  </Field>
                  <Field label="Mỗi giai đoạn đối soát chờ quá (giờ)">
                    <input
                      name="refundHours"
                      type="number"
                      required
                      min="1"
                      max="720"
                      defaultValue={o?.sla.refundHours || 24}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field
                    label={modal === "goal" ? "Tên mục tiêu" : "Tên khoản chi"}
                  >
                    <input
                      name="title"
                      required
                      minLength={2}
                      maxLength={150}
                    />
                  </Field>
                  {modal === "goal" ? (
                    <>
                      <Field label="Chỉ số">
                        <select name="metric">
                          {Object.entries(GOAL_METRICS).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="form-row">
                        <Field label="Mốc ban đầu">
                          <input
                            name="baseline"
                            type="number"
                            required
                            min="0"
                            step="any"
                            defaultValue="0"
                          />
                        </Field>
                        <Field label="Mục tiêu">
                          <input
                            name="target"
                            type="number"
                            required
                            min="0"
                            step="any"
                          />
                        </Field>
                      </div>
                      <div className="form-row">
                        <Field label="Bắt đầu">
                          <input
                            name="from"
                            type="date"
                            required
                            defaultValue={today.slice(0, 8) + "01"}
                          />
                        </Field>
                        <Field label="Kết thúc">
                          <input
                            name="to"
                            type="date"
                            required
                            defaultValue={shiftDate(today, 30)}
                          />
                        </Field>
                      </div>
                      <p className="analytics-footnote">
                        Tỷ lệ nhập theo %, doanh số nhập theo đồng. Tỷ lệ hủy
                        đặt mục tiêu giảm; các chỉ số còn lại đặt mục tiêu tăng.
                      </p>
                    </>
                  ) : (
                    <>
                      <Field label="Loại chi phí">
                        <select name="kind">
                          <option value="marketing">Marketing</option>
                          <option value="platform">Vận hành nền tảng</option>
                          <option value="promotion">Khuyến mãi nền tảng</option>
                        </select>
                      </Field>
                      <div className="form-row">
                        <Field label="Số tiền (đ)">
                          <input
                            name="amount"
                            type="number"
                            required
                            min="1"
                            max="1000000000000"
                          />
                        </Field>
                        <Field label="Ngày chi">
                          <input
                            name="date"
                            type="date"
                            required
                            max={today}
                            defaultValue={today}
                          />
                        </Field>
                      </div>
                      <Field label="Nguồn khách / utm_source (nếu có)">
                        <input
                          name="source"
                          maxLength={100}
                          placeholder="Ví dụ: facebook"
                        />
                      </Field>
                    </>
                  )}
                  <Field label="Phạm vi khu vực">
                    <select name="region" defaultValue={filter.region}>
                      <option value="">Toàn hệ thống</option>
                      {summary.data?.regions.map((r: Row) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Bữa">
                    <select name="meal" defaultValue={filter.meal}>
                      <option value="">Tất cả bữa</option>
                      {Object.entries(MEAL_NAMES).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              {formError && <Notice error>{formError}</Notice>}
              <Button type="submit" disabled={busy}>
                {busy ? "Đang lưu…" : "Lưu"}
              </Button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
