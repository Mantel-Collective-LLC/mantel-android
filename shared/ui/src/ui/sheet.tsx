import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "motion/react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "@phosphor-icons/react";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";

const DISMISS_OFFSET = 90;
const DISMISS_VELOCITY = 600;

function isMobileLayout(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.platform === "android";
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const mobile = isMobileLayout();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    const onBack = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      close.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close.current();
    };
    window.addEventListener("mantel:back", onBack, { capture: true });
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("mantel:back", onBack, { capture: true });
      window.removeEventListener("keydown", onKey, { capture: true });
      previous?.focus({ preventScroll: true });
    };
  }, [open]);

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) onClose();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          key="sheet"
          className={cn("fixed inset-0 z-[45] flex flex-col", mobile ? "justify-end" : "items-center justify-center p-4")}
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
            style={mobile && !reduce ? { willChange: "transform" } : undefined}
            {...(mobile
              ? {
                  initial: reduce ? { opacity: 0 } : { y: "100%" },
                  animate: reduce ? { opacity: 1 } : { y: 0 },
                  exit: reduce ? { opacity: 0 } : { y: "100%" },
                  transition: reduce ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 40 },
                  drag: reduce ? false : "y",
                  dragConstraints: { top: 0, bottom: 0 },
                  dragElastic: { top: 0, bottom: 0.7 },
                  onDragEnd,
                }
              : {
                  initial: reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 },
                  animate: { opacity: 1, y: 0, scale: 1 },
                  exit: reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 },
                  transition: reduce ? { duration: 0.15 } : { type: "spring", stiffness: 520, damping: 38 },
                })}
            className={cn(
              "relative w-full bg-surface outline-none",
              mobile
                ? "mx-auto max-w-lg rounded-t-[28px] border border-b-0 border-zinc-200/70 pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-2.5 shadow-sheet"
                : "scroll-area max-h-full max-w-[360px] rounded-[28px] border border-zinc-200/70 p-3 pt-5 shadow-raised",
            )}
          >
            {mobile && <div aria-hidden className="mx-auto mb-4 h-1 w-10 rounded-full bg-zinc-200" />}
            <div className="px-2 pb-3">
              <h2 id={titleId} className="text-[18px] font-medium tracking-[-0.02em] text-ink">
                {title}
              </h2>
              {description && <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">{description}</p>}
            </div>
            {children}
            <span className="sr-only">
              <button type="button" onClick={onClose}>
                {t.settings.mobile.close}
              </button>
            </span>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export type SheetOption<T extends string> = { value: T; label: string; hint?: string; icon?: ReactNode };

export function SheetOptions<T extends string>({
  label,
  options,
  value,
  onChoose,
}: {
  label: string;
  options: ReadonlyArray<SheetOption<T>>;
  value: T;
  onChoose: (next: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="space-y-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChoose(option.value)}
            className={cn(
              "flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
              selected ? "bg-zinc-50 shadow-outline" : "hover:bg-zinc-50/70 active:bg-zinc-50",
            )}
          >
            {option.icon && (
              <span
                aria-hidden
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-xl transition-colors [&>svg]:size-[18px]",
                  selected ? "bg-accent-soft text-accent-strong" : "bg-zinc-100 text-zinc-700",
                )}
              >
                {option.icon}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] text-ink">{option.label}</span>
              {option.hint && <span className="mt-0.5 block text-[12.5px] text-zinc-500">{option.hint}</span>}
            </span>
            <span
              aria-hidden
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border transition-colors",
                selected ? "border-ink bg-ink text-on-ink" : "border-zinc-300 bg-surface",
              )}
            >
              {selected && <CheckIcon weight="bold" className="size-3.5" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
