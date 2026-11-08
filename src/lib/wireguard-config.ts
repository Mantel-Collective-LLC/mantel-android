import { PQ_ADDRESS, type AccountSettings, type LeakProtection } from "@shared/contract";
import { LocalizedError } from "@shared/i18n";
import { FULL_TUNNEL, LAN_V6, ROUTE_EXCLUDE_V4, SPLIT_DEFAULT } from "@desktop-main/net/ranges";
import {
  cidrRanges,
  complementRanges,
  hostRange,
  isIpLiteral,
  parseAddress,
  parseCidr,
  rangesToCidrs,
  stripPrefix,
  type IpRange,
} from "./ip";

export type ServerTunnelConfig = {
  address: string[];
  dns: string[];
  serverPublicKey: string;
  presharedKey?: string;
  endpoint: string;
  allowedIps: string[];
  mtu?: number;
};

export type Endpoint = { host: string; port: number };

export type TunnelConfig = {
  text: string;
  addresses: string[];
  dns: string[];
  allowedIps: string[];
  endpoint: Endpoint;
  leakProtection: LeakProtection;
};

const WG_KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/;

export function isWireGuardKey(value: string): boolean {
  return WG_KEY.test(value);
}

export function isHostname(value: string): boolean {
  if (value.length > 253) return false;
  return value
    .split(".")
    .every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}

export function parseEndpoint(value: string): Endpoint | null {
  const bracketed = value.match(/^\[([0-9a-fA-F:.]+)\]:(\d{1,5})$/);
  const plain = value.match(/^([A-Za-z0-9.-]+):(\d{1,5})$/);
  const match = bracketed ?? plain;
  if (!match) return null;
  const host = match[1] ?? "";
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (bracketed && parseAddress(host)?.family !== 6) return null;
  if (!bracketed && !isIpLiteral(host) && !isHostname(host)) return null;
  return { host, port };
}

export function formatEndpoint(endpoint: Endpoint): string {
  return parseAddress(endpoint.host)?.family === 6
    ? `[${endpoint.host}]:${endpoint.port}`
    : `${endpoint.host}:${endpoint.port}`;
}

function lanRanges(): IpRange[] {
  return cidrRanges([...ROUTE_EXCLUDE_V4, ...LAN_V6]);
}

function lanExcludedRoutes(tunnelOnlyHosts: readonly string[]): string[] {
  const lan = lanRanges();
  const outside = [...complementRanges(4, lan), ...complementRanges(6, lan)];
  const reAdded = tunnelOnlyHosts.map(hostRange).filter((range): range is IpRange => range !== null);
  return rangesToCidrs([...outside, ...reAdded]);
}

export function planAllowedIps(
  settings: Pick<AccountSettings, "killSwitch" | "lanAccess">,
  dnsServers: readonly string[],
  postQuantum = false,
): string[] {
  if (settings.killSwitch && !settings.lanAccess) return [...FULL_TUNNEL];
  if (settings.lanAccess) return lanExcludedRoutes(postQuantum ? [...dnsServers, PQ_ADDRESS] : dnsServers);
  return [...SPLIT_DEFAULT];
}

export function leakProtectionFor(settings: Pick<AccountSettings, "killSwitch" | "lanAccess">): LeakProtection {
  if (!settings.killSwitch) return "none";
  return settings.lanAccess ? "firewall" : "wireguard";
}

function withPrefix(address: string): string | null {
  if (address.includes("/")) {
    const range = parseCidr(address);
    return range ? address : null;
  }
  const parsed = parseAddress(address);
  if (!parsed) return null;
  return `${address}/${parsed.family === 4 ? 32 : 128}`;
}

function familyOf(address: string): 4 | 6 | null {
  return parseAddress(stripPrefix(address))?.family ?? null;
}

export function selectAddresses(addresses: readonly string[], ipv6: boolean): string[] {
  return addresses
    .map(withPrefix)
    .filter((address): address is string => address !== null)
    .filter((address) => ipv6 || familyOf(address) === 4);
}

export function selectDns(servers: readonly string[], ipv6: boolean): string[] {
  return servers.filter(isIpLiteral).filter((server) => ipv6 || familyOf(server) === 4);
}

function assertSafeLine(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new LocalizedError("configUnsafeCharacters");
  return value;
}

export function buildTunnelConfig(input: {
  privateKey: string;
  server: ServerTunnelConfig;
  endpoint: Endpoint;
  settings: Pick<AccountSettings, "killSwitch" | "lanAccess" | "ipv6">;
  postQuantum?: boolean;
}): TunnelConfig {
  const { privateKey, server, endpoint, settings } = input;
  if (!isWireGuardKey(privateKey)) throw new LocalizedError("configInvalidPrivateKey");
  if (!isWireGuardKey(server.serverPublicKey)) throw new LocalizedError("configInvalidServerKey");
  if (server.presharedKey !== undefined && !isWireGuardKey(server.presharedKey)) {
    throw new LocalizedError("configInvalidPresharedKey");
  }
  if (!isIpLiteral(endpoint.host) && !isHostname(endpoint.host)) throw new LocalizedError("configInvalidEndpoint");
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) {
    throw new LocalizedError("configInvalidEndpoint");
  }

  const addresses = selectAddresses(server.address, settings.ipv6);
  if (!addresses.some((address) => familyOf(address) === 4)) {
    throw new LocalizedError("configNoIpv4");
  }
  const dns = selectDns(server.dns, settings.ipv6);
  if (dns.length === 0) throw new LocalizedError("configNoDns");
  const allowedIps = planAllowedIps(settings, dns, input.postQuantum === true);

  const interfaceLines = [
    "[Interface]",
    `PrivateKey = ${privateKey}`,
    `Address = ${addresses.join(", ")}`,
    `DNS = ${dns.join(", ")}`,
  ];
  if (server.mtu !== undefined) interfaceLines.push(`MTU = ${server.mtu}`);

  const peerLines = ["[Peer]", `PublicKey = ${server.serverPublicKey}`];
  if (server.presharedKey !== undefined) peerLines.push(`PresharedKey = ${server.presharedKey}`);
  peerLines.push(
    `AllowedIPs = ${allowedIps.join(", ")}`,
    `Endpoint = ${formatEndpoint(endpoint)}`,
    "PersistentKeepalive = 25",
  );

  const text = [...interfaceLines, "", ...peerLines, ""].map(assertSafeLine).join("\n");

  return { text, addresses, dns, allowedIps, endpoint, leakProtection: leakProtectionFor(settings) };
}

export function withServerKey(text: string, serverPublicKey: string): string {
  if (!isWireGuardKey(serverPublicKey)) return text;
  return text.replace(/^PublicKey = .*$/m, `PublicKey = ${serverPublicKey}`);
}
