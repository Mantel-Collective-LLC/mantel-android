export const KEY_ROTATION_DAYS = 30;
export const KEY_ROTATION_MS = KEY_ROTATION_DAYS * 86_400_000;

export function keyCreatedAt(
  stamp: number | null | undefined,
  device: { keyRotatedOn?: string | null; createdOn: string } | null | undefined,
): number | null {
  if (typeof stamp === "number" && Number.isFinite(stamp)) return stamp;
  const day = device?.keyRotatedOn ?? device?.createdOn;
  const parsed = day ? Date.parse(day) : Number.NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

export function keyRotationDue(createdAt: number | null, now: number): boolean {
  return createdAt !== null && now - createdAt >= KEY_ROTATION_MS;
}

export async function rotateWithPending<Pair extends { publicKey: string }, Response>(input: {
  pending: Pair | null | undefined;
  generate: () => Pair | Promise<Pair>;
  storePending: (pair: Pair | null) => void | Promise<void>;
  send: (publicKey: string) => Promise<Response>;
  answered: (error: unknown) => boolean;
}): Promise<{ pair: Pair; response: Response }> {
  const pair = input.pending ?? (await input.generate());
  if (!input.pending) await input.storePending(pair);
  try {
    return { pair, response: await input.send(pair.publicKey) };
  } catch (error) {
    if (input.answered(error)) await input.storePending(null);
    throw error;
  }
}
