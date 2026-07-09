// ui/src/i18n/locales/helm.ts
//
// Locale dictionary for the Helm view (ui/src/views/Helm.tsx): chart
// repositories, chart catalog, and release lifecycle (install / upgrade /
// rollback / uninstall / inspect). Follows the audit.ts model:
//
//   • One dictionary per view, authored with `defineDict` (en + fr halves).
//   • Keys are camelCase, namespaced by UI zone:
//       header.*   page header (title/subtitle) + toolbar actions
//       tab.*      the three top-level tabs
//       repo.*     repositories tab (table, empty state, add-repo modal)
//       chart.*    charts tab (search bar, cards, install modal)
//       release.*  releases tab (table columns, status, inspect/upgrade/…)
//       upgrade.*  upgrade modal + preview diff
//       rollback.* rollback modal + history table
//       inspect.*  inspect (values + history) modal
//       dialog.*   destructive confirm dialogs (uninstall, remove repo)
//       toast.*    toast titles + bodies (support {vars} interpolation)
//   • Interpolations use {token} — e.g. chart.count: "{n} chart(s)".
//   • DO NOT translate technical identifiers: permission strings
//     (helm.repo.write, helm.release.install…), repo/chart references,
//     status values returned by the backend, YAML/URL examples. Those are
//     rendered verbatim from the data, never through `t`.

import { defineDict } from "../core";

export const helmDict = defineDict({
  en: {
    // Page header
    "header.title": "Helm",
    "header.subtitle": "Manage chart repositories, browse charts, and operate installed releases.",
    "header.update": "Update",
    "header.updateTooltip": "Refresh all chart indexes",
    "header.addRepo": "Add repo",
    "header.refresh": "Refresh",
    "header.noRepoWrite": "You lack the helm.repo.write permission",

    // Tabs
    "tab.repos": "Repositories",
    "tab.charts": "Charts",
    "tab.releases": "Releases",

    // Repositories tab
    "repo.loading": "Loading repositories…",
    "repo.colName": "Repository",
    "repo.colUrl": "URL",
    "repo.remove": "Remove repository",
    "repo.removeNoPerm": "You lack the helm.repo.write permission",
    "repo.emptyTitle": "No chart repositories",
    "repo.emptyMessage":
      "Add a Helm chart repository (for example Bitnami at https://charts.bitnami.com/bitnami) to browse and install charts.",
    "repo.emptyAction": "Add repository",
    "repo.emptyTableTitle": "No repositories",

    // Add repo modal
    "repo.addTitle": "Add chart repository",
    "repo.addIntro": "Adding a repository downloads its chart index so its charts become searchable.",
    "repo.fieldName": "Name",
    "repo.fieldUrl": "URL",
    "repo.urlError": "Must be an http(s) URL.",
    "repo.cancel": "Cancel",
    "repo.add": "Add",

    // Charts tab — search bar
    "chart.searchPlaceholder": "Search charts (e.g. postgresql, nginx)…",
    "chart.search": "Search",
    "chart.clear": "Clear",
    "chart.count": "{n} chart(s)",
    "chart.searching": "Searching charts…",
    "chart.noneTitle": "No charts found",
    "chart.noneMessage": "No charts matched. Add a repository and run Update on the Repositories tab, then search again.",

    // Chart card
    "chart.cardChart": "chart",
    "chart.cardApp": "app",
    "chart.install": "Install",
    "chart.installNoPerm": "You lack the helm.release.install permission",

    // Install chart modal
    "chart.installTitle": "Install chart",
    "chart.installIntroPrefix": "Installing",
    "chart.releaseName": "Release name",
    "chart.namespace": "Namespace",
    "chart.version": "Version",
    "chart.versionPlaceholder": "latest",
    "chart.versionHint": "Blank = latest",
    "chart.valuesLabel": "Values (YAML, optional)",
    "chart.valuesHint": "Leave blank to use chart defaults.",
    "chart.invalidYaml": "Invalid YAML.",
    "chart.installCancel": "Cancel",
    "chart.installConfirm": "Install",

    // Releases tab — columns
    "release.loading": "Loading releases…",
    "release.colName": "Release",
    "release.colNamespace": "Namespace",
    "release.colRevision": "Rev",
    "release.colStatus": "Status",
    "release.colAppVersion": "App version",
    "release.colUpdated": "Updated",
    "release.emptyTitle": "No releases installed",
    "release.emptyMessage": "Install a chart from the Charts tab to create your first release.",

    // Releases tab — row actions
    "release.inspect": "Values & history",
    "release.inspectAria": "Inspect release",
    "release.upgrade": "Upgrade",
    "release.upgradeAria": "Upgrade release",
    "release.upgradeNoPerm": "You lack the helm.release.upgrade permission",
    "release.rollback": "Rollback",
    "release.rollbackAria": "Rollback release",
    "release.rollbackNoPerm": "You lack the helm.release.rollback permission",
    "release.uninstall": "Uninstall",
    "release.uninstallAria": "Uninstall release",
    "release.uninstallNoPerm": "You lack the helm.release.uninstall permission",

    // Upgrade modal
    "upgrade.title": "Upgrade release",
    "upgrade.cancel": "Cancel",
    "upgrade.preview": "Preview",
    "upgrade.previewTooltip": "Dry-run: render the change and diff it against the current release",
    "upgrade.confirm": "Upgrade",
    "upgrade.introPrefix": "Upgrade",
    "upgrade.introNamespace": "in namespace",
    "upgrade.introRevision": "(currently revision",
    "upgrade.introChart": ", chart",
    "upgrade.fieldChart": "Chart",
    "upgrade.chartHint": "repo/chart reference",
    "upgrade.fieldVersion": "Version",
    "upgrade.versionPlaceholder": "latest",
    "upgrade.versionHint": "Blank = latest",
    "upgrade.valuesLabel": "Values (YAML, optional)",
    "upgrade.valuesHint": "Merged over the release's existing values.",
    "upgrade.invalidYaml": "Invalid YAML.",

    // Upgrade preview diff
    "upgrade.previewDiff": "Preview diff",
    "upgrade.firstInstall": "(first install — everything is new)",
    "upgrade.noChange": "No manifest changes — the rendered output is identical.",

    // Rollback modal
    "rollback.title": "Rollback release",
    "rollback.cancel": "Cancel",
    "rollback.confirm": "Rollback",
    "rollback.introPrefix": "Roll",
    "rollback.introSuffix": "back to an earlier revision. The chosen revision is re-applied as a new revision on top.",
    "rollback.targetRevision": "Target revision",
    "rollback.previousRevision": "Previous revision",
    "rollback.loadingHistory": "Loading history…",
    "rollback.noEarlier": 'No earlier revisions recorded; "Previous revision" will be used.',
    "rollback.history": "History",
    "rollback.colRev": "Rev",
    "rollback.colStatus": "Status",
    "rollback.colChart": "Chart",
    "rollback.colUpdated": "Updated",
    "rollback.colDescription": "Description",

    // Inspect (values + history) modal
    "inspect.releaseLabel": "Release",
    "inspect.close": "Close",
    "inspect.tabValues": "Values",
    "inspect.tabHistory": "History",
    "inspect.loadingValues": "Loading values…",
    "inspect.valuesEmpty": "This release has no user-supplied value overrides (chart defaults in effect).",
    "inspect.loadingHistory": "Loading history…",
    "inspect.historyEmpty": "No revision history recorded.",
    "inspect.colRev": "Rev",
    "inspect.colStatus": "Status",
    "inspect.colChart": "Chart",
    "inspect.colApp": "App",
    "inspect.colUpdated": "Updated",
    "inspect.colDescription": "Description",

    // Uninstall / remove-repo confirm dialogs
    "dialog.uninstallTitle": "Uninstall release",
    "dialog.uninstallConfirm": "Uninstall",
    "dialog.uninstallDescPrefix": "Uninstall",
    "dialog.uninstallDescMid": "from namespace",
    "dialog.uninstallDescSuffix": "? All resources it created are removed. This cannot be undone.",
    "dialog.removeRepoTitle": "Remove repository",
    "dialog.removeRepoConfirm": "Remove",
    "dialog.removeRepoDescPrefix": "Remove repository",
    "dialog.removeRepoDescSuffix": "? Its cached chart index is dropped; installed releases are not affected.",

    // Toasts
    "toast.updatedTitle": "Repositories updated",
    "toast.updatedBody": "Chart indexes refreshed.",
    "toast.updateFailed": "Update failed",
    "toast.repoRemovedTitle": "Repository removed",
    "toast.removeFailed": "Remove failed",
    "toast.uninstalledTitle": "Release uninstalled",
    "toast.uninstallFailed": "Uninstall failed",
    "toast.repoAddedTitle": "Repository added",
    "toast.addRepoFailed": "Add repository failed",
    "toast.installedTitle": "Chart installed",
    "toast.installFailed": "Install failed",
    "toast.previewFailed": "Preview failed",
    "toast.upgradedTitle": "Release upgraded",
    "toast.upgradeFailed": "Upgrade failed",
    "toast.rolledBackTitle": "Release rolled back",
    "toast.rolledBackBody": "{target} → revision {rev}",
    "toast.rolledBackPrevious": "previous",
    "toast.rollbackFailed": "Rollback failed",
  },
  fr: {
    // En-tête de page
    "header.title": "Helm",
    "header.subtitle":
      "Gérez les dépôts de charts, parcourez les charts et pilotez les releases installées.",
    "header.update": "Mettre à jour",
    "header.updateTooltip": "Rafraîchir tous les index de charts",
    "header.addRepo": "Ajouter un dépôt",
    "header.refresh": "Actualiser",
    "header.noRepoWrite": "Vous n'avez pas la permission helm.repo.write",

    // Onglets
    "tab.repos": "Dépôts",
    "tab.charts": "Charts",
    "tab.releases": "Releases",

    // Onglet Dépôts
    "repo.loading": "Chargement des dépôts…",
    "repo.colName": "Dépôt",
    "repo.colUrl": "URL",
    "repo.remove": "Retirer le dépôt",
    "repo.removeNoPerm": "Vous n'avez pas la permission helm.repo.write",
    "repo.emptyTitle": "Aucun dépôt de charts",
    "repo.emptyMessage":
      "Ajoutez un dépôt de charts Helm (par exemple Bitnami à https://charts.bitnami.com/bitnami) pour parcourir et installer des charts.",
    "repo.emptyAction": "Ajouter un dépôt",
    "repo.emptyTableTitle": "Aucun dépôt",

    // Fenêtre d'ajout de dépôt
    "repo.addTitle": "Ajouter un dépôt de charts",
    "repo.addIntro": "Ajouter un dépôt télécharge son index de charts afin que ses charts deviennent cherchables.",
    "repo.fieldName": "Nom",
    "repo.fieldUrl": "URL",
    "repo.urlError": "Doit être une URL http(s).",
    "repo.cancel": "Annuler",
    "repo.add": "Ajouter",

    // Onglet Charts — barre de recherche
    "chart.searchPlaceholder": "Rechercher des charts (ex. postgresql, nginx)…",
    "chart.search": "Rechercher",
    "chart.clear": "Effacer",
    "chart.count": "{n} chart(s)",
    "chart.searching": "Recherche de charts…",
    "chart.noneTitle": "Aucun chart trouvé",
    "chart.noneMessage":
      "Aucun chart ne correspond. Ajoutez un dépôt et lancez Mettre à jour dans l'onglet Dépôts, puis relancez la recherche.",

    // Carte de chart
    "chart.cardChart": "chart",
    "chart.cardApp": "app",
    "chart.install": "Installer",
    "chart.installNoPerm": "Vous n'avez pas la permission helm.release.install",

    // Fenêtre d'installation de chart
    "chart.installTitle": "Installer un chart",
    "chart.installIntroPrefix": "Installation de",
    "chart.releaseName": "Nom de la release",
    "chart.namespace": "Namespace",
    "chart.version": "Version",
    "chart.versionPlaceholder": "latest",
    "chart.versionHint": "Vide = dernière version",
    "chart.valuesLabel": "Valeurs (YAML, facultatif)",
    "chart.valuesHint": "Laissez vide pour utiliser les valeurs par défaut du chart.",
    "chart.invalidYaml": "YAML invalide.",
    "chart.installCancel": "Annuler",
    "chart.installConfirm": "Installer",

    // Onglet Releases — colonnes
    "release.loading": "Chargement des releases…",
    "release.colName": "Release",
    "release.colNamespace": "Namespace",
    "release.colRevision": "Rév",
    "release.colStatus": "Statut",
    "release.colAppVersion": "Version app",
    "release.colUpdated": "Mise à jour",
    "release.emptyTitle": "Aucune release installée",
    "release.emptyMessage": "Installez un chart depuis l'onglet Charts pour créer votre première release.",

    // Onglet Releases — actions de ligne
    "release.inspect": "Valeurs et historique",
    "release.inspectAria": "Inspecter la release",
    "release.upgrade": "Mettre à niveau",
    "release.upgradeAria": "Mettre à niveau la release",
    "release.upgradeNoPerm": "Vous n'avez pas la permission helm.release.upgrade",
    "release.rollback": "Restaurer",
    "release.rollbackAria": "Restaurer la release",
    "release.rollbackNoPerm": "Vous n'avez pas la permission helm.release.rollback",
    "release.uninstall": "Désinstaller",
    "release.uninstallAria": "Désinstaller la release",
    "release.uninstallNoPerm": "Vous n'avez pas la permission helm.release.uninstall",

    // Fenêtre de mise à niveau
    "upgrade.title": "Mettre à niveau la release",
    "upgrade.cancel": "Annuler",
    "upgrade.preview": "Prévisualiser",
    "upgrade.previewTooltip": "Simulation : rendre le changement et le comparer à la release actuelle",
    "upgrade.confirm": "Mettre à niveau",
    "upgrade.introPrefix": "Mettre à niveau",
    "upgrade.introNamespace": "dans le namespace",
    "upgrade.introRevision": "(révision actuelle",
    "upgrade.introChart": ", chart",
    "upgrade.fieldChart": "Chart",
    "upgrade.chartHint": "référence dépôt/chart",
    "upgrade.fieldVersion": "Version",
    "upgrade.versionPlaceholder": "latest",
    "upgrade.versionHint": "Vide = dernière version",
    "upgrade.valuesLabel": "Valeurs (YAML, facultatif)",
    "upgrade.valuesHint": "Fusionnées par-dessus les valeurs existantes de la release.",
    "upgrade.invalidYaml": "YAML invalide.",

    // Diff de prévisualisation
    "upgrade.previewDiff": "Diff de prévisualisation",
    "upgrade.firstInstall": "(première installation — tout est nouveau)",
    "upgrade.noChange": "Aucun changement de manifeste — le rendu produit est identique.",

    // Fenêtre de restauration
    "rollback.title": "Restaurer la release",
    "rollback.cancel": "Annuler",
    "rollback.confirm": "Restaurer",
    "rollback.introPrefix": "Restaurer",
    "rollback.introSuffix":
      "vers une révision antérieure. La révision choisie est ré-appliquée comme une nouvelle révision par-dessus.",
    "rollback.targetRevision": "Révision cible",
    "rollback.previousRevision": "Révision précédente",
    "rollback.loadingHistory": "Chargement de l'historique…",
    "rollback.noEarlier": "Aucune révision antérieure enregistrée ; la « révision précédente » sera utilisée.",
    "rollback.history": "Historique",
    "rollback.colRev": "Rév",
    "rollback.colStatus": "Statut",
    "rollback.colChart": "Chart",
    "rollback.colUpdated": "Mise à jour",
    "rollback.colDescription": "Description",

    // Fenêtre d'inspection (valeurs + historique)
    "inspect.releaseLabel": "Release",
    "inspect.close": "Fermer",
    "inspect.tabValues": "Valeurs",
    "inspect.tabHistory": "Historique",
    "inspect.loadingValues": "Chargement des valeurs…",
    "inspect.valuesEmpty":
      "Cette release n'a aucune surcharge de valeurs fournie par l'utilisateur (valeurs par défaut du chart en vigueur).",
    "inspect.loadingHistory": "Chargement de l'historique…",
    "inspect.historyEmpty": "Aucun historique de révisions enregistré.",
    "inspect.colRev": "Rév",
    "inspect.colStatus": "Statut",
    "inspect.colChart": "Chart",
    "inspect.colApp": "App",
    "inspect.colUpdated": "Mise à jour",
    "inspect.colDescription": "Description",

    // Fenêtres de confirmation (désinstallation, retrait de dépôt)
    "dialog.uninstallTitle": "Désinstaller la release",
    "dialog.uninstallConfirm": "Désinstaller",
    "dialog.uninstallDescPrefix": "Désinstaller",
    "dialog.uninstallDescMid": "du namespace",
    "dialog.uninstallDescSuffix":
      " ? Toutes les ressources qu'elle a créées sont supprimées. Cette action est irréversible.",
    "dialog.removeRepoTitle": "Retirer le dépôt",
    "dialog.removeRepoConfirm": "Retirer",
    "dialog.removeRepoDescPrefix": "Retirer le dépôt",
    "dialog.removeRepoDescSuffix":
      " ? Son index de charts en cache est supprimé ; les releases installées ne sont pas affectées.",

    // Toasts
    "toast.updatedTitle": "Dépôts mis à jour",
    "toast.updatedBody": "Index de charts rafraîchis.",
    "toast.updateFailed": "Échec de la mise à jour",
    "toast.repoRemovedTitle": "Dépôt retiré",
    "toast.removeFailed": "Échec du retrait",
    "toast.uninstalledTitle": "Release désinstallée",
    "toast.uninstallFailed": "Échec de la désinstallation",
    "toast.repoAddedTitle": "Dépôt ajouté",
    "toast.addRepoFailed": "Échec de l'ajout du dépôt",
    "toast.installedTitle": "Chart installé",
    "toast.installFailed": "Échec de l'installation",
    "toast.previewFailed": "Échec de la prévisualisation",
    "toast.upgradedTitle": "Release mise à niveau",
    "toast.upgradeFailed": "Échec de la mise à niveau",
    "toast.rolledBackTitle": "Release restaurée",
    "toast.rolledBackBody": "{target} → révision {rev}",
    "toast.rolledBackPrevious": "précédente",
    "toast.rollbackFailed": "Échec de la restauration",
  },
});
