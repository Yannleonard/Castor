// ui/src/components/Sparkline.tsx
// Minimal inline-SVG sparkline (no chart library). Renders a smooth-ish path
// over a fixed-width viewport with an area fill.

interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  /** clamp the y-axis max (e.g. 100 for CPU%); auto if undefined */
  max?: number;
  ariaLabel?: string;
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "var(--accent)",
  fill = true,
  max,
  ariaLabel,
}: Props) {
  if (!data || data.length === 0) {
    return (
      <svg width={width} height={height} aria-label={ariaLabel} role="img">
        <line
          x1={0}
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke="var(--border)"
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const n = data.length;
  const peak = max ?? Math.max(1, ...data);
  const pad = 1.5;
  const innerH = height - pad * 2;
  const stepX = n > 1 ? width / (n - 1) : width;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const clamped = Math.max(0, Math.min(v, peak));
    const y = pad + innerH - (clamped / peak) * innerH;
    return [x, y] as const;
  });

  const linePath = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath =
    `${linePath} L${(points[points.length - 1]?.[0] ?? 0).toFixed(1)},${height} L0,${height} Z`;

  const gradId = `spark-${Math.round(peak)}-${n}-${color.replace(/\W/g, "")}`;

  return (
    <svg width={width} height={height} aria-label={ariaLabel} role="img" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />}
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}
