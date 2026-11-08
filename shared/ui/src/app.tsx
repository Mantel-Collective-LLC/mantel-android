import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Activity, lazy, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CaretLeftIcon } from "@phosphor-icons/react";
import type {
  Account,
  ErrorCode,
  Environment,
  MantelBridge,
  Preferences,
  SessionInfo,
  TunnelStatus,
  VpnNode,
} from "../../core/contract";
import { showOpenWifiWarning } from "../../core/wifi";
import { BridgeMissingError, loadBridge } from "./bridge";
import { I18nProvider, translatorFor, useI18n } from "./i18n/context";
import { useFavoriteLocations } from "./lib/favorites";
import { isSelectable } from "./lib/locations";
import { useMeasuredLatency } from "./lib/latency";
import { useExcludedApps, useMediaQuery, useStableCallback, useSystemVpnState, useWifiSecurity } from "./lib/hooks";
import { IS_DEBUG } from "./lib/flavor";
import { resolveBack } from "./lib/navigation";
import { UpdateProvider, useUpdateCheck } from "./lib/update-check";
import { useAppliedTheme } from "./lib/theme";
import { applyPlatform, guessPlatform, isAndroid, isMac, showsDesktopTitleBar, withFeatures } from "./lib/platform";
import { AppsScreen } from "./screens/apps";
import { ConnectCard, EnvironmentBanner, OpenWifiNotice } from "./screens/home";
import { LoginScreen } from "./screens/login";
import { SettingsScreen, type SettingsPage } from "./screens/settings";
import { SupportScreen } from "./screens/support";
import { WireGuardMissingScreen } from "./screens/wireguard-missing";
import { MacHelperScreen } from "./screens/mac-helper";
import { ServiceRepairScreen } from "./screens/service-repair";
import { LocationBrowser, LocationButton } from "./ui/location-picker";
import { AppNav, type Tab } from "./ui/app-nav";
import { WorldMap } from "./ui/map/world-map";
import { approximateHome, deviceTimeZone } from "./lib/geo";
import { cn } from "./lib/cn";
import { PaidTimeCard } from "./ui/paid-time";
import { PqErrorActions, pqErrorOf } from "./ui/pq-error-actions";
import { INITIAL_REFRESH_STATE, nextRefreshState, type RefreshOutcome, type RefreshState } from "./refresh-state";
import { QuantumRequired } from "./ui/quantum-badge";
import { torActive } from "./ui/tor";
import { AlwaysOnHint, KillSwitchBanner, TunnelControls } from "./ui/tunnel-controls";
import { blockReason } from "./lib/protection";
import { Logo, SaveIndicator, SPRING } from "./ui/primitives";
import { UpdateBanner, UpdateRequiredScreen } from "./ui/update";
import { useLoginNotices } from "./lib/logins";
import { LoginNoticeBanner } from "./ui/login-notices";

const DebugScreen = import.meta.env.MANTEL_FLAVOR === "debug" ? lazy(() => import("./screens/debug")) : null;

type SubScreen = "apps" | SettingsPage | null;

const COLUMN = "mx-auto w-full max-w-[560px]";
const PAGE_COLUMN = "mx-auto h-full w-full max-w-[608px]";

const VIEW_IN = "motion-safe:animate-view-in";

const SAFE_BOTTOM = "android:pb-[env(safe-area-inset-bottom)]";

function TitleBar() {
  const { t } = useI18n();
  return (
    <header className="app-drag flex h-10 shrink-0 items-center gap-2 pl-4 pr-[148px] mac:pl-[84px] mac:pr-4">
      <Logo />
      {IS_DEBUG && (
        <span
          data-testid="debug-badge"
          className="rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-amber-800"
        >
          {t.debug.badge}
        </span>
      )}
    </header>
  );
}

function MobileHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center px-5">
      <Logo />
    </header>
  );
}

function pickNode(nodes: VpnNode[], preferred: string | null): string | null {
  const preferredNode = nodes.find((node) => node.id === preferred && isSelectable(node));
  return preferredNode?.id ?? nodes.find(isSelectable)?.id ?? null;
}

function MainView({
  bridge,
  environment,
  preferences,
  status,
  onPreferences,
  onLoggedOut,
  onOpenDebug,
}: {
  bridge: MantelBridge;
  environment: Environment;
  preferences: Preferences;
  status: TunnelStatus;
  onPreferences: (next: Preferences) => void;
  onLoggedOut: () => void;
  onOpenDebug?: () => void;
}) {
  const { features } = environment;
  const { t, format } = useI18n();
  const [tab, setTab] = useState<Tab>("connect");
  const [subScreen, setSubScreen] = useState<SubScreen>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [apiNodes, setNodes] = useState<VpnNode[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(preferences.lastNodeId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null);
  const favoriteLocations = useFavoriteLocations();
  const systemVpn = useSystemVpnState(bridge, features.systemLockdown, status.phase === "connected");
  const excludedApps = useExcludedApps(bridge, features.appExclusion);
  const logins = useLoginNotices(bridge);
  const wifi = useWifiSecurity(bridge, status.phase === "disconnected");
  const scrollRef = useRef<HTMLElement>(null);
  const settingsScroll = useRef(0);
  const restoreScroll = useRef<number | null>(null);

  const [refreshState, setRefreshState] = useState<RefreshState>(INITIAL_REFRESH_STATE);
  const loaded = useRef({ account: false, nodes: false });
  const refreshNotice = t.app.refreshFailed;
  const refresh = useCallback(async () => {
    const [accountResult, nodesResult] = await Promise.all([bridge.account(), bridge.nodes()]);
    if (accountResult.ok) {
      setAccount(accountResult.value);
      loaded.current.account = true;
    }
    if (nodesResult.ok) {
      setNodes(nodesResult.value);
      loaded.current.nodes = true;
    }
    setLoadingNodes(false);
    const failure = !accountResult.ok ? accountResult : !nodesResult.ok ? nodesResult : null;
    const outcome: RefreshOutcome = failure ? { ok: false, code: failure.code, error: failure.error } : { ok: true };
    const hasData = loaded.current.account && loaded.current.nodes;
    setRefreshState((previous) => nextRefreshState(previous, outcome, { hasData, noticeText: refreshNotice }));
  }, [bridge, refreshNotice]);

  const refreshAccount = useCallback(async () => {
    const result = await bridge.account();
    if (result.ok) setAccount(result.value);
  }, [bridge]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const supportAvailable = typeof bridge.supportOverview === "function";
  const [supportUnread, setSupportUnread] = useState(0);
  useEffect(() => {
    if (!bridge.supportUnread) return;
    const unreadOf = bridge.supportUnread;
    let disposed = false;
    const poll = () =>
      void unreadOf()
        .then((result) => {
          if (!disposed && result.ok) setSupportUnread(result.value.unread);
        })
        .catch(() => undefined);
    poll();
    const id = window.setInterval(() => {
      if (document.visibilityState !== "hidden") poll();
    }, 5 * 60_000);
    return () => {
      disposed = true;
      window.clearInterval(id);
    };
  }, [bridge]);
  const supportNav = useMemo(() => (supportAvailable ? { unread: supportUnread } : undefined), [supportAvailable, supportUnread]);

  const showTab = useStableCallback((next: Tab) => {
    if (next === tab) {
      if (next === "settings" && subScreen !== null) closeSubScreen();
      return;
    }
    if (next === "settings") void refreshAccount();
    restoreScroll.current = 0;
    setTab(next);
  });

  const openSubScreen = (next: Exclude<SubScreen, null>) => {
    settingsScroll.current = scrollRef.current?.scrollTop ?? 0;
    restoreScroll.current = 0;
    setSubScreen(next);
  };
  const openApps = () => openSubScreen("apps");

  const closeSubScreen = useCallback(() => {
    restoreScroll.current = settingsScroll.current;
    setSubScreen(null);
  }, []);

  useEffect(() => {
    const onBack = (event: Event) => {
      if (event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      const action = resolveBack({ subScreen: subScreen !== null, tab });
      if (action === "close-sub-screen") closeSubScreen();
      else if (action === "show-connect") {
        restoreScroll.current = 0;
        setTab("connect");
      }
      else return;
      event.preventDefault();
    };
    window.addEventListener("mantel:back", onBack);
    return () => window.removeEventListener("mantel:back", onBack);
  }, [subScreen, tab, closeSubScreen]);

  useEffect(() => {
    if (subScreen === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      closeSubScreen();
    };
    const onMouse = (event: MouseEvent) => {
      if (event.button !== 3 || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      closeSubScreen();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [subScreen, closeSubScreen]);

  const nodes = useMeasuredLatency(bridge, apiNodes, { phase: status.phase, active: tab === "locations" });

  const active = status.phase !== "disconnected";
  const effectiveSelected = useMemo(() => {
    if (active && status.nodeId) return status.nodeId;
    if (selectedId && nodes.some((node) => node.id === selectedId && isSelectable(node))) return selectedId;
    return pickNode(nodes, preferences.lastNodeId);
  }, [active, status.nodeId, selectedId, nodes, preferences.lastNodeId]);
  const selectedNode = nodes.find((node) => node.id === effectiveSelected) ?? null;

  const connectTo = async (nodeId: string) => {
    setBusy(true);
    setError(null);
    setErrorCode(null);
    const result = await bridge.connect(nodeId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setErrorCode(result.code);
    }
  };

  const toggle = async () => {
    if (status.phase === "disconnected") {
      if (effectiveSelected) await connectTo(effectiveSelected);
      return;
    }
    setBusy(true);
    setError(null);
    setErrorCode(null);
    const result = await bridge.disconnect();
    setBusy(false);
    if (!result.ok) setError(result.error);
  };

  const connectAlways = async () => {
    const saved = await bridge.setAutoConnectOpenWifi?.(true);
    if (saved?.ok) onPreferences(saved.value);
    if (effectiveSelected) await connectTo(effectiveSelected);
  };

  const select = async (node: VpnNode) => {
    setSelectedId(node.id);
    const saved = await bridge.selectNode(node.id);
    if (saved.ok) onPreferences(saved.value);
    if (active && node.id !== status.nodeId) await connectTo(node.id);
  };

  const platformReady = features.managedWireGuard ? environment.elevated && environment.wireguardInstalled : true;
  const canConnect = platformReady && selectedNode !== null;
  const blocked = blockReason({
    android: isAndroid(environment),
    phase: status.phase,
    firewallActive: status.firewallActive,
    alwaysOnKillSwitch: preferences.alwaysOnKillSwitch,
    systemLockdown: systemVpn.state?.supported ? systemVpn.state.lockdown : null,
  });
  const shownTab = useDeferredValue(tab);
  const shownSubScreen = useDeferredValue(subScreen);
  const view: Tab | Exclude<SubScreen, null> = shownTab === "settings" && shownSubScreen ? shownSubScreen : shownTab;
  useLayoutEffect(() => {
    if (restoreScroll.current === null || !scrollRef.current) return;
    scrollRef.current.scrollTop = restoreScroll.current;
    restoreScroll.current = null;
  }, [view]);
  const settingsPage: SettingsPage | null =
    view !== "connect" && view !== "settings" && view !== "locations" && view !== "support" && view !== "apps" ? view : null;

  const home = useMemo(
    () => approximateHome(deviceTimeZone(), environment.systemLocale ?? (typeof navigator !== "undefined" ? navigator.language : undefined)),
    [environment.systemLocale],
  );
  const mapNode = active && status.nodeId ? (nodes.find((node) => node.id === status.nodeId) ?? selectedNode) : selectedNode;
  const wide = useMediaQuery("(min-width: 1024px)");
  const map = (fill: boolean) => <WorldMap nodes={nodes} node={mapNode} phase={status.phase} home={home} fill={fill} />;
  const openLocations = useStableCallback(() => showTab("locations"));
  const openSettings = useStableCallback(() => showTab("settings"));
  const showConnect = useStableCallback(() => {
    closeSubScreen();
    showTab("connect");
  });
  const openLogins = useStableCallback(() => {
    showTab("settings");
    openSubScreen("logins");
  });
  const chooseFromList = useStableCallback((node: VpnNode) => {
    void select(node);
    showTab("connect");
  });
  const mapPane = view === "connect" || view === "locations";

  const locationButton = (
    <LocationButton node={selectedNode} nodes={nodes} loading={loadingNodes} inline onOpen={openLocations} />
  );

  return (
    <QuantumRequired.Provider value={preferences.postQuantum === true}>
      <div className="flex min-h-0 flex-1">
        <AppNav orientation="rail" tab={tab} phase={status.phase} onChange={showTab} support={supportNav} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            {mapPane && wide && (
              <aside className="hidden min-w-0 flex-1 p-4 pr-0 lg:block">
                <div className="h-full overflow-hidden rounded-[28px] border border-zinc-200/70 bg-surface shadow-card">
                  {map(true)}
                </div>
              </aside>
            )}
            <div className={cn("flex min-h-0 min-w-0 flex-col", mapPane ? "flex-1 lg:w-[440px] lg:flex-none" : "flex-1")}>
              {view !== "connect" && view !== "settings" && view !== "locations" && view !== "support" && (
                <div className="mx-auto w-full max-w-[592px] px-4 pb-2 lg:pt-3">
                  <div className="flex h-[38px] items-center justify-between gap-3 android:h-[52px]">
                    <button
                      type="button"
                      onClick={closeSubScreen}
                      className="-ml-2 flex h-9 items-center gap-1 rounded-xl pl-1.5 pr-3 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent android:h-11"
                    >
                      <CaretLeftIcon weight="bold" className="size-4" />
                      {t.app.backToSettings}
                    </button>
                    {view === "apps" && <SaveIndicator state={excludedApps.saveState} />}
                  </div>
                </div>
              )}
              <main
                ref={scrollRef}
                className={cn(
                  "scroll-area min-h-0 flex-1 px-4 pb-6 pt-1 lg:pt-4",
                  "lg:android:pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
                )}
              >
                <Activity mode={view === "connect" ? "visible" : "hidden"}>
                    <div className={`${COLUMN} space-y-3 ${VIEW_IN}`}>
                      <UpdateBanner />
                      <LoginNoticeBanner notices={logins} onReview={openLogins} />
                      <EnvironmentBanner environment={environment} />
                      {!wide && (
                        <div className="overflow-hidden rounded-[28px] border border-zinc-200/70 bg-surface shadow-card">
                          {map(false)}
                        </div>
                      )}
                      <ConnectCard
                        status={status}
                        node={selectedNode}
                        busy={busy}
                        canConnect={canConnect}
                        error={error ?? (refreshState.message?.tone === "error" ? refreshState.message.text : null)}
                        notice={refreshState.message?.tone === "notice" ? refreshState.message.text : null}
                        protection={{
                          android: isAndroid(environment),
                          systemLockdown: systemVpn.state?.supported ? systemVpn.state.lockdown : null,
                        }}
                        location={locationButton}
                        tor={torActive(account, status)}
                        blocked={blocked !== null}
                        onToggle={() => void toggle()}
                      />
                      {blocked && (
                        <KillSwitchBanner
                          bridge={bridge}
                          reason={blocked}
                          onPreferences={onPreferences}
                          onReconnect={
                            canConnect && effectiveSelected
                              ? async () => {
                                  await connectTo(effectiveSelected);
                                }
                              : undefined
                          }
                        />
                      )}
                      {showOpenWifiWarning(wifi, status.phase) && (
                        <OpenWifiNotice
                          canConnect={canConnect}
                          busy={busy}
                          autoConnect={bridge.setAutoConnectOpenWifi ? preferences.autoConnectOpenWifi === true : null}
                          onConnect={() => void toggle()}
                          onAlwaysConnect={() => void connectAlways()}
                        />
                      )}
                      {status.revoked && features.systemLockdown && systemVpn.state?.alwaysOn && <AlwaysOnHint bridge={bridge} />}
                      <PqErrorActions
                        error={status.phase === "disconnected" ? pqErrorOf(errorCode, error ?? status.error, t.errors) : null}
                        bridge={bridge}
                        preferences={preferences}
                        onPreferences={onPreferences}
                        onPickLocation={openLocations}
                        onConnect={async () => {
                          if (effectiveSelected) await connectTo(effectiveSelected);
                        }}
                      />
                      <PaidTimeCard bridge={bridge} account={account} onOpen={openSettings} />
                    </div>
                </Activity>
                <Activity mode={view === "locations" ? "visible" : "hidden"}>
                    <div className={`${COLUMN} ${VIEW_IN}`}>
                      <header className="px-1 pb-3 pt-1">
                        <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em] text-ink">{t.locations.pageTitle}</h1>
                        <p className="mt-1 text-[13.5px] leading-relaxed text-zinc-500">{t.locations.pageHint}</p>
                        <p className="mt-2 font-mono text-[11px] tabular-nums text-zinc-400">
                          {format(t.locations.available, { available: nodes.filter(isSelectable).length, total: nodes.length })}
                        </p>
                      </header>
                      {loadingNodes && nodes.length === 0 ? (
                        <div aria-label={t.locations.loading} className="space-y-2">
                          {[0, 1, 2].map((index) => (
                            <span key={index} className="block h-24 animate-pulse rounded-[22px] bg-zinc-100" />
                          ))}
                        </div>
                      ) : (
                        <LocationBrowser
                          nodes={nodes}
                          selectedId={effectiveSelected}
                          activeId={active ? status.nodeId : null}
                          favorites={favoriteLocations.favorites}
                          onToggleFavorite={favoriteLocations.toggle}
                          onChoose={chooseFromList}
                          autoFocus={false}
                          layout="page"
                          keyboardHint={features.desktopWindow}
                        />
                      )}
                    </div>
                </Activity>
                {supportAvailable && (
                  <Activity mode={view === "support" ? "visible" : "hidden"}>
                    <div className={`${COLUMN} has-[[data-chat]]:h-full ${VIEW_IN}`}>
                      <SupportScreen bridge={bridge} onUnread={setSupportUnread} />
                    </div>
                  </Activity>
                )}
                <Activity mode={shownTab === "settings" ? "visible" : "hidden"}>
                  {view === "apps" ? (
                    <div key="apps" className={`${COLUMN} ${VIEW_IN}`}>
                      <AppsScreen
                        bridge={bridge}
                        excluded={excludedApps.excluded}
                        error={excludedApps.error}
                        lockdown={systemVpn.state?.supported === true && systemVpn.state.lockdown}
                        onToggle={excludedApps.toggle}
                      />
                    </div>
                  ) : (
                    <div
                      key={settingsPage ? `settings:${settingsPage}` : "settings"}
                      className={cn(COLUMN, !settingsPage && "lg:max-w-[980px]", VIEW_IN)}
                    >
                      <SettingsScreen
                        bridge={bridge}
                        account={account}
                        environment={environment}
                        preferences={preferences}
                        firewallActive={status.firewallActive}
                        phase={status.phase}
                        systemVpn={systemVpn}
                        excludedCount={excludedApps.excluded?.length ?? null}
                        logins={logins}
                        onOpenApps={openApps}
                        onAccount={setAccount}
                        onPreferences={onPreferences}
                        onLoggedOut={onLoggedOut}
                        onOpenDebug={onOpenDebug}
                        page={settingsPage}
                        onOpenPage={openSubScreen}
                        nodes={nodes}
                        onShowConnect={showConnect}
                      />
                    </div>
                  )}
                </Activity>
              </main>
            </div>
          </div>
          <AppNav orientation="bar" tab={tab} phase={status.phase} onChange={showTab} support={supportNav} />
        </div>
      </div>
    </QuantumRequired.Provider>
  );
}

export function App() {
  const [bridge, setBridge] = useState<MantelBridge | null>(null);
  const [fatal, setFatal] = useState<{ error: unknown } | null>(null);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [sessionNotice, setSessionNotice] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  const update = useUpdateCheck(bridge, environment?.appVersion);

  const checkEnvironment = useCallback(async (target: MantelBridge) => {
    setEnvironment(withFeatures(await target.environment()));
  }, []);

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    void loadBridge()
      .then(async (loaded) => {
        if (disposed) return;
        setBridge(loaded);
        cleanups.push(loaded.onTunnelStatus(setStatus));
        cleanups.push(
          loaded.onSessionEnded(() => {
            setSession({ loggedIn: false, accountId: null, paidUntil: null });
            setSessionNotice(true);
          }),
        );
        const [env, currentSession, prefs, currentStatus] = await Promise.all([
          loaded.environment(),
          loaded.session(),
          loaded.preferences(),
          loaded.tunnelStatus(),
        ]);
        if (disposed) return;
        setEnvironment(withFeatures(env));
        setSession(currentSession);
        setPreferences(prefs);
        setStatus(currentStatus);
      })
      .catch((error: unknown) => setFatal({ error }));
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    if (!bridge) return;
    let disposed = false;
    const refresh = () => {
      void Promise.all([bridge.environment(), bridge.preferences()])
        .then(([env, prefs]) => {
          if (disposed) return;
          setEnvironment(withFeatures(env));
          setPreferences(prefs);
        })
        .catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("languagechange", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.removeEventListener("languagechange", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [bridge]);

  const platform = environment?.platform ?? guessPlatform();
  useEffect(() => applyPlatform(platform), [platform]);
  useAppliedTheme(preferences, bridge);

  const i18n = useMemo(() => translatorFor(preferences?.language, environment), [preferences?.language, environment]);
  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);
  useEffect(() => {
    if (IS_DEBUG) document.title = "Mantel Debug";
  }, []);
  const { t } = i18n;
  const fatalMessage = fatal
    ? fatal.error instanceof BridgeMissingError
      ? t.app.bridgeMissing
      : fatal.error instanceof Error && fatal.error.message
        ? fatal.error.message
        : t.app.startFailed
    : null;

  const desktopWindow = showsDesktopTitleBar(environment, platform);
  const ready = bridge && environment && session && preferences && status;
  const loginBlock =
    ready && !isAndroid(environment)
      ? blockReason({
          android: false,
          phase: status.phase,
          firewallActive: status.firewallActive,
          alwaysOnKillSwitch: preferences.alwaysOnKillSwitch,
          systemLockdown: null,
        })
      : null;
  const openDebug = DebugScreen && bridge?.debug ? () => setDebugOpen(true) : bridge?.openDebugMenu;

  return (
    <I18nProvider translator={i18n}>
      <UpdateProvider value={update}>
      <MotionConfig reducedMotion="user">
        <div className="flex h-full flex-col bg-canvas android:h-dvh android:pl-[env(safe-area-inset-left)] android:pr-[env(safe-area-inset-right)] android:pt-[env(safe-area-inset-top)]">
          {desktopWindow ? <TitleBar /> : <MobileHeader />}
          {fatalMessage && <p className="px-6 pt-6 text-[13px] text-red-600">{fatalMessage}</p>}
          {!ready && !fatal && (
            <div className="grid flex-1 place-items-center">
              <span className="size-5 animate-spin rounded-full border-2 border-zinc-200 border-t-accent" aria-label={t.app.loading} />
            </div>
          )}
          {ready && (
            <AnimatePresence mode="wait" initial={false}>
              {DebugScreen && debugOpen && bridge.debug ? (
                <motion.div
                  key="debug"
                  className={`scroll-area flex-1 px-4 pb-5 ${SAFE_BOTTOM}`}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={SPRING}
                >
                  <Suspense
                    fallback={
                      <div className="grid h-40 place-items-center">
                        <span className="size-5 animate-spin rounded-full border-2 border-zinc-200 border-t-accent" />
                      </div>
                    }
                  >
                    <div className={COLUMN}>
                      <DebugScreen
                        bridge={bridge}
                        debug={bridge.debug}
                        preferences={preferences}
                        status={status}
                        onPreferences={setPreferences}
                        onBack={() => setDebugOpen(false)}
                        onReset={() => {
                          setSession({ loggedIn: false, accountId: null, paidUntil: null });
                          void bridge.preferences().then(setPreferences).catch(() => undefined);
                        }}
                      />
                    </div>
                  </Suspense>
                </motion.div>
              ) : update.state.kind === "required" ? (
                <motion.div key="update-required" className={`scroll-area flex-1 ${SAFE_BOTTOM}`} exit={{ opacity: 0 }}>
                  <div className={PAGE_COLUMN}>
                    <UpdateRequiredScreen bridge={bridge} status={status} currentVersion={environment.appVersion} />
                  </div>
                </motion.div>
              ) : environment.features.managedWireGuard && (!environment.wireguardInstalled || !environment.elevated) ? (
                <motion.div key="missing" className={`scroll-area flex-1 ${SAFE_BOTTOM}`} exit={{ opacity: 0 }}>
                  <div className={PAGE_COLUMN}>
                    <TunnelControls bridge={bridge} environment={environment} status={status} className="mx-6 mt-4" />
                    {isMac(environment) ? (
                      <MacHelperScreen bridge={bridge} environment={environment} onRetry={() => checkEnvironment(bridge)} />
                    ) : !environment.elevated ? (
                      <ServiceRepairScreen bridge={bridge} onRetry={() => checkEnvironment(bridge)} />
                    ) : (
                      <WireGuardMissingScreen
                        bridge={bridge}
                        environment={environment}
                        onRetry={() => checkEnvironment(bridge)}
                      />
                    )}
                  </div>
                </motion.div>
              ) : !session.loggedIn ? (
                <motion.div key="login" className={`scroll-area flex-1 ${SAFE_BOTTOM}`} exit={{ opacity: 0, y: -8 }}>
                  <div className={PAGE_COLUMN}>
                    {sessionNotice && (
                      <p className="mx-6 mt-4 rounded-2xl border border-zinc-200/80 bg-surface px-4 py-3 text-[13px] text-zinc-600">
                        {t.app.sessionExpired}
                      </p>
                    )}
                    <TunnelControls bridge={bridge} environment={environment} status={status} className="mx-6 mt-4 space-y-0" />
                    {loginBlock && loginBlock !== "lost" && (
                      <KillSwitchBanner bridge={bridge} reason={loginBlock} onPreferences={setPreferences} className="mx-6 mt-4" />
                    )}
                    <LoginScreen
                      bridge={bridge}
                      preferences={preferences}
                      firewallActive={status.firewallActive}
                      onPreferences={setPreferences}
                      onLoggedIn={(next) => {
                        setSessionNotice(false);
                        setSession(next);
                      }}
                      onOpenDebug={openDebug}
                    />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="main"
                  className="flex min-h-0 flex-1 flex-col"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={SPRING}
                >
                  <MainView
                    bridge={bridge}
                    environment={environment}
                    preferences={preferences}
                    status={status}
                    onPreferences={setPreferences}
                    onLoggedOut={() => setSession({ loggedIn: false, accountId: null, paidUntil: null })}
                    onOpenDebug={openDebug}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </MotionConfig>
      </UpdateProvider>
    </I18nProvider>
  );
}
