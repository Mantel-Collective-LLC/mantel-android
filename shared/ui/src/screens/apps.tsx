import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon, ShieldWarningIcon, XIcon } from "@phosphor-icons/react";
import type { InstalledApp, MantelBridge } from "../../../core/contract";
import { excludedSummary, filterApps, indexApps, type IndexedApp } from "../lib/apps";
import { useI18n } from "../i18n/context";
import { Badge, Card, Eyebrow, InlineError, Switch } from "../ui/primitives";

function AppIcon({ app }: { app: InstalledApp }) {
  const [failed, setFailed] = useState(false);
  if (app.icon && !failed) {
    return (
      <img
        src={app.icon}
        alt=""
        width={36}
        height={36}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        className="size-9 shrink-0 rounded-[10px]"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-zinc-100 text-[13px] font-medium text-zinc-500"
    >
      {(app.label.trim()[0] ?? "?").toLocaleUpperCase()}
    </span>
  );
}

const AppRow = memo(function AppRow({
  app,
  checked,
  disabled,
  onToggle,
}: {
  app: IndexedApp;
  checked: boolean;
  disabled: boolean;
  onToggle: (packageName: string, excluded: boolean) => void;
}) {
  const { t, format } = useI18n();
  return (
    <li className="[contain-intrinsic-size:auto_60px] [content-visibility:auto]">
      <label className="flex min-h-[60px] cursor-pointer items-center gap-3 px-4 py-2.5">
        <AppIcon app={app} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-medium text-ink">{app.label}</span>
            {app.system && (
              <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 text-[10.5px] font-medium leading-[18px] text-zinc-500">
                {t.apps.systemBadge}
              </span>
            )}
          </span>
          <span className="block truncate font-mono text-[11px] text-zinc-400">{app.packageName}</span>
        </span>
        <Switch
          label={format(t.apps.exclude, { app: app.label })}
          checked={checked}
          disabled={disabled}
          onChange={(value) => onToggle(app.packageName, value)}
        />
      </label>
    </li>
  );
});

export function AppsScreen({
  bridge,
  excluded,
  error,
  lockdown,
  onToggle,
}: {
  bridge: MantelBridge;
  excluded: string[] | null;
  error: string | null;
  lockdown: boolean;
  onToggle: (packageName: string, excluded: boolean) => void;
}) {
  const i18n = useI18n();
  const { t, format } = i18n;
  const loadFailed = useRef(t.apps.loadFailed);
  loadFailed.current = t.apps.loadFailed;
  const [apps, setApps] = useState<IndexedApp[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const load = bridge.installedApps;
    if (!load) {
      setApps([]);
      return;
    }
    let disposed = false;
    load()
      .then((list) => {
        if (!disposed) setApps(indexApps(list));
      })
      .catch(() => {
        if (disposed) return;
        setApps([]);
        setLoadError(loadFailed.current);
      });
    return () => {
      disposed = true;
    };
  }, [bridge]);

  const excludedSet = useMemo(() => new Set(excluded ?? []), [excluded]);
  const visible = useMemo(
    () => (apps ? filterApps(apps, deferredQuery, showSystem) : []),
    [apps, deferredQuery, showSystem],
  );
  const hiddenSystem = useMemo(
    () => (apps && !showSystem ? apps.filter((app) => app.system).length : 0),
    [apps, showSystem],
  );
  const stale = query !== deferredQuery;

  return (
    <div className="space-y-3">
      <Card className="px-5 py-4">
        <h1 className="text-[15px] font-medium tracking-[-0.02em]">{t.apps.title}</h1>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{t.apps.description}</p>
        {lockdown && (
          <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-relaxed text-zinc-500">
            <ShieldWarningIcon weight="fill" className="mt-0.5 size-4 shrink-0 text-amber-600" />
            {t.apps.lockdownWarning}
          </p>
        )}
        <InlineError message={error ?? loadError} className="mt-3" />
      </Card>

      <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-canvas px-4 pb-1 pt-0.5">
        <div className="relative">
          <label htmlFor="app-search" className="sr-only">
            {t.apps.search}
          </label>
          <MagnifyingGlassIcon
            weight="bold"
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
          />
          <input
            id="app-search"
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t.apps.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-11 w-full rounded-xl border border-zinc-200 bg-surface pl-10 pr-11 text-[14px] text-ink placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-4 focus:ring-zinc-900/5"
          />
          {query && (
            <button
              type="button"
              aria-label={t.apps.clearSearch}
              onClick={() => setQuery("")}
              className="absolute right-0 top-0 grid size-11 place-items-center rounded-xl text-zinc-400 hover:text-ink"
            >
              <XIcon weight="bold" className="size-4" />
            </button>
          )}
        </div>
      </div>

      <Card>
        <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-4 border-b border-zinc-100 px-5 py-3">
          <span className="min-w-0">
            <span className="block text-[14px] text-ink">{t.apps.showSystem}</span>
            {hiddenSystem > 0 && (
              <span className="mt-0.5 block text-[12.5px] text-zinc-500">{format(t.apps.hidden, { count: hiddenSystem })}</span>
            )}
          </span>
          <Switch label={t.apps.showSystem} checked={showSystem} onChange={setShowSystem} />
        </label>

        <div className="flex items-center justify-between px-5 pb-1 pt-3">
          <Eyebrow>{t.apps.heading}</Eyebrow>
          <span className="font-mono text-[11px] tabular-nums text-zinc-400">
            {excluded === null ? "…" : excludedSummary(excluded.length, i18n)}
          </span>
        </div>

        {apps === null ? (
          <div aria-label={t.apps.loading} className="space-y-1 p-3">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div key={index} className="h-[52px] animate-pulse rounded-2xl bg-zinc-100/80" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-5 pb-6 pt-4 text-[13px] leading-relaxed text-zinc-500">
            {apps.length === 0
              ? t.apps.noneFound
              : deferredQuery.trim()
                ? format(t.apps.noMatch, { query: deferredQuery.trim() })
                : t.apps.noneWithoutSystem}
            {apps.length > 0 && !showSystem && hiddenSystem > 0 && (
              <span className="mt-2 block">
                <Badge>{i18n.plural(t.apps.systemHidden, hiddenSystem)}</Badge>
              </span>
            )}
          </div>
        ) : (
          <ul
            className={`divide-y divide-zinc-100 pb-2 transition-opacity duration-150 ${stale ? "opacity-60" : ""}`}
          >
            {visible.map((app) => (
              <AppRow
                key={app.packageName}
                app={app}
                checked={excludedSet.has(app.packageName)}
                disabled={excluded === null}
                onToggle={onToggle}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
