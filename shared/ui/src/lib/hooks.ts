import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppIcon, MantelBridge, Preferences, Result, SystemVpnState, WifiSecurity } from "../../../core/contract";
import { resolveLanguage, type LanguagePreference } from "../../../core/i18n";
import { useI18n } from "../i18n/context";
import { toggleExcluded } from "./apps";

export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let id: number | undefined;
    const sync = () => {
      window.clearInterval(id);
      id = undefined;
      if (document.visibilityState === "hidden") return;
      setNow(Date.now());
      id = window.setInterval(() => setNow(Date.now()), intervalMs);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [intervalMs, active]);
  return now;
}

export function useSystemVpnState(
  bridge: MantelBridge,
  enabled: boolean,
  refreshKey?: unknown,
): { state: SystemVpnState | null; loading: boolean } {
  const [state, setState] = useState<SystemVpnState | null>(null);
  const [loading, setLoading] = useState(enabled && Boolean(bridge.systemVpnState));

  useEffect(() => {
    const read = bridge.systemVpnState;
    if (!enabled || !read) return;
    let disposed = false;
    const refresh = () => {
      read()
        .then((next) => {
          if (!disposed) setState(next);
        })
        .catch(() => {
          if (!disposed) setState(null);
        })
        .finally(() => {
          if (!disposed) setLoading(false);
        });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [bridge, enabled, refreshKey]);

  return { state, loading };
}

export function useWifiSecurity(bridge: MantelBridge, active: boolean): WifiSecurity | null {
  const [security, setSecurity] = useState<WifiSecurity | null>(null);
  useEffect(() => {
    const read = bridge.wifiSecurity;
    if (!active || !read) return;
    let disposed = false;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      read()
        .then((next) => {
          if (!disposed) setSecurity(next);
        })
        .catch(() => {
          if (!disposed) setSecurity(null);
        });
    };
    refresh();
    const id = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [bridge, active]);
  return active ? security : null;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

const SAVE_DELAY_MS = 600;

export function useExcludedApps(bridge: MantelBridge, enabled: boolean) {
  const { t } = useI18n();
  const texts = useRef(t);
  texts.current = t;
  const [excluded, setExcluded] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const current = useRef<string[]>([]);
  const confirmed = useRef<string[]>([]);
  const pending = useRef<string[] | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const version = useRef(0);

  useEffect(() => {
    const load = bridge.excludedApps;
    if (!enabled || !load) return;
    let disposed = false;
    load()
      .then((list) => {
        if (disposed || pending.current) return;
        confirmed.current = list;
        current.current = list;
        setExcluded(list);
      })
      .catch(() => {
        if (disposed) return;
        setExcluded([]);
        setError(texts.current.apps.excludedLoadFailed);
      });
    return () => {
      disposed = true;
    };
  }, [bridge, enabled]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const next = pending.current;
    const save = bridge.setExcludedApps;
    if (!next || !save) return;
    pending.current = null;
    version.current += 1;
    const mine = version.current;
    setSaveState("saving");
    let result: Result<string[]>;
    try {
      result = await save(next);
    } catch {
      result = { ok: false, error: texts.current.save.failed, code: "internal" };
    }
    if (mine !== version.current) return;
    if (result.ok) {
      confirmed.current = result.value;
      if (!pending.current) {
        current.current = result.value;
        setExcluded(result.value);
      }
      setError(null);
      setSaveState("saved");
      return;
    }
    if (!pending.current) {
      current.current = confirmed.current;
      setExcluded(confirmed.current);
    }
    setError(result.error);
    setSaveState("error");
  }, [bridge]);

  const toggle = useCallback(
    (packageName: string, value: boolean) => {
      const next = toggleExcluded(current.current, packageName, value);
      current.current = next;
      pending.current = next;
      setExcluded(next);
      setError(null);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => () => void flush(), [flush]);

  return { excluded, error, saveState, toggle };
}

export function useLanguageChoice(
  bridge: MantelBridge,
  preferences: Preferences,
  onPreferences: (next: Preferences) => void,
) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const current: LanguagePreference = resolveLanguage(preferences.language);

  const choose = async (next: LanguagePreference) => {
    if (next === current) return;
    setError(null);
    const previous = preferences;
    onPreferences({ ...preferences, language: next });
    if (!bridge.setLanguage) return;
    let result: Awaited<ReturnType<NonNullable<MantelBridge["setLanguage"]>>>;
    try {
      result = await bridge.setLanguage(next);
    } catch {
      result = { ok: false, error: "", code: "internal" };
    }
    if (!result.ok) {
      onPreferences(previous);
      setError(result.error || t.language.failed);
      return;
    }
    onPreferences(result.value);
  };

  return { current, choose, error };
}

export function useAppIcon(bridge: MantelBridge) {
  const [current, setCurrent] = useState<AppIcon | null>(null);
  const [pending, setPending] = useState<AppIcon | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    bridge
      .appIcon?.()
      .then((icon) => {
        if (!disposed) setCurrent(icon);
      })
      .catch(() => {
        if (!disposed) setCurrent("default");
      });
    return () => {
      disposed = true;
    };
  }, [bridge]);

  const choose = async (icon: AppIcon) => {
    if (!bridge.setAppIcon || pending || icon === current) return;
    setPending(icon);
    setError(null);
    const result = await bridge.setAppIcon(icon);
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCurrent(result.value);
  };

  return { current, pending, error, choose };
}

export function useRenew(bridge: MantelBridge) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = bridge.openAccountPage;

  const renew = async () => {
    if (!open || pending) return;
    setPending(true);
    setError(null);
    let result: Result<null>;
    try {
      result = await open();
    } catch {
      result = { ok: false, error: "", code: "internal" };
    }
    setPending(false);
    if (!result.ok) setError(result.error || t.errors.openWebsiteFailed);
  };

  return { available: Boolean(open), renew, pending, error };
}

export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function useChatScroll<T extends HTMLElement>(content: unknown) {
  const box = useRef<T | null>(null);
  const pinned = useRef(true);
  const attach = useCallback((node: T | null) => {
    box.current = node;
    if (!node) return;
    const end = () => {
      if (pinned.current) node.scrollTop = node.scrollHeight;
    };
    const scrolled = () => {
      pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(end) : null;
    observer?.observe(node);
    node.addEventListener("scroll", scrolled, { passive: true });
    end();
    return () => {
      observer?.disconnect();
      node.removeEventListener("scroll", scrolled);
    };
  }, []);
  useLayoutEffect(() => {
    if (box.current && pinned.current) box.current.scrollTop = box.current.scrollHeight;
  }, [content]);
  const pin = useCallback(() => {
    pinned.current = true;
  }, []);
  return { attach, pin };
}
