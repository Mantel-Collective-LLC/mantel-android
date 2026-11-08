import type { LocationStatus, VpnNode } from "../../../core/contract";

export type Availability = "available" | "offline" | LocationStatus;

export function availabilityOf(node: Pick<VpnNode, "online" | "status">): Availability {
  if (!node.online) return "offline";
  return node.status ?? "available";
}

export function isSelectable(node: Pick<VpnNode, "online" | "status">): boolean {
  return availabilityOf(node) === "available";
}

export function signalLevel(latencyMs: number | undefined): 0 | 1 | 2 | 3 {
  if (latencyMs === undefined || !Number.isFinite(latencyMs) || latencyMs < 0) return 0;
  if (latencyMs <= 40) return 3;
  if (latencyMs <= 100) return 2;
  return 1;
}

export type LatencyQuality = "fast" | "medium" | "slow";

export function latencyQuality(latencyMs: number | undefined): LatencyQuality | null {
  const level = signalLevel(latencyMs);
  return level === 0 ? null : level === 3 ? "fast" : level === 2 ? "medium" : "slow";
}

export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

function foldUmlautSpelling(text: string): string {
  return text.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
}

const displayNames = new Map<string, Intl.DisplayNames | null>();

export function countryName(code: string, locale: string): string {
  if (!displayNames.has(locale)) {
    try {
      displayNames.set(locale, new Intl.DisplayNames([locale], { type: "region", fallback: "code" }));
    } catch {
      displayNames.set(locale, null);
    }
  }
  try {
    return displayNames.get(locale)?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function countrySearchNames(code: string, locale: string): string[] {
  return [...new Set([countryName(code, locale), countryName(code, "de"), countryName(code, "en")])];
}

export function matchesQuery(
  node: Pick<VpnNode, "id" | "city" | "country">,
  countries: string | readonly string[],
  query: string,
): boolean {
  const words = fold(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystacks = [node.city, ...(typeof countries === "string" ? [countries] : countries), node.country, node.id].map(fold);
  const starts = haystacks.flatMap((text) => {
    const parts = text.split(/[\s\-_/.,()]+/).filter(Boolean);
    return [text, ...parts, ...parts.map(foldUmlautSpelling)];
  });
  return words.every((word) => {
    const variants = [word, foldUmlautSpelling(word)];
    return variants.some((variant) => starts.some((start) => start.startsWith(variant)));
  });
}

export type CountryGroup = {
  code: string;
  name: string;
  nodes: VpnNode[];
  available: number;
};

export function compareNodes(a: VpnNode, b: VpnNode, locale: string): number {
  const rank = Number(!isSelectable(a)) - Number(!isSelectable(b));
  return rank || a.city.localeCompare(b.city, locale) || a.id.localeCompare(b.id);
}

export function groupLocations(nodes: readonly VpnNode[], options: { query?: string; locale: string }): CountryGroup[] {
  const { locale } = options;
  const query = options.query ?? "";
  const names = new Map<string, string[]>();
  const byCountry = new Map<string, VpnNode[]>();
  for (const node of nodes) {
    const code = node.country.toUpperCase();
    if (!names.has(code)) names.set(code, countrySearchNames(code, locale));
    if (!matchesQuery(node, names.get(code) ?? [code], query)) continue;
    byCountry.set(code, [...(byCountry.get(code) ?? []), node]);
  }
  return [...byCountry.entries()]
    .map(([code, members]) => ({
      code,
      name: names.get(code)?.[0] ?? code,
      nodes: [...members].sort((a, b) => compareNodes(a, b, locale)),
      available: members.filter(isSelectable).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale) || a.code.localeCompare(b.code));
}

export function favoriteNodes(
  nodes: readonly VpnNode[],
  favorites: readonly string[],
  options: { query?: string; locale: string },
): VpnNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return favorites.flatMap((id) => {
    const node = byId.get(id);
    if (!node) return [];
    const names = countrySearchNames(node.country.toUpperCase(), options.locale);
    return matchesQuery(node, names, options.query ?? "") ? [node] : [];
  });
}

export const MAX_FAVORITES = 50;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function toggleFavorite(favorites: readonly string[], id: string): string[] {
  if (favorites.includes(id)) return favorites.filter((entry) => entry !== id);
  return [...favorites, id].slice(-MAX_FAVORITES);
}

export function parseFavorites(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const ids = value.filter((entry): entry is string => typeof entry === "string" && ID.test(entry));
    return [...new Set(ids)].slice(-MAX_FAVORITES);
  } catch {
    return [];
  }
}

export type PickerRow = { key: string; node: VpnNode; section: "favorites" | string };

export function pickerRows(favorites: readonly VpnNode[], groups: readonly CountryGroup[]): PickerRow[] {
  return [
    ...favorites.map((node) => ({ key: `fav:${node.id}`, node, section: "favorites" })),
    ...groups.flatMap((group) => group.nodes.map((node) => ({ key: `${group.code}:${node.id}`, node, section: group.code }))),
  ];
}

export function nextRow(count: number, from: number, move: 1 | -1 | "first" | "last"): number {
  if (count === 0) return -1;
  if (move === "first") return 0;
  if (move === "last") return count - 1;
  return Math.min(Math.max(from + move, -1), count - 1);
}
