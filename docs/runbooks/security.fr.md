> [🇬🇧 English](security.md) · 🇫🇷 **Français**

# Vue d'ensemble de la sécurité

Cette page décrit ce que Castor fait pour protéger votre déploiement et ce qui reste à faire de votre côté.
Les commandes de déploiement sont dans [`install.fr.md`](install.fr.md).

## Ce que Castor fournit

**HTTPS par défaut.** Castor sert l'interface et l'API en HTTPS avec un certificat auto-signé
dès l'installation. Vous pouvez importer votre propre certificat (certificat PEM, clé et chaîne) ou activer
Let's Encrypt depuis **Settings → HTTPS & certificates** ; les certificats sont appliqués sans redémarrage
et HSTS est envoyé avec les certificats émis par une CA.

**Comptes et 2FA.** Les comptes locaux utilisent le hachage de mot de passe argon2id ; la 2FA TOTP est disponible pour chaque
utilisateur, avec des codes de récupération à usage unique. Les secrets TOTP et les clés privées importées sont chiffrés au repos
en AES-256-GCM sous `CASTOR_SECRET_KEY`. Le SSO via LDAP et OIDC est pris en charge. La connexion est
limitée en fréquence, et les sessions sont côté serveur, liées à un cookie et révoquées à la déconnexion et au changement de mot de passe.

**Contrôle d'accès par rôles.** Chaque action passe par une vérification de permission côté serveur.

| Rôle | Ce qu'il autorise |
|---|---|
| `admin` | Tout, y compris la création de conteneurs, les suppressions, les utilisateurs, les rôles et le journal d'audit. |
| `operator` | Lecture Docker plus start, stop, restart, pause, exec, logs et pull d'image. |
| `viewer` | Accès en lecture seule aux conteneurs, images, réseaux, volumes et stats. |

Des rôles personnalisés peuvent être créés ; un utilisateur ne peut octroyer que les permissions qu'il détient lui-même.

**Journal d'audit.** Chaque action modifiant l'état écrit un enregistrement en ajout seul : acteur, IP, action, cible,
résultat et identifiant de requête, avec les secrets expurgés. La lecture du journal requiert `audit.read`.

**Jetons d'API.** Les Personal Access Tokens authentifient les appels d'API et le endpoint Prometheus `/metrics`
avec `Authorization: Bearer` ; ils portent les permissions de leur propriétaire.

**Conteneurs protégés.** Le conteneur de Castor lui-même et son volume `/data` ne peuvent être supprimés depuis
l'interface ou l'API, par personne. Les conteneurs étiquetés `io.castor.protected="true"` exigent un admin et une
confirmation explicite avec un motif, enregistrée dans le journal d'audit.

**Image durcie.** Distroless, utilisateur non-root (uid 65532), système de fichiers racine en lecture seule, toutes les
capabilities retirées et `no-new-privileges`. Les dépendances sont vérifiées avec `govulncheck` à chaque
push.

## Le socket Docker

Le socket Docker donne un accès complet au moteur Docker et donc à l'hôte. Montez-le
en `:rw` uniquement sur un hôte que vous confiez à Castor, ou faites pointer `CASTOR_DOCKER_HOST` vers un docker-socket-proxy
qui n'expose que les endpoints dont vous avez besoin.

## Recommandations de déploiement

- Activez la 2FA pour chaque compte, en commençant par l'admin ; activez
  `security.totp_required_for_mutations` dans Settings pour l'exiger sur les actions modifiant l'état.
- Servez un certificat de confiance : importé, Let's Encrypt, ou TLS terminé par votre reverse proxy.
- Conservez `CASTOR_SECRET_KEY` dans un gestionnaire de secrets et sauvegardez `/data` régulièrement.
- Mettez Castor à jour au fil des versions publiées (`docker compose pull && docker compose up -d`).
- Lorsque Castor est joignable depuis internet, placez-le derrière un reverse proxy et restreignez qui peut
  atteindre les ports 8443 et 8080.

## Signaler une vulnérabilité

Signalez les problèmes de sécurité en privé via **Security → Report a vulnerability** sur le dépôt
GitHub (voir [`SECURITY.md`](../../SECURITY.md)), et non dans une issue publique.
