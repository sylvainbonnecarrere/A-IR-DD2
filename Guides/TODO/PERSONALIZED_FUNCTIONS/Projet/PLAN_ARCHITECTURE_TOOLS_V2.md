# PLAN D'ARCHITECTURE — Feature "Tools V2" (Fonctions Personnalisées)
## Document Aether-Arch-2026 · Destiné aux Agents Codeurs Experts

> **Auteur** : Aether-Arch-2026 (Agent Architecte Senior)  
> **Date** : 10 mars 2026  
> **Version** : 1.0 — Document de référence pour implémentation  
> **Périmètre** : Feature complète "Tools V2" — 4 grandes zones, 9 jalons techniques  
> **Anti-régression** : Chaque jalon est isolé et testable indépendamment

---

## SOMMAIRE EXÉCUTIF

Ce document est le plan d'implémentation maître de la feature **Tools V2**. Il a été produit après :
1. Lecture intégrale du cahier des charges (`TOOLS_V2.md`)
2. Analyse de la codebase existante (frontend React/TS + backend Node.js + MongoDB)
3. Étude des documents techniques de référence (Partie 1, Partie 2, plan LLM locaux)

La feature se décompose en **4 grandes zones** et **9 jalons** :

| Zone | Jalons | Description |
|------|--------|-------------|
| **Z1 — Fondations** | J1, J2 | Schémas BDD, modèles Mongoose, API REST Backend |
| **Z2 — Page Phil** | J3, J4 | Composants UI Bibliothèque + Éditeur/Sandbox |
| **Z3 — Intégration** | J5, J6 | Archi Prototypage + Bos Carte Workflow |
| **Z4 — Engine** | J7, J8, J9 | 11 fonctions natives + LLMs locaux + Affichage tool calls |

**Règle d'or** : chaque jalon peut être livré, testé et mergé indépendamment. Aucun jalon ne casse l'existant.

---

## ANALYSE DE LA CODEBASE EXISTANTE

### Catégorie 1 — Gestion actuelle des Tools (à faire évoluer)

| Fichier | Rôle actuel | Impact V2 |
|---------|-------------|-----------|
| `utils/toolExecutor.ts` | Router TS ↔ Python via `_py` suffix. 2 fonctions hardcodées (`get_weather`, `get_current_time`) | **Refactoring majeur** : remplacer par `FunctionRegistry` + `ToolExecutor` dynamiques |
| `backend/src/pythonExecutor.ts` | Subprocess Python via whitelist `config.ts` | **Étendre** : ajouter support fonctions custom path + context injection |
| `backend/src/config.ts` | Whitelist `['search_web_py']` | **Étendre** : whitelist dynamique depuis BDD |
| `components/modals/AgentFormModal.tsx` | Onglet "Fonctions" inline (create/edit tools hardcodé) | **Remplacer** onglet par sélecteur depuis `FunctionRegistry` |
| `components/modals/AgentConfigurationModal.tsx` | Onglet "fonctions" sur instance | **Remplacer** même pattern |
| `services/llmService.ts` | Dispatch LLM, passe `Tool[]` aux providers | **Étendre** : intégrer `FunctionCallingPromptBuilder` pour LLMs locaux |
| `types.ts` interface `Tool` | `{ name, description, parameters, outputSchema? }` | **Étendre** : ajouter `id`, `origin` (`native`\|`custom`), `language`, `isEnabled`, `workflowId` |

### Catégorie 2 — Schémas BDD (à modifier)

| Modèle | Collection MongoDB | Champ `tools` actuel | Évolution V2 |
|--------|-------------------|----------------------|--------------|
| `AgentPrototype.model.ts` | `agent_prototypes` | `tools: [Mixed]` — JSON Schema inline | Référence `functionId[]` vers collection `user_functions` |
| `AgentInstance.model.ts` | `agent_instances` | `tools: [Mixed]` hérité | Référence fonctions + flag `inheritFromPrototype` |
| `UserSettings.model.ts` | `user_settings` | Préférences uniquement | **Ajouter** `functionPaths`: mapping `workflowId → répertoire FS` |

### Catégorie 3 — Pages existantes (référence pour design)

| Page | Couleur robot | Layout inspirant |
|------|--------------|-----------------|
| `ArchiPrototypingPage.tsx` | amber/yellow | Liste prototypes + modale création |
| `BosWorkflowManagementPage.tsx` | blue | Dashboard + onglets |
| `PhilDataPage.tsx` | cyan-500 | **Page cible** à remplacer/enrichir |
| `V2AgentNode.tsx` | Dynamique | Nœud workflow + chat + tool calls UI |

### Catégorie 4 — Services LLM existants (à étendre)

| Service | Function Calling natif | Adaptation V2 nécessaire |
|---------|----------------------|--------------------------|
| `openAIService.ts` | ✅ Natif | Aucune (passe `Tool[]` standardisé) |
| `anthropicService.ts` | ✅ Natif | Aucune |
| `geminiService.ts` | ✅ Natif | Aucune |
| `lmStudioService.ts` | ⚠️ Selon modèle | **Adapter** via `FunctionCallingPromptBuilder` |
| `localLLMService.ts` | ❌ Non | **Adapter** via `FunctionCallingPromptBuilder` + parser |

### Catégorie 5 — Infrastructure Backend existante

| Élément | État actuel | Utilisation V2 |
|---------|-------------|----------------|
| Docker Compose | Existant (`backend/docker/`) | **Étendre** : service `sandbox-python` + réseau `sandbox-net` |
| MongoDB + Mongoose | Opérationnel | **Étendre** : nouvelle collection `user_functions` |
| WebSocket (`websocket/`) | Opérationnel | **Réutiliser** pour streaming logs sandbox |
| Routes Express (`routes/`) | Pattern RESTful mature | **Ajouter** `functions.routes.ts`, `sandbox.routes.ts` |

---

## DESIGN PATTERNS RETENUS

### Pattern Central : Registre Centralisé + Stratégie d'Exécution

```
                    ┌─────────────────────────────────┐
                    │     FunctionRegistry (Singleton) │
                    │  Source de Vérité Unique         │
                    │  - Fonctions natives (seed BDD)  │
                    │  - Fonctions custom (par user)   │
                    └────────────┬────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
    ┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
    │  Phil/Library   │ │ Archi/Proto  │ │  Bos/Workflow    │
    │  (Gestion)      │ │  (Sélection) │ │  (Exécution)     │
    └─────────────────┘ └──────────────┘ └──────────────────┘
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 ▼
                    ┌─────────────────────────────────┐
                    │     ToolExecutor (Strategy)      │
                    │  route() → selon type :          │
                    │  - TypeScript → IsolatedVM       │
                    │  - Python native → subprocess    │
                    │  - Python custom → vérif path    │
                    │  - LLM natif → provider API      │
                    │  - LLM local → PromptBuilder     │
                    └─────────────────────────────────┘
```

**Patterns GoF utilisés :**
- **Registry** : `FunctionRegistry` — inventaire unique de toutes les fonctions
- **Strategy** : `IToolExecutor` — routing transparent TypeScript/Python/LLM
- **Factory** : `SandboxFactory` — création Docker ou IsolatedVM selon langage
- **Observer** : SSE/WebSocket pour streaming logs sandbox
- **Decorator** : `SecurityGuard` — wrapping de tout accès filesystem
- **Command** : `ToolCall` — encapsulation d'un appel de fonction pour persistance BDD

---

## ZONE 1 — FONDATIONS (Jalons J1, J2)

---

### JALON J1 — Nouveau Modèle BDD `UserFunction` + Migration Schémas Existants

**Objectif** : Créer la collection `user_functions` et adapter les schémas existants sans casser les données.

**Analyse de risque / Régression** :
- `AgentPrototype.tools` et `AgentInstance.tools` passent de `[Mixed]` à `[ObjectId → user_functions]`
- Migration rétrocompatible obligatoire : les enregistrements existants (`[Mixed]` legacy) sont tolérés pendant la phase de transition via un champ `legacyTools?: object[]`
- Le frontend lit encore les `legacyTools` si `tools` est vide → zéro casse

#### J1.1 — Nouveau modèle `UserFunction`

**Créer** : `backend/src/models/UserFunction.model.ts`

```typescript
import mongoose, { Document, Schema } from 'mongoose';

export type FunctionLanguage = 'typescript' | 'python';
export type FunctionOrigin = 'native' | 'custom';

export interface IUserFunction extends Document {
  // Identification
  name: string;                          // Nom technique (snake_case ou camelCase)
  displayName?: string;                  // Nom affichable (optionnel)
  description: string;
  language: FunctionLanguage;
  origin: FunctionOrigin;                // 'native' = readonly, 'custom' = éditable
  tags: string[];

  // Scoping
  userId?: mongoose.Types.ObjectId;      // null si 'native' (partagé tous users)
  workflowId?: mongoose.Types.ObjectId;  // null si scopé globalement à l'user

  // Schémas I/O
  inputSchema: object;                   // JSON Schema v7
  outputSchema: object;                  // JSON Schema v7

  // Code source
  codePath?: string;                     // Chemin relatif depuis WORKSPACE_ROOT
  codeInline?: string;                   // Code inline (petites fonctions < 2KB)

  // État
  isEnabled: boolean;                    // Toggle activation (visibilité dans prototypage)
  isReadonly: boolean;                   // true pour les natifs

  // Métadonnées
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
```

**Index à créer :**
```
{ userId: 1, workflowId: 1, isEnabled: 1 }   → Requête principale Phil/Library
{ origin: 1, isEnabled: 1 }                   → Fonctions natives actives
{ name: 1, userId: 1 }                        → Unicité du nom par user
```

#### J1.2 — Extension `AgentPrototype` (rétrocompatible)

Dans `AgentPrototype.model.ts`, remplacer :
```typescript
tools?: object[];
```
par :
```typescript
tools?: mongoose.Types.ObjectId[];    // Références vers user_functions
legacyTools?: object[];               // Ancien format conservé pendant migration
```

**Même pattern pour `AgentInstance.model.ts`**.

#### J1.3 — Extension `UserSettings` (chemin fonctions par workflow)

Dans `UserSettings.model.ts`, ajouter dans le schéma :
```typescript
// Chemins filesystem des fonctions custom par workflow
functionPaths?: {
  workflowId: string;
  pythonPath: string;   // ex: "users/{userId}/{workflowId}/functions"
  tsPath: string;       // ex: "users_functions/{userId}/{workflowId}"
}[];
```

**Schéma Mongoose à ajouter** :
```typescript
functionPaths: [{
  workflowId: { type: String, required: true },
  pythonPath: { type: String, required: true },
  tsPath: { type: String, required: true },
  _id: false
}]
```

**Design Pattern SOLID : Open/Closed** — `UserSettings` s'ouvre à l'extension sans modifier les champs existants.

#### J1.4 — Migration Script

**Créer** : `backend/src/migrations/004_tools_v2_function_registry.ts`

```typescript
/**
 * Migration 004 — Tools V2
 * Direction : UP
 *
 * 1. Crée la collection user_functions
 * 2. Seed des 11 fonctions natives (origin: 'native', userId: null)
 * 3. Migre les agent_prototypes.tools vers legacyTools (zero data loss)
 * 4. Crée les index nécessaires
 * Direction : DOWN (rollback)
 * 1. Drop la collection user_functions
 * 2. Restaure agent_prototypes.tools from legacyTools
 */
```

**Risque zéro** : le `DOWN` garantit la réversibilité complète.

#### J1.5 — Seed des 11 Fonctions Natives

**Créer** : `backend/src/seeds/nativeFunctions.seed.ts`

Les 11 fonctions natives provenant de `plan-fonctions-personnalisees-partie2.md` sont seedées avec `origin: 'native'`, `isReadonly: true`, `userId: null`, `isEnabled: true` par défaut. Leurs schémas input/output sont stockés inline dans le seed.

Fonctions à seeder :
```
F01: agent_py        — Lancement sous-agent
F02: bash_py         — Exécution shell (isEnabled: false par défaut, risque élevé)
F03: edit_py         — Édition fichier
F04: ls_py           — Listage répertoire
F05: multi_edit_py   — Éditions multiples
F06: read_py         — Lecture fichier
F07: todo_read_py    — Lecture TodoList
F08: todo_write_py   — Écriture TodoList
F09: web_fetch_py    — Récupération page web
F10: web_search_py   — Recherche web (déjà whitelist existante)
F11: write_py        — Création/écriture fichier
```

**Note sécurité spécifique à F02 (`bash_py`)** : désactivée par défaut, nécessite consentement explicite de l'utilisateur au premier usage. Doit toujours passer par le sandbox Docker.

---

### JALON J2 — API REST Backend `/api/functions` + `/api/functions/sandbox`

**Objectif** : Exposer les CRUD fonctions et le service sandbox via Express.

#### J2.1 — Route et Controller Functions

**Créer** : `backend/src/routes/functions.routes.ts`

```
GET    /api/functions                    → Liste (filtrée par userId + workflowId)
GET    /api/functions/:id                → Détail d'une fonction
POST   /api/functions                    → Créer une fonction custom
PATCH  /api/functions/:id                → Modifier (custom seulement)
DELETE /api/functions/:id                → Supprimer (custom seulement)
PATCH  /api/functions/:id/activation     → Toggle isEnabled (natif + custom)
POST   /api/functions/:id/duplicate      → Dupliquer (crée une copie custom)
```

**Créer** : `backend/src/controllers/function.controller.ts`

Middleware de sécurité obligatoire sur **toutes** les routes :
- `requireAuth` — token JWT valide
- `ownershipGuard` — pour PATCH/DELETE : `fn.userId === req.user.id` OU `fn.origin === 'native'` interdit

#### J2.2 — Service Functions

**Créer** : `backend/src/services/function.service.ts`

Méthodes :
```typescript
listFunctions(userId, workflowId?, filters?): Promise<IUserFunction[]>
getFunctionById(id, userId): Promise<IUserFunction>
createFunction(dto, userId, workflowId): Promise<IUserFunction>
updateFunction(id, dto, userId): Promise<IUserFunction>
deleteFunction(id, userId): Promise<void>
toggleActivation(id, userId, enabled): Promise<IUserFunction>
duplicateFunction(id, userId, workflowId): Promise<IUserFunction>
```

**Pattern Responsabilité Unique (S)** : le service ne fait que la logique métier, le controller gère HTTP, le modèle gère la persistance.

#### J2.3 — Route Sandbox

**Créer** : `backend/src/routes/sandbox.routes.ts`

```
POST /api/functions/sandbox/run          → Exécution sandbox (Python Docker ou TS IsolatedVM)
GET  /api/functions/sandbox/status/:jobId → Statut d'un job sandbox
```

#### J2.4 — SandboxService

**Créer** : `backend/src/functions/sandbox/sandbox.service.ts`

Implémentation conforme à la spec de `plan-fonctions-personnalisees-partie1.md §2.3.4` :
- Python → Docker éphémère (`app-sandbox-python:3.12`)
- TypeScript → `isolated-vm` (pas de Docker, 50ms de latency)
- Logs streamés via WebSocket existant
- Timeout 15s, RAM 256MB, CPU 0.5 core
- Nettoyage automatique container après exécution

**Fichiers Docker à créer** :
- `backend/Dockerfile.sandbox-python` — image Python 3.12 minimale
- `backend/docker-compose.yml` — ajouter service `sandbox-python` + network `sandbox-net`

#### J2.5 — Extension `pythonExecutor.ts` existant

Le `pythonExecutor.ts` actuel utilise une whitelist statique. En V2 :
- Conserver la whitelist pour les fonctions natives
- Ajouter une méthode `executeCustomPythonFunction(fn: IUserFunction, args, context)` qui :
  1. Vérifie que `codePath` est dans `WORKSPACE_ROOT/python/users/{userId}/`
  2. Injecte le `FunctionContext` via variables d'environnement
  3. Exécute via subprocess

**Aucune modification du comportement existant** → zéro régression.

---

## ZONE 2 — PAGE PHIL/FUNCTIONS (Jalons J3, J4)

---

### JALON J3 — Page Phil/Functions : Onglet Bibliothèque

**Objectif** : Créer la page `PhilFunctionsPage.tsx` avec l'onglet Bibliothèque complet.

#### J3.1 — Architecture des Composants (Atomic Design)

```
PhilFunctionsPage.tsx          ← Page principale (remplace PhilDataPage pour /phil/functions)
├── FunctionLibraryTab.tsx     ← Onglet 1 : Bibliothèque
│   ├── FunctionSearchBar.tsx  ← Barre de recherche + filtres
│   ├── FunctionCard.tsx       ← Carte d'une fonction (expandable)
│   │   ├── FunctionBadges.tsx ← Badges : Natif/Custom, TypeScript/Python, Tags
│   │   ├── FunctionActions.tsx← Boutons : Voir, Modifier, Dupliquer, Supprimer
│   │   └── FunctionToggle.tsx ← Toggle Activée/Désactivée
│   └── FunctionPagination.tsx ← Pagination
└── FunctionEditorTab.tsx      ← Onglet 2 : Éditeur (voir J4)
```

#### J3.2 — Spécifications `FunctionCard.tsx`

Structure visuelle (conforme wireframe `plan-fonctions-personnalisees-partie1.md §2.1.1`) :

```tsx
// Couleur dominante : cyan-500 (couleur robot Phil)
// Badge origine : "Natif" → bg-gray-500/20, "Custom" → bg-cyan-500/20
// Badge langage : "TypeScript" → bg-blue-500/20, "Python" → bg-yellow-500/20
// Indicateur activation : point vert (isEnabled) ou gris
// Expansion : chevron pour voir inputSchema + outputSchema + code (readonly)
```

Actions selon `origin` :
```tsx
origin === 'native'  → [Voir] [Dupliquer] + Toggle
origin === 'custom'  → [Voir] [Modifier] [Dupliquer] [Supprimer] + Toggle
```

#### J3.3 — Store Zustand pour Functions

**Créer** : `stores/useFunctionStore.ts`

```typescript
interface FunctionStore {
  functions: IUserFunction[];
  isLoading: boolean;
  
  // Actions
  fetchFunctions(workflowId?: string): Promise<void>;
  toggleActivation(id: string): Promise<void>;
  deleteFunction(id: string): Promise<void>;
  duplicateFunction(id: string): Promise<IUserFunction>;
  
  // Sélecteurs
  getEnabledFunctions(): IUserFunction[];
  getFunctionById(id: string): IUserFunction | undefined;
}
```

**Pattern** : Zustand (cohérent avec `useDesignStore`, `useRuntimeStore` existants).

#### J3.4 — Hook `useFunctions`

**Créer** : `hooks/useFunctions.ts`

Bridge entre le store et les composants. Inclut la gestion des notifications (réutiliser `useNotifications` existant).

#### J3.5 — Intégration dans RobotPageRouter

Dans `RobotPageRouter.tsx`, ajouter le cas `/phil/functions` :

```tsx
case '/phil/functions':
  return <PhilFunctionsPage llmConfigs={llmConfigs} workflowId={currentWorkflowId} />;
```

**Aucune autre modification dans le router** → zéro régression.

---

### JALON J4 — Page Phil/Functions : Onglet Éditeur + Sandbox + Agent Codeur

**Objectif** : Implémenter l'onglet Éditeur avec Monaco Editor, sandbox d'exécution, et l'agent codeur IA.

#### J4.1 — Onglet Éditeur : Formulaire + Monaco Editor

**Créer** : `components/PhilFunctionsPage/FunctionEditorTab.tsx`

Champs du formulaire (conforme spec Partie 1 §2.2) :
```
nom (requis) | langage (TypeScript/Python) sélecteur
description (requis)
tags (multi-select, optionnel)
inputSchema (Monaco Editor JSON) | outputSchema (Monaco Editor JSON)
Code Editor principal (Monaco, TypeScript ou Python)
Console d'Exécution (voir J4.3)
```

**Monaco Editor** — configuration :
```typescript
// Installer : @monaco-editor/react
// TypeScript : inject FunctionContext types via addExtraLib()
// Python : Pyflakes via WebAssembly (pas de round-trip serveur)
// Template automatique injecté à la création selon langage
// Raccourcis : Ctrl+S → Save, Ctrl+Enter → Execute
```

**Templates de code** : utiliser exactement les templates de `plan-fonctions-personnalisees-partie1.md §2.2.2`.

#### J4.2 — Gestion des Librairies (Import)

Chaque fonction peut déclarer des dépendances :
```typescript
// Dans IUserFunction (extension du modèle J1) :
dependencies?: {
  python?: string[];    // ex: ["httpx==0.27.0", "pandas>=2.0"]
  npm?: string[];       // ex: ["lodash@4.17.21", "axios@1.6.0"]
};
```

À l'exécution sur workflow, le `ToolExecutor` vérifie si les dépendances sont installées dans le workspace utilisateur avant d'appeler la fonction.

**Backend — Installation sandbox** : au moment du test en sandbox, le `SandboxService` installe les dépendances dans l'image Docker éphémère (image pré-builddée + couche de cache pip/npm).

#### J4.3 — Console d'Exécution (Sandbox)

Conforme `plan-fonctions-personnalisees-partie1.md §2.3` :

```
POST /api/functions/sandbox/run → { jobId }
WebSocket subscribe "sandbox:logs:{jobId}" → stream des logs
WebSocket event "sandbox:result:{jobId}" → résultat final
```

**Composant** `SandboxConsole.tsx` :
- Affiche les logs en temps réel (couleurs INFO/WARN/ERROR)
- Affiche le résultat JSON formaté (syntaxe colorée, bouton copier)
- Indicateur de statut : 🟡 En cours, ✅ Succès, ❌ Erreur
- Durée d'exécution affichée
- Bouton [Effacer] pour réinitialiser

#### J4.4 — Agent Codeur Intégré

L'agent codeur est une instance du système existant de chat LLM (réutiliser la mécanique de `V2AgentNode.tsx`).

**Composant** `CodingAgentPanel.tsx` (panel droit, s'ouvre sur demande) :

```
Configuration agent codeur :
  - Sélecteur LLM (parmi les llmConfigs configurés par l'user)
  - Sélecteur Spécialité : TypeScript | Python
  - System prompt par défaut (expert codeur TS ou Python) — modifiable
  - [Modifier les paramètres] [Sauvegarder paramètres]

Interface chat :
  - Zone de conversation avec l'agent
  - L'agent peut générer du code → bouton "Insérer dans l'éditeur"
  - Contexte injecté automatiquement : inputSchema + outputSchema de la fonction courante
```

**System prompts par défaut** (à stocker dans `i18n/` ou constantes) :
```
TypeScript : "Tu es un expert TypeScript senior. Tu dois créer une fonction async TypeScript 
qui respecte exactement l'interface FunctionContext et FunctionResult définie..."
Python : "Tu es un expert Python 3.12 senior. Tu dois créer une fonction async Python 
qui respecte exactement la signature (params: dict, context: FunctionContext) -> FunctionResult..."
```

**Stockage préférences agent codeur** : dans `UserSettings.preferences` (extension mineure du schéma).

---

## ZONE 3 — INTÉGRATION ARCHI + BOS (Jalons J5, J6)

---

### JALON J5 — Modification Onglet "Fonctions" dans Archi Prototypage

**Objectif** : Remplacer l'onglet "Fonctions" de création inline par un sélecteur depuis `FunctionRegistry`.

#### J5.1 — Analyse de l'existant (AgentFormModal.tsx)

Actuellement (lignes 30-539) : l'onglet Fonctions crée des `Tool` objects inline avec `name`, `description`, `parameters` via un formulaire JSON.

**Ce qui change** :
- Le formulaire inline disparaît
- Il est remplacé par `FunctionSelector` : sélecteur multi-select depuis `FunctionRegistry`
- Les fonctions activées dans Phil/Library apparaissent ici

#### J5.2 — Composant `FunctionSelector.tsx`

**Créer** : `components/shared/FunctionSelector.tsx` (composant partagé Archi + Bos)

```tsx
interface FunctionSelectorProps {
  selectedFunctionIds: string[];
  onChange: (ids: string[]) => void;
  workflowId?: string;
  readonlyMode?: boolean; // Pour affichage dans le formulaire (non édition)
}
```

Affichage de chaque fonction sélectionnable :
```
[✓] nom_fonction   [TypeScript/Python]  description courte
    ▼ (expandable) → inputSchema, outputSchema, tags
```

**Filtrage** : uniquement les fonctions `isEnabled: true` du workflow courant + natives actives.

#### J5.3 — Modification Minimale de `AgentFormModal.tsx`

Seul l'onglet "Fonctions" est touché. Remplacer le JSX de cet onglet :

**Avant** : formulaire inline création Tool
**Après** : `<FunctionSelector selectedFunctionIds={tools} onChange={setTools} workflowId={workflowId} />`

La prop `tools` passe de `Tool[]` à `string[]` (tableau d'IDs de fonctions).

**Point de vigilance anti-régression** :
- À la sauvegarde, envoyer `tools: string[]` (IDs) vers le backend
- Le backend normalise : si l'ID existe dans `user_functions` → référence, sinon → `legacyTools`
- Les agents existants en base ont `legacyTools` → affichage en mode "lecture seule legacy" dans le sélecteur

#### J5.4 — Même modification pour `AgentConfigurationModal.tsx`

Pattern identique : onglet "fonctions" de la modal configuration instance → `FunctionSelector`.

---

### JALON J6 — Modification Onglet "Fonctions" sur la Carte Workflow (Bos)

**Objectif** : Dans `AgentConfigurationModal.tsx` (accessible via "Configuration de l'instance" sur la carte workflow), l'onglet "fonctions" utilise `FunctionSelector` avec possibilité de remplacer/override les fonctions héritées du prototype.

#### J6.1 — Logique d'Héritage Prototype → Instance

```typescript
// Règle d'héritage dans AgentInstance :
interface FunctionInheritanceConfig {
  inheritFromPrototype: boolean;         // true par défaut
  overrideFunctionIds?: string[];        // Si inheritFromPrototype = false
}
```

Comportement UX :
```
[ Hériter du prototype ● ]    → affiche fonctions du proto (readonly)
   ↓ désactiver toggle
[ Personnaliser les fonctions ] → FunctionSelector éditable
```

**Extension mineure du modèle `AgentInstance`** (rétrocompatible) :
- Ajouter `functionInheritance: FunctionInheritanceConfig`
- Default : `{ inheritFromPrototype: true }`

#### J6.2 — Résolution des Fonctions à l'Exécution

Dans `ToolExecutor` (voir J7), la résolution des fonctions actives pour un agent suit cette logique :

```typescript
function resolveFunctions(instance: AgentInstance, prototype: AgentPrototype): IUserFunction[] {
  if (instance.functionInheritance?.inheritFromPrototype !== false) {
    return registryService.getFunctionsByIds(prototype.tools ?? []);
  }
  return registryService.getFunctionsByIds(instance.functionInheritance.overrideFunctionIds ?? []);
}
```

---

## ZONE 4 — ENGINE D'EXÉCUTION (Jalons J7, J8, J9)

---

### JALON J7 — Implémentation des 11 Fonctions Natives Python

**Objectif** : Créer l'infrastructure Python backend et implémenter les 11 fonctions natives.

#### J7.1 — Structure Python Backend

Créer l'arborescence complète définie dans `plan-fonctions-personnalisees-partie2.md §P2.2` :

```
backend/python/
├── app/
│   ├── core/
│   │   ├── context.py         ← FunctionContext + FunctionResult (spec P2.3.1)
│   │   ├── workspace.py       ← WorkspaceManager (isolation filesystem)
│   │   ├── security.py        ← SecurityGuard (validation chemins)
│   │   └── database.py        ← Connexion MongoDB Motor async
│   ├── native/
│   │   ├── registry.py        ← NativeFunctionRegistry
│   │   ├── agent/agent_py.py
│   │   ├── bash/bash_py.py    (+ command_validator.py)
│   │   ├── filesystem/        (edit, ls, multi_edit, read, write)
│   │   ├── todo/              (todo_read, todo_write)
│   │   └── web/               (web_fetch, web_search)
│   ├── runner.py              ← Point d'entrée subprocess
│   └── api.py                 ← FastAPI sidecar (optionnel V2)
└── requirements.txt
```

#### J7.2 — Implémentation par Domaine (priorité et risque)

**Domaine Filesystem (F03, F04, F05, F06, F11) — Priorité HAUTE, Risque MOYEN**

Toutes les opérations passent par `WorkspaceManager.resolve_path()` qui garantit :
```python
def resolve_path(self, rel_path: str, user_id: str) -> Path:
    base = WORKSPACE_ROOT / "users" / user_id / "workspace"
    resolved = (base / rel_path).resolve()
    if not str(resolved).startswith(str(base)):
        raise SecurityError(f"PATH_TRAVERSAL: {rel_path}")
    return resolved
```

**Domaine Web (F09, F10) — Priorité HAUTE, Risque FAIBLE-MOYEN**

- `web_fetch_py` : utilise `httpx`, validation URL contre liste SSRF (pas d'IPs privées 10.x, 172.16.x, 192.168.x, localhost)
- `web_search_py` : wrapping du script existant `search_web_py` dans la nouvelle architecture

**Domaine Données (F07, F08) — Priorité MOYENNE, Risque FAIBLE**

- `todo_read_py` / `todo_write_py` : collections MongoDB `todos` + index `{ userId, agentId }`
- Cache JSON local en backup

**Domaine Système (F02 - bash_py) — Priorité BASSE, Risque ÉLEVÉ**

Implémentation obligatoirement dans Docker sandbox uniquement :
```python
# bash_py.py
# TOUJOURS exécuté en container Docker isolé (jamais en subprocess direct)
# Blacklist de commandes : rm -rf /, mkfs, dd, wget, curl (sauf whitelist)
# Validation via command_validator.py avant exécution
# Timeout : 30s max
```

**Domaine Orchestration (F01 - agent_py) — Priorité BASSE, Risque MOYEN**

Circuit breaker : max 3 niveaux de profondeur (`context.depth < 3`). Budget tokens décroissant.

#### J7.3 — Runner Python (`runner.py`)

Point d'entrée unique pour tous les appels subprocess depuis Node.js :

```python
# Interface : python3 runner.py <function_name> '<json_args>'
# Output : JSON sur stdout
# Errors : JSON sur stderr + exit code 1
```

Le `runner.py` :
1. Parse le nom de la fonction et les args
2. Construit le `FunctionContext` depuis vars d'environnement
3. Route vers la bonne implémentation (native ou custom)
4. Sérialise `FunctionResult.to_dict()` vers stdout
5. Catch toutes les exceptions → `FunctionResult.fail()` → stdout

#### J7.4 — Extension `pythonExecutor.ts` (Node.js)

Ajouter une méthode `executeFunctionById(fnId, args, userId, agentId)` qui :
1. Charge `IUserFunction` depuis BDD
2. Construit l'environnement de contexte
3. Appelle `runner.py` (natif) ou le chemin custom via subprocess
4. Retourne `FunctionResult`

---

### JALON J8 — Couche d'Abstraction LLMs Locaux (Function Calling Universel)

**Objectif** : Permettre aux LLMs locaux (LMStudio, Jan, Ollama) d'utiliser les fonctions Tools V2 avec la même interface que les LLMs cloud.

**Référence technique** : `plan-local-llm-function-calling.md` — implémenter les Patterns 1, 2 et 3.

#### J8.1 — Interface Commune `ILLMAdapter`

**Créer** : `services/adapters/ILLMAdapter.ts`

```typescript
export interface ILLMAdapter {
  readonly supportsNativeToolCalling: boolean;
  readonly provider: LLMProvider;
  
  complete(request: LLMRequest): Promise<LLMResponse>;
}

export interface LLMRequest {
  messages: ChatMessage[];
  functions: IUserFunction[];
  systemPrompt?: string;
  outputConfig?: OutputConfig;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ParsedToolCall[];   // Présent si le LLM a demandé un tool call
  finishReason: 'stop' | 'tool_calls' | 'length';
}
```

#### J8.2 — Adaptateurs par Provider

**Créer** :
- `services/adapters/AnthropicAdapter.ts` — native tool calling, passe `Tool[]` directement
- `services/adapters/OpenAIAdapter.ts` — native tool calling
- `services/adapters/GeminiAdapter.ts` — native tool calling  
- `services/adapters/LMStudioAdapter.ts` — **émulé** via `FunctionCallingPromptBuilder`
- `services/adapters/LocalLLMAdapter.ts` — **émulé** avec Pattern ReAct

**LMStudioAdapter** — implémentation détaillée :

```typescript
export class LMStudioAdapter implements ILLMAdapter {
  readonly supportsNativeToolCalling = false;
  
  async complete(request: LLMRequest): Promise<LLMResponse> {
    // 1. Injecter les définitions de fonctions dans le system prompt
    const enrichedSystem = request.systemPrompt + '\n\n' +
      FunctionCallingPromptBuilder.build(request.functions.map(toFunctionDef));
    
    // 2. Appeler le LLM (via lmStudioService.generateContentStream existant)
    const rawResponse = await this.callLMStudio(enrichedSystem, request.messages);
    
    // 3. Parser la réponse pour extraire les tool calls
    const parseResult = ToolCallParser.parse(rawResponse);
    
    return {
      content: parseResult.textBefore,
      toolCalls: parseResult.toolCalls,
      finishReason: parseResult.hasToolCalls ? 'tool_calls' : 'stop'
    };
  }
}
```

#### J8.3 — `FunctionCallingPromptBuilder`

**Créer** : `services/llm/FunctionCallingPromptBuilder.ts`

Implémentation conforme `plan-local-llm-function-calling.md §3.2` :
- Construit un system prompt qui enseigne les `<tool_call>` au LLM
- Génère des exemples depuis les JSON Schemas des fonctions
- Supporte fr/en

#### J8.4 — `ToolCallParser`

**Créer** : `services/llm/ToolCallParser.ts`

Implémentation conforme `plan-local-llm-function-calling.md §3.3` :
- 4 stratégies de parsing par ordre de priorité (XML tags → Markdown fences → Function syntax → JSON heuristique)
- `repairJSON()` pour JSON malformé courant
- Score de confiance (`confidence: number`) pour chaque parse

#### J8.5 — `AgentLoop` (Cycle Multi-turn)

**Créer** : `services/llm/AgentLoop.ts`

Implémentation conforme `plan-local-llm-function-calling.md §3.4` :
- Max 10 itérations (circuit breaker)
- Appel LLM → parse tool calls → exécution → renvoyer résultat → prochain tour
- Compatible avec tous les adaptateurs (natifs et émulés)

#### J8.6 — Integration dans `V2AgentNode.tsx`

Remplacer l'appel direct `llmService.generateContentStream()` par :
```typescript
const adapter = AdapterFactory.create(provider, llmConfigs);
const loop = new AgentLoop(adapter, toolExecutor, functionRegistry);
const result = await loop.run(userMessage, agentContext, onEvent);
```

**Anti-régression** : `AdapterFactory` retourne l'adaptateur natif pour OpenAI/Anthropic/Gemini → zéro changement de comportement pour ces providers.

#### J8.7 — Matrice de Compatibilité Grammar-Constrained Decoding

Pour les LLMs Ollama qui supportent la grammar-constrained decoding (Pattern 2) :

**Créer** : `services/llm/grammar/GBNFBuilder.ts`

Implémentation conforme `plan-local-llm-function-calling.md §4` :
- Détection automatique du support `grammar` dans l'API Ollama (`/api/tags` metadata)
- Si supporté → injecter GBNF JSON Schema dans la requête
- Si non supporté → fallback Pattern 1 (Prompt Engineering)

---

### JALON J9 — Affichage Tool Calls dans le Chat (BDD + UI)

**Objectif** : Améliorer l'affichage des tool calls dans `V2AgentNode.tsx` avec expandable blocks, persistance et réhydratation.

#### J9.1 — Composant `ToolCallBlock.tsx`

**Créer** : `components/workflow/ToolCallBlock.tsx`

Conforme spécification `TOOLS_V2.md §4` :

```tsx
interface ToolCallBlockProps {
  toolCall: ToolCallRecord;
  defaultExpanded?: boolean;
}

// Rendu :
// 🔧 [Nom de la fonction en gras cyan-400]          [▼ Détails]
// ────────────────────────────────── (si expandé) ──────────────
// Input  : [Code JSON formaté syntaxe colorée] [📋 Copier]
// Output : [Code JSON formaté] [✅ Succès | ❌ Erreur]
// ⏱ 234ms
```

**Indicateurs visuels** :
- Icône outil `🔧` ou icône SVG `ToolIcon` (déjà dans `V2AgentNode.tsx`)
- Nom en `text-cyan-400 font-bold`
- État replié par défaut (évite surcharge visuelle)
- Bouton copier JSON (clipboard API)
- Horodatage exécution

#### J9.2 — Extension du Type `ChatMessage`

Dans `types.ts`, le type `ChatMessage` avec `sender: 'tool'` est enrichi :

```typescript
export interface ToolCallRecord {
  id: string;                    // UUID unique
  functionId: string;            // Référence vers user_functions._id
  functionName: string;          // Dénormalisé pour affichage
  arguments: object;             // Input JSON
  result: object;                // Output JSON
  status: 'success' | 'error';
  durationMs?: number;
  timestamp: Date;
  // Balises BDD pour réhydratation :
  _toolCallMeta?: {
    functionOrigin: FunctionOrigin;
    functionLanguage: FunctionLanguage;
    sandboxed: boolean;
  };
}
```

#### J9.3 — Persistance et Réhydratation (BDD)

Dans `AgentInstance.model.ts`, les messages avec `type: 'tool'` incluent maintenant `toolCallRecord: ToolCallRecord`.

Les balises `_toolCallMeta` (invisibles utilisateur) permettent de recharger les données d'affichage identiquement après déconnexion/reconnexion.

**Impact journal** : `journal.service.ts` doit persister les `ToolCallRecord` en même temps que les messages chat. Aucune interface publique ne change → zéro régression.

#### J9.4 — Intégration dans `V2AgentNode.tsx`

Dans la fonction de rendu des messages, détecter `sender === 'tool'` :
```tsx
{message.sender === 'tool' && message.toolCallRecord && (
  <ToolCallBlock 
    toolCall={message.toolCallRecord}
    defaultExpanded={false}
  />
)}
```

---

## PLAN D'IMPLÉMENTATION — SÉQUENCEMENT ET DÉPENDANCES

```
J1 (BDD Fondations)
│
└── J2 (API Backend)
    │
    ├── J3 (Phil/Library)──────────────── J5 (Archi/Fonctions)
    │                                           │
    └── J4 (Phil/Éditeur)──────────────── J6 (Bos/Instance)
                                               │
                          J7 (11 fonctions natives)
                          │
                          J8 (LLMs locaux)
                          │
                          J9 (ToolCall UI + BDD)
```

**Jalons parallélisables** :
- J3 et J4 peuvent être développés en parallèle (même page, onglets différents)
- J5 et J6 peuvent être développés en parallèle (même composant FunctionSelector)
- J7, J8 et J9 peuvent être développés en parallèle après J2

---

## RÉPARTITION PAR AGENT CODEUR (Reco)

| Agent | Jalons | Expertise requise |
|-------|--------|------------------|
| **Agent Backend Senior** | J1, J2 | Node.js, Mongoose, MongoDB, Docker |
| **Agent Python Senior** | J7 | Python 3.12, FastAPI, sécurité sandbox |
| **Agent Frontend Senior** | J3, J4 | React, TypeScript, Zustand, Monaco Editor |
| **Agent Full-Stack** | J5, J6 | React + Node.js, pattern d'intégration |
| **Agent LLM/Infra** | J8 | LLM services, prompt engineering, parsers |
| **Agent Frontend UI** | J9 | React, UX, CSS animations |

---

## CHECKLIST ANTI-RÉGRESSION

### Pour chaque Jalon, vérifier avant merge :

**J1 (BDD)**
- [ ] Les prototypes existants ont toujours leurs fonctions (via `legacyTools`)
- [ ] `AgentPrototype.tools` accepte `undefined` (backward compat)
- [ ] Migration rollback testé

**J2 (API)**
- [ ] `GET /api/functions` filtre correctement par `userId` (pas de fuite cross-user)
- [ ] `PATCH /api/functions/:id` refuse les natifs (401)
- [ ] `DELETE /api/functions/:id` refuse les natifs (401)
- [ ] Sandbox timeout fonctionne correctement (kill container à 15s)

**J3 (Phil/Library)**
- [ ] La page `/phil/files` (PhilDataPage) continue de fonctionner
- [ ] Le toggle d'une fonction met à jour sans reload de page
- [ ] La pagination est fonctionnelle

**J4 (Phil/Éditeur)**
- [ ] Monaco Editor se charge correctement (lazy load pour performance)
- [ ] Le sandbox Python ne peut pas accéder au filesystem de l'host
- [ ] L'agent codeur utilise bien les llmConfigs de l'utilisateur connecté

**J5 (Archi/Fonctions)**
- [ ] Les prototypes existants s'affichent toujours dans Archi (legacyTools en lecture seule)
- [ ] La création d'un nouveau prototype avec des fonctions fonctionne
- [ ] La modification d'un prototype existant ne perd pas ses données

**J6 (Bos/Instance)**
- [ ] Un agent hérite par défaut des fonctions de son prototype
- [ ] L'override fonctionne et est sauvegardé en BDD
- [ ] L'agent fonctionne toujours sur le workflow sans fonctions sélectionnées

**J7 (Fonctions natives)**
- [ ] `web_search_py` existante continue de fonctionner (rétrocompat whitelist)
- [ ] Les fonctions filesystem valident les paths (pas de path traversal)
- [ ] `bash_py` est désactivée par défaut et nécessite confirmation

**J8 (LLMs locaux)**
- [ ] OpenAI/Anthropic/Gemini continuent d'utiliser le function calling natif
- [ ] LMStudio sans model compatible → graceful degradation (pas de crash)
- [ ] Le `AgentLoop` respecte le max 10 itérations

**J9 (ToolCall UI)**
- [ ] Les messages existants sans `toolCallRecord` s'affichent normalement
- [ ] La réhydratation des tool calls fonctionne après reconnexion
- [ ] Le bouton copier fonctionne (HTTPS + clipboard API)

---

## DONNÉES TECHNIQUES COMPLÉMENTAIRES

### Conventions de Nommage (à respecter)

| Type | Convention | Exemple |
|------|-----------|---------|
| Fonction TypeScript custom | camelCase | `getWeatherForecast` |
| Fonction Python custom | snake_case + `_py` | `analyze_sentiment_py` |
| Fonction native Python | snake_case + `_py` | `web_search_py` |
| Collection MongoDB | snake_case | `user_functions` |
| Route API | kebab-case | `/api/user-functions` ou `/api/functions` |

### Variables d'Environnement Nouvelles

```env
# Backend
WORKSPACE_ROOT=/app/python/users         # Racine workspaces utilisateurs
FUNCTION_SANDBOX_TIMEOUT_MS=15000        # Timeout sandbox
FUNCTION_SANDBOX_RAM_MB=256              # RAM container Docker
DOCKER_SOCKET=/var/run/docker.sock       # Socket Docker (sandbox)
SANDBOX_PYTHON_IMAGE=app-sandbox-python:3.12

# Sécurité
FUNCTION_MAX_CODE_SIZE_KB=100            # Taille max du code source
FUNCTION_MAX_DEPS_COUNT=20               # Nombre max de dépendances
```

### Points de Sécurité Critiques (OWASP)

| Risque | Mitigation implémentée |
|--------|----------------------|
| **Path Traversal** (A01) | `WorkspaceManager.resolve_path()` — vérification `startswith(base)` |
| **Code Injection** (A03) | Sandbox Docker pour Python, `isolated-vm` pour TypeScript |
| **SSRF** (A10) | `web_fetch_py` : blocklist IPs privées + validation URL |
| **Broken Access Control** (A01) | `ownershipGuard` middleware + `userId` filtre BDD |
| **Insecure Design** (A04) | Fonctions natives `isReadonly: true` + `bash_py` désactivée par défaut |
| **Command Injection** (A03) | `command_validator.py` blacklist + whitelist dans `bash_py` |

---

## PROPOSITION DE TESTS DE NON-RÉGRESSION (TNR)

Après chaque jalon, les tests suivants doivent être validés :

**Tests Backend (Jest/Supertest)** :
```
backend/__tests__/functions/
  ├── function-crud.test.ts       ← CRUD basique + sécurité accès
  ├── function-activation.test.ts ← Toggle activation
  ├── sandbox-python.test.ts      ← Exécution sandbox Python
  ├── sandbox-typescript.test.ts  ← Exécution sandbox TypeScript
  └── tool-executor.test.ts       ← Routing TypeScript/Python/LLM
```

**Tests Frontend (Jest/RTL)** :
```
tests/
  ├── FunctionLibraryTab.test.tsx  ← Rendu liste, toggle, actions
  ├── FunctionSelector.test.tsx    ← Sélection dans modales Archi/Bos
  ├── ToolCallBlock.test.tsx       ← Affichage tool call, expand/collapse
  └── AgentLoop.test.ts            ← Cycle multi-turn LLMs locaux
```

**Tests Python** :
```
backend/python/tests/
  ├── test_workspace_security.py   ← Path traversal prevention
  ├── test_native_functions.py     ← 11 fonctions natives
  └── test_runner.py               ← Interface subprocess
```

---

*Document produit par Aether-Arch-2026 — Approuvé par Chef de Projet avant implémentation*
