import { motion } from "motion/react";
import { useState } from "react";
import { ArrowClockwiseIcon, ShieldCheckIcon, WrenchIcon } from "@phosphor-icons/react";
import type { Environment, MantelBridge } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { Button, InlineError, SPRING } from "../ui/primitives";

export function MacHelperScreen({
  bridge,
  environment,
  onRetry,
}: {
  bridge: MantelBridge;
  environment: Environment;
  onRetry: () => Promise<void>;
}) {
  const { t } = useI18n();
  const m = t.mac;
  const facts = [
    { label: m.helperLocation, value: environment.wireguardPath ?? "/Library/PrivilegedHelperTools" },
    { label: m.helperContains, value: m.helperContainsValue },
    { label: m.helperRights, value: m.helperRightsValue },
  ];
  const [installing, setInstalling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const install = async () => {
    setError(null);
    setInstalling(true);
    const result = await bridge.installWireGuard();
    if (result.ok) {
      await onRetry();
    } else {
      setError(result.error);
    }
    setInstalling(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="flex min-h-full flex-col px-6 pb-6 pt-8"
      data-testid="mac-helper-setup"
    >
      <p className="text-xs font-medium text-zinc-400">{m.helperEyebrow}</p>
      <h1 className="mt-3 text-[30px] font-medium leading-[1.05] tracking-[-0.04em] text-balance">{m.helperTitle}</h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-zinc-600">{m.helperBody}</p>

      <dl className="mt-6 divide-y divide-zinc-200/70 rounded-2xl border border-zinc-200/80 bg-surface text-[13px]">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="shrink-0 text-zinc-500">{fact.label}</dt>
            <dd className="min-w-0 truncate text-right font-medium text-ink" title={fact.value}>
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-relaxed text-zinc-500">
        <ShieldCheckIcon weight="fill" className="mt-0.5 size-4 shrink-0 text-accent-strong" />
        {m.helperNote}
      </p>

      <div className="mt-auto space-y-2 pt-8">
        <InlineError message={error} className="pb-1" />
        <Button size="lg" className="w-full" pending={installing} onClick={install}>
          {!installing && <WrenchIcon weight="bold" className="size-4" />}
          {installing ? m.helperInstalling : m.helperInstall}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="w-full"
          pending={checking}
          disabled={installing}
          onClick={async () => {
            setChecking(true);
            await onRetry();
            setChecking(false);
          }}
        >
          {!checking && <ArrowClockwiseIcon weight="bold" className="size-3.5" />}
          {m.helperRetry}
        </Button>
      </div>
    </motion.div>
  );
}
