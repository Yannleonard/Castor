// Castor by IT Leonard
// ui/src/help/cards/authentication.ts — Single sign-on (LDAP & OIDC) help card.
import type { HelpCard } from "../types";

export const authenticationCard: HelpCard = {
  id: "authentication",
  title: { en: "Single sign-on (LDAP & OIDC)", fr: "Authentification unique (LDAP & OIDC)" },

  en: {
    summary: "Let your team sign in with your company directory: local accounts plus enterprise SSO over LDAP/LDAPS and OIDC (Microsoft Entra ID, Okta, Keycloak…).",
    sections: [
      {
        title: "What it does",
        blocks: [
          { kind: "p", text: "Out of the box, Castor authenticates users against **local accounts**. On top of that, the **Authentication** view lets an administrator plug in **enterprise SSO** so people sign in with the credentials they already have." },
          { kind: "list", items: [
            "**OIDC** — OpenID Connect providers such as **Microsoft Entra ID** (Azure AD), **Okta**, **Keycloak**, Google Workspace, Auth0…",
            "**LDAP / LDAPS** — a directory server (Active Directory, OpenLDAP, FreeIPA…), with the connection secured by **LDAPS** or **STARTTLS**.",
          ] },
          { kind: "p", text: "Local accounts keep working alongside SSO, so you always have a way in if the identity provider is unreachable." },
        ],
      },
      {
        title: "How it works in Castor",
        blocks: [
          { kind: "p", text: "Providers are managed as a list in the **Authentication** view. Each one you add and enable produces a **sign-in button on the login screen** (\"Sign in with Entra\", \"Sign in with LDAP\"…), so users pick their provider right there." },
          { kind: "p", text: "When someone signs in for the first time through a provider, Castor can **create their account on the fly** (JIT provisioning) and assign a role from the group mapping — no manual account creation needed." },
          { kind: "callout", tone: "info", text: "Managing providers requires the `auth.provider.*` permissions, reserved for **superadmins**. A regular admin can run the day-to-day platform without ever touching identity configuration." },
        ],
      },
      {
        title: "Add an OIDC provider",
        blocks: [
          { kind: "p", text: "Click **Add provider**, choose **OIDC**, and fill in the values from your identity provider's app registration:" },
          { kind: "list", items: [
            "**Issuer URL** — the provider's base URL (Castor auto-discovers the endpoints from `/.well-known/openid-configuration`).",
            "**Client ID** — the application/client identifier issued by the provider.",
            "**Client secret** — the secret paired with that client (see the security note below).",
            "**Scopes** — usually `openid profile email`, plus `groups` (or the provider's equivalent) if you want group-based role mapping.",
          ] },
          { kind: "note", text: "In your provider, register Castor's redirect (callback) URL — Castor shows it next to the OIDC form so you can copy it into the app registration." },
        ],
      },
      {
        title: "Add an LDAP provider",
        blocks: [
          { kind: "p", text: "Choose **LDAP** and provide the directory connection details:" },
          { kind: "list", items: [
            "**Server URL** — e.g. `ldaps://dc01.example.com:636`.",
            "**Base DN** — where to search for users, e.g. `dc=example,dc=com`.",
            "**User filter** — the search filter matching login names, e.g. `(sAMAccountName=%s)` for Active Directory or `(uid=%s)` for OpenLDAP.",
            "**Bind account** — the service account DN and password Castor uses to search the directory.",
            "**TLS mode** — `LDAPS` (implicit TLS on 636), `STARTTLS` (upgrade on 389), or `none` (clear text — lab only).",
          ] },
          { kind: "callout", tone: "warn", text: "Avoid TLS mode `none` outside a lab: bind credentials and passwords would travel in clear text. Prefer **LDAPS** or **STARTTLS** in production." },
        ],
      },
      {
        title: "Map groups to roles (JIT provisioning)",
        blocks: [
          { kind: "p", text: "Under a provider, add **group → role** mappings to grant permissions automatically at login. Associate a directory/OIDC group with a Castor role:" },
          { kind: "list", items: [
            "An LDAP/OIDC group like `castor-admins` → Castor role **admin**",
            "A group like `platform-ops` → **operator**",
            "Everyone else / a read-only group → **viewer**",
          ] },
          { kind: "p", text: "On each sign-in, Castor reads the user's groups from the provider and resolves their role from these mappings, so access follows your directory: change someone's group membership and their Castor role follows at their next login." },
          { kind: "note", text: "For OIDC, groups must actually be emitted in the token — add the `groups` scope and, on Entra, configure the app registration to include a **groups claim**." },
        ],
      },
      {
        title: "Test, secrets & pitfalls",
        blocks: [
          { kind: "p", text: "Use the **Test** button before saving: Castor opens a connection to the provider and validates the configuration and credentials, so you catch a wrong secret or unreachable server immediately instead of at the login screen." },
          { kind: "callout", tone: "warn", text: "**Entra multi-tenant issuer trap:** an issuer built on `common` (or `organizations`) fails token validation. Use your **tenant-specific** issuer, e.g. `https://login.microsoftonline.com/<tenant-id>/v2.0`." },
          { kind: "p", text: "The sensitive value — **OIDC client secret** or **LDAP bind password** — is **encrypted at rest** (sealed AES-256-GCM) and **never shown again** after you save it. To change it, type a new secret; leaving it blank keeps the stored one." },
          { kind: "list", items: [
            "Keep at least one **local admin** account so a provider outage never locks everyone out.",
            "Rotate the OIDC client secret before it expires — an expired secret breaks every SSO login at once.",
            "Managing providers is a **superadmin** action (`auth.provider.*`); when *2FA-required-for-mutations* is on, expect a TOTP step-up before changes are saved.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc", label: "Microsoft Entra ID — OpenID Connect on the identity platform" },
        ],
      },
    ],
  },

  fr: {
    summary: "Laissez votre équipe se connecter avec l'annuaire de l'entreprise : comptes locaux plus SSO d'entreprise via LDAP/LDAPS et OIDC (Microsoft Entra ID, Okta, Keycloak…).",
    sections: [
      {
        title: "À quoi ça sert",
        blocks: [
          { kind: "p", text: "Par défaut, Castor authentifie les utilisateurs via des **comptes locaux**. En complément, la vue **Authentication** permet à un administrateur de brancher le **SSO d'entreprise** pour que chacun se connecte avec les identifiants qu'il possède déjà." },
          { kind: "list", items: [
            "**OIDC** — fournisseurs OpenID Connect comme **Microsoft Entra ID** (Azure AD), **Okta**, **Keycloak**, Google Workspace, Auth0…",
            "**LDAP / LDAPS** — un serveur d'annuaire (Active Directory, OpenLDAP, FreeIPA…), avec la connexion sécurisée par **LDAPS** ou **STARTTLS**.",
          ] },
          { kind: "p", text: "Les comptes locaux continuent de fonctionner en parallèle du SSO : vous gardez toujours une porte d'entrée si le fournisseur d'identité est injoignable." },
        ],
      },
      {
        title: "Comment ça marche dans Castor",
        blocks: [
          { kind: "p", text: "Les fournisseurs se gèrent sous forme de liste dans la vue **Authentication**. Chaque fournisseur ajouté et activé fait apparaître un **bouton de connexion sur l'écran de login** (« Se connecter avec Entra », « Se connecter avec LDAP »…), et l'utilisateur choisit son fournisseur directement là." },
          { kind: "p", text: "Lors d'une première connexion via un fournisseur, Castor peut **créer le compte à la volée** (JIT provisioning) et lui attribuer un rôle d'après le mapping de groupes — aucune création de compte manuelle." },
          { kind: "callout", tone: "info", text: "La gestion des fournisseurs requiert les permissions `auth.provider.*`, réservées aux **superadmins**. Un administrateur classique fait tourner la plateforme au quotidien sans jamais toucher à la configuration d'identité." },
        ],
      },
      {
        title: "Ajouter un fournisseur OIDC",
        blocks: [
          { kind: "p", text: "Cliquez sur **Ajouter un fournisseur**, choisissez **OIDC**, puis renseignez les valeurs issues de l'enregistrement d'application de votre fournisseur d'identité :" },
          { kind: "list", items: [
            "**Issuer URL** — l'URL de base du fournisseur (Castor découvre automatiquement les endpoints via `/.well-known/openid-configuration`).",
            "**Client ID** — l'identifiant d'application/client délivré par le fournisseur.",
            "**Client secret** — le secret associé à ce client (voir la note de sécurité ci-dessous).",
            "**Scopes** — en général `openid profile email`, plus `groups` (ou l'équivalent du fournisseur) si vous voulez le mapping de rôles par groupe.",
          ] },
          { kind: "note", text: "Chez votre fournisseur, enregistrez l'URL de redirection (callback) de Castor — Castor l'affiche à côté du formulaire OIDC pour que vous la copiiez dans l'enregistrement d'application." },
        ],
      },
      {
        title: "Ajouter un fournisseur LDAP",
        blocks: [
          { kind: "p", text: "Choisissez **LDAP** et fournissez les détails de connexion à l'annuaire :" },
          { kind: "list", items: [
            "**URL du serveur** — ex. `ldaps://dc01.example.com:636`.",
            "**Base DN** — où rechercher les utilisateurs, ex. `dc=example,dc=com`.",
            "**Filtre utilisateur** — le filtre de recherche qui correspond aux identifiants, ex. `(sAMAccountName=%s)` pour Active Directory ou `(uid=%s)` pour OpenLDAP.",
            "**Compte de bind** — le DN et le mot de passe du compte de service que Castor utilise pour interroger l'annuaire.",
            "**Mode TLS** — `LDAPS` (TLS implicite sur 636), `STARTTLS` (élévation sur 389) ou `none` (en clair — labo uniquement).",
          ] },
          { kind: "callout", tone: "warn", text: "Évitez le mode TLS `none` hors labo : les identifiants de bind et les mots de passe transiteraient en clair. Préférez **LDAPS** ou **STARTTLS** en production." },
        ],
      },
      {
        title: "Mapper les groupes aux rôles (JIT provisioning)",
        blocks: [
          { kind: "p", text: "Sous un fournisseur, ajoutez des mappings **groupe → rôle** pour attribuer les permissions automatiquement à la connexion. Associez un groupe annuaire/OIDC à un rôle Castor :" },
          { kind: "list", items: [
            "Un groupe LDAP/OIDC comme `castor-admins` → rôle Castor **admin**",
            "Un groupe comme `platform-ops` → **operator**",
            "Tous les autres / un groupe en lecture seule → **viewer**",
          ] },
          { kind: "p", text: "À chaque connexion, Castor lit les groupes de l'utilisateur transmis par le fournisseur et en déduit son rôle via ces mappings : l'accès suit votre annuaire — changez l'appartenance d'un utilisateur à un groupe, et son rôle Castor suivra à sa prochaine connexion." },
          { kind: "note", text: "Pour OIDC, les groupes doivent réellement figurer dans le token — ajoutez le scope `groups` et, sur Entra, configurez l'enregistrement d'application pour inclure un **claim groups**." },
        ],
      },
      {
        title: "Tester, secrets & pièges",
        blocks: [
          { kind: "p", text: "Utilisez le bouton **Test** avant d'enregistrer : Castor ouvre une connexion au fournisseur et valide la configuration et les identifiants, pour repérer un secret erroné ou un serveur injoignable tout de suite plutôt qu'à l'écran de login." },
          { kind: "callout", tone: "warn", text: "**Piège de l'issuer multi-tenant Entra :** un issuer basé sur `common` (ou `organizations`) échoue à la validation du token. Utilisez l'issuer **spécifique à votre tenant**, ex. `https://login.microsoftonline.com/<tenant-id>/v2.0`." },
          { kind: "p", text: "La valeur sensible — **client secret OIDC** ou **mot de passe de bind LDAP** — est **chiffrée au repos** (scellée AES-256-GCM) et **jamais réaffichée** après enregistrement. Pour la changer, saisissez un nouveau secret ; en la laissant vide, l'ancienne est conservée." },
          { kind: "list", items: [
            "Gardez au moins un compte **admin local** pour qu'une panne de fournisseur ne verrouille jamais tout le monde dehors.",
            "Renouvelez le client secret OIDC avant son expiration — un secret expiré casse d'un coup toutes les connexions SSO.",
            "Gérer les fournisseurs est une action **superadmin** (`auth.provider.*`) ; quand l'option *2FA requise pour les mutations* est active, attendez-vous à un step-up TOTP avant l'enregistrement.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://learn.microsoft.com/fr-fr/entra/identity-platform/v2-protocols-oidc", label: "Microsoft Entra ID — OpenID Connect sur la plateforme d'identités" },
        ],
      },
    ],
  },
};
