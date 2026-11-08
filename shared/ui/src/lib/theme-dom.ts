import type { MantelBridge } from "../../../core/contract";
import {
  DEFAULT_THEME_PREFERENCE,
  isTheme,
  parseThemePreference,
  resolveTheme,
  THEME_CANVAS,
  type Theme,
  type ThemePreference,
} from "../../../core/theme";

export const THEME_STORAGE_KEY = "mantel.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export type ThemeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ColorSchemeQuery = {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
};

function defaultStorage(): ThemeStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function defaultQuery(): ColorSchemeQuery | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(DARK_QUERY);
}

export function readStoredTheme(storage: ThemeStorage | null = defaultStorage()): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function storeTheme(preference: ThemePreference, storage: ThemeStorage | null = defaultStorage()): void {
  try {
    if (preference === DEFAULT_THEME_PREFERENCE) storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
  }
}

export function systemThemeOf(query: ColorSchemeQuery | null = defaultQuery()): Theme {
  return query?.matches ? "dark" : "light";
}

export function watchSystemTheme(
  onChange: (theme: Theme) => void,
  sources: { query?: ColorSchemeQuery | null; native?: MantelBridge["onSystemThemeChange"] } = {},
): () => void {
  const query = sources.query === undefined ? defaultQuery() : sources.query;
  const onMedia = (event: { matches: boolean }) => onChange(event.matches ? "dark" : "light");
  query?.addEventListener("change", onMedia);
  let stopNative: (() => void) | undefined;
  try {
    stopNative = sources.native?.((theme) => {
      if (isTheme(theme)) onChange(theme);
    });
  } catch {
    stopNative = undefined;
  }
  return () => {
    query?.removeEventListener("change", onMedia);
    stopNative?.();
  };
}

export type ThemeTarget = {
  documentElement: { dataset: DOMStringMap; style: { colorScheme: string } };
  querySelector(selector: string): { setAttribute(name: string, value: string): void } | null;
};

export function applyTheme(theme: Theme, target: ThemeTarget | null = typeof document === "undefined" ? null : document): void {
  if (!target) return;
  target.documentElement.dataset.theme = theme;
  target.documentElement.style.colorScheme = theme;
  target.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_CANVAS[theme]);
}

export function bootTheme(): Theme {
  const theme = resolveTheme(readStoredTheme(), systemThemeOf());
  applyTheme(theme);
  return theme;
}
