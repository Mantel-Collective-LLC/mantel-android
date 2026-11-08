export const REFRESH_NOTICE_AFTER = 3;

export type RefreshOutcome = { ok: true } | { ok: false; code: string | null; error: string };

export interface RefreshState {
  failures: number;
  message: { tone: "error" | "notice"; text: string } | null;
}

export const INITIAL_REFRESH_STATE: RefreshState = { failures: 0, message: null };

export function nextRefreshState(
  previous: RefreshState,
  outcome: RefreshOutcome,
  context: { hasData: boolean; noticeText: string },
): RefreshState {
  if (outcome.ok) return INITIAL_REFRESH_STATE;
  if (outcome.code === "unauthorized") return { failures: previous.failures, message: previous.message };
  const failures = previous.failures + 1;
  if (!context.hasData) return { failures, message: { tone: "error", text: outcome.error } };
  if (failures >= REFRESH_NOTICE_AFTER) return { failures, message: { tone: "notice", text: context.noticeText } };
  return { failures, message: null };
}
