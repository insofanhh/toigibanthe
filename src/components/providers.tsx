"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { Actor, Dish, Location } from "@/lib/domain";
import { ClientLoadCache } from "@/lib/client-load-cache";
import { trackEvent } from "@/lib/analytics-client";
import { clearDevicePush, syncPushIdentity } from "@/lib/push-client";
import {
  currentPosition,
  isUnresolvedLocation,
  reverseLocation,
} from "@/lib/location-client";
export async function request<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api/" + path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
      ...options.headers,
    },
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Không thể xử lý yêu cầu.");
  return data;
}
export const post = (path: string, body: unknown, method = "POST") =>
  request(path, { method, body: JSON.stringify(body) });
export type CartLine = { dish: Dish; quantity: number };
type ToastOptions = {
  key?: string;
  duration?: number;
};
type Context = {
  user: Actor | null;
  chef: {
    id: string;
    name: string;
    status: string;
    rejection_reason?: string;
  } | null;
  authReady: boolean;
  authError: string;
  storageReady: boolean;
  loadCache: ClientLoadCache;
  location: Location | null;
  cart: CartLine[];
  unread: number;
  revision: number;
  toast: (message: string, options?: ToastOptions) => void;
  dismissToast: (key: string) => void;
  refresh: () => void;
  markNotificationRead: (id: string) => Promise<void>;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
  setLocation: (value: Location) => void;
  add: (dish: Dish) => void;
  setQuantity: (id: string, n: number) => void;
  clearCart: () => void;
  locationOpen: boolean;
  setLocationOpen: (open: boolean) => void;
};
const AppContext = createContext<Context>(null!);
export const useApp = () => useContext(AppContext);
export function Providers({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Actor | null>(null),
    [chef, setChef] = useState<Context["chef"]>(null),
    [authReady, setAuthReady] = useState(false),
    [authError, setAuthError] = useState(""),
    [location, setLocationState] = useState<Location | null>(null),
    [cart, setCart] = useState<CartLine[]>([]),
    [unread, setUnread] = useState(0),
    [revision, setRevision] = useState(0),
    [message, setMessage] = useState<({ text: string } & ToastOptions) | null>(
      null,
    ),
    [locationOpen, setLocationOpen] = useState(false),
    [ready, setReady] = useState(false);
  const [loadCache] = useState(() => new ClientLoadCache());
  const authIdentity = useRef("");
  const authSequence = useRef(0);
  const notificationSequence = useRef(0);
  const notificationReadQueue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((text: string, options: ToastOptions = {}) => {
    setMessage({ text, ...options });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setMessage(null),
      options.duration || 4500,
    );
  }, []);
  const dismissToast = useCallback((key: string) => {
    setMessage((current) => (current?.key === key ? null : current));
  }, []);
  const refresh = useCallback(() => setRevision((x) => x + 1), []);
  const markNotificationRead = useCallback(
    (id: string) => {
      const identity = authIdentity.current;
      const operation = notificationReadQueue.current
        .catch(() => {})
        .then(async () => {
          if (authIdentity.current !== identity) return;
          ++notificationSequence.current;
          const result = await post(
            `notifications/${encodeURIComponent(id)}/read`,
            {},
          );
          if (authIdentity.current !== identity) return;
          ++notificationSequence.current;
          setUnread(result.unreadCounts.total);
          const key = `${identity}:notifications`;
          const cached = loadCache.read<any>(key).data;
          if (cached)
            loadCache.set(key, {
              ...cached,
              unreadCounts: result.unreadCounts,
              notifications: cached.notifications.map((n: any) =>
                n.id === id ? { ...n, is_read: 1 } : n,
              ),
            });
          refresh();
        });
      notificationReadQueue.current = operation;
      return operation;
    },
    [loadCache, refresh],
  );
  const refreshAuth = useCallback(async () => {
    const sequence = ++authSequence.current;
    try {
      const data = await request("auth/me");
      if (sequence !== authSequence.current) return;
      const identity = data.user
        ? `${data.user.id}:${data.user.role}`
        : "guest";
      if (authIdentity.current !== identity) {
        loadCache.clear();
        setUnread(0);
      }
      authIdentity.current = identity;
      setUser(data.user);
      setChef(data.chef);
      setAuthError("");
    } catch (error) {
      if (sequence === authSequence.current)
        setAuthError((error as Error).message);
    } finally {
      if (sequence === authSequence.current) setAuthReady(true);
    }
  }, [loadCache]);
  const logout = useCallback(async () => {
    await post("auth/logout", {});
    authSequence.current++;
    authIdentity.current = "guest";
    loadCache.clear();
    setUser(null);
    setChef(null);
    setUnread(0);
    setAuthError("");
    setAuthReady(true);
    await clearDevicePush().catch(() => {});
  }, [loadCache]);
  useEffect(() => {
    if (authReady && !authError)
      void syncPushIdentity(user?.id || null).catch(() => {});
  }, [authReady, authError, user?.id]);
  useEffect(() => {
    void refreshAuth();
    try {
      const l = localStorage.getItem("tgbd-location"),
        c = localStorage.getItem("tgbd-cart");
      if (l) setLocationState(JSON.parse(l));
      if (c) setCart(JSON.parse(c));
    } catch {
      localStorage.removeItem("tgbd-cart");
    }
    setReady(true);
  }, [refreshAuth]);
  useEffect(() => {
    if (ready) localStorage.setItem("tgbd-cart", JSON.stringify(cart));
  }, [cart, ready]);
  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    const controller = new AbortController();
    const sequence = ++notificationSequence.current;
    request("notifications", { signal: controller.signal })
      .then((r) => {
        if (
          sequence !== notificationSequence.current ||
          controller.signal.aborted
        )
          return;
        setUnread(
          r.unreadCounts?.total ??
            r.notifications.filter((n: { is_read: number }) => !n.is_read)
              .length,
        );
      })
      .catch(() => {});
    return () => controller.abort();
  }, [user, revision]);
  useEffect(() => {
    if (!user) return;
    let stopped = false,
      ws: WebSocket | null = null,
      retry: ReturnType<typeof setTimeout> | null = null,
      refreshTimer: ReturnType<typeof setTimeout> | null = null,
      attempt = 0;
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (!stopped) refresh();
      }, 100);
    };
    const connect = async () => {
      try {
        const { ticket } = await request("realtime/ticket");
        if (stopped) return;
        const configured = process.env.NEXT_PUBLIC_WS_URL;
        const url = configured
          ? new URL(configured)
          : new URL("/realtime/socket", window.location.origin);
        if (url.pathname === "/") url.pathname = "/socket";
        if (url.protocol === "https:") url.protocol = "wss:";
        if (url.protocol === "http:") url.protocol = "ws:";
        url.searchParams.set("ticket", ticket);
        ws = new WebSocket(url);
        ws.onopen = () => {
          attempt = 0;
          scheduleRefresh();
          if (user.role === "admin") {
            window.dispatchEvent(new CustomEvent("tgbd:admin-registrations"));
            window.dispatchEvent(
              new CustomEvent("tgbd:admin-chef-applications"),
            );
          }
        };
        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === "admin-analytics" && user.role === "admin")
              scheduleRefresh();
            if (
              data.type === "admin-user-registration" &&
              user.role === "admin"
            ) {
              if (
                window.location.pathname !== "/admin" ||
                new URLSearchParams(window.location.search).get("tab") !==
                  "users"
              )
                toast("Có người dùng mới đăng ký.");
              window.dispatchEvent(
                new CustomEvent("tgbd:admin-registrations", {
                  detail: { alertId: data.alertId },
                }),
              );
              scheduleRefresh();
            }
            if (data.type === "admin-users-seen" && user.role === "admin")
              window.dispatchEvent(new CustomEvent("tgbd:admin-registrations"));
            if (data.type === "admin-chefs-seen" && user.role === "admin")
              window.dispatchEvent(
                new CustomEvent("tgbd:admin-chef-applications"),
              );
            if (data.type === "notification") {
              if (
                user.role === "admin" &&
                data.adminAlert?.type === "chef-application"
              ) {
                if (
                  window.location.pathname !== "/admin" ||
                  new URLSearchParams(window.location.search).get("tab") !==
                    "chefs"
                )
                  toast("Có yêu cầu mở bếp mới.");
                window.dispatchEvent(
                  new CustomEvent("tgbd:admin-chef-applications", {
                    detail: { alertId: data.adminAlert.alertId },
                  }),
                );
              } else toast(data.title);
              scheduleRefresh();
            }
          } catch {}
        };
        ws.onclose = () => {
          if (!stopped)
            retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempt++));
        };
        ws.onerror = () => ws?.close();
      } catch {
        if (!stopped) retry = setTimeout(connect, 10000);
      }
    };
    void connect();
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => {
      stopped = true;
      ws?.close();
      if (retry) clearTimeout(retry);
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener("focus", focus);
    };
  }, [user, refresh, toast]);
  const setLocation = useCallback(
    (value: Location) => {
      setLocationState(value);
      localStorage.setItem("tgbd-location", JSON.stringify(value));
      refresh();
    },
    [refresh],
  );
  useEffect(() => {
    if (!ready || !authReady) return;
    const original = localStorage.getItem("tgbd-location");
    let existing: Location | null = null;
    try {
      existing = original ? JSON.parse(original) : null;
    } catch {}
    if (existing && !isUnresolvedLocation(existing.address)) return;
    let active = true;
    const stillCurrent = () =>
      active && localStorage.getItem("tgbd-location") === original;
    void (async () => {
      try {
        // A saved delivery address takes precedence over automatic GPS detection.
        if (user) {
          const data = await request("addresses");
          if (!stillCurrent()) return;
          const saved =
            data.addresses.find((a: { is_default: number }) => a.is_default) ||
            data.addresses[0];
          if (saved) {
            setLocation({
              address: saved.address,
              lat: Number(saved.lat),
              lng: Number(saved.lng),
            });
            return;
          }
        }
        if (!existing && sessionStorage.getItem("tgbd-geo-asked")) return;
        sessionStorage.setItem("tgbd-geo-asked", "1");
        const coords = existing || (await currentPosition()).coords;
        const lat = "lat" in coords ? coords.lat : coords.latitude;
        const lng = "lng" in coords ? coords.lng : coords.longitude;
        let resolved: Location;
        try {
          resolved = await reverseLocation(lat, lng);
        } catch {
          resolved = {
            lat,
            lng,
            address: `Tọa độ: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          };
        }
        if (stillCurrent()) setLocation(resolved);
      } catch {
        /* The address picker remains available if GPS is denied. */
      }
    })();
    return () => {
      active = false;
    };
  }, [ready, authReady, user, setLocation]);
  const add = (dish: Dish) => {
    if (
      (!cart.length ||
        (cart[0].dish.chefId === dish.chefId &&
          cart[0].dish.meal === dish.meal &&
          cart[0].dish.cutoffAt === dish.cutoffAt)) &&
      (cart.find((x) => x.dish.menuId === dish.menuId)?.quantity || 0) <
        dish.stock
    )
      trackEvent("cart_add", location, {
        productId: dish.id,
        meal: dish.meal,
        role: user?.role,
      });
    setCart((old) => {
      if (
        old.length &&
        (old[0].dish.chefId !== dish.chefId ||
          old[0].dish.meal !== dish.meal ||
          old[0].dish.cutoffAt !== dish.cutoffAt)
      ) {
        toast(
          "Giỏ hiện có món của bếp hoặc bữa khác. Hãy hoàn tất hoặc xóa giỏ trước.",
        );
        return old;
      }
      const exists = old.find((x) => x.dish.menuId === dish.menuId);
      if (exists && exists.quantity >= dish.stock) {
        toast("Món không còn đủ suất.");
        return old;
      }
      toast("Đã thêm vào giỏ");
      return exists
        ? old.map((x) =>
            x.dish.menuId === dish.menuId
              ? { ...x, quantity: x.quantity + 1 }
              : x,
          )
        : [...old, { dish, quantity: 1 }];
    });
  };
  const setQuantity = (id: string, n: number) =>
    setCart((old) =>
      n <= 0
        ? old.filter((x) => x.dish.menuId !== id)
        : old.map((x) =>
            x.dish.menuId === id
              ? { ...x, quantity: Math.min(n, x.dish.stock) }
              : x,
          ),
    );
  return (
    <AppContext.Provider
      value={{
        user,
        chef,
        authReady,
        authError,
        storageReady: ready,
        loadCache,
        location,
        cart,
        unread,
        revision,
        toast,
        dismissToast,
        refresh,
        markNotificationRead,
        refreshAuth,
        logout,
        setLocation,
        add,
        setQuantity,
        clearCart: () => setCart([]),
        locationOpen,
        setLocationOpen,
      }}
    >
      {children}
      {message && (
        <div className="toast" role="status">
          <span>{message.text}</span>
        </div>
      )}
    </AppContext.Provider>
  );
}
