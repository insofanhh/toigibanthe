"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  MoreVertical,
  PlusSquare,
  Share,
  Smartphone,
  X,
} from "lucide-react";
import { useApp } from "./providers";
import { Link } from "./page-motion";
import { useLoad } from "./app";
import {
  popupDue,
  popupEligible,
  popupOrder,
  popupSeenKey,
  type HomePopupFeed,
  type HomePopupSettings,
  type PopupKind,
} from "@/lib/home-popup-domain";

const seenInMemory = new Map<string, string>();
function storage(settings: HomePopupSettings) {
  return settings.frequency === "session"
    ? window.sessionStorage
    : window.localStorage;
}
function readSeen(settings: HomePopupSettings, kind: PopupKind) {
  const key = popupSeenKey(settings, kind);
  try {
    return storage(settings).getItem(key) || seenInMemory.get(key) || null;
  } catch {
    return seenInMemory.get(key) || null;
  }
}
function markSeen(settings: HomePopupSettings, kind: PopupKind, now: number) {
  const key = popupSeenKey(settings, kind),
    value = String(now);
  seenInMemory.set(key, value);
  try {
    storage(settings).setItem(key, value);
  } catch {
    /* Memory fallback for private browsing. */
  }
}

export function HomePopupDialog({
  kind,
  settings,
  onClose,
  preview = false,
}: {
  kind: PopupKind;
  settings: HomePopupSettings;
  onClose: () => void;
  preview?: boolean;
}) {
  const { pwaInstall, toast } = useApp();
  const dialog = useRef<HTMLDialogElement>(null);
  const [platform, setPlatform] = useState<"ios" | "android">(
    pwaInstall.platform === "ios" ? "ios" : "android",
  );
  const [imageFailed, setImageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = settings[kind];
  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  async function install() {
    setBusy(true);
    try {
      const outcome = await pwaInstall.prompt();
      if (outcome === "unavailable")
        toast("Hãy làm theo hướng dẫn để thêm ứng dụng vào màn hình chính.");
      else {
        if (outcome === "accepted") toast("Đã gửi yêu cầu cài ứng dụng.");
        onClose();
      }
    } catch {
      toast(
        "Chưa mở được yêu cầu cài đặt. Bạn có thể cài theo hướng dẫn bên trên.",
      );
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      className={`home-popup-dialog home-popup-${kind}`}
      aria-labelledby="home-popup-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        className="home-popup-close"
        aria-label="Đóng popup"
        onClick={onClose}
        autoFocus
      >
        <X size={25} strokeWidth={1.5} />
      </button>
      <div className="home-popup-card">
        {kind === "promotion" ? (
          <>
            {settings.promotion.imageUrl && !imageFailed && (
              <img
                className="home-popup-art"
                src={settings.promotion.imageUrl}
                alt={settings.promotion.title}
                onError={() => setImageFailed(true)}
              />
            )}
            <div className="home-popup-content">
              {preview && (
                <small className="home-popup-preview-label">Xem trước</small>
              )}
              <h2 id="home-popup-title">{p.title || "Chương trình nổi bật"}</h2>
              {p.description && <p>{p.description}</p>}
              {imageFailed && <p>Ảnh chương trình chưa tải được.</p>}
              {preview ? (
                <button className="button" onClick={onClose}>
                  {settings.promotion.buttonText}
                </button>
              ) : (
                <Link
                  href={settings.promotion.href}
                  className="button"
                  onClick={onClose}
                >
                  {settings.promotion.buttonText}
                </Link>
              )}
            </div>
          </>
        ) : (
          <div className="home-popup-content">
            <span className="home-popup-install-icon">
              <Smartphone size={25} />
            </span>
            {preview && (
              <small className="home-popup-preview-label">Xem trước</small>
            )}
            <h2 id="home-popup-title">{p.title}</h2>
            {p.description && <p>{p.description}</p>}
            <div
              className="home-popup-platforms"
              aria-label="Chọn thiết bị hướng dẫn"
            >
              <button
                type="button"
                aria-pressed={platform === "ios"}
                onClick={() => setPlatform("ios")}
              >
                iPhone / iPad
              </button>
              <button
                type="button"
                aria-pressed={platform === "android"}
                onClick={() => setPlatform("android")}
              >
                Android
              </button>
            </div>
            {settings.install.showVideo && (
              <video
                key={platform}
                className="home-popup-video"
                controls
                playsInline
                muted
                preload="none"
                poster={`/install-guide-${platform}.webp`}
                aria-label={`Video minh họa cài ứng dụng trên ${platform === "ios" ? "Safari" : "Chrome"}`}
              >
                <source
                  src={`/install-guide-${platform}.mp4`}
                  type="video/mp4"
                />
                Trình duyệt không phát được video. Hãy làm theo các bước bên
                dưới.
              </video>
            )}
            <ol className="home-popup-steps">
              <li>
                <span>1</span>
                <div>
                  Mở website bằng{" "}
                  <strong>{platform === "ios" ? "Safari" : "Chrome"}</strong>.
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  {platform === "ios" ? (
                    <>
                      Bấm <Share size={14} /> <strong>Chia sẻ</strong>, chọn{" "}
                      <strong>Thêm vào Màn hình chính</strong>.
                    </>
                  ) : (
                    <>
                      Bấm <MoreVertical size={14} /> <strong>Menu</strong>, chọn{" "}
                      <strong>Cài đặt ứng dụng</strong> hoặc{" "}
                      <strong>Thêm vào màn hình chính</strong>.
                    </>
                  )}
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  Bấm <PlusSquare size={14} />{" "}
                  <strong>{platform === "ios" ? "Thêm" : "Cài đặt"}</strong>,
                  rồi mở app từ màn hình chính.
                </div>
              </li>
            </ol>
            {(pwaInstall.embedded ||
              (platform === "ios" && pwaInstall.platform === "ios")) && (
              <p className="home-popup-browser-hint">
                Nếu menu hiện tại không có tùy chọn thêm vào màn hình chính, hãy
                mở website bằng {platform === "ios" ? "Safari" : "Chrome"}.
              </p>
            )}
            <div className="home-popup-buttons">
              {!preview &&
                platform === "android" &&
                pwaInstall.canPrompt &&
                !pwaInstall.installed && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void install()}
                  >
                    <Download size={16} />
                    {busy ? "Đang mở cài đặt…" : "Cài ứng dụng"}
                  </button>
                )}
              <button className="button secondary" onClick={onClose}>
                Đã hiểu
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  );
}

export function HomePopups() {
  const { storageReady, authReady, revision, locationOpen, pwaInstall } =
    useApp();
  const [visit] = useState(() => Date.now().toString(36));
  const load = useLoad<HomePopupFeed>(
    storageReady && authReady ? `home-popups?visit=${visit}` : null,
    [revision],
  );
  const [active, setActive] = useState<{
    kind: PopupKind;
    settings: HomePopupSettings;
  } | null>(null);
  const [visible, setVisible] = useState(true);
  const handled = useRef(false);
  const serverOffset = useRef(0);
  useEffect(() => {
    serverOffset.current =
      Date.parse(load.data?.serverNow || "") - Date.now() || 0;
  }, [load.data]);
  useEffect(() => {
    const update = () => {
      setVisible(document.visibilityState !== "hidden");
      if (document.visibilityState !== "hidden") load.reload();
    };
    const interval = setInterval(() => {
      if (document.visibilityState !== "hidden") load.reload();
    }, 60000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, [load.reload]);
  const installable = pwaInstall.platform !== "other" && !pwaInstall.installed;
  useEffect(() => {
    if (active?.kind === "install" && pwaInstall.installed) setActive(null);
  }, [active, pwaInstall.installed]);
  useEffect(() => {
    const settings = load.data?.settings;
    if (!settings || locationOpen || !visible || load.loading || load.error)
      return;
    const now = () => Date.now() + serverOffset.current;
    if (active) {
      if (
        active.settings.version !== settings.version ||
        !popupEligible(active.kind, settings, now(), installable)
      )
        setActive(null);
      return;
    }
    if (handled.current) return;
    const candidate = popupOrder(settings.priority).find(
      (kind) =>
        popupEligible(kind, settings, now(), installable) &&
        popupDue(settings.frequency, readSeen(settings, kind), now()),
    );
    if (!candidate) return;
    const timer = setTimeout(() => {
      if (
        document.visibilityState === "hidden" ||
        document.querySelector('dialog[open], [aria-modal="true"]')
      )
        return;
      if (!popupEligible(candidate, settings, now(), installable)) return;
      handled.current = true;
      markSeen(settings, candidate, now());
      setActive({ kind: candidate, settings });
    }, settings.delaySeconds * 1000);
    return () => clearTimeout(timer);
  }, [
    load.data,
    load.loading,
    load.error,
    active,
    locationOpen,
    visible,
    installable,
  ]);
  useEffect(() => {
    if (!load.data) return;
    const now = Date.now() + serverOffset.current;
    const times = [
      load.data.settings.promotion.startsAt,
      load.data.settings.promotion.endsAt,
    ]
      .filter((time): time is string => !!time)
      .map(Date.parse)
      .filter((time) => time > now);
    if (!times.length) return;
    const timer = setTimeout(
      load.reload,
      Math.min(2147483647, Math.min(...times) - now + 50),
    );
    return () => clearTimeout(timer);
  }, [load.data, load.reload]);
  useEffect(() => {
    const endsAt =
      active?.kind === "promotion" ? active.settings.promotion.endsAt : null;
    if (!endsAt) return;
    const timer = setTimeout(
      () => {
        if (Date.parse(endsAt) <= Date.now() + serverOffset.current)
          setActive(null);
        else load.reload();
      },
      Math.min(
        2147483647,
        Math.max(0, Date.parse(endsAt) - Date.now() - serverOffset.current),
      ),
    );
    return () => clearTimeout(timer);
  }, [active, load.reload]);
  return active ? (
    <HomePopupDialog
      kind={active.kind}
      settings={active.settings}
      onClose={() => setActive(null)}
    />
  ) : null;
}
