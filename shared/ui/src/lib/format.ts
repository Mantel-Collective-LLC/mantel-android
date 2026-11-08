import type { Translator } from "../../../core/i18n";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function groupDigits(digits: string): string {
  return (digits.match(/.{1,4}/g) ?? []).join(" ");
}

export function formatRemaining(ms: number, i18n: Translator): string {
  const { t } = i18n;
  if (ms <= 0) return t.format.expired;
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  if (days === 0) {
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return i18n.format(t.format.hoursMinutes, { hours, minutes });
  }
  return i18n.plural(t.format.days, days);
}

export function formatDate(value: string, i18n: Pick<Translator, "locale">): string {
  return new Date(value).toLocaleDateString(i18n.locale, { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

export function formatAgo(ms: number, i18n: Translator): string {
  const { t } = i18n;
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return i18n.format(t.format.agoSeconds, { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return i18n.format(t.format.agoMinutes, { count: minutes });
  return i18n.format(t.format.agoHours, { count: Math.floor(minutes / 60) });
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number, i18n: Pick<Translator, "locale">): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString(i18n.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${UNITS[unit]}`;
}
