export const PROXY_LIMIT = 20;
export const MAX_PROXY_NAME = 40;

export const PROXY_PROTOCOLS = ["socks5", "http", "mtproto"] as const;
export type ProxyProtocol = (typeof PROXY_PROTOCOLS)[number];

export const PROXY_EXITS = ["tor", "direct"] as const;
export type ProxyExit = (typeof PROXY_EXITS)[number];

export const PROXY_STATUSES = ["active", "pending", "unavailable"] as const;
export type ProxyState = (typeof PROXY_STATUSES)[number];

export type ServerProxy = {
  id: string;
  name: string;
  nodeId: string;
  host: string;
  port: number;
  protocol: ProxyProtocol;
  exit: ProxyExit;
  username: string;
  enabled: boolean;
  status: ProxyState;
  secret?: string;
  link?: string;
  webLink?: string;
};

export type ProxyCreate = { name: string; nodeId: string; protocol: ProxyProtocol; exit: ProxyExit };

export type ProxyPatch = {
  name?: string;
  enabled?: boolean;
  exit?: ProxyExit;
  rotatePassword?: true;
  newCircuit?: true;
};

export type ProxyWithPassword = { proxy: ServerProxy; password?: string };

const PROXY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const NODE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;

export function isProxyId(value: unknown): value is string {
  return typeof value === "string" && PROXY_ID.test(value);
}

export function cleanProxyName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= MAX_PROXY_NAME ? name : null;
}

export function parseProxyCreate(input: unknown): ProxyCreate | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const name = cleanProxyName(raw.name);
  if (!name || typeof raw.nodeId !== "string" || !NODE_ID.test(raw.nodeId)) return null;
  if (!PROXY_PROTOCOLS.includes(raw.protocol as ProxyProtocol) || !PROXY_EXITS.includes(raw.exit as ProxyExit)) return null;
  return { name, nodeId: raw.nodeId, protocol: raw.protocol as ProxyProtocol, exit: raw.exit as ProxyExit };
}

export function parseProxyPatch(input: unknown): ProxyPatch | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const patch: ProxyPatch = {};
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (value === undefined) continue;
    if (key === "name") {
      const name = cleanProxyName(value);
      if (!name) return null;
      patch.name = name;
    } else if (key === "enabled" && typeof value === "boolean") patch.enabled = value;
    else if (key === "exit" && PROXY_EXITS.includes(value as ProxyExit)) patch.exit = value as ProxyExit;
    else if (key === "rotatePassword" && value === true) patch.rotatePassword = true;
    else if (key === "newCircuit" && value === true) patch.newCircuit = true;
    else return null;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

const TELEGRAM_LINK = /^https:\/\/t\.me\/proxy\?server=[A-Za-z0-9.%:-]{1,255}&port=\d{1,5}&secret=ee[0-9a-f]{40,160}$/;

const WEB_PREFIX = "https://t.me/proxy?";

export function isTelegramProxyLink(value: unknown): value is string {
  return typeof value === "string" && TELEGRAM_LINK.test(value);
}

export function proxyFieldsConsistent(proxy: Pick<ServerProxy, "protocol" | "username" | "secret" | "link" | "webLink">): boolean {
  if (proxy.protocol !== "mtproto") return proxy.username.length > 0 && proxy.secret === undefined && proxy.link === undefined && proxy.webLink === undefined;
  const { webLink, secret } = proxy;
  return isTelegramProxyLink(webLink) && proxy.link === `tg://proxy?${webLink.slice(WEB_PREFIX.length)}` && webLink.endsWith(`&secret=${secret}`);
}

export function proxyAddress(proxy: Pick<ServerProxy, "host" | "port">): string {
  return proxy.host.includes(":") ? `[${proxy.host}]:${proxy.port}` : `${proxy.host}:${proxy.port}`;
}

export function proxyUrl(proxy: Pick<ServerProxy, "protocol" | "host" | "port" | "username">, password: string): string {
  return `${proxy.protocol}://${encodeURIComponent(proxy.username)}:${encodeURIComponent(password)}@${proxyAddress(proxy)}`;
}
