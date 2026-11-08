import { AnimatePresence, motion } from "motion/react";
import { useRef, type ButtonHTMLAttributes, type ChangeEvent, type ReactNode } from "react";
import { CheckIcon, CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { useI18n } from "../i18n/context";
import { groupDigits, onlyDigits } from "../lib/format";
import type { SaveState } from "../lib/hooks";

export const SPRING = { type: "spring", stiffness: 260, damping: 26 } as const;

const VARIANTS = {
  primary: {
    base: "bg-ink text-on-ink shadow-button hover:bg-zinc-800",
    disabled: "disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none",
  },
  accent: {
    base: "bg-accent-strong text-on-ink shadow-button hover:brightness-95 active:brightness-90 dark:bg-accent",
    disabled: "disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none disabled:hover:brightness-100",
  },
  stop: {
    base: "bg-stop text-on-stop shadow-button hover:bg-stop-hover active:bg-stop-active focus-visible:ring-stop",
    disabled: "disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none",
  },
  secondary: {
    base: "border border-zinc-200 bg-surface text-ink hover:border-zinc-300 hover:bg-zinc-50",
    disabled: "disabled:border-zinc-200 disabled:bg-surface disabled:text-zinc-400",
  },
  ghost: {
    base: "text-zinc-600 hover:bg-zinc-100 hover:text-ink",
    disabled: "disabled:bg-transparent disabled:text-zinc-300",
  },
  danger: {
    base: "border border-red-200 bg-surface text-red-600 hover:border-red-300 hover:bg-red-50",
    disabled: "disabled:border-zinc-200 disabled:bg-surface disabled:text-red-300",
  },
  destructive: {
    base: "bg-red-600 text-on-ink shadow-button hover:bg-red-700",
    disabled: "disabled:bg-red-300 disabled:shadow-none",
  },
} as const;

const SIZES = {
  sm: "h-9 rounded-xl px-3 text-[13px] android:h-11",
  md: "h-11 rounded-xl px-4 text-[14px]",
  lg: "h-12 rounded-2xl px-5 text-[15px]",
  xl: "h-14 rounded-2xl px-6 text-[16px] tracking-[-0.01em]",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

const PENDING = "disabled:cursor-progress opacity-75 hover:brightness-100";

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
  pending = false,
): string {
  return cn(
    "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[transform,background-color,border-color,color,filter,opacity] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 motion-reduce:active:scale-100",
    FOCUS_RING,
    VARIANTS[variant].base,
    pending ? PENDING : VARIANTS[variant].disabled,
    SIZES[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  pending = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pending?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClasses(variant, size, className, pending)}
      {...rest}
    >
      {pending ? <CircleNotchIcon weight="bold" className="size-4 shrink-0 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-[28px] border border-zinc-200/70 bg-surface shadow-card",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-xs font-medium text-zinc-400", className)}>{children}</p>
  );
}

export function InlineError({ message, className }: { message: string | null; className?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className={cn("text-[13px] leading-snug text-red-600", className)}>
      {message}
    </p>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative flex h-[26px] w-[44px] shrink-0 items-center rounded-full p-[3px] transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50 android:before:absolute android:before:-inset-[9px] android:before:content-['']",
        checked ? "bg-accent-strong" : "bg-zinc-200",
      )}
    >
      <span
        className={cn(
          "block size-5 rounded-full bg-white shadow-knob transition-transform duration-200 ease-out-expo",
          checked ? "translate-x-[18px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  layoutId,
  className,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  layoutId: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-zinc-100 p-1", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative rounded-lg px-3 py-1.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent android:min-h-11",
              active ? "text-ink" : "text-zinc-500 hover:text-zinc-700",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-lg bg-surface shadow-pill dark:bg-zinc-200"
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const CODE_LENGTH = 16;

function caretAfter(digitCount: number): number {
  return digitCount === 0 ? 0 : digitCount + Math.floor((digitCount - 1) / 4);
}

export function CodeInput({
  id,
  value,
  onChange,
  label,
  invalid = false,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (digits: string) => void;
  label: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const caret = event.target.selectionStart ?? raw.length;
    const digitsBeforeCaret = Math.min(CODE_LENGTH, onlyDigits(raw.slice(0, caret)).length);
    onChange(onlyDigits(raw).slice(0, CODE_LENGTH));
    window.requestAnimationFrame(() => {
      const position = caretAfter(digitsBeforeCaret);
      ref.current?.setSelectionRange(position, position);
    });
  };

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
        disabled={disabled}
        aria-invalid={invalid || undefined}
        placeholder="0000 0000 0000 0000"
        value={groupDigits(value)}
        onChange={handleChange}
        className={cn(
          "h-14 w-full rounded-2xl border bg-surface pl-4 pr-14 font-mono text-[18px] tracking-[0.06em] tabular-nums text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-zinc-300 focus:outline-none focus:ring-4 disabled:bg-zinc-50",
          invalid
            ? "border-red-300 focus:border-red-400 focus:ring-red-500/10"
            : "border-zinc-200 focus:border-zinc-400 focus:ring-zinc-900/5",
        )}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[11px] tabular-nums text-zinc-400"
      >
        {value.length}/{CODE_LENGTH}
      </span>
    </div>
  );
}

export function totpComplete(value: string): boolean {
  const clean = value.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(clean) || /^[0-9a-zA-Z]{10}$/.test(clean);
}

export function TotpInput({
  id,
  value,
  onChange,
  label,
  invalid = false,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[13px] font-medium text-zinc-600">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        autoFocus
        disabled={disabled}
        aria-invalid={invalid || undefined}
        placeholder="123456"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9a-zA-Z -]/g, "").slice(0, 16))}
        className={cn(
          "h-14 w-full rounded-2xl border bg-surface px-4 font-mono text-[18px] tracking-[0.18em] tabular-nums text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-zinc-300 focus:outline-none focus:ring-4 disabled:bg-zinc-50",
          invalid
            ? "border-red-300 focus:border-red-400 focus:ring-red-500/10"
            : "border-zinc-200 focus:border-zinc-400 focus:ring-zinc-900/5",
        )}
      />
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 24 24" className="size-[22px]" aria-hidden>
        <rect width="24" height="24" rx="7" className="fill-ink" />
        <path
          d="M7 16.5V8.2c0-.5.6-.8 1-.4l4 3.7 4-3.7c.4-.4 1-.1 1 .4v8.3"
          fill="none"
          className="stroke-on-ink"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="16.6" r="1.4" className="fill-accent" />
      </svg>
      <span className="text-[14.5px] font-semibold tracking-tight">mantel</span>
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-[11.5px] font-medium",
        tone === "neutral" && "bg-zinc-100 text-zinc-500",
        tone === "accent" && "bg-accent-soft text-accent-strong",
        tone === "warn" && "bg-amber-50 text-amber-700",
      )}
    >
      {children}
    </span>
  );
}

export function SaveIndicator({ state }: { state: SaveState }) {
  const { t } = useI18n();
  return (
    <div aria-live="polite" className="h-7">
      <AnimatePresence mode="popLayout" initial={false}>
        {state !== "idle" && (
          <motion.span
            key={state}
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-zinc-200/80 bg-surface px-3 text-[12px] text-zinc-600"
          >
            {state === "saving" && <CircleNotchIcon className="size-3.5 animate-spin" />}
            {state === "saved" && <CheckIcon weight="bold" className="size-3.5 text-accent-strong" />}
            {state === "error" && <WarningCircleIcon weight="fill" className="size-3.5 text-red-600" />}
            {state === "saving" && t.save.saving}
            {state === "saved" && t.save.saved}
            {state === "error" && t.save.error}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
