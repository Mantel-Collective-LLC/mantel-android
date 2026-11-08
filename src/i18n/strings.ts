import type { Language } from "@shared/i18n";

const de = {
  register: {
    noAccount: "Noch keine Kontonummer?",
    hint: "Wir erzeugen eine zufällige 16-stellige Kontonummer. Name, E-Mail und Passwort brauchst du nicht.",
    submit: "Konto erstellen",
    submitting: "Erstelle Konto",
    rateLimited: "Zu viele neue Konten in kurzer Zeit. Versuch es später erneut.",
    unavailable: "Dieser Server bietet keine Kontoerstellung an.",
    failed: "Das Konto konnte nicht erstellt werden. Versuch es später erneut.",
  },
  reveal: {
    eyebrow: "Konto erstellt",
    title: "Schreib sie dir auf.",
    body: "Diese Nummer siehst du nur jetzt. Speichere sie in einem Passwortmanager oder auf Papier.",
    heading: "Deine Kontonummer",
    codeAriaLabel: "Kontonummer",
    copy: "Kopieren",
    copied: "Kopiert",
    copyFailed: "Kopieren fehlgeschlagen",
    warning:
      "Diese Nummer ist der einzige Weg, dich anzumelden. Wir kennen sie nicht, wir speichern nur einen Hash davon. Geht sie verloren, kann niemand sie wiederherstellen, auch wir nicht.",
    confirm: "Ich habe meine Kontonummer gespeichert",
    continue: "Weiter",
  },
};

export type AndroidStrings = typeof de;

const en: AndroidStrings = {
  register: {
    noAccount: "Don't have an account number yet?",
    hint: "We generate a random 16-digit account number. You don't need a name, email or password.",
    submit: "Create account",
    submitting: "Creating account",
    rateLimited: "Too many new accounts in a short time. Please try again later.",
    unavailable: "This server doesn't offer account creation.",
    failed: "The account could not be created. Please try again later.",
  },
  reveal: {
    eyebrow: "Account created",
    title: "Write it down.",
    body: "This is the only time you'll see this number. Keep it in a password manager or on paper.",
    heading: "Your account number",
    codeAriaLabel: "Account number",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Couldn't copy",
    warning:
      "This number is the only way to log in. We don't know it; we only store a hash of it. If you lose it, nobody can recover it, not even us.",
    confirm: "I've saved my account number",
    continue: "Continue",
  },
};

export const ANDROID_STRINGS: Record<Language, AndroidStrings> = { de, en };

export function androidStrings(language: Language): AndroidStrings {
  return ANDROID_STRINGS[language] ?? de;
}
