import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from "motion/react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CaretRightIcon, CheckIcon, GlobeHemisphereWestIcon, MagnifyingGlassIcon, StarIcon, XIcon } from "@phosphor-icons/react";
import type { VpnNode } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";
import {
  availabilityOf,
  countryName,
  favoriteNodes,
  groupLocations,
  isSelectable,
  latencyQuality,
  nextRow,
  pickerRows,
  signalLevel,
  type Availability,
  type CountryGroup,
} from "../lib/locations";
import { Flag } from "./flag";
import { NoQuantumHint } from "./quantum-badge";

const DISMISS_OFFSET = 110;
const DISMISS_VELOCITY = 650;

export function Latency({ ms, dim = false }: { ms: number | undefined; dim?: boolean }) {
  const { t, format } = useI18n();
  const level = signalLevel(ms);
  const quality = latencyQuality(ms);
  if (quality === null) return null;
  const label = `${format(t.locations.latencyLabel, { quality: t.locations.latency[quality] })}, ${t.locations.latencyMeasured}`;
  return (
    <span role="img" aria-label={label} title={t.locations.latencyMeasured} className={cn("flex shrink-0 items-center gap-1.5", dim && "opacity-50")}>
      <span aria-hidden className="text-[11.5px] text-zinc-500">
        {t.locations.latency[quality]}
      </span>
      <span aria-hidden className="flex h-2.5 items-end gap-[2px]">
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={cn(
              "w-[3px] rounded-full",
              bar === 1 ? "h-1" : bar === 2 ? "h-[7px]" : "h-2.5",
              bar > level ? "bg-zinc-200" : level === 1 ? "bg-amber-500" : "bg-accent",
            )}
          />
        ))}
      </span>
    </span>
  );
}

function StatusChip({ availability }: { availability: Exclude<Availability, "available"> }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium",
        availability === "offline" ? "bg-zinc-100 text-zinc-500" : "bg-amber-50 text-amber-700",
      )}
    >
      {t.locations.status[availability]}
    </span>
  );
}

export function LocationButton({
  node,
  nodes,
  loading,
  onOpen,
  inline = false,
}: {
  node: VpnNode | null;
  nodes: readonly VpnNode[];
  loading: boolean;
  onOpen: () => void;
  inline?: boolean;
}) {
  const { t, format, locale } = useI18n();
  const available = nodes.filter(isSelectable).length;

  if (loading && nodes.length === 0) {
    return (
      <div
        aria-label={t.locations.loading}
        className={cn(
          "flex h-[72px] items-center gap-3 px-4",
          inline ? "rounded-2xl bg-zinc-50" : "rounded-[24px] border border-zinc-200/70 bg-surface shadow-card",
        )}
      >
        <span className="size-10 animate-pulse rounded-full bg-zinc-100" />
        <span className="flex-1 space-y-2">
          <span className="block h-3 w-24 animate-pulse rounded-full bg-zinc-100" />
          <span className="block h-2.5 w-36 animate-pulse rounded-full bg-zinc-100" />
        </span>
      </div>
    );
  }

  const country = node ? countryName(node.country.toUpperCase(), locale) : "";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup={inline ? undefined : "dialog"}
      aria-label={node ? format(t.locations.openLabel, { city: node.city, country }) : t.locations.choose}
      className={cn(
        "group flex min-h-[72px] w-full items-center gap-3 py-3 pl-3.5 pr-3 text-left outline-none transition-[transform,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.99] motion-reduce:active:scale-100",
        inline
          ? "rounded-2xl border border-zinc-200/60 bg-zinc-50/80 hover:bg-zinc-100/80"
          : "rounded-[24px] border border-zinc-200/70 bg-surface shadow-card hover:bg-zinc-50/60",
      )}
    >
      {node ? (
        <Flag code={node.country} className="size-10" />
      ) : (
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-500">
          <GlobeHemisphereWestIcon weight="duotone" className="size-5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-medium tracking-tight text-ink">
          {node ? node.city : t.locations.choose}
        </span>
        {node ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-2">
            <span className="truncate text-[12.5px] text-zinc-500">{country}</span>
            {node.online && latencyQuality(node.latencyMs) !== null && (
              <>
                <span aria-hidden className="size-0.5 shrink-0 rounded-full bg-zinc-300" />
                <Latency ms={node.latencyMs} />
              </>
            )}
          </span>
        ) : (
          nodes.length > 0 && (
            <span className="mt-0.5 block font-mono text-[11px] text-zinc-400">
              {format(t.locations.available, { available, total: nodes.length })}
            </span>
          )
        )}
        {node && <NoQuantumHint node={node} />}
      </span>
      <span
        className={cn(
          "ml-1 inline-flex h-8 shrink-0 items-center gap-0.5 rounded-full pl-3 pr-2 text-[12.5px] font-medium text-zinc-700 transition-colors",
          inline ? "bg-surface shadow-pill @max-[19rem]:pl-2" : "bg-zinc-100 group-hover:bg-zinc-200/70",
        )}
      >
        <span className={cn(inline && "@max-[19rem]:sr-only")}>{t.locations.change}</span>
        <CaretRightIcon weight="bold" className="size-3.5" />
      </span>
    </button>
  );
}

function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !viewport) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      setInset(0);
    };
  }, [active]);
  return inset;
}

type RowProps = {
  node: VpnNode;
  index: number;
  rowKey: string;
  selected: boolean;
  connected: boolean;
  favorite: boolean;
  standalone: boolean;
  tabbable: boolean;
  onChoose: (node: VpnNode) => void;
  onToggleFavorite: (id: string) => void;
  onRowKeyDown: (event: ReactKeyboardEvent<HTMLElement>, index: number, part: "row" | "star") => void;
  onFocusRow: (index: number) => void;
};

function LocationRow({
  node,
  index,
  rowKey,
  selected,
  connected,
  favorite,
  standalone,
  tabbable,
  onChoose,
  onToggleFavorite,
  onRowKeyDown,
  onFocusRow,
}: RowProps) {
  const { t, format, locale } = useI18n();
  const availability = availabilityOf(node);
  const blocked = availability !== "available";
  const reasonId = `${rowKey}-reason`.replace(/[^A-Za-z0-9_-]/g, "_");
  return (
    <div
      className={cn(
        "relative flex items-center rounded-2xl pr-0.5 transition-colors duration-150",
        selected
          ? "bg-zinc-50 shadow-selected"
          : !blocked && "hover:bg-zinc-50 has-[[role=radio]:active]:bg-zinc-100/70",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? reasonId : undefined}
        tabIndex={tabbable ? 0 : -1}
        data-row={index}
        data-favorite={standalone || undefined}
        onClick={() => {
          if (!blocked) onChoose(node);
        }}
        onKeyDown={(event) => onRowKeyDown(event, index, "row")}
        onFocus={() => onFocusRow(index)}
        className={cn(
          "relative flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl py-2 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent",
          standalone ? "pl-2.5" : "pl-[52px]",
          blocked && "cursor-not-allowed",
        )}
      >
        {standalone && <Flag code={node.country} />}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("truncate text-[15px] font-medium tracking-[-0.01em]", blocked ? "text-zinc-400" : "text-ink")}>
              {node.city}
            </span>
            {blocked && <StatusChip availability={availability} />}
            {connected && !blocked && (
              <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 text-[11px] font-medium text-accent-strong">
                <span className="size-1.5 rounded-full bg-accent" />
                {t.locations.connected}
              </span>
            )}
          </span>
          {!blocked && <NoQuantumHint node={node} />}
          {(blocked || standalone) && (
            <span id={blocked ? reasonId : undefined} className="mt-0.5 block truncate text-[12px] text-zinc-500">
              {blocked ? t.locations.reason[availability] : countryName(node.country.toUpperCase(), locale)}
            </span>
          )}
        </span>
        {!blocked && <Latency ms={node.latencyMs} />}
        <span aria-hidden className="grid size-6 shrink-0 place-items-center">
          <span
            className={cn(
              "grid size-6 place-items-center rounded-full bg-ink text-on-ink transition-[opacity,transform] duration-200 ease-out-expo",
              selected ? "scale-100 opacity-100" : "scale-50 opacity-0",
            )}
          >
            <CheckIcon weight="bold" className="size-3.5" />
          </span>
        </span>
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-pressed={favorite}
        aria-label={format(favorite ? t.locations.removeFavorite : t.locations.addFavorite, { city: node.city })}
        onClick={() => onToggleFavorite(node.id)}
        onKeyDown={(event) => onRowKeyDown(event, index, "star")}
        data-star={index}
        className="grid size-11 shrink-0 place-items-center rounded-full text-zinc-300 outline-none transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-500 focus-visible:ring-2 focus-visible:ring-accent active:bg-zinc-100"
      >
        <span
          key={favorite ? "on" : "off"}
          className={cn("grid place-items-center", favorite && "motion-safe:animate-star-pop")}
        >
          <StarIcon weight={favorite ? "fill" : "regular"} className={cn("size-[18px]", favorite && "text-amber-500")} />
        </span>
      </button>
    </div>
  );
}

function SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="px-3 pb-2 pt-4 text-xs font-medium text-zinc-400 first:pt-1">
      {children}
    </p>
  );
}

function CountryHeader({ group, id }: { group: CountryGroup; id: string }) {
  const { plural, format, t } = useI18n();
  const total = group.nodes.length;
  return (
    <div className="flex items-center gap-3 px-2.5 pb-1 pt-2">
      <Flag code={group.code} />
      <h3 id={id} className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">
        {group.name}
      </h3>
      <span className="shrink-0 pr-3 font-mono text-[11px] tabular-nums text-zinc-400">
        {group.available === total || total === 1
          ? plural(t.locations.cities, total)
          : format(t.locations.available, { available: group.available, total })}
      </span>
    </div>
  );
}

export function LocationPicker({
  open,
  onClose,
  nodes,
  selectedId,
  activeId,
  favorites,
  onToggleFavorite,
  onSelect,
  touch,
}: {
  open: boolean;
  onClose: () => void;
  nodes: readonly VpnNode[];
  selectedId: string | null;
  activeId: string | null;
  favorites: readonly string[];
  onToggleFavorite: (id: string) => void;
  onSelect: (node: VpnNode) => void;
  touch: boolean;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <PickerPanel
          key="location-picker"
          onClose={onClose}
          nodes={nodes}
          selectedId={selectedId}
          activeId={activeId}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          onSelect={onSelect}
          touch={touch}
        />
      )}
    </AnimatePresence>,
    document.body,
  );
}

type BrowserProps = {
  nodes: readonly VpnNode[];
  selectedId: string | null;
  activeId: string | null;
  favorites: readonly string[];
  onToggleFavorite: (id: string) => void;
  onChoose: (node: VpnNode) => void;
  autoFocus: boolean;
  layout: "sheet" | "page";
  header?: ReactNode;
  keyboardHint: boolean;
  onHeaderPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  headerClassName?: string;
};

export const LocationBrowser = memo(function LocationBrowser({
  nodes,
  selectedId,
  activeId,
  favorites,
  onToggleFavorite,
  onChoose,
  autoFocus,
  layout,
  header,
  keyboardHint,
  onHeaderPointerDown,
  headerClassName,
}: BrowserProps) {
  const { t, format, locale } = useI18n();
  const baseId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const sheet = layout === "sheet";

  const groups = useMemo(() => groupLocations(nodes, { query, locale }), [nodes, query, locale]);
  const favoriteList = useMemo(
    () => (query.trim() ? [] : favoriteNodes(nodes, favorites, { locale })),
    [nodes, favorites, query, locale],
  );
  const rows = useMemo(() => pickerRows(favoriteList, groups), [favoriteList, groups]);
  const selectedIndex = rows.findIndex((row) => row.node.id === selectedId && !row.key.startsWith("fav:"));
  const tabbable = active !== null && active < rows.length ? active : selectedIndex >= 0 ? selectedIndex : 0;

  useEffect(() => {
    if (autoFocus) search.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useLayoutEffect(() => {
    if (!sheet) return;
    const container = list.current;
    const row = container?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]:not([data-favorite])');
    if (!container || !row) return;
    const top = row.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    if (top + row.offsetHeight > container.clientHeight - 16) {
      container.scrollTop = Math.max(0, top - container.clientHeight / 2 + row.offsetHeight / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusRow = useCallback((index: number, part: "row" | "star" = "row") => {
    if (index < 0) {
      search.current?.focus();
      return;
    }
    const element = list.current?.querySelector<HTMLElement>(`[data-${part}="${index}"]`);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest" });
  }, []);

  const choose = (node: VpnNode) => {
    if (!isSelectable(node)) return;
    onChoose(node);
  };

  const typeIntoSearch = (event: ReactKeyboardEvent<HTMLElement>): boolean => {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key.length === 1 && event.key !== " ") {
      event.preventDefault();
      setQuery((current) => current + event.key);
      setActive(null);
      search.current?.focus();
      return true;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      setQuery((current) => current.slice(0, -1));
      setActive(null);
      search.current?.focus();
      return true;
    }
    return false;
  };

  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number, part: "row" | "star") => {
    const move =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : event.key === "Home" ? "first" : event.key === "End" ? "last" : null;
    if (move !== null) {
      event.preventDefault();
      focusRow(nextRow(rows.length, index, move));
      return;
    }
    if (part === "row" && event.key === "ArrowRight") {
      event.preventDefault();
      focusRow(index, "star");
      return;
    }
    if (part === "star" && event.key === "ArrowLeft") {
      event.preventDefault();
      focusRow(index);
      return;
    }
    typeIntoSearch(event);
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(nextRow(rows.length, -1, 1));
    } else if (event.key === "Enter") {
      const first = rows.find((row) => isSelectable(row.node));
      if (first) {
        event.preventDefault();
        choose(first.node);
      }
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
    }
  };

  let rowIndex = 0;
  const renderRow = (node: VpnNode, key: string, standalone: boolean) => {
    const index = rowIndex++;
    return (
      <LocationRow
        key={key}
        node={node}
        index={index}
        rowKey={`${baseId}-${key}`}
        selected={node.id === selectedId}
        connected={node.id === activeId}
        favorite={favorites.includes(node.id)}
        standalone={standalone}
        tabbable={index === tabbable}
        onChoose={choose}
        onToggleFavorite={onToggleFavorite}
        onRowKeyDown={onRowKeyDown}
        onFocusRow={setActive}
      />
    );
  };

  const groupSurface = sheet ? "border-zinc-100 bg-zinc-50/40" : "border-zinc-200/70 bg-surface shadow-card";

  return (
    <>
      <header
        onPointerDown={onHeaderPointerDown}
        className={cn(
          "shrink-0",
          sheet ? "px-4 pb-3" : "sticky top-0 z-10 -mx-1 bg-canvas px-1 pb-3 pt-1",
          headerClassName,
        )}
      >
        {header}
        <div className={cn("relative", header !== undefined && "mt-3")}>
          <MagnifyingGlassIcon
            aria-hidden
            weight="bold"
            className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-zinc-400"
          />
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(null);
              if (sheet && list.current) list.current.scrollTop = 0;
            }}
            onKeyDown={onSearchKeyDown}
            aria-label={t.locations.searchLabel}
            aria-controls={`${baseId}-list`}
            placeholder={t.locations.searchPlaceholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            className={cn(
              "h-12 w-full rounded-2xl border pl-11 pr-12 text-[15px] text-ink outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-surface focus-visible:ring-2 focus-visible:ring-accent/40 [&::-webkit-search-cancel-button]:appearance-none",
              sheet ? "border-transparent bg-zinc-100" : "border-zinc-200/80 bg-surface shadow-card",
            )}
          />
          <AnimatePresence>
            {query && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.12 }}
                onClick={() => {
                  setQuery("");
                  search.current?.focus();
                }}
                aria-label={t.locations.clearSearch}
                className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-xl text-zinc-500 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="grid size-5 place-items-center rounded-full bg-zinc-300/70 text-surface">
                  <XIcon weight="bold" className="size-3" />
                </span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </header>

      <div
        ref={list}
        id={`${baseId}-list`}
        role="radiogroup"
        aria-label={t.locations.listLabel}
        className={cn(
          sheet
            ? "scroll-area relative min-h-0 flex-1 overscroll-contain border-t border-zinc-100 px-2 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2"
            : "relative",
        )}
      >
        {favoriteList.length > 0 && (
          <section aria-labelledby={`${baseId}-fav`}>
            <SectionLabel id={`${baseId}-fav`}>{t.locations.favorites}</SectionLabel>
            <div role="group" aria-labelledby={`${baseId}-fav`} className={cn("space-y-0.5 rounded-[22px] border p-1", groupSurface)}>
              {favoriteList.map((node) => renderRow(node, `fav:${node.id}`, true))}
            </div>
            <SectionLabel>{t.locations.allLocations}</SectionLabel>
          </section>
        )}
        <div className="space-y-2">
          {groups.map((group) => (
            <section
              key={group.code}
              role="group"
              aria-labelledby={`${baseId}-${group.code}`}
              className={cn("rounded-[22px] border p-1 [contain-intrinsic-size:auto_160px] [content-visibility:auto]", groupSurface)}
            >
              <CountryHeader group={group} id={`${baseId}-${group.code}`} />
              <div className="space-y-0.5">{group.nodes.map((node) => renderRow(node, `${group.code}:${node.id}`, false))}</div>
            </section>
          ))}
        </div>
        {rows.length === 0 && (
          <div className="grid place-items-center px-6 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-zinc-100 text-zinc-400">
              <MagnifyingGlassIcon weight="bold" className="size-5" />
            </span>
            <p className="mt-3 text-[13.5px] text-zinc-500">
              {query.trim() ? format(t.locations.noResults, { query: query.trim() }) : t.locations.none}
            </p>
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  search.current?.focus();
                }}
                className="mt-3 h-10 rounded-full px-4 text-[13px] font-medium text-accent-strong outline-none hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-accent"
              >
                {t.locations.clearSearch}
              </button>
            )}
          </div>
        )}
      </div>
      {keyboardHint && (
        <p
          aria-hidden
          className={cn("shrink-0 px-5 py-2.5 text-center font-mono text-[10.5px] text-zinc-400", sheet ? "border-t border-zinc-100" : "mt-2")}
        >
          {t.locations.keyboardHint}
        </p>
      )}
    </>
  );
});

export function PickerPanel({
  onClose,
  nodes,
  selectedId,
  activeId,
  favorites,
  onToggleFavorite,
  onSelect,
  touch,
}: Omit<Parameters<typeof LocationPicker>[0], "open">) {
  const { t, format } = useI18n();
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const keyboardInset = useKeyboardInset(touch);
  const available = nodes.filter(isSelectable).length;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (touch) panel.current?.focus({ preventScroll: true });
    const onBack = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      close.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) close.current();
    };
    window.addEventListener("mantel:back", onBack, { capture: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mantel:back", onBack, { capture: true });
      window.removeEventListener("keydown", onKey);
      previous?.focus({ preventScroll: true });
    };
  }, [touch]);

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !panel.current) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>("button, input")].filter(
      (element) => element.tabIndex >= 0 && !element.hasAttribute("disabled") && element.offsetParent !== null,
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!touch || reduce) return;
    if ((event.target as HTMLElement).closest("input, button")) return;
    drag.start(event);
  };

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) onClose();
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-[45] flex flex-col justify-end",
        touch ? "pt-[calc(env(safe-area-inset-top)+10px)]" : "pt-12 [@media(min-height:880px)]:justify-center [@media(min-height:880px)]:pb-12",
      )}
      style={keyboardInset ? { paddingBottom: keyboardInset } : undefined}
    >
      <motion.div
        className="absolute inset-0 bg-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        aria-hidden
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        initial={reduce ? { opacity: 0 } : { y: "100%" }}
        animate={reduce ? { opacity: 1 } : { y: 0 }}
        exit={reduce ? { opacity: 0 } : { y: "100%" }}
        transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 38 }}
        drag={touch && !reduce ? "y" : false}
        dragListener={false}
        dragControls={drag}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
        onDragEnd={onDragEnd}
        className={cn(
          "relative mx-auto flex h-full min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] border border-b-0 border-zinc-200/70 bg-surface pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-sheet outline-none",
          !touch && "[@media(min-height:880px)]:max-h-[820px] [@media(min-height:880px)]:rounded-b-[28px] [@media(min-height:880px)]:border-b",
        )}
      >
        <LocationBrowser
          nodes={nodes}
          selectedId={selectedId}
          activeId={activeId}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          onChoose={(node) => {
            onSelect(node);
            onClose();
          }}
          autoFocus={!touch}
          layout="sheet"
          keyboardHint={!touch}
          onHeaderPointerDown={startDrag}
          headerClassName={touch ? "touch-none pt-2.5" : "pt-4"}
          header={
            <>
              {touch && <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-200" />}
              <div className="flex items-center gap-3 pl-1">
                <div className="min-w-0 flex-1">
                  <h2 id={titleId} className="text-[18px] font-medium tracking-[-0.02em] text-ink">
                    {t.locations.title}
                  </h2>
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
                    {format(t.locations.available, { available, total: nodes.length })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t.locations.close}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-600 outline-none transition-colors hover:bg-zinc-200/70 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <XIcon weight="bold" className="size-4" />
                </button>
              </div>
            </>
          }
        />
      </motion.div>
    </div>
  );
}
