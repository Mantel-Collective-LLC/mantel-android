import type { ErrorCode } from "./contract";
import type { ErrorKey, LocalizedMessage, Params } from "./i18n";

type ParamEntry = { key: ErrorKey; params: readonly string[]; fallback: ErrorKey };
type Entry = ErrorKey | ParamEntry;

const BAD_REQUEST: ErrorKey = "apiBadRequest";
const SETTINGS: ErrorKey = "apiSettingsRejected";
const city = (key: ErrorKey): ParamEntry => ({ key, params: ["city"], fallback: "apiLocationUnavailable" });

export const API_ERROR_MESSAGES: Readonly<Record<string, Entry>> = {
  unsupported_media_type: BAD_REQUEST,
  body_too_large: BAD_REQUEST,
  body_unreadable: BAD_REQUEST,
  invalid_json: BAD_REQUEST,
  body_not_object: BAD_REQUEST,
  unknown_field: BAD_REQUEST,
  validation_failed: BAD_REQUEST,
  method_not_allowed: BAD_REQUEST,
  unauthorized: "apiSessionExpired",
  not_found: "apiNotFound",
  conflict: "apiConflict",
  rate_limited: "apiRateLimited",
  internal: "apiInternal",
  upstream_error: "apiServiceUnavailable",
  service_unavailable: "apiServiceUnavailable",
  invalid_code: "apiInvalidCode",
  unknown_code: "apiUnknownCode",
  totp_required: "apiTotpRequired",
  totp_invalid: "apiTotpInvalid",
  invalid_referral_code: "apiInvalidReferralCode",
  referral_code_unavailable: "apiReferralUnavailable",
  account_not_found: "apiAccountNotFound",
  account_expired: "apiAccountExpired",
  public_key_missing: "apiAppOutdated",
  invalid_public_key: "apiInvalidPublicKey",
  public_key_taken: "apiPublicKeyTaken",
  invalid_device_name: "apiInvalidDeviceName",
  device_name_too_long: { key: "apiDeviceNameTooLong", params: ["max"], fallback: "apiInvalidDeviceName" },
  invalid_node_id: "apiUnknownLocation",
  unknown_location: "locationGone",
  location_paused: "apiLocationPaused",
  location_upgrading: city("apiLocationUpgrading"),
  location_full: city("apiLocationFull"),
  node_unavailable: city("apiNodeUnavailable"),
  device_limit_reached: { key: "apiDeviceLimit", params: ["max"], fallback: "apiDeviceLimitReached" },
  device_not_found: "apiDeviceNotFound",
  device_locked: "apiDeviceLocked",
  unknown_setting: SETTINGS,
  setting_not_boolean: SETTINGS,
  invalid_port: SETTINGS,
  invalid_multihop_entry: SETTINGS,
  dns_not_object: SETTINGS,
  unknown_dns_list: SETTINGS,
  dns_lists_coupled: "apiDnsCoupled",
  port_forwarding_unavailable: { key: "apiPortForwardingUnavailable", params: ["city"], fallback: "apiPortForwardingUnavailableGeneric" },
  port_forward_limit_reached: { key: "apiPortForwardLimit", params: ["max"], fallback: "apiPortForwardLimitGeneric" },
  port_forwarding_full: { key: "apiPortForwardingFull", params: ["city"], fallback: "apiPortForwardingUnavailableGeneric" },
  port_forward_not_found: "apiPortForwardNotFound",
  invalid_local_port: "apiLocalPortInvalid",
  local_port_unsupported: { key: "apiLocalPortUnsupported", params: ["city"], fallback: "apiLocalPortUnsupportedGeneric" },
  tor_unavailable: { key: "apiTorUnavailable", params: ["city"], fallback: "apiTorUnavailableGeneric" },
  invalid_proxy: BAD_REQUEST,
  proxy_limit_reached: { key: "apiProxyLimit", params: ["max"], fallback: "apiProxyLimitGeneric" },
  proxy_unavailable: { key: "apiProxyUnavailable", params: ["city"], fallback: "apiProxyUnavailableGeneric" },
  proxy_ports_full: { key: "apiProxyPortsFull", params: ["city"], fallback: "apiProxyUnavailableGeneric" },
  proxy_not_found: "apiProxyNotFound",
  tickets_unavailable: "apiTicketsUnavailable",
  invalid_ciphertext: "apiInvalidCiphertext",
  unknown_ticket_key: "apiUnknownTicketKey",
  ticket_limit_reached: { key: "apiTicketLimit", params: ["max"], fallback: "apiTicketLimitGeneric" },
  ticket_closed: "apiTicketClosed",
  ticket_full: { key: "apiTicketFull", params: ["max"], fallback: "apiTicketFullGeneric" },
  ticket_changed: "apiTicketChanged",
  ticket_reopen_expired: { key: "apiTicketReopenExpired", params: ["days"], fallback: "apiTicketReopenExpiredGeneric" },
  tickets_blocked: "apiTicketsBlocked",
};

const SESSION_ENDED = new Set(["unauthorized", "account_not_found"]);

const STATUS_MESSAGES: Record<number, ErrorKey> = {
  401: "apiSessionExpired",
  403: "apiForbidden",
  404: "apiNotFound",
  409: "apiConflict",
  429: "apiRateLimited",
};

export type ApiErrorPayload = {
  code?: string;
  error?: string;
  params?: Record<string, string | number>;
};

export type DescribedApiError = {
  message: string | LocalizedMessage;
  code: ErrorCode;
  apiCode?: string;
  serverMessage?: string;
};

export function parseApiErrorPayload(body: unknown): ApiErrorPayload | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { code, error, params } = body as Record<string, unknown>;
  const payload: ApiErrorPayload = {};
  if (typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(code)) payload.code = code;
  if (typeof error === "string" && error.length <= 500) payload.error = error;
  if (typeof params === "object" && params !== null && !Array.isArray(params)) {
    payload.params = Object.fromEntries(
      Object.entries(params).filter(
        (entry): entry is [string, string | number] =>
          (typeof entry[1] === "string" && entry[1].length <= 200) || (typeof entry[1] === "number" && Number.isFinite(entry[1])),
      ),
    );
  }
  return payload;
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function isKnownApiCode(code: string | undefined): code is string {
  return code !== undefined && hasOwn(API_ERROR_MESSAGES, code);
}

export function errorCodeFor(status: number, apiCode?: string): ErrorCode {
  if (apiCode === "rate_limited") return "rate_limited";
  if (apiCode === "totp_required") return "totp_required";
  if (apiCode === "totp_invalid") return "invalid";
  if (apiCode !== undefined && SESSION_ENDED.has(apiCode)) return "unauthorized";
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "invalid";
}

export function endsSession(status: number | null, apiCode?: string): boolean {
  if (status === null) return false;
  return apiCode !== undefined ? SESSION_ENDED.has(apiCode) : status === 401;
}

export function statusMessage(status: number): LocalizedMessage {
  const key = STATUS_MESSAGES[status];
  if (key) return { key };
  return status >= 400 && status < 500 ? { key: BAD_REQUEST, params: { status } } : { key: "apiServerStatus", params: { status } };
}

function usableParam(value: unknown): value is string | number {
  return (typeof value === "string" && value.length > 0 && value.length <= 100) || (typeof value === "number" && Number.isFinite(value));
}

function knownMessage(code: string, status: number, serverParams: Record<string, unknown>): LocalizedMessage {
  if (code === "rate_limited") {
    const seconds = serverParams.retryAfterSeconds;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return { key: "apiRateLimited" };
    if (seconds <= 60) return { key: "apiRateLimitedMinute" };
    const minutes = Math.ceil(seconds / 60);
    return minutes <= 90 ? { key: "apiRateLimitedMinutes", params: { minutes } } : { key: "apiRateLimitedHours", params: { hours: Math.ceil(seconds / 3600) } };
  }
  const entry = API_ERROR_MESSAGES[code];
  if (entry === undefined) return statusMessage(status);
  if (typeof entry === "string") return entry === BAD_REQUEST ? { key: entry, params: { status } } : { key: entry };
  const params: Params = {};
  for (const name of entry.params) {
    const value = serverParams[name];
    if (!usableParam(value)) return { key: entry.fallback };
    params[name] = value;
  }
  return { key: entry.key, params };
}

export function describeApiError(status: number, payload: ApiErrorPayload | null, options: { debug?: boolean } = {}): DescribedApiError {
  const apiCode = payload?.code;
  const serverMessage = payload?.error;
  const base = { code: errorCodeFor(status, apiCode), ...(apiCode ? { apiCode } : {}), ...(serverMessage ? { serverMessage } : {}) };
  if (isKnownApiCode(apiCode)) return { ...base, message: knownMessage(apiCode, status, payload?.params ?? {}) };
  if (apiCode === undefined && serverMessage) return { ...base, message: serverMessage };
  const generic = statusMessage(status);
  if (options.debug && (apiCode || serverMessage)) {
    return {
      ...base,
      message: { key: "apiServerDetail", params: { message: generic, code: apiCode ?? "–", detail: serverMessage ?? "–" } },
    };
  }
  return { ...base, message: generic };
}
