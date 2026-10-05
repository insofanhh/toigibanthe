"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLoad } from "./app";
import { post, useApp } from "./providers";
import type { RegistrationAlerts } from "@/lib/admin-registration-alerts";

const alertKinds = {
  users: {
    path: "admin/users/registrations",
    event: "tgbd:admin-registrations",
    toastKey: "admin-registrations",
    message: (count: number) => `Có ${count} user mới đăng ký`,
  },
  chefs: {
    path: "admin/chefs/applications",
    event: "tgbd:admin-chef-applications",
    toastKey: "admin-chef-applications",
    message: (count: number) => `Có ${count} yêu cầu mở bếp mới`,
  },
};

export function useRegistrationAlerts(usersOpen: boolean) {
  return useAdminAlerts("users", usersOpen);
}
export function useChefApplicationAlerts(chefsOpen: boolean) {
  return useAdminAlerts("chefs", chefsOpen);
}
function useAdminAlerts(kind: keyof typeof alertKinds, tabOpen: boolean) {
  const { path, event: eventName, toastKey, message } = alertKinds[kind];
  const { user, loadCache, toast, dismissToast, refresh } = useApp();
  const enabled = user?.role === "admin";
  const { data, error, reload } = useLoad<RegistrationAlerts>(
    enabled ? path : null,
  );
  const identity = `${user?.id}:${user?.role}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const acknowledged = useRef({ identity, ids: new Set<string>() });
  if (acknowledged.current.identity !== identity)
    acknowledged.current = { identity, ids: new Set<string>() };
  const mounted = useRef(true);
  const busy = useRef(false);
  const notified = useRef("");
  const announced = useRef({ identity, ids: new Set<string>(), loaded: false });
  if (announced.current.identity !== identity)
    announced.current = { identity, ids: new Set<string>(), loaded: false };
  const [reading, setReading] = useState<{
    identity: string;
    ids: string[];
  } | null>(null);
  const [readError, setReadError] = useState("");
  const showNotice = useCallback(
    async (force = false) => {
      if (!enabled || busy.current || !data?.count || !data.ids.length) return;
      const batch =
        identity + ":" + data.count + ":" + [...data.ids].sort().join(",");
      if (!force && notified.current === batch) return;
      notified.current = batch;
      busy.current = true;
      setReading({ identity, ids: data.ids });
      setReadError("");
      toast(message(data.count), { key: toastKey, duration: 8000 });
      try {
        const result: RegistrationAlerts = await post(path, { ids: data.ids });
        if (!mounted.current || currentIdentity.current !== identity) return;
        for (const id of data.ids) acknowledged.current.ids.add(id);
        while (acknowledged.current.ids.size > 1000)
          acknowledged.current.ids.delete(
            acknowledged.current.ids.values().next().value!,
          );
        const key = `${user.id}:${user.role}:${path}`;
        const latest = loadCache.read<RegistrationAlerts>(key).data;
        if (latest === data) loadCache.set(key, result);
        else if (latest) {
          // Remove only the viewed snapshot; preserve arrivals during the POST.
          const seen = new Set(data.ids);
          const ids = latest.ids.filter((id) => !seen.has(id));
          loadCache.set(key, {
            count: Math.max(0, latest.count - (latest.ids.length - ids.length)),
            ids,
          });
        }
        reload();
      } catch (e) {
        if (mounted.current && currentIdentity.current === identity) {
          setReadError((e as Error).message);
          toast((e as Error).message);
        }
      } finally {
        busy.current = false;
        if (mounted.current)
          setReading((current) =>
            current?.identity === identity ? null : current,
          );
      }
    },
    [
      enabled,
      data,
      identity,
      user,
      loadCache,
      toast,
      reload,
      path,
      message,
      toastKey,
    ],
  );
  useEffect(() => {
    if (!tabOpen || !enabled) {
      notified.current = "";
      return;
    }
    if (!reading && data?.count) void showNotice();
  }, [tabOpen, enabled, data, reading, dismissToast, showNotice, toastKey]);
  useEffect(() => {
    if (!enabled || !data) return;
    const arrivals = data.ids.filter((id) => !announced.current.ids.has(id));
    const loaded = announced.current.loaded;
    announced.current.loaded = true;
    for (const id of arrivals) announced.current.ids.add(id);
    if (!arrivals.length) return;
    // The open tab announces and acknowledges its snapshot in showNotice.
    // Other tabs keep the badge unread and announce both socket and poll arrivals.
    if (!tabOpen)
      toast(message(data.count), { key: toastKey, duration: 8000 });
    if (loaded) refresh();
  }, [enabled, identity, data, tabOpen, toast, message, toastKey, refresh]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      dismissToast(toastKey);
    };
  }, [dismissToast, toastKey]);
  const retry = useCallback(() => {
    notified.current = "";
    setReadError("");
    reload();
    if (tabOpen) void showNotice(true);
  }, [reload, tabOpen, showNotice]);

  useEffect(() => {
    if (!enabled) return;
    const update = (force = false) => {
      if (document.visibilityState !== "visible") return;
      const key = `${user!.id}:${user!.role}:${path}`;
      if (force || !loadCache.read(key).loading) reload();
    };
    // Recover missed events while WSS reconnects or a mobile tab resumes.
    const interval = setInterval(update, 5000);
    const resume = () => update();
    const realtime = (event: Event) => {
      const alertId = (event as CustomEvent<{ alertId?: string }>).detail
        ?.alertId;
      if (alertId && user && !acknowledged.current.ids.has(alertId)) {
        const key = `${user.id}:${user.role}:${path}`;
        const cached = loadCache.read<RegistrationAlerts>(key).data;
        if (cached && !cached.ids.includes(alertId))
          loadCache.set(key, {
            count: cached.count + 1,
            ids: [alertId, ...cached.ids].slice(0, 500),
          });
      }
      update(true);
    };
    window.addEventListener(eventName, realtime);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearInterval(interval);
      window.removeEventListener(eventName, realtime);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [enabled, user, loadCache, reload, path, eventName]);
  const pendingIds = new Set(reading?.identity === identity ? reading.ids : []);
  const count = Math.max(
    0,
    (data?.count || 0) -
      (data?.ids.filter((id) => pendingIds.has(id)).length || 0),
  );
  return {
    count: enabled && (!tabOpen || readError || error) ? count : 0,
    showNotice,
    error: error || readError,
    reload: retry,
  };
}
