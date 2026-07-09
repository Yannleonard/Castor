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
  },
});
