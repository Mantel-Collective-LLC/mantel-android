export const PINGS_PER_LOCATION = 3;
export const PING_TIMEOUT_MS = 1_500;
export const PING_CONCURRENCY = 4;
export const MEASURE_INTERVAL_MS = 5 * 60_000;
export const MAX_PING_TARGETS = 200;

export const FAST_MS = 40;
export const MEDIUM_MS = 100;

export type LatencyMeasurement = { id: string; samples: (number | null)[] };

export const PING_PROTOCOL = {
  version: 1,
  magic: [0x4d, 0x4e, 0x54, 0x50],
  requestSize: 32,
  replySize: 24,
  nonceOffset: 8,
  nonceSize: 16,
} as const;

export function buildPingRequest(nonce: Uint8Array): Uint8Array {
  if (nonce.length !== PING_PROTOCOL.nonceSize) throw new Error("nonce must be 16 bytes");
  const packet = new Uint8Array(PING_PROTOCOL.requestSize);
  packet.set(PING_PROTOCOL.magic, 0);
  packet[4] = PING_PROTOCOL.version;
  packet[5] = 1;
  packet.set(nonce, PING_PROTOCOL.nonceOffset);
  return packet;
}

export function isPingReply(packet: Uint8Array, nonce: Uint8Array): boolean {
  if (packet.length !== PING_PROTOCOL.replySize || nonce.length !== PING_PROTOCOL.nonceSize) return false;
  if (PING_PROTOCOL.magic.some((byte, index) => packet[index] !== byte)) return false;
  if (packet[4] !== PING_PROTOCOL.version || packet[5] !== 2 || packet[6] !== 0 || packet[7] !== 0) return false;
  return nonce.every((byte, index) => packet[PING_PROTOCOL.nonceOffset + index] === byte);
}

export function medianLatency(samples: readonly (number | null | undefined)[]): number | undefined {
  const valid = samples
    .filter((sample): sample is number => typeof sample === "number" && Number.isFinite(sample) && sample >= 0)
    .sort((a, b) => a - b);
  if (valid.length === 0) return undefined;
  return Math.round(valid[Math.floor((valid.length - 1) / 2)] as number);
}

export type LatencyBand = "fast" | "medium" | "slow";

export function latencyBand(ms: number | null | undefined): LatencyBand | undefined {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms <= FAST_MS) return "fast";
  if (ms <= MEDIUM_MS) return "medium";
  return "slow";
}

export function pingableNodes<T extends { id: string; online: boolean; pingPort?: number }>(nodes: readonly T[]): T[] {
  return nodes
    .filter((node) => node.online && typeof node.pingPort === "number" && Number.isInteger(node.pingPort) && node.pingPort > 0 && node.pingPort <= 65535)
    .slice(0, MAX_PING_TARGETS);
}

export function shouldMeasure(input: {
  phase: string;
  running: boolean;
  lastAt: number | null;
  now: number;
  targetsChanged: boolean;
  hasTargets: boolean;
}): boolean {
  if (!input.hasTargets || input.running || input.phase !== "disconnected") return false;
  if (input.lastAt === null || input.targetsChanged) return true;
  return input.now - input.lastAt >= MEASURE_INTERVAL_MS;
}

export async function mapLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
