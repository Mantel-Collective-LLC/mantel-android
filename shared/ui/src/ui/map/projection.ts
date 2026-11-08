import { WORLD, WORLD_ROWS } from "./world-dots";

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;

export type Point = { x: number; y: number };
export type LatLon = { lat: number; lon: number };

export function project({ lat, lon }: LatLon): Point {
  const lambda = (lon * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const l = Math.asin(M * Math.sin(phi));
  const l2 = l * l;
  const l6 = l2 * l2 * l2;
  const x = (lambda * Math.cos(l)) / (M * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2)));
  const y = l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2));
  return { x: WORLD.translateX + WORLD.scale * x, y: WORLD.translateY - WORLD.scale * y };
}

export type Dot = Point & { column: number; row: number };

export function worldDots(): Dot[] {
  const half = WORLD.step / 2;
  return WORLD_ROWS.split("\n").flatMap((line, row) =>
    line
      ? line.split(",").flatMap((run) => {
          const [start = 0, length = 0] = run.split(".").map((part) => parseInt(part, 36));
          return Array.from({ length }, (_, index) => ({
            x: (start + index) * WORLD.step + half,
            y: row * WORLD.step + half,
            column: start + index,
            row,
          }));
        })
      : [],
  );
}

export function thinDots(dots: readonly Dot[], stride: number): Dot[] {
  if (stride <= 1) return [...dots];
  return dots.filter((dot) => dot.column % stride === 0 && dot.row % stride === 0);
}

export function dotPath(dots: readonly Point[]): string {
  return dots.map((dot) => `M${dot.x} ${dot.y}h0`).join("");
}

export type Camera = { x: number; y: number; width: number; height: number };
export type Bounds = Camera;

export function landBounds(dots: readonly Point[]): Bounds {
  const pad = 12;
  const xs = dots.map((dot) => dot.x);
  const ys = dots.map((dot) => dot.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
}

export const MIN_WORLD_FRACTION = 0.62;

const clamp = (value: number, min: number, max: number) => (min > max ? (min + max) / 2 : Math.min(Math.max(value, min), max));

export function worldCamera(bounds: Bounds, aspect: number, centerX?: number, minFraction = MIN_WORLD_FRACTION): Camera {
  const ratio = bounds.width / bounds.height;
  if (ratio <= aspect) {
    const width = bounds.height * aspect;
    return { x: bounds.x - (width - bounds.width) / 2, y: bounds.y, width, height: bounds.height };
  }
  const width = Math.max(bounds.height * aspect, bounds.width * minFraction);
  const height = width / aspect;
  const cx = clamp(centerX ?? bounds.x + bounds.width / 2, bounds.x + width / 2, bounds.x + bounds.width - width / 2);
  return { x: cx - width / 2, y: bounds.y - (height - bounds.height) / 2, width, height };
}

export function focusCamera(
  bounds: Bounds,
  points: readonly Point[],
  aspect: number,
  minWidth = 300,
  minFraction = MIN_WORLD_FRACTION,
): Camera {
  if (points.length === 0) return worldCamera(bounds, aspect, undefined, minFraction);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const topEdge = Math.min(...ys);
  const bottomEdge = Math.max(...ys);
  const margin = 1.7;
  const world = worldCamera(bounds, aspect, (left + right) / 2, minFraction);
  let width = Math.max(minWidth, (right - left) * margin, (bottomEdge - topEdge) * margin * aspect);
  width = Math.min(width, world.width);
  const height = width / aspect;
  return {
    x: clamp((left + right) / 2 - width / 2, bounds.x, bounds.x + bounds.width - width),
    y: clamp((topEdge + bottomEdge) / 2 - height / 2, bounds.y, bounds.y + bounds.height - height),
    width,
    height,
  };
}

export function arcPath(from: Point, to: Point): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return "";
  let nx = -dy / distance;
  let ny = dx / distance;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const bend = Math.min(distance * 0.28, 120);
  return `M${from.x} ${from.y}Q${mx + nx * bend} ${my + ny * bend} ${to.x} ${to.y}`;
}
