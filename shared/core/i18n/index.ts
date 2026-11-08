import de from "./de.json";
import enJson from "./en.json";

export type Dictionary = typeof de;

const en: Dictionary = enJson;

export const LANGUAGES = ["de", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_PREFERENCES = ["system", ...LANGUAGES] as const;
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];

export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference = "en";

export const DICTIONARIES: Record<Language, Dictionary> = { de, en };

export const LANGUAGE_NAMES: Record<Language, string> = { de: "Deutsch", en: "English" };

const FALLBACK_LOCALES: Record<Language, string> = { de: "de-DE", en: "en-GB" };

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return typeof value === "string" && (LANGUAGE_PREFERENCES as readonly string[]).includes(value);
}

export function languageOfLocale(tag: string | null | undefined): Language {
  return typeof tag === "string" && /^de(?:[-_]|$)/i.test(tag.trim()) ? "de" : "en";
}

export function resolveLanguage(preference: LanguagePreference | null | undefined): Language {
  return isLanguage(preference) ? preference : "en";
}

function canonicalLocale(tag: string | null | undefined): string | null {
  if (!tag) return null;
  try {
    return Intl.getCanonicalLocales(tag.trim().replace(/_/g, "-"))[0] ?? null;
  } catch {
    return null;
  }
}

export function intlLocale(language: Language, systemLocale?: string | null): string {
  const canonical = canonicalLocale(systemLocale);
  if (canonical && languageOfLocale(canonical) === language && canonical.toLowerCase().startsWith(language)) {
    return canonical;
  }
  return FALLBACK_LOCALES[language];
}

export type ErrorKey = keyof Dictionary["errors"];

export type LocalizedMessage = { key: ErrorKey; params?: Params };

export type Params = Record<string, string | number | LocalizedMessage>;

export type PluralForms = { one: string; other: string };

function isLocalizedMessage(value: unknown): value is LocalizedMessage {
  if (typeof value !== "object" || value === null) return false;
  const key = (value as { key?: unknown }).key;
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(de.errors, key);
}

export function format(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export function plural(
  language: Language,
  forms: PluralForms,
  count: number,
  params: Record<string, string | number> = {},
): string {
  const category = new Intl.PluralRules(language).select(count);
  return format(category === "one" ? forms.one : forms.other, { count, ...params });
}

export function translate(language: Language, message: LocalizedMessage): string {
  const template = DICTIONARIES[language].errors[message.key] ?? de.errors[message.key] ?? message.key;
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(message.params ?? {})) {
    params[name] = isLocalizedMessage(value) ? translate(language, value) : value;
  }
  return format(template, params);
}

export class LocalizedError extends Error {
  readonly i18n: LocalizedMessage;

  constructor(key: ErrorKey, params?: Params, options?: { cause?: unknown }) {
    const i18n: LocalizedMessage = params ? { key, params } : { key };
    super(translate("de", i18n), options);
    this.i18n = i18n;
  }
}

export function localizedOf(error: unknown): LocalizedMessage | null {
  if (typeof error !== "object" || error === null) return null;
  const i18n = (error as { i18n?: unknown }).i18n;
  return isLocalizedMessage(i18n) ? i18n : null;
}

export function errorMessage(error: unknown, language: Language): string {
  const localized = localizedOf(error);
  if (localized) return translate(language, localized);
  if (error instanceof Error && error.message) return error.message;
  return DICTIONARIES[language].errors.unknown;
}

export type Translator = {
  language: Language;
  locale: string;
  t: Dictionary;
  format: (template: string, params?: Record<string, string | number>) => string;
  plural: (forms: PluralForms, count: number, params?: Record<string, string | number>) => string;
  error: (error: unknown) => string;
};

export function createTranslator(language: Language, systemLocale?: string | null): Translator {
  return {
    language,
    locale: intlLocale(language, systemLocale),
    t: DICTIONARIES[language],
    format,
    plural: (forms, count, params) => plural(language, forms, count, params),
    error: (error) => errorMessage(error, language),
  };
}
