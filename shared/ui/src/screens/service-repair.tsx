import { motion } from "motion/react";
import { useState } from "react";
import { ArrowClockwiseIcon, WrenchIcon } from "@phosphor-icons/react";
import type { MantelBridge } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { Button, InlineError, SPRING } from "../ui/primitives";

export function ServiceRepairScreen({ bridge, onRetry }: { bridge: MantelBridge; onRetry: () => Promise<void> }) {
  const { t } = useI18n();
  const w = t.wireguard;
  const [repairing, setRepairing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repair = async () => {
    setError(null);
    setRepairing(true);
    const result = await bridge.installWireGuard();
    if (result.ok) await onRetry();
    else setError(result.error);
    setRepairing(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="flex min-h-full flex-col px-6 pb-6 pt-8"
      data-testid="service-repair"
    >
      <p className="text-xs font-medium text-zinc-400">{w.serviceEyebrow}</p>
      <h1 className="mt-3 text-[30px] font-medium leading-[1.05] tracking-[-0.04em] text-balance">{w.serviceTitle}</h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-zinc-600">{w.serviceBody}</p>
      <div className="mt-auto space-y-2 pt-8">
        <InlineError message={error} className="pb-1" />
        <Button size="lg" className="w-full" pending={repairing} onClick={repair}>
          {!repairing && <WrenchIcon weight="bold" className="size-4" />}
          {repairing ? w.serviceRepairing : w.serviceRepair}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="w-full"
          pending={checking}
          disabled={repairing}
          onClick={async () => {
            setChecking(true);
            await onRetry();
            setChecking(false);
          }}
        >
          {!checking && <ArrowClockwiseIcon weight="bold" className="size-3.5" />}
          {w.retry}
        </Button>
      </div>
    </motion.div>
  );
}
