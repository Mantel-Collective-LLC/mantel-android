import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwiseIcon, KeyIcon, PaperPlaneTiltIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import type { MantelBridge, VpnNode } from "../../../core/contract";
import {
  MAX_PROXY_NAME,
  PROXY_EXITS,
  PROXY_LIMIT,
  PROXY_PROTOCOLS,
  proxyAddress,
  proxyUrl,
  type ProxyExit,
  type ProxyPatch,
  type ProxyProtocol,
  type ServerProxy,
} from "../../../core/proxy";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";
import { Flag } from "../ui/flag";
import { CopyField, EmptyState, FIELD, PageHeader } from "../ui/manage";
import { Badge, Button, Card, InlineError, Segmented, Switch } from "../ui/primitives";
import { Sheet } from "../ui/sheet";
import { ConfirmSheet } from "./settings-overview";

type Load = { kind: "loading" } | { kind: "soon" } | { kind: "ready"; proxies: ServerProxy[] } | { kind: "failed"; error: string };
type Open =
  | { kind: "create" }
  | { kind: "details"; id: string }
  | { kind: "confirm"; id: string }
  | { kind: "credentials"; proxy: ServerProxy; password: string }
  | null;

const STATUS_DOT = { active: "bg-accent", pending: "bg-amber-500", unavailable: "bg-red-500" } as const;

export function ProxiesPage({ bridge, nodes }: { bridge: MantelBridge; nodes: readonly VpnNode[] }) {
  const { t, format } = useI18n();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [open, setOpen] = useState<Open>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    const result = await bridge.proxies?.();
    if (!result) return;
    if (!result.ok) setLoad({ kind: "failed", error: result.error });
    else setLoad(result.value === null ? { kind: "soon" } : { kind: "ready", proxies: result.value });
  }, [bridge]);

  useEffect(() => {
    void read();
  }, [read]);

  const proxies = load.kind === "ready" ? load.proxies : [];
  const replace = (next: ServerProxy) =>
    setLoad((current) => (current.kind === "ready" ? { kind: "ready", proxies: current.proxies.map((entry) => (entry.id === next.id ? next : entry)) } : current));

  const patch = async (id: string, body: ProxyPatch, busy: string): Promise<boolean> => {
    if (!bridge.updateProxy) return false;
    setPending(busy);
    setError(null);
    const result = await bridge.updateProxy(id, body);
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    replace(result.value.proxy);
    if (result.value.password) setOpen({ kind: "credentials", proxy: result.value.proxy, password: result.value.password });
    return true;
  };

  const remove = async (id: string) => {
    if (!bridge.deleteProxy) return;
    setPending("delete");
    setError(null);
    const result = await bridge.deleteProxy(id);
    setPending(null);
    setOpen(null);
    if (!result.ok) setError(result.error);
    else setLoad((current) => (current.kind === "ready" ? { kind: "ready", proxies: current.proxies.filter((entry) => entry.id !== id) } : current));
  };

  const full = proxies.length >= PROXY_LIMIT;
  const details = open?.kind === "details" || open?.kind === "confirm" ? (proxies.find((entry) => entry.id === open.id) ?? null) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.proxies.title}
        description={t.proxies.description}
        aside={
          load.kind === "ready" && proxies.length > 0 ? (
            <Button size="sm" disabled={full} onClick={() => setOpen({ kind: "create" })} icon={<PlusIcon weight="bold" className="size-4" aria-hidden />}>
              {t.proxies.add}
            </Button>
          ) : undefined
        }
      />
      <InlineError message={error} className="rounded-2xl border border-red-100 bg-surface px-4 py-3" />

      {load.kind === "loading" && <span className="block h-24 animate-pulse rounded-[22px] bg-zinc-100" />}
      {load.kind === "soon" && <EmptyState title={t.proxies.soonTitle} text={t.proxies.soon} />}
      {load.kind === "failed" && (
        <EmptyState
          title={t.proxies.title}
          text={load.error}
          action={
            <Button variant="secondary" onClick={() => void read()}>
              {t.manage.retry}
            </Button>
          }
        />
      )}
      {load.kind === "ready" && proxies.length === 0 && (
        <EmptyState
          title={t.proxies.emptyTitle}
          text={t.proxies.empty}
          action={
            <Button onClick={() => setOpen({ kind: "create" })} icon={<PlusIcon weight="bold" className="size-4" aria-hidden />}>
              {t.proxies.add}
            </Button>
          }
        />
      )}
      {proxies.length > 0 && (
        <>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-zinc-100">
              {proxies.map((proxy) => {
                const node = nodes.find((entry) => entry.id === proxy.nodeId);
                return (
                  <li key={proxy.id} className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setOpen({ kind: "details", id: proxy.id })}
                      aria-label={format(t.proxies.details, { name: proxy.name })}
                      className="-my-1 -ml-1 flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {node ? <Flag code={node.country} className="size-9" /> : <span className="size-9 shrink-0 rounded-full bg-zinc-100" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] tracking-[-0.01em] text-ink">{proxy.name}</span>
                        <span className="mt-0.5 block truncate font-mono text-[12px] text-zinc-500">{proxyAddress(proxy)}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge>{t.proxies.protocols[proxy.protocol]}</Badge>
                          <Badge tone={proxy.exit === "tor" ? "accent" : "neutral"}>{t.proxies.exits[proxy.exit]}</Badge>
                          <span className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500">
                            <span aria-hidden className={cn("size-1.5 rounded-full", proxy.enabled ? STATUS_DOT[proxy.status] : "bg-zinc-300")} />
                            {proxy.enabled ? t.proxies.statuses[proxy.status] : t.proxies.off}
                          </span>
                        </span>
                      </span>
                    </button>
                    <Switch
                      label={format(t.proxies.switch, { name: proxy.name })}
                      checked={proxy.enabled}
                      disabled={pending !== null}
                      onChange={(value) => void patch(proxy.id, { enabled: value }, `toggle:${proxy.id}`)}
                    />
                  </li>
                );
              })}
            </ul>
          </Card>
          <p className="px-1 font-mono text-[11px] tabular-nums text-zinc-400">{format(t.proxies.count, { count: proxies.length, max: PROXY_LIMIT })}</p>
        </>
      )}
      {load.kind !== "soon" && <p className="px-1 text-[12.5px] leading-relaxed text-zinc-500">{t.proxies.info}</p>}

      <CreateSheet
        open={open?.kind === "create"}
        bridge={bridge}
        nodes={nodes}
        onClose={() => setOpen(null)}
        onCreated={(proxy, password) => {
          setLoad((current) => (current.kind === "ready" ? { kind: "ready", proxies: [...current.proxies, proxy] } : current));
          setOpen({ kind: "credentials", proxy, password });
        }}
      />
      <CredentialsSheet open={open?.kind === "credentials" ? open : null} bridge={bridge} onClose={() => setOpen(null)} />
      <DetailsSheet
        proxy={open?.kind === "details" ? details : null}
        pending={pending}
        onClose={() => setOpen(null)}
        onShowLink={(proxy) => setOpen({ kind: "credentials", proxy, password: "" })}
        onPatch={patch}
        onDelete={(id) => setOpen({ kind: "confirm", id })}
      />
      <ConfirmSheet
        open={open?.kind === "confirm"}
        onClose={() => setOpen(null)}
        title={format(t.proxies.removeTitle, { name: details?.name ?? "" })}
        description={t.proxies.removeDescription}
        confirmLabel={t.proxies.remove}
        icon={<TrashIcon weight="bold" className="size-4" />}
        pending={pending === "delete"}
        onConfirm={() => details && void remove(details.id)}
      />
    </div>
  );
}

function CreateSheet({
  open,
  bridge,
  nodes,
  onClose,
  onCreated,
}: {
  open: boolean;
  bridge: MantelBridge;
  nodes: readonly VpnNode[];
  onClose: () => void;
  onCreated: (proxy: ServerProxy, password: string) => void;
}) {
  const { t } = useI18n();
  const choices = nodes.filter((node) => node.online).sort((a, b) => a.city.localeCompare(b.city));
  const [name, setName] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [protocol, setProtocol] = useState<ProxyProtocol>("socks5");
  const [exit, setExit] = useState<ProxyExit>("direct");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
    setNodeId((current) => (choices.some((node) => node.id === current) ? current : (choices[0]?.id ?? "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    if (!bridge.createProxy) return;
    setPending(true);
    setError(null);
    const result = await bridge.createProxy({ name: name.trim(), nodeId, protocol, exit });
    setPending(false);
    if (!result.ok) setError(result.error);
    else onCreated(result.value.proxy, result.value.password ?? "");
  };

  return (
    <Sheet open={open} onClose={onClose} title={t.proxies.createTitle}>
      <form
        className="space-y-4 px-1"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor="proxy-name" className="block text-[12.5px] font-medium text-zinc-600">
            {t.proxies.nameLabel}
          </label>
          <input
            id="proxy-name"
            value={name}
            maxLength={MAX_PROXY_NAME}
            autoComplete="off"
            placeholder={t.proxies.namePlaceholder}
            onChange={(event) => setName(event.target.value)}
            className={FIELD}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="proxy-node" className="block text-[12.5px] font-medium text-zinc-600">
            {t.proxies.locationLabel}
          </label>
          <select id="proxy-node" value={nodeId} onChange={(event) => setNodeId(event.target.value)} className={cn(FIELD, "h-12 py-0")}>
            {choices.map((node) => (
              <option key={node.id} value={node.id}>
                {node.city} ({node.country})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <p className="text-[12.5px] font-medium text-zinc-600">{t.proxies.protocolLabel}</p>
          <Segmented
            label={t.proxies.protocolLabel}
            layoutId="proxy-protocol"
            value={protocol}
            onChange={setProtocol}
            options={PROXY_PROTOCOLS.map((value) => ({ value, label: t.proxies.protocols[value] }))}
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-[12.5px] font-medium text-zinc-600">{t.proxies.exitLabel}</p>
          <Segmented
            label={t.proxies.exitLabel}
            layoutId="proxy-exit"
            value={exit}
            onChange={setExit}
            options={PROXY_EXITS.map((value) => ({ value, label: t.proxies.exits[value] }))}
          />
          <p className="text-[12px] leading-relaxed text-zinc-500">{t.proxies.exitHints[exit]}</p>
        </div>
        <InlineError message={error} />
        <Button type="submit" size="lg" className="w-full" pending={pending} disabled={!name.trim() || !nodeId}>
          {t.proxies.create}
        </Button>
      </form>
    </Sheet>
  );
}

function CredentialsSheet({
  open,
  bridge,
  onClose,
}: {
  open: { proxy: ServerProxy; password: string } | null;
  bridge: MantelBridge;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const proxy = open?.proxy;
  if (proxy?.protocol === "mtproto") return <TelegramSheet proxy={proxy} bridge={bridge} onClose={onClose} />;
  return (
    <Sheet open={open !== null} onClose={onClose} title={t.proxies.credentialsTitle} description={proxy?.name}>
      {proxy && open && (
        <div className="space-y-2 px-1">
          <p className="rounded-2xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            {t.proxies.credentialsOnce}
          </p>
          {open.password && <CopyField bridge={bridge} label={t.proxies.url} value={proxyUrl(proxy, open.password)} />}
          <CopyField bridge={bridge} label={t.proxies.address} value={proxyAddress(proxy)} />
          <CopyField bridge={bridge} label={t.proxies.username} value={proxy.username} />
          {open.password && <CopyField bridge={bridge} label={t.proxies.password} value={open.password} />}
          <div className="pt-2">
            <Button size="lg" className="w-full" onClick={onClose}>
              {t.proxies.done}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function TelegramSheet({ proxy, bridge, onClose }: { proxy: ServerProxy; bridge: MantelBridge; onClose: () => void }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const openTelegram = async () => {
    if (!bridge.openTelegramProxy || !proxy.webLink) return;
    const result = await bridge.openTelegramProxy(proxy.webLink);
    setError(result.ok ? null : result.error);
  };
  return (
    <Sheet open onClose={onClose} title={t.proxies.telegramTitle} description={proxy.name}>
      <div className="space-y-2 px-1">
        <p className="px-0.5 text-[12.5px] leading-relaxed text-zinc-500">{t.proxies.telegramInfo}</p>
        {proxy.link && <CopyField bridge={bridge} label={t.proxies.telegramLink} value={proxy.link} />}
        {proxy.webLink && <CopyField bridge={bridge} label={t.proxies.webLink} value={proxy.webLink} />}
        <InlineError message={error} />
        <div className="space-y-2 pt-2">
          {bridge.openTelegramProxy && proxy.webLink && (
            <Button size="lg" className="w-full" onClick={() => void openTelegram()} icon={<PaperPlaneTiltIcon weight="bold" className="size-4" aria-hidden />}>
              {t.proxies.openTelegram}
            </Button>
          )}
          <Button variant="secondary" size="lg" className="w-full" onClick={onClose}>
            {t.proxies.close}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function DetailsSheet({
  proxy,
  pending,
  onClose,
  onShowLink,
  onPatch,
  onDelete,
}: {
  proxy: ServerProxy | null;
  pending: string | null;
  onClose: () => void;
  onShowLink: (proxy: ServerProxy) => void;
  onPatch: (id: string, patch: ProxyPatch, busy: string) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [circuitDone, setCircuitDone] = useState(false);
  const id = proxy?.id;
  useEffect(() => {
    setName(proxy?.name ?? "");
    setCircuitDone(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const trimmed = name.trim();
  const telegram = proxy?.protocol === "mtproto";
  return (
    <Sheet open={proxy !== null} onClose={onClose} title={proxy?.name ?? ""} description={proxy ? proxyAddress(proxy) : undefined}>
      {proxy && (
        <div className="space-y-4 px-1">
          <form
            className="space-y-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (trimmed && trimmed !== proxy.name) void onPatch(proxy.id, { name: trimmed }, "rename");
            }}
          >
            <label htmlFor="proxy-rename" className="block text-[12.5px] font-medium text-zinc-600">
              {t.proxies.nameLabel}
            </label>
            <div className="flex gap-2">
              <input id="proxy-rename" value={name} maxLength={MAX_PROXY_NAME} autoComplete="off" onChange={(event) => setName(event.target.value)} className={FIELD} />
              <Button type="submit" variant="secondary" pending={pending === "rename"} disabled={!trimmed || trimmed === proxy.name || pending !== null}>
                {t.proxies.rename}
              </Button>
            </div>
          </form>
          <div className="space-y-1.5">
            <p className="text-[12.5px] font-medium text-zinc-600">{t.proxies.exitLabel}</p>
            <Segmented
              label={t.proxies.exitLabel}
              layoutId="proxy-exit-edit"
              value={proxy.exit}
              onChange={(value) => void onPatch(proxy.id, { exit: value }, "exit")}
              options={PROXY_EXITS.map((value) => ({ value, label: t.proxies.exits[value] }))}
            />
            <p className="text-[12px] leading-relaxed text-zinc-500">{t.proxies.exitHints[proxy.exit]}</p>
          </div>
          <div className="space-y-2">
            {telegram && proxy.link && (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                disabled={pending !== null}
                onClick={() => onShowLink(proxy)}
                icon={<PaperPlaneTiltIcon weight="bold" className="size-4" aria-hidden />}
              >
                {t.proxies.showLink}
              </Button>
            )}
            {proxy.exit === "tor" && (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                pending={pending === "circuit"}
                disabled={pending !== null}
                onClick={() => void onPatch(proxy.id, { newCircuit: true }, "circuit").then((ok) => setCircuitDone(ok))}
                icon={<ArrowsClockwiseIcon weight="bold" className="size-4" aria-hidden />}
              >
                {circuitDone ? t.proxies.newCircuitDone : t.proxies.newCircuit}
              </Button>
            )}
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              pending={pending === "password"}
              disabled={pending !== null}
              onClick={() => void onPatch(proxy.id, { rotatePassword: true }, "password")}
              icon={<KeyIcon weight="bold" className="size-4" aria-hidden />}
            >
              {telegram ? t.proxies.rotateSecret : t.proxies.rotatePassword}
            </Button>
            <p className="px-1 text-[12px] text-zinc-500">{telegram ? t.proxies.rotateSecretHint : t.proxies.rotateHint}</p>
            <Button variant="danger" size="lg" className="w-full" disabled={pending !== null} onClick={() => onDelete(proxy.id)} icon={<TrashIcon className="size-4" aria-hidden />}>
              {t.proxies.remove}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
