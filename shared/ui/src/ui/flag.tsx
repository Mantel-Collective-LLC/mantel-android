import type { ReactNode } from "react";
import { cn } from "../lib/cn";

type Stripes = { colors: string[]; weights?: number[] };

const WHITE = "#ffffff";

function stripes({ colors, weights }: Stripes, direction: "h" | "v"): ReactNode {
  const parts = weights ?? colors.map(() => 1);
  const total = parts.reduce((sum, part) => sum + part, 0);
  let offset = 0;
  return colors.map((color, index) => {
    const size = (24 * (parts[index] ?? 1)) / total;
    const start = offset;
    offset += size;
    return direction === "h" ? (
      <rect key={index} x={0} y={start} width={24} height={size + 0.05} fill={color} />
    ) : (
      <rect key={index} x={start} y={0} width={size + 0.05} height={24} fill={color} />
    );
  });
}

function nordic(background: string, cross: string, inner?: string): ReactNode {
  return (
    <>
      <rect width={24} height={24} fill={background} />
      <rect x={6.5} y={0} width={5} height={24} fill={cross} />
      <rect x={0} y={9.5} width={24} height={5} fill={cross} />
      {inner && (
        <>
          <rect x={7.75} y={0} width={2.5} height={24} fill={inner} />
          <rect x={0} y={10.75} width={24} height={2.5} fill={inner} />
        </>
      )}
    </>
  );
}

const h = (...colors: string[]) => stripes({ colors }, "h");
const v = (...colors: string[]) => stripes({ colors }, "v");

function disc(field: string, color: string, cx = 12, r = 5.4): ReactNode {
  return (
    <>
      <rect width={24} height={24} fill={field} />
      <circle cx={cx} cy={12} r={r} fill={color} />
    </>
  );
}

function unionCanton(): ReactNode {
  return (
    <>
      <rect width={24} height={24} fill="#012169" />
      <path d="M0 0L12 12M12 0L0 12" stroke={WHITE} strokeWidth={2.4} />
      <path d="M0 0L12 12M12 0L0 12" stroke="#c8102e" strokeWidth={0.8} />
      <rect x={4.5} y={0} width={3} height={12} fill={WHITE} />
      <rect x={0} y={4.5} width={12} height={3} fill={WHITE} />
      <rect x={5.2} y={0} width={1.6} height={12} fill="#c8102e" />
      <rect x={0} y={5.2} width={12} height={1.6} fill="#c8102e" />
    </>
  );
}

const FLAGS: Record<string, () => ReactNode> = {
  AE: () => (
    <>
      {h("#00732f", WHITE, "#000000")}
      <rect width={7} height={24} fill="#ff0000" />
    </>
  ),
  AM: () => h("#d90012", "#0033a0", "#f2a800"),
  AU: () => (
    <>
      {unionCanton()}
      <circle cx={6} cy={18} r={2} fill={WHITE} />
      {[
        [18, 5],
        [21, 10.5],
        [15, 11],
        [18, 19],
      ].map(([cx, cy]) => (
        <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r={1} fill={WHITE} />
      ))}
    </>
  ),
  BD: () => disc("#006a4e", "#f42a41", 11),
  BR: () => (
    <>
      <rect width={24} height={24} fill="#009c3b" />
      <path d="M12 3.5L22 12L12 20.5L2 12Z" fill="#ffdf00" />
      <circle cx={12} cy={12} r={4.4} fill="#002776" />
    </>
  ),
  CO: () => stripes({ colors: ["#fcd116", "#003893", "#ce1126"], weights: [2, 1, 1] }, "h"),
  HK: () => (
    <>
      <rect width={24} height={24} fill="#de2910" />
      {[0, 72, 144, 216, 288].map((angle) => (
        <ellipse key={angle} cx={12} cy={7.6} rx={2} ry={3.8} fill={WHITE} transform={`rotate(${angle} 12 12)`} />
      ))}
      <circle cx={12} cy={12} r={0.9} fill="#de2910" />
    </>
  ),
  ID: () => h("#ce1126", WHITE),
  IL: () => (
    <>
      <rect width={24} height={24} fill={WHITE} />
      <rect x={0} y={3.5} width={24} height={3} fill="#0038b8" />
      <rect x={0} y={17.5} width={24} height={3} fill="#0038b8" />
      <path d="M12 8.2L15.5 14.2H8.5ZM12 15.8L8.5 9.8H15.5Z" fill="none" stroke="#0038b8" strokeWidth={0.9} />
    </>
  ),
  KR: () => (
    <>
      <rect width={24} height={24} fill={WHITE} />
      <circle cx={12} cy={12} r={5} fill="#cd2e3a" />
      <path d="M7 12A5 5 0 0 0 17 12A2.5 2.5 0 0 0 12 12A2.5 2.5 0 0 1 7 12Z" fill="#0047a0" />
    </>
  ),
  MC: () => h("#ce1126", WHITE),
  MD: () => v("#003da5", "#ffd200", "#cc092f"),
  MX: () => (
    <>
      {v("#006847", WHITE, "#ce1126")}
      <circle cx={12} cy={12} r={1.8} fill="#8c5a2b" />
    </>
  ),
  NG: () => v("#008751", WHITE, "#008751"),
  NZ: () => (
    <>
      {unionCanton()}
      {[
        [18, 5],
        [21, 10.5],
        [15, 11.5],
        [18, 19],
      ].map(([cx, cy]) => (
        <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r={1.2} fill="#c8102e" stroke={WHITE} strokeWidth={0.45} />
      ))}
    </>
  ),
  PE: () => v("#d91023", WHITE, "#d91023"),
  RS: () => h("#c6363c", "#0c4076", WHITE),
  TH: () => stripes({ colors: ["#a51931", "#f4f5f8", "#2d2a4a", "#f4f5f8", "#a51931"], weights: [1, 1, 2, 1, 1] }, "h"),
  TR: () => (
    <>
      <rect width={24} height={24} fill="#e30a17" />
      <circle cx={10} cy={12} r={5.2} fill={WHITE} />
      <circle cx={11.3} cy={12} r={4.2} fill="#e30a17" />
      <circle cx={16.2} cy={12} r={1.5} fill={WHITE} />
    </>
  ),
  TW: () => (
    <>
      <rect width={24} height={24} fill="#fe0000" />
      <rect width={12} height={12} fill="#000095" />
      <circle cx={6} cy={6} r={2.6} fill={WHITE} />
    </>
  ),
  ZA: () => (
    <>
      {h("#e03c31", "#001489")}
      <path d="M0 2L11 12L0 22" fill="none" stroke={WHITE} strokeWidth={6} />
      <path d="M0 2L11 12L0 22M11 12H24" fill="none" stroke="#007749" strokeWidth={3.6} />
      <rect x={11} y={8.8} width={13} height={1.4} fill={WHITE} />
      <rect x={11} y={13.8} width={13} height={1.4} fill={WHITE} />
      <path d="M0 5.5L7 12L0 18.5Z" fill="#ffb612" />
      <path d="M0 7.5L5 12L0 16.5Z" fill="#000000" />
    </>
  ),
  AT: () => h("#c8102e", WHITE, "#c8102e"),
  BE: () => v("#2d2926", "#fdda24", "#ef3340"),
  BG: () => h(WHITE, "#00966e", "#d62612"),
  CA: () => (
    <>
      {stripes({ colors: ["#d52b1e", WHITE, "#d52b1e"], weights: [1, 2, 1] }, "v")}
      <path
        fill="#d52b1e"
        d="M12 6.2l1.1 2.1 1.3-.7-.5 3 1.9-1.9.4 1.1 1.9-.4-.6 2 1 .5-3 2.4.4 1.2-3.1-.5.1 3h-1.8l.1-3-3.1.5.4-1.2-3-2.4 1-.5-.6-2 1.9.4.4-1.1 1.9 1.9-.5-3 1.3.7z"
      />
    </>
  ),
  CH: () => (
    <>
      <rect width={24} height={24} fill="#da291c" />
      <rect x={10} y={5.5} width={4} height={13} fill={WHITE} />
      <rect x={5.5} y={10} width={13} height={4} fill={WHITE} />
    </>
  ),
  CZ: () => (
    <>
      {h(WHITE, "#d7141a")}
      <path d="M0 0L13 12L0 24Z" fill="#11457e" />
    </>
  ),
  DE: () => h("#000000", "#dd0000", "#ffce00"),
  DK: () => nordic("#c8102e", WHITE),
  EE: () => h("#0072ce", "#000000", WHITE),
  ES: () => stripes({ colors: ["#aa151b", "#f1bf00", "#aa151b"], weights: [1, 2, 1] }, "h"),
  FI: () => nordic(WHITE, "#002f6c"),
  FR: () => v("#002395", WHITE, "#ed2939"),
  GB: () => (
    <>
      <rect width={24} height={24} fill="#012169" />
      <path d="M0 0L24 24M24 0L0 24" stroke={WHITE} strokeWidth={4.8} />
      <path d="M0 0L24 24M24 0L0 24" stroke="#c8102e" strokeWidth={1.6} />
      <rect x={9} y={0} width={6} height={24} fill={WHITE} />
      <rect x={0} y={9} width={24} height={6} fill={WHITE} />
      <rect x={10.3} y={0} width={3.4} height={24} fill="#c8102e" />
      <rect x={0} y={10.3} width={24} height={3.4} fill="#c8102e" />
    </>
  ),
  GR: () => (
    <>
      {h("#0d5eaf", WHITE, "#0d5eaf", WHITE, "#0d5eaf", WHITE, "#0d5eaf", WHITE, "#0d5eaf")}
      <rect width={13.3} height={13.3} fill="#0d5eaf" />
      <rect x={5.2} y={0} width={2.9} height={13.3} fill={WHITE} />
      <rect x={0} y={5.2} width={13.3} height={2.9} fill={WHITE} />
    </>
  ),
  HU: () => h("#ce2939", WHITE, "#477050"),
  IE: () => v("#169b62", WHITE, "#ff883e"),
  IN: () => (
    <>
      {h("#ff9933", WHITE, "#138808")}
      <circle cx={12} cy={12} r={2.6} fill="none" stroke="#000080" strokeWidth={0.9} />
    </>
  ),
  IS: () => nordic("#02529c", WHITE, "#dc1e35"),
  IT: () => v("#009246", WHITE, "#ce2b37"),
  JP: () => (
    <>
      <rect width={24} height={24} fill={WHITE} />
      <circle cx={12} cy={12} r={5.4} fill="#bc002d" />
    </>
  ),
  LT: () => h("#fdb913", "#006a44", "#c1272d"),
  LU: () => h("#ed2939", WHITE, "#00a1de"),
  LV: () => stripes({ colors: ["#9e3039", WHITE, "#9e3039"], weights: [2, 1, 2] }, "h"),
  NL: () => h("#ae1c28", WHITE, "#21468b"),
  NO: () => nordic("#ba0c2f", WHITE, "#00205b"),
  PL: () => h(WHITE, "#dc143c"),
  PT: () => stripes({ colors: ["#006600", "#ff0000"], weights: [2, 3] }, "v"),
  RO: () => v("#002b7f", "#fcd116", "#ce1126"),
  SE: () => nordic("#006aa7", "#fecc00"),
  SG: () => h("#ef3340", WHITE),
  UA: () => h("#0057b7", "#ffd700"),
  US: () => (
    <>
      {h("#b22234", WHITE, "#b22234", WHITE, "#b22234", WHITE, "#b22234")}
      <rect width={12.5} height={13.7} fill="#3c3b6e" />
      {[2.5, 6.2, 9.9].flatMap((cy) =>
        [2.6, 6.2, 9.8].map((cx) => <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r={0.75} fill={WHITE} />),
      )}
    </>
  ),
};

export function hasFlag(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(FLAGS, code.toUpperCase());
}

export function Flag({ code, className }: { code: string; className?: string }) {
  const draw = FLAGS[code.toUpperCase()];
  if (!draw) {
    return (
      <span
        aria-hidden
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full bg-zinc-100 font-mono text-[9.5px] font-semibold tracking-wide text-zinc-500 shadow-outline",
          className,
        )}
      >
        {code.toUpperCase().slice(0, 2)}
      </span>
    );
  }
  return (
    <span aria-hidden className={cn("relative block size-7 shrink-0 overflow-hidden rounded-full shadow-outline", className)}>
      <svg viewBox="0 0 24 24" className="block size-full" focusable="false">
        {draw()}
      </svg>
      <span className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]" />
    </span>
  );
}
