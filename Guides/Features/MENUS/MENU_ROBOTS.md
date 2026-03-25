- Vision Globale
La plateforme AIRDD2 est une application de workflow d'agents IA ludique et visuelle, inspirée du game design, permettant de créer, orchestrer et monitorer des agents autonomes via une interface node-based intuitive.

- Objectifs Principaux

Création modulaire  Prototypage et réutilisation d'agents configurables
Orchestration visuelle  Workflows interactifs sur carte node-based
Monitoring intelligent  Supervision temps réel avec analytics et debugging
Intégrations extensibles  Connexions API, bases de données, MCP, RAG, RLM (Recusrive Language Model)
Automatisation événementielle  Déclencheurs et planification avancés
Collaboration  Partage et gouvernance multi-utilisateurs


- Architecture des Menus par Agent
🤖 ARCHI (AR_001) - L'Architecte des Agents
AR_001.1 - Prototypage d'Agents ✅ [Existant ne pas toucher la page de lien]
Créer modèles d'agents réutilisables
AR_001.2 - Instanciation Agents
Déployer prototypes sur workflow
AR_001.3 - Liens & Interactions
Connecter agents entre eux
AR_001.4 - Gestion des Tâches
Configurer actions et séquences
AR_001.5 - Bibliothèque Prototypes
Explorer agents sauvegardés

📊 BOS (BO_002) - Le Superviseur
BO_002.1 - Workflow Map ✅ [Existant ne pas toucher la page de lien]
Éditer carte du workflow
BO_002.2 - Monitoring Live
Vue temps réel logsperformances
BO_002.3 - Analytics & Coûts
Tracker dépenses et usage
BO_002.4 - Gouvernance Utilisateurs
Gérer permissions et accès
BO_002.5 - Playground Public
Interface utilisateur final workflow

🔌 COM (CO_003) - Le Connecteur
CO_003.1 - Connexions API
Intégrer services web externes
CO_003.2 - Bases de Données
Lier SQLNoSQL au workflow
CO_003.3 - BDD Vectorielles
Connecter PineconeWeaviateChroma
CO_003.4 - Intégrations MCP
Ajouter Model Context Protocol
CO_003.5 - Hub Connecteurs
Parcourir intégrations disponibles

🧠 PHIL (PH_004) - Le Penseur Technique
PH_004.1 - RAG Configuration
Chunks, embeddings et retrieval
PH_004.2 - File Handling
Formats, transformations et rapports
PH_004.3 - Fonctions Personnalisées
Créer scripts ReactPython
PH_004.4 - Bibliothèques Externes
Installer packages et outils
PH_004.5 - Knowledge Base
Gérer documents et contextes

⏱️ TIM (TI_005) - Le Temporisateur
TI_005.1 - Triggers & Webhooks
Déclencher workflows par événements
TI_005.2 - Scheduling
Planifier exécutions récurrentes
TI_005.3 - Polling & Watch
Surveiller sources de données
TI_005.4 - Rate Limiting
Contrôler débits et quotas
TI_005.5 - Async Management
Orchestrer tâches asynchrones

- 🎯 Recommandations UX
Design (important) : Se baser sur l'UX actuelle du menu Archi > Prototypage (ce menu doit être renommé Prototypage d'agent).
Icônes distinctives (déjà fait, ne pas en tenir compte) : Chaque robot a une une identité visuelle forte (couleur + picto)
Breadcrumbs  : Afficher le chemin Robot  Menu pour la navigation quand s'ouvre la page d'un menu
Quick Actions  : Raccourcis pour lancer rapidement une page de menu
Onboarding ludique (À faire plus tard, ne pas en tenir compte) :   Tutorial interactif présentant chaque robot comme un personnage du jeu