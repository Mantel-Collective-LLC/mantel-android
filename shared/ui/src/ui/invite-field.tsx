import { useId, useState } from "react";
import { useI18n } from "../i18n/context";

export function InviteCodeField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(value !== "");
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-[13px] text-zinc-500 underline-offset-4 transition-colors hover:text-ink hover:underline"
      >
        {t.login.inviteToggle}
      </button>
    );
  }
  return (
    <div className="mt-4">
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-zinc-600">
        {t.login.inviteLabel}
      </label>
      <input
        id={id}
        value={value}
        maxLength={32}
        disabled={disabled}
        autoFocus
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder={t.login.invitePlaceholder}
        onChange={(event) => onChange(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
        className="h-11 w-full rounded-2xl border border-zinc-200 bg-surface px-3.5 font-mono text-[14px] tracking-[0.04em] text-ink placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-4 focus:ring-zinc-900/5 disabled:opacity-60"
      />
    </div>
  );
}
