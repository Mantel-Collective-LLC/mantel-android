import { z } from "zod";
import { describeApiError, endsSession } from "@shared/api-errors";
import { APP_VERSION_PATH, parseAppVersionInfo, type AppPlatform, type AppVersionInfo } from "@shared/app-version";
import type {
  Account,
  AccountSettings,
  Device,
  ErrorCode,
  LoginOverview,
  PortForwardingState,
  ProxyCreate,
  ProxyPatch,
  ProxyWithPassword,
  ServerProxy,
  SettingsPatch,
  VpnNode,
} from "@shared/contract";
import { supportRoute, supportRouteTemplate, SUPPORT_API_PATH, type TicketTransport } from "@shared/support";
import { DICTIONARIES, translate, type ErrorKey, type Language, type LocalizedMessage } from "@shared/i18n";
import {
  accountSchema,
  deviceSchema,
  errorSchema,
  loginSchema,
  loginsSchema,
  nodesSchema,
  portForwardingSchema,
  proxyListSchema,
  proxyWithPasswordSchema,
  registerDeviceSchema,
  registerSchema,
  settingsSchema,
  type RegisterDeviceResponse,
} from "./schemas";

export class ApiError extends Error {
  readonly i18n?: LocalizedMessage;
  readonly apiCode?: string;
  readonly serverMessage?: string;

  constructor(
    message: string | LocalizedMessage,
    readonly code: ErrorCode,
    readonly status: number | null,
    details: { apiCode?: string; serverMessage?: string } = {},
  ) {
    super(typeof message === "string" ? message : translate("de", message));
    if (typeof message !== "string") this.i18n = message;
    if (details.apiCode) this.apiCode = details.apiCode;
    if (details.serverMessage) this.serverMessage = details.serverMessage;
  }

  get sessionEnded(): boolean {
    return endsSession(this.status, this.apiCode);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ApiRequestRecord = {
  at: number;
  method: Method;
  route: string;
  status: number | null;
  durationMs: number;
  error: ErrorCode | null;
  apiCode?: string;
};

export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_TICKET_BODY_BYTES = 8 * 1024 * 1024;

type RequestOptions<T> = {
  body?: unknown;
  schema?: z.ZodType<T>;
  auth?: boolean | "optional";
  expect?: number[];
  template?: string;
  raw?: boolean;
  maxBytes?: number;
};
export const REQUEST_TIMEOUT_MS = 15_000;

export const UNREACHABLE = DICTIONARIES.de.errors.apiUnreachable;
export const REDIRECTED = DICTIONARIES.de.errors.apiRedirected;

type RawResponse = { status: number; headers: Headers; text: string; tooLarge: boolean };

function parseBody(response: RawResponse): unknown {
  if (response.tooLarge) throw new ApiError({ key: "apiTooLarge" }, "server", response.status);
  const text = response.text;
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    const header = response.headers.get("content-type");
    const contentType = header ?? "";
    const blockedByCloudflare =
      response.headers.get("cf-mitigated") === "challenge" ||
      (response.headers.get("server") === "cloudflare" && contentType.includes("text/html"));
    const key: ErrorKey = blockedByCloudflare ? "apiCloudflare" : response.status === 404 ? "apiNoMantelApi" : "apiInvalidJson";
    throw new ApiError(
      { key, params: { status: response.status, contentType: header ?? { key: "apiUnknownContentType" } } },
      "server",
      response.status,
    );
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<{ text: string; tooLarge: boolean }> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return { text: "", tooLarge: true };
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength > maxBytes ? { text: "", tooLarge: true } : { text, tooLarge: false };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { text: "", tooLarge: true };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder("utf-8").decode(all), tooLarge: false };
}

function redirectedElsewhere(response: Response, requested: URL): boolean {
  if (response.type === "opaqueredirect") return true;
  if (!response.url || response.url.includes("/_capacitor_http_interceptor_")) return false;
  try {
    const final = new URL(response.url);
    if (final.protocol !== "http:" && final.protocol !== "https:") return false;
    return final.origin !== requested.origin || final.pathname !== requested.pathname;
  } catch {
    return false;
  }
}

export type ApiAccount = Omit<Account, "devices"> & { devices: Array<Account["devices"][number] & { obfsToken?: string }> };

export class ApiClient {
  constructor(
    private readonly options: {
      baseUrl: () => string;
      token: () => string | null;
      fetch: FetchLike;
      userAgent: () => string;
      timeoutMs?: number;
      language?: () => Language;
      debug?: boolean;
      onRequest?: (record: ApiRequestRecord) => void;
      now?: () => number;
    },
  ) {}

  private record(record: ApiRequestRecord): void {
    try {
      this.options.onRequest?.(record);
    } catch {
    }
  }

  private async send(url: URL, init: RequestInit, maxBytes: number = MAX_BODY_BYTES): Promise<RawResponse> {
    const timeoutMs = this.options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("timeout"));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await this.options.fetch(url.toString(), {
            ...init,
            redirect: "manual",
            credentials: "omit",
            cache: "no-store",
            signal: controller.signal,
          });
          if (redirectedElsewhere(response, url)) {
            return { status: 302, headers: response.headers, text: "", tooLarge: false };
          }
          const body = await readCapped(response, maxBytes);
          return { status: response.status, headers: response.headers, ...body };
        })(),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(method: Method, route: string, options: RequestOptions<T> = {}): Promise<T> {
    if (!this.options.onRequest) return this.perform(method, route, options);
    const now = this.options.now ?? Date.now;
    const started = now();
    let status: number | null = null;
    const done = (error: ErrorCode | null, apiCode?: string) =>
      this.record({
        at: started,
        method,
        route: options.template ?? route,
        status,
        durationMs: now() - started,
        error,
        ...(apiCode ? { apiCode } : {}),
      });
    try {
      const value = await this.perform(method, route, options, (received) => {
        status = received;
      });
      const received = status as number | null;
      if (options.raw && received !== null && received >= 400) {
        const apiCode = errorSchema.safeParse((value as { body?: unknown }).body);
        done(received === 401 ? "unauthorized" : "server", apiCode.success ? apiCode.data.code : undefined);
      } else done(null);
      return value;
    } catch (error) {
      if (error instanceof ApiError) done(error.code, error.apiCode);
      else done("internal");
      throw error;
    }
  }

  private async perform<T>(method: Method, route: string, options: RequestOptions<T>, onStatus?: (status: number) => void): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": this.options.userAgent() };
    if (this.options.language) headers["Accept-Language"] = this.options.language();
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.auth) {
      const token = this.options.token();
      if (!token && options.auth !== "optional") throw new ApiError({ key: "apiNotLoggedIn" }, "unauthorized", null);
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    let url: URL;
    try {
      url = new URL(`${this.options.baseUrl()}${route}`);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
    } catch {
      throw new ApiError({ key: "apiInvalidBaseUrl" }, "invalid", null);
    }
    let response: RawResponse;
    try {
      response = await this.send(
        url,
        {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        },
        options.maxBytes,
      );
    } catch {
      throw new ApiError({ key: "apiUnreachable" }, "network", null);
    }
    onStatus?.(response.status);
    if (response.status >= 300 && response.status < 400) {
      throw new ApiError({ key: "apiRedirected" }, "network", response.status);
    }
    const body = parseBody(response);
    if (options.raw) return { status: response.status, body } as T;
    const expected = options.expect ?? [200];
    if (!expected.includes(response.status)) {
      const parsedError = errorSchema.safeParse(body);
      const described = describeApiError(response.status, parsedError.success ? parsedError.data : null, {
        debug: this.options.debug,
      });
      throw new ApiError(described.message, described.code, response.status, described);
    }
    if (!options.schema) return undefined as T;
    const parsed = options.schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError({ key: "apiUnexpectedFormat" }, "server", response.status);
    }
    return parsed.data;
  }

  login(code: string, totp?: string) {
    return this.request("POST", "/api/v1/auth/login", { body: { code, totp: totp ?? null }, schema: loginSchema });
  }

  register(referralCode?: string) {
    return this.request("POST", "/api/v1/auth/register", { body: referralCode ? { referralCode } : {}, schema: registerSchema, expect: [200, 201] });
  }

  logout() {
    return this.request<undefined>("POST", "/api/v1/auth/logout", { auth: true, expect: [204, 200] });
  }

  account(): Promise<ApiAccount> {
    return this.request("GET", "/api/v1/account", { auth: true, schema: accountSchema });
  }

  logins(): Promise<LoginOverview> {
    return this.request("GET", "/api/v1/account/logins", { auth: true, schema: loginsSchema });
  }

  loginsSeen() {
    return this.request<undefined>("POST", "/api/v1/account/logins/seen", { auth: true, body: {}, expect: [204, 200] });
  }

  logoutOthers() {
    return this.request<undefined>("POST", "/api/v1/auth/logout-others", { auth: true, body: {}, expect: [204, 200] });
  }

  nodes(): Promise<VpnNode[]> {
    return this.request("GET", "/api/v1/nodes", { auth: "optional", schema: nodesSchema });
  }

  registerDevice(input: { name: string; nodeId: string; publicKey: string }): Promise<RegisterDeviceResponse> {
    return this.request("POST", "/api/v1/devices", {
      auth: true,
      body: input,
      schema: registerDeviceSchema,
      expect: [201, 200],
    });
  }

  rotateDeviceKey(id: string, publicKey: string): Promise<RegisterDeviceResponse> {
    return this.request("POST", `/api/v1/devices/${encodeURIComponent(id)}/key`, {
      auth: true,
      body: { publicKey },
      schema: registerDeviceSchema,
      expect: [200],
    });
  }

  deleteDevice(id: string) {
    return this.request<undefined>("DELETE", `/api/v1/devices/${encodeURIComponent(id)}`, {
      auth: true,
      expect: [204, 200, 404],
      template: "/api/v1/devices/:id",
    });
  }

  async proxies(): Promise<ServerProxy[]> {
    return (await this.request("GET", "/api/v1/proxies", { auth: true, schema: proxyListSchema })).proxies;
  }

  createProxy(input: ProxyCreate): Promise<ProxyWithPassword> {
    return this.request("POST", "/api/v1/proxies", { auth: true, body: input, schema: proxyWithPasswordSchema, expect: [201, 200] });
  }

  updateProxy(id: string, patch: ProxyPatch): Promise<ProxyWithPassword> {
    return this.request("PATCH", `/api/v1/proxies/${encodeURIComponent(id)}`, {
      auth: true,
      body: patch,
      schema: proxyWithPasswordSchema,
      template: "/api/v1/proxies/:id",
    });
  }

  deleteProxy(id: string) {
    return this.request<undefined>("DELETE", `/api/v1/proxies/${encodeURIComponent(id)}`, {
      auth: true,
      expect: [204, 200],
      template: "/api/v1/proxies/:id",
    });
  }

  renameDevice(id: string, name: string): Promise<Device> {
    return this.request("PATCH", `/api/v1/devices/${encodeURIComponent(id)}`, {
      auth: true,
      body: { name },
      schema: deviceSchema,
      template: "/api/v1/devices/:id",
    });
  }

  async portForwarding(
    deviceId: string,
    action: "get" | "enable" | "disable" | "local" = "get",
    port?: number,
    localPort: number | null = null,
  ): Promise<PortForwardingState> {
    const one = (action === "disable" || action === "local") && port !== undefined;
    const route = `/api/v1/devices/${encodeURIComponent(deviceId)}/port-forwarding${one ? `/${port}` : ""}`;
    const template = `/api/v1/devices/:id/port-forwarding${one ? "/:port" : ""}`;
    const body =
      action === "get"
        ? await this.request("GET", route, { auth: true, schema: portForwardingSchema, template })
        : action === "enable"
          ?
            await this.request("POST", route, { auth: true, body: localPort === null ? {} : { localPort }, schema: portForwardingSchema, expect: [201, 200], template })
          : action === "local"
            ? await this.request("PATCH", route, { auth: true, body: { localPort }, schema: portForwardingSchema, expect: [200], template })
            : await this.request("DELETE", route, { auth: true, schema: portForwardingSchema, template });
    return {
      nodeId: body.nodeId,
      city: body.city,
      available: body.available,
      reason: body.reason,
      max: body.max,
      localPort: body.localPort ?? false,
      forwards: body.forwards.map((forward) => ({ port: forward.port, host: forward.host, localPort: forward.localPort ?? null })),
    };
  }

  setDeviceTor(deviceId: string, enabled: boolean): Promise<Device> {
    return this.request("PUT", `/api/v1/devices/${encodeURIComponent(deviceId)}/tor`, {
      auth: true,
      body: { enabled },
      schema: deviceSchema,
      expect: [200],
      template: "/api/v1/devices/:id/tor",
    });
  }

  async appVersion(platform: AppPlatform): Promise<AppVersionInfo> {
    const body = await this.request("GET", `${APP_VERSION_PATH}?platform=${platform}`, {
      schema: z.unknown(),
      template: APP_VERSION_PATH,
    });
    const info = parseAppVersionInfo(body, platform);
    if (!info) throw new ApiError({ key: "apiUnexpectedFormat" }, "server", 200);
    return info;
  }

  readonly tickets: TicketTransport = async (request) => {
    const route = supportRoute(request);
    return this.request<{ status: number; body: unknown }>(request.method, route, {
      auth: true,
      raw: true,
      maxBytes: MAX_TICKET_BODY_BYTES,
      template: supportRouteTemplate(route.slice(SUPPORT_API_PATH.length)),
      ...(request.body !== undefined ? { body: request.body } : {}),
    });
  };

  updateSettings(patch: SettingsPatch): Promise<AccountSettings> {
    return this.request("PATCH", "/api/v1/settings", { auth: true, body: patch, schema: settingsSchema });
  }
}
