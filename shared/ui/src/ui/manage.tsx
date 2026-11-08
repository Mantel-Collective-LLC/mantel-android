import { useEffect, useState, type ReactNode } from "react";
import { AndroidLogoIcon, AppleLogoIcon, CheckIcon, CopyIcon, PlugsIcon, WindowsLogoIcon } from "@phosphor-icons/react";
import type { MantelBridge } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";
import { copyText } from "../lib/clipboard";
import { Button } from "./primitives";

export const FIELD = cn(
  "w-full rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-[14.5px] text-ink placeholder:text-zinc-400",
  "outline-none focus-visible:border-zinc-300 focus-visible:ring-2 focus-visible:ring-accent",
);

export type DeviceKind = "windows" | "macos" | "android" | "other";

export function deviceKind(name: string): DeviceKind {
  if (/^windows\b/i.test(name)) return "windows";
  if (/^macos\b/i.test(name)) return "macos";
  if (/^android\b/i.test(name)) return "android";
  return "other";
}

export function DeviceKindIcon({ kind, className }: { kind: DeviceKind; className?: string }) {
  const Icon = kind === "windows" ? WindowsLogoIcon : kind === "macos" ? AppleLogoIcon : kind === "android" ? AndroidLogoIcon : PlugsIcon;
  return <Icon weight="bold" className={className} aria-hidden />;
}

export function PageHeader({ title, description, aside }: { title: string; description: string; aside?: ReactNode }) {
  return (
    <header className="px-1 pt-1">
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 text-[26px] font-medium leading-tight tracking-[-0.03em] text-ink">{title}</h1>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-500">{description}</p>
    </header>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="rounded-[22px] border border-dashed border-zinc-200 px-6 py-8 text-center">
      <p className="text-[15px] font-medium tracking-[-0.01em] text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-[360px] text-[13px] leading-relaxed text-zinc-500">{text}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

const COPIED_MS = 1800;

export function CopyButton({ bridge, text, label, compact = false }: { bridge: MantelBridge; text: string; label: string; compact?: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={`${label}: ${copied ? t.manage.copied : t.manage.copy}`}
      onClick={() => void copyText(bridge, text).then((ok) => setCopied(ok))}
      icon={copied ? <CheckIcon weight="bold" className="size-4" aria-hidden /> : <CopyIcon className="size-4" aria-hidden />}
    >
      {compact ? null : copied ? t.manage.copied : t.manage.copy}
    </Button>
  );
}

export function CopyField({ bridge, label, value }: { bridge: MantelBridge; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-zinc-50/60 px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="text-[11.5px] text-zinc-500">{label}</p>
        <p className="mt-0.5 select-all font-mono text-[13.5px] text-ink [overflow-wrap:anywhere]">{value}</p>
      </div>
      <CopyButton bridge={bridge} text={value} label={label} compact />
    </div>
  );
}
