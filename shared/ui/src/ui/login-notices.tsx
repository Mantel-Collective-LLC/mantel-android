import { motion } from "motion/react";
import { useId, useState } from "react";
import {
  AndroidLogoIcon,
  AppleLogoIcon,
  ArrowSquareOutIcon,
  BrowserIcon,
  DeviceMobileIcon,
  FingerprintIcon,
  ShieldWarningIcon,
  SignOutIcon,
  TerminalWindowIcon,
  WindowsLogoIcon,
} from "@phosphor-icons/react";
import type { LoginClient, MantelBridge, PendingLogin } from "../../../core/contract";
import type { Translator } from "../../../core/i18n";
import { useI18n } from "../i18n/context";
import type { LoginNotices } from "../lib/logins";
import { ConfirmSheet } from "../screens/settings-overview";
import { Button, Card, InlineError, SPRING } from "./primitives";

const ICONS: Record<LoginClient, typeof BrowserIcon> = {
  browser: BrowserIcon,
  windows: WindowsLogoIcon,
  macos: AppleLogoIcon,
  android: AndroidLogoIcon,
  cli: TerminalWindowIcon,
  app: DeviceMobileIcon,
};

export function loginEntry(login: PendingLogin, i18n: Pick<Translator, "t" | "format">): string {
  const { t, format } = i18n;
  return format(t.logins.entry, { client: t.logins.clients[login.client], method: t.logins.methods[login.method] });
}

export function loginSummary(notices: LoginNotices, i18n: Translator): string {
  const { t, format } = i18n;
  if (!notices.overview) return t.logins.loading;
  const count = notices.overview.logins.length;
  if (count === 0) return t.logins.summaryNone;
  return count === 1 ? t.logins.summaryNewOne : format(t.logins.summaryNew, { count });
}

function useAction(run: () => Promise<{ ok: boolean; error?: string }>) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setPending(true);
    setError(null);
    const result = await run();
    setPending(false);
    if (!result.ok) setError(result.error || t.errors.unknown);
    return result.ok;
  };
  return { pending, error, go };
}

export function LoginNoticeBanner({ notices, onReview }: { notices: LoginNotices; onReview: () => void }) {
  const i18n = useI18n();
  const { t, format } = i18n;
  const titleId = useId();
  const confirm = useAction(notices.confirm);
  const logoutOthers = useAction(notices.logoutOthers);
  const logins = notices.overview?.logins ?? [];
  if (logins.length === 0) return null;
  const title =
    logins.length === 1
      ? format(t.logins.bannerOne, { entry: loginEntry(logins[0]!, i18n) })
      : format(t.logins.bannerOther, { count: logins.length, entries: logins.map((login) => loginEntry(login, i18n)).join(", ") });
  return (
    <motion.section
      aria-labelledby={titleId}
      role="status"
      data-testid="login-banner"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
    >
      <div className="flex items-start gap-2.5">
        <ShieldWarningIcon weight="fill" aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-medium text-amber-700">{t.logins.bannerEyebrow}</p>
          <h2 id={titleId} className="mt-0.5 text-[13.5px] font-medium leading-snug text-ink">
            {title}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-600">
            {t.logins.bannerBody}{" "}
            <button
              type="button"
              onClick={onReview}
              className="rounded font-medium text-ink underline decoration-zinc-300 underline-offset-2 hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t.logins.review}
            </button>
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button size="sm" pending={logoutOthers.pending} disabled={confirm.pending} onClick={() => void logoutOthers.go()}>
              {t.logins.logoutOthers}
            </Button>
            <Button size="sm" variant="ghost" pending={confirm.pending} disabled={logoutOthers.pending} onClick={() => void confirm.go()}>
              {t.logins.confirm}
            </Button>
          </div>
          <InlineError message={logoutOthers.error ?? confirm.error} className="mt-2" />
        </div>
      </div>
    </motion.section>
  );
}

function LoginRow({ login }: { login: PendingLogin }) {
  const i18n = useI18n();
  const Icon = ICONS[login.client];
  return (
    <li className="flex min-h-[60px] items-center gap-3.5 px-4 py-2.5">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-700">
        <Icon weight="bold" className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1 text-[15px] tracking-[-0.01em] text-ink">{loginEntry(login, i18n)}</span>
    </li>
  );
}

export function LoginsPage({ bridge, notices }: { bridge: MantelBridge; notices: LoginNotices }) {
  const { t } = useI18n();
  const [sheet, setSheet] = useState(false);
  const [done, setDone] = useState(false);
  const confirm = useAction(notices.confirm);
  const logoutOthers = useAction(notices.logoutOthers);
  const openWeb = useAction(async () => (bridge.openSecurityPage ? bridge.openSecurityPage() : { ok: false }));
  const overview = notices.overview;
  return (
    <div className="space-y-6">
      <header className="px-1 pt-1">
        <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em] text-ink">{t.logins.title}</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-500">{t.logins.description}</p>
      </header>

      <section>
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 className="text-xs font-medium text-zinc-400">{t.logins.listTitle}</h2>
          {overview && overview.logins.length > 0 && (
            <button
              type="button"
              onClick={() => void confirm.go()}
              disabled={confirm.pending}
              className="text-xs font-medium text-zinc-500 transition-colors hover:text-ink disabled:opacity-50"
            >
              {t.logins.confirm}
            </button>
          )}
        </div>
        <Card className="overflow-hidden">
          {!overview ? (
            <p className="px-4 py-5 text-[13px] text-zinc-500">{t.logins.loading}</p>
          ) : overview.logins.length === 0 ? (
            <p className="px-4 py-5 text-[13px] text-zinc-500">{t.logins.empty}</p>
          ) : (
            <ul className="divide-y divide-zinc-100" data-testid="pending-logins">
              {overview.logins.map((login, index) => (
                <LoginRow key={index} login={login} />
              ))}
            </ul>
          )}
        </Card>
        <InlineError message={confirm.error} className="mt-2 px-4" />
      </section>

      {bridge.logoutOtherSessions && (
        <div className="space-y-2">
          <Button variant="secondary" size="lg" className="w-full" icon={<SignOutIcon weight="bold" className="size-4" />} onClick={() => setSheet(true)}>
            {t.logins.logoutOthersConfirm}
          </Button>
          {done && <p className="px-1 text-center text-[12.5px] text-accent-strong">{t.logins.loggedOutOthers}</p>}
        </div>
      )}

      <Card className="px-4 py-4">
        <div className="flex items-start gap-3.5">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-700">
            <FingerprintIcon weight="bold" className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] tracking-[-0.01em] text-ink">{t.logins.passkeysTitle}</h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{t.logins.passkeysBody}</p>
            {bridge.openSecurityPage && (
              <Button size="sm" variant="secondary" className="mt-3" pending={openWeb.pending} onClick={() => void openWeb.go()}>
                {t.logins.openWeb}
                {!openWeb.pending && <ArrowSquareOutIcon weight="bold" aria-hidden className="size-3.5" />}
              </Button>
            )}
            <InlineError message={openWeb.error} className="mt-2" />
          </div>
        </div>
      </Card>

      <ConfirmSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={t.logins.logoutOthersTitle}
        description={t.logins.logoutOthersBody}
        confirmLabel={t.logins.logoutOthersConfirm}
        icon={<SignOutIcon weight="bold" className="size-4" />}
        pending={logoutOthers.pending}
        onConfirm={() =>
          void logoutOthers.go().then((ok) => {
            setSheet(false);
            setDone(ok);
          })
        }
      >
        <InlineError message={logoutOthers.error} className="px-1 pb-2" />
      </ConfirmSheet>
    </div>
  );
}
