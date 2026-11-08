import type { MantelBridge } from "../../core/contract";

declare global {
  interface Window {
    mantel?: MantelBridge;
  }
}

export class BridgeMissingError extends Error {
  constructor() {
    super("window.mantel bridge missing");
  }
}

export async function loadBridge(): Promise<MantelBridge> {
  if (window.mantel) return window.mantel;
  if (import.meta.env.DEV) {
    const { createBrowserBridge } = await import("./dev/browser-bridge");
    return createBrowserBridge();
  }
  throw new BridgeMissingError();
}
