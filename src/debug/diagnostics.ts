import type { SystemVpnState } from "@shared/contract";
import type { AndroidVpnController } from "../bridge/controller";
import { MantelVpn, type MantelVpnPlugin } from "../native/mantel-vpn";
import { redact, shortId } from "./redact";
import type { RequestLog } from "./request-log";

export type NativeAppInfo = Awaited<ReturnType<MantelVpnPlugin["appInfo"]>>;

export async function readAppInfo(vpn: Pick<MantelVpnPlugin, "appInfo"> = MantelVpn): Promise<NativeAppInfo | null> {
  try {
    return await vpn.appInfo();
  } catch {
    return null;
  }
}

export type HealthResult =
  | { state: "ok"; ms: number; nodes: number; at: number }
  | { state: "failed"; ms: number; error: string; status: number | null; at: number };

export async function checkHealth(controller: AndroidVpnController, now: () => number = Date.now): Promise<HealthResult> {
  const started = now();
  try {
    const nodes = await controller.api.nodes();
    return { state: "ok", ms: now() - started, nodes: nodes.length, at: started };
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : null;
    return { state: "failed", ms: now() - started, error: controller.describe(error), status, at: started };
  }
}

export function diagnosticsReport(input: {
  controller: AndroidVpnController;
  appInfo: NativeAppInfo | null;
  log: RequestLog;
  systemVpn: SystemVpnState | null;
  health: HealthResult | null;
}): string {
  const { controller, appInfo, log, systemVpn, health } = input;
  const local = controller.diagnostics();
  const report = {
    generatedAt: new Date().toISOString(),
    build: {
      flavor: local.flavor,
      web: __MANTEL_BUILD_INFO__,
      native: appInfo,
      userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
    },
    server: { baseUrl: local.baseUrl, health },
    language: local.language,
    encryptionAvailable: local.encryptionAvailable,
    session: { ...local.session, accountId: shortId(local.session.accountId) },
    device: local.device,
    staleDevices: local.staleDevices,
    excludedApps: local.excludedApps,
    tunnel: local.status,
    systemVpn: systemVpn ?? local.systemVpn,
    requests: log
      .list()
      .slice(0, 50)
      .map((entry) => ({
        at: new Date(entry.at).toISOString(),
        method: entry.method,
        route: entry.route,
        status: entry.status,
        ms: entry.durationMs,
        error: entry.error,
      })),
  };
  return redact(JSON.stringify(report, null, 2), controller.secretsForRedaction());
}
