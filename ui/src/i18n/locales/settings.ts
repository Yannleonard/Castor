// ui/src/i18n/locales/settings.ts
//
// Locale dictionary for the Settings view (ui/src/views/Settings.tsx). Covers the
// page header + global save, the Security card (2FA toggle, session lifetime,
// protected labels), the read-only Instance card, the HTTPS & certificates card
// (ui/src/views/settings/TlsCard.tsx + ImportCertificateModal.tsx) and the
// Notifications section (channel list, add/edit modal, delete dialog, toasts).
//
// Namespaces mirror audit.ts conventions:
//   header.*   page header + Save changes button (+ its permission tooltip)
//   sec.*      Security card
//   inst.*     Instance card
//   tls.*      HTTPS & certificates card: mode badge/selector (tls.mode.*,
//              tls.select.*), env-managed / listener-off states
//              (tls.managedByEnv*, tls.listenerOff), current certificate
//              (tls.cert.*), self-signed callout (tls.selfSigned.*), custom
//              certificate (tls.custom.*), Let's Encrypt (tls.acme.*), import
//              modal (tls.import.*), remove + back-to-self-signed dialogs
//              (tls.dialog.*), toasts (tls.toast.*)
//   notif.*    Notifications section (list, permissions, empty/error states)
//   channel.*  channel-type + event display labels
//   modal.*    add/edit channel modal (fields, hints, footer)
//   dialog.*   delete-channel confirm dialog
//   toast.*    toast titles + bodies
//
// DO NOT translate: permission strings (settings.update, notifications.manage),
// technical label examples (io.castor.protected), URL placeholders, PEM markers
// (-----BEGIN CERTIFICATE-----), env variables (CASTOR_TLS_MODE), the file name
// castor.crt, product names (Let's Encrypt, DigiCert, Thawte) or the state
// values echoed from the backend. tls.mode.* keys are the backend mode values.

import { defineDict } from "../core";

export const settingsDict = defineDict({
  en: {
    // Page header + global save
    "header.title": "Settings",
    "header.subtitle": "Instance security and behavior.",
    "header.save": "Save changes",
    "header.saveDenied": "Requires settings.update",
    "header.loading": "Loading settings…",

    // Security card
    "sec.title": "Security",
    "sec.totpLabel": "Require 2FA for mutating actions",
    "sec.totpHint":
      "When enabled, users with TOTP configured must have an authentication assurance level of pwd+totp to perform any state-changing operation.",
    "sec.sessionLabel": "Session lifetime",
    "sec.sessionUnit": "seconds ({hours}h sliding window)",
    "sec.labelsLabel": "Protected labels",
    "sec.labelsHint":
      "Containers carrying any of these labels are treated as protected and cannot be removed without an audited admin override.",
    "sec.labelsEmpty": "No protected labels.",
    "sec.removeLabel": "Remove {label}",
    "sec.add": "Add",

    // Instance card
    "inst.title": "Instance",
    "inst.id": "Instance ID",
    "inst.bootstrap": "Bootstrap",
    "inst.bootstrapCompleted": "Completed",
    "inst.bootstrapPending": "Pending",

    // HTTPS & certificates card
    "tls.title": "HTTPS & certificates",
    "tls.intro":
      "How Castor serves HTTPS and which certificate visitors get. Changes here apply to the running listener immediately — they do not go through Save changes.",
    "tls.noPermission": "Viewing the HTTPS configuration requires the settings.read permission.",
    "tls.loading": "Loading HTTPS status…",
    "tls.loadError": "Failed to load the HTTPS status.",
    "tls.actionDenied": "Requires settings.update",
    "tls.effective": "Effective mode",
    "tls.url": "HTTPS address",
    "tls.urlHint": "Recommended address for this instance.",
    "tls.redirect": "Plain HTTP requests on {addr} are redirected to HTTPS.",
    "tls.noRedirect": "Plain HTTP stays available on {addr}.",
    "tls.hstsOn": "HSTS is sent: browsers remember to use HTTPS for 24 hours.",
    "tls.fallbackSelfSigned":
      "The selected source has no usable certificate yet, so the self-signed certificate is served meanwhile.",
    "tls.restartRequired":
      "The selected mode changes whether the HTTPS listener is bound at all. Restart Castor to apply it.",
    "tls.managedByEnv": "Managed by the environment (CASTOR_TLS_MODE=off)",
    "tls.managedByEnvHint":
      "HTTPS is disabled by configuration, typically behind a reverse proxy that terminates TLS. The certificate settings are read-only here: change the environment and restart Castor to enable HTTPS.",
    "tls.listenerOff": "HTTPS listener is off — set CASTOR_TLS_MODE and restart",

    // Mode labels (keys are the backend mode values)
    "tls.mode.self-signed": "Self-signed",
    "tls.mode.custom": "Custom certificate",
    "tls.mode.acme": "Let's Encrypt",
    "tls.mode.off": "Off",

    // Current certificate
    "tls.cert.title": "Current certificate",
    "tls.cert.none": "No certificate is served: HTTPS is off.",
    "tls.cert.subject": "Subject",
    "tls.cert.issuer": "Issuer",
    "tls.cert.expires": "Expires",
    "tls.cert.daysLeft": "{days} days left",
    "tls.cert.expiringSoon": "Expires in {days} days",
    "tls.cert.expired": "Expired",
    "tls.cert.fingerprint": "SHA-256 fingerprint",
    "tls.cert.copyFingerprint": "Copy the full fingerprint",
    "tls.cert.copied": "Fingerprint copied",
    "tls.cert.copyFailed": "Copy failed",
    "tls.cert.sans": "Alternative names",
    "tls.cert.noSans": "None",

    // Self-signed callout
    "tls.selfSigned.callout":
      "Browsers warn about this certificate because no authority they trust signed it. The connection is still encrypted.",
    "tls.selfSigned.download": "Download certificate",
    "tls.selfSigned.trust":
      "To remove the warning, add the downloaded castor.crt to the trust store of each workstation — or install a trusted certificate below.",

    // Certificate source selector
    "tls.select.title": "Certificate source",
    "tls.select.selfSignedHint": "Generated by Castor at first start and renewed automatically. Browsers warn.",
    "tls.select.customHint": "A certificate you import: DigiCert, Thawte, Sectigo, an internal CA…",
    "tls.select.customNeedsImport": "Import a certificate first.",
    "tls.select.acmeHint": "Obtained from Let's Encrypt (ACME) and renewed automatically.",
    "tls.select.acmeNeedsDomain": "Add at least one domain below.",
    "tls.select.offLabel": "Off (configured by environment)",
    "tls.select.offHint":
      "HTTPS is disabled by configuration (CASTOR_TLS_MODE=off), typically behind a reverse proxy that terminates TLS. Change the environment and restart Castor to enable it.",

    // Custom certificate
    "tls.custom.title": "Custom certificate",
    "tls.custom.intro":
      "Import a certificate issued by a public authority (DigiCert, Thawte, Sectigo…) or by your internal CA: the PEM certificate, its PEM private key and the intermediate chain.",
    "tls.custom.import": "Import a certificate",
    "tls.custom.replace": "Replace certificate",
    "tls.custom.remove": "Remove custom certificate",
    "tls.custom.installed": "Imported certificate",
    "tls.custom.served": "Served",
    "tls.custom.notServed": "Imported but not served — select \"Custom certificate\" above to use it.",
    "tls.custom.none": "No custom certificate imported.",
    "tls.custom.selfSignedWarn":
      "This certificate is self-signed; browsers will not trust it unless you add it to your trust store.",

    // Let's Encrypt
    "tls.acme.title": "Let's Encrypt",
    "tls.acme.intro":
      "Castor requests a free, browser-trusted certificate from Let's Encrypt and renews it automatically before it expires.",
    "tls.acme.prereq":
      "Prerequisites: every domain must resolve publicly to this host, and ports 80 and 443 of that public address must reach Castor's HTTP ({http}) and HTTPS ({https}) listeners — the HTTP-01 challenge is answered on port 80. Wildcards are not supported.",
    "tls.acme.domains": "Domains",
    "tls.acme.domainPlaceholder": "castor.example.com",
    "tls.acme.addDomain": "Add",
    "tls.acme.removeDomain": "Remove {domain}",
    "tls.acme.noDomains": "No domain yet.",
    "tls.acme.domain.wildcard": "Wildcards need a DNS-01 challenge, which is not supported.",
    "tls.acme.domain.ip": "Let's Encrypt issues for hostnames only, not IP addresses.",
    "tls.acme.domain.notFqdn": "Enter a fully-qualified hostname (with at least one dot).",
    "tls.acme.domain.invalid": "Not a valid hostname.",
    "tls.acme.domain.duplicate": "Already in the list.",
    "tls.acme.email": "Contact e-mail (optional)",
    "tls.acme.emailHint": "Let's Encrypt uses it for expiry and policy notices.",
    "tls.acme.emailInvalid": "Not an e-mail address.",
    "tls.acme.staging": "Use the staging environment (test certificates, not trusted by browsers, no rate limit)",
    "tls.acme.enable": "Enable Let's Encrypt",
    "tls.acme.apply": "Apply changes",
    "tls.acme.renew": "Renew now",
    "tls.acme.disable": "Disable",
    "tls.acme.disableHint": "Falls back to the imported certificate when one exists, else to self-signed.",
    "tls.acme.ready": "Certificate obtained.",
    "tls.acme.pending": "Waiting for Let's Encrypt to issue the certificate…",
    "tls.acme.lastIssued": "Last issued {when}",
    "tls.acme.lastError": "Last error",

    // Import modal
    "tls.import.title": "Import a certificate",
    "tls.import.intro":
      "Load the PEM export your provider gave you, or paste the blocks. The private key is sent once, stored encrypted and never displayed again.",
    "tls.import.mode": "Import from",
    "tls.import.modeSingle": "Single file",
    "tls.import.modeSeparate": "Separate files",
    "tls.import.combined": "Paste the certificate, private key and chain (one PEM file)",
    "tls.import.combinedHint": "Accepts a combined PEM export (certificate + private key + CA chain) or separate files.",
    "tls.import.notPem": "No PEM block found (-----BEGIN CERTIFICATE----- or -----BEGIN … PRIVATE KEY-----).",
    "tls.import.missingKey": "No private key block found (-----BEGIN … PRIVATE KEY-----). Add it here, or switch to separate files.",
    "tls.import.missingCert": "No certificate block found (-----BEGIN CERTIFICATE-----).",
    "tls.import.cert": "Certificate (PEM)",
    "tls.import.certHint": "The server (leaf) certificate: -----BEGIN CERTIFICATE-----",
    "tls.import.key": "Private key (PEM)",
    "tls.import.keyHint": "Unencrypted RSA (2048 bits or more) or EC key: -----BEGIN PRIVATE KEY-----",
    "tls.import.chain": "Intermediate chain (PEM, optional)",
    "tls.import.chainHint":
      "The intermediate CA certificate(s) your provider supplies, concatenated. Without them some clients reject the certificate.",
    "tls.import.loadFile": "Load from file…",
    "tls.import.fileReadFailed": "Could not read the file.",
    "tls.import.notPemCert": "Not a PEM certificate (missing -----BEGIN CERTIFICATE-----).",
    "tls.import.notPemKey": "Not a PEM private key (missing -----BEGIN … PRIVATE KEY-----).",
    "tls.import.keyEncrypted": "Encrypted private keys are not supported. Decrypt it first (openssl pkey -in key.pem -out key-plain.pem).",
    "tls.import.tooLarge": "Exceeds 64 KiB.",
    "tls.import.submit": "Import",

    // Remove-certificate confirm dialog
    "tls.dialog.removeTitle": "Remove custom certificate",
    "tls.dialog.removeConfirm": "Remove",
    "tls.dialog.removeBody":
      "Remove the imported certificate? If it is being served, Castor falls back to the self-signed certificate immediately and browsers will warn again.",

    // Back-to-self-signed confirm dialog (leaving a trusted certificate)
    "tls.dialog.selfSignedTitle": "Switch back to the self-signed certificate",
    "tls.dialog.selfSignedConfirm": "Switch to self-signed",
    "tls.dialog.selfSignedBody":
      "Castor will serve its self-signed certificate immediately and browsers will warn again.",
    "tls.dialog.acmeDisableBody":
      "Let's Encrypt will be disabled. No custom certificate is imported, so Castor will serve its self-signed certificate immediately and browsers will warn again.",
    "tls.dialog.hstsWarn":
      "Browsers that visited this site over a trusted certificate may refuse the self-signed one for up to 24 hours (HSTS).",

    // Toasts
    "tls.toast.modeChanged": "HTTPS mode updated",
    "tls.toast.modeFailed": "Mode change failed",
    "tls.toast.imported": "Certificate imported",
    "tls.toast.importFailed": "Import failed",
    "tls.toast.removed": "Custom certificate removed",
    "tls.toast.removeFailed": "Removal failed",
    "tls.toast.acmeEnabled": "Let's Encrypt enabled",
    "tls.toast.acmeEnabledBody": "Issuance started; the status refreshes once the certificate is ready.",
    "tls.toast.acmeRenewed": "Certificate renewed",
    "tls.toast.acmePending": "Renewal in progress",
    "tls.toast.acmePendingBody": "Let's Encrypt has not answered yet; the status refreshes when it does.",
    "tls.toast.acmeFailed": "Renewal failed",
    "tls.toast.acmeDisabled": "Let's Encrypt disabled",

    // Notifications section
    "notif.title": "Notifications",
    "notif.addChannel": "Add channel",
    "notif.addDenied": "Requires notifications.manage",
    "notif.intro":
      "Alert channels for container and image-update events. Webhook URLs are stored encrypted and never displayed again.",
    "notif.noPermission": "Managing notification channels requires the notifications.manage permission.",
    "notif.loading": "Loading channels…",
    "notif.loadError": "Failed to load notification channels.",
    "notif.empty": "No notification channels configured.",
    "notif.noEvents": "No events subscribed.",
    "notif.test": "Test",
    "notif.testTooltip": "Send a test notification",
    "notif.edit": "Edit",
    "notif.deleteTooltip": "Delete channel",
    "notif.deleteAria": "Delete {name}",

    // Channel-type + event display labels
    "channel.type.discord": "Discord",
    "channel.type.slack": "Slack",
    "channel.type.ntfy": "ntfy",
    "channel.type.webhook": "Webhook",
    "channel.event.containerDown": "Container went down",
    "channel.event.updateAvailable": "Image update available",

    // Add / edit channel modal
    "modal.editTitle": "Edit {name}",
    "modal.addTitle": "Add channel",
    "modal.name": "Name",
    "modal.nameHint": "A label for this channel.",
    "modal.type": "Type",
    "modal.url": "Webhook URL",
    "modal.urlPlaceholderKept": "•••••• (unchanged)",
    "modal.urlHintKept": "A URL is already stored. Leave blank to keep it, or type a new one to replace it.",
    "modal.urlHintNew": "Absolute http(s) endpoint. Stored encrypted; never displayed again.",
    "modal.events": "Events",
    "modal.cancel": "Cancel",
    "modal.save": "Save",
    "modal.add": "Add",

    // Delete-channel confirm dialog. Body is split around the bold channel name.
    "dialog.deleteTitle": "Delete channel",
    "dialog.deleteConfirm": "Delete",
    "dialog.deleteBody1": "Delete notification channel",
    "dialog.deleteBody2": "? Alerts routed to it will stop immediately.",

    // Toasts
    "toast.saved": "Settings saved",
    "toast.saveFailed": "Save failed",
    "toast.testSent": "Test notification sent",
    "toast.testFailed": "Test failed",
    "toast.channelEnabled": "Channel enabled",
    "toast.channelDisabled": "Channel disabled",
    "toast.updateFailed": "Update failed",
    "toast.channelDeleted": "Channel deleted",
    "toast.deleteFailed": "Delete failed",
    "toast.channelUpdated": "Channel updated",
    "toast.channelAdded": "Channel added",
    "toast.createFailed": "Create failed",
  },
  fr: {
    // En-tête de page + enregistrement global
    "header.title": "Paramètres",
    "header.subtitle": "Sécurité et comportement de l'instance.",
    "header.save": "Enregistrer les modifications",
    "header.saveDenied": "Nécessite settings.update",
    "header.loading": "Chargement des paramètres…",

    // Carte Sécurité
    "sec.title": "Sécurité",
    "sec.totpLabel": "Exiger la 2FA pour les actions modifiantes",
    "sec.totpHint":
      "Une fois activé, les utilisateurs ayant configuré TOTP doivent disposer d'un niveau d'assurance d'authentification pwd+totp pour effectuer toute opération modifiant l'état.",
    "sec.sessionLabel": "Durée de session",
    "sec.sessionUnit": "secondes (fenêtre glissante de {hours} h)",
    "sec.labelsLabel": "Labels protégés",
    "sec.labelsHint":
      "Les conteneurs portant l'un de ces labels sont considérés comme protégés et ne peuvent pas être supprimés sans un contournement admin audité.",
    "sec.labelsEmpty": "Aucun label protégé.",
    "sec.removeLabel": "Retirer {label}",
    "sec.add": "Ajouter",

    // Carte Instance
    "inst.title": "Instance",
    "inst.id": "ID d'instance",
    "inst.bootstrap": "Amorçage",
    "inst.bootstrapCompleted": "Terminé",
    "inst.bootstrapPending": "En attente",

    // Carte HTTPS & certificats
    "tls.title": "HTTPS & certificats",
    "tls.intro":
      "Comment Castor sert le HTTPS et quel certificat reçoivent les visiteurs. Les changements s'appliquent immédiatement à l'écouteur en cours — ils ne passent pas par Enregistrer les modifications.",
    "tls.noPermission": "Consulter la configuration HTTPS nécessite la permission settings.read.",
    "tls.loading": "Chargement de l'état HTTPS…",
    "tls.loadError": "Échec du chargement de l'état HTTPS.",
    "tls.actionDenied": "Nécessite settings.update",
    "tls.effective": "Mode effectif",
    "tls.url": "Adresse HTTPS",
    "tls.urlHint": "Adresse conseillée pour cette instance.",
    "tls.redirect": "Les requêtes HTTP en clair sur {addr} sont redirigées vers HTTPS.",
    "tls.noRedirect": "Le HTTP en clair reste disponible sur {addr}.",
    "tls.hstsOn": "HSTS est envoyé : les navigateurs retiennent d'utiliser HTTPS pendant 24 heures.",
    "tls.fallbackSelfSigned":
      "La source sélectionnée n'a pas encore de certificat utilisable : le certificat auto-signé est servi en attendant.",
    "tls.restartRequired":
      "Le mode sélectionné change si l'écouteur HTTPS est lié ou non. Redémarrez Castor pour l'appliquer.",
    "tls.managedByEnv": "Géré par l'environnement (CASTOR_TLS_MODE=off)",
    "tls.managedByEnvHint":
      "Le HTTPS est désactivé par configuration, typiquement derrière un reverse proxy qui termine le TLS. Les réglages de certificat sont en lecture seule ici : modifiez l'environnement et redémarrez Castor pour activer le HTTPS.",
    "tls.listenerOff": "L'écouteur HTTPS est arrêté — définissez CASTOR_TLS_MODE et redémarrez",

    // Libellés de mode (les clés sont les valeurs du backend)
    "tls.mode.self-signed": "Auto-signé",
    "tls.mode.custom": "Certificat personnalisé",
    "tls.mode.acme": "Let's Encrypt",
    "tls.mode.off": "Désactivé",

    // Certificat courant
    "tls.cert.title": "Certificat courant",
    "tls.cert.none": "Aucun certificat n'est servi : le HTTPS est désactivé.",
    "tls.cert.subject": "Sujet",
    "tls.cert.issuer": "Émetteur",
    "tls.cert.expires": "Expire le",
    "tls.cert.daysLeft": "{days} jours restants",
    "tls.cert.expiringSoon": "Expire dans {days} jours",
    "tls.cert.expired": "Expiré",
    "tls.cert.fingerprint": "Empreinte SHA-256",
    "tls.cert.copyFingerprint": "Copier l'empreinte complète",
    "tls.cert.copied": "Empreinte copiée",
    "tls.cert.copyFailed": "Échec de la copie",
    "tls.cert.sans": "Noms alternatifs",
    "tls.cert.noSans": "Aucun",

    // Encart auto-signé
    "tls.selfSigned.callout":
      "Les navigateurs avertissent sur ce certificat car aucune autorité de confiance ne l'a signé. La connexion est néanmoins chiffrée.",
    "tls.selfSigned.download": "Télécharger le certificat",
    "tls.selfSigned.trust":
      "Pour supprimer l'avertissement, ajoutez le fichier castor.crt téléchargé au magasin de confiance de chaque poste — ou installez un certificat de confiance ci-dessous.",

    // Sélecteur de source de certificat
    "tls.select.title": "Source du certificat",
    "tls.select.selfSignedHint": "Généré par Castor au premier démarrage et renouvelé automatiquement. Les navigateurs avertissent.",
    "tls.select.customHint": "Un certificat que vous importez : DigiCert, Thawte, Sectigo, une AC interne…",
    "tls.select.customNeedsImport": "Importez d'abord un certificat.",
    "tls.select.acmeHint": "Obtenu auprès de Let's Encrypt (ACME) et renouvelé automatiquement.",
    "tls.select.acmeNeedsDomain": "Ajoutez au moins un domaine ci-dessous.",
    "tls.select.offLabel": "Désactivé (configuré par l'environnement)",
    "tls.select.offHint":
      "Le HTTPS est désactivé par configuration (CASTOR_TLS_MODE=off), typiquement derrière un reverse proxy qui termine le TLS. Modifiez l'environnement et redémarrez Castor pour l'activer.",

    // Certificat personnalisé
    "tls.custom.title": "Certificat personnalisé",
    "tls.custom.intro":
      "Importez un certificat émis par une autorité publique (DigiCert, Thawte, Sectigo…) ou par votre AC interne : le certificat PEM, sa clé privée PEM et la chaîne intermédiaire.",
    "tls.custom.import": "Importer un certificat",
    "tls.custom.replace": "Remplacer le certificat",
    "tls.custom.remove": "Supprimer le certificat personnalisé",
    "tls.custom.installed": "Certificat importé",
    "tls.custom.served": "Servi",
    "tls.custom.notServed": "Importé mais non servi — sélectionnez « Certificat personnalisé » ci-dessus pour l'utiliser.",
    "tls.custom.none": "Aucun certificat personnalisé importé.",
    "tls.custom.selfSignedWarn":
      "Ce certificat est auto-signé ; les navigateurs ne lui feront pas confiance tant que vous ne l'aurez pas ajouté à votre magasin de confiance.",

    // Let's Encrypt
    "tls.acme.title": "Let's Encrypt",
    "tls.acme.intro":
      "Castor demande à Let's Encrypt un certificat gratuit reconnu par les navigateurs et le renouvelle automatiquement avant son expiration.",
    "tls.acme.prereq":
      "Prérequis : chaque domaine doit résoudre publiquement vers cet hôte, et les ports 80 et 443 de cette adresse publique doivent atteindre les écouteurs HTTP ({http}) et HTTPS ({https}) de Castor — le défi HTTP-01 est servi sur le port 80. Les jokers ne sont pas pris en charge.",
    "tls.acme.domains": "Domaines",
    "tls.acme.domainPlaceholder": "castor.example.com",
    "tls.acme.addDomain": "Ajouter",
    "tls.acme.removeDomain": "Retirer {domain}",
    "tls.acme.noDomains": "Aucun domaine pour l'instant.",
    "tls.acme.domain.wildcard": "Les jokers nécessitent un défi DNS-01, qui n'est pas pris en charge.",
    "tls.acme.domain.ip": "Let's Encrypt n'émet que pour des noms d'hôte, pas des adresses IP.",
    "tls.acme.domain.notFqdn": "Saisissez un nom d'hôte pleinement qualifié (avec au moins un point).",
    "tls.acme.domain.invalid": "Nom d'hôte invalide.",
    "tls.acme.domain.duplicate": "Déjà dans la liste.",
    "tls.acme.email": "E-mail de contact (facultatif)",
    "tls.acme.emailHint": "Let's Encrypt l'utilise pour les avis d'expiration et de politique.",
    "tls.acme.emailInvalid": "Ce n'est pas une adresse e-mail.",
    "tls.acme.staging": "Utiliser l'environnement de staging (certificats de test, non reconnus par les navigateurs, sans limite de débit)",
    "tls.acme.enable": "Activer Let's Encrypt",
    "tls.acme.apply": "Appliquer les modifications",
    "tls.acme.renew": "Renouveler maintenant",
    "tls.acme.disable": "Désactiver",
    "tls.acme.disableHint": "Revient au certificat importé s'il en existe un, sinon à l'auto-signé.",
    "tls.acme.ready": "Certificat obtenu.",
    "tls.acme.pending": "En attente de l'émission du certificat par Let's Encrypt…",
    "tls.acme.lastIssued": "Dernière émission {when}",
    "tls.acme.lastError": "Dernière erreur",

    // Fenêtre d'import
    "tls.import.title": "Importer un certificat",
    "tls.import.intro":
      "Chargez l'export PEM fourni par votre prestataire, ou collez les blocs. La clé privée est envoyée une seule fois, stockée chiffrée et plus jamais affichée.",
    "tls.import.mode": "Importer depuis",
    "tls.import.modeSingle": "Un seul fichier",
    "tls.import.modeSeparate": "Fichiers séparés",
    "tls.import.combined": "Collez le certificat, la clé privée et la chaîne (un seul fichier PEM)",
    "tls.import.combinedHint": "Accepte un export PEM combiné (certificat + clé privée + chaîne d'AC) ou des fichiers séparés.",
    "tls.import.notPem": "Aucun bloc PEM trouvé (-----BEGIN CERTIFICATE----- ou -----BEGIN … PRIVATE KEY-----).",
    "tls.import.missingKey": "Aucun bloc de clé privée trouvé (-----BEGIN … PRIVATE KEY-----). Ajoutez-le ici, ou passez en fichiers séparés.",
    "tls.import.missingCert": "Aucun bloc de certificat trouvé (-----BEGIN CERTIFICATE-----).",
    "tls.import.cert": "Certificat (PEM)",
    "tls.import.certHint": "Le certificat serveur (feuille) : -----BEGIN CERTIFICATE-----",
    "tls.import.key": "Clé privée (PEM)",
    "tls.import.keyHint": "Clé RSA (2048 bits ou plus) ou EC non chiffrée : -----BEGIN PRIVATE KEY-----",
    "tls.import.chain": "Chaîne intermédiaire (PEM, facultatif)",
    "tls.import.chainHint":
      "Le ou les certificats d'AC intermédiaire fournis par votre prestataire, concaténés. Sans eux, certains clients rejettent le certificat.",
    "tls.import.loadFile": "Charger depuis un fichier…",
    "tls.import.fileReadFailed": "Impossible de lire le fichier.",
    "tls.import.notPemCert": "Ce n'est pas un certificat PEM (-----BEGIN CERTIFICATE----- manquant).",
    "tls.import.notPemKey": "Ce n'est pas une clé privée PEM (-----BEGIN … PRIVATE KEY----- manquant).",
    "tls.import.keyEncrypted": "Les clés privées chiffrées ne sont pas prises en charge. Déchiffrez-la d'abord (openssl pkey -in key.pem -out key-plain.pem).",
    "tls.import.tooLarge": "Dépasse 64 Kio.",
    "tls.import.submit": "Importer",

    // Fenêtre de confirmation de suppression du certificat
    "tls.dialog.removeTitle": "Supprimer le certificat personnalisé",
    "tls.dialog.removeConfirm": "Supprimer",
    "tls.dialog.removeBody":
      "Supprimer le certificat importé ? S'il est en cours de service, Castor revient immédiatement au certificat auto-signé et les navigateurs avertiront de nouveau.",

    // Fenêtre de confirmation du retour à l'auto-signé (depuis un certificat de confiance)
    "tls.dialog.selfSignedTitle": "Revenir au certificat auto-signé",
    "tls.dialog.selfSignedConfirm": "Passer en auto-signé",
    "tls.dialog.selfSignedBody":
      "Castor servira immédiatement son certificat auto-signé et les navigateurs avertiront de nouveau.",
    "tls.dialog.acmeDisableBody":
      "Let's Encrypt sera désactivé. Aucun certificat personnalisé n'est importé : Castor servira immédiatement son certificat auto-signé et les navigateurs avertiront de nouveau.",
    "tls.dialog.hstsWarn":
      "Les navigateurs qui ont visité ce site avec un certificat de confiance peuvent refuser le certificat auto-signé pendant jusqu'à 24 heures (HSTS).",

    // Toasts
    "tls.toast.modeChanged": "Mode HTTPS mis à jour",
    "tls.toast.modeFailed": "Échec du changement de mode",
    "tls.toast.imported": "Certificat importé",
    "tls.toast.importFailed": "Échec de l'import",
    "tls.toast.removed": "Certificat personnalisé supprimé",
    "tls.toast.removeFailed": "Échec de la suppression",
    "tls.toast.acmeEnabled": "Let's Encrypt activé",
    "tls.toast.acmeEnabledBody": "Émission lancée ; l'état se rafraîchira dès que le certificat sera prêt.",
    "tls.toast.acmeRenewed": "Certificat renouvelé",
    "tls.toast.acmePending": "Renouvellement en cours",
    "tls.toast.acmePendingBody": "Let's Encrypt n'a pas encore répondu ; l'état se rafraîchira dès qu'il le fera.",
    "tls.toast.acmeFailed": "Échec du renouvellement",
    "tls.toast.acmeDisabled": "Let's Encrypt désactivé",

    // Section Notifications
    "notif.title": "Notifications",
    "notif.addChannel": "Ajouter un canal",
    "notif.addDenied": "Nécessite notifications.manage",
    "notif.intro":
      "Canaux d'alerte pour les événements de conteneur et de mise à jour d'image. Les URL de webhook sont stockées chiffrées et ne sont plus jamais affichées.",
    "notif.noPermission": "La gestion des canaux de notification nécessite la permission notifications.manage.",
    "notif.loading": "Chargement des canaux…",
    "notif.loadError": "Échec du chargement des canaux de notification.",
    "notif.empty": "Aucun canal de notification configuré.",
    "notif.noEvents": "Aucun événement abonné.",
    "notif.test": "Tester",
    "notif.testTooltip": "Envoyer une notification de test",
    "notif.edit": "Modifier",
    "notif.deleteTooltip": "Supprimer le canal",
    "notif.deleteAria": "Supprimer {name}",

    // Libellés de type de canal + d'événement
    "channel.type.discord": "Discord",
    "channel.type.slack": "Slack",
    "channel.type.ntfy": "ntfy",
    "channel.type.webhook": "Webhook",
    "channel.event.containerDown": "Conteneur arrêté",
    "channel.event.updateAvailable": "Mise à jour d'image disponible",

    // Fenêtre d'ajout / de modification de canal
    "modal.editTitle": "Modifier {name}",
    "modal.addTitle": "Ajouter un canal",
    "modal.name": "Nom",
    "modal.nameHint": "Un libellé pour ce canal.",
    "modal.type": "Type",
    "modal.url": "URL de webhook",
    "modal.urlPlaceholderKept": "•••••• (inchangée)",
    "modal.urlHintKept": "Une URL est déjà stockée. Laissez vide pour la conserver, ou saisissez-en une nouvelle pour la remplacer.",
    "modal.urlHintNew": "Point de terminaison http(s) absolu. Stocké chiffré ; plus jamais affiché.",
    "modal.events": "Événements",
    "modal.cancel": "Annuler",
    "modal.save": "Enregistrer",
    "modal.add": "Ajouter",

    // Fenêtre de confirmation de suppression de canal. Corps scindé autour du nom en gras.
    "dialog.deleteTitle": "Supprimer le canal",
    "dialog.deleteConfirm": "Supprimer",
    "dialog.deleteBody1": "Supprimer le canal de notification",
    "dialog.deleteBody2": " ? Les alertes qui y sont routées cesseront immédiatement.",

    // Toasts
    "toast.saved": "Paramètres enregistrés",
    "toast.saveFailed": "Échec de l'enregistrement",
    "toast.testSent": "Notification de test envoyée",
    "toast.testFailed": "Échec du test",
    "toast.channelEnabled": "Canal activé",
    "toast.channelDisabled": "Canal désactivé",
    "toast.updateFailed": "Échec de la mise à jour",
    "toast.channelDeleted": "Canal supprimé",
    "toast.deleteFailed": "Échec de la suppression",
    "toast.channelUpdated": "Canal mis à jour",
    "toast.channelAdded": "Canal ajouté",
    "toast.createFailed": "Échec de la création",
  },
});
