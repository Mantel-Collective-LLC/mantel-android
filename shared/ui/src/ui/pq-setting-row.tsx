import { AtomIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { MantelBridge, Preferences } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { Badge, InlineError, Switch } from "./primitives";

export function PqSettingRow({
  bridge,
  preferences,
  onPreferences,
  lockdownHint = false,
}: {
  bridge: MantelBridge;
  preferences: Preferences;
  onPreferences: (next: Preferences) => void;
  lockdownHint?: boolean;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setPostQuantum = bridge.setPostQuantum;
  if (!setPostQuantum) return null;
  const on = preferences.postQuantum === true;

  const change = async (enabled: boolean) => {
    setPending(true);
    setError(null);
    try {
      const result = await setPostQuantum(enabled);
      if (result.ok) onPreferences(result.value);
      else setError(result.error);
    } catch {
      setError(t.save.failed);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-h-[60px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3.5 px-4 py-3">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-700 [&>svg]:size-[18px]">
        <AtomIcon weight="bold" />
      </span>
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[15px] tracking-[-0.01em] text-ink">
        {t.pq.settingLabel}
        <Badge>{t.pq.beta}</Badge>
      </p>
      <div className="shrink-0">
        <Switch label={t.pq.settingSwitch} checked={on} disabled={pending} onChange={(value) => void change(value)} />
      </div>
      <div className="col-span-2 col-start-2 min-w-0">
        <p className="mt-1 text-[12.5px] leading-snug text-zinc-500">{t.pq.settingDescription}</p>
        <p className="mt-1 text-[12px] leading-snug text-zinc-400">{t.pq.reconnectNote}</p>
        {on && lockdownHint && <p className="mt-1.5 text-[12.5px] leading-snug text-amber-700">{t.pq.lockdownHint}</p>}
        <InlineError message={error} className="mt-1.5" />
      </div>
    </div>
  );
}
