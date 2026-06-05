// ui/src/views/marketplace/TemplateLogo.tsx
//
// Renders a template's COLOR logo on a subtle light tile so brand colors pop on
// the dark theme. When `logo` is empty/null OR the image fails to load, falls
// back to an initials tile whose background is a deterministic brand-ish color
// derived from a hash of the template name.

import { useState } from "react";

// A small palette of saturated-but-legible brand-ish hues (white text on top).
const PALETTE = [
  "#2496ED", // docker blue
  "#13A688", // teal
  "#9B6DE0", // violet
  "#326CE5", // k8s blue
  "#E0A106", // amber
  "#E5484D", // red
  "#0EA5A0", // cyan-teal
  "#C2569A", // magenta
  "#5B8DEF", // periwinkle
  "#8B5E3C", // beaver
];

/** Stable 32-bit FNV-1a hash of a string. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 1-2 uppercase initials for a template name (skips non-alphanumerics). */
function initials(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Deterministic palette color for a name. */
function nameColor(name: string): string {
  return PALETTE[hash(name) % PALETTE.length];
}

interface Props {
  name: string;
  logo: string | null;
}

export function TemplateLogo({ name, logo }: Props) {
  const [broken, setBroken] = useState(false);
  const showImg = !!logo && !broken;

  if (showImg) {
    return (
      <span className="mkt-logo">
        <img src={logo as string} alt="" loading="lazy" onError={() => setBroken(true)} />
      </span>
    );
  }
  return (
    <span className="mkt-logo-fallback" style={{ background: nameColor(name) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
