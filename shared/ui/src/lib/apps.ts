import type { InstalledApp } from "../../../core/contract";
import type { Translator } from "../../../core/i18n";

export type IndexedApp = InstalledApp & { search: string };

export function indexApps(apps: InstalledApp[]): IndexedApp[] {
  return apps.map((app) => ({ ...app, search: `${app.label}\n${app.packageName}`.toLocaleLowerCase("de-DE") }));
}

export function filterApps(apps: IndexedApp[], query: string, showSystem: boolean): IndexedApp[] {
  const needle = query.trim().toLocaleLowerCase("de-DE");
  return apps.filter((app) => (showSystem || !app.system) && (!needle || app.search.includes(needle)));
}

export function excludedSummary(count: number, i18n: Translator): string {
  if (count === 0) return i18n.t.settings.excludedNone;
  return i18n.plural(i18n.t.settings.excludedSome, count);
}

export function toggleExcluded(current: readonly string[], packageName: string, excluded: boolean): string[] {
  const rest = current.filter((entry) => entry !== packageName);
  return excluded ? [...rest, packageName].sort() : rest;
}
