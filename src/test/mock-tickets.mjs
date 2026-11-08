import { createCipheriv, createDecipheriv, createECDH, createHash, hkdfSync, randomBytes } from "node:crypto";

const PREFIX = "mantel-ticket/1";
const CATEGORIES = new Set(["connection", "account", "payment", "app", "other"]);
const PLATFORMS = new Set(["windows", "macos", "android", "web", "linux"]);
const ID = /^[a-f0-9]{32}$/;
const AUTO_REPLY = process.env.MOCK_TICKET_REPLY !== "0";
const AVAILABLE = process.env.MOCK_TICKETS !== "0";

const b64u = (buffer) => Buffer.from(buffer).toString("base64url");
const unb64u = (text) => Buffer.from(text, "base64url");

const team = createECDH("prime256v1");
team.generateKeys();
const teamPublic = b64u(team.getPublicKey());
const keyIdOf = (publicKey) => createHash("sha256").update(unb64u(publicKey)).digest().subarray(0, 16).toString("hex");

function isCiphertext(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const raw = unb64u(value);
  return raw.length >= 30 && raw.length <= 16_100 && raw[0] === 1;
}
function isWrapped(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 1000) return false;
  const raw = unb64u(value);
  return raw.length >= 110 && raw[0] === 1 && raw[1] === 4;
}
function isPublicKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{87}$/.test(value) && unb64u(value)[0] === 4;
}

function unwrapForTeam(wrapped, ticketId) {
  const raw = unb64u(wrapped);
  const eph = raw.subarray(1, 66);
  const nonce = raw.subarray(66, 78);
  const sealed = raw.subarray(78);
  const context = `content|${ticketId}`;
  const shared = team.computeSecret(eph);
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([eph, team.getPublicKey()]), Buffer.from(`${PREFIX}|wrap|${context}`), 32));
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(`${PREFIX}|wrap|${context}|${keyIdOf(teamPublic)}`));
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
}
function encrypt(key, text, ticketId, seq, role) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`${PREFIX}|msg|${ticketId}|${seq}|${role}`));
  const sealed = Buffer.concat([cipher.update(Buffer.from(text, "utf8")), cipher.final(), cipher.getAuthTag()]);
  return b64u(Buffer.concat([Buffer.from([1]), nonce, sealed]));
}

const store = new Map();
let counter = 0;

function stateOf(accountId) {
  if (!store.has(accountId)) store.set(accountId, { keys: new Map(), tickets: new Map() });
  return store.get(accountId);
}

function unread(ticket) {
  return ticket.messages.filter((message) => message.role === "team" && message.seq > ticket.userSeen).length;
}

function summary(ticket, keyId) {
  return {
    id: ticket.id,
    number: ticket.number,
    category: ticket.category,
    status: ticket.status,
    title: ticket.title,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    closedAt: ticket.closedAt,
    lastActor: ticket.lastActor,
    messageCount: ticket.messages.length,
    unread: unread(ticket),
    wrapped: (keyId && ticket.wraps.get(`user:${keyId}`)) ?? null,
  };
}

function teamReply(ticket) {
  const wrapped = ticket.wraps.get("team:1");
  if (!wrapped || ticket.status === "closed") return;
  try {
    const key = unwrapForTeam(wrapped, ticket.id);
    const seq = ticket.messages.length + 1;
    const text = "Danke für deine Nachricht! Das ist eine automatische Antwort der Mock-API. / Thanks, this is an automatic reply from the mock API.";
    ticket.messages.push({ seq, role: "team", ciphertext: encrypt(key, text, ticket.id, seq, "team"), createdAt: Date.now() });
    ticket.status = "waiting";
    ticket.lastActor = "team";
    ticket.updatedAt = Date.now();
  } catch {
  }
}

export function handleTickets({ method, path, url, body, account, send, fail }) {
  if (path !== "/api/v1/tickets" && !path.startsWith("/api/v1/tickets/")) return false;
  if (!account) return fail(401, "unauthorized", "Not signed in or the session has expired."), true;
  const state = stateOf(account.id);
  const parts = path.slice("/api/v1/tickets".length).split("/").filter(Boolean);
  const key = url.searchParams.get("key");
  const record = typeof body === "object" && body !== null && !Array.isArray(body) ? body : {};
  const only = (...fields) => {
    const unknown = Object.keys(record).find((field) => !fields.includes(field));
    if (unknown === undefined) return true;
    fail(400, "unknown_field", `Unknown field: ${unknown}.`, { field: unknown });
    return false;
  };

  if (parts.length === 0 && method === "GET") {
    const tickets = [...state.tickets.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((ticket) => summary(ticket, key));
    send(200, { available: AVAILABLE, unread: tickets.reduce((sum, ticket) => sum + ticket.unread, 0), tickets });
    return true;
  }
  if (parts.length === 0 && method === "POST") {
    if (!only("id", "category", "title", "message", "keys", "key")) return true;
    if (!AVAILABLE) return fail(503, "tickets_unavailable", "Support is not set up yet. Try again later."), true;
    const { id, category, title, message, keys } = record;
    if (typeof id !== "string" || !ID.test(id) || !CATEGORIES.has(category) || state.tickets.has(id)) return fail(400, "validation_failed", "The request is invalid."), true;
    if (!isCiphertext(title)) return fail(400, "invalid_ciphertext", "title must be ciphertext; plaintext is never accepted.", { field: "title" }), true;
    if (!isCiphertext(message)) return fail(400, "invalid_ciphertext", "message must be ciphertext; plaintext is never accepted.", { field: "message" }), true;
    if (!state.keys.has(record.key)) return fail(400, "unknown_ticket_key", "key refers to a key that is not registered for this account.", { field: "key" }), true;
    if (!Array.isArray(keys) || !keys.every((entry) => isWrapped(entry?.wrapped) && (entry.recipient === "team:1" || state.keys.has(String(entry.recipient).slice(5))))) {
      return fail(400, "unknown_ticket_key", "keys refers to a key that is not registered for this account.", { field: "keys" }), true;
    }
    const open = [...state.tickets.values()].filter((ticket) => ticket.status !== "closed").length;
    if (open >= 5) return fail(409, "ticket_limit_reached", "At most 5 open tickets are allowed. Close one first.", { max: 5 }), true;
    const now = Date.now();
    const ticket = {
      id,
      number: ++counter,
      category,
      status: "open",
      title,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      lastActor: "user",
      userSeen: 1,
      messages: [{ seq: 1, role: "user", ciphertext: message, createdAt: now }],
      wraps: new Map(keys.map((entry) => [entry.recipient, entry.wrapped])),
    };
    state.tickets.set(id, ticket);
    if (AUTO_REPLY) setTimeout(() => teamReply(ticket), 1_500).unref?.();
    send(201, { id, number: ticket.number, status: "open" });
    return true;
  }

  if (parts[0] === "keys") {
    if (parts.length === 1 && method === "GET") {
      send(200, {
        team: AVAILABLE ? { version: 1, publicKey: teamPublic, keyId: keyIdOf(teamPublic) } : null,
        devices: [...state.keys].map(([keyId, entry]) => ({ keyId, publicKey: entry.publicKey, platform: entry.platform })),
      });
      return true;
    }
    if (parts.length === 1 && method === "POST") {
      if (!only("publicKey", "platform")) return true;
      if (!isPublicKey(record.publicKey) || !PLATFORMS.has(record.platform)) return fail(400, "validation_failed", "The request is invalid."), true;
      const keyId = keyIdOf(record.publicKey);
      state.keys.set(keyId, { publicKey: record.publicKey, platform: record.platform });
      send(201, { keyId });
      return true;
    }
    if (parts.length === 2 && method === "DELETE") {
      if (!state.keys.delete(parts[1])) return fail(404, "not_found", "Not found."), true;
      for (const ticket of state.tickets.values()) ticket.wraps.delete(`user:${parts[1]}`);
      send(204);
      return true;
    }
    return fail(405, "method_not_allowed", "This method is not allowed for this endpoint."), true;
  }

  if (parts[0] === "rewrap" && parts.length === 1) {
    if (method === "GET") {
      const items = [];
      for (const ticket of state.tickets.values()) {
        const own = ticket.wraps.get(`user:${key}`);
        if (!own) continue;
        const missing = [...state.keys]
          .filter(([keyId]) => keyId !== key && !ticket.wraps.has(`user:${keyId}`))
          .map(([keyId, entry]) => ({ keyId, publicKey: entry.publicKey }));
        if (missing.length > 0) items.push({ ticketId: ticket.id, wrapped: own, missing });
      }
      send(200, { items });
      return true;
    }
    if (method === "POST") {
      let stored = 0;
      for (const item of Array.isArray(record.items) ? record.items : []) {
        const ticket = state.tickets.get(item?.ticketId);
        if (!ticket || !state.keys.has(item.keyId) || !isWrapped(item.wrapped) || ticket.wraps.has(`user:${item.keyId}`)) continue;
        ticket.wraps.set(`user:${item.keyId}`, item.wrapped);
        stored += 1;
      }
      send(200, { stored });
      return true;
    }
  }

  const ticket = parts[0] && ID.test(parts[0]) ? state.tickets.get(parts[0]) : undefined;
  if (!ticket) return fail(404, "not_found", "Not found."), true;
  if (parts.length === 1 && method === "GET") {
    send(200, { ...summary(ticket, key), messages: ticket.messages.map(({ seq, role, ciphertext, createdAt }) => ({ seq, role, ciphertext, createdAt })) });
    return true;
  }
  if (parts.length !== 2 || method !== "POST") return fail(404, "not_found", "Not found."), true;
  const now = Date.now();
  switch (parts[1]) {
    case "messages": {
      if (!only("seq", "ciphertext")) return true;
      if (!isCiphertext(record.ciphertext)) return fail(400, "invalid_ciphertext", "ciphertext must be ciphertext; plaintext is never accepted.", { field: "ciphertext" }), true;
      if (ticket.status === "closed") return fail(409, "ticket_closed", "This ticket is closed. Reopen it first."), true;
      if (record.seq !== ticket.messages.length + 1) return fail(409, "ticket_changed", "The ticket changed in the meantime. Reload it and try again."), true;
      ticket.messages.push({ seq: record.seq, role: "user", ciphertext: record.ciphertext, createdAt: now });
      Object.assign(ticket, { status: "open", lastActor: "user", updatedAt: now, userSeen: record.seq });
      send(201, { seq: record.seq });
      return true;
    }
    case "close":
    case "reopen": {
      const closed = parts[1] === "close";
      Object.assign(ticket, { status: closed ? "closed" : ticket.lastActor === "team" ? "waiting" : "open", closedAt: closed ? now : null, updatedAt: now });
      send(200, { status: closed ? "closed" : "open" });
      return true;
    }
    case "seen": {
      if (!only("seq")) return true;
      if (typeof record.seq !== "number") return fail(400, "validation_failed", "The request is invalid."), true;
      ticket.userSeen = Math.max(ticket.userSeen, Math.min(record.seq, ticket.messages.length));
      send(204);
      return true;
    }
    default:
      return fail(404, "not_found", "Not found."), true;
  }
}
