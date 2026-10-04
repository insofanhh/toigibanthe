"use client";
import { useEffect, useState } from "react";
import { Bell, BellOff, Send, LoaderCircle } from "lucide-react";
import { useApp } from "./providers";
import {
  applicationServerKey,
  clearPushIntent,
  defaultPushPreferences,
  pushRequest,
  pushSupport,
  registerPushWorker,
  savePushIntent,
  setPushIdentity,
  type PushPreferences,
} from "@/lib/push-client";

export function PushSettings() {
  const { user } = useApp();
  const [ready, setReady] = useState(false),
    [supported, setSupported] = useState(false),
    [iosInstall, setIosInstall] = useState(false),
    [configured, setConfigured] = useState(false),
    [active, setActive] = useState(false),
    [permission, setPermission] = useState<NotificationPermission>("default"),
    [preferences, setPreferences] = useState<PushPreferences>(
      defaultPushPreferences,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setActive(false);
    setPreferences(defaultPushPreferences);
    (async () => {
      const support = pushSupport();
      setSupported(support.supported);
      setIosInstall(support.iosNeedsInstall);
      if (!support.supported || support.iosNeedsInstall) {
        setReady(true);
        return;
      }
      setPermission(Notification.permission);
      const config = await pushRequest("config");
      if (cancelled) return;
      setConfigured(config.configured);
      const reg = await registerPushWorker();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const status = await pushRequest("status", {
          endpoint: sub.endpoint,
          userId: user?.id,
        });
        if (cancelled) return;
        setActive(status.active);
        setPreferences(status.preferences);
      }
      setReady(true);
    })().catch((e) => {
      if (!cancelled) {
        setReady(true);
        setError(e.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  async function enable() {
    if (!user) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      // Request directly in the click gesture, before network or service-worker waits.
      const granted =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted")
        throw new Error(
          granted === "denied"
            ? "Quyền thông báo đã bị chặn. Hãy cho phép trong cài đặt trình duyệt."
            : "Bạn chưa cấp quyền nhận thông báo.",
        );
      const config = await pushRequest("config");
      if (!config.configured)
        throw new Error("Hệ thống chưa cấu hình thông báo đẩy.");
      const reg = await registerPushWorker();
      const key = applicationServerKey(config.publicKey);
      let subscription = await reg.pushManager.getSubscription();
      const oldKey = subscription?.options.applicationServerKey;
      if (
        subscription &&
        oldKey &&
        !Array.from(new Uint8Array(oldKey)).every((v, i) => v === key[i])
      ) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ||= await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await setPushIdentity(reg, user.id);
      await pushRequest("subscribe", {
        userId: user.id,
        subscription: subscription.toJSON(),
        preferences,
      });
      savePushIntent(user.id, preferences);
      setActive(true);
      setMessage("Đã bật thông báo trên thiết bị này.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const reg = await registerPushWorker(),
        sub = await reg.pushManager.getSubscription();
      if (sub)
        await pushRequest("unsubscribe", {
          endpoint: sub.endpoint,
          userId: user?.id,
        });
      clearPushIntent();
      await setPushIdentity(reg, null);
      setActive(false);
      // Backend revocation succeeds even if the browser cannot unsubscribe offline.
      await sub?.unsubscribe();
      setMessage("Đã tắt thông báo trên thiết bị này.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function change(name: keyof PushPreferences, value: boolean) {
    if (!user) return;
    const next = { ...preferences, [name]: value };
    if (!active) {
      setPreferences(next);
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    setPreferences(next);
    try {
      const sub = await (
        await registerPushWorker()
      ).pushManager.getSubscription();
      if (!sub) throw new Error("Hãy bật lại thông báo trên thiết bị này.");
      await pushRequest("subscribe", {
        userId: user.id,
        subscription: sub.toJSON(),
        preferences: next,
      });
      savePushIntent(user.id, next);
      setMessage("Đã lưu loại thông báo.");
    } catch (e) {
      setPreferences(preferences);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const sub = await (
        await registerPushWorker()
      ).pushManager.getSubscription();
      if (!sub) throw new Error("Hãy bật lại thông báo trên thiết bị này.");
      await pushRequest("test", { endpoint: sub.endpoint, userId: user?.id });
      setMessage(
        "Đã gửi yêu cầu thông báo thử. Kiểm tra khu vực thông báo của thiết bị.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel narrow push-settings"
      aria-labelledby="push-title"
    >
      <div className="push-heading">
        <Bell size={22} strokeWidth={1.5} />
        <div>
          <h2 id="push-title">Thông báo trên thiết bị</h2>
          <p>Nhận thông báo đơn hàng và tin mới khi không mở app.</p>
        </div>
      </div>
      {!ready ? (
        <p role="status">Đang kiểm tra thiết bị…</p>
      ) : iosInstall ? (
        <p>
          Trên iPhone/iPad (iOS 16.4 trở lên), mở bằng Safari → Chia sẻ → Thêm
          vào Màn hình chính. Mở app từ biểu tượng đó để bật thông báo.
        </p>
      ) : !supported ? (
        <p>
          Trình duyệt này chưa hỗ trợ thông báo đẩy. Hãy mở bằng trình duyệt hỗ
          trợ Web Push qua HTTPS.
        </p>
      ) : (
        <>
          <span className="badge push-state" data-active={active}>
            {active ? "Đã bật trên thiết bị này" : "Chưa bật"}
          </span>
          {!configured && <p>Hệ thống chưa cấu hình thông báo đẩy.</p>}
          {permission === "denied" && (
            <p>
              Thông báo đang bị chặn. Cho phép thông báo trong cài đặt trang web
              của trình duyệt rồi tải lại trang.
            </p>
          )}
          <fieldset disabled={busy || !configured} className="push-preferences">
            <legend>Loại thông báo</legend>
            {(
              [
                ["orders", "Đơn hàng"],
                ["news", "Tin tức hệ thống"],
                ["promotions", "Khuyến mãi"],
              ] as const
            ).map(([name, label]) => (
              <label key={name}>
                <input
                  type="checkbox"
                  checked={preferences[name]}
                  onChange={(e) => void change(name, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <div className="push-actions">
            <button
              className={"button " + (active ? "secondary" : "")}
              disabled={
                busy || !configured || (!active && permission === "denied")
              }
              onClick={() => void (active ? disable() : enable())}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : active ? (
                <BellOff size={16} />
              ) : (
                <Bell size={16} />
              )}{" "}
              {active ? "Tắt thông báo" : "Bật thông báo"}
            </button>
            {active && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void test()}
              >
                <Send size={16} />
                Gửi thông báo thử
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
