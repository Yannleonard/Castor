// ui/src/components/icons.tsx
// Hand-rolled inline-SVG icon set (no icon library dependency).
// All icons inherit currentColor and accept size via props.

import type { SVGProps, ImgHTMLAttributes } from "react";

// IconProps omits the SVG `strokeWidth` (string|number) so callers pass a clean
// numeric size; the stroke width is fixed by `base`.
type IconProps = Omit<SVGProps<SVGSVGElement>, "strokeWidth"> & { size?: number; strokeWidth?: number };

function base({ size = 18, strokeWidth = 1.75, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ...rest,
  };
}

export const IconDashboard = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

export const IconHosts = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="6" rx="1.5" />
    <rect x="3" y="14" width="18" height="6" rx="1.5" />
    <path d="M7 7h.01M7 17h.01" />
  </svg>
);

export const IconWorkloads = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" />
  </svg>
);

export const IconImages = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.6" />
    <path d="m21 15-5-5L5 21" />
  </svg>
);

export const IconNetworks = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="5" r="2.4" />
    <circle cx="5" cy="19" r="2.4" />
    <circle cx="19" cy="19" r="2.4" />
    <path d="M12 7.4v4.6M12 12 5.8 17.2M12 12l6.2 5.2" />
  </svg>
);

export const IconVolumes = (p: IconProps) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
  </svg>
);

export const IconSwarm = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export const IconKube = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 2 4 6v6.5c0 4.5 3.2 7.2 8 9.5 4.8-2.3 8-5 8-9.5V6l-8-4z" />
    <circle cx="12" cy="11" r="2.2" />
    <path d="M12 8.8V5.5M12 13.2v3.3M9.8 11.7 7 13.4M14.2 11.7 17 13.4M9.8 10.3 7 8.6M14.2 10.3 17 8.6" />
  </svg>
);

export const IconAudit = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M9 13h6M9 17h4" />
  </svg>
);

export const IconUsers = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="3.2" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
  </svg>
);

export const IconRoles = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const IconSettings = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const IconMarketplace = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 9.5 4.5 4h15L21 9.5" />
    <path d="M3 9.5h18v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" />
    <path d="M5 12.4V20h14v-7.6" />
    <path d="M10 20v-4h4v4" />
  </svg>
);

export const IconProfile = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21v-1a7 7 0 0 1 14 0v1" />
  </svg>
);

export const IconLogout = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </svg>
);

export const IconPlay = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconStop = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
);

export const IconRestart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

export const IconTrash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const IconLogs = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 4h16v16H4z" />
    <path d="M8 9h8M8 13h8M8 17h5" />
  </svg>
);

export const IconStats = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 3v18h18" />
    <path d="m7 14 3-4 3 3 4-6" />
  </svg>
);

export const IconTerminal = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3M13 15h4" />
  </svg>
);

export const IconInspect = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m8 6-4 6 4 6M16 6l4 6-4 6" />
    <path d="M13 4 11 20" />
  </svg>
);

export const IconLock = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="11" width="16" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export const IconShield = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const IconRefresh = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 4v5h-5" />
  </svg>
);

export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconClose = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const IconChevronDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconAlert = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m10.29 3.86-8.18 14a1.5 1.5 0 0 0 1.29 2.25h16.36a1.5 1.5 0 0 0 1.29-2.25l-8.18-14a1.5 1.5 0 0 0-2.58 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

// Help: a question mark inside a circle.
export const IconHelp = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.1 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconCopy = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

export const IconDownload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5M12 15V3" />
  </svg>
);

export const IconExternal = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
  </svg>
);

export const IconStacks = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m12 2 9 5-9 5-9-5 9-5z" />
    <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
  </svg>
);

// Scale: two opposed arrows along a track (replica up/down).
export const IconScale = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 8 4 5 1 8M4 5v14M17 16l3 3 3-3M20 19V5" />
    <path d="M10 6h4M9 12h6M10 18h4" />
  </svg>
);

// Edit / pencil.
export const IconEdit = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

// The Microsoft four-square logo (filled, brand colors), for the Entra ID SSO
// button on the login screen. Uses its own fills (not currentColor) so it reads
// as the recognizable Microsoft mark regardless of button text color.
export const IconMicrosoft = ({ size = 18, ...rest }: { size?: number } & Omit<SVGProps<SVGSVGElement>, "width" | "height">) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden {...rest}>
    <rect x="3" y="3" width="8" height="8" fill="#F25022" />
    <rect x="13" y="3" width="8" height="8" fill="#7FBA00" />
    <rect x="3" y="13" width="8" height="8" fill="#00A4EF" />
    <rect x="13" y="13" width="8" height="8" fill="#FFB900" />
  </svg>
);

// A generic directory / building mark for LDAP sign-in.
export const IconDirectory = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 21h18" />
    <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
    <path d="M9 7h.01M12 7h.01M15 7h.01M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01" />
  </svg>
);

/**
 * The official Castor logo (the LEONARD-IT/GTEK-IT beaver mascot stacking Docker / Swarm /
 * Kubernetes containers). Served from /brand/castor-logo.webp (ui/public/brand).
 * Sized via `size` (square). Kept named BeaverMascot so existing call sites
 * (Sidebar, AuthBrand, NotFound) need no change.
 */
export function BeaverMascot({
  size = 32,
  ...rest
}: { size?: number } & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height">) {
  return (
    <img
      src="/brand/castor-logo.jpg"
      width={size}
      height={size}
      alt="Castor"
      style={{ objectFit: "contain", display: "block", ...(rest.style || {}) }}
      {...rest}
    />
  );
}
