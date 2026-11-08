const V4_SEG = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])";
const V4_STR = `(?:${V4_SEG}\.){3}${V4_SEG}`;
const V6_SEG = "(?:[0-9a-fA-F]{1,4})";
const IPV4 = new RegExp(`^${V4_STR}$`);
const IPV6 = new RegExp(
  "^(?:" +
    `(?:${V6_SEG}:){7}(?:${V6_SEG}|:)|` +
    `(?:${V6_SEG}:){6}(?:${V4_STR}|:${V6_SEG}|:)|` +
    `(?:${V6_SEG}:){5}(?::${V4_STR}|(?::${V6_SEG}){1,2}|:)|` +
    `(?:${V6_SEG}:){4}(?:(?::${V6_SEG}){0,1}:${V4_STR}|(?::${V6_SEG}){1,3}|:)|` +
    `(?:${V6_SEG}:){3}(?:(?::${V6_SEG}){0,2}:${V4_STR}|(?::${V6_SEG}){1,4}|:)|` +
    `(?:${V6_SEG}:){2}(?:(?::${V6_SEG}){0,3}:${V4_STR}|(?::${V6_SEG}){1,5}|:)|` +
    `(?:${V6_SEG}:){1}(?:(?::${V6_SEG}){0,4}:${V4_STR}|(?::${V6_SEG}){1,6}|:)|` +
    `(?::(?:(?::${V6_SEG}){0,5}:${V4_STR}|(?::${V6_SEG}){1,7}|:))` +
    ")(?:%[0-9a-zA-Z-.:]{1,})?$",
);

export function isIP(value: string): 0 | 4 | 6 {
  if (typeof value !== "string") return 0;
  if (IPV4.test(value)) return 4;
  if (IPV6.test(value)) return 6;
  return 0;
}

export type Family = 4 | 6;

export type IpRange = {
  family: Family;
  start: bigint;
  end: bigint;
};

const BITS: Record<Family, number> = { 4: 32, 6: 128 };

export function familyBits(family: Family): number {
  return BITS[family];
}

function maxValue(family: Family): bigint {
  return (1n << BigInt(BITS[family])) - 1n;
}

function parseV4(address: string): bigint {
  return address
    .split(".")
    .map((part) => BigInt(Number.parseInt(part, 10)))
    .reduce((acc, part) => (acc << 8n) | part, 0n);
}

function expandV6(address: string): string[] {
  const withoutZone = address.split("%")[0] ?? address;
  const embeddedV4 = withoutZone.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  let normalized = withoutZone;
  if (embeddedV4) {
    const v4 = parseV4(embeddedV4[2] ?? "0.0.0.0");
    normalized = `${embeddedV4[1]}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head = "", tail] = normalized.split("::");
  const headParts = head === "" ? [] : head.split(":");
  if (tail === undefined) return headParts;
  const tailParts = tail === "" ? [] : tail.split(":");
  const missing = 8 - headParts.length - tailParts.length;
  return [...headParts, ...Array.from({ length: missing }, () => "0"), ...tailParts];
}

function parseV6(address: string): bigint {
  return expandV6(address).reduce((acc, part) => (acc << 16n) | BigInt(Number.parseInt(part, 16)), 0n);
}

export function parseAddress(address: string): { family: Family; value: bigint } | null {
  const kind = isIP(address);
  if (kind === 4) return { family: 4, value: parseV4(address) };
  if (kind === 6) return { family: 6, value: parseV6(address) };
  return null;
}

export function formatAddress(family: Family, value: bigint): string {
  if (family === 4) {
    return [24n, 16n, 8n, 0n].map((shift) => ((value >> shift) & 0xffn).toString()).join(".");
  }
  const groups = Array.from({ length: 8 }, (_, index) =>
    Number((value >> BigInt((7 - index) * 16)) & 0xffffn),
  );
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  groups.forEach((group, index) => {
    if (group !== 0) {
      runStart = -1;
      return;
    }
    if (runStart === -1) runStart = index;
    const length = index - runStart + 1;
    if (length > bestLength) {
      bestLength = length;
      bestStart = runStart;
    }
  });
  const hex = groups.map((group) => group.toString(16));
  if (bestLength < 2) return hex.join(":");
  const head = hex.slice(0, bestStart).join(":");
  const tail = hex.slice(bestStart + bestLength).join(":");
  return `${head}::${tail}`;
}

export function parseCidr(cidr: string): IpRange | null {
  const [address = "", prefixText] = cidr.split("/");
  const parsed = parseAddress(address);
  if (!parsed) return null;
  const bits = BITS[parsed.family];
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;
  if (prefixText !== undefined && !/^\d{1,3}$/.test(prefixText)) return null;
  const hostBits = BigInt(bits - prefix);
  const mask = ((1n << hostBits) - 1n);
  const start = parsed.value & ~mask & maxValue(parsed.family);
  return { family: parsed.family, start, end: start | mask };
}

export function isValidCidr(cidr: string): boolean {
  return /^[0-9a-fA-F:.]+\/\d{1,3}$/.test(cidr) && parseCidr(cidr) !== null;
}

export function isIpLiteral(value: string): boolean {
  return isIP(value) !== 0;
}

export function mergeRanges(ranges: readonly IpRange[]): IpRange[] {
  const sorted = [...ranges].sort((left, right) => {
    if (left.family !== right.family) return left.family - right.family;
    if (left.start === right.start) return 0;
    return left.start < right.start ? -1 : 1;
  });
  const merged: IpRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.family === range.family && range.start <= last.end + 1n) {
      if (range.end > last.end) last.end = range.end;
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

export function complementRanges(family: Family, excluded: readonly IpRange[]): IpRange[] {
  const own = mergeRanges(excluded.filter((range) => range.family === family));
  const result: IpRange[] = [];
  let cursor = 0n;
  for (const range of own) {
    if (range.start > cursor) result.push({ family, start: cursor, end: range.start - 1n });
    cursor = range.end + 1n;
  }
  if (cursor <= maxValue(family)) result.push({ family, start: cursor, end: maxValue(family) });
  return result;
}

export function subtractRanges(base: readonly IpRange[], removed: readonly IpRange[]): IpRange[] {
  const families: Family[] = [4, 6];
  return families.flatMap((family) => {
    const kept = complementRanges(family, removed);
    const own = mergeRanges(base.filter((range) => range.family === family));
    return own.flatMap((range) =>
      kept
        .filter((keep) => keep.start <= range.end && keep.end >= range.start)
        .map((keep) => ({
          family,
          start: keep.start > range.start ? keep.start : range.start,
          end: keep.end < range.end ? keep.end : range.end,
        })),
    );
  });
}

export function rangeToCidrs(range: IpRange): string[] {
  const bits = BITS[range.family];
  const cidrs: string[] = [];
  let start = range.start;
  while (start <= range.end) {
    let hostBits = 0;
    while (hostBits < bits) {
      const size = 1n << BigInt(hostBits + 1);
      const aligned = start % size === 0n;
      const fits = start + size - 1n <= range.end;
      if (!aligned || !fits) break;
      hostBits += 1;
    }
    cidrs.push(`${formatAddress(range.family, start)}/${bits - hostBits}`);
    start += 1n << BigInt(hostBits);
  }
  return cidrs;
}

export function rangesToCidrs(ranges: readonly IpRange[]): string[] {
  return mergeRanges(ranges).flatMap(rangeToCidrs);
}

export function formatRange(range: IpRange): string {
  if (range.start === range.end) return formatAddress(range.family, range.start);
  return `${formatAddress(range.family, range.start)}-${formatAddress(range.family, range.end)}`;
}

export function hostRange(address: string): IpRange | null {
  const parsed = parseAddress(address);
  if (!parsed) return null;
  return { family: parsed.family, start: parsed.value, end: parsed.value };
}

export function cidrRanges(cidrs: readonly string[]): IpRange[] {
  return cidrs.map(parseCidr).filter((range): range is IpRange => range !== null);
}

export function rangeContains(range: IpRange, address: string): boolean {
  const parsed = parseAddress(address);
  if (!parsed || parsed.family !== range.family) return false;
  return parsed.value >= range.start && parsed.value <= range.end;
}

export function stripPrefix(cidr: string): string {
  return cidr.split("/")[0] ?? cidr;
}
