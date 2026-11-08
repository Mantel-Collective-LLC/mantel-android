import type { z } from "zod";

export type KeyValueStore = {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
};

export type SecureStore = {
  secureGet(options: { key: string }): Promise<{ value: string | null }>;
  secureSet(options: { key: string; value: string }): Promise<void>;
  secureRemove(options: { key: string }): Promise<void>;
};

export async function readJson<T>(read: () => Promise<{ value: string | null }>, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const { value } = await read();
    if (value === null || value === undefined) return null;
    const parsed = schema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const KEYS = {
  preferences: "mantel.preferences",
  device: "mantel.device",
  runtime: "mantel.runtime",
  excludedApps: "mantel.excludedApps",
  staleDevices: "mantel.staleDevices",
  systemVpn: "mantel.systemVpn",
  language: "mantel.language",
  theme: "mantel.theme",
  debugVerbose: "mantel.debug.verbose",
} as const;

export const SECURE_KEYS = {
  session: "mantel.session",
  deviceKeys: "mantel.deviceKeys",
  pendingRegistration: "mantel.pendingRegistration",
  ticketKey: "mantel.ticketKey",
} as const;
