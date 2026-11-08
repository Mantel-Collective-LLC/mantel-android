import { Preferences as CapacitorPreferences } from "@capacitor/preferences";
import type { TunnelStatus } from "@shared/contract";
import { createAndroidBridgeWithController } from "../bridge/android-bridge";
import type { AndroidBridge } from "../bridge/extras";
import { readAppInfo } from "./diagnostics";
import { openDebugScreen } from "./events";
import { mountDebugOverlay } from "./overlay";
import { RequestLog } from "./request-log";
import { VerboseLog } from "./verbose";

export function createDebugBridge(): AndroidBridge {
  const log = new RequestLog();
  let secrets: () => readonly string[] = () => [];
  const verbose = new VerboseLog(CapacitorPreferences, () => secrets());
  const { bridge, controller } = createAndroidBridgeWithController({
    onApiRequest: (record) => {
      const entry = log.add(record);
      verbose.log("api", { method: entry.method, route: entry.route, status: entry.status, ms: entry.durationMs, error: entry.error });
    },
  });
  secrets = () => controller.secretsForRedaction();
  bridge.openDebugMenu = openDebugScreen;
  void verbose.load();

  let last = "";
  bridge.onTunnelStatus((status: TunnelStatus) => {
    const key = `${status.phase}|${status.nodeId}|${status.lastHandshakeAt}|${status.error}`;
    if (key === last) return;
    last = key;
    verbose.log("tunnel", {
      phase: status.phase,
      nodeId: status.nodeId,
      endpoint: status.endpoint,
      lastHandshakeAt: status.lastHandshakeAt,
      rx: status.rxBytes,
      tx: status.txBytes,
      error: status.error,
    });
  });

  void (async () => {
    await controller.ready.catch(() => undefined);
    const appInfo = await readAppInfo();
    mountDebugOverlay({ bridge, controller, log, verbose, appInfo });
  })();
  return bridge;
}
