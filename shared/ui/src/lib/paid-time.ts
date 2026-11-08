import type { Translator } from "../../../core/i18n";
import { formatDate } from "./format";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export const EXPIRING_SOON_MS = 7 * DAY;

export const RING_SCALE_MS = 30 * DAY;

export type PaidState = "active" | "expiring" | "grace" | "expired" | "new";

export type PaidTime = {
  state: PaidState;
  paidUntil: string;
  graceUntil: string | null;
  remainingMs: number;
  graceRemainingMs: number | null;
  progress: number;
};

export type RemainingUnit = "days" | "hours" | "minutes";
export type Remaining = { unit: RemainingUnit; count: number };

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function paidTime(
  paidUntil: string,
  graceUntil: string | null | undefined,
  now: number,
  noTimeYet = false,
): PaidTime | null {
  const end = Date.parse(paidUntil);
  if (Number.isNaN(end)) return null;
  const graceParsed = graceUntil ? Date.parse(graceUntil) : Number.NaN;
  const graceEnd = !Number.isNaN(graceParsed) && graceParsed > end ? graceParsed : null;
  const remainingMs = end - now;

  if (remainingMs > 0) {
    return {
      state: remainingMs <= EXPIRING_SOON_MS ? "expiring" : "active",
      paidUntil,
      graceUntil: graceEnd === null ? null : (graceUntil ?? null),
      remainingMs,
      graceRemainingMs: null,
      progress: clamp(remainingMs / RING_SCALE_MS),
    };
  }
  if (noTimeYet) {
    return { state: "new", paidUntil, graceUntil: null, remainingMs, graceRemainingMs: null, progress: 0 };
  }
  if (graceEnd !== null && graceEnd > now) {
    const graceRemainingMs = graceEnd - now;
    return {
      state: "grace",
      paidUntil,
      graceUntil: graceUntil ?? null,
      remainingMs,
      graceRemainingMs,
      progress: clamp(graceRemainingMs / (graceEnd - end)),
    };
  }
  return {
    state: "expired",
    paidUntil,
    graceUntil: graceEnd === null ? null : (graceUntil ?? null),
    remainingMs,
    graceRemainingMs: null,
    progress: 0,
  };
}

export function remainingOf(ms: number): Remaining {
  if (ms >= DAY) return { unit: "days", count: Math.floor(ms / DAY) };
  if (ms >= HOUR) return { unit: "hours", count: Math.floor(ms / HOUR) };
  return { unit: "minutes", count: Math.max(1, Math.ceil(ms / MINUTE)) };
}

export type PaidTexts = {
  title: string;
  subtitle: string;
  state: string;
  note: string | null;
  ring: { value: string; unit: string } | null;
};

export function paidTexts(paid: PaidTime, i18n: Translator): PaidTexts {
  const { t } = i18n;
  const date = formatDate(paid.paidUntil, i18n);
  const state = t.paid.states[paid.state];
  if (paid.state === "active" || paid.state === "expiring") {
    const remaining = remainingOf(paid.remainingMs);
    return {
      title: i18n.plural(t.paid.remaining[remaining.unit], remaining.count),
      subtitle: i18n.format(t.paid.paidUntil, { date }),
      state,
      note: paid.state === "expiring" ? t.paid.expiringNote : null,
      ring: {
        value: remaining.count.toLocaleString(i18n.locale),
        unit: i18n.plural(t.paid.units[remaining.unit], remaining.count),
      },
    };
  }
  if (paid.state === "new") {
    return { title: t.paid.newTitle, subtitle: t.paid.newSubtitle, state, note: t.paid.newNote, ring: null };
  }
  return {
    title: t.paid.expiredTitle,
    subtitle: i18n.format(t.paid.expiredOn, { date }),
    state,
    note:
      paid.state === "grace" && paid.graceUntil
        ? i18n.format(t.paid.graceNote, { date: formatDate(paid.graceUntil, i18n) })
        : t.paid.expiredNote,
    ring: null,
  };
}
