> [🇬🇧 English](local-sync.md) · 🇫🇷 **Français**

# Garder une copie locale synchronisée avec GitHub (Windows)

[`scripts/sync.ps1`](../../scripts/sync.ps1) maintient un dossier local (par défaut `D:\Castor`) à jour avec
`https://github.com/Yannleonard/Castor` : il le clone s'il n'existe pas, puis récupère les nouveaux commits
à chaque exécution — à la demande ou automatiquement toutes les 30 minutes.

Le script ne fait **que des avances rapides** (fast-forward) : il n'écrase jamais une modification locale et
ne supprime jamais un commit local. Quand la mise à jour ne peut pas s'appliquer proprement, il la saute et
explique pourquoi.

## Prérequis

- **Git pour Windows** : `winget install --id Git.Git -e` (ou <https://git-scm.com/download/win>), puis
  rouvrir PowerShell.

## Mise en place (une seule fois)

Dans PowerShell :

```powershell
irm https://raw.githubusercontent.com/Yannleonard/Castor/main/scripts/sync.ps1 -OutFile $env:USERPROFILE\castor-sync.ps1
powershell -ExecutionPolicy Bypass -File $env:USERPROFILE\castor-sync.ps1 -Install
```

La première exécution prépare `D:\Castor` :

| État de `D:\Castor` | Ce que fait le script |
|---|---|
| absent ou vide | `git clone` du dépôt |
| déjà un clone Git de Castor | mise à jour depuis GitHub |
| dossier ordinaire (ex. un ZIP décompressé) | le renomme en `D:\Castor.backup-<date>` (rien n'est supprimé) puis clone ; recopiez ensuite ce qui vous est propre (`.env`, `data\`…) |

`-Install` crée ensuite la tâche planifiée **Castor sync**, qui relance la synchronisation toutes les
30 minutes tant que vous êtes connecté (et au réveil du PC si un passage a été manqué). Une fenêtre
PowerShell peut apparaître une fraction de seconde à chaque passage.

## Utilisation

```powershell
D:\Castor\scripts\sync.ps1                           # synchroniser maintenant
D:\Castor\scripts\sync.ps1 -Branch claude/ma-branche # passer sur une autre branche puis la mettre à jour
D:\Castor\scripts\sync.ps1 -Branch main              # revenir sur main
D:\Castor\scripts\sync.ps1 -Install -EveryMinutes 60 # changer la fréquence
D:\Castor\scripts\sync.ps1 -Uninstall                # supprimer la tâche planifiée
```

(Si PowerShell refuse d'exécuter le script, préfixez par `powershell -ExecutionPolicy Bypass -File`.)

La tâche planifiée met à jour **la branche actuellement extraite** dans `D:\Castor`. Autres options :
`-Path` (un autre dossier que `D:\Castor`) et `-Repo` (une autre URL, ex. un fork).

## Quand la mise à jour est sautée

Tout est noté dans `%LOCALAPPDATA%\Castor\sync.log`.

- **Modifications locales sur des fichiers que GitHub a aussi changés** : validez-les (`git commit`) ou
  annulez-les, puis relancez.
- **Commits locaux non poussés alors que GitHub a avancé** : fusionnez à la main avec
  `git -C D:\Castor pull`, puis `git push` si besoin.
- **« dubious ownership »** (disque externe/exFAT, dossier créé par un autre compte) : le script ajoute
  automatiquement `D:/Castor` à `safe.directory` de Git.

La synchronisation va dans un seul sens (GitHub → PC). Pour envoyer vos propres modifications vers GitHub,
utilisez `git add`, `git commit` et `git push` comme d'habitude.
