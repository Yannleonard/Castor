// ui/src/i18n/locales/mktRowEditors.ts
//
// Locale dictionary for the reusable repeating-row editors shared by the deploy
// modal and the custom template editor (ui/src/views/marketplace/RowEditors.tsx):
// port maps, environment variables, volume mounts and network attachments.
//
// Namespaces:
//   port.*  port-map row (placeholders, aria-labels, add/remove actions)
//   env.*   environment-variable row
//   vol.*   volume-mount row
//   net.*   network-attachment row (network select, static IPv4, aliases)
//
// Technical tokens rendered verbatim from the data are NOT translated here
// (e.g. the "tcp"/"udp" <option> values). "KEY" stays as a monospace hint.

import { defineDict } from "../core";

export const mktRowEditorsDict = defineDict({
  en: {
    // Port map row
    "port.hostPlaceholder": "host (auto)",
    "port.hostLabel": "Host port",
    "port.containerPlaceholder": "container",
    "port.containerLabel": "Container port",
    "port.protoLabel": "Protocol",
    "port.remove": "Remove port",
    "port.add": "Add port",

    // Environment variable row
    "env.keyPlaceholder": "KEY",
    "env.keyLabel": "Variable name",
    "env.requiredHint": "Required",
    "env.valueRequiredPlaceholder": "required",
    "env.valuePlaceholder": "value",
    "env.valueLabel": "Variable value",
    "env.requiredLabel": "Required",
    "env.remove": "Remove variable",
    "env.add": "Add variable",

    // Volume mount row
    "vol.sourcePlaceholder": "volume name or /host/path",
    "vol.sourceLabel": "Volume source",
    "vol.targetPlaceholder": "/container/path",
    "vol.targetLabel": "Container path",
    "vol.remove": "Remove volume",
    "vol.add": "Add volume",

    // Network attachment row
    "net.networkLabel": "Network",
    "net.networkPlaceholder": "Select a network…",
    "net.networkLoading": "Loading networks…",
    "net.ipv4Placeholder": "static IPv4 (optional)",
    "net.ipv4Label": "Static IPv4",
    "net.ipv4Invalid": "Not a valid IPv4 address",
    "net.bridgeLocked": "The default bridge takes neither a static IP nor aliases",
    "net.aliasesPlaceholder": "aliases, comma-separated",
    "net.aliasesLabel": "DNS aliases",
    "net.remove": "Remove network",
    "net.add": "Attach to network",
  },
  fr: {
    // Ligne de mappage de port
    "port.hostPlaceholder": "hôte (auto)",
    "port.hostLabel": "Port hôte",
    "port.containerPlaceholder": "conteneur",
    "port.containerLabel": "Port du conteneur",
    "port.protoLabel": "Protocole",
    "port.remove": "Supprimer le port",
    "port.add": "Ajouter un port",

    // Ligne de variable d'environnement
    "env.keyPlaceholder": "CLÉ",
    "env.keyLabel": "Nom de la variable",
    "env.requiredHint": "Requis",
    "env.valueRequiredPlaceholder": "requis",
    "env.valuePlaceholder": "valeur",
    "env.valueLabel": "Valeur de la variable",
    "env.requiredLabel": "Requis",
    "env.remove": "Supprimer la variable",
    "env.add": "Ajouter une variable",

    // Ligne de montage de volume
    "vol.sourcePlaceholder": "nom du volume ou /chemin/hôte",
    "vol.sourceLabel": "Source du volume",
    "vol.targetPlaceholder": "/chemin/conteneur",
    "vol.targetLabel": "Chemin du conteneur",
    "vol.remove": "Supprimer le volume",
    "vol.add": "Ajouter un volume",

    // Ligne de rattachement réseau
    "net.networkLabel": "Réseau",
    "net.networkPlaceholder": "Choisir un réseau…",
    "net.networkLoading": "Chargement des réseaux…",
    "net.ipv4Placeholder": "IPv4 statique (optionnel)",
    "net.ipv4Label": "IPv4 statique",
    "net.ipv4Invalid": "Adresse IPv4 invalide",
    "net.bridgeLocked": "Le bridge par défaut n'accepte ni IP statique ni alias",
    "net.aliasesPlaceholder": "alias, séparés par des virgules",
    "net.aliasesLabel": "Alias DNS",
    "net.remove": "Retirer le réseau",
    "net.add": "Rattacher à un réseau",
  },
});
