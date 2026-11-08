import { PQ_ADDRESS, type AccountSettings, type LeakProtection } from "../../core/contract";
import { LocalizedError } from "../../core/i18n";
import {
  cidrRanges,
  complementRanges,
  hostRange,
  isIpLiteral,
  parseAddress,
  parseCidr,
  rangesToCidrs,
  stripPrefix,
  subtractRanges,
  type IpRange,
} from "../net/ip";
import { FULL_TUNNEL, LAN_V6, ROUTE_EXCLUDE_V4, SPLIT_DEFAULT } from "../net/ranges";

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

export type RoutingPlan = {
  allowedIps: string[];
  leakProtection: LeakProtection;
  firewallRequired: boolean;
};

export type TunnelConfig = {
  text: string;
  addresses: string[];
  dns: string[];
  allowedIps: string[];
  endpoint: Endpoint;
  leakProtection: LeakProtection;
  firewallRequired: boolean;
};

const WG_KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/;

export function isWireGuardKey(value: string): boolean {
  return WG_KEY.test(value);
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

export function isHostname(value: string): boolean {
  if (value.length > 253) return false;
  return value
    .split(".")
    .every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
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
  const reAdded = tunnelOnlyHosts
    .map(hostRange)
    .filter((range): range is IpRange => range !== null);
  return rangesToCidrs([...outside, ...reAdded]);
}

export function planRouting(
  settings: Pick<AccountSettings, "killSwitch" | "lanAccess">,
  dnsServers: readonly string[],
): RoutingPlan {
  if (settings.killSwitch && !settings.lanAccess) {
    return { allowedIps: [...FULL_TUNNEL], leakProtection: "wireguard", firewallRequired: false };
  }
  if (settings.killSwitch && settings.lanAccess) {
    return {
      allowedIps: lanExcludedRoutes(dnsServers),
      leakProtection: "firewall",
      firewallRequired: true,
    };
  }
  if (settings.lanAccess) {
    return { allowedIps: lanExcludedRoutes(dnsServers), leakProtection: "none", firewallRequired: false };
  }
  return { allowedIps: [...SPLIT_DEFAULT], leakProtection: "none", firewallRequired: false };
}

export function allowedIpsBypassing(allowedIps: readonly string[], host: string): string[] {
  const bypass = hostRange(host);
  const ranges = subtractRanges(cidrRanges(allowedIps), bypass ? [bypass] : []);
  return rangesToCidrs(ranges).flatMap((cidr) =>
    cidr === "0.0.0.0/0" ? ["0.0.0.0/1", "128.0.0.0/1"] : cidr === "::/0" ? ["::/1", "8000::/1"] : [cidr],
  );
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
  bypassHost?: string;
}): TunnelConfig {
  const { privateKey, server, endpoint, settings } = input;
  const postQuantum = input.postQuantum === true;
  if (!isWireGuardKey(privateKey)) throw new LocalizedError("configInvalidPrivateKey");
  if (!isWireGuardKey(server.serverPublicKey)) throw new LocalizedError("configInvalidServerKey");
  if (server.presharedKey !== undefined && !isWireGuardKey(server.presharedKey)) {
    throw new LocalizedError("configInvalidPresharedKey");
  }
  if (!isIpLiteral(endpoint.host)) throw new LocalizedError("configEndpointNotIp");

  const addresses = selectAddresses(server.address, settings.ipv6);
  if (!addresses.some((address) => familyOf(address) === 4)) {
    throw new LocalizedError("configNoIpv4");
  }
  const dns = selectDns(server.dns, settings.ipv6);
  if (dns.length === 0) throw new LocalizedError("configNoDns");
  const planned = planRouting(settings, postQuantum ? [...dns, PQ_ADDRESS] : dns);
  const routing: RoutingPlan =
    input.bypassHost === undefined
      ? planned
      : {
          allowedIps: allowedIpsBypassing(planned.allowedIps, input.bypassHost),
          leakProtection: planned.leakProtection === "wireguard" ? "firewall" : planned.leakProtection,
          firewallRequired: planned.firewallRequired || planned.leakProtection === "wireguard",
        };

  const interfaceLines = [
    "[Interface]",
    `PrivateKey = ${privateKey}`,
    `Address = ${addresses.join(", ")}`,
    `DNS = ${dns.join(", ")}`,
  ];
  if (server.mtu !== undefined) interfaceLines.push(`MTU = ${server.mtu}`);

  const peerLines = ["[Peer]", `PublicKey = ${server.serverPublicKey}`];
  if (server.presharedKey !== undefined) peerLines.push(`PresharedKey = ${server.presharedKey}`);
  peerLines.push(`AllowedIPs = ${routing.allowedIps.join(", ")}`);
  if (!postQuantum) peerLines.push(`Endpoint = ${formatEndpoint(endpoint)}`);
  peerLines.push("PersistentKeepalive = 25");

  const text = [...interfaceLines, "", ...peerLines, ""].map(assertSafeLine).join("\r\n");

  return {
    text,
    addresses,
    dns,
    allowedIps: routing.allowedIps,
    endpoint,
    leakProtection: routing.leakProtection,
    firewallRequired: routing.firewallRequired,
  };
}

export function redactConfig(text: string): string {
  return text
    .replace(/^(PrivateKey\s*=\s*).+$/m, "$1(lokal, nicht angezeigt)")
    .replace(/^(PresharedKey\s*=\s*).+$/m, "$1(nicht angezeigt)");
}
