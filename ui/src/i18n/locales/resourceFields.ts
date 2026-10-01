// Castor by IT Leonard
// ui/src/i18n/locales/resourceFields.ts
//
// Locale dictionary for the shared resource-limit inputs
// (ui/src/components/ResourceFields.tsx), used by the Docker deploy modal, the
// Swarm create/update modals and the Kubernetes resources modal.
//
// Namespaces:
//   docker.*  Docker / Swarm fields (CPU cores + memory bytes)
//   k8s.*     Kubernetes fields (CPU millicores + memory bytes)
//   mem.*     memory input aria-labels (shared amount/unit sub-inputs)
//   hint.*    shared field hints
//
// NOTE: "millicores", "cores", "MiB"/"GiB" are established technical units and
// are kept verbatim across languages. Container / Kubernetes concepts (requests,
// limits, reservations) are translated. The {label} interpolation carries the
// caller-provided section name (Requests / Limits) into aria-labels.

import { defineDict } from "../core";

export const resourceFieldsDict = defineDict({
  en: {
    // Docker / Swarm fields
    "docker.cpuLimitLabel": "CPU limit (cores)",
    "docker.cpuLimitAria": "CPU limit in cores",
    "docker.cpuLimitPlaceholder": "e.g. 0.5",
    "docker.memLimitLabel": "Memory limit",
    "docker.cpuReservationLabel": "CPU reservation (cores)",
    "docker.cpuReservationAria": "CPU reservation in cores",
    "docker.cpuReservationPlaceholder": "e.g. 0.25",
    "docker.memReservationLabel": "Memory reservation",

    // Kubernetes fields
    "k8s.cpuHint": "CPU (millicores)",
    "k8s.cpuPlaceholder": "e.g. 500",
    "k8s.cpuAria": "{label} CPU in millicores",
    "k8s.memoryHint": "Memory",
    "k8s.memoryAria": "{label} memory",

    // Shared memory sub-input aria-labels
    "mem.amountAria": "{prefix} amount",
    "mem.unitAria": "{prefix} unit",

    // Shared hint
    "hint.blankUnset": "Leave a field blank to leave that limit unset.",
  },
  fr: {
    // Champs Docker / Swarm
    "docker.cpuLimitLabel": "Limite CPU (cores)",
    "docker.cpuLimitAria": "Limite CPU en cores",
    "docker.cpuLimitPlaceholder": "ex. 0.5",
    "docker.memLimitLabel": "Limite mémoire",
    "docker.cpuReservationLabel": "Réservation CPU (cores)",
    "docker.cpuReservationAria": "Réservation CPU en cores",
    "docker.cpuReservationPlaceholder": "ex. 0.25",
    "docker.memReservationLabel": "Réservation mémoire",

    // Champs Kubernetes
    "k8s.cpuHint": "CPU (millicores)",
    "k8s.cpuPlaceholder": "ex. 500",
    "k8s.cpuAria": "CPU {label} en millicores",
    "k8s.memoryHint": "Mémoire",
    "k8s.memoryAria": "Mémoire {label}",

    // Aria-labels des sous-champs mémoire partagés
    "mem.amountAria": "Quantité {prefix}",
    "mem.unitAria": "Unité {prefix}",

    // Indication partagée
    "hint.blankUnset": "Laissez un champ vide pour ne pas définir cette limite.",
  },
});
