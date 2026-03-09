# Plan d'Architecture et d'Implémentation : Gestion Multi-LLM Locaux

**Date:** Mars 2026
**Auteur:** Architecte Principal
**Status:** En cours d'implémentation
**Objectif:** Ce document détaille le plan stratégique pour l'intégration de la gestion de multiples configurations de LLM locaux (on-premise) dans l'application A-IR-DD2. Il est destiné aux architectes et aux développeurs chargés de la correction et de la finalisation de cette fonctionnalité.

---

## 1. Vision et Objectifs

L'objectif est de permettre aux utilisateurs de configurer et d'utiliser simultanément plusieurs serveurs de modèles de langage locaux (comme Ollama, LMStudio, Jan, etc.). La configuration monolithique actuelle, qui n'autorise qu'un seul endpoint pour le fournisseur "LLM local (on premise)", est un frein majeur.

Cette évolution doit s'intégrer de manière fluide dans l'écosystème existant, en impactant trois domaines principaux :
1.  **Configuration Utilisateur:** Le menu des paramètres LLM.
2.  **Création d'Agents:** La page de prototypage d'agents ("Archi").
3.  **Utilisation des Agents:** Le canvas de workflow et la configuration d'instance ("BOS").

L'architecture choisie doit être robuste, évolutive et conforme aux principes SOLID.

---

## 2. Analyse de l'Existant et Stratégie Proposée

### 2.1. Le Problème : Index Unique en Base de Données

L'analyse de `Guides/BDD/ARCHITECTURE_BASE_DONNEES.md` révèle la contrainte principale : la collection `llm_configs` possède un **index unique composite `(userId, provider)`**. Cet index empêche la création de plus d'une entrée pour le `provider: "LLM local (on premise)"` par utilisateur, limitant de fait à une seule configuration.

### 2.2. La Solution : Le Modèle de "Profils"

Pour contourner cette limitation sans dégrader le modèle existant pour les fournisseurs cloud, nous introduisons une nouvelle entité : le **Profil LLM Local (`LocalLLMProfile`)**.

Plutôt que de modifier la collection `llm_configs`, nous créons une nouvelle collection dédiée, `local_llm_profiles`. Cette approche présente plusieurs avantages :
- **Isolation:** Les configurations locales, qui ont des besoins spécifiques (pas de clé API chiffrée, mais un nom et un endpoint), sont gérées séparément.
- **Clarté:** Le schéma de `llm_configs` reste simple et dédié aux fournisseurs principaux.
- **Scalabilité:** Il devient trivial d'ajouter des métadonnées spécifiques aux profils locaux sans impacter les autres configurations.

---

## 3. Plan d'Implémentation Détaillé

L'implémentation se déroule en 4 phases successives, du backend vers le frontend. L'analyse du code actuel montre que ce plan a été largement suivi.

### Phase 1 : Évolution du Backend et de la Base de Données (≈ 90% terminé)

Cette phase est la fondation de la fonctionnalité.

#### 3.1. Création de la Collection `local_llm_profiles`
- **Action:** Définir et créer une nouvelle collection en base de données.
- **Fichiers concernés:** `backend/src/services/databaseInit.ts`, `backend/docker/init-collections.js`.
- **Schéma `LocalLLMProfile`:**
  ```typescript
  {
    _id: ObjectId,
    userId: ObjectId,      // Lien vers l'utilisateur
    name: string,          // Nom unique et descriptif (ex: "Ollama Llama3")
    endpoint: string,      // URL du serveur (ex: "http://localhost:11434")
    capabilities: {},      // Capacités détectées
    enabled: boolean,      // Le profil est-il actif ?
    createdAt: Date,
    updatedAt: Date
  }
  ```
- **Index:** Un index unique `(userId, name)` est crucial pour garantir des noms de profils uniques par utilisateur.

#### 3.2. Création des Endpoints d'API CRUD
- **Action:** Développer un ensemble de routes d'API pour gérer le cycle de vie des profils.
- **Fichiers concernés:** `backend/src/server.ts`, et un nouveau `backend/src/routes/local-llm-profiles.routes.ts`.
- **Routes à implémenter:**
  - `POST /api/local-llm-profiles` : Créer un profil.
  - `GET /api/local-llm-profiles` : Récupérer tous les profils de l'utilisateur.
  - `PUT /api/local-llm-profiles/:id` : Mettre à jour un profil.
  - `DELETE /api/local-llm-profiles/:id` : Supprimer un profil.
- **Sécurité:** Chaque route doit être protégée et vérifier que l'utilisateur authentifié est bien le propriétaire de la ressource.

#### 3.3. Modification du Modèle `AgentPrototype`
- **Action:** Permettre à un prototype d'agent de référencer un profil LLM local spécifique.
- **Fichiers concernés:** `backend/src/models/AgentPrototype.model.ts`, `backend/src/routes/agent-prototypes.routes.ts`.
- **Modification:** Ajouter un champ optionnel `localLLMProfileId: string` au schéma `AgentPrototype`. Ce champ contiendra l'`_id` du profil choisi dans la collection `local_llm_profiles`.
- **Impact:** Les routes de création et de mise à jour des prototypes d'agents doivent être modifiées pour accepter et persister ce nouveau champ.

---

### Phase 2 : Intégration dans le Frontend (State Management) (≈ 95% terminé)

Cette phase consiste à rendre les données du backend accessibles et gérables dans l'état global de l'application frontend.

#### 3.1. Création du Hook `useLocalLLMProfiles`
- **Action:** Créer un hook custom pour encapsuler la logique d'interaction avec l'API `/api/local-llm-profiles`.
- **Fichier concerné:** `hooks/useLocalLLMProfiles.ts`.
- **Responsabilités:**
  - Exposer la liste des profils (`profiles`).
  - Fournir des méthodes asynchrones (`createProfile`, `updateProfile`, `deleteProfile`) qui appellent l'API.
  - Gérer l'état de chargement et les erreurs.
  - Synchroniser avec le `localStorage` en mode invité.

#### 3.2. Mise à jour du `useRuntimeStore`
- **Action:** Intégrer les profils dans le store Zustand pour un accès global et réactif.
- **Fichier concerné:** `stores/useRuntimeStore.ts`.
- **Modification:**
  - Ajouter `localLLMProfiles: LocalLLMProfile[]` à l'interface du store.
  - Ajouter une action `updateLocalLLMProfiles` pour mettre à jour cet état.

#### 3.3. Hydratation des Données
- **Action:** Charger les profils au démarrage de l'application et les injecter dans le store.
- **Fichier concerné:** `App.tsx`.
- **Logique:**
  1. Utiliser le hook `useLocalLLMProfiles` au niveau racine de l'application.
  2. Utiliser un `useEffect` pour appeler `updateLocalLLMProfiles` lorsque les profils du hook sont chargés.

---

### Phase 3 : Développement de l'Interface Utilisateur (≈ 85% terminé)

C'est la partie visible de la fonctionnalité, où l'utilisateur interagit avec le système.

#### 3.1. Mise à jour de la Modale de Paramètres
- **Action:** Permettre l'ajout, la modification et la suppression de profils locaux.
- **Fichier concerné:** `components/modals/SettingsModal.tsx`.
- **Implémentation:**
  - Sous la section "LLM local (on premise)", un bouton `+` (`PlusIcon`) permet d'ajouter un nouveau formulaire de profil.
  - Chaque profil est géré par un composant `LocalLLMProfileCard` (à créer), contenant des champs pour le nom, l'endpoint et un switch pour l'activer/désactiver.
  - La logique de sauvegarde (`handleSave`) doit orchestrer les appels au hook `useLocalLLMProfiles` pour créer, mettre à jour ou supprimer les profils modifiés.

#### 3.2. Mise à jour des Formulaires d'Agent
- **Action:** Permettre la sélection d'un profil local lors de la création ou la configuration d'un agent.
- **Fichiers concernés:** `components/modals/AgentFormModal.tsx`, `components/modals/AgentConfigurationModal.tsx`.
- **Logique d'affichage conditionnel:**
  - Si le `llmProvider` sélectionné est "LLM local (on premise)", un nouveau champ de sélection (dropdown) "Profil LLM local" doit apparaître.
  - Ce dropdown est peuplé avec les profils actifs (`enabled: true`) disponibles dans `useRuntimeStore`.
  - La valeur sélectionnée est stockée dans l'état local du formulaire et correspond au `localLLMProfileId`.

#### 3.3. Sauvegarde de la Référence
- **Action:** Envoyer le `localLLMProfileId` choisi au backend lors de la sauvegarde.
- **Fichiers concernés:** `services/agentPrototypeAPI.ts`, `components/modals/AgentFormModal.tsx`.
- **Modification:** Le payload envoyé à l'API de création/mise à jour d'agent doit inclure le champ `localLLMProfileId`.

---

### Phase 4 : Rendre la Fonctionnalité Opérationnelle (≈ 70% terminé)

La dernière phase cruciale : faire en sorte que les agents utilisent réellement la configuration choisie.

#### 4.1. Exécution de l'Agent
- **Action:** Au moment d'exécuter un appel LLM, utiliser l'endpoint du profil sélectionné.
- **Fichier concerné:** `components/V2AgentNode.tsx`.
- **Logique clé:**
  1. Le noeud d'agent (`V2AgentNode`) récupère la configuration complète de l'agent, y compris le `localLLMProfileId`.
  2. Avant l'appel à `llmService.generateContentStream`, une fonction `resolveLocalEndpoint` est invoquée.
  3. Cette fonction vérifie si le `llmProvider` est local ET si un `localLLMProfileId` est défini.
  4. Si c'est le cas, elle recherche le profil correspondant dans `useRuntimeStore.getState().localLLMProfiles`.
  5. Elle retourne l'endpoint de ce profil, qui sera utilisé comme `credential` pour l'appel LLM.
  6. Si aucun profil n'est trouvé, elle doit se rabattre sur un comportement par défaut (par exemple, l'ancien champ `localEndpoint` pour la rétrocompatibilité).

---

## 4. Statut Actuel et Prochaines Étapes

L'analyse du code existant indique que la majorité de ce plan a été implémentée. Cependant, plusieurs fichiers clés (notamment les nouveaux hooks et routes) n'ont pas pu être entièrement inspectés, et aucun test ne semble avoir été écrit.

**Plan d'action pour l'équipe de correction :**
1.  **Audit des nouveaux fichiers :** Examiner en détail `hooks/useLocalLLMProfiles.ts`, `backend/src/routes/local-llm-profiles.routes.ts` et `components/settings/LocalLLMProfileCard.tsx` pour y déceler des bugs ou des logiques incomplètes.
2.  **Tests Unitaires et d'Intégration :**
    - Écrire des tests pour le hook `useLocalLLMProfiles`.
    - Écrire des tests pour les nouvelles routes d'API backend.
    - Écrire des tests pour les composants UI modifiés.
3.  **Tests End-to-End (E2E) :**
    - Scénario 1 : Créer un nouveau profil local, l'assigner à un nouvel agent, et vérifier que l'appel LLM utilise le bon endpoint.
    - Scénario 2 : Modifier l'endpoint d'un profil existant et vérifier que l'agent utilise la nouvelle adresse.
    - Scénario 3 : Supprimer un profil et s'assurer que l'UI guide l'utilisateur pour reconfigurer les agents qui l'utilisaient.
    - Scénario 4 : Vérifier que le mode Invité fonctionne en utilisant le `localStorage`.
4.  **Gestion des Erreurs et Edge Cases :** Implémenter une gestion robuste pour les cas où un profil est supprimé mais toujours référencé par un agent. Afficher des avertissements clairs dans l'interface.
5.  **Documentation Finale :** Mettre à jour la documentation utilisateur pour expliquer cette nouvelle fonctionnalité.

En suivant ce plan et en se basant sur l'architecture solide déjà en place, l'équipe devrait être en mesure de finaliser et de livrer cette fonctionnalité de manière efficace.
