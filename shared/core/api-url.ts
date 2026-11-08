export type BuildFlavor = "prod" | "debug";

export const DEBUG_API_URL = {
  desktop: "http://localhost:3000",
  android: "http://10.0.2.2:3000",
} as const;

export function resolveApiUrl(
  flavor: BuildFlavor,
  value: string | undefined | null,
  options: { debugDefault: string; strict: boolean },
): string {
  const raw = (value ?? "").trim();
  if (raw === "") {
    if (flavor === "prod" && options.strict) {
      throw new Error(
        "MANTEL_API_URL fehlt: prod-Builds brauchen die Adresse der eigenen API, z. B. MANTEL_API_URL=https://api.example.org",
      );
    }
    return new URL(options.debugDefault).origin;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`MANTEL_API_URL="${raw}" ist keine gültige Adresse.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`MANTEL_API_URL="${raw}": nur http:// oder https:// ist erlaubt.`);
  }
  if (flavor === "prod" && url.protocol !== "https:") {
    throw new Error(`MANTEL_API_URL="${raw}": prod-Builds sprechen nur HTTPS.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`MANTEL_API_URL="${raw}": keine Zugangsdaten, Parameter oder Anker.`);
  }
  return url.origin;
}
