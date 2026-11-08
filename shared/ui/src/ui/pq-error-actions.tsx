import { useState } from "react";
import { PQ_ERROR_CODES, type ErrorCode, type MantelBridge, type PqErrorCode, type Preferences } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { Button } from "./primitives";

const MESSAGE_KEYS = {
  pq_unsupported: "pqUnsupported",
  pq_failed: "pqFailed",
  pq_mismatch: "pqMismatch",
  pq_not_active: "pqNotActive",
} as const satisfies Record<PqErrorCode, string>;

export function pqErrorOf(
  code: ErrorCode | null | undefined,
  message: string | null | undefined,
  errors: Record<(typeof MESSAGE_KEYS)[PqErrorCode], string>,
): PqErrorCode | null {
  if (code && (PQ_ERROR_CODES as readonly string[]).includes(code)) return code as PqErrorCode;
  if (!message) return null;
  return PQ_ERROR_CODES.find((candidate) => errors[MESSAGE_KEYS[candidate]] === message) ?? null;
}

export function PqErrorActions({
  error,
  bridge,
  preferences,
  onPreferences,
  onPickLocation,
  onConnect,
}: {
  error: PqErrorCode | null;
  bridge: MantelBridge;
  preferences: Preferences;
  onPreferences: (next: Preferences) => void;
  onPickLocation: () => void;
  onConnect: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const setPostQuantum = bridge.setPostQuantum;
  if (!error || preferences.postQuantum !== true || !setPostQuantum) return null;

  const connectClassic = async () => {
    setPending(true);
    try {
      const result = await setPostQuantum(false);
      if (!result.ok) return;
      onPreferences(result.value);
      await onConnect();
    } catch {
    } finally {
      setPending(false);
    }
  };

  return (
    <div role="group" aria-label={t.pq.actionsLabel} className="flex flex-wrap gap-2 px-3 pb-1 pt-2">
      {error === "pq_unsupported" && (
        <Button size="sm" variant="secondary" onClick={onPickLocation} disabled={pending}>
          {t.pq.actionPickLocation}
        </Button>
      )}
      <Button size="sm" variant="ghost" pending={pending} title={t.pq.actionTurnOffHint} onClick={() => void connectClassic()}>
        {t.pq.actionTurnOff}
      </Button>
    </div>
  );
}
