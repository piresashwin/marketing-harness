// Dependency-free SVG chart primitives, skinned with the semantic theme tokens
// (var(--accent), --color-brand-*, --hover, --muted, --line) so they flip in
// dark mode without per-element variants. No charting lib — keeps the bundle
// lean and avoids purple-gradient AI-slop. All are responsive (viewBox + 100%
// width) and carry an aria-label.

// Indigo monochrome ramp for categorical segments — reads on both themes.
const SEGMENT_PALETTE = [
  "var(--color-brand-600)",
  "var(--color-brand-500)",
  "var(--color-brand-200)",
  "var(--color-brand-100)",
];

export function segmentColor(i: number): string {
  return SEGMENT_PALETTE[i % SEGMENT_PALETTE.length];
}

/**
 * Inline trend sparkline. `values` may contain gaps (undefined) — they're
 * skipped while preserving x-spacing. Renders nothing below 2 real points.
 */
export function Sparkline({
  values,
  width = 120,
  height = 34,
  ariaLabel,
}: {
  values: (number | undefined)[];
  width?: number;
  height?: number;
  ariaLabel?: string;
}) {
  const pts = values
    .map((v, i) => ({ i, v }))
    .filter((p): p is { i: number; v: number } => p.v != null);
  if (pts.length < 2) return null;

  const pad = 3;
  const n = values.length;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => pad + (n <= 1 ? 0 : (i / (n - 1)) * (width - 2 * pad));
  const y = (v: number) => height - pad - ((v - min) / span) * (height - 2 * pad);

  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  const area = `${line} L${x(last.i)},${height - pad} L${x(first.i)},${height - pad} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel ?? "Trend"}
      className="overflow-visible"
    >
      <path d={area} fill="var(--accent-soft)" stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.4} fill="var(--accent)" />
    </svg>
  );
}

export interface DonutSegment {
  label: string;
  value: number;
  color?: string;
}

/** Donut + legend. Segment colors default to the indigo ramp. */
export function Donut({
  segments,
  size = 132,
  thickness = 16,
  centerTop,
  centerBottom,
  ariaLabel,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerTop?: string;
  centerBottom?: string;
  ariaLabel?: string;
}) {
  const data = segments.filter((s) => s.value > 0);
  const total = data.reduce((a, s) => a + s.value, 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className="shrink-0"
        role="img"
        aria-label={ariaLabel ?? "Breakdown"}
      >
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="var(--hover)"
          strokeWidth={thickness}
        />
        {total > 0 &&
          data.map((s, i) => {
            const len = (s.value / total) * circ;
            const el = (
              <circle
                key={s.label}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={s.color ?? segmentColor(i)}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${c} ${c})`}
              />
            );
            offset += len;
            return el;
          })}
        {(centerTop || centerBottom) && (
          <text textAnchor="middle" dominantBaseline="central">
            {centerTop && (
              <tspan
                x={c}
                y={c - (centerBottom ? 7 : 0)}
                className="fill-ink text-[15px] font-semibold"
              >
                {centerTop}
              </tspan>
            )}
            {centerBottom && (
              <tspan x={c} y={c + 9} className="fill-faint text-[9px] uppercase">
                {centerBottom}
              </tspan>
            )}
          </text>
        )}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: s.color ?? segmentColor(i) }}
            />
            <span className="min-w-0 flex-1 truncate text-muted" title={s.label}>
              {s.label}
            </span>
            <span className="shrink-0 tabular-nums text-faint">
              {total > 0 ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ScatterPoint {
  x: number;
  y: number;
  label?: string;
}

/**
 * Reach (x) vs engagement (y) scatter — surfaces outperformers (top-right). The
 * single highest-y point is emphasized. Hover titles name each post.
 */
export function Scatter({
  points,
  xLabel,
  yLabel,
  ariaLabel,
}: {
  points: ScatterPoint[];
  xLabel?: string;
  yLabel?: string;
  ariaLabel?: string;
}) {
  const W = 320;
  const H = 180;
  const padL = 10;
  const padR = 12;
  const padT = 10;
  const padB = 22;
  const data = points.filter((p) => p.x > 0 || p.y > 0);
  if (!data.length) {
    return <p className="text-sm text-faint">Not enough post data to plot.</p>;
  }
  const xmax = Math.max(...data.map((p) => p.x), 1);
  const ymax = Math.max(...data.map((p) => p.y), 1);
  const px = (v: number) => padL + (v / xmax) * (W - padL - padR);
  const py = (v: number) => H - padB - (v / ymax) * (H - padT - padB);
  const topIdx = data.reduce((best, p, i) => (p.y > data[best].y ? i : best), 0);

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={ariaLabel ?? "Reach versus engagement by post"}
      >
        {/* axes */}
        <line
          x1={padL}
          y1={H - padB}
          x2={W - padR}
          y2={H - padB}
          stroke="var(--line)"
        />
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="var(--line)" />
        {data.map((p, i) => (
          <circle
            key={i}
            cx={px(p.x)}
            cy={py(p.y)}
            r={i === topIdx ? 5 : 3.5}
            fill={i === topIdx ? "var(--accent-strong)" : "var(--accent)"}
            fillOpacity={i === topIdx ? 0.95 : 0.5}
          >
            {p.label && <title>{p.label}</title>}
          </circle>
        ))}
        {xLabel && (
          <text
            x={W - padR}
            y={H - 6}
            textAnchor="end"
            className="fill-faint text-[10px]"
          >
            {xLabel} →
          </text>
        )}
        {yLabel && (
          <text x={padL} y={padT - 2} className="fill-faint text-[10px]">
            ↑ {yLabel}
          </text>
        )}
      </svg>
    </div>
  );
}
