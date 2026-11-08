const ACCOUNT_CODE = /(?<!\d)\d{4}([ -]?)\d{4}\1\d{4}\1\d{4}(?!\d)/g;
const WIREGUARD_KEY = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=(?![A-Za-z0-9+/=])/g;
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const SECRET_FIELDS = /("(?:token|code|privateKey|presharedKey|password|authorization)"\s*:\s*)"[^"]*"/gi;

export const REDACTED = "[redacted]";

export function redact(text: string, secrets: readonly string[] = []): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length >= 8) result = result.split(secret).join(REDACTED);
  }
  return result
    .replace(SECRET_FIELDS, `$1"${REDACTED}"`)
    .replace(BEARER, `$1${REDACTED}`)
    .replace(WIREGUARD_KEY, "[key]")
    .replace(ACCOUNT_CODE, "[account code]");
}

export function shortId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.length <= 6 ? id : `${id.slice(0, 6)}…`;
}
