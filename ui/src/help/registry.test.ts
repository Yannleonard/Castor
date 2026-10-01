// Castor by IT Leonard
// ui/src/help/registry.test.ts
//
// Integrity contract for the data-driven help system. If a card is added,
// renamed, or malformed, these assertions fail loudly instead of the panel
// silently rendering nothing at runtime.
import { describe, it, expect } from "vitest";
import { HELP_CARDS, HELP_TOPICS, getHelpCard } from "./registry";
import type { HelpBody, HelpBlock, HelpCard } from "./types";

const BLOCK_KINDS = ["p", "note", "list", "cmd", "code", "callout", "doc"] as const;

/** Topics referenced from views via <HelpButton topic="..." />. Keep in sync
 *  with the wiring; a missing card here means a view opens an empty panel. */
const WIRED_TOPICS = [
  "dashboard", "workloads", "terminal", "images", "volumes", "networks",
  "stacks", "marketplace", "registries", "helm", "kubernetes", "swarm",
  "rbac", "authentication", "settings", "audit", "profile",
];

function assertBody(body: HelpBody, ctx: string) {
  expect(body.summary.trim().length, `${ctx}: summary must be non-empty`).toBeGreaterThan(0);
  expect(body.sections.length, `${ctx}: at least one section`).toBeGreaterThan(0);
  for (const [si, section] of body.sections.entries()) {
    expect(section.title.trim().length, `${ctx}: section[${si}] title`).toBeGreaterThan(0);
    expect(section.blocks.length, `${ctx}: section[${si}] has blocks`).toBeGreaterThan(0);
    for (const [bi, block] of section.blocks.entries()) {
      assertBlock(block, `${ctx}: section[${si}].block[${bi}]`);
    }
  }
}

function assertBlock(block: HelpBlock, ctx: string) {
  expect(BLOCK_KINDS as readonly string[], `${ctx}: valid kind`).toContain(block.kind);
  switch (block.kind) {
    case "p":
    case "note":
      expect(block.text.trim().length, `${ctx}: text`).toBeGreaterThan(0);
      break;
    case "callout":
      expect(block.text.trim().length, `${ctx}: callout text`).toBeGreaterThan(0);
      expect(["info", "warn"], `${ctx}: callout tone`).toContain(block.tone);
      break;
    case "list":
      expect(block.items.length, `${ctx}: list has items`).toBeGreaterThan(0);
      for (const item of block.items) {
        expect(item.trim().length, `${ctx}: list item non-empty`).toBeGreaterThan(0);
      }
      break;
    case "cmd":
      expect(block.command.trim().length, `${ctx}: cmd`).toBeGreaterThan(0);
      break;
    case "code":
      expect(block.code.trim().length, `${ctx}: code`).toBeGreaterThan(0);
      break;
    case "doc":
      expect(block.href, `${ctx}: doc href is a url`).toMatch(/^https?:\/\//);
      expect(block.label.trim().length, `${ctx}: doc label`).toBeGreaterThan(0);
      break;
  }
}

describe("help registry", () => {
  const cards = Object.values(HELP_CARDS) as HelpCard[];

  it("has at least the 17 shipped cards", () => {
    expect(HELP_TOPICS.length).toBeGreaterThanOrEqual(17);
  });

  it("registry key matches each card's own id", () => {
    for (const [key, card] of Object.entries(HELP_CARDS)) {
      expect(card.id, `key "${key}" must equal card.id`).toBe(key);
    }
  });

  it("has no duplicate ids", () => {
    const ids = cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(cards.map((c) => [c.id, c] as const))(
    "card %s is complete and bilingual (en + fr)",
    (_id, card) => {
      expect(card.title.en.trim().length).toBeGreaterThan(0);
      expect(card.title.fr.trim().length).toBeGreaterThan(0);
      assertBody(card.en, `${card.id}.en`);
      assertBody(card.fr, `${card.id}.fr`);
    },
  );

  it("resolves every topic wired into a view", () => {
    for (const topic of WIRED_TOPICS) {
      expect(getHelpCard(topic), `no help card for wired topic "${topic}"`).toBeDefined();
    }
  });

  it("returns undefined for an unknown topic", () => {
    expect(getHelpCard("does-not-exist")).toBeUndefined();
  });
});
