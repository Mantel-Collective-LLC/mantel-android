import { AnimatePresence, motion } from "motion/react";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BugIcon, XIcon } from "@phosphor-icons/react";
import type { Environment, Preferences } from "@shared/contract";
import { I18nProvider, translatorFor } from "@renderer/i18n/context";
import { DEBUG_OPEN_EVENT } from "./events";
import { DebugScreen, type DebugTools } from "./screen";
import { debugStrings } from "./strings";

function DebugOverlay({ tools }: { tools: DebugTools }) {
  const [open, setOpen] = useState(false);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);

  const refresh = useCallback(async () => {
    const [env, prefs] = await Promise.all([tools.bridge.environment(), tools.bridge.preferences()]);
    setEnvironment(env);
    setPreferences(prefs);
  }, [tools.bridge]);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const onOpen = () => {
      void refresh().catch(() => undefined);
      setOpen(true);
    };
    window.addEventListener(DEBUG_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(DEBUG_OPEN_EVENT, onOpen);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onBack = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("mantel:back", onBack, { capture: true });
    return () => window.removeEventListener("mantel:back", onBack, { capture: true });
  }, [open]);

  const i18n = useMemo(() => translatorFor(preferences?.language, environment), [preferences?.language, environment]);
  const texts = debugStrings(i18n.language).debug;

  return (
    <I18nProvider translator={i18n}>
      {!open && (
        <button
          type="button"
          onClick={() => {
            void refresh().catch(() => undefined);
            setOpen(true);
          }}
          aria-label={texts.open}
          data-testid="debug-badge"
          className="fixed right-[calc(env(safe-area-inset-right)+16px)] top-[calc(env(safe-area-inset-top)+14px)] z-40 inline-flex h-7 items-center gap-1 rounded-full bg-amber-400 px-2.5 font-mono text-[11px] font-semibold tracking-[0.12em] text-amber-950 shadow-sm dark:bg-amber-500 dark:text-on-ink active:scale-[0.97]"
        >
          <BugIcon weight="bold" className="size-3.5" />
          {texts.badge}
        </button>
      )}
      <AnimatePresence>
        {open && preferences && (
          <motion.div
            key="debug"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-0 z-50 flex flex-col bg-canvas pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]"
            role="dialog"
            aria-modal="true"
            aria-label={texts.title}
          >
            <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex h-6 items-center rounded-full bg-amber-400 px-2 font-mono text-[10.5px] font-semibold tracking-[0.12em] text-amber-950 dark:bg-amber-500 dark:text-on-ink">
                  {texts.badge}
                </span>
                <h1 className="text-[17px] font-medium tracking-[-0.02em]">{texts.title}</h1>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={texts.close}
                className="-mr-2 grid size-11 place-items-center rounded-xl text-zinc-600 hover:bg-zinc-100 hover:text-ink"
              >
                <XIcon weight="bold" className="size-5" />
              </button>
            </header>
            <p className="px-5 pb-3 text-[12.5px] text-zinc-500">{texts.subtitle}</p>
            <main className="scroll-area min-h-0 flex-1 px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
              <DebugScreen
                tools={tools}
                preferences={preferences}
                onPreferences={setPreferences}
                onClose={() => setOpen(false)}
              />
            </main>
          </motion.div>
        )}
      </AnimatePresence>
    </I18nProvider>
  );
}

export function mountDebugOverlay(tools: DebugTools): void {
  const container = document.createElement("div");
  container.id = "mantel-debug";
  document.body.appendChild(container);
  createRoot(container).render(
    <StrictMode>
      <DebugOverlay tools={tools} />
    </StrictMode>,
  );
}
