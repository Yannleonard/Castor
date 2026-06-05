// ui/src/components/StatsChart.tsx
// A live line chart drawn on <canvas> (no chart lib). Re-renders on each new
// sample. Used for the WS-driven CPU/Memory streams in WorkloadDetail.

import { useEffect, useRef } from "react";

interface Props {
  /** time series values, oldest → newest */
  data: number[];
  color?: string;
  height?: number;
  /** fixed y max (e.g. 100 for percent); auto-scaled if undefined */
  max?: number;
  /** label shown top-left */
  label?: string;
  /** formatted current value shown top-right */
  valueLabel?: string;
}

export function StatsChart({ data, color = "var(--accent)", height = 160, max, label, valueLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = wrap.clientWidth;
    const cssH = height;
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    // resolve CSS variable color to a concrete value.
    const probe = document.createElement("span");
    probe.style.color = color;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color || "#2496ED";
    document.body.removeChild(probe);

    // resolve chart grid/axis tokens so the chart reads on the light theme.
    const rootStyle = getComputedStyle(document.documentElement);
    const gridColor = rootStyle.getPropertyValue("--chart-grid").trim() || "#E8EEF6";
    const axisColor = rootStyle.getPropertyValue("--chart-axis").trim() || "#7C93AC";

    const padL = 38;
    const padR = 8;
    const padT = 10;
    const padB = 18;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;

    const peak = max ?? Math.max(1, ...data, 1);

    // grid lines + y labels
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = axisColor;
    ctx.font = "10px ui-monospace, monospace";
    ctx.lineWidth = 1;
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const y = padT + (plotH / ticks) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(cssW - padR, y);
      ctx.stroke();
      const val = peak - (peak / ticks) * i;
      ctx.fillText(val >= 100 ? val.toFixed(0) : val.toFixed(val < 10 ? 1 : 0), 4, y + 3);
    }

    if (data.length >= 1) {
      const stepX = data.length > 1 ? plotW / (data.length - 1) : plotW;
      const px = (i: number) => padL + i * stepX;
      const py = (v: number) => padT + plotH - (Math.max(0, Math.min(v, peak)) / peak) * plotH;

      // area fill
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, hexToRgba(resolved, 0.32));
      grad.addColorStop(1, hexToRgba(resolved, 0));
      ctx.beginPath();
      ctx.moveTo(px(0), py(data[0]!));
      for (let i = 1; i < data.length; i++) ctx.lineTo(px(i), py(data[i]!));
      ctx.lineTo(px(data.length - 1), padT + plotH);
      ctx.lineTo(px(0), padT + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // line
      ctx.beginPath();
      ctx.moveTo(px(0), py(data[0]!));
      for (let i = 1; i < data.length; i++) ctx.lineTo(px(i), py(data[i]!));
      ctx.strokeStyle = resolved;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();

      // last-point dot
      const lastX = px(data.length - 1);
      const lastY = py(data[data.length - 1]!);
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
      ctx.fillStyle = resolved;
      ctx.fill();
    }
  }, [data, color, height, max]);

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      {(label || valueLabel) && (
        <div
          style={{
            position: "absolute",
            inset: "6px 10px auto 44px",
            display: "flex",
            justifyContent: "space-between",
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          {label && <span className="text-xs muted">{label}</span>}
          {valueLabel && (
            <span className="text-xs mono" style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              {valueLabel}
            </span>
          )}
        </div>
      )}
      <canvas ref={canvasRef} />
    </div>
  );
}

function hexToRgba(input: string, alpha: number): string {
  // input is likely "rgb(r, g, b)" from getComputedStyle.
  const m = input.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1]!.split(",").map((s) => s.trim());
    const [r, g, b] = parts;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return input;
}
