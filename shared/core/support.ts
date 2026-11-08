import {
  createTicket,
  listTickets,
  markSeen,
  openTicket,
  registerDeviceKey,
  replyToTicket,
  rewrapForOwnDevices,
  setTicketClosed,
  TicketApiError,
  TicketInputError,
  unreadCount,
  unregisterDeviceKey,
  type DeviceKey,
  type TicketThread,
  type TicketTransport,
  type UserPlatform,
} from "../ticket/ticket-client";
import { describeApiError, parseApiErrorPayload, type DescribedApiError } from "./api-errors";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_MAX_CHARS,
  type SupportCategory,
  type SupportOverview,
  type SupportThread,
  type SupportTicketSummary,
} from "./contract";
import type { LocalizedMessage } from "./i18n";

export type { DeviceKey, TicketTransport, UserPlatform } from "../ticket/ticket-client";
export { deviceKeyFromPkcs8, newDeviceKey } from "../ticket/ticket-client";

export const SUPPORT_API_PATH = "/api/v1/tickets";

export const SUPPORT_ID = /^[a-f0-9]{32}$/;

export function isSupportCategory(value: unknown): value is SupportCategory {
  return typeof value === "string" && (SUPPORT_CATEGORIES as readonly string[]).includes(value);
}

export function isSupportText(value: unknown): value is string {
  return typeof value === "string" && value.length <= SUPPORT_MAX_CHARS * 2 && [...value].length <= SUPPORT_MAX_CHARS;
}

export class SupportKeyError extends Error {
  constructor() {
    super("support key storage unavailable");
    this.name = "SupportKeyError";
  }
}

export type SupportKeyStore = {
  load(): Promise<DeviceKey | null>;
  create(): Promise<DeviceKey>;
  clear(): Promise<void>;
};

export function supportRouteTemplate(path: string): string {
  const parts = path.split("?")[0]!.split("/").map((part) => (SUPPORT_ID.test(part) ? ":id" : part));
  return [SUPPORT_API_PATH, ...parts.filter(Boolean)].join("/");
}

export function supportRoute(request: { path: string; query?: Record<string, string> }): string {
  const path = request.path ? `${SUPPORT_API_PATH}/${request.path}` : SUPPORT_API_PATH;
  const query = request.query && Object.keys(request.query).length > 0 ? `?${new URLSearchParams(request.query).toString()}` : "";
  return `${path}${query}`;
}

const REGISTER_EVERY_MS = 10 * 60_000;
const REWRAP_EVERY_MS = 60_000;

function summary(ticket: SupportTicketSummary): SupportTicketSummary {
  return {
    id: ticket.id,
    number: ticket.number,
    category: ticket.category,
    status: ticket.status,
    title: ticket.title,
    readable: ticket.readable,
    unread: ticket.unread,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    closedAt: ticket.closedAt,
    lastActor: ticket.lastActor,
    messageCount: ticket.messageCount,
  };
}

function thread(raw: TicketThread): SupportThread {
  return {
    ...summary(raw),
    messages: raw.messages.map((message) => ({ seq: message.seq, role: message.role, text: message.text, createdAt: message.createdAt })),
  };
}

export class SupportService {
  private registered = new Map<string, number>();
  private lastRewrap = 0;
  private rewrapRunning = false;
  private creating: Promise<DeviceKey> | null = null;
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      transport: TicketTransport;
      keys: SupportKeyStore;
      platform: UserPlatform;
      now?: () => number;
    },
  ) {
    this.now = deps.now ?? Date.now;
  }

  private async deviceKey(): Promise<DeviceKey> {
    const stored = await this.deps.keys.load();
    if (stored) return stored;
    this.creating ??= this.deps.keys.create().finally(() => {
      this.creating = null;
    });
    return this.creating;
  }

  private async registeredKey(force = false): Promise<DeviceKey> {
    const key = await this.deviceKey();
    const at = this.registered.get(key.keyId);
    if (force || at === undefined || this.now() - at > REGISTER_EVERY_MS) {
      await registerDeviceKey(this.deps.transport, key, this.deps.platform);
      this.registered.set(key.keyId, this.now());
    }
    return key;
  }

  private async withKey<T>(task: (key: DeviceKey) => Promise<T>): Promise<T> {
    const key = await this.registeredKey();
    try {
      return await task(key);
    } catch (error) {
      if (!(error instanceof TicketApiError && error.code === "unknown_ticket_key")) throw error;
      return task(await this.registeredKey(true));
    }
  }

  private backgroundRewrap(key: DeviceKey): void {
    if (this.rewrapRunning || this.now() - this.lastRewrap < REWRAP_EVERY_MS) return;
    this.rewrapRunning = true;
    this.lastRewrap = this.now();
    void rewrapForOwnDevices(this.deps.transport, key)
      .catch(() => undefined)
      .finally(() => {
        this.rewrapRunning = false;
      });
  }

  async overview(): Promise<SupportOverview> {
    return this.withKey(async (key) => {
      const list = await listTickets(this.deps.transport, key);
      if (list.tickets.length > 0) this.backgroundRewrap(key);
      return { available: list.available, unread: list.unread, tickets: list.tickets.map(summary) };
    });
  }

  unread(): Promise<{ available: boolean; unread: number }> {
    return unreadCount(this.deps.transport);
  }

  async ticket(id: string): Promise<SupportThread> {
    const key = await this.registeredKey();
    const opened = await openTicket(this.deps.transport, key, id);
    const last = opened.messages.at(-1)?.seq ?? 0;
    if (opened.unread > 0 && last > 0) {
      await markSeen(this.deps.transport, id, last);
      return thread({ ...opened, unread: 0 });
    }
    return thread(opened);
  }

  create(category: SupportCategory, text: string): Promise<{ id: string; number: number }> {
    return this.withKey((key) => createTicket(this.deps.transport, key, category, text));
  }

  async reply(id: string, text: string): Promise<SupportThread> {
    const key = await this.registeredKey();
    await replyToTicket(this.deps.transport, key, id, text);
    return this.ticket(id);
  }

  async setClosed(id: string, closed: boolean): Promise<SupportThread> {
    await setTicketClosed(this.deps.transport, id, closed);
    return this.ticket(id);
  }

  async unregister(): Promise<void> {
    try {
      const key = await this.deps.keys.load();
      if (key) await unregisterDeviceKey(this.deps.transport, key.keyId);
    } catch {
    }
  }

  async forget(): Promise<void> {
    this.registered.clear();
    this.lastRewrap = 0;
    await this.deps.keys.clear();
  }

  async logout(): Promise<void> {
    await this.unregister();
    await this.forget();
  }
}

export type SupportFailure = Omit<DescribedApiError, "message"> & { message: string | LocalizedMessage; status: number | null };

export function describeSupportError(error: unknown, options: { debug?: boolean } = {}): SupportFailure | null {
  if (error instanceof TicketApiError) {
    return { ...describeApiError(error.status, parseApiErrorPayload(error.body), options), status: error.status };
  }
  if (error instanceof TicketInputError) {
    const key =
      error.reason === "empty"
        ? "supportEmpty"
        : error.reason === "too_long"
          ? "supportTooLong"
          : error.reason === "no_key"
            ? "supportNoKey"
            : "apiTicketsUnavailable";
    return { message: { key, params: error.reason === "too_long" ? { max: SUPPORT_MAX_CHARS } : undefined }, code: "invalid", status: null };
  }
  if (error instanceof SupportKeyError) return { message: { key: "supportKeyStorage" }, code: "internal", status: null };
  return null;
}
