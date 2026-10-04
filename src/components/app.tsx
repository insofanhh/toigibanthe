"use client";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
  type FormEvent,
} from "react";
import dynamic from "next/dynamic";
import { Link, PageMotion } from "./page-motion";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  House,
  ShoppingBag,
  Heart,
  Bell,
  UserRound,
  Search,
  MapPin,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Plus,
  Minus,
  Star,
  Clock,
  ChefHat,
  Sun,
  Sunrise,
  Moon,
  Sunset,
  SlidersHorizontal,
  X,
  Check,
  Settings,
  Ticket,
  HelpCircle,
  ShieldCheck,
  LogOut,
  LocateFixed,
  LoaderCircle,
  Copy,
  Download,
  CheckCircle2,
  Truck,
  Utensils,
  Wallet,
  ArrowUpRight,
  Mail,
} from "lucide-react";
import { useApp, request, post } from "./providers";
import { AddressPicker } from "./address-picker";
import {
  CustomerPaymentRequestForm,
  PaymentRequestList,
} from "./payment-requests";
import {
  money,
  MEAL_NAMES,
  ORDER_LABELS,
  ORDER_NEXT,
  PAYMENT_REQUEST_STATUSES,
  type Dish,
  type Feed,
  type MealId,
} from "@/lib/domain";
const ChefDashboard = dynamic(
  () => import("./dashboard").then((m) => m.ChefDashboard),
  { loading: () => <div className="loading">Đang tải bếp…</div> },
);
const AdminDashboard = dynamic(
  () => import("./dashboard").then((m) => m.AdminDashboard),
  { loading: () => <div className="loading">Đang tải quản trị…</div> },
);
const ChefApplication = dynamic(() =>
  import("./dashboard").then((m) => m.ChefApplication),
);
const DeliveryMap = dynamic(
  () => import("./delivery-map").then((m) => m.DeliveryMap),
  {
    ssr: false,
    loading: () => <div className="loading">Đang tải bản đồ…</div>,
  },
);
const fallbackLocation = {
  address: "Quận 3, TP. Hồ Chí Minh",
  lat: 10.7817,
  lng: 106.6809,
};
export function useLoad<T = any>(
  path: string | null,
  dependencies: unknown[] = [],
  initial: T | null = null,
) {
  const [data, setData] = useState<T | null>(initial),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(!initial),
    seq = useRef(0);
  const reload = useCallback(() => {
    const current = ++seq.current;
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    request<T>(path)
      .then((value) => {
        if (seq.current === current) {
          setData(value);
          setError("");
        }
      })
      .catch((e) => {
        if (seq.current === current) setError(e.message);
      })
      .finally(() => {
        if (seq.current === current) setLoading(false);
      });
  }, [path]);
  useEffect(() => {
    reload();
  }, [reload, ...dependencies]);
  useEffect(() => {
    if (!path?.startsWith("catalog")) return;
    const interval = setInterval(reload, 30000);
    window.addEventListener("focus", reload);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", reload);
    };
  }, [path, reload]);
  useEffect(() => {
    const catalog = data as Feed | null;
    if (!catalog?.meals || !catalog.meals.every((m) => m.cutoffAt)) return;
    const deadlines = [...catalog.meals, ...(catalog.dishes || [])]
      .map((item) => new Date(item.cutoffAt).getTime())
      .filter((time) => time > Date.now());
    const midnight = new Date();
    midnight.setTime(midnight.getTime() + 7 * 3600000);
    midnight.setUTCHours(24, 0, 0, 0);
    const next = Math.min(...deadlines, midnight.getTime() - 7 * 3600000);
    const timer = setTimeout(reload, Math.max(100, next - Date.now() + 100));
    return () => clearTimeout(timer);
  }, [data, reload]);
  return { data, error, loading, reload, setData };
}
export function Button({
  children,
  onClick,
  type = "button",
  disabled = false,
  secondary = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  secondary?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      className={`${secondary ? "button secondary" : "button"} ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Empty({
  icon: Icon = ShoppingBag,
  title,
  body,
  children,
}: {
  icon?: typeof ShoppingBag;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={28} strokeWidth={1.3} />
      </div>
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {children}
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : undefined}
    >
      {children}
    </div>
  );
}
export function PageTitle({
  title,
  subtitle,
  back = false,
  children,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="page-title">
      <div>
        {back && (
          <button
            type="button"
            className="back"
            onClick={() => {
              if (window.history.length > 1) router.back();
              else router.replace("/", { transitionTypes: ["page-back"] });
            }}
          >
            <ArrowLeft size={17} /> Trở về
          </button>
        )}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
function Nav() {
  const path = usePathname(),
    { unread } = useApp();
  const items = [
    ["/", "Home", House],
    ["/orders", "Đơn hàng", ShoppingBag],
    ["/favorites", "Thích", Heart],
    ["/notifications", "Thông báo", Bell],
    ["/me", "Tôi", UserRound],
  ] as const;
  return (
    <nav className="bottom-nav" aria-label="Điều hướng chính">
      {items.map(([href, label, Icon]) => (
        <Link
          key={href}
          href={href}
          className={
            (href === "/" ? path === "/" : path.startsWith(href))
              ? "active"
              : ""
          }
        >
          <span className="nav-icon">
            <Icon size={21} strokeWidth={1.6} />
            {href === "/notifications" && unread > 0 && (
              <span className="badge">{unread > 9 ? "9+" : unread}</span>
            )}
          </span>
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
function Header() {
  const { location, setLocationOpen } = useApp();
  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="brand">
          <span className="brand-symbol">
            <ChefHat size={23} strokeWidth={1.6} />
          </span>
          <span>Tôi gì, bạn đó!</span>
        </Link>
        <button
          className="delivery-header"
          onClick={() => setLocationOpen(true)}
        >
          <MapPin size={18} />
          <span>
            <small>Giao đến</small>
            <strong>{location?.address || "Chọn địa chỉ giao"}</strong>
          </span>
          <ChevronDown size={15} />
        </button>
      </div>
    </header>
  );
}
function CartDock() {
  const { cart } = useApp(),
    path = usePathname();
  if (
    !cart.length ||
    ["/cart", "/checkout"].includes(path) ||
    path.startsWith("/orders/") ||
    path.startsWith("/admin") ||
    path.startsWith("/chef")
  )
    return null;
  const count = cart.reduce((a, x) => a + x.quantity, 0),
    total = cart.reduce((a, x) => a + x.quantity * x.dish.price, 0);
  return (
    <Link href="/cart" className="cart-dock">
      <span className="cart-count">{count}</span>
      <span>
        Xem giỏ hàng <small>{cart[0].dish.chefName}</small>
      </span>
      <strong>{money(total)}</strong>
      <ChevronRight size={17} />
    </Link>
  );
}
export function App({ initialFeed = null }: { initialFeed?: Feed | null }) {
  const path = usePathname();
  const searchParams = useSearchParams();
  let content: ReactNode;
  if (path === "/") content = <Home initialFeed={initialFeed} />;
  else if (
    ["/nearby", "/recommended", "/offers", "/search"].includes(path) ||
    path.startsWith("/meal/")
  )
    content = <DishList />;
  else if (path.startsWith("/dishes/"))
    content = <DishDetail id={path.split("/")[2]} />;
  else if (path === "/chefs" || path.startsWith("/chefs/"))
    content = <Chefs id={path.split("/")[2]} />;
  else if (path === "/orders") content = <Orders />;
  else if (path.startsWith("/orders/"))
    content = <OrderDetail id={path.split("/")[2]} />;
  else if (path === "/favorites") content = <Favorites />;
  else if (path === "/notifications") content = <Notifications />;
  else if (path === "/me") content = <Profile />;
  else if (path === "/me/addresses") content = <Addresses />;
  else if (path === "/me/vouchers") content = <Vouchers />;
  else if (path === "/me/settings") content = <ProfileSettings />;
  else if (path === "/cart") content = <Cart />;
  else if (path === "/checkout") content = <Checkout />;
  else if (path === "/login") content = <Login />;
  else if (path === "/chef/apply") content = <ChefApplication />;
  else if (path === "/chef") content = <ChefDashboard />;
  else if (path === "/admin") content = <AdminDashboard />;
  else if (path === "/help" || path === "/privacy")
    content = <Information privacy={path === "/privacy"} />;
  else
    content = (
      <Empty title="Không tìm thấy trang">
        <Link href="/" className="button">
          Về trang chủ
        </Link>
      </Empty>
    );
  return (
    <>
      {path === "/" && <Header />}
      <main
        className={`main ${path === "/admin" || path === "/chef" ? "dashboard-main" : ""}`}
      >
        <PageMotion pageKey={`${path}?${searchParams.toString()}`}>
          {content}
        </PageMotion>
      </main>
      <CartDock />
      <Nav />
      <LocationSheet />
    </>
  );
}
function feedPath(location: ReturnType<typeof useApp>["location"], extra = "") {
  const p = location || fallbackLocation;
  return `catalog?lat=${p.lat}&lng=${p.lng}${extra}`;
}
function LoadingCards() {
  return (
    <div className="dish-grid">
      {Array.from({ length: 4 }, (_, i) => (
        <div className="skeleton-card" key={i}>
          <div className="skeleton image" />
          <div className="skeleton line" />
          <div className="skeleton line short" />
        </div>
      ))}
    </div>
  );
}
function SearchBox({ initial = "" }: { initial?: string }) {
  const [text, setText] = useState(initial),
    router = useRouter();
  return (
    <form
      className="search-box"
      onSubmit={(e) => {
        e.preventDefault();
        router.push("/search?q=" + encodeURIComponent(text), {
          transitionTypes: ["page-forward"],
        });
      }}
    >
      <Search size={20} strokeWidth={1.5} />
      <input
        aria-label="Tìm món ăn hoặc tên bếp"
        placeholder="Tìm món ăn hoặc tên bếp"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" aria-label="Tìm kiếm">
        <ArrowRight size={18} />
      </button>
    </form>
  );
}
function Meals({ meals }: { meals: Feed["meals"] }) {
  const icons = { breakfast: Sunrise, lunch: Sun, dinner: Sunset, late: Moon };
  return (
    <div className="meal-grid">
      {meals.map((m) => {
        const Icon = icons[m.id];
        return (
          <Link
            href={m.disabled ? "#" : "/meal/" + m.id}
            key={m.id}
            className={`meal ${m.disabled ? "disabled" : ""}`}
            aria-disabled={m.disabled}
            onClick={(e) => {
              if (m.disabled) e.preventDefault();
            }}
          >
            <span className={`meal-icon ${m.id}`}>
              <Icon size={27} strokeWidth={1.35} />
            </span>
            <span>
              {m.name}
              <small>
                {m.disabled ? "Đã hết giờ nhận" : `Nhận đến ${m.cutoff}`}
              </small>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
function Section({
  title,
  subtitle,
  href,
  children,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {href && (
          <Link href={href}>
            Xem thêm <ChevronRight size={15} />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
export function DishCard({ dish }: { dish: Dish }) {
  const { user, toast, add, refresh } = useApp(),
    [liked, setLiked] = useState(dish.liked),
    [busy, setBusy] = useState(false);
  useEffect(() => setLiked(dish.liked), [dish.liked]);
  async function like() {
    if (!user) {
      toast("Đăng nhập để lưu món yêu thích.");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await post("favorites", { productId: dish.id, liked: !liked });
      setLiked(!liked);
      refresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="dish-card">
      <div className="dish-photo">
        <Link href={"/dishes/" + dish.id}>
          <Image
            src={dish.image}
            alt={dish.name}
            fill
            sizes="(max-width: 600px) 50vw, 280px"
          />
        </Link>
        {dish.price < dish.originalPrice && (
          <span className="sale-label">
            −{Math.round((1 - dish.price / dish.originalPrice) * 100)}%
          </span>
        )}
        <button
          className={`like-button ${liked ? "liked" : ""}`}
          onClick={like}
          disabled={busy}
          aria-label={liked ? "Bỏ thích " + dish.name : "Thích " + dish.name}
        >
          <Heart
            size={17}
            strokeWidth={1.5}
            fill={liked ? "currentColor" : "none"}
          />
        </button>
      </div>
      <div className="dish-body">
        <Link href={"/dishes/" + dish.id} className="dish-name">
          {dish.name}
        </Link>
        <Link className="chef-caption" href={"/chefs/" + dish.chefId}>
          {dish.chefName}
        </Link>
        <div className="dish-meta">
          <span>
            <Star size={12} fill="currentColor" />
            {dish.rating ? dish.rating.toFixed(1) : "Mới"}
            {dish.ratingCount > 0 && <small>({dish.ratingCount})</small>}
          </span>
          <span className="dot">·</span>
          <span>{dish.distance.toFixed(1)} km</span>
          <span className="dot">·</span>
          <span>{dish.prepMinutes} phút</span>
        </div>
        <div className="dish-bottom">
          <div>
            <strong>{money(dish.price)}</strong>
            {dish.price < dish.originalPrice && (
              <del>{money(dish.originalPrice)}</del>
            )}
          </div>
          <button
            className="add-button"
            onClick={() => add(dish)}
            aria-label={"Thêm " + dish.name}
          >
            <Plus size={18} />
          </button>
        </div>
      </div>
    </article>
  );
}
function ChefCards({ chefs }: { chefs: Feed["chefs"] }) {
  return (
    <div className="chef-grid">
      {chefs.map((c) => (
        <Link className="chef-card" key={c.id} href={"/chefs/" + c.id}>
          <div className="chef-avatar">
            <Image
              src={c.avatar || "/icon.svg"}
              alt={c.name}
              fill
              sizes="64px"
            />
          </div>
          <h3>{c.name}</h3>
          <p>{c.area}</p>
          <div className="dish-meta">
            <span>
              <Star size={12} fill="currentColor" />
              {c.rating ? c.rating.toFixed(1) : "Mới"}
            </span>
            <span>·</span>
            <span>{c.distance.toFixed(1)} km</span>
          </div>
          <small>{c.completedOrders} đơn hoàn thành</small>
        </Link>
      ))}
    </div>
  );
}
function Home({ initialFeed }: { initialFeed: Feed | null }) {
  const { location, revision, setLocationOpen } = useApp(),
    { data, error, loading, reload } = useLoad<Feed>(
      feedPath(location),
      [revision],
      initialFeed,
    ),
    router = useRouter();
  const recommended = data
    ? [...data.dishes]
        .sort(
          (a, b) =>
            (b.rating * b.ratingCount) / (b.ratingCount + 10) -
            (a.rating * a.ratingCount) / (a.ratingCount + 10),
        )
        .slice(0, 10)
    : [];
  return (
    <>
      <div className="home-search">
        <SearchBox />
        <Link href="/search" className="filter-button" aria-label="Bộ lọc món">
          <SlidersHorizontal size={19} />
        </Link>
      </div>
      {!location && (
        <button className="area-note" onClick={() => setLocationOpen(true)}>
          <MapPin size={14} /> Đang xem khu vực Quận 3, TP.HCM{" "}
          <span>
            Đổi địa chỉ <ChevronRight size={13} />
          </span>
        </button>
      )}
      {error ? (
        <Notice error>
          {error} <button onClick={reload}>Thử lại</button>
        </Notice>
      ) : loading && !data ? (
        <LoadingCards />
      ) : (
        data && (
          <>
            {data.banners[0] && (
              <Link href={data.banners[0].href} className="home-banner">
                <div>
                  <span className="eyebrow">THỰC ĐƠN TRONG KHU VỰC</span>
                  <h1>{data.banners[0].title}</h1>
                  <p>{data.banners[0].body}</p>
                  <span className="banner-link">
                    Xem thực đơn <ArrowRight size={15} />
                  </span>
                </div>
                {data.banners[0].image_url ? (
                  <div className="banner-image">
                    <Image
                      src={data.banners[0].image_url}
                      alt=""
                      fill
                      sizes="250px"
                    />
                  </div>
                ) : (
                  <div className="banner-art">
                    <div className="bowl">
                      <Utensils size={38} strokeWidth={1.1} />
                    </div>
                    <span className="leaf one" />
                    <span className="leaf two" />
                  </div>
                )}
              </Link>
            )}
            <Meals meals={data.meals} />
            <Section
              title="Gần bạn"
              subtitle="Các món đang nhận đặt trong khu vực"
              href="/nearby"
            >
              {data.dishes.length ? (
                <div className="dish-scroll">
                  {data.dishes.slice(0, 10).map((d) => (
                    <DishCard key={d.menuId} dish={d} />
                  ))}
                </div>
              ) : (
                <Empty
                  title="Chưa có món đang nhận đặt"
                  body="Thử đổi địa chỉ hoặc quay lại vào bữa tiếp theo."
                />
              )}
            </Section>
            {data.campaign &&
              data.dishes.some((d) => d.price < d.originalPrice) && (
                <Section
                  title="Giảm giá"
                  subtitle={data.campaign.name}
                  href="/offers"
                >
                  <div className="dish-scroll">
                    {data.dishes
                      .filter((d) => d.price < d.originalPrice)
                      .slice(0, 10)
                      .map((d) => (
                        <DishCard key={d.menuId} dish={d} />
                      ))}
                  </div>
                </Section>
              )}
            {recommended.length > 0 && (
              <Section
                title="Nên thử"
                subtitle="Được đánh giá tốt từ những đơn đã hoàn thành"
                href="/recommended"
              >
                <div className="dish-scroll">
                  {recommended.map((d) => (
                    <DishCard key={d.menuId} dish={d} />
                  ))}
                </div>
              </Section>
            )}
            {data.chefs.length > 0 && (
              <Section
                title="Gợi ý chef"
                subtitle="Các bếp đang nhận đơn gần khu vực của bạn"
                href="/chefs"
              >
                <ChefCards
                  chefs={[...data.chefs]
                    .sort((a, b) => b.rating - a.rating)
                    .slice(0, 4)}
                />
              </Section>
            )}
          </>
        )
      )}
      <div className="home-footer">
        <ChefHat size={18} />
        <span>Tôi gì, bạn đó!</span>
        <Link href="/help">Trung tâm trợ giúp</Link>
      </div>
    </>
  );
}
function DishList() {
  const path = usePathname(),
    params = useSearchParams(),
    { location, revision } = useApp(),
    [sort, setSort] = useState("near"),
    [maxPrice, setMaxPrice] = useState(""),
    [all, setAll] = useState<Dish[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [more, setMore] = useState(false),
    [moreError, setMoreError] = useState("");
  const meal = path.startsWith("/meal/") ? path.split("/")[2] : "",
    query = params.get("q") || "",
    extra = `&limit=20${meal ? "&meal=" + meal : ""}${path === "/offers" ? "&sale=true" : ""}${query ? "&q=" + encodeURIComponent(query) : ""}`;
  const { data, error, loading } = useLoad<Feed>(feedPath(location, extra), [
    revision,
  ]);
  useEffect(() => {
    if (data) {
      setAll(data.dishes);
      setCursor(data.cursor);
    }
  }, [data]);
  const loadMore = useCallback(async () => {
    if (cursor === null || more) return;
    setMore(true);
    try {
      const d = await request<Feed>(
        feedPath(location, extra + "&cursor=" + cursor),
      );
      setAll((old) => [
        ...new Map([...old, ...d.dishes].map((d) => [d.menuId, d])).values(),
      ]);
      setCursor(d.cursor);
      setMoreError("");
    } catch (e) {
      setMoreError((e as Error).message);
    } finally {
      setMore(false);
    }
  }, [cursor, more, location, extra]);
  useEffect(() => {
    if (cursor === null || moreError) return;
    const node = document.getElementById("load-more");
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "100px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore, moreError]);
  const title = meal
    ? MEAL_NAMES[meal as MealId]
    : path === "/offers"
      ? "Giảm giá"
      : path === "/recommended"
        ? "Nên thử"
        : path === "/search"
          ? "Tìm món"
          : "Gần bạn";
  const list = all
    .filter((d) => !maxPrice || d.price <= Number(maxPrice))
    .sort((a, b) =>
      sort === "price"
        ? a.price - b.price
        : sort === "rating" || path === "/recommended"
          ? (b.rating * b.ratingCount) / (b.ratingCount + 10) -
            (a.rating * a.ratingCount) / (a.ratingCount + 10)
          : a.distance - b.distance,
    );
  return (
    <>
      <PageTitle
        title={title}
        subtitle={
          query
            ? `Kết quả cho “${query}”`
            : "Món đang nhận đặt tại địa chỉ đã chọn"
        }
        back
      />
      <SearchBox initial={query} />
      <div className="filter-row">
        <select
          aria-label="Sắp xếp"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="near">Gần nhất</option>
          <option value="rating">Đánh giá tốt</option>
          <option value="price">Giá thấp trước</option>
        </select>
        <select
          aria-label="Mức giá"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
        >
          <option value="">Tất cả mức giá</option>
          <option value="35000">Dưới 35.000đ</option>
          <option value="50000">Dưới 50.000đ</option>
          <option value="70000">Dưới 70.000đ</option>
        </select>
        <span>{list.length} món đã tải</span>
      </div>
      {error ? (
        <Notice error>{error}</Notice>
      ) : loading && !data ? (
        <LoadingCards />
      ) : list.length ? (
        <div className="dish-grid">
          {list.map((d) => (
            <DishCard key={d.menuId} dish={d} />
          ))}
        </div>
      ) : (
        <Empty
          title="Chưa tìm thấy món phù hợp"
          body="Thử đổi từ khóa, mức giá hoặc địa chỉ."
        />
      )}
      <div id="load-more" className="list-end">
        {more ? (
          <LoaderCircle className="spin" size={20} />
        ) : cursor !== null ? (
          <Button secondary onClick={() => void loadMore()}>
            Tải thêm món
          </Button>
        ) : list.length > 0 ? (
          "Bạn đã xem hết món trong danh sách."
        ) : null}
        {moreError && <Notice error>{moreError}</Notice>}
      </div>
    </>
  );
}
function DishDetail({ id }: { id: string }) {
  const { location, revision, add } = useApp(),
    { data, error, loading } = useLoad<Feed>(
      feedPath(location, "&product=" + encodeURIComponent(id)),
      [revision],
    );
  const d = data?.dishes.find((d) => d.id === id);
  if (loading && !data) return <LoadingCards />;
  if (error) return <Notice error>{error}</Notice>;
  if (!d)
    return (
      <Empty
        title="Món hiện chưa nhận đặt"
        body="Món có thể đã hết suất, hết giờ bữa hoặc ngoài bán kính giao."
      >
        <Link href="/" className="button">
          Chọn món khác
        </Link>
      </Empty>
    );
  return (
    <>
      <PageTitle title={d.name} back />
      <div className="detail-grid">
        <div className="detail-photo">
          <Image
            src={d.image}
            alt={d.name}
            fill
            sizes="(max-width:700px) 100vw, 550px"
          />
        </div>
        <div className="detail-info">
          <Link className="chef-inline" href={"/chefs/" + d.chefId}>
            <ChefHat size={20} />
            {d.chefName}
            <ChevronRight size={17} />
          </Link>
          <div className="dish-meta">
            <span>
              <Star size={14} fill="currentColor" />
              {d.rating.toFixed(1)} ({d.ratingCount} đánh giá)
            </span>
            <span>{d.distance.toFixed(1)} km</span>
          </div>
          <div className="detail-price">
            {money(d.price)}
            {d.price < d.originalPrice && <del>{money(d.originalPrice)}</del>}
          </div>
          <p>{d.description}</p>
          <div className="info-pills">
            <span>
              <Clock size={15} /> {d.prepMinutes} phút chuẩn bị
            </span>
            <span>{MEAL_NAMES[d.meal]}</span>
            <span>Còn {d.stock} suất</span>
          </div>
          <h3>Thành phần & lưu ý</h3>
          <p>{d.ingredients || "Liên hệ bếp nếu bạn có dị ứng thực phẩm."}</p>
          <Button onClick={() => add(d)}>
            <Plus size={18} /> Thêm vào giỏ
          </Button>
          <p className="muted small">
            Giá chưa gồm phí giao. Phí sẽ hiển thị khi đặt đơn.
          </p>
        </div>
      </div>
    </>
  );
}
function Chefs({ id }: { id?: string }) {
  const { location } = useApp(),
    { data, error } = useLoad<Feed>(
      feedPath(
        location,
        "&limit=100" + (id ? "&chef=" + encodeURIComponent(id) : ""),
      ),
    ),
    { data: profile } = useLoad(id ? "chefs/" + id : null);
  if (error) return <Notice error>{error}</Notice>;
  if (!data) return <LoadingCards />;
  if (!id)
    return (
      <>
        <PageTitle title="Các bếp gần bạn" back />
        <ChefCards chefs={data.chefs} />
      </>
    );
  const c = profile?.chef;
  return (
    <>
      <PageTitle title={c?.name || "Thông tin bếp"} back />
      {c && (
        <div className="chef-profile panel">
          <img src={c.avatar_url || "/icon.svg"} alt={c.name} />
          <div>
            <h2>{c.name}</h2>
            <span className="verified">
              <ShieldCheck size={14} /> Bếp đã được duyệt
            </span>
            <p>{c.bio}</p>
            <div className="dish-meta">
              <span>
                <Star size={14} />
                {Number(c.rating).toFixed(1)} ({c.rating_count})
              </span>
              <span>{c.area}</span>
              <span>{c.completed_orders} đơn hoàn thành</span>
            </div>
          </div>
        </div>
      )}
      <Section title="Thực đơn đang nhận đặt">
        <div className="dish-grid">
          {data.dishes
            .filter((d) => d.chefId === id)
            .map((d) => (
              <DishCard key={d.menuId} dish={d} />
            ))}
        </div>
        {!data.dishes.some((d) => d.chefId === id) && (
          <Empty title="Bếp chưa có món phù hợp lúc này" />
        )}
      </Section>
      {profile?.reviews?.length > 0 && (
        <Section title="Đánh giá">
          {profile.reviews.map((r: any, i: number) => (
            <div className="review panel" key={i}>
              <strong>{r.name}</strong>
              <span>
                <Star size={13} />
                {r.rating}
              </span>
              <p>{r.body}</p>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}
export function NeedLogin() {
  return (
    <Empty
      icon={UserRound}
      title="Đăng nhập để tiếp tục"
      body="Lưu món yêu thích, đặt đơn và nhận thông báo của bạn."
    >
      <Link href="/login" className="button">
        Đăng nhập
      </Link>
    </Empty>
  );
}
function Favorites() {
  const { user, location, revision, refresh, toast } = useApp(),
    { data } = useLoad(user ? "favorites" : null, [revision]),
    { data: available } = useLoad<Feed>(feedPath(location, "&limit=100"), [
      revision,
    ]);
  if (!user) return <NeedLogin />;
  return (
    <>
      <PageTitle title="Món đã thích" subtitle="Những món bạn đã lưu lại" />
      {data?.favorites.length ? (
        <div className="dish-grid">
          {data.favorites.map((p: any) => {
            const d = available?.dishes.find((d) => d.id === p.id);
            return d ? (
              <DishCard key={p.id} dish={d} />
            ) : (
              <article className="unavailable-card panel" key={p.id}>
                <img src={p.image_url} alt={p.name} />
                <h3>{p.name}</h3>
                <p>{p.chef_name}</p>
                <span className="status neutral">Hiện chưa nhận đặt</span>
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await post("favorites", {
                        productId: p.id,
                        liked: false,
                      });
                      refresh();
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                >
                  Bỏ thích
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={Heart}
          title="Bạn chưa lưu món nào"
          body="Bấm biểu tượng trái tim trên món để lưu tại đây."
        />
      )}
    </>
  );
}
function Orders() {
  const { user, revision, location } = useApp(),
    { data, error } = useLoad(user ? "orders" : null, [revision]),
    { data: feed } = useLoad<Feed>(feedPath(location, "&limit=20"), [revision]);
  if (!user) return <NeedLogin />;
  const current =
      data?.orders.filter(
        (o: any) =>
          !["COMPLETED", "CANCELLED", "EXPIRED", "REJECTED"].includes(o.status),
      ) || [],
    history =
      data?.orders.filter((o: any) =>
        ["COMPLETED", "CANCELLED", "EXPIRED", "REJECTED"].includes(o.status),
      ) || [];
  return (
    <>
      <PageTitle title="Đơn hàng" />
      {error && <Notice error>{error}</Notice>}
      <Section title="Vừa đặt">
        {current.length ? (
          current.map((o: any) => <OrderCard key={o.id} order={o} />)
        ) : (
          <Empty
            title="Bạn chưa có đơn đang xử lý"
            body="Các đơn vừa đặt sẽ xuất hiện tại đây."
          />
        )}
      </Section>
      {history.length > 0 && (
        <Section title="Lịch sử đơn">
          {history.map((o: any) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </Section>
      )}
      {feed?.dishes.length && (
        <Section title="Có thể bạn đang đói!" href="/nearby">
          <div className="dish-scroll">
            {feed.dishes.map((d) => (
              <DishCard key={d.menuId} dish={d} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
export function OrderCard({
  order: o,
  chef = false,
}: {
  order: any;
  chef?: boolean;
}) {
  return (
    <Link className="order-card panel" href={"/orders/" + o.id}>
      <div className="order-card-icon">
        <ShoppingBag size={22} />
      </div>
      <div className="order-card-info">
        <strong>{o.chef_name}</strong>
        <p>
          #{o.code} ·{" "}
          {new Date(o.created_at.replace(" ", "T") + "Z").toLocaleString(
            "vi-VN",
          )}
        </p>
        <div className="order-card-statuses">
          <span className="status" data-status={o.status}>
            {ORDER_LABELS[o.status]}
          </span>
          {o.payment_request_status && (
            <span
              className="status order-request-status"
              data-status={o.payment_request_status}
            >
              {o.payment_request_kind === "REFUND" ? "Hoàn tiền" : "Đối soát"} ·{" "}
              {PAYMENT_REQUEST_STATUSES[o.payment_request_status] ||
                o.payment_request_status}
            </span>
          )}
        </div>
      </div>
      <div className="order-card-total">
        <strong>{money(o.total)}</strong>
        <ChevronRight size={18} />
      </div>
    </Link>
  );
}
function Notifications() {
  const { user, revision, refresh } = useApp(),
    { data, error } = useLoad(user ? "notifications" : null, [revision]),
    [tab, setTab] = useState("news");
  if (!user) return <NeedLogin />;
  const list = data?.notifications || [];
  return (
    <>
      <PageTitle title="Thông báo">
        <button
          className="text-button"
          onClick={async () => {
            await post("notifications", {});
            refresh();
          }}
        >
          Đánh dấu đã đọc
        </button>
      </PageTitle>
      <div className="notification-groups">
        <button
          onClick={() => setTab("news")}
          className={tab === "news" ? "selected" : ""}
        >
          <span className="group-icon">
            <Mail size={22} />
          </span>
          <strong>Tin tức</strong>
          <small>Thông báo từ hệ thống</small>
        </button>
        <button
          onClick={() => setTab("order")}
          className={tab === "order" ? "selected" : ""}
        >
          <span className="group-icon">
            <ShoppingBag size={22} />
          </span>
          <strong>Đơn hàng</strong>
          <small>Trạng thái đơn của bạn</small>
        </button>
      </div>
      {error && <Notice error>{error}</Notice>}
      <NotificationList
        list={list.filter((n: any) =>
          tab === "news"
            ? ["news", "system"].includes(n.category)
            : n.category === "order",
        )}
      />
      <Section title="Khuyến mãi">
        <NotificationList
          list={list.filter((n: any) => n.category === "promotion")}
        />
        <Link href="/offers" className="text-button">
          Xem món đang giảm giá <ArrowRight size={14} />
        </Link>
      </Section>
    </>
  );
}
function NotificationList({ list }: { list: any[] }) {
  return list.length ? (
    <div className="notification-list">
      {list.map((n) => (
        <Link
          className={"notification-item " + (!n.is_read ? "unread" : "")}
          key={n.id}
          href={n.href}
        >
          <span className="notification-dot" />
          <div>
            <strong>{n.title}</strong>
            <p>{n.body}</p>
            <small>
              {new Date(n.created_at.replace(" ", "T") + "Z").toLocaleString(
                "vi-VN",
              )}
            </small>
          </div>
          <ChevronRight size={17} />
        </Link>
      ))}
    </div>
  ) : (
    <div className="quiet-empty">Chưa có thông báo.</div>
  );
}
function Profile() {
  const { user, chef, refreshAuth } = useApp();
  if (!user) return <NeedLogin />;
  const items = [
    ["/me/vouchers", "Voucher", Ticket],
    ["/me/addresses", "Địa chỉ", MapPin],
    ["/me/settings", "Cài đặt", Settings],
    ["/help", "Trung tâm trợ giúp", HelpCircle],
    ["/privacy", "Chính sách & bảo mật", ShieldCheck],
  ] as const;
  return (
    <>
      <PageTitle title="Tôi" />
      <div className="profile-top panel">
        <div className="profile-avatar">{user.name.slice(0, 1)}</div>
        <div>
          <h2>{user.name}</h2>
          <p>{user.email}</p>
        </div>
        <Link
          href="/me/settings"
          className="icon-button"
          aria-label="Chỉnh sửa profile"
        >
          <Settings size={19} />
        </Link>
      </div>
      {user.role === "admin" && (
        <Link href="/admin" className="role-link">
          <ShieldCheck size={22} />
          <span>Quản trị hệ thống</span>
          <ChevronRight size={18} />
        </Link>
      )}
      <Link
        href={chef?.status === "approved" ? "/chef" : "/chef/apply"}
        className="role-link"
      >
        <ChefHat size={23} />
        <span>
          {chef?.status === "approved"
            ? "Bếp của tôi"
            : chef?.status === "pending"
              ? "Hồ sơ bếp đang chờ duyệt"
              : "Đăng ký mở bếp"}
          <small>
            {chef?.status === "approved"
              ? "Thực đơn, đơn hàng và thống kê"
              : "Gửi thông tin bếp để được xét duyệt"}
          </small>
        </span>
        <ChevronRight size={18} />
      </Link>
      <div className="profile-menu panel">
        {items.map(([href, label, Icon]) => (
          <Link key={href} href={href}>
            <Icon size={20} strokeWidth={1.5} />
            <span>{label}</span>
            <ChevronRight size={17} />
          </Link>
        ))}
        <button
          onClick={async () => {
            await post("auth/logout", {});
            await refreshAuth();
          }}
        >
          <LogOut size={20} />
          <span>Đăng xuất</span>
        </button>
      </div>
    </>
  );
}
function ProfileSettings() {
  const { user, toast, refreshAuth } = useApp(),
    [busy, setBusy] = useState(false);
  if (!user) return <NeedLogin />;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await post(
        "profile",
        { name: f.get("name"), phone: f.get("phone") },
        "PATCH",
      );
      await refreshAuth();
      toast("Đã lưu thông tin.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle title="Cài đặt tài khoản" back />
      <form className="panel form narrow" onSubmit={save}>
        <Field label="Tên hiển thị">
          <input name="name" defaultValue={user.name} required minLength={2} />
        </Field>
        <Field label="Số điện thoại">
          <input name="phone" defaultValue={user.phone} inputMode="tel" />
        </Field>
        <Field label="Email">
          <input value={user.email} disabled />
        </Field>
        <Button type="submit" disabled={busy}>
          Lưu thông tin
        </Button>
      </form>
    </>
  );
}
function Login() {
  const { refreshAuth, user } = useApp(),
    router = useRouter(),
    params = useSearchParams(),
    [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await post("auth/" + (register ? "register" : "login"), {
        name: f.get("name"),
        email: f.get("email"),
        password: f.get("password"),
      });
      await refreshAuth();
      const next = params.get("next") || "/me";
      router.push(
        next.startsWith("/") && !next.startsWith("//") ? next : "/me",
        { transitionTypes: ["page-forward"] },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (user)
    return (
      <>
        <PageTitle title="Bạn đã đăng nhập" />
        <Link href="/me" className="button">
          Vào tài khoản
        </Link>
      </>
    );
  return (
    <div className="auth-wrap">
      <div className="auth-icon">
        <ChefHat size={32} strokeWidth={1.3} />
      </div>
      <h1>{register ? "Tạo tài khoản" : "Đăng nhập"}</h1>
      <p>Quản lý đơn hàng và các món đã lưu của bạn.</p>
      <form className="form" onSubmit={submit}>
        {register && (
          <Field label="Tên của bạn">
            <input name="name" autoComplete="name" required minLength={2} />
          </Field>
        )}
        <Field label="Email">
          <input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Mật khẩu">
          <input
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            required
            minLength={register ? 10 : 1}
          />
        </Field>
        {error && <Notice error>{error}</Notice>}
        <Button type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle size={18} className="spin" />
          ) : register ? (
            "Tạo tài khoản"
          ) : (
            "Đăng nhập"
          )}
        </Button>
      </form>
      <button
        className="text-button"
        onClick={() => {
          setRegister(!register);
          setError("");
        }}
      >
        {register ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký"}
      </button>
    </div>
  );
}
function Cart() {
  const { cart, setQuantity, clearCart } = useApp();
  if (!cart.length)
    return (
      <Empty
        title="Giỏ hàng chưa có món"
        body="Chọn món từ thực đơn của một bếp để đặt."
      >
        <Link href="/" className="button">
          Xem món
        </Link>
      </Empty>
    );
  return (
    <>
      <PageTitle title="Giỏ hàng" subtitle={cart[0].dish.chefName} back>
        <button className="text-button" onClick={clearCart}>
          Xóa giỏ
        </button>
      </PageTitle>
      <div className="checkout-grid">
        <div className="panel">
          {cart.map(({ dish: d, quantity: q }) => (
            <div className="cart-item" key={d.menuId}>
              <img src={d.image} alt={d.name} />
              <div>
                <h3>{d.name}</h3>
                <p>{MEAL_NAMES[d.meal]}</p>
                <strong>{money(d.price)}</strong>
              </div>
              <div className="quantity">
                <button
                  onClick={() => setQuantity(d.menuId, q - 1)}
                  aria-label="Giảm số lượng"
                >
                  <Minus size={14} />
                </button>
                <span>{q}</span>
                <button
                  onClick={() => setQuantity(d.menuId, q + 1)}
                  aria-label="Tăng số lượng"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="panel summary">
          <h2>Tạm tính</h2>
          <div>
            <span>Tiền món</span>
            <strong>
              {money(cart.reduce((a, x) => a + x.quantity * x.dish.price, 0))}
            </strong>
          </div>
          <p>
            Phí giao và voucher được xác định khi đặt đơn. Giá và số suất sẽ
            được bếp kiểm tra lại.
          </p>
          <Link href="/checkout" className="button">
            Tiếp tục đặt món <ArrowRight size={17} />
          </Link>
        </div>
      </div>
    </>
  );
}
function Checkout() {
  const { user, cart, location, setLocationOpen, clearCart } = useApp(),
    router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [key] = useState(() => crypto.randomUUID()),
    [voucher, setVoucher] = useState(""),
    [quote, setQuote] = useState<{
      items: { menuId: string; price: number; quantity: number }[];
      subtotal: number;
      discount: number;
      deliveryFee: number;
      total: number;
    } | null>(null),
    [quoteBusy, setQuoteBusy] = useState(false),
    [quoteError, setQuoteError] = useState(""),
    [quoteRevision, setQuoteRevision] = useState(0);
  const itemsKey = JSON.stringify(
    cart.map((x) => ({ menuId: x.dish.menuId, quantity: x.quantity })),
  );
  useEffect(() => {
    let cancelled = false;
    setQuote(null);
    setQuoteError("");
    if (!user || !location || !cart.length) {
      setQuoteBusy(false);
      return;
    }
    setQuoteBusy(true);
    const timer = setTimeout(() => {
      post("orders/quote", {
        items: JSON.parse(itemsKey),
        lat: location.lat,
        lng: location.lng,
        voucher: voucher.trim().toUpperCase(),
      })
        .then((value) => {
          if (!cancelled) setQuote(value);
        })
        .catch((e) => {
          if (!cancelled) setQuoteError(e.message);
        })
        .finally(() => {
          if (!cancelled) setQuoteBusy(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    user?.id,
    location?.lat,
    location?.lng,
    itemsKey,
    voucher,
    quoteRevision,
  ]);
  if (!user) return <NeedLogin />;
  if (!cart.length) return <Empty title="Giỏ hàng chưa có món" />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!location || !quote || quoteBusy) {
      setLocationOpen(true);
      return;
    }
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await post("orders", {
        items: cart.map((x) => ({
          menuId: x.dish.menuId,
          quantity: x.quantity,
        })),
        ...location,
        address: String(f.get("address")),
        recipient: f.get("recipient"),
        phone: f.get("phone"),
        note: f.get("note"),
        voucher: voucher.trim().toUpperCase(),
        expectedTotal: quote.total,
        idempotencyKey: key,
      });
      clearCart();
      router.push("/orders/" + result.id, {
        transitionTypes: ["page-forward"],
      });
    } catch (e) {
      setError((e as Error).message);
      setQuoteRevision((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="Xác nhận đặt món"
        subtitle={cart[0].dish.chefName}
        back
      />
      <form onSubmit={submit} className="checkout-grid">
        <div className="panel form">
          <h2>Thông tin giao hàng</h2>
          <button
            className="address-select"
            type="button"
            onClick={() => setLocationOpen(true)}
          >
            <MapPin size={18} />
            {location?.address || "Chọn địa chỉ giao"}
            <ChevronRight size={17} />
          </button>
          <Field label="Địa chỉ chi tiết">
            <input
              key={location?.address}
              name="address"
              defaultValue={location?.address || ""}
              placeholder="Số nhà, tên đường, tòa nhà…"
              required
              minLength={10}
            />
          </Field>
          <div className="form-row">
            <Field label="Người nhận">
              <input name="recipient" defaultValue={user.name} required />
            </Field>
            <Field label="Số điện thoại">
              <input
                name="phone"
                defaultValue={user.phone}
                inputMode="tel"
                required
              />
            </Field>
          </div>
          <Field label="Ghi chú cho bếp">
            <textarea
              name="note"
              placeholder="Khẩu vị hoặc lưu ý khi giao"
              rows={2}
            />
          </Field>
          <Field label="Mã voucher">
            <input
              name="voucher"
              placeholder="Nhập mã nếu có"
              value={voucher}
              onChange={(e) => setVoucher(e.target.value)}
            />
          </Field>
          <Notice>
            Thanh toán bằng chuyển khoản tới tài khoản của bếp. Đơn cập nhật sau
            khi xác nhận tiền vào.
          </Notice>
        </div>
        <div className="panel summary">
          <h2>Đơn của bạn</h2>
          {cart.map((x) => (
            <div key={x.dish.menuId}>
              <span>
                {x.quantity} × {x.dish.name}
              </span>
              <strong>
                {money(
                  x.quantity *
                    (quote?.items.find((i) => i.menuId === x.dish.menuId)
                      ?.price ?? x.dish.price),
                )}
              </strong>
            </div>
          ))}
          {quote && (
            <>
              <div>
                <span>Tiền món</span>
                <strong>{money(quote.subtotal)}</strong>
              </div>
              <div>
                <span>Phí giao</span>
                <strong>{money(quote.deliveryFee)}</strong>
              </div>
              {quote.discount > 0 && (
                <div>
                  <span>Voucher</span>
                  <strong>−{money(quote.discount)}</strong>
                </div>
              )}
              <div className="summary-total">
                <span>Tổng thanh toán</span>
                <strong>{money(quote.total)}</strong>
              </div>
            </>
          )}
          {quoteBusy && <p role="status">Đang tính tổng tiền…</p>}
          {quoteError && (
            <Notice error>
              {quoteError}{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => setQuoteRevision((n) => n + 1)}
              >
                Thử lại
              </button>
            </Notice>
          )}
          {error && <Notice error>{error}</Notice>}
          <Button
            type="submit"
            disabled={busy || !location || !quote || quoteBusy}
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              "Tạo đơn & xem thanh toán"
            )}
          </Button>
          {!location && (
            <button
              type="button"
              className="text-button"
              onClick={() => setLocationOpen(true)}
            >
              Chọn địa chỉ để tiếp tục
            </button>
          )}
        </div>
      </form>
    </>
  );
}
function OrderDetail({ id }: { id: string }) {
  const { user, revision, toast, refresh } = useApp(),
    { data, error, reload } = useLoad(user ? "orders/" + id : null, [revision]),
    [busy, setBusy] = useState(false),
    [qr, setQr] = useState(""),
    [qrError, setQrError] = useState(""),
    [now, setNow] = useState(Date.now()),
    [map, setMap] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const o = data?.order;
  useEffect(() => {
    let active = true;
    setQr("");
    setQrError("");
    if (o?.status === "PLACED")
      request("orders/" + id + "/qr")
        .then((r) => {
          if (active) setQr(r.qr);
        })
        .catch((e) => {
          if (active) setQrError(e.message);
        });
    return () => {
      active = false;
    };
  }, [id, o?.status, o?.received_amount]);
  useEffect(() => {
    if (o?.status !== "PLACED") return;
    const tick = () => {
      if (document.visibilityState === "visible") reload();
    };
    const timer = setInterval(tick, 10000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [o?.status, reload]);
  if (!user) return <NeedLogin />;
  if (error) return <Notice error>{error}</Notice>;
  if (!o)
    return (
      <div className="loading">
        <LoaderCircle className="spin" /> Đang tải đơn…
      </div>
    );
  const chef = o.chef_user_id === user.id || user.role === "admin",
    remaining = Math.max(
      0,
      Math.floor(
        (new Date(o.expires_at.replace(" ", "T") + "Z").getTime() - now) / 1000,
      ),
    );
  async function act(action: string, note = "") {
    setBusy(true);
    try {
      const result = await post("orders/" + id + "/action", { action, note });
      refresh();
      reload();
      toast(
        result.refundRequested
          ? "Đã gửi yêu cầu hoàn tiền cho bếp."
          : "Đã cập nhật đơn.",
      );
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const statuses = [
      "PLACED",
      "PAID",
      "ACCEPTED",
      "PREPARING",
      "DELIVERING",
      "DELIVERED",
      "COMPLETED",
    ],
    at = statuses.indexOf(o.status);
  return (
    <>
      <PageTitle title={"Đơn #" + o.code} subtitle={o.chef_name} back />
      <div className="order-progress">
        {statuses.map((s, i) => (
          <div key={s} className={at >= i ? "done" : ""}>
            <span>{at > i ? <Check size={13} /> : i + 1}</span>
            <small>{ORDER_LABELS[s]}</small>
          </div>
        ))}
      </div>
      <div className="checkout-grid">
        <div>
          <div className="panel form">
            <div className="spread">
              <h2>{ORDER_LABELS[o.status]}</h2>
              <span
                className="status"
                data-status={
                  o.payment_reported && o.payment_status === "PENDING"
                    ? "PAYMENT_REPORTED"
                    : o.payment_status
                }
              >
                {o.payment_status === "REFUNDED_MANUAL"
                  ? "Đã hoàn tiền"
                  : o.payment_status === "REFUND_PENDING"
                    ? "Chờ hoàn tiền"
                    : o.payment_status === "PAID_AUTO"
                      ? "Đã thanh toán"
                      : o.payment_status === "PAID_MANUAL"
                        ? "Bếp đã xác nhận tiền"
                        : o.payment_status === "PARTIAL"
                          ? "Đã nhận một phần tiền"
                          : o.payment_status === "PAYMENT_REVIEW"
                            ? "Cần đối soát"
                            : o.payment_reported
                              ? "Khách đã báo chuyển"
                              : "Chờ thanh toán"}
              </span>
            </div>
            {o.status === "PLACED" && (
              <>
                <p className="muted">
                  Thời gian chờ: {Math.floor(remaining / 60)}:
                  {String(remaining % 60).padStart(2, "0")}. Không chuyển khoản
                  sau khi đơn hết hạn.
                </p>
                {chef ? (
                  <>
                    {o.automatic_payment ? (
                      <Notice>
                        SePay sẽ tự xác nhận khi nhận đủ tiền. Bếp có thể nhận
                        đơn sau khi trạng thái chuyển sang Đã thanh toán.
                      </Notice>
                    ) : (
                      <>
                        <Notice>
                          Kiểm tra tiền thực nhận trong tài khoản ngân hàng
                          trước khi xác nhận đơn.
                        </Notice>
                        <Button
                          disabled={busy || !remaining}
                          onClick={() => void act("ACCEPTED")}
                        >
                          Đã nhận đủ tiền & nhận đơn
                        </Button>
                      </>
                    )}
                    <Button
                      secondary
                      disabled={busy}
                      onClick={() => {
                        const reason = prompt("Lý do từ chối đơn:");
                        if (reason) void act("REJECTED", reason);
                      }}
                    >
                      Từ chối đơn
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="payment-qr">
                      {qr ? (
                        <img
                          src={qr}
                          alt="QR chuyển khoản cho đơn"
                          onError={() => {
                            setQrError(
                              "Chưa tải được QR. Bạn có thể sao chép thông tin chuyển khoản bên dưới.",
                            );
                            setQr("");
                          }}
                        />
                      ) : (
                        <div className="qr-placeholder">
                          <Wallet size={32} />
                          <span>Thông tin chuyển khoản</span>
                        </div>
                      )}
                      {qrError && <p>{qrError}</p>}
                      {qr && (
                        <a href={qr + "&download=true"} className="text-button">
                          <Download size={15} /> Tải QR
                        </a>
                      )}
                    </div>
                    {[
                      ["Ngân hàng", o.bank_name],
                      ["Chủ tài khoản", o.account_name],
                      ["Số tài khoản", o.account_no],
                      [
                        "Số tiền",
                        money(Math.max(0, o.total - Number(o.received_amount))),
                      ],
                      ["Nội dung", o.transfer_content],
                    ].map(([label, value]) => (
                      <div className="bank-row" key={label}>
                        <small>{label}</small>
                        <strong>{value}</strong>
                        <button
                          className="icon-button"
                          aria-label={"Sao chép " + label}
                          onClick={() => {
                            navigator.clipboard.writeText(
                              label === "Số tiền"
                                ? String(
                                    Math.max(
                                      0,
                                      o.total - Number(o.received_amount),
                                    ),
                                  )
                                : value,
                            );
                            toast("Đã sao chép.");
                          }}
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                    ))}
                    {o.automatic_payment ? (
                      <>
                        <Notice>
                          {o.payment_status === "PAYMENT_REVIEW"
                            ? "Số tiền chuyển cần đối soát. Hãy liên hệ bếp, không chuyển thêm."
                            : `Giữ nguyên nội dung ${o.transfer_content} và chuyển đúng số tiền hiển thị. Trạng thái tự cập nhật khi SePay khớp tiền vào với đơn này.`}
                        </Notice>
                        {Number(o.received_amount) > 0 && (
                          <p className="muted">
                            Đã nhận {money(Number(o.received_amount))}.{" "}
                            {o.payment_status !== "PAYMENT_REVIEW" &&
                              `Còn thiếu ${money(Math.max(0, o.total - Number(o.received_amount)))}.`}
                          </p>
                        )}
                        <Button secondary onClick={reload}>
                          Kiểm tra thanh toán
                        </Button>
                      </>
                    ) : (
                      <Button
                        disabled={
                          busy || !remaining || Boolean(o.payment_reported)
                        }
                        onClick={() => void act("report-payment")}
                      >
                        {o.payment_reported
                          ? "Đang chờ bếp kiểm tra tiền"
                          : "Tôi đã chuyển khoản"}
                      </Button>
                    )}
                    <Button
                      secondary
                      disabled={busy}
                      onClick={() => {
                        const note = prompt(
                          "Lý do hủy (nếu đã chuyển tiền, cần liên hệ bếp để hoàn):",
                        );
                        if (note) void act("CANCELLED", note);
                      }}
                    >
                      Hủy đơn
                    </Button>
                  </>
                )}
              </>
            )}
            {o.status === "PAID" && (
              <>
                {!chef && (
                  <Notice>Đã thanh toán. Đang chờ bếp nhận đơn.</Notice>
                )}
                <Button
                  secondary
                  disabled={busy}
                  onClick={() => {
                    const reason = prompt(
                      "Lý do hủy/từ chối đơn đã thanh toán (cần hoàn tiền):",
                    );
                    if (reason)
                      void act(chef ? "REJECTED" : "CANCELLED", reason);
                  }}
                >
                  {chef
                    ? "Từ chối & xử lý hoàn tiền"
                    : "Hủy & yêu cầu hoàn tiền"}
                </Button>
              </>
            )}
            {chef && ORDER_NEXT[o.status] && (
              <Button
                disabled={busy}
                onClick={() => void act(ORDER_NEXT[o.status])}
              >
                {o.status === "PAID"
                  ? "Nhận đơn"
                  : o.status === "ACCEPTED"
                    ? "Bắt đầu chuẩn bị"
                    : o.status === "PREPARING"
                      ? "Bắt đầu giao"
                      : "Báo đã giao"}
              </Button>
            )}
            {!chef && o.status === "DELIVERED" && (
              <Button disabled={busy} onClick={() => void act("COMPLETED")}>
                Tôi đã nhận món
              </Button>
            )}
            {!chef &&
              !["PLACED", "PAID"].includes(o.status) &&
              !data.paymentRequests?.length && (
                <CustomerPaymentRequestForm
                  key={id}
                  orderId={id}
                  onChange={reload}
                />
              )}
          </div>
          {((chef && !["PLACED", "PAID"].includes(o.status)) ||
            data.paymentRequests?.length > 0) && (
            <PaymentRequestList
              orderId={id}
              values={data.paymentRequests || []}
              isChef={chef}
              canResolve={o.chef_user_id === user.id}
              onChange={reload}
            />
          )}
          <div className="panel delivery-panel">
            <h2>Giao đến</h2>
            <p>
              <strong>{o.recipient}</strong> · {o.phone}
            </p>
            <p>{o.address}</p>
            <p>
              {o.route_distance_km
                ? `${Number(o.route_distance_km).toFixed(1)} km theo đường đi`
                : `Cách bếp khoảng ${Number(o.distance_km).toFixed(1)} km`}
              {o.route_duration_seconds
                ? ` · ${Math.ceil(o.route_duration_seconds / 60)} phút di chuyển ước tính`
                : ""}
            </p>
            {o.note && <Notice>Ghi chú: {o.note}</Notice>}
            <button className="text-button" onClick={() => setMap(!map)}>
              <MapPin size={16} />
              {map ? "Ẩn bản đồ" : "Xem tuyến giao"}
            </button>
            {map && <DeliveryMap order={o} />}
          </div>
          <div className="panel timeline">
            <h2>Lịch sử đơn</h2>
            {data.events.map((ev: any, i: number) => (
              <div key={i}>
                <span />
                <p>
                  <strong>
                    {ORDER_LABELS[ev.status] || "Khách báo đã chuyển khoản"}
                  </strong>
                  <small>
                    {new Date(
                      ev.created_at.replace(" ", "T") + "Z",
                    ).toLocaleString("vi-VN")}
                  </small>
                  {ev.note && <small>{ev.note}</small>}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="panel summary">
          <h2>Chi tiết thanh toán</h2>
          {data.items.map((item: any) => (
            <div key={item.id}>
              <span>
                {item.quantity} × {item.name}
              </span>
              <strong>{money(item.quantity * item.unit_price)}</strong>
            </div>
          ))}
          <div>
            <span>Tiền món</span>
            <strong>{money(o.subtotal)}</strong>
          </div>
          <div>
            <span>Giảm giá</span>
            <strong>−{money(o.discount)}</strong>
          </div>
          <div>
            <span>Phí giao</span>
            <strong>{money(o.delivery_fee)}</strong>
          </div>
          <div className="summary-total">
            <span>Tổng tiền</span>
            <strong>{money(o.total)}</strong>
          </div>
          <p>Chuyển trực tiếp tới tài khoản của {o.chef_name}.</p>
          {o.status === "COMPLETED" && !chef && !data.review && (
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                try {
                  await post("orders/" + id + "/review", {
                    rating: Number(f.get("rating")),
                    body: f.get("body"),
                  });
                  reload();
                  toast("Đã gửi đánh giá.");
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              <h3>Đánh giá bữa ăn</h3>
              <select name="rating">
                <option value="5">5 sao</option>
                <option value="4">4 sao</option>
                <option value="3">3 sao</option>
                <option value="2">2 sao</option>
                <option value="1">1 sao</option>
              </select>
              <textarea name="body" placeholder="Nhận xét của bạn" />
              <Button type="submit">Gửi đánh giá</Button>
            </form>
          )}
          {data.review && (
            <Notice>Đã đánh giá {data.review.rating}/5 sao.</Notice>
          )}
        </div>
      </div>
    </>
  );
}
function Vouchers() {
  const { data, error } = useLoad("vouchers"),
    { toast } = useApp();
  return (
    <>
      <PageTitle title="Voucher" back />
      {error && <Notice error>{error}</Notice>}
      {data?.vouchers.length ? (
        data.vouchers.map((v: any) => (
          <div className="voucher-card panel" key={v.id}>
            <span className="voucher-icon">
              <Ticket size={28} strokeWidth={1.2} />
            </span>
            <div>
              <h3>{v.title}</h3>
              <p>
                {v.chef_name} · Đơn từ {money(v.min_subtotal)}
              </p>
              <small>
                Đến {new Date(v.expires_at).toLocaleDateString("vi-VN")}
              </small>
            </div>
            <button
              className="text-button"
              onClick={() => {
                navigator.clipboard.writeText(v.code);
                toast("Đã sao chép mã " + v.code);
              }}
            >
              {v.code}
              <Copy size={14} />
            </button>
          </div>
        ))
      ) : (
        <Empty icon={Ticket} title="Chưa có voucher phù hợp" />
      )}
    </>
  );
}
function Addresses() {
  const { user } = useApp();
  if (!user) return <NeedLogin />;
  return (
    <>
      <PageTitle title="Địa chỉ" back />
      <AddressPicker />
    </>
  );
}
function Information({ privacy }: { privacy: boolean }) {
  return (
    <>
      <PageTitle
        title={privacy ? "Chính sách & bảo mật" : "Trung tâm trợ giúp"}
        back
      />
      <div className="panel prose">
        {privacy ? (
          <>
            <h2>Dữ liệu tài khoản và đơn hàng</h2>
            <p>
              Thông tin giao hàng chỉ được cung cấp cho khách đặt, bếp phụ trách
              và quản trị viên để xử lý đơn.
            </p>
            <h2>Hồ sơ bếp</h2>
            <p>
              Tài liệu xác minh được lưu trong kho riêng tư. Chỉ chủ hồ sơ và
              quản trị viên được truy cập.
            </p>
            <h2>Thanh toán</h2>
            <p>
              Tiền chuyển trực tiếp tới tài khoản của bếp. Ứng dụng lưu thông
              tin đơn và xác nhận của bếp để hỗ trợ đối soát.
            </p>
            <Notice>
              Nội dung chính sách vận hành cần được chủ sản phẩm hoàn thiện
              trước khi mở bán công khai.
            </Notice>
          </>
        ) : (
          <>
            <h2>Đặt món và thanh toán</h2>
            <p>
              Chọn địa chỉ, thêm món từ một bếp vào giỏ, tạo đơn rồi chuyển
              khoản đúng số tiền và nội dung được hiển thị. Bếp đã bật SePay sẽ
              tự động xác nhận thanh toán khi nhận đủ tiền.
            </p>
            <h2>Hủy đơn và hoàn tiền</h2>
            <p>
              Đơn chưa được bếp nhận có thể hủy trong chi tiết đơn. Nếu đã
              chuyển tiền, gửi yêu cầu đối soát trong đơn để bếp kiểm tra và xử
              lý hoàn tiền.
            </p>
            <h2>Không thấy món gần bạn</h2>
            <p>
              Kiểm tra địa chỉ đã chọn. Món chỉ xuất hiện khi bếp đang mở, còn
              suất, còn giờ nhận bữa và nằm trong bán kính giao.
            </p>
          </>
        )}
      </div>
    </>
  );
}
function LocationSheet() {
  const { locationOpen, setLocationOpen } = useApp();
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!locationOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLocationOpen(false);
      if (event.key !== "Tab") return;
      const nodes = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), a[href], summary",
        ) || [],
      ).filter((node) => node.getClientRects().length > 0);
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [locationOpen, setLocationOpen]);
  if (!locationOpen) return null;
  return (
    <div className="modal-overlay" onClick={() => setLocationOpen(false)}>
      <section
        ref={dialog}
        tabIndex={-1}
        className="sheet location-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Chọn địa chỉ giao"
        onClick={(e) => e.stopPropagation()}
      >
        <AddressPicker onClose={() => setLocationOpen(false)} />
      </section>
    </div>
  );
}
