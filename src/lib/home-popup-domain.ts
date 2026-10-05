export type PopupFrequency = "session" | "daily" | "weekly";
export type PopupKind = "install" | "promotion";
export type HomePopupSettings = {
  version: string;
  frequency: PopupFrequency;
  priority: PopupKind;
  delaySeconds: number;
  install: {
    enabled: boolean;
    title: string;
    description: string;
    showVideo: boolean;
  };
  promotion: {
    enabled: boolean;
    title: string;
    description: string;
    imageUrl: string;
    buttonText: string;
    href: string;
    startsAt: string | null;
    endsAt: string | null;
  };
};
export type HomePopupFeed = { settings: HomePopupSettings; serverNow: string };
export const defaultHomePopupSettings: HomePopupSettings = {
  version: "initial",
  frequency: "daily",
  priority: "promotion",
  delaySeconds: 2,
  install: {
    enabled: false,
    title: "Thêm app vào màn hình chính",
    description: "Mở ứng dụng nhanh từ màn hình chính điện thoại.",
    showVideo: true,
  },
  promotion: {
    enabled: false,
    title: "",
    description: "",
    imageUrl: "",
    buttonText: "Xem chương trình",
    href: "/offers",
    startsAt: null,
    endsAt: null,
  },
};
export function promotionActive(settings: HomePopupSettings, now: number) {
  const p = settings.promotion;
  return (
    p.enabled &&
    (!p.startsAt || Date.parse(p.startsAt) <= now) &&
    (!p.endsAt || Date.parse(p.endsAt) > now)
  );
}
export function popupEligible(
  kind: PopupKind,
  settings: HomePopupSettings,
  now: number,
  installable: boolean,
) {
  return kind === "install"
    ? settings.install.enabled && installable
    : promotionActive(settings, now);
}
export function popupSeenKey(settings: HomePopupSettings, kind: PopupKind) {
  return `tgbd-home-popup:${settings.version}:${kind}`;
}
export function popupDue(
  frequency: PopupFrequency,
  lastSeen: string | null,
  now: number,
) {
  if (!lastSeen || !Number.isFinite(Number(lastSeen))) return true;
  if (frequency === "session") return false;
  return now - Number(lastSeen) >= (frequency === "weekly" ? 7 : 1) * 86400000;
}
export function popupOrder(priority: PopupKind): PopupKind[] {
  return priority === "promotion"
    ? ["promotion", "install"]
    : ["install", "promotion"];
}
export function safePopupHref(value: string) {
  // Internal app routes only. Backslashes and control characters can change URL parsing.
  return (
    /^\/(?!\/)/.test(value) &&
    !/[\\\u0000-\u0020\u007f]/.test(value) &&
    !/%(?:0[0-9a-f]|1[0-9a-f]|20|5c|7f)/i.test(value)
  );
}
