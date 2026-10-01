// Castor by IT Leonard
// ui/src/help/types.ts
//
// Data model for Castor's in-app help system. Each feature has a bilingual
// (EN/FR) "help card" authored as structured DATA — not JSX — so the HelpPanel
// is a pure renderer and new cards are cheap to add. Every card follows the same
// pedagogical spine so users always know where to look:
//
//   What it is → How it works in Castor → How to set it up → Pitfalls & tips → Docs
//
// A block is a small tagged union; the renderer (HelpPanel) maps each variant to
// markup. Keep authoring plain: no JSX, no HTML — just text, commands and links.

/** Language of a help card / the help panel toggle. */
export type Lang = "en" | "fr";

/** A single renderable piece inside a help section. */
export type HelpBlock =
  /** A paragraph of prose. `strong` marks are written with **double asterisks**. */
  | { kind: "p"; text: string }
  /** A muted "note / by the way" paragraph. */
  | { kind: "note"; text: string }
  /** A bulleted list. Items may contain **bold** and `code` spans. */
  | { kind: "list"; items: string[] }
  /** A copy-to-clipboard shell command (single line). */
  | { kind: "cmd"; command: string }
  /** A read-only code/config snippet (may be multi-line; not "runnable"). */
  | { kind: "code"; code: string }
  /** A callout box drawing attention to a gotcha. `tone` picks the accent. */
  | { kind: "callout"; tone: "info" | "warn"; text: string }
  /** An external documentation link. */
  | { kind: "doc"; href: string; label: string };

/** A titled group of blocks. */
export interface HelpSection {
  title: string;
  blocks: HelpBlock[];
}

/** One language's worth of a help card. */
export interface HelpBody {
  /** Short one-line summary shown under the panel title. */
  summary: string;
  sections: HelpSection[];
}

/** A complete bilingual help card for one feature/topic. */
export interface HelpCard {
  /** Stable key used by views: `useHelp("workloads")`, `<HelpButton topic="workloads" />`. */
  id: string;
  /** Panel heading, per language. */
  title: { en: string; fr: string };
  /** Body per language. */
  en: HelpBody;
  fr: HelpBody;
}

/** The registry maps a topic id to its card. */
export type HelpRegistry = Record<string, HelpCard>;
