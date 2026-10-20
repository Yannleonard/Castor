# Exploitation du service de communication du site Castor

Ce guide décrit les opérations générales du service de communication associé au site Castor. Il ne documente volontairement aucun nom d’hôte, adresse IP, compte, destinataire interne, identifiant de conteneur ou secret de production. Les détails propres à une installation doivent rester dans le gestionnaire de secrets et la documentation d’exploitation privée de l’équipe.

## Architecture

Le service est une application Go empaquetée dans une image Docker. Il fournit les pages du site et les fonctions de communication : annonces, gestion de comptes clients et tickets de support. Les données persistantes doivent être montées sur `/data` et sauvegardées avant toute opération de maintenance.

Les e-mails transactionnels utilisent Microsoft Graph avec OAuth client credentials. Les inscriptions et les créations de tickets envoient une notification interne et un accusé de réception au client ; les réponses du support sont envoyées par le même canal. Aucun repli SMTP n’est prévu. En cas d’indisponibilité de Graph, les données du ticket restent enregistrées et l’échec d’envoi est signalé.

## Configuration

Fournir les paramètres d’exécution au moyen d’un gestionnaire de secrets ou d’un fichier d’environnement protégé, jamais dans le dépôt :

- `CASTOR_CUSTOMERS_ADMIN_USERNAME` et `CASTOR_CUSTOMERS_ADMIN_PASSWORD` pour le portail d’administration des clients ; choisir un mot de passe aléatoire et unique.
- `CASTOR_CUSTOMER_NOTIFICATION_EMAIL` pour le destinataire des notifications internes.
- Les paramètres Microsoft Graph requis par l’application pour le tenant, le client, le secret client et la boîte aux lettres expéditrice.
- `CASTOR_ANNOUNCEMENTS_ADMIN_TOKEN` si un jeton d’administration des annonces est fourni explicitement.

Ne jamais publier de secrets, valeurs d’environnement de production, données clients ou exports du volume. Les interfaces d’administration doivent être protégées par HTTPS et ne pas être exposées sans authentification.

## Contrôles après déploiement

1. Vérifier que le nouveau conteneur est démarré et que son healthcheck passe.
2. Vérifier les journaux sans afficher de jetons, données personnelles ni contenu de messages.
3. Contrôler le fonctionnement des pages publiques et des fonctions d’administration depuis un poste autorisé.
4. Effectuer un test Graph contrôlé avec des destinataires de test et confirmer la réception des notifications.
5. Confirmer que le volume persistant est conservé et qu’une sauvegarde récente est disponible.

## Mise à jour et retour arrière

Construire ou récupérer une image versionnée, puis la déployer selon la procédure de changement approuvée par l’équipe. Ne pas supposer qu’un Compose exécuté depuis un poste local contrôle l’environnement distant. Avant le remplacement, sauvegarder les données persistantes et noter la version précédente de l’image. Après le déploiement, vérifier le healthcheck et les tests fonctionnels ci-dessus. En cas d’échec, restaurer l’image précédente sans supprimer ni recréer le volume de données.

Pour les règles de notifications et les limites de l’annonce intégrée à Castor, consulter [la documentation des annonces](../announcements.md).
