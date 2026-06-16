> [🇬🇧 English](SECURITY.md) · 🇫🇷 **Français**

# Politique de sécurité

Castor est conçu selon une approche **security-first**. Ce document décrit comment
nous traitons les vulnérabilités, comment en signaler une, et l'ensemble (restreint
et pleinement justifié) d'avis de sécurité amont que nous avons évalués comme
**non applicables** à Castor.

## Signaler une vulnérabilité

Veuillez signaler les problèmes de sécurité de manière privée via GitHub Security
Advisories (**Security → Report a vulnerability** sur le dépôt) plutôt que d'ouvrir
un ticket public. Nous nous efforçons d'accuser réception des signalements dans un
délai de 72 heures.

## Notre socle de base

- Le serveur s'exécute en tant qu'utilisateur **non-root** (uid 65532) dans une image
  **distroless** (pas de shell, pas de gestionnaire de paquets, pas de libc).
- Les secrets sont scellés avec **AES-256-GCM** ; les *valeurs* des secrets ne sont
  jamais retournées par l'API.
- Toutes les actions modifiant l'état sont **auditées** ; l'accès repose sur du **RBAC**,
  cantonné aux ressources.
- La CI exécute `govulncheck` à chaque push et **fait échouer le build pour toute
  vulnérabilité**, à l'exception des avis explicitement justifiés et non applicables
  listés ci-dessous. Le garde-fou est implémenté dans
  [`scripts/govulncheck-gate.sh`](scripts/govulncheck-gate.sh) :
  il analyse la sortie JSON de govulncheck et fait de nouveau échouer le build pour
  **tout** ce qui ne figure pas sur la liste d'autorisation, de sorte qu'une
  vulnérabilité nouvellement introduite ou nouvellement divulguée casse toujours
  la CI.

## Hygiène des dépendances

Nous maintenons la chaîne d'outils Go et les dépendances à jour afin d'absorber les
correctifs amont. À la date de la dernière version, cela inclut Go 1.25.11 (correctifs
de CVE de la bibliothèque standard), Helm v3.18.5, containerd v1.7.29 et
moby/spdystream v0.5.1 — résolvant collectivement chaque résultat actionnable de
`govulncheck`.

## Avis évalués comme non applicables (liste d'autorisation govulncheck)

Les avis suivants sont signalés par `govulncheck` à l'encontre de la bibliothèque
**cliente** `github.com/docker/docker` à laquelle Castor est lié, mais ils affectent
le sous-système de plugins du **daemon** Docker/Moby — des chemins de code que Castor
n'utilise pas. Il n'existe **aucune version corrigée** de `github.com/docker/docker`
pour l'un comme pour l'autre (le correctif ne se trouve que dans le module moteur
distinct `github.com/moby/moby/v2`). Ils sont donc inscrits sur la liste
d'autorisation du garde-fou CI, avec la justification consignée ici.

### GO-2026-4887 — CVE-2026-34040 (contournement de plugin AuthZ via un corps de requête surdimensionné)
- **Composant affecté :** le chemin de traitement des requêtes du **plugin d'autorisation**
  (`AuthZ`) du daemon.
- **Pourquoi cela ne s'applique pas à Castor :** Castor est un **client** de l'API Docker
  via le socket monté. Il **n'exécute pas** de daemon Docker, **n'enregistre pas** et
  ne dépend pas de plugins AuthZ, et n'expose aucun chemin qui transmettrait des corps
  surdimensionnés arbitraires à un plugin AuthZ du daemon. Castor applique sa propre
  autorisation (RBAC + audit) en interne, indépendamment des plugins AuthZ de Docker.
- **État du correctif amont :** aucun pour `github.com/docker/docker` (correctif réservé
  au moteur dans `moby/moby/v2`).

### GO-2026-4883 — CVE-2026-33997 (erreur off-by-one dans la validation des privilèges des plugins legacy)
- **Composant affecté :** la logique de validation des privilèges des **plugins legacy**
  du daemon.
- **Pourquoi cela ne s'applique pas à Castor :** Castor n'installe, n'active ni ne valide
  de **plugins** Docker (legacy ou autres). Le code de validation vulnérable n'est jamais
  atteint par aucun chemin de code de Castor.
- **État du correctif amont :** aucun pour `github.com/docker/docker` (correctif réservé
  au moteur dans `moby/moby/v2`).

Nous réexaminons cette liste d'autorisation à chaque mise à jour des dépendances. Si un
correctif amont devient disponible dans la bibliothèque cliente, nous l'adopterons et
supprimerons l'entrée correspondante.
