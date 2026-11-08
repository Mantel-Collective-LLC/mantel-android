import { BugIcon } from "@phosphor-icons/react";
import type { Preferences } from "@shared/contract";
import { useI18n } from "@renderer/i18n/context";
import { openDebugScreen } from "./events";
import { debugStrings } from "./strings";

export function DebugLoginFooter({ preferences }: { preferences: Preferences }) {
  const { language } = useI18n();
  const texts = debugStrings(language);
  return (
    <div className="rounded-2xl border border-dashed border-amber-300/80 bg-amber-50/40 p-4">
      <p className="text-[13px] text-zinc-600">{texts.server.debugLabel}</p>
      <p data-testid="debug-server-url" className="mt-1 break-all font-mono text-[12.5px] text-ink">
        {preferences.baseUrl}
      </p>
      <button
        type="button"
        onClick={openDebugScreen}
        className="mt-2 flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-amber-800 hover:text-ink"
      >
        <BugIcon className="size-4" />
        {texts.server.openDebug}
      </button>
    </div>
  );
}
