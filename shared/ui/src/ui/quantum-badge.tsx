import { AtomIcon } from "@phosphor-icons/react";
import { createContext, useContext } from "react";
import type { QuantumState, VpnNode } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";

export function QuantumBadge({ quantum, className }: { quantum: QuantumState | undefined; className?: string }) {
  const { t } = useI18n();
  if (quantum !== "active" && quantum !== "negotiating") return null;
  const active = quantum === "active";
  return (
    <p className={cn("flex", className)}>
      <span
        title={active ? t.pq.badgeTooltip : undefined}
        aria-live="polite"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium",
          active ? "bg-accent-soft text-accent-strong" : "bg-zinc-100 text-zinc-500",
        )}
      >
        <AtomIcon weight="bold" className={cn("size-3.5", !active && "animate-pulse")} />
        {active ? t.pq.badge : t.pq.negotiating}
      </span>
    </p>
  );
}

export const QuantumRequired = createContext(false);

export function NoQuantumHint({ node, required }: { node: VpnNode; required?: boolean }) {
  const { t } = useI18n();
  const fromContext = useContext(QuantumRequired);
  if (!(required ?? fromContext) || node.postQuantum === true) return null;
  return <span className="block truncate text-[11px] text-amber-700">{t.pq.withoutPq}</span>;
}
