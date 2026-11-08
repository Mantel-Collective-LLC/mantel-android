import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { CaretLeftIcon, ChatCircleTextIcon, LockKeyIcon, PlusIcon } from "@phosphor-icons/react";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_MAX_CHARS,
  type MantelBridge,
  type SupportCategory,
  type SupportOverview,
  type SupportThread,
  type SupportTicketSummary,
} from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";
import { useChatScroll } from "../lib/hooks";
import { Badge, Button, Card, FOCUS_RING, InlineError } from "../ui/primitives";

type View = { kind: "list" } | { kind: "new" } | { kind: "thread"; id: string };

const POLL_MS = 30_000;

function chars(text: string): number {
  return [...text].length;
}

export function useSupportPolling(load: () => Promise<void>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load, active]);
}

export function SupportScreen({ bridge, onUnread }: { bridge: MantelBridge; onUnread?: (count: number) => void }) {
  const { t } = useI18n();
  const [view, setView] = useState<View>({ kind: "list" });
  const [overview, setOverview] = useState<SupportOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    if (!bridge.supportOverview) return;
    const result = await bridge.supportOverview();
    if (result.ok) {
      setOverview(result.value);
      setError(null);
      onUnread?.(result.value.unread);
    } else setError(result.error);
  }, [bridge, onUnread]);

  useSupportPolling(loadOverview, view.kind === "list");

  useEffect(() => {
    if (view.kind === "list") return;
    const back = (event: Event) => {
      if (event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      setView({ kind: "list" });
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") back(event);
    };
    window.addEventListener("mantel:back", back);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mantel:back", back);
      window.removeEventListener("keydown", key);
    };
  }, [view.kind]);

  const openList = () => {
    setView({ kind: "list" });
    void loadOverview();
  };

  return (
    <div data-chat={view.kind === "thread" || undefined} className={cn("space-y-3", view.kind === "thread" && "flex h-full flex-col")}>
      <header className="shrink-0 px-1 pb-1 pt-1">
        <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em] text-ink">{t.support.title}</h1>
        <p className="mt-1 text-[13.5px] leading-relaxed text-zinc-500">{t.support.hint}</p>
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-zinc-500">
          <LockKeyIcon weight="fill" className="size-3.5 shrink-0 text-accent" aria-hidden />
          {t.support.e2e}
        </p>
      </header>
      {view.kind === "list" && (
        <SupportList
          overview={overview}
          error={error}
          notice={notice}
          onNew={() => {
            setNotice(null);
            setView({ kind: "new" });
          }}
          onOpen={(id) => {
            setNotice(null);
            setView({ kind: "thread", id });
          }}
        />
      )}
      {view.kind === "new" && (
        <NewTicket
          bridge={bridge}
          onCancel={openList}
          onCreated={(created) => {
            setNotice(null);
            setView({ kind: "thread", id: created.id });
          }}
        />
      )}
      {view.kind === "thread" && <ThreadView bridge={bridge} id={view.id} onBack={openList} onUnread={() => void loadOverview()} />}
    </div>
  );
}

function StatusChip({ ticket }: { ticket: Pick<SupportTicketSummary, "status"> }) {
  const { t } = useI18n();
  if (ticket.status === "waiting") return <Badge tone="accent">{t.support.statusWaiting}</Badge>;
  if (ticket.status === "closed") return <Badge>{t.support.statusClosed}</Badge>;
  return <Badge tone="warn">{t.support.statusOpen}</Badge>;
}

function SupportList({
  overview,
  error,
  notice,
  onNew,
  onOpen,
}: {
  overview: SupportOverview | null;
  error: string | null;
  notice: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const { t, format } = useI18n();
  if (!overview) {
    return (
      <div aria-label={t.support.loading} className="space-y-2">
        {error ? <InlineError message={error} className="px-1" /> : [0, 1].map((index) => <span key={index} className="block h-20 animate-pulse rounded-[22px] bg-zinc-100" />)}
      </div>
    );
  }
  const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
  return (
    <div className="space-y-3">
      <InlineError message={error} className="px-1" />
      {notice && <p className="px-1 text-[13px] text-zinc-600">{notice}</p>}
      {!overview.available ? (
        <Card className="p-5 text-[14px] leading-relaxed text-zinc-600">{t.support.unavailable}</Card>
      ) : (
        <Button variant="primary" size="lg" className="w-full" icon={<PlusIcon weight="bold" className="size-4" aria-hidden />} onClick={onNew}>
          {t.support.newTicket}
        </Button>
      )}
      {overview.tickets.length === 0 ? (
        overview.available && <p className="px-1 py-4 text-center text-[13.5px] text-zinc-500">{t.support.empty}</p>
      ) : (
        <ul className="space-y-2" data-testid="support-list">
          {overview.tickets.map((ticket) => (
            <li key={ticket.id}>
              <button
                type="button"
                onClick={() => onOpen(ticket.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-[22px] border border-zinc-200/70 bg-surface p-4 text-left shadow-card transition-colors hover:border-zinc-300",
                  FOCUS_RING,
                )}
              >
                <ChatCircleTextIcon weight={ticket.unread > 0 ? "fill" : "regular"} className={cn("mt-0.5 size-5 shrink-0", ticket.unread > 0 ? "text-accent" : "text-zinc-400")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[12px] text-zinc-500">
                    <span className="font-mono tabular-nums">#{ticket.number}</span>
                    <span>{t.support.categories[ticket.category]}</span>
                    <span className="ml-auto tabular-nums">{date(ticket.updatedAt)}</span>
                  </span>
                  <span className={cn("mt-1 block truncate text-[14.5px]", ticket.readable ? "text-ink" : "italic text-zinc-500", ticket.unread > 0 && "font-semibold")}>
                    {ticket.readable ? (ticket.title ?? t.support.undecryptable) : t.support.otherDevice}
                  </span>
                  <span className="mt-2 flex items-center gap-2">
                    <StatusChip ticket={ticket} />
                    {ticket.unread > 0 && (
                      <span className="text-[12px] font-medium text-accent-strong dark:text-accent">{format(t.support.badge, { count: ticket.unread })}</span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Counter({ text }: { text: string }) {
  const { t, format } = useI18n();
  const count = chars(text);
  return (
    <span className={cn("font-mono text-[11px] tabular-nums", count > SUPPORT_MAX_CHARS ? "text-red-600" : "text-zinc-400")}>
      {format(t.support.counter, { count, max: SUPPORT_MAX_CHARS })}
    </span>
  );
}

const FIELD = cn(
  "w-full rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-[14.5px] text-ink placeholder:text-zinc-400",
  "outline-none focus-visible:border-zinc-300 focus-visible:ring-2 focus-visible:ring-accent",
);

function NewTicket({ bridge, onCancel, onCreated }: { bridge: MantelBridge; onCancel: () => void; onCreated: (created: { id: string; number: number }) => void }) {
  const { t, format } = useI18n();
  const categoryId = useId();
  const messageId = useId();
  const [category, setCategory] = useState<SupportCategory>("connection");
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!bridge.supportCreate || pending) return;
    if (!text.trim()) return setError(t.errors.supportEmpty);
    if (chars(text) > SUPPORT_MAX_CHARS) return setError(format(t.errors.supportTooLong, { max: SUPPORT_MAX_CHARS }));
    setPending(true);
    setError(null);
    const result = await bridge.supportCreate(category, text);
    setPending(false);
    if (result.ok) onCreated(result.value);
    else setError(result.error);
  };

  return (
    <Card className="p-5">
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <button type="button" onClick={onCancel} className={cn("-ml-2 flex h-9 items-center gap-1 rounded-xl pl-1.5 pr-3 text-[13px] font-medium text-zinc-600 hover:bg-zinc-100", FOCUS_RING)}>
          <CaretLeftIcon weight="bold" className="size-4" aria-hidden />
          {t.support.back}
        </button>
        <div className="space-y-1.5">
          <label htmlFor={categoryId} className="block text-[13px] font-medium text-zinc-700">
            {t.support.categoryLabel}
          </label>
          <select id={categoryId} value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)} className={cn(FIELD, "h-12 py-0")}>
            {SUPPORT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t.support.categories[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor={messageId} className="block text-[13px] font-medium text-zinc-700">
              {t.support.messageLabel}
            </label>
            <Counter text={text} />
          </div>
          <textarea
            id={messageId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={7}
            placeholder={t.support.messagePlaceholder}
            className={cn(FIELD, "resize-y")}
          />
        </div>
        <InlineError message={error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="md" pending={pending} disabled={!text.trim()}>
            {t.support.create}
          </Button>
          <Button variant="ghost" size="md" onClick={onCancel}>
            {t.support.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ThreadView({ bridge, id, onBack, onUnread }: { bridge: MantelBridge; id: string; onBack: () => void; onUnread: () => void }) {
  const { t, format } = useI18n();
  const replyId = useId();
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const { attach: chatBox, pin: pinChat } = useChatScroll<HTMLOListElement>(thread);

  const load = useCallback(async () => {
    if (!bridge.supportTicket) return;
    const result = await bridge.supportTicket(id);
    if (result.ok) {
      setThread(result.value);
      setError(null);
    } else setError(result.error);
  }, [bridge, id]);

  useSupportPolling(load, true);

  useEffect(() => {
    if (thread) onUnread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.messageCount]);

  const act = async (task: () => Promise<{ ok: true; value: SupportThread } | { ok: false; error: string }>) => {
    setPending(true);
    setError(null);
    const result = await task();
    setPending(false);
    if (result.ok) {
      setThread(result.value);
      return true;
    }
    setError(result.error);
    return false;
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!bridge.supportReply || !text.trim() || pending || chars(text) > SUPPORT_MAX_CHARS) return;
    const reply = bridge.supportReply;
    pinChat();
    if (await act(() => reply(id, text))) setText("");
  };

  const toggleClosed = (closed: boolean) => {
    if (!bridge.supportSetClosed) return;
    const setClosed = bridge.supportSetClosed;
    void act(() => setClosed(id, closed));
  };

  const time = (ms: number) => new Date(ms).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <Card className="flex min-h-80 flex-1 flex-col p-5">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <button type="button" onClick={onBack} className={cn("-ml-2 flex h-9 items-center gap-1 rounded-xl pl-1.5 pr-3 text-[13px] font-medium text-zinc-600 hover:bg-zinc-100", FOCUS_RING)}>
          <CaretLeftIcon weight="bold" className="size-4" aria-hidden />
          {t.support.back}
        </button>
        {thread && <StatusChip ticket={thread} />}
      </div>
      {!thread ? (
        error ? <InlineError message={error} className="mt-4" /> : <span className="mt-4 block h-24 animate-pulse rounded-2xl bg-zinc-100" aria-label={t.support.loading} />
      ) : (
        <>
          <h2 className="mt-3 shrink-0 text-[18px] font-medium tracking-[-0.02em] text-ink">
            {format(t.support.ticketLabel, { number: thread.number })} · {t.support.categories[thread.category]}
          </h2>
          {!thread.readable ? (
            <p className="mt-3 shrink-0 rounded-2xl bg-zinc-100 p-4 text-[13.5px] leading-relaxed text-zinc-600">{t.support.otherDeviceHint}</p>
          ) : (
            <ol
              ref={chatBox}
              aria-label={format(t.support.threadLabel, { number: thread.number })}
              className="scroll-area -mx-2 mt-4 min-h-0 flex-1 space-y-3 overscroll-contain px-2 py-1"
              data-testid="support-thread"
            >
              {thread.messages.map((message) => {
                const own = message.role === "user";
                return (
                  <li key={message.seq} className={cn("flex", own ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-[20px] px-4 py-2.5",
                        own ? "rounded-br-md bg-ink text-on-ink" : "rounded-bl-md border border-zinc-200 bg-zinc-50 text-ink",
                      )}
                    >
                      <p className={cn("mb-0.5 text-[11.5px]", own ? "text-on-ink/70" : "text-zinc-500")}>
                        {own ? t.support.you : t.support.team} · {time(message.createdAt)}
                      </p>
                      {message.text === null ? (
                        <p className="text-[13.5px] italic opacity-80">{t.support.undecryptable}</p>
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">{message.text}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <InlineError message={error} className="mt-3 shrink-0" />
          {thread.status === "closed" ? (
            <div className="mt-4 shrink-0 space-y-3">
              <p className="text-[13px] text-zinc-500">{t.support.closedHint}</p>
              <Button variant="secondary" size="md" pending={pending} onClick={() => toggleClosed(false)}>
                {t.support.reopen}
              </Button>
            </div>
          ) : (
            thread.readable && (
              <form onSubmit={(event) => void send(event)} className="mt-4 shrink-0 space-y-2">
                <div className="flex items-baseline justify-between">
                  <label htmlFor={replyId} className="text-[13px] font-medium text-zinc-700">
                    {t.support.replyLabel}
                  </label>
                  <Counter text={text} />
                </div>
                <textarea id={replyId} value={text} onChange={(event) => setText(event.target.value)} rows={3} placeholder={t.support.replyPlaceholder} className={cn(FIELD, "max-h-[40vh] resize-y")} />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="primary" size="md" pending={pending} disabled={!text.trim() || chars(text) > SUPPORT_MAX_CHARS}>
                    {t.support.send}
                  </Button>
                  <Button variant="ghost" size="md" disabled={pending} onClick={() => toggleClosed(true)}>
                    {t.support.close}
                  </Button>
                </div>
              </form>
            )
          )}
        </>
      )}
    </Card>
  );
}
