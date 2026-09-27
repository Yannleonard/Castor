// ui/src/i18n/locales/errors.ts
//
// Localized, actionable messages for machine-readable API error codes. toastError
// (ui/src/lib/toast.ts) looks up err.code here first and falls back to the raw
// server message for any code not listed. Keep keys equal to the backend error
// codes (authz/errors.go). Only codes worth a friendlier/localized phrasing need
// an entry — everything else uses the server message verbatim.
import { defineDict } from "../core";

export const errorsDict = defineDict({
  en: {
    name_conflict: "A container with this name already exists. Choose a different name, or remove the existing one first.",
    port_conflict: "That host port is already in use. Pick a different host port, or free the one in use.",
    image_not_found: "Image not found or could not be pulled. Check the name and tag, and any private-registry credentials.",
    conflict: "This action conflicts with the current state of the resource.",
    validation_failed: "The request is invalid. Check the highlighted fields and try again.",
    forbidden: "You do not have permission to perform this action.",
    aal_required: "Two-factor verification is required for this action.",
    rate_limited: "Too many requests — please slow down and retry shortly.",
    internal: "Something went wrong on the server. Please retry; if it persists, check the server logs.",
    // Docker networks (authz/errors.go network_* codes).
    network_exists: "A network with this name already exists. Choose a different name, or remove the existing network first.",
    subnet_overlap: "This subnet overlaps an existing network's address space. Pick a different subnet, or leave IPAM empty to let Docker choose one.",
    ip_in_use: "That IP address is already used on this network. Pick a free address, or leave it empty to let Docker assign one.",
    already_connected: "This container is already connected to that network. Disconnect it first to change its address or aliases.",
    not_connected: "This container is not connected to that network. Refresh the list — the attachment may already be gone.",
    static_ip_unsupported: "Static IP addresses only work on user-defined networks with a subnet, not on the default bridge. Create a network with a subnet, or leave the address empty.",
    network_in_use: "This network still has connected containers. Disconnect them (or stop and remove them) first, then remove the network.",
    invalid_network_config: "The network configuration is invalid. Check the subnet (CIDR notation, e.g. 10.10.0.0/24), that the gateway and IP range fall inside it, and any static address.",
    alias_unsupported: "Network aliases are not supported on the default bridge network. Connect the container to a user-defined network to give it aliases, or leave the aliases empty.",
    ip_pool_exhausted: "This network has no free address left in its subnet. Disconnect containers that no longer need it, or create a network with a larger subnet.",
  },
  fr: {
    name_conflict: "Un conteneur portant ce nom existe déjà. Choisissez un autre nom, ou supprimez d'abord l'existant.",
    port_conflict: "Ce port hôte est déjà utilisé. Choisissez un autre port hôte, ou libérez celui en cours d'utilisation.",
    image_not_found: "Image introuvable ou impossible à télécharger. Vérifiez le nom et le tag, ainsi que les identifiants du registre privé.",
    conflict: "Cette action entre en conflit avec l'état actuel de la ressource.",
    validation_failed: "La requête est invalide. Vérifiez les champs signalés et réessayez.",
    forbidden: "Vous n'avez pas la permission d'effectuer cette action.",
    aal_required: "Une vérification à deux facteurs est requise pour cette action.",
    rate_limited: "Trop de requêtes — ralentissez et réessayez dans un instant.",
    internal: "Une erreur serveur s'est produite. Réessayez ; si le problème persiste, consultez les journaux du serveur.",
    // Docker networks (authz/errors.go network_* codes).
    network_exists: "Un réseau portant ce nom existe déjà. Choisissez un autre nom, ou supprimez d'abord le réseau existant.",
    subnet_overlap: "Ce sous-réseau chevauche la plage d'adresses d'un réseau existant. Choisissez un autre sous-réseau, ou laissez l'IPAM vide pour que Docker en attribue un.",
    ip_in_use: "Cette adresse IP est déjà utilisée sur ce réseau. Choisissez une adresse libre, ou laissez le champ vide pour que Docker en attribue une.",
    already_connected: "Ce conteneur est déjà connecté à ce réseau. Déconnectez-le d'abord pour changer son adresse ou ses alias.",
    not_connected: "Ce conteneur n'est pas connecté à ce réseau. Actualisez la liste — le rattachement a peut-être déjà été retiré.",
    static_ip_unsupported: "Les adresses IP statiques ne fonctionnent que sur un réseau défini par l'utilisateur avec un sous-réseau, pas sur le bridge par défaut. Créez un réseau avec un sous-réseau, ou laissez l'adresse vide.",
    network_in_use: "Ce réseau a encore des conteneurs connectés. Déconnectez-les (ou arrêtez-les et supprimez-les) d'abord, puis supprimez le réseau.",
    invalid_network_config: "La configuration réseau est invalide. Vérifiez le sous-réseau (notation CIDR, ex. 10.10.0.0/24), que la passerelle et la plage d'IP s'y trouvent bien, ainsi que toute adresse statique.",
    alias_unsupported: "Les alias réseau ne sont pas pris en charge sur le réseau bridge par défaut. Connectez le conteneur à un réseau défini par l'utilisateur pour lui donner des alias, ou laissez les alias vides.",
    ip_pool_exhausted: "Ce réseau n'a plus aucune adresse libre dans son sous-réseau. Déconnectez les conteneurs qui n'en ont plus besoin, ou créez un réseau avec un sous-réseau plus grand.",
  },
});
