import {
  cleanMessage,
  decryptText,
  encryptText,
  exportPrivateKey,
  generateKeyPair,
  importPrivateKey,
  publicKeyId,
  publicKeyOf,
  randomContentKey,
  randomTicketId,
  titleFrom,
  unwrapSecret,
  wrapContext,
  wrapSecret,
  type TicketKey,
} from "./ticket-crypto";

export const TICKET_CATEGORIES = ["connection", "account", "payment", "app", "other"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export type TicketStatus = "open" | "waiting" | "closed";

export type TicketTransport = (request: {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}) => Promise<{ status: number; body: unknown }>;

export class TicketApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "TicketApiError";
  }
}

type Obj = Record<string, unknown>;

async function send<T = Obj>(transport: TicketTransport, request: Parameters<TicketTransport>[0]): Promise<T> {
  const response = await transport(request);
  if (response.status >= 200 && response.status < 300) return (response.body ?? {}) as T;
  const body = (response.body ?? {}) as Obj;
  const code = typeof body.code === "string" ? body.code : `http_${response.status}`;
  const message = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
  throw new TicketApiError(response.status, code, message, response.body);
}

export type DeviceKey = { keyId: string; publicKey: string; privateKey: TicketKey };

export type TicketSummary = {
  id: string;
  number: number;
  category: TicketCategory;
  status: TicketStatus;
  title: string | null;
  readable: boolean;
  unread: number;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  lastActor: "user" | "team";
  messageCount: number;
};

export type TicketMessage = {
  seq: number;
  role: "user" | "team";
  text: string | null;
  createdAt: number;
  author?: string | null;
};

export type TicketThread = TicketSummary & { messages: TicketMessage[] };

type RawSummary = {
  id: string;
  number: number;
  category: TicketCategory;
  status: TicketStatus;
  title: string;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  lastActor: "user" | "team";
  messageCount: number;
  unread: number;
  wrapped: string | null;
};

type RawMessage = { seq: number; role: "user" | "team" | "note"; ciphertext: string; createdAt: number; author?: string | null };

export async function newDeviceKey(extractable: boolean): Promise<DeviceKey & { pkcs8: string | null }> {
  const pair = await generateKeyPair(extractable);
  return { ...pair, pkcs8: extractable ? await exportPrivateKey(pair.privateKey) : null };
}

export async function deviceKeyFromPkcs8(pkcs8: string): Promise<DeviceKey> {
  const extractable = await importPrivateKey(pkcs8, true);
  const publicKey = await publicKeyOf(extractable);
  return { keyId: await publicKeyId(publicKey), publicKey, privateKey: await importPrivateKey(pkcs8, false) };
}

export type UserPlatform = "windows" | "macos" | "android" | "web" | "linux";

export async function registerDeviceKey(transport: TicketTransport, key: DeviceKey, platform: UserPlatform): Promise<void> {
  await send(transport, { method: "POST", path: "keys", body: { publicKey: key.publicKey, platform } });
}

export async function unregisterDeviceKey(transport: TicketTransport, keyId: string): Promise<void> {
  try {
    await send(transport, { method: "DELETE", path: `keys/${keyId}` });
  } catch (error) {
    if (!(error instanceof TicketApiError && (error.status === 404 || error.status === 401))) throw error;
  }
}

async function contentKeyFor(device: DeviceKey, ticketId: string, wrapped: string | null): Promise<Uint8Array | null> {
  if (!wrapped) return null;
  try {
    return await unwrapSecret(wrapped, device.privateKey, device.publicKey, wrapContext.content(ticketId));
  } catch {
    return null;
  }
}

async function decryptOr(key: Uint8Array | null, ciphertext: string, position: Parameters<typeof decryptText>[2]): Promise<string | null> {
  if (!key) return null;
  try {
    return await decryptText(key, ciphertext, position);
  } catch {
    return null;
  }
}

async function summarize(raw: RawSummary, key: Uint8Array | null): Promise<TicketSummary> {
  const title = await decryptOr(key, raw.title, { ticketId: raw.id, kind: "title", seq: 0, role: "user" });
  return {
    id: raw.id,
    number: raw.number,
    category: raw.category,
    status: raw.status,
    title,
    readable: key !== null,
    unread: raw.unread,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    closedAt: raw.closedAt,
    lastActor: raw.lastActor,
    messageCount: raw.messageCount,
  };
}

export type UserTicketList = { available: boolean; unread: number; tickets: TicketSummary[] };

export async function listTickets(transport: TicketTransport, device: DeviceKey): Promise<UserTicketList> {
  const body = await send<{ available: boolean; unread: number; tickets: RawSummary[] }>(transport, { method: "GET", path: "", query: { key: device.keyId } });
  const tickets = await Promise.all(body.tickets.map(async (raw) => summarize(raw, await contentKeyFor(device, raw.id, raw.wrapped))));
  return { available: body.available, unread: body.unread, tickets };
}

export async function unreadCount(transport: TicketTransport): Promise<{ available: boolean; unread: number }> {
  const body = await send<{ available: boolean; unread: number }>(transport, { method: "GET", path: "" });
  return { available: body.available, unread: body.unread };
}

async function decryptMessages(key: Uint8Array | null, ticketId: string, raw: RawMessage[]): Promise<TicketMessage[]> {
  return Promise.all(
    raw.map(async (message) => ({
      seq: message.seq,
      role: message.role === "team" ? ("team" as const) : ("user" as const),
      text: await decryptOr(key, message.ciphertext, { ticketId, kind: "msg", seq: message.seq, role: message.role }),
      createdAt: message.createdAt,
      ...(message.author !== undefined ? { author: message.author } : {}),
    })),
  );
}

export async function openTicket(transport: TicketTransport, device: DeviceKey, id: string): Promise<TicketThread> {
  const raw = await send<RawSummary & { messages: RawMessage[] }>(transport, { method: "GET", path: id, query: { key: device.keyId } });
  const key = await contentKeyFor(device, id, raw.wrapped);
  return { ...(await summarize(raw, key)), messages: await decryptMessages(key, id, raw.messages) };
}

export class TicketInputError extends Error {
  constructor(readonly reason: "empty" | "too_long" | "no_key" | "unavailable") {
    super(reason);
    this.name = "TicketInputError";
  }
}

export async function createTicket(
  transport: TicketTransport,
  device: DeviceKey,
  category: TicketCategory,
  input: string,
): Promise<{ id: string; number: number }> {
  const text = cleanMessage(input);
  if (!text) throw new TicketInputError(input.trim() ? "too_long" : "empty");
  const keys = await send<{ team: { version: number; publicKey: string } | null; devices: { keyId: string; publicKey: string }[] }>(transport, {
    method: "GET",
    path: "keys",
  });
  if (!keys.team) throw new TicketInputError("unavailable");
  const id = randomTicketId();
  const contentKey = randomContentKey();
  const context = wrapContext.content(id);
  const recipients = new Map<string, string>([[`user:${device.keyId}`, device.publicKey]]);
  for (const own of keys.devices) recipients.set(`user:${own.keyId}`, own.publicKey);
  const wraps = [{ recipient: `team:${keys.team.version}`, wrapped: await wrapSecret(contentKey, keys.team.publicKey, context) }];
  for (const [recipient, publicKey] of recipients) wraps.push({ recipient, wrapped: await wrapSecret(contentKey, publicKey, context) });
  const body = {
    id,
    category,
    key: device.keyId,
    keys: wraps.slice(0, 16),
    title: await encryptText(contentKey, titleFrom(text), { ticketId: id, kind: "title", seq: 0, role: "user" }),
    message: await encryptText(contentKey, text, { ticketId: id, kind: "msg", seq: 1, role: "user" }),
  };
  const created = await send<{ id: string; number: number }>(transport, { method: "POST", path: "", body });
  return { id: created.id, number: created.number };
}

async function appendWithRetry(
  transport: TicketTransport,
  path: string,
  load: () => Promise<{ count: number; key: Uint8Array | null }>,
  encrypt: (key: Uint8Array, seq: number) => Promise<string>,
): Promise<number> {
  for (let attempt = 0; ; attempt += 1) {
    const { count, key } = await load();
    if (!key) throw new TicketInputError("no_key");
    const seq = count + 1;
    try {
      await send(transport, { method: "POST", path, body: { seq, ciphertext: await encrypt(key, seq) } });
      return seq;
    } catch (error) {
      if (!(error instanceof TicketApiError && error.code === "ticket_changed") || attempt >= 2) throw error;
    }
  }
}

export async function replyToTicket(transport: TicketTransport, device: DeviceKey, id: string, input: string): Promise<number> {
  const text = cleanMessage(input);
  if (!text) throw new TicketInputError(input.trim() ? "too_long" : "empty");
  return appendWithRetry(
    transport,
    `${id}/messages`,
    async () => {
      const raw = await send<RawSummary>(transport, { method: "GET", path: id, query: { key: device.keyId } });
      return { count: raw.messageCount, key: await contentKeyFor(device, id, raw.wrapped) };
    },
    (key, seq) => encryptText(key, text, { ticketId: id, kind: "msg", seq, role: "user" }),
  );
}

export async function setTicketClosed(transport: TicketTransport, id: string, closed: boolean): Promise<TicketStatus> {
  const body = await send<{ status: TicketStatus }>(transport, { method: "POST", path: `${id}/${closed ? "close" : "reopen"}` });
  return body.status;
}

export async function markSeen(transport: TicketTransport, id: string, seq: number): Promise<void> {
  await send(transport, { method: "POST", path: `${id}/seen`, body: { seq } });
}

export async function rewrapForOwnDevices(transport: TicketTransport, device: DeviceKey): Promise<number> {
  const work = await send<{ items: { ticketId: string; wrapped: string; missing: { keyId: string; publicKey: string }[] }[] }>(transport, {
    method: "GET",
    path: "rewrap",
    query: { key: device.keyId },
  });
  if (work.items.length === 0) return 0;
  const items: { ticketId: string; keyId: string; wrapped: string }[] = [];
  for (const item of work.items) {
    const key = await contentKeyFor(device, item.ticketId, item.wrapped);
    if (!key) continue;
    for (const other of item.missing) {
      items.push({ ticketId: item.ticketId, keyId: other.keyId, wrapped: await wrapSecret(key, other.publicKey, wrapContext.content(item.ticketId)) });
    }
  }
  if (items.length === 0) return 0;
  const stored = await send<{ stored: number }>(transport, { method: "POST", path: "rewrap", body: { items } });
  return stored.stored;
}
