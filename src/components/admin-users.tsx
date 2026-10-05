"use client";
import { AnimatedValue } from "./animated-value";
import { UserAvatar } from "./user-avatar";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Users,
  UserPlus,
  ShoppingBag,
  UserCheck,
  Repeat2,
  LockKeyhole,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  X,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { useApp, post } from "./providers";
import {
  useLoad,
  Button,
  Field,
  Notice,
  PageLoading,
  BackgroundRefreshNotice,
} from "./app";
import { Link } from "./page-motion";
import {
  serviceDate,
  money,
  ORDER_LABELS,
  PAYMENT_REQUEST_KINDS,
  PAYMENT_REQUEST_STATUSES,
} from "@/lib/domain";
import { shiftDate } from "@/lib/analytics-domain";
import {
  USER_GROUPS,
  USER_SEGMENTS,
  USER_SORTS,
  usersDateRange,
  type UsersReport,
  type UsersList,
  type UserDetail,
  type AdminUserRow,
} from "@/lib/admin-users-domain";

const roleNames = { user: "User", chef: "Chef", admin: "Admin" } as const;

function RestoreUserDialog({
  account,
  onClose,
  onRestored,
}: {
  account: AdminUserRow;
  onClose: () => void;
  onRestored: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  async function restore() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await post("admin/users/" + encodeURIComponent(account.id) + "/restore", {
        confirmation: "RESTORE",
      });
      onRestored();
    } catch (error) {
      setError((error as Error).message);
      setSaving(false);
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      className="users-role-dialog"
      aria-labelledby="users-restore-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <h2 id="users-restore-title">Khôi phục tài khoản này?</h2>
      <p>
        <strong>{account.name}</strong>
        <br />
        <span className="muted">{account.email}</span>
      </p>
      <p className="muted small">
        Tài khoản sẽ chuyển sang đang mở và giữ vai trò, hồ sơ cùng lịch sử đơn.
        Người dùng cần đăng nhập lại và bật lại thông báo trên thiết bị nếu
        muốn.
      </p>
      {account.chef_status && (
        <p className="muted small">
          Sau khi khôi phục, vào mục Chefs để duyệt hoặc mở lại hồ sơ bếp. Chef
          cần tự bật bếp và cập nhật thực đơn để nhận đơn.
        </p>
      )}
      {error && <Notice error>{error}</Notice>}
      <div className="users-role-actions">
        <Button secondary disabled={saving} onClick={onClose}>
          Hủy
        </Button>
        <Button disabled={saving} onClick={() => void restore()}>
          <RotateCcw size={15} />{" "}
          {saving ? "Đang khôi phục…" : "Xác nhận khôi phục"}
        </Button>
      </div>
    </dialog>,
    document.body,
  );
}

function DeleteUserDialog({
  account,
  onClose,
  onDeleted,
}: {
  account: AdminUserRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setError("");
    try {
      await post(
        "admin/users/" + encodeURIComponent(account.id),
        { confirmation: "DELETE" },
        "DELETE",
      );
      onDeleted();
    } catch (error) {
      setError((error as Error).message);
      setDeleting(false);
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      className="users-role-dialog"
      aria-labelledby="users-delete-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!deleting) onClose();
      }}
    >
      <h2 id="users-delete-title">Xóa tài khoản này?</h2>
      <p>
        <strong>{account.name}</strong>
        <br />
        <span className="muted">{account.email}</span>
      </p>
      <p className="muted small">
        Tài khoản sẽ bị vô hiệu hóa, đăng xuất trên mọi thiết bị và không thể
        đăng nhập lại. Lịch sử đơn hàng vẫn được giữ để tra cứu.
      </p>
      {account.chef_status && (
        <p className="muted small">
          Bếp của tài khoản này sẽ đóng và hồ sơ chuyển sang tạm ngưng.
        </p>
      )}
      <p className="muted small">
        Chỉ xóa khi không còn đơn hoặc đối soát/hoàn tiền chưa xử lý.
      </p>
      {error && <Notice error>{error}</Notice>}
      <div className="account-delete-actions">
        <Button secondary disabled={deleting} onClick={onClose}>
          Giữ tài khoản
        </Button>
        <Button
          className="account-delete-confirm"
          disabled={deleting}
          onClick={() => void remove()}
        >
          {deleting ? "Đang xóa…" : "Xác nhận xóa"}
        </Button>
      </div>
    </dialog>,
    document.body,
  );
}

function RoleDialog({
  account,
  onClose,
  onSaved,
}: {
  account: AdminUserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [role, setRole] = useState(account.role);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const scrollY = window.scrollY;
    const styles = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    element?.showModal();
    return () => {
      element?.close();
      Object.assign(document.body.style, styles);
      window.scrollTo({ top: scrollY, behavior: "instant" });
    };
  }, []);
  async function save() {
    if (saving || role === account.role) return;
    setSaving(true);
    setError("");
    try {
      await post("admin/users/" + encodeURIComponent(account.id), { role });
      onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      className="users-role-dialog"
      aria-labelledby="users-role-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <div className="spread">
        <h2 id="users-role-title">Phân quyền tài khoản</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Đóng phân quyền"
          disabled={saving}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <p>
        {account.name}
        <br />
        <span className="muted">{account.email}</span>
      </p>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Vai trò">
          <select
            value={role}
            disabled={saving}
            onChange={(event) => {
              setRole(event.target.value);
              setError("");
            }}
          >
            {Object.entries(roleNames).map(([value, name]) => (
              <option
                key={value}
                value={value}
                disabled={
                  value === "chef" &&
                  account.chef_status !== "approved" &&
                  account.role !== "chef"
                }
              >
                {name}
              </option>
            ))}
          </select>
        </Field>
        <p className="users-role-description">
          {role === "admin"
            ? "Admin có toàn quyền quản lý hệ thống, tài khoản và phân quyền."
            : role === "chef"
              ? "Chef quản lý bếp, thực đơn và đơn của bếp đã được duyệt."
              : "User đặt món và quản lý tài khoản cá nhân."}
        </p>
        {account.chef_status !== "approved" && account.role !== "chef" && (
          <p className="muted small">
            Để cấp quyền Chef, hãy duyệt hồ sơ bếp trong mục Chefs.
          </p>
        )}
        {account.role === "chef" && role !== "chef" && (
          <p className="muted small">
            Bếp sẽ đóng. Các đơn và yêu cầu đối soát phải xử lý xong trước khi
            đổi vai trò. Chuyển sang User sẽ tạm ngưng hồ sơ bếp.
          </p>
        )}
        {role !== account.role && (
          <p className="muted small">
            Các phiên đăng nhập của tài khoản này sẽ kết thúc sau khi đổi quyền.
          </p>
        )}
        {error && <Notice error>{error}</Notice>}
        <div className="users-role-actions">
          <Button secondary disabled={saving} onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" disabled={saving || role === account.role}>
            {saving ? "Đang lưu…" : "Xác nhận đổi quyền"}
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

const count = (n: number) => n.toLocaleString("vi-VN");
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
function Block({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section className="analytics-block">
      <div className="analytics-block-heading">
        <div>
          <h2>{title}</h2>
          {caption && <p>{caption}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}
function Retry({
  error,
  reload,
}: {
  error?: string | null;
  reload: () => void;
}) {
  return error ? (
    <Notice error>
      {error}{" "}
      <button className="text-button" onClick={reload}>
        Thử lại
      </button>
    </Notice>
  ) : (
    <PageLoading label="Đang tải tài khoản…" />
  );
}
function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="users-pagination">
      <Button secondary disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={16} /> Trước
      </Button>
      <span>
        Trang <AnimatedValue>{count(page)}</AnimatedValue> /{" "}
        <AnimatedValue>{count(pages)}</AnimatedValue>
      </span>
      <Button
        secondary
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Sau <ChevronRight size={16} />
      </Button>
    </div>
  );
}
function RegistrationChart({ days }: { days: UsersReport["days"] }) {
  const [hover, setHover] = useState<number | null>(null),
    max = Math.max(1, ...days.flatMap((d) => [d.registered, d.first]));
  const x = (i: number) =>
      45 + (days.length === 1 ? 0.5 : i / (days.length - 1)) * 710,
    y = (n: number) => 180 - (n / max) * 145;
  return (
    <>
      <div className="analytics-chart-legend">
        <span>
          <i style={{ background: "#21715d" }} />
          Đăng ký mới
        </span>
        <span>
          <i style={{ background: "#b68c40" }} />
          Mua lần đầu
        </span>
      </div>
      <div className="analytics-chart" onMouseLeave={() => setHover(null)}>
        <svg
          viewBox="0 0 800 220"
          role="img"
          aria-label="Đăng ký mới và khách mua lần đầu theo ngày"
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
          {(["registered", "first"] as const).map((key, j) => (
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
                {d.day}: {d.registered} đăng ký mới, {d.first} mua lần đầu
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
            {days[hover].day} · Đăng ký:{" "}
            <AnimatedValue>{count(days[hover].registered)}</AnimatedValue> · Mua
            lần đầu: <AnimatedValue>{count(days[hover].first)}</AnimatedValue>
          </div>
        )}
      </div>
      <details className="analytics-details">
        <summary>Xem số liệu biểu đồ</summary>
        <div className="analytics-table-wrap">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Đăng ký mới</th>
                <th>Mua lần đầu</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  <td>
                    <AnimatedValue>{d.registered}</AnimatedValue>
                  </td>
                  <td>
                    <AnimatedValue>{d.first}</AnimatedValue>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
function Profile({
  id,
  query,
  page,
  onClose,
  onPage,
}: {
  id: string;
  query: string;
  page: number;
  onClose: () => void;
  onPage: (p: number) => void;
}) {
  const profileRef = useRef<HTMLElement>(null);
  useEffect(() => {
    profileRef.current?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [id]);
  const { revision } = useApp(),
    q = new URLSearchParams(query);
  q.set("page", String(page));
  const result = useLoad<UserDetail>(
    "admin/users/" + encodeURIComponent(id) + "?" + q,
    [revision],
  );
  return (
    <section
      className="analytics-block users-profile"
      ref={profileRef}
      aria-label="Chi tiết tài khoản"
    >
      <div className="analytics-block-heading">
        <div>
          <h2>Chi tiết tài khoản</h2>
          <p>Lịch sử toàn thời gian, không giới hạn bởi kỳ báo cáo.</p>
        </div>
        <Button secondary onClick={onClose}>
          Đóng chi tiết
        </Button>
      </div>
      <BackgroundRefreshNotice loads={[result]} />
      {!result.data ? (
        <Retry error={result.error} reload={result.reload} />
      ) : (
        <>
          <div className="users-profile-info">
            <div className="users-profile-identity">
              <UserAvatar
                name={result.data.user.name}
                src={result.data.user.avatar_url}
                className="users-detail-avatar"
              />
              <div>
                <h3>{result.data.user.name}</h3>
                <p>{result.data.user.email}</p>
                <p>
                  {result.data.user.email_verified_at
                    ? `Email đã xác minh: ${stamp(result.data.user.email_verified_at)}`
                    : result.data.user.email_verification_required
                      ? "Email đang chờ xác minh"
                      : "Email chưa xác minh"}
                </p>
                {result.data.user.phone && (
                  <a
                    className="text-button"
                    href={"tel:" + result.data.user.phone}
                  >
                    {result.data.user.phone}
                  </a>
                )}
                <p>Đăng ký: {stamp(result.data.user.created_at)}</p>
                {result.data.user.deleted_at && (
                  <p>Đã xóa tài khoản: {stamp(result.data.user.deleted_at)}</p>
                )}
              </div>
            </div>
            <div>
              <p>
                <AnimatedValue>
                  {count(result.data.user.completed_orders)}
                </AnimatedValue>{" "}
                đơn hoàn thành
              </p>
              <p>
                Giá trị món:{" "}
                <AnimatedValue>
                  {money(result.data.user.food_value)}
                </AnimatedValue>
              </p>
              <p>Mua gần nhất: {stamp(result.data.user.last_purchase)}</p>
            </div>
          </div>
          <div className="users-order-counts">
            {result.data.counts.map((c) => (
              <span key={c.status} className="status" data-status={c.status}>
                {ORDER_LABELS[c.status] || c.status}:{" "}
                <AnimatedValue>{count(c.count)}</AnimatedValue>
              </span>
            ))}
          </div>
          <h3 className="users-subheading">
            Lịch sử đơn (
            <AnimatedValue>{count(result.data.total)}</AnimatedValue>)
          </h3>
          {result.data.orders.length ? (
            <>
              <div className="analytics-table-wrap">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Đơn / món</th>
                      <th>Bếp</th>
                      <th>Trạng thái</th>
                      <th>Tổng thanh toán</th>
                      <th>Ngày đặt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.orders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <Link
                            className="text-button"
                            href={"/orders/" + o.id}
                          >
                            {o.code}
                          </Link>
                          <small>{o.summary}</small>
                        </td>
                        <td>{o.chef_name}</td>
                        <td>
                          <span className="status" data-status={o.status}>
                            {ORDER_LABELS[o.status] || o.status}
                          </span>
                        </td>
                        <td>
                          <AnimatedValue>
                            {money(Number(o.total))}
                          </AnimatedValue>
                        </td>
                        <td>{stamp(o.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                page={result.data.page}
                pages={result.data.pages}
                onPage={onPage}
              />
            </>
          ) : (
            <p className="analytics-empty">Tài khoản chưa có đơn hàng.</p>
          )}
          <h3 className="users-subheading">
            Yêu cầu đối soát / hoàn tiền gần nhất
          </h3>
          {result.data.requests.length ? (
            <div className="analytics-table-wrap">
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>Đơn</th>
                    <th>Yêu cầu</th>
                    <th>Số tiền</th>
                    <th>Trạng thái</th>
                    <th>Ngày gửi</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.requests.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link
                          className="text-button"
                          href={"/orders/" + r.order_id}
                        >
                          {r.code}
                        </Link>
                      </td>
                      <td>{PAYMENT_REQUEST_KINDS[r.kind] || r.kind}</td>
                      <td>
                        <AnimatedValue>{money(Number(r.amount))}</AnimatedValue>
                      </td>
                      <td>
                        <span className="status" data-status={r.status}>
                          {PAYMENT_REQUEST_STATUSES[r.status] || r.status}
                        </span>
                      </td>
                      <td>{stamp(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="analytics-empty">
              Chưa có yêu cầu đối soát / hoàn tiền.
            </p>
          )}
          <p className="analytics-footnote">
            Hiển thị tối đa 20 yêu cầu gần nhất. Tổng thanh toán của đơn gồm phí
            giao; giá trị món trong hồ sơ chỉ tính đơn hoàn thành, đã trừ
            voucher.
          </p>
        </>
      )}
    </section>
  );
}

export function AdminUsers() {
  const params = useSearchParams(),
    router = useRouter(),
    { user, revision, refresh, toast } = useApp(),
    [busy, setBusy] = useState<string | null>(null),
    [roleAccount, setRoleAccount] = useState<AdminUserRow | null>(null),
    [deleteAccount, setDeleteAccount] = useState<AdminUserRow | null>(null),
    [restoreAccount, setRestoreAccount] = useState<AdminUserRow | null>(null),
    [today, setToday] = useState(serviceDate);
  const keys = [
    "from",
    "to",
    "role",
    "status",
    "q",
    "group",
    "segment",
    "sort",
    "page",
  ];
  const q = new URLSearchParams();
  for (const key of keys) {
    const value = params.get("u" + key);
    if (value) q.set(key, value);
  }
  const range = usersDateRange(q, today);
  q.set("from", range.from);
  q.set("to", range.to);
  const query = q.toString(),
    reportQuery = new URLSearchParams(q);
  for (const key of ["group", "segment", "sort", "page"])
    reportQuery.delete(key);
  const report = useLoad<UsersReport>("admin/users/report?" + reportQuery, [
      revision,
    ]),
    list = useLoad<UsersList>("admin/users?" + query, [revision]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState !== "visible") return;
      const currentDay = serviceDate();
      if (currentDay !== today) {
        setToday(currentDay);
        return;
      }
      report.reload();
      list.reload();
    };
    // WebSocket updates are primary; recover on focus and if a connection is unavailable.
    const interval = setInterval(update, 30000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [today, report.reload, list.reload]);
  const detailId = params.get("uId"),
    group = q.get("group") || "all",
    segment = q.get("segment") || "all",
    status = q.get("status") || "all";
  function apply(patch: Record<string, string>, replace = false) {
    const p = new URLSearchParams(params.toString());
    p.set("tab", "users");
    if (!Object.hasOwn(patch, "page")) p.delete("upage");
    for (const [key, value] of Object.entries(patch)) {
      if (value && value !== "all") p.set("u" + key, value);
      else p.delete("u" + key);
    }
    if (!Object.hasOwn(patch, "Id")) {
      p.delete("uId");
      p.delete("uOrderPage");
    }
    const url = "/admin?" + p.toString();
    if (replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  }
  function formApply(form: HTMLFormElement) {
    const values = Object.fromEntries(new FormData(form).entries());
    apply(
      Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, String(v)]),
      ),
    );
  }
  async function toggle(id: string, active: boolean) {
    if (busy) return;
    setBusy(id);
    try {
      await post("admin/users/" + id, { active });
      refresh();
      toast(active ? "Đã mở tài khoản." : "Đã khóa tài khoản.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => {
    if (list.data && Number(q.get("page") || 1) !== list.data.page) {
      const p = new URLSearchParams(params.toString());
      p.set("upage", String(list.data.page));
      router.replace("/admin?" + p, { scroll: false });
    }
  }, [list.data, query, params, router]);
  const cards = [
    {
      key: "total",
      label: "Tổng tài khoản",
      icon: Users,
      hint: "Toàn thời gian",
      patch: { segment: "all", group: "all" },
    },
    {
      key: "registered",
      label: "Đăng ký mới",
      icon: UserPlus,
      hint: "Trong kỳ đã chọn",
      patch: { segment: "registered", group: "all" },
    },
    {
      key: "buyers",
      label: "Khách mua trong kỳ",
      icon: ShoppingBag,
      hint: "Có đơn hoàn thành",
      patch: { segment: "buyers", group: "all" },
    },
    {
      key: "first",
      label: "Khách mua lần đầu",
      icon: UserCheck,
      hint: "Lần đầu hoàn thành đơn trong kỳ",
      patch: { segment: "first", group: "all" },
    },
    {
      key: "returning",
      label: "Khách mua lại",
      icon: Repeat2,
      hint: "Có lần mua thứ hai trở đi trong kỳ",
      patch: { segment: "returning", group: "all" },
    },
    {
      key: "locked",
      label: "Tài khoản bị khóa",
      icon: LockKeyhole,
      hint: "Trạng thái hiện tại",
      patch: { status: "locked", segment: "all", group: "all" },
    },
  ] as const;
  return (
    <div className="admin-users analytics-overview">
      {restoreAccount && (
        <RestoreUserDialog
          account={restoreAccount}
          onClose={() => setRestoreAccount(null)}
          onRestored={() => {
            setRestoreAccount(null);
            refresh();
            toast(
              restoreAccount.chef_status
                ? "Đã khôi phục tài khoản. Bạn có thể duyệt hoặc mở lại bếp trong mục Chefs."
                : "Đã khôi phục tài khoản. Người dùng có thể đăng nhập lại.",
            );
          }}
        />
      )}
      {deleteAccount && (
        <DeleteUserDialog
          account={deleteAccount}
          onClose={() => setDeleteAccount(null)}
          onDeleted={() => {
            setDeleteAccount(null);
            refresh();
            toast("Đã xóa tài khoản. Lịch sử đơn hàng được giữ lại.");
          }}
        />
      )}
      {roleAccount && (
        <RoleDialog
          account={roleAccount}
          onClose={() => setRoleAccount(null)}
          onSaved={() => {
            setRoleAccount(null);
            refresh();
            toast("Đã cập nhật vai trò tài khoản.");
          }}
        />
      )}
      <BackgroundRefreshNotice loads={[report, list]} />
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
                apply({ from: shiftDate(today, 1 - days), to: today })
              }
            >
              <AnimatedValue>{days}</AnimatedValue> ngày
            </button>
          ))}
        </div>
        <Button
          secondary
          onClick={() => {
            setToday(serviceDate());
            report.reload();
            list.reload();
            refresh();
          }}
        >
          <RefreshCw size={16} /> Làm mới
        </Button>
      </div>
      <form
        key={reportQuery.toString() + group + segment}
        className="analytics-filters users-filters"
        onSubmit={(e) => {
          e.preventDefault();
          formApply(e.currentTarget);
        }}
      >
        <Field label="Từ ngày">
          <input
            name="from"
            type="date"
            max={today}
            defaultValue={q.get("from") || shiftDate(today, -29)}
            required
          />
        </Field>
        <Field label="Đến ngày">
          <input
            name="to"
            type="date"
            max={today}
            defaultValue={q.get("to") || today}
            required
          />
        </Field>
        <Field label="Vai trò">
          <select
            name="role"
            defaultValue={q.get("role") || "all"}
            onChange={(e) => formApply(e.currentTarget.form!)}
          >
            <option value="all">Tất cả vai trò</option>
            <option value="user">User</option>
            <option value="chef">Chef</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <Field label="Trạng thái tài khoản">
          <select
            name="status"
            defaultValue={status}
            onChange={(e) => formApply(e.currentTarget.form!)}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="open">Đang mở</option>
            <option value="locked">Đã khóa</option>
          </select>
        </Field>
        <Field label="Tìm tài khoản">
          <input
            name="q"
            type="search"
            maxLength={100}
            defaultValue={q.get("q") || ""}
            placeholder="Tên, email, số điện thoại"
          />
        </Field>
        <Button type="submit">
          <Search size={16} /> Áp dụng
        </Button>
      </form>
      <p className="analytics-footnote">
        Kỳ báo cáo theo giờ Việt Nam. Chỉ số và biểu đồ áp dụng vai trò, trạng
        thái và tìm kiếm; nhóm mua hàng và điều kiện trong kỳ chỉ lọc danh sách
        bên dưới.
      </p>
      {range.to < today && (
        <Notice>
          Kỳ báo cáo kết thúc ngày {range.to.split("-").reverse().join("/")}.
          Tài khoản đăng ký sau ngày này chưa được tính vào Đăng ký mới.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => apply({ from: shiftDate(today, -29), to: today })}
          >
            Xem 30 ngày đến hôm nay
          </button>
        </Notice>
      )}
      {!report.data ? (
        <Retry error={report.error} reload={report.reload} />
      ) : (
        <>
          <div className="analytics-kpis users-kpis">
            {cards.map((c) => (
              <button
                type="button"
                key={c.key}
                className="analytics-kpi users-kpi"
                aria-pressed={
                  c.key === "locked"
                    ? status === "locked" &&
                      segment === "all" &&
                      group === "all"
                    : c.key === "total"
                      ? segment === "all" &&
                        group === "all" &&
                        status !== "locked"
                      : segment === c.key && group === "all"
                }
                onClick={() => apply({ ...c.patch })}
              >
                <span className="analytics-kpi-label">
                  {c.label}
                  <c.icon size={18} />
                </span>
                <strong>
                  <AnimatedValue>
                    {count(report.data!.metrics[c.key])}
                  </AnimatedValue>
                </strong>
                <small>{c.hint}</small>
                <span className="users-filter-hint">
                  Lọc danh sách <ChevronRight size={12} />
                </span>
              </button>
            ))}
          </div>
          <div className="analytics-grid analytics-chart-grid">
            <Block
              title="Đăng ký và mua lần đầu"
              caption="Hai chỉ số độc lập: người mua lần đầu có thể đã đăng ký từ trước kỳ này."
            >
              <RegistrationChart days={report.data.days} />
            </Block>
            <Block
              title="Nhóm mua hàng"
              caption="Theo số đơn hoàn thành toàn thời gian, gồm mọi vai trò trong phạm vi đã chọn."
            >
              <div className="users-group-chart">
                {(["never", "once", "repeat"] as const).map((key, i) => {
                  const n = report.data!.groups[key],
                    total = report.data!.metrics.total,
                    pct = total ? (n / total) * 100 : 0;
                  return (
                    <button
                      className="users-group-row"
                      key={key}
                      aria-pressed={group === key}
                      onClick={() => apply({ group: key, segment: "all" })}
                    >
                      <span>
                        {USER_GROUPS[key]}
                        <b>
                          <AnimatedValue>{count(n)}</AnimatedValue>{" "}
                          <small>
                            (<AnimatedValue>{pct.toFixed(1)}</AnimatedValue>%)
                          </small>
                        </b>
                      </span>
                      <span className="users-group-track">
                        <i
                          style={{
                            width: pct + "%",
                            background: ["#a4b6ad", "#b68c40", "#21715d"][i],
                          }}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
              {!report.data.metrics.total && (
                <p className="analytics-empty">Chưa có tài khoản phù hợp.</p>
              )}
              <p className="analytics-footnote">
                Bấm vào nhóm để xem tài khoản. Chef vẫn có thể là người mua.
                Khách mới và khách mua lại trong kỳ có thể trùng nhau nếu đã mua
                nhiều lần trong kỳ.
              </p>
            </Block>
          </div>
        </>
      )}
      {detailId && (
        <Profile
          id={detailId}
          query={reportQuery.toString()}
          page={Number(params.get("uOrderPage") || 1)}
          onClose={() =>
            apply({ Id: "", OrderPage: "", page: q.get("page") || "1" })
          }
          onPage={(p) =>
            apply({
              Id: detailId,
              OrderPage: String(p),
              page: q.get("page") || "1",
            })
          }
        />
      )}
      <Block
        title="Danh sách tài khoản"
        caption="Thông tin mua hàng trong bảng là toàn thời gian. Bấm tên tài khoản để xem lịch sử đơn và đối soát."
      >
        <div className="users-list-filters">
          <Field label="Nhóm mua hàng">
            <select
              value={group}
              onChange={(e) => apply({ group: e.target.value, segment: "all" })}
            >
              {Object.entries(USER_GROUPS).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Điều kiện trong kỳ">
            <select
              value={segment}
              onChange={(e) => apply({ segment: e.target.value })}
            >
              {Object.entries(USER_SEGMENTS).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sắp xếp">
            <select
              value={q.get("sort") || "newest"}
              onChange={(e) => apply({ sort: e.target.value })}
            >
              {Object.entries(USER_SORTS).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <button
            className="text-button"
            onClick={() =>
              apply({
                group: "all",
                segment: "all",
                status: "all",
                role: "all",
                q: "",
                sort: "newest",
              })
            }
          >
            Xóa bộ lọc danh sách
          </button>
        </div>
        {!list.data ? (
          <Retry error={list.error} reload={list.reload} />
        ) : (
          <>
            <p className="users-table-hint">
              Vuốt ngang bảng để xem đầy đủ thông tin và thao tác.
            </p>
            <p className="analytics-meta" aria-live="polite">
              <AnimatedValue>{count(list.data.total)}</AnimatedValue> tài khoản
              phù hợp
              <AnimatedValue>
                {list.data.total > 0
                  ? ` · ${count((list.data.page - 1) * list.data.pageSize + 1)}–${count(Math.min(list.data.page * list.data.pageSize, list.data.total))}`
                  : ""}
              </AnimatedValue>
            </p>
            {list.data.users.length ? (
              <div className="analytics-table-wrap">
                <table className="analytics-table users-table">
                  <thead>
                    <tr>
                      <th>Tài khoản</th>
                      <th>Vai trò / trạng thái</th>
                      <th>Nhóm mua hàng</th>
                      <th>Đơn hoàn thành</th>
                      <th>Giá trị món đã mua</th>
                      <th>Mua gần nhất</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <button
                            className="text-button users-name"
                            onClick={() =>
                              apply({
                                Id: u.id,
                                OrderPage: "",
                                page: String(list.data!.page),
                              })
                            }
                          >
                            <UserAvatar
                              name={u.name}
                              src={u.avatar_url}
                              className="users-list-avatar"
                            />
                            {u.name}
                          </button>
                          <small>{u.email}</small>
                          {u.phone && <small>{u.phone}</small>}
                          <small>Đăng ký: {stamp(u.created_at)}</small>
                        </td>
                        <td>
                          <span className="users-role" data-role={u.role}>
                            {u.role === "admin"
                              ? "Admin"
                              : u.role === "chef"
                                ? "Chef"
                                : u.role === "user"
                                  ? "User"
                                  : u.role}
                          </span>
                          <span
                            className="users-account-status"
                            data-open={!!u.active}
                          >
                            {u.deleted_at
                              ? "Đã xóa"
                              : u.active
                                ? "Đang mở"
                                : "Đã khóa"}
                          </span>
                          <span
                            className="users-email-status"
                            data-verified={!!u.email_verified_at}
                          >
                            {u.email_verified_at
                              ? "Đã xác minh"
                              : u.email_verification_required
                                ? "Chờ xác minh"
                                : "Chưa xác minh"}
                          </span>
                        </td>
                        <td>
                          <span
                            className="users-purchase-tag"
                            data-group={
                              u.completed_orders === 0
                                ? "never"
                                : u.completed_orders === 1
                                  ? "once"
                                  : "repeat"
                            }
                          >
                            {u.completed_orders === 0
                              ? USER_GROUPS.never
                              : u.completed_orders === 1
                                ? USER_GROUPS.once
                                : USER_GROUPS.repeat}
                          </span>
                        </td>
                        <td>
                          <AnimatedValue>
                            {count(u.completed_orders)}
                          </AnimatedValue>
                        </td>
                        <td>
                          <AnimatedValue>{money(u.food_value)}</AnimatedValue>
                        </td>
                        <td>{stamp(u.last_purchase)}</td>
                        <td>
                          <div className="users-account-actions">
                            <Button
                              secondary
                              className="account-delete-button"
                              disabled={
                                !!busy || u.id === user?.id || !!u.deleted_at
                              }
                              onClick={() => setDeleteAccount(u)}
                            >
                              <Trash2 size={15} /> Xóa
                            </Button>
                            <Button
                              secondary
                              disabled={
                                !!busy || u.id === user?.id || !!u.deleted_at
                              }
                              onClick={() => setRoleAccount(u)}
                            >
                              <ShieldCheck size={15} /> Phân quyền
                            </Button>
                            {u.deleted_at ? (
                              <Button
                                secondary
                                disabled={!!busy || u.id === user?.id}
                                onClick={() => setRestoreAccount(u)}
                              >
                                <RotateCcw size={15} /> Khôi phục
                              </Button>
                            ) : (
                              <Button
                                secondary
                                disabled={
                                  !!busy || u.id === user?.id || !!u.deleted_at
                                }
                                onClick={() => void toggle(u.id, !u.active)}
                              >
                                {busy === u.id
                                  ? "Đang lưu…"
                                  : u.active
                                    ? "Khóa"
                                    : "Mở khóa"}
                              </Button>
                            )}
                          </div>
                          {u.id === user?.id && (
                            <small>Tài khoản đang dùng</small>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="analytics-empty">
                Không có tài khoản phù hợp với bộ lọc.
              </p>
            )}
            <Pager
              page={list.data.page}
              pages={list.data.pages}
              onPage={(page) => apply({ page: String(page) })}
            />
          </>
        )}
      </Block>
      <p className="analytics-footnote">
        Giá trị món = tiền món trên đơn hoàn thành sau voucher, không gồm phí
        giao. Đơn cũ thiếu sự kiện hoàn thành dùng thời điểm cập nhật làm mốc
        thay thế. “Đang mở” chỉ là quyền sử dụng tài khoản.
      </p>
    </div>
  );
}
