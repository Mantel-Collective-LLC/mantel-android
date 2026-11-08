type Subtle = typeof globalThis.crypto.subtle;
export type TicketKey = Awaited<ReturnType<Subtle["importKey"]>>;
type Bytes = Uint8Array<ArrayBuffer>;

export const TICKET_CRYPTO_VERSION = 1;
const PREFIX = "mantel-ticket/1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const PUBLIC_KEY_BYTES = 65;
export const CONTENT_KEY_BYTES = 32;

export const MAX_MESSAGE_CHARS = 4000;
export const MAX_TITLE_CHARS = 80;
export const MAX_CIPHERTEXT_BYTES = 16_100;
const MAX_WRAPPED_SECRET = 512;

export type MessageRole = "user" | "team" | "note";
export type CipherKind = "msg" | "title" | "note";

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

function subtle(): Subtle {
  const value = globalThis.crypto?.subtle;
  if (!value) throw new Error("WebCrypto fehlt (unsicherer Kontext?).");
  return value;
}

function bytes(length: number): Bytes {
  return new Uint8Array(new ArrayBuffer(length));
}

function copy(input: Uint8Array): Bytes {
  const out = bytes(input.byteLength);
  out.set(input);
  return out;
}

export function randomBytes(length: number): Bytes {
  const out = bytes(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function utf8(text: string): Bytes {
  return copy(encoder.encode(text));
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = bytes(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]));
const B64U = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(input: Uint8Array): string {
  let out = "";
  for (let index = 0; index < input.length; index += 3) {
    const a = input[index] ?? 0;
    const b = input[index + 1] ?? 0;
    const c = input[index + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (index + 1 < input.length) out += ALPHABET[(n >> 6) & 63]!;
    if (index + 2 < input.length) out += ALPHABET[n & 63]!;
  }
  return out;
}

export function fromBase64Url(text: string): Bytes | null {
  if (typeof text !== "string" || !B64U.test(text) || text.length % 4 === 1) return null;
  const out = bytes(Math.floor((text.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of text) {
    buffer = (buffer << 6) | LOOKUP.get(char)!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

function hex(input: Uint8Array): string {
  return Array.from(input, (value) => value.toString(16).padStart(2, "0")).join("");
}

export const TICKET_ID = /^[a-f0-9]{32}$/;
export const KEY_ID = /^[a-f0-9]{32}$/;

export function isCiphertext(value: unknown, maxBytes: number = MAX_CIPHERTEXT_BYTES): value is string {
  if (typeof value !== "string" || value.length > Math.ceil((maxBytes * 4) / 3) + 4) return false;
  const raw = fromBase64Url(value);
  return raw !== null && raw.length >= 1 + NONCE_BYTES + TAG_BYTES + 1 && raw.length <= maxBytes && raw[0] === TICKET_CRYPTO_VERSION;
}

export function isWrapped(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1000) return false;
  const raw = fromBase64Url(value);
  return (
    raw !== null &&
    raw[0] === TICKET_CRYPTO_VERSION &&
    raw[1] === 0x04 &&
    raw.length >= 1 + PUBLIC_KEY_BYTES + NONCE_BYTES + 16 + TAG_BYTES &&
    raw.length <= 1 + PUBLIC_KEY_BYTES + NONCE_BYTES + MAX_WRAPPED_SECRET + TAG_BYTES
  );
}

export function isPublicKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 87) return false;
  const raw = fromBase64Url(value);
  return raw !== null && raw.length === PUBLIC_KEY_BYTES && raw[0] === 0x04;
}

export type KeyPairInfo = { privateKey: TicketKey; publicKey: string; keyId: string };

export async function publicKeyId(publicKey: string): Promise<string> {
  const raw = fromBase64Url(publicKey);
  if (!raw || raw.length !== PUBLIC_KEY_BYTES) throw new Error("Ungültiger öffentlicher Schlüssel.");
  const digest = new Uint8Array(await subtle().digest("SHA-256", raw));
  return hex(digest.subarray(0, 16));
}

export function securityCode(keyId: string): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const raw = keyId.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? [];
  let out = "";
  for (let index = 0; index < 16; index += 1) out += alphabet[(raw[index] ?? 0) & 31];
  return out.match(/.{4}/g)!.join("-");
}

export async function generateKeyPair(extractable: boolean): Promise<KeyPairInfo> {
  const pair = (await subtle().generateKey(ECDH, extractable, ["deriveBits"])) as { privateKey: TicketKey; publicKey: TicketKey };
  const publicKey = toBase64Url(new Uint8Array(await subtle().exportKey("raw", pair.publicKey)));
  return { privateKey: pair.privateKey, publicKey, keyId: await publicKeyId(publicKey) };
}

export async function importPublicKey(publicKey: string): Promise<TicketKey> {
  const raw = fromBase64Url(publicKey);
  if (!raw || raw.length !== PUBLIC_KEY_BYTES) throw new Error("Ungültiger öffentlicher Schlüssel.");
  return subtle().importKey("raw", raw, ECDH, true, []);
}

export async function validPublicKey(publicKey: unknown): Promise<boolean> {
  if (!isPublicKey(publicKey)) return false;
  try {
    await importPublicKey(publicKey);
    return true;
  } catch {
    return false;
  }
}

export async function exportPrivateKey(privateKey: TicketKey): Promise<string> {
  return toBase64Url(new Uint8Array(await subtle().exportKey("pkcs8", privateKey)));
}

export async function importPrivateKey(pkcs8: string | Uint8Array, extractable: boolean): Promise<TicketKey> {
  const raw = typeof pkcs8 === "string" ? fromBase64Url(pkcs8) : copy(pkcs8);
  if (!raw) throw new Error("Ungültiger privater Schlüssel.");
  return subtle().importKey("pkcs8", raw, ECDH, extractable, ["deriveBits"]);
}

export async function publicKeyOf(privateKey: TicketKey): Promise<string> {
  const jwk = (await subtle().exportKey("jwk", privateKey)) as { x?: string; y?: string };
  const x = jwk.x ? fromBase64Url(jwk.x) : null;
  const y = jwk.y ? fromBase64Url(jwk.y) : null;
  if (!x || !y || x.length !== 32 || y.length !== 32) throw new Error("Ungültiger privater Schlüssel.");
  return toBase64Url(concat(new Uint8Array([0x04]), x, y));
}

export function randomContentKey(): Bytes {
  return randomBytes(CONTENT_KEY_BYTES);
}

export function randomTicketId(): string {
  return hex(randomBytes(16));
}

export const wrapContext = {
  content: (ticketId: string) => `content|${ticketId}`,
  note: (ticketId: string) => `note|${ticketId}`,
  team: (version: number) => `team|${version}`,
};

async function wrapKeyFor(sharedBits: ArrayBuffer, salt: Bytes, info: Bytes): Promise<TicketKey> {
  const base = await subtle().importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt, info }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function wrapSecret(secret: Uint8Array, recipientPublicKey: string, context: string): Promise<string> {
  if (secret.byteLength < 16 || secret.byteLength > MAX_WRAPPED_SECRET) throw new Error("Ungültige Schlüssellänge.");
  const recipient = await importPublicKey(recipientPublicKey);
  const recipientRaw = fromBase64Url(recipientPublicKey)!;
  const recipientId = await publicKeyId(recipientPublicKey);
  const ephemeral = (await subtle().generateKey(ECDH, true, ["deriveBits"])) as { privateKey: TicketKey; publicKey: TicketKey };
  const ephemeralRaw = new Uint8Array(await subtle().exportKey("raw", ephemeral.publicKey));
  const shared = await subtle().deriveBits({ name: "ECDH", public: recipient }, ephemeral.privateKey, 256);
  const info = utf8(`${PREFIX}|wrap|${context}`);
  const key = await wrapKeyFor(shared, concat(ephemeralRaw, recipientRaw), info);
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv: nonce, additionalData: utf8(`${PREFIX}|wrap|${context}|${recipientId}`) }, key, copy(secret)),
  );
  return toBase64Url(concat(new Uint8Array([TICKET_CRYPTO_VERSION]), ephemeralRaw, nonce, sealed));
}

export async function unwrapSecret(wrapped: string, recipientPrivateKey: TicketKey, recipientPublicKey: string, context: string): Promise<Bytes> {
  if (!isWrapped(wrapped)) throw new Error("Ungültiger verpackter Schlüssel.");
  const raw = fromBase64Url(wrapped)!;
  const ephemeralRaw = raw.slice(1, 1 + PUBLIC_KEY_BYTES);
  const nonce = raw.slice(1 + PUBLIC_KEY_BYTES, 1 + PUBLIC_KEY_BYTES + NONCE_BYTES);
  const sealed = raw.slice(1 + PUBLIC_KEY_BYTES + NONCE_BYTES);
  const recipientRaw = fromBase64Url(recipientPublicKey);
  if (!recipientRaw || recipientRaw.length !== PUBLIC_KEY_BYTES) throw new Error("Ungültiger öffentlicher Schlüssel.");
  const recipientId = await publicKeyId(recipientPublicKey);
  const ephemeral = await subtle().importKey("raw", ephemeralRaw, ECDH, true, []);
  const shared = await subtle().deriveBits({ name: "ECDH", public: ephemeral }, recipientPrivateKey, 256);
  const info = utf8(`${PREFIX}|wrap|${context}`);
  const key = await wrapKeyFor(shared, concat(ephemeralRaw, recipientRaw), info);
  const plain = await subtle().decrypt({ name: "AES-GCM", iv: nonce, additionalData: utf8(`${PREFIX}|wrap|${context}|${recipientId}`) }, key, sealed);
  return new Uint8Array(plain);
}

export type CipherPosition = { ticketId: string; kind: CipherKind; seq: number; role: MessageRole };

export function messageAad(position: CipherPosition): string {
  if (!TICKET_ID.test(position.ticketId)) throw new Error("Ungültige Ticket-ID.");
  if (!Number.isSafeInteger(position.seq) || position.seq < 0) throw new Error("Ungültige Nachrichtennummer.");
  return `${PREFIX}|${position.kind}|${position.ticketId}|${position.seq}|${position.role}`;
}

async function aesKey(contentKey: Uint8Array, usage: "encrypt" | "decrypt"): Promise<TicketKey> {
  if (contentKey.byteLength !== CONTENT_KEY_BYTES) throw new Error("Ungültiger Ticket-Schlüssel.");
  return subtle().importKey("raw", copy(contentKey), { name: "AES-GCM" }, false, [usage]);
}

export async function encryptText(contentKey: Uint8Array, text: string, position: CipherPosition): Promise<string> {
  const key = await aesKey(contentKey, "encrypt");
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce, additionalData: utf8(messageAad(position)) }, key, utf8(text)));
  return toBase64Url(concat(new Uint8Array([TICKET_CRYPTO_VERSION]), nonce, sealed));
}

export async function decryptText(contentKey: Uint8Array, ciphertext: string, position: CipherPosition): Promise<string> {
  if (!isCiphertext(ciphertext)) throw new Error("Ungültiger Chiffretext.");
  const raw = fromBase64Url(ciphertext)!;
  const key = await aesKey(contentKey, "decrypt");
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: raw.slice(1, 1 + NONCE_BYTES), additionalData: utf8(messageAad(position)) },
    key,
    raw.slice(1 + NONCE_BYTES),
  );
  return decoder.decode(plain);
}

export function titleFrom(text: string): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  const chars = [...line.trim()];
  return chars.length > MAX_TITLE_CHARS ? `${chars.slice(0, MAX_TITLE_CHARS - 1).join("")}…` : chars.join("");
}

export function cleanMessage(text: string): string | null {
  // eslint-disable-next-line no-control-regex
  const trimmed = text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
  if (!trimmed || [...trimmed].length > MAX_MESSAGE_CHARS) return null;
  return trimmed;
}
