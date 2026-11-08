import type { MantelBridge, Result, SessionInfo } from "@shared/contract";

export type CreatedAccount = { code: string; accountId: string; paidUntil: string };

export type AndroidBridgeExtras = {
  register: () => Promise<Result<CreatedAccount>>;
  pendingRegistration: () => Promise<CreatedAccount | null>;
  confirmRegistration: () => Promise<Result<SessionInfo>>;
};

export type AndroidBridge = MantelBridge & AndroidBridgeExtras;

export function androidExtras(bridge: MantelBridge): AndroidBridgeExtras | null {
  const candidate = bridge as Partial<AndroidBridgeExtras>;
  return typeof candidate.register === "function" &&
    typeof candidate.pendingRegistration === "function" &&
    typeof candidate.confirmRegistration === "function"
    ? (candidate as AndroidBridgeExtras)
    : null;
}
