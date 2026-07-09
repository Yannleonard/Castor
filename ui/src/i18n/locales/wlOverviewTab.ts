// ui/src/i18n/locales/wlOverviewTab.ts
//
// Locale dictionary for the workload Overview tab
// (ui/src/views/workload/OverviewTab.tsx). Follows the audit.ts model: one
// dictionary per view, camelCase keys namespaced by UI zone.
//
//   card.*   card titles + captions
//   field.*  definition-list labels (normalized workload header fields)
//   snap.*   resource snapshot metric labels
//   empty.*  empty-state text
//
// DO NOT translate technical identifiers rendered verbatim from the data
// (image refs, node names, provider ids, port numbers, label keys/values).

import { defineDict } from "../core";

export const wlOverviewTabDict = defineDict({
  en: {
    // Card titles / captions
    "card.overview": "Overview",
    "card.ports": "Ports",
    "card.snapshot": "Resource snapshot",
    "card.snapshotCaption": "one-shot",
    "card.labels": "Labels",

    // Definition-list fields
    "field.state": "State",
    "field.id": "ID",
    "field.image": "Image",
    "field.node": "Node",
    "field.provider": "Provider",
    "field.group": "Stack / group",
    "field.created": "Created",

    // Resource snapshot metrics
    "snap.cpu": "CPU",
    "snap.memory": "Memory",
    "snap.netRx": "Net RX",
    "snap.netTx": "Net TX",
    "snap.blockRead": "Block read",
    "snap.blockWrite": "Block write",

    // Empty state
    "empty.labels": "No labels.",
  },
  fr: {
    // Titres / légendes de cartes
    "card.overview": "Aperçu",
    "card.ports": "Ports",
    "card.snapshot": "Instantané des ressources",
    "card.snapshotCaption": "ponctuel",
    "card.labels": "Labels",

    // Champs de la liste de définitions
    "field.state": "État",
    "field.id": "ID",
    "field.image": "Image",
    "field.node": "Nœud",
    "field.provider": "Fournisseur",
    "field.group": "Stack / groupe",
    "field.created": "Créé le",

    // Métriques de l'instantané des ressources
    "snap.cpu": "CPU",
    "snap.memory": "Mémoire",
    "snap.netRx": "Réseau RX",
    "snap.netTx": "Réseau TX",
    "snap.blockRead": "Lecture disque",
    "snap.blockWrite": "Écriture disque",

    // État vide
    "empty.labels": "Aucun label.",
  },
});
