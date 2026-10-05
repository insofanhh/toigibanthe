"use client";
import { useCallback, useEffect, useRef } from "react";
import { useLoad } from "./app";
import { post, useApp } from "./providers";
import type { RegistrationAlerts } from "@/lib/admin-registration-alerts";

export function useRegistrationAlerts(usersOpen: boolean) {
  const { user, revision, loadCache, toast } = useApp();
  const enabled = user?.role === "admin";
  const { data, loading, error, reload } = useLoad<RegistrationAlerts>(
    enabled ? "admin/users/registrations" : null,
    [revision],
  );
  const identity = `${user?.id}:${user?.role}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const opened = useRef(false);
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
    if (!usersOpen) {
      opened.current = false;
      return;
    }
    if (!data || loading || error || opened.current) return;
    opened.current = true;
    void markSeen();
  }, [usersOpen, data, loading, error, markSeen]);
  useEffect(() => {
    if (!enabled) return;
    const update = () => {
      if (document.visibilityState === "visible") reload();
    };
    const interval = setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
    };
  }, [enabled, reload]);
  return { count: enabled ? data?.count || 0 : 0, markSeen };
}
