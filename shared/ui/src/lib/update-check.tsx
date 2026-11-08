import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CHECK_INTERVAL_MS,
  evaluateUpdate,
  isSnoozed,
  normalizeVersion,
  parseSnooze,
  SNOOZE_MS,
  type AppVersionInfo,
  type Snooze,
  type UpdateState,
} from "../../../core/app-version";
import type { MantelBridge, Result } from "../../../core/contract";

const SNOOZE_KEY = "mantel.updateSnooze";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readSnooze(store: StorageLike | null = storage()): Snooze | null {
  try {
    return parseSnooze(store?.getItem(SNOOZE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function writeSnooze(version: string, now: number, store: StorageLike | null = storage()): Snooze | null {
  const normalized = normalizeVersion(version);
  if (!normalized) return null;
  const snooze: Snooze = { version: normalized, until: now + SNOOZE_MS };
  try {
    store?.setItem(SNOOZE_KEY, JSON.stringify(snooze));
  } catch {
  }
  return snooze;
}

export async function fetchVersionInfo(bridge: Pick<MantelBridge, "checkAppVersion">): Promise<AppVersionInfo | null> {
  if (!bridge.checkAppVersion) return null;
  try {
    const result = await bridge.checkAppVersion();
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export type ManualCheck = "idle" | "checking" | "current" | "available" | "failed";

export type UpdateCheck = {
  supported: boolean;
  state: UpdateState;
  info: AppVersionInfo | null;
  snoozed: boolean;
  manual: ManualCheck;
  check: (options?: { manual?: boolean }) => Promise<void>;
  snooze: () => void;
  openDownload: () => Promise<Result<null>>;
};

const CURRENT: UpdateState = { kind: "current" };

const NO_DOWNLOAD: Result<null> = { ok: false, error: "", code: "internal" };

export const INACTIVE_UPDATE_CHECK: UpdateCheck = {
  supported: false,
  state: CURRENT,
  info: null,
  snoozed: false,
  manual: "idle",
  check: async () => undefined,
  snooze: () => undefined,
  openDownload: async () => NO_DOWNLOAD,
};

export function useUpdateCheck(
  bridge: MantelBridge | null,
  appVersion: string | undefined,
  now: () => number = Date.now,
): UpdateCheck {
  const supported = Boolean(bridge?.checkAppVersion);
  const [info, setInfo] = useState<AppVersionInfo | null>(null);
  const [snooze, setSnooze] = useState<Snooze | null>(() => readSnooze());
  const [manual, setManual] = useState<ManualCheck>("idle");
  const lastCheck = useRef(0);
  const running = useRef<Promise<AppVersionInfo | null> | null>(null);

  const check = useCallback(
    async (options: { manual?: boolean } = {}) => {
      if (!bridge?.checkAppVersion) return;
      if (options.manual) setManual("checking");
      running.current ??= fetchVersionInfo(bridge).finally(() => {
        running.current = null;
      });
      const next = await running.current;
      lastCheck.current = now();
      if (next) setInfo(next);
      if (options.manual) {
        const kind = next ? evaluateUpdate(appVersion, next).kind : null;
        setManual(kind === null ? "failed" : kind === "current" ? "current" : "available");
      }
    },
    [bridge, appVersion, now],
  );

  useEffect(() => {
    if (!supported) return;
    void check();
    const id = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible" && now() - lastCheck.current >= CHECK_INTERVAL_MS) void check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [supported, check, now]);

  const state = useMemo(() => (supported ? evaluateUpdate(appVersion, info) : CURRENT), [supported, appVersion, info]);
  const snoozed = isSnoozed(state, snooze, now());

  const snoozeCurrent = useCallback(() => {
    if (state.kind !== "available") return;
    setSnooze(writeSnooze(state.latest, now()));
  }, [state, now]);

  const openDownload = useCallback(async (): Promise<Result<null>> => {
    if (!bridge?.openDownloadPage) return NO_DOWNLOAD;
    try {
      return await bridge.openDownloadPage();
    } catch {
      return NO_DOWNLOAD;
    }
  }, [bridge]);

  return useMemo(
    () => ({ supported, state, info, snoozed, manual, check, snooze: snoozeCurrent, openDownload }),
    [supported, state, info, snoozed, manual, check, snoozeCurrent, openDownload],
  );
}

const UpdateContext = createContext<UpdateCheck>(INACTIVE_UPDATE_CHECK);

export function UpdateProvider({ value, children }: { value: UpdateCheck; children: ReactNode }) {
  return <UpdateContext value={value}>{children}</UpdateContext>;
}

export function useUpdate(): UpdateCheck {
  return useContext(UpdateContext);
}
