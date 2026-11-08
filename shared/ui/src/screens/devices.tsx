import { useEffect, useState } from "react";
import { ArrowRightIcon, TrashIcon } from "@phosphor-icons/react";
import { MAX_DEVICE_NAME, type Account, type Device, type MantelBridge, type PortForwardingState, type VpnNode } from "../../../core/contract";
import { keyCreatedAt } from "../../../core/device-key";
import { useI18n } from "../i18n/context";
import { useNow } from "../lib/hooks";
import { keyAgeText } from "../ui/device-key";
import { Flag } from "../ui/flag";
import { DeviceKindIcon, deviceKind, EmptyState, FIELD, PageHeader } from "../ui/manage";
import { Badge, Button, Card, InlineError } from "../ui/primitives";
import { Sheet } from "../ui/sheet";
import { ConfirmSheet } from "./settings-overview";

export function DevicesPage({
  bridge,
  account,
  nodes,
  onAccount,
  onOpenForwards,
  onShowConnect,
}: {
  bridge: MantelBridge;
  account: Account;
  nodes: readonly VpnNode[];
  onAccount: (next: Account) => void;
  onOpenForwards: () => void;
  onShowConnect: () => void;
}) {
  const i18n = useI18n();
  const { t, format } = i18n;
  const [ownId, setOwnId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(60_000);

  useEffect(() => {
    let alive = true;
    void bridge.currentDeviceId?.().then((id) => alive && setOwnId(id));
    return () => {
      alive = false;
    };
  }, [bridge, account.devices]);

  const devices = account.devices;
  const opened = devices.find((device) => device.id === openId) ?? null;
  const confirming = devices.find((device) => device.id === confirmId) ?? null;

  const remove = async (device: Device) => {
    if (!bridge.removeDevice) return;
    setPending(true);
    setError(null);
    const result = await bridge.removeDevice(device.id);
    setPending(false);
    setConfirmId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onAccount({ ...account, devices: account.devices.filter((entry) => entry.id !== device.id) });
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t.devices.title} description={t.devices.description} />
      <InlineError message={error} className="rounded-2xl border border-red-100 bg-surface px-4 py-3" />
      {devices.length === 0 ? (
        <EmptyState
          title={t.devices.emptyTitle}
          text={t.devices.empty}
          action={
            <Button variant="secondary" onClick={onShowConnect}>
              {t.manage.toConnect}
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-zinc-100">
            {devices.map((device) => {
              const node = nodes.find((entry) => entry.id === device.nodeId);
              const kind = deviceKind(device.name);
              const created = keyCreatedAt(undefined, device);
              return (
                <li key={device.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(device.id)}
                    aria-label={format(t.devices.details, { name: device.name })}
                    className="flex min-h-[64px] w-full items-center gap-3.5 px-4 py-3 text-left outline-none transition-colors hover:bg-zinc-50/70 focus-visible:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  >
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-700">
                      <DeviceKindIcon kind={kind} className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[15px] tracking-[-0.01em] text-ink">{device.name}</span>
                        {device.id === ownId && <Badge tone="accent">{t.devices.thisDevice}</Badge>}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-zinc-500">
                        {node && <Flag code={node.country} className="size-3.5" />}
                        <span className="truncate">
                          {t.devices.kinds[kind]} · {node?.city ?? t.devices.unknownLocation}
                          {created !== null && ` · ${keyAgeText(now - created, i18n)}`}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <DeviceSheet
        bridge={bridge}
        device={opened}
        own={opened !== null && opened.id === ownId}
        node={opened ? (nodes.find((entry) => entry.id === opened.nodeId) ?? null) : null}
        onClose={() => setOpenId(null)}
        onRenamed={(next) => onAccount({ ...account, devices: account.devices.map((entry) => (entry.id === next.id ? next : entry)) })}
        onOpenForwards={() => {
          setOpenId(null);
          onOpenForwards();
        }}
        onRemove={() => {
          setConfirmId(openId);
          setOpenId(null);
        }}
      />
      <ConfirmSheet
        open={confirming !== null}
        onClose={() => setConfirmId(null)}
        title={format(t.devices.removeTitle, { name: confirming?.name ?? "" })}
        description={confirming && confirming.id === ownId ? t.devices.removeOwnDescription : t.devices.removeDescription}
        confirmLabel={t.devices.remove}
        icon={<TrashIcon weight="bold" className="size-4" />}
        pending={pending}
        onConfirm={() => confirming && void remove(confirming)}
      />
    </div>
  );
}

function DeviceSheet({
  bridge,
  device,
  own,
  node,
  onClose,
  onRenamed,
  onOpenForwards,
  onRemove,
}: {
  bridge: MantelBridge;
  device: Device | null;
  own: boolean;
  node: VpnNode | null;
  onClose: () => void;
  onRenamed: (device: Device) => void;
  onOpenForwards: () => void;
  onRemove: () => void;
}) {
  const i18n = useI18n();
  const { t, format } = i18n;
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forwards, setForwards] = useState<PortForwardingState | null | "loading">("loading");

  useEffect(() => {
    if (!device) return;
    setName(device.name);
    setError(null);
    setForwards("loading");
    let alive = true;
    void bridge.devicePortForwarding?.(device.id).then((result) => alive && setForwards(result.ok ? result.value : null));
    return () => {
      alive = false;
    };
  }, [bridge, device]);

  if (!device) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const created = keyCreatedAt(undefined, device);
  const trimmed = name.trim();

  const rename = async () => {
    if (!bridge.renameDevice) return;
    setSaving(true);
    setError(null);
    const result = await bridge.renameDevice(device.id, trimmed);
    setSaving(false);
    if (!result.ok) setError(result.error);
    else onRenamed(result.value);
  };

  const ports = forwards === "loading" ? null : (forwards?.forwards ?? []);
  return (
    <Sheet open onClose={onClose} title={device.name} description={own ? t.devices.thisDevice : t.devices.kinds[deviceKind(device.name)]}>
      <div className="space-y-4 px-1">
        {bridge.renameDevice && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (trimmed && trimmed !== device.name) void rename();
            }}
          >
            <label htmlFor="device-name" className="block text-[12.5px] font-medium text-zinc-600">
              {t.devices.nameLabel}
            </label>
            <div className="flex gap-2">
              <input
                id="device-name"
                value={name}
                maxLength={MAX_DEVICE_NAME}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
                className={FIELD}
              />
              <Button type="submit" variant="secondary" size="md" pending={saving} disabled={!trimmed || trimmed === device.name}>
                {t.devices.rename}
              </Button>
            </div>
            <p className="text-[12px] leading-relaxed text-zinc-500">{format(t.devices.nameHint, { max: MAX_DEVICE_NAME })}</p>
            <InlineError message={error} />
          </form>
        )}
        <dl className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200/80 text-[13.5px]">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <dt className="text-zinc-500">{t.devices.location}</dt>
            <dd className="flex items-center gap-1.5 text-ink">
              {node && <Flag code={node.country} className="size-4" />}
              {node?.city ?? t.devices.unknownLocation}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <dt className="text-zinc-500">{t.devices.keyAge}</dt>
            <dd className="text-ink">{created === null ? t.devices.keyUnknown : keyAgeText(Date.now() - created, i18n)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <dt className="text-zinc-500">{t.devices.forwards}</dt>
            <dd className="font-mono text-ink">
              {ports === null ? "…" : ports.length === 0 ? t.devices.forwardsNone : ports.map((entry) => entry.port).join(", ")}
            </dd>
          </div>
        </dl>
        <div className="space-y-2 pt-1">
          {bridge.devicePortForwarding && (
            <Button variant="secondary" size="lg" className="w-full" onClick={onOpenForwards} icon={<ArrowRightIcon className="size-4" aria-hidden />}>
              {t.devices.forwardsManage}
            </Button>
          )}
          {bridge.removeDevice && (
            <Button variant="danger" size="lg" className="w-full" onClick={onRemove} icon={<TrashIcon className="size-4" aria-hidden />}>
              {t.devices.remove}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
