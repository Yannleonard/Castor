// ui/src/i18n/locales/wlOverviewTab.ts
//
// Locale dictionary for the workload Overview tab
// (ui/src/views/workload/OverviewTab.tsx). Follows the audit.ts model: one
// dictionary per view, camelCase keys namespaced by UI zone.
//
//   card.*       card titles + captions
//   field.*      definition-list labels (normalized workload header fields)
//   snap.*       resource snapshot metric labels
//   empty.*      empty-state text
//   net.*        per-network row labels (Networks card)
//   action.*     Networks card buttons
//   gate.*       disabled-button reasons (capability / permission / protected)
//   connect.*    "Connect to network" modal
//   disconnect.* "Disconnect from network" confirmation
//   toast.*      network connect / disconnect outcomes
//
// DO NOT translate technical identifiers rendered verbatim from the data
// (image refs, node names, provider ids, port numbers, label keys/values,
// network names, IP/MAC addresses, aliases, permission names).

import { defineDict } from "../core";

export const wlOverviewTabDict = defineDict({
  en: {
    // Card titles / captions
    "card.overview": "Overview",
    "card.ports": "Ports",
    "card.networks": "Networks",
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
    "empty.networks": "Not attached to any network.",

    // Network rows
    "net.gateway": "Gateway",
    "net.noAddress": "no address",
    "net.exclusiveMode": "This container uses {mode} networking; it cannot join other networks.",

    // Networks card actions
    "action.connect": "Connect to network…",
    "action.disconnect": "Disconnect",

    // Disabled-button reasons
    "gate.noNetworks": "This provider does not manage networks.",
    "gate.protected": "Protected containers cannot be rewired.",
    "gate.needConnect": "Requires the docker.network.connect permission.",
    "gate.needDisconnect": "Requires the docker.network.disconnect permission.",

    // Connect modal
    "connect.title": "Connect to network",
    "connect.network": "Network",
    "connect.networkPlaceholder": "Select a network…",
    "connect.loading": "Loading networks…",
    "connect.loadFailed": "Could not load the networks of this host.",
    "connect.noCandidates": "Every network on this host is already attached.",
    "connect.ipv4": "Static IPv4 (optional)",
    "connect.ipv4Placeholder": "Leave empty for an automatic address",
    "connect.ipv4Hint": "Subnets: {subnets}",
    "connect.ipv4Bridge": "Static addresses are not supported on the default bridge network.",
    "connect.ipv4NoSubnet": "This network has no configured subnet; the address will be assigned automatically.",
    "connect.ipv4Error": "Enter a valid IPv4 address (e.g. 172.18.0.10).",
    "connect.aliases": "Aliases (optional)",
    "connect.aliasesPlaceholder": "db, cache.internal",
    "connect.aliasesHint": "Extra DNS names, comma-separated, that other containers on this network can resolve.",
    "connect.aliasesError": "Aliases may only contain letters, digits, dots, dashes and underscores.",
    "connect.submit": "Connect",

    // Disconnect confirmation
    "disconnect.title": "Disconnect from network",
    "disconnect.confirm": "Disconnect",
    "disconnect.question": "Disconnect",
    "disconnect.from": "from",
    "disconnect.hint": "? The container loses its address and aliases on this network; other containers can no longer reach it there.",

    // Toasts
    "toast.connectedTitle": "Connected to network",
    "toast.connectFailed": "Connect failed",
    "toast.disconnectedTitle": "Disconnected from network",
    "toast.disconnectFailed": "Disconnect failed",
  },
  fr: {
    // Titres / légendes de cartes
    "card.overview": "Aperçu",
    "card.ports": "Ports",
    "card.networks": "Réseaux",
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
    "empty.networks": "Rattaché à aucun réseau.",

    // Lignes réseau
    "net.gateway": "Passerelle",
    "net.noAddress": "sans adresse",
    "net.exclusiveMode": "Ce conteneur utilise le mode réseau {mode} ; il ne peut rejoindre aucun autre réseau.",

    // Actions de la carte Réseaux
    "action.connect": "Connecter à un réseau…",
    "action.disconnect": "Déconnecter",

    // Raisons de désactivation des boutons
    "gate.noNetworks": "Ce fournisseur ne gère pas les réseaux.",
    "gate.protected": "Un conteneur protégé ne peut pas être recâblé.",
    "gate.needConnect": "Nécessite la permission docker.network.connect.",
    "gate.needDisconnect": "Nécessite la permission docker.network.disconnect.",

    // Modale de connexion
    "connect.title": "Connecter à un réseau",
    "connect.network": "Réseau",
    "connect.networkPlaceholder": "Choisir un réseau…",
    "connect.loading": "Chargement des réseaux…",
    "connect.loadFailed": "Impossible de charger les réseaux de cet hôte.",
    "connect.noCandidates": "Tous les réseaux de cet hôte sont déjà rattachés.",
    "connect.ipv4": "IPv4 statique (optionnel)",
    "connect.ipv4Placeholder": "Laisser vide pour une adresse automatique",
    "connect.ipv4Hint": "Sous-réseaux : {subnets}",
    "connect.ipv4Bridge": "Les adresses statiques ne sont pas prises en charge sur le réseau bridge par défaut.",
    "connect.ipv4NoSubnet": "Ce réseau n'a pas de sous-réseau configuré ; l'adresse sera attribuée automatiquement.",
    "connect.ipv4Error": "Saisissez une adresse IPv4 valide (ex. 172.18.0.10).",
    "connect.aliases": "Alias (optionnel)",
    "connect.aliasesPlaceholder": "db, cache.internal",
    "connect.aliasesHint": "Noms DNS supplémentaires, séparés par des virgules, résolus par les autres conteneurs de ce réseau.",
    "connect.aliasesError": "Un alias ne peut contenir que des lettres, chiffres, points, tirets et tirets bas.",
    "connect.submit": "Connecter",

    // Confirmation de déconnexion
    "disconnect.title": "Déconnecter du réseau",
    "disconnect.confirm": "Déconnecter",
    "disconnect.question": "Déconnecter",
    "disconnect.from": "du réseau",
    "disconnect.hint": " ? Le conteneur perd son adresse et ses alias sur ce réseau ; les autres conteneurs ne peuvent plus l'y joindre.",

    // Toasts
    "toast.connectedTitle": "Connecté au réseau",
    "toast.connectFailed": "Échec de la connexion",
    "toast.disconnectedTitle": "Déconnecté du réseau",
    "toast.disconnectFailed": "Échec de la déconnexion",
  },
});
