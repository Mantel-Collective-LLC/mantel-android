import { useCallback, useEffect, useState } from "react";
import type { LoginOverview, MantelBridge, Result } from "../../../core/contract";

const POLL_MS = 5 * 60_000;

export type LoginNotices = {
  available: boolean;
  overview: LoginOverview | null;
  reload: () => Promise<void>;
  confirm: () => Promise<Result<null>>;
  logoutOthers: () => Promise<Result<null>>;
};

export const NOTHING_PENDING: LoginOverview = { logins: [] };

const UNAVAILABLE: Result<null> = { ok: false, error: "", code: "internal" };

export function useLoginNotices(bridge: MantelBridge): LoginNotices {
  const [overview, setOverview] = useState<LoginOverview | null>(null);
  const available = typeof bridge.recentLogins === "function";

  const reload = useCallback(async () => {
    const result = await bridge.recentLogins?.().catch(() => null);
    if (result?.ok) setOverview(result.value);
  }, [bridge]);

  useEffect(() => {
    if (!available) return;
    void reload();
    const id = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void reload();
    }, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [available, reload]);

  const settle = useCallback(async (call: (() => Promise<Result<null>>) | undefined) => {
    const result = call ? await call().catch(() => UNAVAILABLE) : UNAVAILABLE;
    if (result.ok) setOverview(NOTHING_PENDING);
    return result;
  }, []);

  const confirm = useCallback(() => settle(bridge.markLoginsSeen), [bridge, settle]);
  const logoutOthers = useCallback(() => settle(bridge.logoutOtherSessions), [bridge, settle]);

  return { available, overview, reload, confirm, logoutOthers };
}
