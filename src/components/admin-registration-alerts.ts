"use client";
import { useCallback, useEffect, useRef } from "react";
import { useLoad } from "./app";
import { post, useApp } from "./providers";
import type { RegistrationAlerts } from "@/lib/admin-registration-alerts";

export function useRegistrationAlerts() {
  const { user, loadCache, toast } = useApp();
  const enabled = user?.role === "admin";
  const { data, error, reload } = useLoad<RegistrationAlerts>(
    enabled ? "admin/users/registrations" : null,
  );
  const identity = `${user?.id}:${user?.role}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const busy = useRef(false);
  const markSeen = useCallback(async () => {
    if (!enabled || busy.current || !data?.ids.length) return;
    busy.current = true;
    try {
      const result = await post("admin/users/registrations", { ids: data.ids });
      if (currentIdentity.current !== identity) return;
      const key = `${user.id}:${user.role}:admin/users/registrations`;
      if (loadCache.read<RegistrationAlerts>(key).data === data)
        loadCache.set(key, result);
      reload();
    } catch (e) {
      if (currentIdentity.current === identity) {
        toast((e as Error).message);
        reload();
      }
    } finally {
      busy.current = false;
    }
  }, [enabled, data, identity, user, loadCache, toast, reload]);

  useEffect(() => {
    if (!enabled) return;
    const update = () => {
      if (document.visibilityState === "visible") reload();
    };
    const interval = setInterval(update, 30000);
    const realtime = (event: Event) => {
      const alertId = (event as CustomEvent<{ alertId?: string }>).detail
        ?.alertId;
      if (alertId && user) {
        const key = `${user.id}:${user.role}:admin/users/registrations`;
        const cached = loadCache.read<RegistrationAlerts>(key).data;
        if (cached && !cached.ids.includes(alertId))
          loadCache.set(key, {
            count: cached.count + 1,
            ids: [alertId, ...cached.ids].slice(0, 500),
          });
      }
      update();
    };
    window.addEventListener("tgbd:admin-registrations", realtime);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(interval);
      window.removeEventListener("tgbd:admin-registrations", realtime);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [enabled, user, loadCache, reload]);
  return { count: enabled ? data?.count || 0 : 0, markSeen, error, reload };
}
