import { EyeSlashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { OBFUSCATION_MODES, type MantelBridge, type ObfuscationMode, type Preferences } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";
import { InlineError, Segmented } from "./primitives";

export function ObfuscationSettingRow({
  bridge,
  preferences,
  onPreferences,
}: {
  bridge: MantelBridge;
  preferences: Preferences;
  onPreferences: (next: Preferences) => void;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setObfuscation = bridge.setObfuscation;
  if (!setObfuscation) return null;

  const change = async (mode: ObfuscationMode) => {
    if (pending || mode === (preferences.obfuscation ?? "auto")) return;
    setPending(true);
    setError(null);
    onPreferences({ ...preferences, obfuscation: mode });
    const result = await setObfuscation(mode).catch(() => null);
    setPending(false);
    if (result?.ok) onPreferences(result.value);
    else {
      onPreferences(preferences);
      setError(result ? result.error : t.save.failed);
    }
  };

  return <ObfuscationSettingView mode={preferences.obfuscation ?? "auto"} error={error} onChange={(mode) => void change(mode)} />;
}

export function ObfuscationSettingView({
  mode,
  error,
  onChange,
}: {
  mode: ObfuscationMode;
  error: string | null;
  onChange: (mode: ObfuscationMode) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2.5 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 android:min-h-16">
      <div className="min-w-0">
        <p className="text-[14px] text-ink">{t.settings.obfuscation}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{t.settings.obfuscationDescription}</p>
        <InlineError message={error} className="mt-1.5" />
      </div>
      <Segmented
        label={t.settings.obfuscation}
        layoutId="obfuscation-mode"
        className="w-full shrink-0 sm:w-[184px]"
        value={mode}
        onChange={onChange}
        options={OBFUSCATION_MODES.map((value) => ({ value, label: t.settings.obfuscationModes[value] }))}
      />
    </div>
  );
}

export function ObfuscatedBadge({ obfuscated, className }: { obfuscated: boolean | undefined; className?: string }) {
  const { t } = useI18n();
  if (!obfuscated) return null;
  return (
    <p className={cn("flex", className)}>
      <span
        title={t.home.obfuscatedTooltip}
        className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[11.5px] font-medium text-zinc-600"
      >
        <EyeSlashIcon weight="bold" className="size-3.5" />
        {t.home.obfuscated}
      </span>
    </p>
  );
}
