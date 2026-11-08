import { useEffect, useMemo, useRef, useState } from "react";
import type { MantelBridge, TunnelPhase, VpnNode } from "../../../core/contract";
import { medianLatency, pingableNodes, shouldMeasure } from "../../../core/latency";

export function useMeasuredLatency(
  bridge: Pick<MantelBridge, "measureLatency">,
  nodes: readonly VpnNode[],
  options: { phase: TunnelPhase; active: boolean },
): VpnNode[] {
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(() => new Map());
  const state = useRef<{ lastAt: number | null; lastKey: string; running: boolean }>({ lastAt: null, lastKey: "", running: false });
  const [tick, setTick] = useState(0);
  const targets = useMemo(() => pingableNodes(nodes), [nodes]);
  const key = targets.map((node) => `${node.id}:${node.pingPort}`).join(",");
  const measure = bridge.measureLatency;

  useEffect(() => {
    if (!options.active) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(id);
  }, [options.active]);

  useEffect(() => {
    if (!measure) return;
    const current = state.current;
    const firstRun = current.lastAt === null;
    if (!firstRun && !options.active) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const go = shouldMeasure({
      phase: options.phase,
      running: current.running,
      lastAt: current.lastAt,
      now: Date.now(),
      targetsChanged: key !== current.lastKey,
      hasTargets: targets.length > 0,
    });
    if (!go) return;
    current.running = true;
    const ids = targets.map((node) => node.id);
    void measure(ids)
      .then((results) => {
        if (results.length === 0) return;
        current.lastAt = Date.now();
        current.lastKey = key;
        const next = new Map<string, number>();
        for (const result of results) {
          const median = medianLatency(result.samples);
          if (median !== undefined && ids.includes(result.id)) next.set(result.id, median);
        }
        setMeasured(next);
      })
      .catch(() => undefined)
      .finally(() => {
        current.running = false;
      });
  }, [measure, options.phase, options.active, key, targets, tick]);

  return useMemo(() => nodes.map((node) => ({ ...node, latencyMs: measured.get(node.id) })), [nodes, measured]);
}
