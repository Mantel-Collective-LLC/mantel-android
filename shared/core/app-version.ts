export const APP_VERSION_PATH = "/api/v1/app-version";

export const DOWNLOAD_PAGE_PATH = "/download";

export type AppPlatform = "windows" | "macos" | "android";

const SCHEME = /^(\d{4})\.(\d{1,2})\.(\d{1,3})$/;

export type ParsedVersion = { year: number; minor: number; patch: number };

export function parseVersion(value: unknown): ParsedVersion | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const match = SCHEME.exec(value.trim().replace(/[-+].*$/, ""));
  if (!match) return null;
  return { year: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function versionCode(version: ParsedVersion): number {
  return version.year * 100000 + version.minor * 1000 + version.patch;
}

export function compareVersions(a: unknown, b: unknown): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  return Math.sign(versionCode(left) - versionCode(right));
}

export function normalizeVersion(value: unknown): string | null {
  const parsed = parseVersion(value);
  return parsed ? `${parsed.year}.${parsed.minor}.${parsed.patch}` : null;
}

export type AppVersionInfo = {
  platform: AppPlatform;
  latest: string | null;
  minimum: string | null;
  downloadUrl: string;
  notes: { de: string; en: string } | null;
  sha256: string | null;
};

const MAX_NOTE = 500;

function text(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_NOTE ? value : null;
}

export function parseAppVersionInfo(body: unknown, platform: AppPlatform): AppVersionInfo | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  if (raw.platform !== platform) return null;
  const latest = raw.latest === null || raw.latest === undefined ? null : normalizeVersion(raw.latest);
  if (latest === null && raw.latest !== null && raw.latest !== undefined) return null;
  const minimum = raw.minimum === null || raw.minimum === undefined ? null : normalizeVersion(raw.minimum);
  if (minimum === null && raw.minimum !== null && raw.minimum !== undefined) return null;
  const downloadUrl =
    typeof raw.downloadUrl === "string" && /^\/[A-Za-z0-9/_-]{0,100}$/.test(raw.downloadUrl)
      ? raw.downloadUrl
      : DOWNLOAD_PAGE_PATH;
  let notes: AppVersionInfo["notes"] = null;
  if (typeof raw.notes === "object" && raw.notes !== null) {
    const de = text((raw.notes as Record<string, unknown>).de);
    const en = text((raw.notes as Record<string, unknown>).en);
    if (de !== null && en !== null) notes = { de, en };
  }
  const sha256 = typeof raw.sha256 === "string" && /^[0-9a-f]{64}$/.test(raw.sha256) ? raw.sha256 : null;
  return { platform, latest, minimum, downloadUrl, notes, sha256 };
}

export type UpdateState =
  | { kind: "current" }
  | { kind: "available"; latest: string }
  | { kind: "required"; latest: string; minimum: string };

export function evaluateUpdate(currentVersion: unknown, info: AppVersionInfo | null): UpdateState {
  if (!info?.latest || !parseVersion(currentVersion)) return { kind: "current" };
  const newer = compareVersions(info.latest, currentVersion);
  if (newer === null || newer <= 0) return { kind: "current" };
  const belowMinimum = info.minimum !== null && (compareVersions(currentVersion, info.minimum) ?? 0) < 0;
  if (belowMinimum && info.minimum) return { kind: "required", latest: info.latest, minimum: info.minimum };
  return { kind: "available", latest: info.latest };
}

export const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

export const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export type Snooze = { version: string; until: number };

export function isSnoozed(state: UpdateState, snooze: Snooze | null, now: number): boolean {
  if (state.kind !== "available" || snooze === null || snooze.version !== state.latest) return false;
  return now < snooze.until && snooze.until - now <= SNOOZE_MS;
}

export function parseSnooze(raw: string | null): Snooze | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const { version, until } = value as Record<string, unknown>;
    const normalized = normalizeVersion(version);
    if (!normalized || typeof until !== "number" || !Number.isFinite(until)) return null;
    return { version: normalized, until };
  } catch {
    return null;
  }
}
