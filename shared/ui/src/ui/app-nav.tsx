import { memo } from "react";
import type { Icon } from "@phosphor-icons/react";
import { GearSixIcon, GlobeHemisphereWestIcon, LifebuoyIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import type { TunnelPhase } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";

export type Tab = "connect" | "locations" | "support" | "settings";

const ITEMS: ReadonlyArray<{ tab: Tab; icon: Icon }> = [
  { tab: "connect", icon: ShieldCheckIcon },
  { tab: "locations", icon: GlobeHemisphereWestIcon },
  { tab: "support", icon: LifebuoyIcon },
  { tab: "settings", icon: GearSixIcon },
];

export const AppNav = memo(function AppNav({
  tab,
  phase,
  onChange,
  orientation,
  support,
}: {
  tab: Tab;
  phase: TunnelPhase;
  onChange: (tab: Tab) => void;
  orientation: "bar" | "rail";
  support?: { unread: number };
}) {
  const { t } = useI18n();
  const labels: Record<Tab, string> = {
    connect: t.app.tabConnect,
    locations: t.app.tabLocations,
    settings: t.app.tabSettings,
    support: t.app.tabSupport,
  };
  const items = support ? ITEMS : ITEMS.filter((entry) => entry.tab !== "support");
  const rail = orientation === "rail";
  return (
    <nav
      aria-label={t.app.navLabel}
      className={cn(
        rail
          ? "hidden w-[92px] shrink-0 flex-col items-stretch gap-1 border-r border-zinc-200/70 px-2.5 pt-3 lg:flex"
          : "shrink-0 border-t border-zinc-200/70 bg-surface lg:hidden android:pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className={cn(rail ? "flex flex-col gap-1" : "mx-auto grid h-16 max-w-[560px] px-2", !rail && (items.length === 4 ? "grid-cols-4" : "grid-cols-3"))}>
        {items.map(({ tab: item, icon: ItemIcon }) => {
          const active = item === tab;
          const dot = item === "connect" && phase !== "disconnected";
          const unread = item === "support" ? (support?.unread ?? 0) : 0;
          return (
            <li key={item} className="flex">
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onChange(item)}
                className={cn(
                  "group relative flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-reduce:transition-none",
                  rail ? "py-3" : "my-1",
                  active ? "text-accent-strong" : "text-zinc-500 hover:text-ink",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute rounded-full bg-current transition-[opacity,transform] duration-200 ease-out-expo motion-reduce:transition-none",
                    rail ? "-left-2.5 top-1/2 h-6 w-[3px] -translate-y-1/2" : "left-1/2 top-0 h-[3px] w-6 -translate-x-1/2",
                    active ? "scale-100 opacity-100" : rail ? "scale-y-0 opacity-0" : "scale-x-0 opacity-0",
                  )}
                />
                <span className="relative grid size-7 place-items-center">
                  <ItemIcon weight={active ? "fill" : "regular"} className="size-[22px]" aria-hidden />
                  {unread > 0 && (
                    <span
                      data-testid="support-badge"
                      className={cn(
                        "absolute -right-3 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent-strong px-1 font-mono text-[10.5px] font-semibold leading-none text-on-ink ring-2 dark:bg-accent",
                        rail ? "ring-canvas" : "ring-surface",
                      )}
                    >
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                  {dot && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2",
                        rail ? "ring-canvas" : "ring-surface",
                        phase === "connected" ? "bg-accent" : phase === "stale" ? "bg-red-500" : "bg-amber-500",
                      )}
                    />
                  )}
                </span>
                <span className={cn("text-[12px] leading-none tracking-[-0.005em]", active ? "font-semibold" : "font-medium")}>
                  {labels[item]}
                </span>
                {unread > 0 && <span className="sr-only">{` (${unread})`}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
});
