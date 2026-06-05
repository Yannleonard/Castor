// ui/src/lib/format.ts — small formatting helpers (no deps).

/** Human-readable bytes (binary, 1024-based). */
export function formatBytes(bytes: number | undefined | null, fractionDigits = 1): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—";
  if (bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : fractionDigits)} ${units[i]}`;
}

/** Bytes/sec rate. */
export function formatRate(bytesPerSec: number | undefined): string {
  if (bytesPerSec === undefined) return "—";
  return `${formatBytes(bytesPerSec)}/s`;
}

/** Percentage with one decimal. */
export function formatPct(pct: number | undefined): string {
  if (pct === undefined || Number.isNaN(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

/** Relative time from an ISO/RFC3339 string or epoch seconds. */
export function timeAgo(input: string | number | undefined | null): string {
  if (input === undefined || input === null || input === "") return "—";
  const ms = typeof input === "number" ? input * 1000 : Date.parse(input);
  if (Number.isNaN(ms)) return "—";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const sec = Math.floor(abs / 1000);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ${suffix}`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${suffix}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${suffix}`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ${suffix}`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo ${suffix}`;
  const yr = Math.floor(mon / 12);
  return `${yr}y ${suffix}`;
}

/** Absolute local datetime. */
export function formatDateTime(input: string | number | undefined | null): string {
  if (input === undefined || input === null || input === "") return "—";
  const ms = typeof input === "number" ? input * 1000 : Date.parse(input);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Shorten an id (docker ids, image digests). */
export function shortId(id: string | undefined, len = 12): string {
  if (!id) return "—";
  const clean = id.startsWith("sha256:") ? id.slice(7) : id;
  return clean.slice(0, len);
}

/** Pretty-print a JSON value with stable indentation. */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Strip a leading "/" from docker container names. */
export function cleanName(name: string | undefined): string {
  if (!name) return "—";
  return name.startsWith("/") ? name.slice(1) : name;
}
