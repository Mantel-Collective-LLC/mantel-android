import { useEffect, useState } from "react";
import type { MantelBridge, Preferences } from "../../../core/contract";
import { parseThemePreference, resolveTheme, type Theme, type ThemePreference } from "../../../core/theme";
import { useI18n } from "../i18n/context";
import { applyTheme, readStoredTheme, storeTheme, systemThemeOf, watchSystemTheme } from "./theme-dom";

export * from "./theme-dom";

export function useSystemTheme(bridge?: Pick<MantelBridge, "onSystemThemeChange"> | null): Theme {
  const [system, setSystem] = useState<Theme>(() => systemThemeOf());
  const native = bridge?.onSystemThemeChange;
  useEffect(() => {
    setSystem(systemThemeOf());
    return watchSystemTheme(setSystem, { native });
  }, [native]);
  return system;
}

export function effectiveThemePreference(preferences: Pick<Preferences, "theme"> | null | undefined): ThemePreference {
  return preferences?.theme !== undefined ? parseThemePreference(preferences.theme) : readStoredTheme();
}

export function useAppliedTheme(
  preferences: Pick<Preferences, "theme"> | null,
  bridge?: Pick<MantelBridge, "onSystemThemeChange"> | null,
): { preference: ThemePreference; theme: Theme; system: Theme } {
  const system = useSystemTheme(bridge);
  const preference = effectiveThemePreference(preferences);
  const theme = resolveTheme(preference, system);
  useEffect(() => applyTheme(theme), [theme]);
  const known = preferences !== null;
  useEffect(() => {
    if (known) storeTheme(preference);
  }, [known, preference]);
  return { preference, theme, system };
}

export function useThemeChoice(
  bridge: Pick<MantelBridge, "setTheme">,
  preferences: Preferences,
  onPreferences: (next: Preferences) => void,
) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const current = effectiveThemePreference(preferences);

  const choose = async (next: ThemePreference) => {
    if (next === current) return;
    setError(null);
    const previous = preferences;
    storeTheme(next);
    onPreferences({ ...preferences, theme: next });
    if (!bridge.setTheme) return;
    let result: Awaited<ReturnType<NonNullable<MantelBridge["setTheme"]>>>;
    try {
      result = await bridge.setTheme(next);
    } catch {
      result = { ok: false, error: "", code: "internal" };
    }
    if (!result.ok) {
      storeTheme(current);
      onPreferences(previous);
      setError(result.error || t.theme.failed);
      return;
    }
    onPreferences(result.value);
  };

  return { current, choose, error };
}
