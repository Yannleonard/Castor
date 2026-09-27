// ui/src/help/cards/settings.ts — Instance settings (security, HTTPS) help card.
import type { HelpCard } from "../types";

export const settingsCard: HelpCard = {
  id: "settings",
  title: { en: "Instance settings", fr: "Réglages de l'instance" },

  en: {
    summary: "Instance-wide security controls (admin only) — TOTP for mutations, protected labels, session window — the HTTPS certificate Castor serves (self-signed, imported, Let's Encrypt), plus outbound notification channels (Discord, Slack, ntfy, webhook).",
    sections: [
      {
        title: "What this page is for",
        blocks: [
          { kind: "p", text: "The **Settings** page holds the instance-wide security controls. They are **admin-only**: a change here applies to **every** user on this Castor instance, not just to you. From here you decide how strict the instance is about **step-up authentication**, which containers are **hard to delete by accident**, and how long a session stays alive." },
          { kind: "p", text: "The page also shows read-only **instance metadata** — Castor **version** and **build** — handy when reporting an issue or checking you are on the release you expect. Finally, it hosts the **Notifications** card, where you wire Castor to the outside world: alert channels for container and image-update events. That part is the exception to \"admin-only\" — **operators** can manage channels too." },
        ],
      },
      {
        title: "\"Require 2FA for mutations\"",
        blocks: [
          { kind: "p", text: "Setting `security.totp_required_for_mutations` — **OFF by default**. When you turn it **on**, any user who has 2FA enabled must enter a **TOTP code** to perform **any state-changing action** (start, stop, remove, deploy, scale, update…) and to open a terminal." },
          { kind: "p", text: "It **strengthens** the instance but adds a TOTP prompt to everyday work. Turn it **on** if the instance is reachable from the Internet; leave it **off** on a trusted, isolated network where the friction is not worth it." },
          { kind: "callout", tone: "warn", text: "This setting only bites users who **already have 2FA enrolled**. A user **without** 2FA has nothing to step up, so they are **not** blocked or affected. If you want the requirement to be real for everyone, **enforce 2FA enrolment separately** — this toggle alone will not force anyone to enrol." },
          { kind: "note", text: "Opening an **exec terminal** always demands a fresh TOTP code (step-up AAL), regardless of this setting. This toggle only extends that same step-up to all other mutations." },
        ],
      },
      {
        title: "Protected labels",
        blocks: [
          { kind: "p", text: "A list of labels — default `io.castor.protected` — that mark a workload as **protected**. Any container or pod carrying one of these labels **refuses deletion** unless you **confirm and give a reason**, so a stray click can never wipe it out." },
          { kind: "p", text: "Use it to shield your **infrastructure** workloads — database, reverse-proxy, message broker — from accidental removal. Label the critical container with `io.castor.protected=true` (or add your own label to the list) and Castor guards it from then on." },
          { kind: "note", text: "The Castor container itself is always protected, whatever this list says — Castor never lets you delete the tool you are working from without an explicit confirmation." },
        ],
      },
      {
        title: "Session lifetime",
        blocks: [
          { kind: "p", text: "Setting `session.ttl_seconds` — the **sliding inactivity window**. Each request resets the timer; after this much time **with no activity** the session expires and the user must sign in again. Accepted range: **300 s (5 min) to 24 h**." },
          { kind: "p", text: "Shorten it for a shared or exposed instance; lengthen it for a trusted workstation where re-authenticating all day is pure friction." },
        ],
      },
      {
        title: "HTTPS & certificates",
        blocks: [
          { kind: "p", text: "Castor serves **HTTPS by default** (port **8443**), so the session cookie, passwords, TOTP codes and terminal traffic are **encrypted on the wire** from the very first start — even on a LAN. The **HTTPS & certificates** card shows the **effective mode** badge, the recommended **HTTPS address** (the one plain-HTTP requests are redirected to — the health check and the Let's Encrypt challenge path are never redirected, nor is a request a trusted reverse proxy already reports as HTTPS), and the **certificate visitors currently get**: subject, issuer, expiry (a **warning under 30 days**, a red **Expired** badge past it), SHA-256 fingerprint and alternative names. Changes here apply to the running listener **immediately** — no restart, and nothing goes through **Save changes**." },
          { kind: "p", text: "Out of the box the certificate is **self-signed**: Castor generated it at first start and renews it itself. The connection is encrypted, but browsers show a **\"not secure / unknown issuer\" warning** because no authority they trust signed it. Two ways to make the warning go away:" },
          { kind: "list", items: [
            "**Trust the self-signed certificate** — click **Download certificate** (`castor.crt`) and add it to the trust store of each workstation (Keychain on macOS, Certificates on Windows, `update-ca-certificates` on Linux). Fine for one or two admins on a private network.",
            "**Install a trusted certificate** — import one from a public authority or your internal CA, or let **Let's Encrypt** issue one. This is the right answer as soon as several people use the instance.",
          ] },
          { kind: "p", text: "**Import a certificate** takes a certificate from **DigiCert**, **Thawte**, **Sectigo**, **GlobalSign**… or from your **internal CA**, in **PEM** format (`-----BEGIN CERTIFICATE-----`): the **server certificate**, its **private key** (unencrypted; RSA 2048 bits or more, or EC) and the **intermediate chain** your provider supplies. Paste each block or load it from a file. Always include the intermediates: without them, some clients and mobile browsers reject an otherwise valid certificate. The key is sent **once**, stored **encrypted** and **never displayed again**; Castor checks that it matches the certificate and that the certificate is currently valid, then serves it and switches to the **Custom certificate** mode. **Remove custom certificate** deletes it and falls back to self-signed." },
          { kind: "p", text: "**Let's Encrypt** gets you a free, browser-trusted certificate and **renews it automatically** before it expires. List the **domains** (fully-qualified hostnames, no wildcard, no IP), optionally a contact **e-mail**, and click **Enable Let's Encrypt**. Requirements: every domain must **resolve publicly** to this host, and **ports 80 and 443** of that public address must be forwarded to Castor's HTTP (**8080**) and HTTPS (**8443**) listeners — the CA validates ownership with an **HTTP-01 challenge on port 80**. Until the certificate arrives, the self-signed one keeps being served; **Renew now** discards the cached certificate and requests a fresh one, and the card shows the CA's **last error** when something went wrong. **Disable** falls back to the imported certificate when one exists, else to self-signed." },
          { kind: "callout", tone: "warn", text: "Test a new Let's Encrypt setup with the **staging** toggle first: it issues certificates browsers do **not** trust, but it has **no rate limit**. The production CA limits failed and duplicate requests per domain, so a misconfigured DNS or port can lock you out for hours." },
          { kind: "callout", tone: "warn", text: "**HSTS, 24 hours.** While a trusted certificate (imported or Let's Encrypt) is served, Castor sends a `Strict-Transport-Security` header with a **one-day** lifetime. Browsers that visited during that window then **refuse the self-signed certificate** until it lapses. Going back to self-signed — selecting it, **Disable** on Let's Encrypt with no imported certificate, or **Remove custom certificate** while it is served — can therefore lock those users out for **up to 24 hours**; the card asks you to confirm before doing it." },
          { kind: "p", text: "The **Off (configured by environment)** mode — no HTTPS listener, plain HTTP only — is meant for a Castor placed **behind a reverse proxy that terminates TLS** (Nginx, Caddy, Traefik…). With `CASTOR_TLS_MODE=off` the mode is **managed by the environment**: the setting stored in the database is ignored, the card is **read-only** and the API refuses any change (`tls_managed_by_env`). Switching a listener on or off needs a restart, so the card never does it for you — change the environment and restart Castor. Off can never be selected from the UI." },
          { kind: "note", text: "Only **public** material ever leaves the server: the API, the audit log and the server logs never carry a private key. Viewing the card requires **`settings.read`**; every change requires **`settings.update`** and a **2FA step-up** when enabled." },
        ],
      },
      {
        title: "Notifications",
        blocks: [
          { kind: "p", text: "The **Notifications** card manages outbound alert **channels**. A channel is a named destination — **Discord**, **Slack**, **ntfy** or a **generic webhook** — subscribed to one or more events. Click **Add channel**, give it a **Name**, pick a **Type**, paste the **Webhook URL** and tick the events you want it to receive." },
          { kind: "list", items: [
            "**Container went down** (`container.down`) — fires when a running container stops unexpectedly. The event is **debounced**, so a container flapping during a restart does not flood the channel.",
            "**Image update available** (`update.available`) — fires when Castor detects that a newer image is available for a running container.",
          ] },
          { kind: "p", text: "The **webhook URL is a secret**: it is **sealed with AES-256-GCM** on the server and **never displayed again** — neither in the UI nor through the API. When you edit a channel, the URL field shows the placeholder `•••••• (unchanged)`: **leave it blank to keep** the stored URL, or type a new one to replace it." },
          { kind: "p", text: "Each channel row carries an **enable/disable toggle**, a **Test** button that fires a test notification at the stored URL — the surest way to verify it before you depend on it — an **Edit** button, and a **delete** (trash) icon guarded by a confirmation. Alerts routed to a deleted channel stop immediately." },
          { kind: "callout", tone: "info", text: "Unlike the security settings above, channel changes apply **immediately** — they do **not** go through the page-level **Save changes** button." },
          { kind: "note", text: "Managing channels requires the **`notifications.manage`** permission, granted to both **admin** and **operator** roles. Users without it see the section but cannot list or change channels." },
        ],
      },
      {
        title: "Pitfalls & best practices",
        blocks: [
          { kind: "list", items: [
            "If the instance is **exposed to the Internet**, turn **\"Require 2FA for mutations\"** on — but pair it with **enforced 2FA enrolment**, otherwise non-enrolled users slip through.",
            "**Label your critical containers** (`io.castor.protected=true`) before you need the safety net, not after a near-miss.",
            "Keep `session.ttl_seconds` **short on shared machines**; a long window on a public host is a hijack risk.",
            "Every setting here is **instance-wide** — announce changes to your team so a sudden TOTP prompt or session drop does not surprise them.",
            "The security settings are **admin** actions (`settings.update`); notification channels are the exception — **operator** can manage them too (`notifications.manage`).",
            "**Test a channel right after creating it** — the URL is never shown again, so a typo only surfaces through a failed **Test**.",
            "**Do not leave the self-signed certificate on a shared instance** — users who click through browser warnings every day stop noticing a real attack. Import a certificate or enable Let's Encrypt, and watch the **expiry badge**: an imported certificate is not renewed for you.",
            "**Going back to self-signed is not free**: browsers keep the HSTS pin for 24 hours after a trusted certificate. Replace a certificate rather than removing it, and time a fallback for when users can tolerate a warning.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://github.com/Yannleonard/Castor", label: "Castor — repository & documentation" },
        ],
      },
    ],
  },

  fr: {
    summary: "Contrôles de sécurité au niveau de l'instance (admin uniquement) — TOTP pour les mutations, labels protégés, fenêtre de session — le certificat HTTPS servi par Castor (auto-signé, importé, Let's Encrypt), plus les canaux de notification sortants (Discord, Slack, ntfy, webhook).",
    sections: [
      {
        title: "À quoi sert cette page",
        blocks: [
          { kind: "p", text: "La page **Réglages** regroupe les contrôles de sécurité au niveau de l'instance. Ils sont **réservés à l'admin** : un changement ici s'applique à **tous** les utilisateurs de cette instance Castor, pas seulement à vous. C'est ici que vous décidez de la sévérité de l'instance en matière d'**authentification renforcée** (step-up), des conteneurs **difficiles à supprimer par accident**, et de la durée de vie d'une session." },
          { kind: "p", text: "La page affiche aussi des **métadonnées d'instance** en lecture seule — **version** et **build** de Castor — pratiques pour signaler un incident ou vérifier que vous êtes bien sur la version attendue. Enfin, elle héberge la carte **Notifications**, où vous reliez Castor au monde extérieur : des canaux d'alerte pour les événements conteneurs et mises à jour d'images. C'est l'exception au « admin uniquement » — les **operators** peuvent aussi gérer les canaux." },
        ],
      },
      {
        title: "« 2FA requise pour les mutations »",
        blocks: [
          { kind: "p", text: "Réglage `security.totp_required_for_mutations` — **OFF par défaut**. Une fois **activé**, tout utilisateur ayant la 2FA activée doit saisir un **code TOTP** pour **toute action modifiante** (démarrer, arrêter, supprimer, déployer, scaler, mettre à jour…) et pour ouvrir un terminal." },
          { kind: "p", text: "Ce réglage **renforce** l'instance mais ajoute une demande de code TOTP au quotidien. **Activez-le** si l'instance est joignable depuis Internet ; **laissez-le désactivé** sur un réseau isolé et de confiance où la friction n'en vaut pas la peine." },
          { kind: "callout", tone: "warn", text: "Ce réglage ne concerne que les utilisateurs ayant **déjà enrôlé la 2FA**. Un utilisateur **sans** 2FA n'a rien à renforcer : il n'est donc **ni bloqué ni affecté**. Pour que l'exigence soit réelle pour tout le monde, **imposez l'enrôlement de la 2FA séparément** — ce seul interrupteur ne forcera personne à s'enrôler." },
          { kind: "note", text: "Ouvrir un **terminal exec** exige toujours un nouveau code TOTP (step-up AAL), quel que soit ce réglage. Cet interrupteur ne fait qu'étendre ce même step-up à toutes les autres mutations." },
        ],
      },
      {
        title: "Labels protégés",
        blocks: [
          { kind: "p", text: "Une liste de labels — par défaut `io.castor.protected` — qui marquent une charge comme **protégée**. Tout conteneur ou pod portant l'un de ces labels **refuse la suppression** tant que vous ne **confirmez pas en donnant une raison**, de sorte qu'un clic malencontreux ne peut jamais l'effacer." },
          { kind: "p", text: "Utilisez-le pour protéger vos charges d'**infrastructure** — base de données, reverse-proxy, broker de messages — d'une suppression accidentelle. Labellisez le conteneur critique avec `io.castor.protected=true` (ou ajoutez votre propre label à la liste) et Castor le garde à l'œil dès lors." },
          { kind: "note", text: "Le conteneur Castor lui-même est toujours protégé, quoi que dise cette liste — Castor ne vous laisse jamais supprimer l'outil depuis lequel vous travaillez sans confirmation explicite." },
        ],
      },
      {
        title: "Durée de session",
        blocks: [
          { kind: "p", text: "Réglage `session.ttl_seconds` — la **fenêtre glissante d'inactivité**. Chaque requête réarme le compteur ; après ce délai **sans activité**, la session expire et l'utilisateur doit se reconnecter. Plage acceptée : **300 s (5 min) à 24 h**." },
          { kind: "p", text: "Raccourcissez-la pour une instance partagée ou exposée ; allongez-la sur un poste de confiance où se réauthentifier toute la journée n'est que de la friction." },
        ],
      },
      {
        title: "HTTPS & certificats",
        blocks: [
          { kind: "p", text: "Castor sert le **HTTPS par défaut** (port **8443**) : le cookie de session, les mots de passe, les codes TOTP et le trafic des terminaux sont **chiffrés sur le réseau** dès le premier démarrage — même sur un LAN. La carte **HTTPS & certificats** affiche le badge du **mode effectif**, l'**adresse HTTPS** conseillée (celle vers laquelle les requêtes HTTP en clair sont redirigées — le contrôle de santé et le chemin du défi Let's Encrypt ne sont jamais redirigés, pas plus qu'une requête qu'un reverse proxy de confiance signale déjà comme HTTPS) et le **certificat que reçoivent les visiteurs** : sujet, émetteur, expiration (un **avertissement sous 30 jours**, un badge rouge **Expiré** au-delà), empreinte SHA-256 et noms alternatifs. Les changements s'appliquent **immédiatement** à l'écouteur en cours — sans redémarrage, et sans passer par **Enregistrer les modifications**." },
          { kind: "p", text: "Au départ, le certificat est **auto-signé** : Castor l'a généré au premier démarrage et le renouvelle lui-même. La connexion est chiffrée, mais les navigateurs affichent un **avertissement « non sécurisé / émetteur inconnu »** car aucune autorité de confiance ne l'a signé. Deux façons de faire disparaître l'avertissement :" },
          { kind: "list", items: [
            "**Faire confiance au certificat auto-signé** — cliquez sur **Télécharger le certificat** (`castor.crt`) et ajoutez-le au magasin de confiance de chaque poste (Trousseau sur macOS, Certificats sur Windows, `update-ca-certificates` sous Linux). Suffisant pour un ou deux admins sur un réseau privé.",
            "**Installer un certificat de confiance** — importez-en un depuis une autorité publique ou votre AC interne, ou laissez **Let's Encrypt** en émettre un. C'est la bonne réponse dès que plusieurs personnes utilisent l'instance.",
          ] },
          { kind: "p", text: "**Importer un certificat** accepte un certificat **DigiCert**, **Thawte**, **Sectigo**, **GlobalSign**… ou de votre **AC interne**, au format **PEM** (`-----BEGIN CERTIFICATE-----`) : le **certificat serveur**, sa **clé privée** (non chiffrée ; RSA 2048 bits ou plus, ou EC) et la **chaîne intermédiaire** fournie par votre prestataire. Collez chaque bloc ou chargez-le depuis un fichier. Incluez toujours les intermédiaires : sans eux, certains clients et navigateurs mobiles rejettent un certificat pourtant valide. La clé est envoyée **une seule fois**, stockée **chiffrée** et **jamais réaffichée** ; Castor vérifie qu'elle correspond au certificat et que celui-ci est en cours de validité, puis le sert et passe en mode **Certificat personnalisé**. **Supprimer le certificat personnalisé** l'efface et revient à l'auto-signé." },
          { kind: "p", text: "**Let's Encrypt** vous fournit un certificat gratuit, reconnu par les navigateurs, et le **renouvelle automatiquement** avant son expiration. Listez les **domaines** (noms d'hôte pleinement qualifiés, sans joker, sans IP), éventuellement un **e-mail** de contact, puis cliquez sur **Activer Let's Encrypt**. Prérequis : chaque domaine doit **résoudre publiquement** vers cet hôte, et les **ports 80 et 443** de cette adresse publique doivent être redirigés vers les écouteurs HTTP (**8080**) et HTTPS (**8443**) de Castor — l'AC valide la propriété par un **défi HTTP-01 sur le port 80**. Tant que le certificat n'est pas arrivé, l'auto-signé continue d'être servi ; **Renouveler maintenant** écarte le certificat en cache et en redemande un neuf, et la carte affiche la **dernière erreur** renvoyée par l'AC en cas de problème. **Désactiver** revient au certificat importé s'il en existe un, sinon à l'auto-signé." },
          { kind: "callout", tone: "warn", text: "Testez d'abord une nouvelle configuration Let's Encrypt avec l'interrupteur **staging** : il émet des certificats que les navigateurs ne reconnaissent **pas**, mais **sans limite de débit**. L'AC de production limite les demandes échouées et dupliquées par domaine : un DNS ou un port mal configuré peut vous bloquer plusieurs heures." },
          { kind: "callout", tone: "warn", text: "**HSTS, 24 heures.** Tant qu'un certificat de confiance (importé ou Let's Encrypt) est servi, Castor envoie un en-tête `Strict-Transport-Security` d'une durée de **un jour**. Les navigateurs qui ont visité le site pendant cette fenêtre **refusent ensuite le certificat auto-signé** jusqu'à son expiration. Revenir à l'auto-signé — le sélectionner, **Désactiver** Let's Encrypt sans certificat importé, ou **Supprimer le certificat personnalisé** alors qu'il est servi — peut donc bloquer ces utilisateurs pendant **jusqu'à 24 heures** ; la carte vous demande confirmation avant de le faire." },
          { kind: "p", text: "Le mode **Désactivé (configuré par l'environnement)** — aucun écouteur HTTPS, HTTP en clair uniquement — est destiné à un Castor placé **derrière un reverse proxy qui termine le TLS** (Nginx, Caddy, Traefik…). Avec `CASTOR_TLS_MODE=off`, le mode est **géré par l'environnement** : le réglage stocké en base est ignoré, la carte est **en lecture seule** et l'API refuse toute modification (`tls_managed_by_env`). Activer ou couper un écouteur exige un redémarrage, la carte ne le fait donc jamais à votre place — modifiez l'environnement et redémarrez Castor. Le mode Désactivé ne peut jamais être choisi depuis l'interface." },
          { kind: "note", text: "Seul du matériel **public** quitte le serveur : l'API, le journal d'audit et les logs serveur ne transportent jamais de clé privée. Consulter la carte exige **`settings.read`** ; chaque changement exige **`settings.update`** et un **step-up 2FA** lorsqu'il est activé." },
        ],
      },
      {
        title: "Notifications",
        blocks: [
          { kind: "p", text: "La carte **Notifications** gère les **canaux** d'alerte sortants. Un canal est une destination nommée — **Discord**, **Slack**, **ntfy** ou un **webhook générique** — abonnée à un ou plusieurs événements. Cliquez sur **Add channel**, donnez-lui un **nom**, choisissez un **type**, collez l'**URL du webhook** et cochez les événements qu'il doit recevoir." },
          { kind: "list", items: [
            "**Conteneur tombé** (`container.down`) — se déclenche quand un conteneur en marche s'arrête de façon inattendue. L'événement est **débouncé** : un conteneur qui clignote pendant un redémarrage n'inonde pas le canal.",
            "**Mise à jour d'image disponible** (`update.available`) — se déclenche quand Castor détecte qu'une image plus récente existe pour un conteneur en marche.",
          ] },
          { kind: "p", text: "L'**URL du webhook est un secret** : elle est **scellée en AES-256-GCM** côté serveur et **jamais réaffichée** — ni dans l'interface, ni via l'API. Quand vous éditez un canal, le champ URL affiche le placeholder `•••••• (unchanged)` : **laissez-le vide pour conserver** l'URL stockée, ou saisissez-en une nouvelle pour la remplacer." },
          { kind: "p", text: "Chaque ligne de canal porte un **interrupteur activer/désactiver**, un bouton **Test** qui envoie une notification de test à l'URL stockée — le moyen le plus sûr de la vérifier avant d'en dépendre —, un bouton **Edit**, et une icône **corbeille** de suppression protégée par une confirmation. Les alertes routées vers un canal supprimé cessent immédiatement." },
          { kind: "callout", tone: "info", text: "Contrairement aux réglages de sécurité ci-dessus, les changements de canaux s'appliquent **immédiatement** — ils ne passent **pas** par le bouton **Save changes** de la page." },
          { kind: "note", text: "Gérer les canaux exige la permission **`notifications.manage`**, accordée aux rôles **admin** et **operator**. Un utilisateur qui ne l'a pas voit la section mais ne peut ni lister ni modifier les canaux." },
        ],
      },
      {
        title: "Pièges & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "Si l'instance est **exposée à Internet**, activez **« 2FA requise pour les mutations »** — mais couplez-la à un **enrôlement 2FA imposé**, sinon les utilisateurs non enrôlés passent au travers.",
            "**Labellisez vos conteneurs critiques** (`io.castor.protected=true`) avant d'en avoir besoin, pas après un incident évité de justesse.",
            "Gardez `session.ttl_seconds` **court sur les machines partagées** ; une fenêtre longue sur un hôte public est un risque de détournement de session.",
            "Chaque réglage ici est **valable pour toute l'instance** — prévenez votre équipe pour qu'une demande TOTP soudaine ou une session coupée ne la surprenne pas.",
            "Les réglages de sécurité sont des actions **admin** (`settings.update`) ; les canaux de notification font exception — **operator** peut aussi les gérer (`notifications.manage`).",
            "**Testez un canal juste après l'avoir créé** — l'URL n'est jamais réaffichée, donc une faute de frappe ne se révèle que par un **Test** en échec.",
            "**Ne laissez pas le certificat auto-signé sur une instance partagée** — des utilisateurs qui cliquent chaque jour à travers les avertissements du navigateur ne remarquent plus une vraie attaque. Importez un certificat ou activez Let's Encrypt, et surveillez le **badge d'expiration** : un certificat importé n'est pas renouvelé à votre place.",
            "**Revenir à l'auto-signé n'est pas anodin** : les navigateurs conservent l'épinglage HSTS 24 heures après un certificat de confiance. Remplacez un certificat plutôt que de le supprimer, et choisissez pour un retour arrière un moment où un avertissement est tolérable.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://github.com/Yannleonard/Castor", label: "Castor — dépôt & documentation" },
        ],
      },
    ],
  },
};
