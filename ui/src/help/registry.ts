// ui/src/help/registry.ts
//
// Central registry of every in-app help card. Views reference a card by its
// string id (`<HelpButton topic="workloads" />`). Adding help for a feature =
// authoring a card file in ./cards/ and adding it here — nothing else changes.

import type { HelpCard, HelpRegistry } from "./types";

import { swarmCard } from "./cards/swarm";
import { kubernetesCard } from "./cards/kubernetes";
import { dashboardCard } from "./cards/dashboard";
import { workloadsCard } from "./cards/workloads";
import { terminalCard } from "./cards/terminal";
import { imagesCard } from "./cards/images";
import { volumesCard } from "./cards/volumes";
import { networksCard } from "./cards/networks";
import { stacksCard } from "./cards/stacks";
import { marketplaceCard } from "./cards/marketplace";
import { registriesCard } from "./cards/registries";
import { helmCard } from "./cards/helm";
import { rbacCard } from "./cards/rbac";
import { authenticationCard } from "./cards/authentication";
import { settingsCard } from "./cards/settings";
import { auditCard } from "./cards/audit";
import { profileCard } from "./cards/profile";

const cards: HelpCard[] = [
  swarmCard,
  kubernetesCard,
  dashboardCard,
  workloadsCard,
  terminalCard,
  imagesCard,
  volumesCard,
  networksCard,
  stacksCard,
  marketplaceCard,
  registriesCard,
  helmCard,
  rbacCard,
  authenticationCard,
  settingsCard,
  auditCard,
  profileCard,
];

export const HELP_CARDS: HelpRegistry = Object.fromEntries(cards.map((c) => [c.id, c]));

/** All known topic ids (useful for tests / dev assertions). */
export const HELP_TOPICS = Object.keys(HELP_CARDS);

/** Look up a card by topic id, or undefined if unknown. */
export function getHelpCard(topic: string): HelpCard | undefined {
  return HELP_CARDS[topic];
}
