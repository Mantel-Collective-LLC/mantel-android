import { createContext, useContext, type ReactNode } from "react";
import {
  createTranslator,
  resolveLanguage,
  type LanguagePreference,
  type Translator,
} from "../../../core/i18n";

const I18nContext = createContext<Translator | null>(null);

export function I18nProvider({ translator, children }: { translator: Translator; children: ReactNode }) {
  return <I18nContext value={translator}>{children}</I18nContext>;
}

export function useI18n(): Translator {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>.");
  return value;
}

export function browserLocales(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

export function translatorFor(preference: LanguagePreference | undefined, environment: { systemLocale?: string } | null): Translator {
  return createTranslator(resolveLanguage(preference), environment?.systemLocale ?? browserLocales()[0]);
}
