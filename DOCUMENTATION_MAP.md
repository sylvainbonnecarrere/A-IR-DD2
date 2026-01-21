# Carte de la Documentation A-IR-DD2

Bienvenue dans A-IR-DD2. Ce document fournit une vue d'ensemble synthétique pour vous aider à naviguer dans le projet.

## Statut du Projet et Modes d'Utilisation

Le projet est en cours de développement actif. Il existe deux manières principales d'utiliser l'application :

*   **Mode Invité (Guest)** : Idéal pour des tests rapides. Toutes les configurations (y compris les clés API) sont stockées directement dans le `localStorage` de votre navigateur. Ces données ne sont pas chiffrées et ne persistent pas si vous changez d'appareil ou de navigateur.
*   **Mode Connecté (Authenticated)** : Nécessite la création d'un compte. Ce mode offre une persistance complète des données dans une base de données MongoDB. Les clés API, les prototypes, les workflows et les préférences utilisateur sont stockés de manière sécurisée et synchronisés sur tous vos appareils.

## Cœur de l'Application : Développement d'Agents IA

Le développement actuel se concentre sur la fonctionnalité centrale de l'application : la création et l'orchestration d'agents d'intelligence artificielle.

*   **Support Multi-LLM** : L'application intègre les API des principaux fournisseurs de modèles de langage (Gemini, OpenAI, Anthropic, etc.).
*   **LLM sur Site (On-Premise)** : Il est également possible de se connecter à des modèles locaux via des services comme LMStudio, offrant une confidentialité maximale.
*   **Configuration Centralisée** : La gestion de toutes les clés API et des fournisseurs se fait de manière unifiée via l'interface "Paramètres des LLMs".

## Processus de Création : Du Prototype à l'Instance

Le workflow utilisateur pour la création d'agents est conçu autour d'une architecture de spécialisation par "robots".

1.  **Utilisation du Robot Archi** : Le robot **Archi** est le spécialiste de l'architecture. L'utilisateur l'utilise pour accéder à la section de "Prototypage".
2.  **Création de Prototypes** : Dans cette section, vous pouvez créer des **prototypes d'agents**. Un prototype définit le comportement de base d'un agent : son rôle (prompt système), ses capacités (génération d'images, recherche web, etc.) et les outils qu'il peut utiliser. Pour un utilisateur connecté, ces prototypes sont sauvegardés sur son compte.
3.  **Instanciation sur le Workflow** : Une fois qu'un prototype est créé, vous pouvez l'ajouter à votre espace de travail visuel (le workflow). Cette action crée une **instance** de l'agent. Vous pouvez alors personnaliser cette instance (par exemple, en modifiant son nom ou son prompt pour une tâche spécifique) sans altérer le prototype original. Cela permet de réutiliser un même prototype pour créer de multiples agents spécialisés sur votre canvas.