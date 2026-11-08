import { useReducedMotion } from "motion/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TunnelPhase, VpnNode } from "../../../../core/contract";
import { useI18n } from "../../i18n/context";
import { cn } from "../../lib/cn";
import { locationCoordinates, type LatLon } from "../../lib/geo";
import { countryName, isSelectable } from "../../lib/locations";
import { arcPath, focusCamera, landBounds, project, thinDots, worldCamera, worldDots, type Camera, type Dot, type Point } from "./projection";
import { WORLD } from "./world-dots";

const ALL_DOTS = worldDots();
const BOUNDS = landBounds(ALL_DOTS);
const STRIDES = [1, 2, 3, 4, 5] as const;
const strideCache = new Map<number, Dot[]>();
function strideDots(stride: number): Dot[] {
  let dots = strideCache.get(stride);
  if (!dots) {
    dots = thinDots(ALL_DOTS, stride);
    strideCache.set(stride, dots);
  }
  return dots;
}
const CELL_PX = 6.5;
const GLOW_RADIUS = 46;
const FLIGHT_MS = 1100;
const CROSSFADE_MS = 600;

type Tone = "on" | "stale" | "pending" | "off";

function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize((previous) =>
        Math.abs(previous.width - rect.width) < 0.5 && Math.abs(previous.height - rect.height) < 0.5
          ? previous
          : { width: rect.width, height: rect.height },
      );
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setVersion((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return version;
}

type Palette = { land: string; accent: string; stale: string; pending: string };

function readPalette(element: Element): Palette {
  const style = getComputedStyle(element);
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    land: color("--color-zinc-300", "#d4d4d8"),
    accent: color("--color-accent", "#10b981"),
    stale: color("--color-red-400", "#f87171"),
    pending: color("--color-amber-400", "#fbbf24"),
  };
}

type Layer = { stride: number; alpha: number; zoom: number };

type Marker = { key: string; point: Point; selectable: boolean };

type Scene = {
  width: number;
  height: number;
  settled: Camera;
  lit: Dot[];
  target: Point | null;
  tone: Tone;
  engaged: boolean;
  stride: number;
  palette: Palette;
};

const sprites = new Map<string, HTMLCanvasElement>();
function dotSprite(color: string, diameter: number): HTMLCanvasElement {
  const size = Math.max(1, Math.round(diameter * 4) / 4);
  const key = `${color}|${size}`;
  let sprite = sprites.get(key);
  if (!sprite) {
    sprite = document.createElement("canvas");
    const box = Math.ceil(size) + 2;
    sprite.width = box;
    sprite.height = box;
    const context = sprite.getContext("2d");
    if (context) {
      context.fillStyle = color;
      context.beginPath();
      context.arc(box / 2, box / 2, size / 2, 0, Math.PI * 2);
      context.fill();
    }
    if (sprites.size > 64) sprites.clear();
    sprites.set(key, sprite);
  }
  return sprite;
}

function dotUnits(stride: number, pxPerUnit: number): number {
  return Math.min(stride * WORLD.step * 0.46, 3.6 / pxPerUnit);
}

const BITMAP_SCALE = 2;
const bitmaps = new Map<string, HTMLCanvasElement>();
function bitmapKey(stride: number, diameter: number, color: string): string {
  return `${stride}|${diameter.toFixed(2)}|${color}`;
}
function gridBitmap(stride: number, diameter: number, color: string): HTMLCanvasElement {
  const key = bitmapKey(stride, diameter, color);
  let bitmap = bitmaps.get(key);
  if (!bitmap) {
    bitmap = document.createElement("canvas");
    bitmap.width = Math.ceil(BOUNDS.width * BITMAP_SCALE);
    bitmap.height = Math.ceil(BOUNDS.height * BITMAP_SCALE);
    const context = bitmap.getContext("2d");
    if (context) {
      const sprite = dotSprite(color, diameter * BITMAP_SCALE);
      const offset = sprite.width / 2;
      for (const dot of strideDots(stride)) {
        context.drawImage(sprite, (dot.x - BOUNDS.x) * BITMAP_SCALE - offset, (dot.y - BOUNDS.y) * BITMAP_SCALE - offset);
      }
    }
    if (bitmaps.size >= 3) bitmaps.delete(bitmaps.keys().next().value as string);
    bitmaps.set(key, bitmap);
  }
  return bitmap;
}

function prepareGrid(stride: number, diameter: number, color: string): () => void {
  if (bitmaps.has(bitmapKey(stride, diameter, color))) return () => undefined;
  const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 300));
  const cancel = window.cancelIdleCallback ?? window.clearTimeout;
  const id = idle(() => gridBitmap(stride, diameter, color));
  return () => cancel(id);
}

function draw(
  canvas: HTMLCanvasElement,
  scene: Scene,
  camera: Camera,
  layers: ReadonlyArray<Layer>,
  fast: boolean,
): void {
  const context = canvas.getContext("2d");
  if (!context || scene.width === 0) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(scene.width * ratio);
  const pixelHeight = Math.round(scene.height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const scale = (scene.width / camera.width) * ratio;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.clearRect(0, 0, pixelWidth, pixelHeight);
  const left = camera.x - WORLD.step;
  const right = camera.x + camera.width + WORLD.step;
  const top = camera.y - WORLD.step;
  const bottom = camera.y + camera.height + WORLD.step;

  const target = scene.target;
  if (scene.tone === "on" && target) {
    const radius = GLOW_RADIUS * 1.6 * scale;
    const cx = (target.x - camera.x) * scale;
    const cy = (target.y - camera.y) * scale;
    const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, scene.palette.accent);
    gradient.addColorStop(1, "transparent");
    context.globalAlpha = 0.3;
    context.fillStyle = gradient;
    context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  const sharp = (dots: readonly Dot[], diameter: number, color: string, alpha: number) => {
    const sprite = dotSprite(color, diameter * scale);
    const offset = sprite.width / 2;
    context.globalAlpha = alpha;
    for (const dot of dots) {
      if (dot.x < left || dot.x > right || dot.y < top || dot.y > bottom) continue;
      context.drawImage(sprite, (dot.x - camera.x) * scale - offset, (dot.y - camera.y) * scale - offset);
    }
  };
  const base = scene.engaged ? 1 : 0.8;
  for (const layer of layers) {
    if (layer.alpha <= 0.01) continue;
    const diameter = dotUnits(layer.stride, layer.zoom);
    if (fast) {
      context.globalAlpha = base * layer.alpha;
      const bitmap = gridBitmap(layer.stride, diameter, scene.palette.land);
      const k = scale / BITMAP_SCALE;
      context.drawImage(bitmap, (BOUNDS.x - camera.x) * scale, (BOUNDS.y - camera.y) * scale, bitmap.width * k, bitmap.height * k);
    } else {
      sharp(strideDots(layer.stride), diameter, scene.palette.land, base * layer.alpha);
    }
  }
  if (scene.engaged && target && scene.lit.length > 0) {
    const lit = scene.tone === "on" ? scene.palette.accent : scene.tone === "stale" ? scene.palette.stale : scene.palette.pending;
    sharp(scene.lit, dotUnits(scene.stride, scene.width / scene.settled.width), lit, scene.tone === "on" ? 0.6 : 0.4);
  }
  context.globalAlpha = 1;
}

export const WorldMap = memo(function WorldMap({
  nodes,
  node,
  phase,
  home,
  className,
  fill = false,
}: {
  nodes: readonly VpnNode[];
  node: VpnNode | null;
  phase: TunnelPhase;
  home: LatLon | null;
  className?: string;
  fill?: boolean;
}) {
  const { t, format, locale } = useI18n();
  const reduce = useReducedMotion() ?? false;
  const themeVersion = useThemeVersion();
  const minWorldFraction = fill ? 0.5 : 0.62;
  const [frame, size] = useSize<HTMLDivElement>();
  const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 2;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const markers = useMemo(() => {
    const byPoint = new Map<string, Marker>();
    for (const entry of nodes) {
      const coordinates = locationCoordinates(entry);
      if (!coordinates) continue;
      const point = project(coordinates);
      const key = `${Math.round(point.x)}:${Math.round(point.y)}`;
      const marker = byPoint.get(key) ?? { key, point, selectable: false };
      marker.selectable ||= isSelectable(entry);
      byPoint.set(key, marker);
    }
    return [...byPoint.values()];
  }, [nodes]);

  const targetLatLon = node ? locationCoordinates(node) : null;
  const targetX = targetLatLon ? project(targetLatLon).x : null;
  const targetY = targetLatLon ? project(targetLatLon).y : null;
  const target = useMemo(() => (targetX === null || targetY === null ? null : { x: targetX, y: targetY }), [targetX, targetY]);
  const homeX = home ? project(home).x : null;
  const homeY = home ? project(home).y : null;
  const homePoint = useMemo(() => (homeX === null || homeY === null ? null : { x: homeX, y: homeY }), [homeX, homeY]);
  const engaged = phase !== "disconnected";
  const showHome = engaged && homePoint !== null && target !== null && Math.hypot(homePoint.x - target.x, homePoint.y - target.y) > 12;
  const tone: Tone = phase === "connected" ? "on" : phase === "stale" ? "stale" : engaged ? "pending" : "off";

  const cameraTarget = useMemo(() => {
    if (!engaged || !target) return worldCamera(BOUNDS, aspect, target?.x, minWorldFraction);
    const points = showHome && homePoint ? [target, homePoint] : [target];
    return focusCamera(BOUNDS, points, aspect, size.width < 520 ? 240 : 320, minWorldFraction);
  }, [engaged, target, showHome, homePoint, aspect, size.width, minWorldFraction]);

  const targetPxPerUnit = size.width > 0 ? size.width / cameraTarget.width : 0.4;
  const stride = STRIDES.find((candidate) => candidate * WORLD.step * targetPxPerUnit >= CELL_PX) ?? 5;

  const palette = useMemo(
    () => (frame.current ? readPalette(frame.current) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themeVersion, size.width > 0],
  );

  useEffect(() => {
    if (size.width === 0 || !frame.current) return;
    const land = (palette ?? readPalette(frame.current)).land;
    const strideFor = (view: Camera) => {
      const zoomFor = size.width / view.width;
      const value = STRIDES.find((candidate) => candidate * WORLD.step * zoomFor >= CELL_PX) ?? 5;
      return { stride: value, diameter: dotUnits(value, zoomFor) };
    };
    const views = [cameraTarget];
    if (target) {
      const far = homePoint !== null && Math.hypot(homePoint.x - target.x, homePoint.y - target.y) > 12;
      views.push(
        engaged
          ? worldCamera(BOUNDS, aspect, target.x, minWorldFraction)
          : focusCamera(BOUNDS, far && homePoint ? [target, homePoint] : [target], aspect, size.width < 520 ? 240 : 320, minWorldFraction),
      );
    }
    const cancels = views.map((view) => {
      const grid = strideFor(view);
      return prepareGrid(grid.stride, grid.diameter, land);
    });
    return () => cancels.forEach((cancel) => cancel());
  }, [cameraTarget, target, homePoint, engaged, aspect, size.width, minWorldFraction, palette, frame]);

  const scene = useRef<Scene | null>(null);
  const camera = useRef<Camera>(cameraTarget);
  const zoom = targetPxPerUnit;
  const layers = useRef<Layer[]>([{ stride, alpha: 1, zoom }]);

  const paint = useCallback((view: Camera, fast = false) => {
    const current = scene.current;
    if (!current || current.width === 0) return;
    if (canvasRef.current) draw(canvasRef.current, current, view, layers.current, fast);
    svgRef.current?.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
    const overlay = overlayRef.current;
    if (!overlay) return;
    const unit = current.width / view.width;
    for (const element of overlay.querySelectorAll<HTMLElement>("[data-mx]")) {
      let x = (Number(element.dataset.mx) - view.x) * unit;
      const y = (Number(element.dataset.my) - view.y) * unit;
      if (element.dataset.clamp) {
        x = Math.min(Math.max(x, current.width * 0.14), current.width * 0.86);
        element.dataset.below = String(y < current.height * 0.75);
      }
      element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }, []);

  useLayoutEffect(() => {
    if (!frame.current || size.width === 0) return;
    scene.current = {
      width: size.width,
      height: size.height,
      settled: cameraTarget,
      lit: target && engaged ? strideDots(stride).filter((dot) => Math.hypot(dot.x - target.x, dot.y - target.y) < GLOW_RADIUS) : [],
      target,
      tone,
      engaged,
      stride,
      palette: palette ?? readPalette(frame.current),
    };
    paint(camera.current);
  }, [size.width, size.height, cameraTarget, target, tone, engaged, stride, palette, markers, showHome, paint, frame]);

  useEffect(() => {
    if (size.width === 0) return;
    const from = camera.current;
    const to = cameraTarget;
    const last = layers.current[layers.current.length - 1];
    const previous = last?.stride ?? stride;
    const previousZoom = last?.zoom ?? zoom;
    const aspectChanged = Math.abs(from.width / from.height - to.width / to.height) > 0.01;
    const instant = reduce || aspectChanged || from.width === 0;
    const fade = !reduce && previous !== stride;
    layers.current = fade
      ? [{ stride: previous, alpha: 1, zoom: previousZoom }, { stride, alpha: 0, zoom }]
      : [{ stride, alpha: 1, zoom }];
    const moving = !instant && (from.x !== to.x || from.y !== to.y || from.width !== to.width);
    if (!moving && !fade) {
      camera.current = to;
      paint(to);
      return;
    }
    if (!moving) camera.current = to;
    const started = performance.now();
    let id = 0;
    const step = (now: number) => {
      const elapsed = now - started;
      if (moving) {
        const k = easeOutExpo(Math.min(1, elapsed / FLIGHT_MS));
        camera.current = {
          x: from.x + (to.x - from.x) * k,
          y: from.y + (to.y - from.y) * k,
          width: from.width + (to.width - from.width) * k,
          height: from.height + (to.height - from.height) * k,
        };
      }
      if (fade) {
        const k = Math.min(1, elapsed / CROSSFADE_MS);
        layers.current =
          k >= 1 ? [{ stride, alpha: 1, zoom }] : [{ stride: previous, alpha: 1 - k, zoom: previousZoom }, { stride, alpha: k, zoom }];
      }
      const running = elapsed < Math.max(moving ? FLIGHT_MS : 0, fade ? CROSSFADE_MS : 0);
      paint(camera.current, running);
      if (running) id = requestAnimationFrame(step);
      else {
        camera.current = to;
        layers.current = [{ stride, alpha: 1, zoom }];
        paint(to);
      }
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [cameraTarget, stride, zoom, reduce, size.width, paint]);

  const arc = showHome && homePoint && target ? arcPath(homePoint, target) : "";
  const country = node ? countryName(node.country.toUpperCase(), locale) : "";
  const available = useMemo(() => nodes.filter(isSelectable).length, [nodes]);
  const label = !node
    ? format(t.map.labelOff, { count: available })
    : phase === "connected"
      ? format(t.map.labelOn, { city: node.city, country })
      : phase === "stale"
        ? format(t.map.labelStale, { city: node.city })
        : phase === "connecting"
          ? format(t.map.labelConnecting, { city: node.city, country })
          : format(t.map.labelOff, { count: available });

  const at = (point: Point) => ({ "data-mx": point.x, "data-my": point.y });
  const isTarget = (point: Point) => target !== null && Math.round(target.x) === Math.round(point.x) && Math.round(target.y) === Math.round(point.y);

  return (
    <div
      ref={frame}
      role="img"
      aria-label={label}
      className={cn(
        "relative isolate overflow-hidden [contain:content]",
        fill ? "h-full w-full" : "aspect-[16/9] w-full sm:aspect-[2/1]",
        className,
      )}
    >
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
      {arc && (
        <svg
          ref={svgRef}
          aria-hidden
          className="absolute inset-0 size-full"
          viewBox={`${camera.current.x} ${camera.current.y} ${camera.current.width} ${camera.current.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient
              id="mantel-map-arc"
              gradientUnits="userSpaceOnUse"
              x1={homePoint?.x ?? 0}
              y1={homePoint?.y ?? 0}
              x2={target?.x ?? 0}
              y2={target?.y ?? 0}
            >
              <stop offset="0%" stopColor="var(--color-zinc-400)" stopOpacity={0.5} />
              <stop offset="100%" stopColor={tone === "stale" ? "var(--color-red-500)" : "var(--color-accent)"} stopOpacity={1} />
            </linearGradient>
          </defs>
          <path
            d={arc}
            fill="none"
            stroke="url(#mantel-map-arc)"
            strokeWidth={1.75}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            strokeDasharray={tone === "on" ? undefined : "3 5"}
            className={cn(tone === "pending" && "animate-map-dash")}
          />
        </svg>
      )}

      <div ref={overlayRef} aria-hidden className="pointer-events-none absolute inset-0 z-[1] will-change-transform">
        {markers.map((marker) =>
          isTarget(marker.point) ? null : (
            <span key={marker.key} {...at(marker.point)} className="absolute left-0 top-0">
              <span
                className={cn(
                  "absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface transition-opacity duration-500",
                  marker.selectable ? "bg-zinc-500" : "bg-zinc-300",
                  engaged && "opacity-50",
                )}
              />
            </span>
          ),
        )}

        {showHome && homePoint && (
          <span {...at(homePoint)} className="absolute left-0 top-0" title={t.map.youTitle}>
            <span className="absolute -translate-x-1/2 -translate-y-1/2">
              <span className="block size-[9px] rounded-full border-2 border-zinc-500 bg-surface" />
              <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-surface px-1.5 text-[10.5px] font-medium text-zinc-500 shadow-pill">
                {t.map.you}
              </span>
            </span>
          </span>
        )}

        {target && (
          <>
            <span {...at(target)} className="absolute left-0 top-0">
              <span className="absolute grid size-4 -translate-x-1/2 -translate-y-1/2 place-items-center">
                {tone !== "off" && (
                  <span
                    className={cn(
                      "absolute inset-[-6px] rounded-full motion-safe:animate-ping-slow",
                      tone === "on" ? "bg-accent/45" : tone === "stale" ? "bg-red-500/40" : "bg-amber-500/40",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "relative size-3.5 rounded-full border-[3px] border-surface shadow-float transition-colors duration-500",
                    tone === "on" ? "bg-accent" : tone === "stale" ? "bg-red-500" : tone === "pending" ? "bg-amber-500" : "bg-ink",
                  )}
                />
              </span>
            </span>
            {node && (
              <span {...at(target)} data-clamp="true" className="group absolute left-0 top-0">
                <span className="absolute -translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-full border border-zinc-200/80 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-ink shadow-pill group-data-[below=true]:translate-y-[14px]">
                  {node.city}
                </span>
              </span>
            )}
          </>
        )}
      </div>

      {fill && node && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-surface via-surface/70 to-transparent" />
      )}
      {fill && node && (
        <div aria-hidden className="pointer-events-none absolute left-6 top-6 z-[2] max-w-[70%]">
          <p
            className={cn(
              "flex items-center gap-2 text-[12.5px] font-medium",
              tone === "on" ? "text-accent-strong" : tone === "stale" ? "text-red-600" : tone === "pending" ? "text-amber-700" : "text-zinc-500",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                tone === "on" ? "bg-accent" : tone === "stale" ? "bg-red-500" : tone === "pending" ? "bg-amber-500" : "bg-zinc-400",
              )}
            />
            {t.home.status[phase]}
          </p>
          <p className="mt-1.5 truncate text-[30px] font-medium leading-tight tracking-[-0.03em] text-ink">{node.city}</p>
          <p className="mt-0.5 truncate text-[14px] text-zinc-500">{country}</p>
        </div>
      )}

      {fill && (
        <div
          aria-hidden
          className="absolute bottom-4 left-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-full border border-zinc-200/70 bg-surface px-3.5 py-2 text-[11.5px] text-zinc-500 shadow-pill"
        >
          <span className="flex items-center gap-1.5">
            <span className="size-[7px] rounded-full bg-zinc-500" />
            {t.map.legendLocation}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-[7px] rounded-full bg-zinc-300" />
            {t.map.legendUnavailable}
          </span>
          {home && (
            <span className="flex items-center gap-1.5" title={t.map.youTitle}>
              <span className="size-[9px] rounded-full border-2 border-zinc-500 bg-surface" />
              {t.map.legendYou}
            </span>
          )}
        </div>
      )}
    </div>
  );
});
