export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_PREFERENCES = ["system", ...THEMES] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

export const THEME_CANVAS: Record<Theme, string> = { light: "#fafaf9", dark: "#0c0c0e" };

export const THEME_INK: Record<Theme, string> = { light: "#18181b", dark: "#f2f2f4" };

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function parseThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(preference: ThemePreference | null | undefined, systemTheme: Theme): Theme {
  return isTheme(preference) ? preference : systemTheme;
}
