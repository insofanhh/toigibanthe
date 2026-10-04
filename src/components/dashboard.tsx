"use client";
import { useEffect, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { Link } from "./page-motion";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ChefHat,
  Plus,
  Settings,
  Wallet,
  Utensils,
  CalendarDays,
  ShoppingBag,
  BarChart3,
  Bell,
  ShieldCheck,
  Users,
  Newspaper,
  Ticket,
  ImageIcon,
  Clock,
  LoaderCircle,
  Upload,
  Check,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  House,
} from "lucide-react";
import { useApp, request, post } from "./providers";
import { KitchenLocationPicker } from "./kitchen-location-picker";
import { SePaySettings } from "./sepay-settings";
import {
  PaymentRequestEvidence,
  AdminPaymentRequestReview,
} from "./payment-requests";
import type { ResolvedLocation } from "@/lib/location-client";
const AdminOverview = dynamic(
  () => import("./admin-overview").then((m) => m.AdminOverview),
  { loading: () => <div className="loading">Đang tải tổng quan…</div> },
);
const AdminUsers = dynamic(
  () => import("./admin-users").then((m) => m.AdminUsers),
  { loading: () => <div className="loading">Đang tải tài khoản…</div> },
);
const AdminChefs = dynamic(
  () => import("./admin-chefs").then((m) => m.AdminChefs),
  { loading: () => <div className="loading">Đang tải bếp…</div> },
);
const AdminProducts = dynamic(
  () => import("./admin-products").then((m) => m.AdminProducts),
  { loading: () => <div className="loading">Đang tải món…</div> },
);
import {
  useLoad,
  Button,
  Field,
  PageTitle,
  Empty,
  Notice,
  NeedLogin,
  OrderCard,
  PageLoading,
} from "./app";
import {
  money,
  MEAL_NAMES,
  ORDER_LABELS,
  PAYMENT_REQUEST_KINDS,
  PAYMENT_REQUEST_STATUSES,
  type MealId,
} from "@/lib/domain";
type UploadProps = {
  kind?: "image" | "document";
  onUploaded?: (url: string) => void;
};
function FileUpload({ kind = "image", onUploaded }: UploadProps) {
  const { toast } = useApp(),
    [busy, setBusy] = useState(false),
    [name, setName] = useState("");
  async function upload(file: File) {
    const f = new FormData();
    f.set("file", file);
    f.set("kind", kind);
    setBusy(true);
    try {
      const result = await request("upload", { method: "POST", body: f });
      setName(file.name);
      onUploaded?.(result.url);
      toast("Đã tải tệp lên.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <label className="field">
        <span>
          {kind === "image"
            ? "Ảnh món / banner"
            : "Tài liệu xác minh (riêng tư)"}
        </span>
        <input
          className="file-input"
          type="file"
          accept={
            kind === "document"
              ? "image/jpeg,image/png,image/webp,application/pdf"
              : "image/jpeg,image/png,image/webp"
          }
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.[0]) void upload(e.target.files[0]);
          }}
        />
      </label>
      <p className="muted small">
        {busy ? "Đang tải…" : name || "Tệp tối đa 3 MB."}
      </p>
    </div>
  );
}
export function ChefApplication() {
  const { user, refreshAuth, toast } = useApp(),
    { data, reload } = useLoad(user ? "chef/application" : null);
  if (!user) return <NeedLogin />;
  const c = data?.chef;
  if (c && ["pending", "approved", "suspended"].includes(c.status))
    return (
      <>
        <PageTitle title="Hồ sơ bếp" back />
        <div className="panel application-status">
          <h2>
            {c.status === "pending"
              ? "Hồ sơ đang chờ duyệt"
              : c.status === "approved"
                ? "Bếp đã được duyệt"
                : "Bếp đang tạm ngưng"}
          </h2>
          <p>
            {c.name} · {c.address}
          </p>
          {c.rejection_reason && <Notice>{c.rejection_reason}</Notice>}
          {c.status === "approved" ? (
            <Link href="/chef" className="button">
              Vào dashboard bếp
            </Link>
          ) : (
            <p>Thông báo kết quả sẽ xuất hiện trong mục Thông báo.</p>
          )}
          <FileUpload kind="document" />
        </div>
      </>
    );
  if (!data) return <div className="loading">Đang tải hồ sơ bếp…</div>;
  return (
    <ChefApplicationForm
      key={c?.id || user.id}
      initial={c}
      onSave={async () => {
        await refreshAuth();
        reload();
      }}
    />
  );
}
function ChefApplicationForm({
  initial: c,
  onSave,
}: {
  initial: any;
  onSave: () => Promise<void>;
}) {
  const { toast } = useApp();
  const [location, setKitchenLocation] = useState<ResolvedLocation | null>(
    c
      ? {
          address: c.address,
          area: c.area,
          lat: Number(c.lat),
          lng: Number(c.lng),
        }
      : null,
  );
  const [locationBusy, setLocationBusy] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!location || locationBusy) {
      setError("Hãy chọn vị trí bếp từ kết quả tìm kiếm hoặc bản đồ.");
      return;
    }
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await post("chef/application", {
        name: f.get("name"),
        bio: f.get("bio"),
        ...location,
        area: location.area || f.get("area"),
        radiusKm: Number(f.get("radius")),
      });
      await onSave();
      toast("Đã gửi hồ sơ bếp.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="Đăng ký mở bếp"
        subtitle="Điền thông tin để quản trị viên xét duyệt"
        back
      />
      <form className="panel form narrow" onSubmit={submit}>
        {c?.rejection_reason && <Notice>{c.rejection_reason}</Notice>}
        <Field label="Tên bếp">
          <input
            name="name"
            defaultValue={c?.name || ""}
            required
            minLength={2}
          />
        </Field>
        <Field label="Giới thiệu bếp">
          <textarea
            name="bio"
            defaultValue={c?.bio || ""}
            rows={3}
            required
            minLength={10}
          />
        </Field>
        <KitchenLocationPicker
          value={location}
          onChange={setKitchenLocation}
          onBusyChange={setLocationBusy}
          disabled={busy}
        />
        <div className="form-row">
          <Field label="Khu vực / phường">
            <input
              key={location?.area}
              name="area"
              defaultValue={location?.area || c?.area || ""}
              readOnly={!!location?.area}
              required
            />
          </Field>
          <Field label="Bán kính giao (km)">
            <input
              name="radius"
              type="number"
              step="0.5"
              min="0.5"
              max="20"
              defaultValue={c?.radius_km || 5}
              required
            />
          </Field>
        </div>
        <FileUpload kind="document" />
        <Notice>
          Bạn tự bố trí giao hàng. Sau khi được duyệt, nhập tài khoản ngân hàng
          và mở bếp cho từng ngày để bắt đầu nhận đơn.
        </Notice>
        {error && <Notice error>{error}</Notice>}
        <Button type="submit" disabled={busy || locationBusy || !location}>
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Check size={16} />
          )}{" "}
          Gửi hồ sơ
        </Button>
      </form>
    </>
  );
}
function Tabs({
  items,
  tab,
  setTab,
}: {
  items: [string, string, typeof ChefHat][];
  tab: string;
  setTab: (tab: string) => void;
}) {
  return (
    <div className="dashboard-tabs">
      {items.map(([id, label, Icon]) => (
        <button
          className={tab === id ? "active" : ""}
          key={id}
          onClick={() => setTab(id)}
        >
          <Icon size={15} />
          {label}
        </button>
      ))}
    </div>
  );
}
function Stats({ items }: { items: [string, string, string, string?][] }) {
  return (
    <div className="stats-grid">
      {items.map(([label, value, note, href]) =>
        href ? (
          <Link
            className="stat stat-link"
            href={href}
            key={label}
            aria-label={"Xem " + label.toLowerCase()}
          >
            <span>
              {label}
              <ChevronRight size={13} />
            </span>
            <strong>{value}</strong>
            <small>{note}</small>
          </Link>
        ) : (
          <div className="stat" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        ),
      )}
    </div>
  );
}
export function ChefDashboard() {
  const { user, chef, revision, toast, refresh } = useApp(),
    params = useSearchParams(),
    router = useRouter(),
    tab = params.get("tab") || "overview",
    orderFilter = params.get("filter") === "active" ? "active" : "all",
    { data, error, reload } = useLoad(user?.role === "chef" ? "chef" : null, [
      revision,
    ]),
    {
      data: orders,
      error: ordersError,
      loading: ordersLoading,
    } = useLoad(user?.role === "chef" ? "chef/orders" : null, [revision]),
    {
      data: activeOrders,
      error: activeError,
      loading: activeLoading,
    } = useLoad(
      user?.role === "chef" && tab === "orders" && orderFilter === "active"
        ? "chef/orders?filter=active"
        : null,
      [revision],
    ),
    [productForm, setProductForm] = useState<any | null>(null),
    [menuForm, setMenuForm] = useState<any | null>(null);
  if (!user) return <NeedLogin />;
  if (user.role !== "chef")
    return (
      <Empty icon={ChefHat} title="Bạn chưa có bếp đang hoạt động">
        <Link className="button" href="/chef/apply">
          Xem hồ sơ / đăng ký bếp
        </Link>
      </Empty>
    );
  if (error) return <Notice error>{error}</Notice>;
  if (!data)
    return (
      <div className="loading">
        <LoaderCircle className="spin" /> Đang tải bếp…
      </div>
    );
  const c = data.chef;
  const displayedOrders =
    (orderFilter === "active" ? activeOrders?.orders : orders?.orders) || [];
  const listLoading = orderFilter === "active" ? activeLoading : ordersLoading;
  const listError = orderFilter === "active" ? activeError : ordersError;
  function setTab(next: string) {
    const query = new URLSearchParams(params.toString());
    query.set("tab", next);
    query.delete("filter");
    router.push("/chef?" + query.toString(), { scroll: false });
  }
  async function run(path: string, body: unknown) {
    try {
      await post(path, body);
      reload();
      refresh();
      toast("Đã lưu.");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <>
      <PageTitle title={c.name} subtitle="Quản lý hoạt động bếp">
        <Link
          href="/notifications"
          className="icon-button"
          aria-label="Thông báo bếp"
        >
          <Bell size={21} />
        </Link>
      </PageTitle>
      {c.status !== "approved" && (
        <Notice error>
          Bếp hiện chưa được phép nhận đơn. Kiểm tra thông báo hoặc liên hệ hỗ
          trợ.
        </Notice>
      )}
      <Tabs
        tab={tab}
        setTab={setTab}
        items={[
          ["overview", "Tổng quan", BarChart3],
          ["orders", "Đơn hàng", ShoppingBag],
          ["menu", "Thực đơn hôm nay", CalendarDays],
          ["products", "Sản phẩm", Utensils],
          ["settings", "Cài đặt", Settings],
        ]}
      />
      {tab === "overview" && (
        <>
          <Stats
            items={[
              [
                "Đơn đang xử lý",
                String(data.stats.active_orders || 0),
                "Bao gồm đơn chờ thanh toán",
                "/chef?tab=orders&filter=active",
              ],
              [
                "Doanh số hoàn thành",
                money(Number(data.stats.revenue || 0)),
                "Tiền chuyển trực tiếp tới bếp",
              ],
              [
                "Tổng đơn",
                String(data.stats.orders_count || 0),
                "Đơn của bếp trên hệ thống",
              ],
            ]}
          />
          <div className="panel toggle-row">
            <div>
              <strong>
                Bếp hôm nay {data.session?.is_open ? "đang mở" : "đang đóng"}
              </strong>
              <small>Chef xác nhận mở bếp mỗi ngày</small>
            </div>
            <Button secondary onClick={() => setTab("menu")}>
              Quản lý thực đơn
            </Button>
          </div>
          <SectionTitle title="Đơn gần đây" />
          {ordersError && <Notice error>{ordersError}</Notice>}
          {!orders && !ordersError && <PageLoading label="Đang tải đơn…" />}
          {orders?.orders.slice(0, 5).map((o: any) => (
            <OrderCard key={o.id} order={o} />
          ))}
          {orders && !orders.orders.length && (
            <Empty
              title="Chưa có đơn"
              body="Mở bếp và thêm món vào thực đơn hôm nay."
            />
          )}
        </>
      )}
      {tab === "orders" && (
        <>
          <div className="order-filters" aria-label="Lọc đơn hàng">
            <Link
              href="/chef?tab=orders"
              className={orderFilter === "all" ? "active" : ""}
              aria-current={orderFilter === "all" ? "page" : undefined}
              scroll={false}
            >
              Tất cả
            </Link>
            <Link
              href="/chef?tab=orders&filter=active"
              className={orderFilter === "active" ? "active" : ""}
              aria-current={orderFilter === "active" ? "page" : undefined}
              scroll={false}
            >
              Đang xử lý
            </Link>
          </div>
          <Notice>
            Đơn đã thanh toán qua SePay sẽ chờ bếp nhận. Mở chi tiết đơn để
            nhận, chuẩn bị và cập nhật giao hàng.
          </Notice>
          <div style={{ marginTop: 18 }}>
            {listError ? (
              <Notice error>{listError}</Notice>
            ) : listLoading &&
              !(orderFilter === "active" ? activeOrders : orders) ? (
              <div className="loading">
                <LoaderCircle className="spin" /> Đang tải đơn…
              </div>
            ) : displayedOrders.length ? (
              displayedOrders.map((o: any) => (
                <OrderCard key={o.id} order={o} />
              ))
            ) : (
              <Empty
                title={
                  orderFilter === "active"
                    ? "Không có đơn đang xử lý"
                    : "Bếp chưa có đơn"
                }
              />
            )}
          </div>
        </>
      )}
      {tab === "products" && (
        <>
          <div className="dashboard-heading">
            <h2>Danh sách món</h2>
            <Button onClick={() => setProductForm({})}>
              <Plus size={16} /> Thêm món
            </Button>
          </div>
          {productForm && (
            <ProductForm
              initial={productForm}
              onClose={() => setProductForm(null)}
              onSave={() => {
                setProductForm(null);
                reload();
              }}
            />
          )}
          {data.products.map((p: any) => (
            <div className="panel dashboard-product" key={p.id}>
              <img src={p.image_url} alt={p.name} />
              <div>
                <h3>{p.name}</h3>
                <p>
                  {money(p.price)} · {p.active ? "Đang sử dụng" : "Đã ẩn"}
                </p>
              </div>
              <Button secondary onClick={() => setProductForm(p)}>
                Chỉnh sửa
              </Button>
            </div>
          ))}
          {!data.products.length && (
            <Empty
              icon={Utensils}
              title="Chưa có món"
              body="Thêm sản phẩm để tạo thực đơn theo bữa."
            />
          )}
        </>
      )}
      {tab === "menu" && (
        <>
          <div className="panel toggle-row">
            <div>
              <strong>
                Bếp hôm nay {data.session?.is_open ? "đang mở" : "đang đóng"}
              </strong>
              <small>Món chỉ xuất hiện khi bếp mở và bữa còn giờ nhận</small>
            </div>
            <Button
              secondary={Boolean(data.session?.is_open)}
              onClick={() =>
                void run("chef/kitchen", { isOpen: !data.session?.is_open })
              }
            >
              {data.session?.is_open ? "Đóng bếp" : "Mở bếp hôm nay"}
            </Button>
          </div>
          {!c.account_no && (
            <Notice>
              Nhập tài khoản ngân hàng trong Cài đặt trước khi mở bếp.
            </Notice>
          )}
          {data.campaign && (
            <Notice>
              Sự kiện: {data.campaign.name}. Bạn có thể đặt giá sale cho món
              trong thực đơn.
            </Notice>
          )}
          <div className="dashboard-heading" style={{ marginTop: 22 }}>
            <h2>Thực đơn theo bữa</h2>
            <Button onClick={() => setMenuForm({})}>
              <Plus size={16} /> Thêm món vào bữa
            </Button>
          </div>
          {menuForm && (
            <MenuForm
              data={data}
              initial={menuForm}
              onClose={() => setMenuForm(null)}
              onSave={() => {
                setMenuForm(null);
                reload();
              }}
            />
          )}
          {data.meals.map((m: any) => (
            <div className="panel" key={m.id}>
              <div className="spread">
                <h2>{m.name}</h2>
                <small className="muted">
                  Hết nhận {m.cutoff_time}
                  {m.day_offset ? " ngày kế tiếp" : ""}
                </small>
              </div>
              {data.menu
                .filter((x: any) => x.meal_id === m.id)
                .map((item: any) => (
                  <div className="menu-item" key={item.id}>
                    <div>
                      <h3>{item.name}</h3>
                      <p>
                        Còn {item.stock} suất ·{" "}
                        {money(
                          data.campaign?.id === item.campaign_id
                            ? item.sale_price || item.price
                            : item.price,
                        )}{" "}
                        ·{" "}
                        {m.disabled
                          ? "Đã hết giờ nhận"
                          : item.enabled
                            ? "Đang nhận"
                            : "Tạm ngưng"}
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setMenuForm(item)}
                      disabled={m.disabled}
                    >
                      Điều chỉnh
                    </button>
                  </div>
                ))}
              {!data.menu.some((x: any) => x.meal_id === m.id) && (
                <div className="quiet-empty">Chưa thêm món cho bữa này.</div>
              )}
            </div>
          ))}
        </>
      )}
      {tab === "settings" && (
        <>
          <BankSettings chef={c} onSave={reload} />
          <SePaySettings />
          <KitchenSettings key={c.id} chef={c} onSave={reload} />
          <div className="panel form narrow">
            <h2>Hồ sơ riêng tư</h2>
            <FileUpload kind="document" onUploaded={() => reload()} />
            {data.assets.map((a: any) => (
              <a
                className="text-button"
                key={a.id}
                href={"/api/files/" + a.id}
                target="_blank"
                rel="noreferrer"
              >
                {a.original_name}
              </a>
            ))}
          </div>
        </>
      )}
    </>
  );
}
function KitchenSettings({ chef, onSave }: { chef: any; onSave: () => void }) {
  const { toast, refresh } = useApp();
  const [location, setKitchenLocation] = useState<ResolvedLocation | null>({
    address: chef.address,
    area: chef.area,
    lat: Number(chef.lat),
    lng: Number(chef.lng),
  });
  const [locationBusy, setLocationBusy] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="panel form narrow"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!location || locationBusy || busy) return;
        const fields = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        try {
          await post("chef/settings", {
            ...location,
            area: location.area || fields.get("area"),
            radiusKm: Number(fields.get("radius")),
            bio: fields.get("bio"),
          });
          onSave();
          refresh();
          toast("Đã lưu vị trí và vùng giao của bếp.");
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Thông tin và vùng giao</h2>
      <Field label="Giới thiệu">
        <textarea name="bio" defaultValue={chef.bio} disabled={busy} />
      </Field>
      <Field label="Bán kính giao (km)">
        <input
          name="radius"
          defaultValue={chef.radius_km}
          type="number"
          min="0.5"
          max="20"
          step="0.5"
          required
          disabled={busy}
        />
      </Field>
      <KitchenLocationPicker
        value={location}
        onChange={setKitchenLocation}
        onBusyChange={setLocationBusy}
        disabled={busy}
      />
      <Field label="Khu vực / phường">
        <input
          key={location?.area}
          name="area"
          defaultValue={location?.area || ""}
          readOnly={!!location?.area}
          required
          disabled={busy}
        />
      </Field>
      {error && <Notice error>{error}</Notice>}
      <Button type="submit" disabled={busy || locationBusy || !location}>
        {busy ? "Đang lưu…" : "Lưu cài đặt"}
      </Button>
    </form>
  );
}
function SectionTitle({ title }: { title: string }) {
  return (
    <div className="dashboard-heading">
      <h2>{title}</h2>
    </div>
  );
}
function ProductForm({
  initial,
  onClose,
  onSave,
}: {
  initial: any;
  onClose: () => void;
  onSave: () => void;
}) {
  const { toast } = useApp(),
    [image, setImage] = useState(initial.image_url || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await post(
        "chef/products" + (initial.id ? "/" + initial.id : ""),
        {
          name: f.get("name"),
          description: f.get("description"),
          ingredients: f.get("ingredients"),
          price: Number(f.get("price")),
          imageUrl: image,
          prepMinutes: Number(f.get("prep")),
          active: f.get("active") === "on",
        },
        initial.id ? "PATCH" : "POST",
      );
      toast("Đã lưu món.");
      onSave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel form narrow" onSubmit={save}>
      <div className="spread">
        <h2>{initial.id ? "Chỉnh sửa món" : "Thêm món"}</h2>
        <button type="button" className="text-button" onClick={onClose}>
          Đóng
        </button>
      </div>
      <Field label="Tên món">
        <input name="name" defaultValue={initial.name} required />
      </Field>
      <Field label="Mô tả">
        <textarea
          name="description"
          defaultValue={initial.description}
          required
          minLength={5}
        />
      </Field>
      <Field label="Thành phần / dị ứng">
        <textarea name="ingredients" defaultValue={initial.ingredients} />
      </Field>
      <div className="form-row">
        <Field label="Giá gốc (đ)">
          <input
            name="price"
            type="number"
            min="1000"
            defaultValue={initial.price || 40000}
            required
          />
        </Field>
        <Field label="Chuẩn bị (phút)">
          <input
            name="prep"
            type="number"
            min="5"
            max="180"
            defaultValue={initial.prep_minutes || 25}
            required
          />
        </Field>
      </div>
      <FileUpload onUploaded={setImage} />
      {image && (
        <img
          src={image}
          alt="Ảnh món"
          style={{ width: 100, height: 75, borderRadius: 8 }}
        />
      )}
      <Field label="URL ảnh đã tải lên">
        <input
          value={image}
          onChange={(e) => setImage(e.target.value)}
          placeholder="https://…public.blob.vercel-storage.com/…"
          required
        />
      </Field>
      <label className="label-checkbox">
        <input
          type="checkbox"
          name="active"
          defaultChecked={initial.active !== 0}
        />{" "}
        Cho phép dùng món trong thực đơn
      </label>
      {error && <Notice error>{error}</Notice>}
      <Button disabled={busy} type="submit">
        Lưu món
      </Button>
    </form>
  );
}
function MenuForm({
  data,
  initial,
  onClose,
  onSave,
}: {
  data: any;
  initial: any;
  onClose: () => void;
  onSave: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await post("chef/menu", {
        productId: f.get("product"),
        mealId: f.get("meal"),
        stock: Number(f.get("stock")),
        salePrice: f.get("sale") ? Number(f.get("sale")) : null,
        enabled: f.get("enabled") === "on",
      });
      onSave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel form narrow" onSubmit={save}>
      <div className="spread">
        <h2>Món trong thực đơn</h2>
        <button type="button" className="text-button" onClick={onClose}>
          Đóng
        </button>
      </div>
      <Field label="Sản phẩm">
        <select
          name="product"
          defaultValue={initial.product_id || data.products[0]?.id}
          required
        >
          {data.products
            .filter((p: any) => p.active)
            .map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </Field>
      <div className="form-row">
        <Field label="Bữa">
          <select
            name="meal"
            defaultValue={
              initial.meal_id ||
              data.meals.find((m: any) => !m.disabled)?.id ||
              "late"
            }
          >
            {data.meals.map((m: any) => (
              <option value={m.id} key={m.id} disabled={m.disabled}>
                {m.name} — {m.disabled ? "Đã hết giờ" : m.cutoff_time}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Số suất còn nhận">
          <input
            type="number"
            name="stock"
            min="0"
            max="1000"
            defaultValue={initial.stock ?? 15}
            required
          />
        </Field>
      </div>
      {data.campaign && (
        <Field label="Giá sale (đ), bỏ trống nếu không tham gia">
          <input
            name="sale"
            type="number"
            min="1000"
            defaultValue={initial.sale_price || ""}
          />
        </Field>
      )}
      <label className="label-checkbox">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={initial.enabled !== 0}
        />{" "}
        Nhận đặt món này
      </label>
      {error && <Notice error>{error}</Notice>}
      <Button type="submit" disabled={busy || !data.products.length}>
        Lưu vào thực đơn
      </Button>
    </form>
  );
}
function BankSettings({ chef, onSave }: { chef: any; onSave: () => void }) {
  const { data } = useLoad("banks"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      bank = data?.banks.find((b: any) => b.bin === f.get("bank"));
    setBusy(true);
    try {
      await post("chef/bank", {
        bankBin: f.get("bank"),
        bankName: bank?.shortName || bank?.name || "",
        accountNo: f.get("account"),
        accountName: f.get("name"),
      });
      onSave();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel form narrow" onSubmit={save}>
      <h2>Tài khoản nhận chuyển khoản</h2>
      <Field label="Ngân hàng">
        <select name="bank" defaultValue={chef.bank_bin || ""} required>
          <option value="">Chọn ngân hàng</option>
          {data?.banks.map((b: any) => (
            <option value={b.bin} key={b.bin}>
              {b.shortName || b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Số tài khoản">
        <input
          name="account"
          inputMode="numeric"
          defaultValue={chef.account_no || ""}
          required
          minLength={6}
        />
      </Field>
      <Field label="Tên chủ tài khoản">
        <input
          name="name"
          defaultValue={chef.account_name || ""}
          required
          placeholder="Tên đúng như ngân hàng hiển thị"
        />
      </Field>
      <p className="bank-note">
        QR của mỗi đơn dùng thông tin đã lưu tại lúc đặt. Thay tài khoản chỉ áp
        dụng cho đơn mới. Bật SePay bên dưới để tự xác nhận thanh toán.
      </p>
      {error && <Notice error>{error}</Notice>}
      <Button type="submit" disabled={busy}>
        Lưu tài khoản
      </Button>
    </form>
  );
}
export function AdminDashboard() {
  const { user, revision, toast, refresh } = useApp(),
    params = useSearchParams(),
    adminRouter = useRouter(),
    [tab, setTab] = useState(params.get("tab") || "overview"),
    { data, error, reload } = useLoad(
      user?.role === "admin" &&
        !["overview", "users", "chefs", "products"].includes(tab)
        ? "admin"
        : null,
      [revision],
    ),
    { data: orders, error: ordersError } = useLoad(
      user?.role === "admin" && tab === "orders"
        ? "admin/orders" +
            (params.get("filter") === "active" ? "?filter=active" : "")
        : null,
      [revision],
    ),
    [chefFilter, setChefFilter] = useState(params.get("chef") || ""),
    [form, setForm] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setTab(params.get("tab") || "overview");
    if (["orders", "products", "payments"].includes(params.get("tab") || ""))
      setChefFilter(params.get("chef") || "");
  }, [params]);
  function navigateAdmin(next: string, chef?: string, orderFilter?: string) {
    const p = new URLSearchParams(params.toString());
    p.set("tab", next);
    if (next !== "products") p.delete("product");
    p.delete("chef");
    if (["chefs", "orders", "products", "payments"].includes(next) && chef)
      p.set("chef", chef);
    p.delete("filter");
    if (next === "orders" && orderFilter === "active")
      p.set("filter", "active");
    if (["orders", "products", "payments"].includes(next))
      setChefFilter(chef || "");
    setTab(next);
    adminRouter.push("/admin?" + p.toString(), { scroll: false });
  }
  useEffect(() => {
    try {
      setCollapsed(
        localStorage.getItem("tgbd-admin-sidebar-collapsed") === "1",
      );
    } catch {}
  }, []);
  function toggleSidebar() {
    setCollapsed((value) => {
      try {
        localStorage.setItem("tgbd-admin-sidebar-collapsed", value ? "0" : "1");
      } catch {}
      return !value;
    });
  }
  if (!user) return <NeedLogin />;
  if (user.role !== "admin")
    return <Empty icon={ShieldCheck} title="Bạn không có quyền quản trị" />;
  async function run(path: string, body: unknown) {
    try {
      await post(path, body);
      reload();
      refresh();
      toast("Đã cập nhật.");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  const items: [string, string, typeof ChefHat][] = [
    ["overview", "Tổng quan", BarChart3],
    ["users", "Users", Users],
    ["chefs", "Chefs", ChefHat],
    ["products", "Sản phẩm", Utensils],
    ["orders", "Đơn hàng", ShoppingBag],
    ["settings", "Cài đặt", Settings],
    ["sale", "Sale", Ticket],
    ["news", "Tin tức", Newspaper],
    ["banners", "Banner", ImageIcon],
    ["vouchers", "Voucher", Ticket],
    ["payments", "Đối soát", Wallet],
  ];
  return (
    <div className="admin-layout" data-collapsed={collapsed}>
      <div className="admin-mobile-heading">
        <PageTitle title="Quản trị" subtitle="Vận hành hệ thống" />
      </div>
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <div className="admin-sidebar-brand">
            <ShieldCheck size={23} />
            <span>Quản trị</span>
          </div>
          <button
            type="button"
            className="icon-button admin-sidebar-toggle"
            aria-label={
              collapsed ? "Mở rộng menu quản trị" : "Thu gọn menu quản trị"
            }
            title={collapsed ? "Mở rộng menu" : "Thu gọn menu"}
            aria-expanded={!collapsed}
            aria-controls="admin-navigation"
            onClick={toggleSidebar}
          >
            {collapsed ? (
              <PanelLeftOpen size={20} />
            ) : (
              <PanelLeftClose size={20} />
            )}
          </button>
        </div>
        <nav
          id="admin-navigation"
          className="admin-navigation"
          aria-label="Các mục quản trị"
        >
          {items.map(([id, label, Icon]) => (
            <button
              type="button"
              key={id}
              className={tab === id ? "active" : ""}
              aria-label={label}
              title={label}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => navigateAdmin(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <Link
          href="/"
          className="admin-sidebar-exit"
          title="Xem ứng dụng"
          aria-label="Xem ứng dụng"
        >
          <House size={19} />
          <span>Xem ứng dụng</span>
        </Link>
      </aside>
      <section className="admin-content" aria-label="Nội dung quản trị">
        <PageTitle
          title={items.find(([id]) => id === tab)?.[1] || "Quản trị"}
          subtitle="Quản trị hệ thống"
        />
        {!["overview", "users", "chefs", "products"].includes(tab) &&
        (error || !data) ? (
          error ? (
            <Notice error>{error}</Notice>
          ) : (
            <PageLoading label="Đang tải quản trị…" />
          )
        ) : (
          <>
            {tab === "overview" && <AdminOverview onNavigate={navigateAdmin} />}
            {tab === "users" && <AdminUsers />}
            {tab === "chefs" && <AdminChefs onNavigate={navigateAdmin} />}
            {tab === "products" && <AdminProducts onNavigate={navigateAdmin} />}
            {tab === "orders" && (
              <div className="filter-row">
                <select
                  value={chefFilter}
                  onChange={(e) =>
                    navigateAdmin(
                      tab,
                      e.target.value,
                      params.get("filter") || undefined,
                    )
                  }
                  aria-label="Lọc bếp"
                >
                  <option value="">Tất cả bếp</option>
                  {data.chefs.map((c: any) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {tab === "orders" && (
              <>
                <div
                  className="analytics-presets"
                  aria-label="Lọc đơn quản trị"
                >
                  <button
                    type="button"
                    className={
                      params.get("filter") !== "active" ? "active" : ""
                    }
                    onClick={() => navigateAdmin("orders", chefFilter)}
                  >
                    Tất cả
                  </button>
                  <button
                    type="button"
                    className={
                      params.get("filter") === "active" ? "active" : ""
                    }
                    onClick={() =>
                      navigateAdmin("orders", chefFilter, "active")
                    }
                  >
                    Đang xử lý
                  </button>
                </div>
                {ordersError && <Notice error>{ordersError}</Notice>}
                {!orders && !ordersError && (
                  <PageLoading label="Đang tải đơn…" />
                )}
                {chefFilter && orders && (
                  <Notice>
                    Doanh số hoàn thành trong danh sách:{" "}
                    {money(
                      (orders?.orders || [])
                        .filter(
                          (o: any) =>
                            o.chef_id === chefFilter &&
                            o.status === "COMPLETED",
                        )
                        .reduce((a: number, o: any) => a + o.total, 0),
                    )}
                  </Notice>
                )}
                {orders?.orders
                  .filter((o: any) => !chefFilter || o.chef_id === chefFilter)
                  .map((o: any) => (
                    <OrderCard key={o.id} order={o} />
                  ))}
                {orders &&
                  !orders.orders.some(
                    (o: any) => !chefFilter || o.chef_id === chefFilter,
                  ) && (
                    <Empty
                      icon={ShoppingBag}
                      title={
                        params.get("filter") === "active"
                          ? "Không có đơn đang xử lý"
                          : "Chưa có đơn trong danh sách"
                      }
                    />
                  )}
              </>
            )}
            {tab === "settings" && (
              <>
                <SectionTitle title="Giờ hết nhận theo bữa" />
                {data.meals.map((m: any) => (
                  <form
                    key={m.id}
                    className="panel form narrow"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run("admin/meals/" + m.id, {
                        cutoff: f.get("cutoff"),
                        dayOffset: Number(f.get("offset")),
                      });
                    }}
                  >
                    <h2>{m.name}</h2>
                    <div className="form-row">
                      <Field label="Giờ cuối nhận đơn">
                        <input
                          name="cutoff"
                          type="time"
                          defaultValue={m.cutoff_time}
                          required
                        />
                      </Field>
                      <Field label="Ngày hết nhận">
                        <select name="offset" defaultValue={m.day_offset}>
                          <option value="0">Cùng ngày</option>
                          <option value="1">Ngày kế tiếp</option>
                        </select>
                      </Field>
                    </div>
                    <Button type="submit">Lưu giờ bữa</Button>
                  </form>
                ))}
                <form
                  className="panel form narrow"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run("admin/delivery", {
                      baseFee: Number(f.get("base")),
                      perKm: Number(f.get("km")),
                    });
                  }}
                >
                  <h2>Phí giao</h2>
                  <div className="form-row">
                    <Field label="Phí cơ bản (đ)">
                      <input
                        name="base"
                        type="number"
                        min="0"
                        defaultValue={
                          (typeof data.delivery === "string"
                            ? JSON.parse(data.delivery)
                            : data.delivery
                          )?.baseFee || 0
                        }
                      />
                    </Field>
                    <Field label="Phí mỗi km đường đi (đ)">
                      <input
                        name="km"
                        type="number"
                        min="0"
                        defaultValue={
                          (typeof data.delivery === "string"
                            ? JSON.parse(data.delivery)
                            : data.delivery
                          )?.perKm || 0
                        }
                      />
                    </Field>
                  </div>
                  <Notice>
                    Phí theo km yêu cầu cấu hình Goong để tính đường đi.
                  </Notice>
                  <Button type="submit">Lưu phí giao</Button>
                </form>
              </>
            )}
            {tab === "sale" && (
              <>
                <div className="dashboard-heading">
                  <h2>Sự kiện giảm giá</h2>
                  <Button
                    onClick={() =>
                      setForm(form === "campaign" ? "" : "campaign")
                    }
                  >
                    <Plus size={16} /> Tạo sự kiện
                  </Button>
                </div>
                {form === "campaign" && (
                  <form
                    className="panel form narrow"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run("admin/campaigns", {
                        name: f.get("name"),
                        active: true,
                        startsAt: new Date(
                          String(f.get("start")),
                        ).toISOString(),
                        endsAt: new Date(String(f.get("end"))).toISOString(),
                      });
                      setForm("");
                    }}
                  >
                    <Field label="Tên sự kiện">
                      <input name="name" required />
                    </Field>
                    <div className="form-row">
                      <Field label="Bắt đầu">
                        <input name="start" type="datetime-local" required />
                      </Field>
                      <Field label="Kết thúc">
                        <input name="end" type="datetime-local" required />
                      </Field>
                    </div>
                    <Button type="submit">Tạo & bật sự kiện</Button>
                  </form>
                )}
                {data.campaigns.map((c: any) => (
                  <div className="panel spread" key={c.id}>
                    <div>
                      <h3>{c.name}</h3>
                      <p className="muted small">
                        {c.active ? "Đang bật" : "Đã tắt"}
                      </p>
                    </div>
                    <Button
                      secondary
                      onClick={() =>
                        void run("admin/campaigns/" + c.id, {
                          name: c.name,
                          active: !c.active,
                          startsAt: new Date(
                            c.starts_at.replace(" ", "T") + "Z",
                          ).toISOString(),
                          endsAt: new Date(
                            c.ends_at.replace(" ", "T") + "Z",
                          ).toISOString(),
                        })
                      }
                    >
                      {c.active ? "Tắt sale" : "Bật sale"}
                    </Button>
                  </div>
                ))}
              </>
            )}
            {tab === "news" && (
              <form
                className="panel form narrow"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run("admin/news", {
                    title: f.get("title"),
                    body: f.get("body"),
                    audience: f.get("audience"),
                  });
                }}
              >
                <h2>Gửi tin tức</h2>
                <Field label="Người nhận">
                  <select name="audience">
                    <option value="all">Tất cả</option>
                    <option value="user">Users</option>
                    <option value="chef">Chefs</option>
                  </select>
                </Field>
                <Field label="Tiêu đề">
                  <input name="title" required minLength={3} />
                </Field>
                <Field label="Nội dung">
                  <textarea name="body" rows={5} required minLength={5} />
                </Field>
                <Button type="submit">Gửi thông báo</Button>
              </form>
            )}
            {tab === "banners" && (
              <>
                <BannerForm onSave={reload} />
                {data.banners.map((b: any) => (
                  <div className="panel spread" key={b.id}>
                    <div>
                      <h3>{b.title}</h3>
                      <p className="muted small">{b.body}</p>
                    </div>
                    <Button
                      secondary
                      onClick={() =>
                        void run("admin/banners/" + b.id, {
                          title: b.title,
                          body: b.body,
                          imageUrl: b.image_url,
                          href: b.href,
                          active: !b.active,
                        })
                      }
                    >
                      {b.active ? "Ẩn" : "Hiển thị"}
                    </Button>
                  </div>
                ))}
              </>
            )}
            {tab === "vouchers" && (
              <>
                <VoucherForm chefs={data.chefs} onSave={reload} />
                {data.vouchers.map((v: any) => (
                  <div className="panel spread" key={v.id}>
                    <div>
                      <h3>{v.title}</h3>
                      <p className="muted small">
                        {v.code} · {v.chef_name} · Đã dùng {v.used_count}/
                        {v.max_uses}
                      </p>
                    </div>
                    <strong>{money(v.discount_amount)}</strong>
                  </div>
                ))}
              </>
            )}
            {tab === "payments" && (
              <>
                {chefFilter && (
                  <Notice>
                    Đang xem đối soát của bếp đã chọn.{" "}
                    <button
                      className="text-button"
                      onClick={() => navigateAdmin("payments")}
                    >
                      Xem tất cả
                    </button>
                  </Notice>
                )}
                {data.exceptions
                  .filter((e: any) => !chefFilter || e.chef_id === chefFilter)
                  .map((e: any) => (
                    <div className="panel" key={e.id}>
                      <div className="spread">
                        <h3>Đơn #{e.code}</h3>
                        <span className="status" data-status={e.status}>
                          {PAYMENT_REQUEST_STATUSES[e.status] || e.status}
                        </span>
                      </div>
                      <p className="muted small">
                        {PAYMENT_REQUEST_KINDS[e.kind] || e.kind} ·{" "}
                        {money(e.amount)}
                      </p>
                      <p className="muted small">
                        {e.customer_name} · {e.chef_name}
                      </p>
                      {e.contact_phone && (
                        <p className="small">
                          Số điện thoại liên hệ: {e.contact_phone}
                        </p>
                      )}
                      <p style={{ margin: "12px 0", fontSize: 12 }}>{e.note}</p>
                      <Link
                        className="text-button"
                        href={"/orders/" + e.order_id}
                      >
                        Xem đơn
                      </Link>
                      {e.customer_request_id && (
                        <>
                          <PaymentRequestEvidence value={e} />
                          {e.review_note && (
                            <Notice>Hệ thống: {e.review_note}</Notice>
                          )}
                          {e.status === "OPEN" && (
                            <p className="muted small">
                              Đang chờ bếp gửi bằng chứng giải quyết.
                            </p>
                          )}
                          {e.status === "REVIEW" && (
                            <AdminPaymentRequestReview
                              value={e}
                              onChange={reload}
                            />
                          )}
                        </>
                      )}
                      {!e.customer_request_id && e.status === "OPEN" && (
                        <div className="form-row">
                          <Button
                            secondary
                            onClick={() =>
                              void run("admin/exceptions/" + e.id, {
                                status: "RESOLVED",
                                note: "Quản trị đã kiểm tra và giải quyết.",
                              })
                            }
                          >
                            Đã giải quyết
                          </Button>
                          <Button
                            secondary
                            onClick={() => {
                              const note = prompt(
                                "Thông tin đã kiểm tra tiền hoàn:",
                              );
                              if (note)
                                void run("admin/exceptions/" + e.id, {
                                  status: "REFUNDED",
                                  note,
                                });
                            }}
                          >
                            Đã xác nhận hoàn tiền
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                {!data.exceptions.some(
                  (e: any) => !chefFilter || e.chef_id === chefFilter,
                ) && <Empty icon={Wallet} title="Chưa có yêu cầu đối soát" />}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
function BannerForm({ onSave }: { onSave: () => void }) {
  const { toast } = useApp(),
    [image, setImage] = useState(""),
    [error, setError] = useState("");
  return (
    <form
      className="panel form narrow"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          await post("admin/banners", {
            title: f.get("title"),
            body: f.get("body"),
            imageUrl: image || null,
            href: f.get("href"),
            active: true,
          });
          onSave();
          toast("Đã thêm banner.");
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <h2>Thêm banner</h2>
      <Field label="Tiêu đề">
        <input name="title" required minLength={3} />
      </Field>
      <Field label="Nội dung">
        <textarea name="body" rows={2} />
      </Field>
      <FileUpload onUploaded={setImage} />
      <Field label="Trang đích">
        <input name="href" defaultValue="/nearby" required />
      </Field>
      {error && <Notice error>{error}</Notice>}
      <Button type="submit">Lưu banner</Button>
    </form>
  );
}
function VoucherForm({ chefs, onSave }: { chefs: any[]; onSave: () => void }) {
  const { toast } = useApp(),
    [error, setError] = useState("");
  return (
    <form
      className="panel form narrow"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          await post("admin/vouchers", {
            code: String(f.get("code")).toUpperCase(),
            title: f.get("title"),
            chefId: f.get("chef"),
            discountAmount: Number(f.get("amount")),
            minSubtotal: Number(f.get("min")),
            maxUses: Number(f.get("uses")),
            expiresAt: new Date(String(f.get("expires"))).toISOString(),
            active: true,
          });
          onSave();
          toast("Đã tạo voucher.");
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <h2>Tạo voucher</h2>
      <div className="form-row">
        <Field label="Mã">
          <input name="code" required />
        </Field>
        <Field label="Bếp áp dụng">
          <select name="chef">
            {chefs
              .filter((c) => c.status === "approved")
              .map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Field label="Tên voucher">
        <input name="title" required />
      </Field>
      <div className="form-row">
        <Field label="Giảm (đ)">
          <input name="amount" type="number" min="1000" defaultValue="10000" />
        </Field>
        <Field label="Đơn tối thiểu (đ)">
          <input name="min" type="number" min="0" defaultValue="50000" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Số lượt tối đa">
          <input name="uses" type="number" min="1" defaultValue="100" />
        </Field>
        <Field label="Hết hạn">
          <input name="expires" type="datetime-local" required />
        </Field>
      </div>
      <Notice>
        Voucher áp dụng cho bếp cụ thể. Cần thỏa thuận chef tài trợ hoặc quyết
        toán phần nền tảng tài trợ trước khi sử dụng.
      </Notice>
      {error && <Notice error>{error}</Notice>}
      <Button type="submit">Tạo voucher</Button>
    </form>
  );
}
