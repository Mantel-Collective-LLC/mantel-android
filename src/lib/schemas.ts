import { z } from "zod";
import { BLOCKLIST_IDS, LOCATION_STATUSES, LOGIN_CLIENTS, LOGIN_METHODS, OBFUSCATION_MODES, PORT_FORWARD_REASONS, TOR_AVAILABILITIES } from "@shared/contract";
import { PROXY_EXITS, PROXY_PROTOCOLS, PROXY_STATUSES, proxyFieldsConsistent } from "@shared/proxy";
import { isIpLiteral, isValidCidr } from "./ip";
import { isWireGuardKey, parseEndpoint } from "./wireguard-config";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const isoDate = z.string().max(40).refine((value) => !Number.isNaN(Date.parse(value)), "Ungültiges Datum");
const wgKey = z.string().refine(isWireGuardKey, "Ungültiger WireGuard-Schlüssel");
const ipLiteral = z.string().max(45).refine(isIpLiteral, "Ungültige IP-Adresse");
const addressWithOptionalPrefix = z
  .string()
  .max(49)
  .refine((value) => (value.includes("/") ? isValidCidr(value) : isIpLiteral(value)), "Ungültige Adresse");
const hostOrIp = z
  .string()
  .max(253)
  .refine((value) => parseEndpoint(value.includes(":") ? `[${value}]:1` : `${value}:1`) !== null, "Ungültiger Host");

const dnsBlocklists = z.object(
  Object.fromEntries(BLOCKLIST_IDS.map((id) => [id, z.boolean()])) as Record<(typeof BLOCKLIST_IDS)[number], z.ZodBoolean>,
);

export const settingsSchema = z.object({
  killSwitch: z.boolean(),
  lanAccess: z.boolean(),
  ipv6: z.boolean(),
  dns: dnsBlocklists,
});

export const settingsPatchSchema = z
  .object({
    killSwitch: z.boolean().optional(),
    lanAccess: z.boolean().optional(),
    ipv6: z.boolean().optional(),
    dns: dnsBlocklists.partial().strict().optional(),
  })
  .strict();

const obfsToken = z.string().regex(/^[A-Za-z0-9._~+/=-]{16,256}$/);

const obfuscationSchema = z
  .object({
    version: z.number().int(),
    port: z.number().int().min(1).max(65535),
    pin: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  })
  .transform((value) => (value.version === 1 ? value : undefined));

export const deviceSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(64),
  nodeId: identifier,
  ipv4: ipLiteral,
  ipv6: ipLiteral.optional().nullable().transform((value) => value ?? undefined),
  createdOn: isoDate,
  keyRotatedOn: isoDate.optional().nullable().catch(undefined).transform((value) => value ?? undefined),
  obfsToken: obfsToken.optional().catch(undefined),
  tor: z.boolean().optional().catch(undefined),
  torSocks: z.string().max(64).regex(/^[0-9A-Za-z.:[\]-]+$/).nullable().optional().catch(null),
});

export const accountSchema = z.object({
  id: identifier,
  paidUntil: isoDate,
  graceUntil: isoDate.optional().nullable().transform((value) => value ?? undefined),
  noTimeYet: z.boolean().optional().catch(undefined),
  settings: settingsSchema,
  devices: z
    .array(deviceSchema.extend({ nodeId: identifier.nullable() }))
    .max(100)
    .transform((devices) =>
      devices.flatMap((device) => (device.nodeId === null ? [] : [{ ...device, nodeId: device.nodeId }])),
    ),
});

export const loginSchema = z.object({
  token: z.string().min(16).max(512).regex(/^[A-Za-z0-9._~+/=-]+$/),
  account: z.object({ id: identifier, paidUntil: isoDate }),
});

export const registerSchema = loginSchema.extend({
  code: z.string().regex(/^\d{16}$/),
  referralDays: z.number().int().min(1).max(3650).optional(),
});

export const nodeSchema = z.object({
  id: identifier,
  city: z.string().min(1).max(64),
  country: z.string().regex(/^[A-Z]{2}$/),
  endpointHost: hostOrIp,
  endpointPort: z.number().int().min(1).max(65535),
  online: z.boolean(),
  latencyMs: z.number().int().min(0).max(10_000).optional().nullable().transform((value) => value ?? undefined),
  pingPort: z.number().int().min(1).max(65535).optional().catch(undefined),
  postQuantum: z.boolean().optional().default(false),
  portForwarding: z.boolean().optional().catch(undefined),
  obfuscation: obfuscationSchema.optional().catch(undefined),
  status: z.enum(LOCATION_STATUSES).optional().catch(undefined),
  tor: z.enum(TOR_AVAILABILITIES).optional().catch("unavailable"),
  serverPublicKey: wgKey.optional().catch(undefined),
});

export const portForwardingSchema = z.object({
  deviceId: identifier,
  nodeId: identifier,
  city: z.string().min(1).max(64),
  available: z.boolean(),
  reason: z.enum(PORT_FORWARD_REASONS).nullable().catch("unsupported"),
  max: z.number().int().min(1).max(16),
  localPort: z.boolean().catch(false),
  forwards: z
    .array(
      z.object({
        port: z.number().int().min(1024).max(65535),
        host: hostOrIp,
        localPort: z.number().int().min(1).max(65535).nullable().catch(null),
      }),
    )
    .max(16),
});

export const nodesSchema = z.array(nodeSchema).max(500);

export const serverProxySchema = z.object({
  id: identifier,
  name: z.string().min(1).max(64),
  nodeId: identifier,
  host: hostOrIp,
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(PROXY_PROTOCOLS),
  exit: z.enum(PROXY_EXITS),
  username: z.string().max(64),
  enabled: z.boolean(),
  status: z.enum(PROXY_STATUSES).catch("unavailable"),
  secret: z.string().max(200).optional(),
  link: z.string().max(400).optional(),
  webLink: z.string().max(400).optional(),
}).refine(proxyFieldsConsistent);

export const proxyListSchema = z.object({
  proxies: z
    .array(z.unknown())
    .max(100)
    .transform((entries) =>
      entries.flatMap((entry) => {
        const parsed = serverProxySchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});

export const proxyWithPasswordSchema = z.object({
  proxy: serverProxySchema,
  password: z.string().min(1).max(128).optional(),
});

export const loginsSchema = z.object({
  logins: z
    .array(z.object({ client: z.enum(LOGIN_CLIENTS).catch("app"), method: z.enum(LOGIN_METHODS).catch("code") }))
    .max(50),
});

export const tunnelConfigSchema = z.object({
  address: z.array(addressWithOptionalPrefix).min(1).max(4),
  dns: z.array(ipLiteral).min(1).max(4),
  serverPublicKey: wgKey,
  presharedKey: wgKey.optional().nullable().transform((value) => value ?? undefined),
  endpoint: z.string().max(260).refine((value) => parseEndpoint(value) !== null, "Ungültiger Endpunkt"),
  allowedIps: z.array(z.string().max(49)).max(64),
  mtu: z.number().int().min(1280).max(1500).optional().nullable().transform((value) => value ?? undefined),
});

export const registerDeviceSchema = z.object({
  device: deviceSchema,
  config: tunnelConfigSchema,
  privateKey: wgKey.optional().nullable().transform((value) => value ?? undefined),
});

export const errorSchema = z.object({
  code: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .optional()
    .catch(undefined),
  error: z.string().max(500).optional().catch(undefined),
  params: z
    .record(z.string().max(40), z.union([z.string().max(200), z.number()]))
    .optional()
    .catch(undefined),
});

export const accountCodeSchema = z.string().regex(/^\d{16}$/);

export const totpInputSchema = z.string().regex(/^[0-9A-Za-z -]{1,40}$/).nullish();

export const referralInputSchema = z.string().regex(/^[0-9A-Za-z -]{1,40}$/).nullish();

export const nodeIdSchema = identifier;

export const deviceIdSchema = identifier;

export const deviceNameSchema = z.string().max(256).transform((value) => value.trim()).pipe(z.string().min(1).max(64));

export const forwardPortSchema = z.number().int().min(1024).max(65535);

export const localPortSchema = z.number().int().min(1).max(65535).nullable();

export const baseUrlSchema = z
  .string()
  .max(2048)
  .transform((value, context) => {
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
      if (url.username || url.password || url.search || url.hash) throw new Error("extras");
      return `${url.protocol}//${url.host}`;
    } catch {
      context.addIssue({ code: "custom", message: "Ungültige Server-Adresse" });
      return z.NEVER;
    }
  });

export type RegisterDeviceResponse = z.infer<typeof registerDeviceSchema>;

export const MAX_EXCLUDED_APPS = 500;

export const packageNameSchema = z
  .string()
  .max(255)
  .regex(/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/);

export const excludedAppsSchema = z
  .array(packageNameSchema)
  .max(MAX_EXCLUDED_APPS * 2)
  .transform((packages) => [...new Set(packages)].sort())
  .refine((packages) => packages.length <= MAX_EXCLUDED_APPS, "Zu viele Apps");

export const storedSessionSchema = z.object({
  token: loginSchema.shape.token.nullable(),
  accountId: identifier.nullable(),
  paidUntil: isoDate.nullable(),
});

export const storedDeviceKeysSchema = z.object({
  privateKey: wgKey,
  presharedKey: wgKey.nullable(),
  pendingKey: z.object({ publicKey: wgKey, privateKey: wgKey }).nullable().optional().catch(undefined),
});

export const storedDeviceMetaSchema = z.object({
  id: identifier,
  nodeId: identifier,
  publicKey: wgKey.nullable(),
  keySource: z.enum(["local", "server"]),
  config: tunnelConfigSchema.omit({ presharedKey: true }),
  keyCreatedAt: z.number().finite().optional().catch(undefined),
});

export const storedPreferencesSchema = z.object({
  baseUrl: baseUrlSchema,
  lastNodeId: identifier.nullable(),
  postQuantum: z.boolean().optional(),
});

export const storedRuntimeSchema = z.object({
  nodeId: identifier,
  label: z.string().max(64),
  addresses: z.array(z.string().max(49)).max(8),
  dns: z.array(z.string().max(45)).max(8),
  endpoint: z.string().max(260).nullable(),
  leakProtection: z.enum(["wireguard", "firewall", "none"]),
});

export const storedPendingRegistrationSchema = z.object({
  code: z.string().regex(/^\d{16}$/),
  token: loginSchema.shape.token,
  accountId: identifier,
  paidUntil: isoDate,
});

export const storedDeviceIdsSchema = z.array(identifier).max(32);

export const storedSystemVpnSchema = z.object({
  alwaysOn: z.boolean(),
  lockdown: z.boolean(),
});

export const obfuscationModeSchema = z.enum(OBFUSCATION_MODES);

export const appIconSchema = z.enum(["default", "calculator"]);
