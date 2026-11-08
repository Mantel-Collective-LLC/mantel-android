import type { MantelBridge } from "../../../core/contract";

export async function copyText(bridge: MantelBridge, text: string): Promise<boolean> {
  if (bridge.copyText) {
    const result = await bridge.copyText(text).catch(() => null);
    if (result?.ok) return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
