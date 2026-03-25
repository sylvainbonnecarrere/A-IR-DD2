# Multi-Workflow System — Guide Complet

> **Référence finale** pour le système de gestion multi-workflow.
> Testé et validé QA le 2026-02-28.

---

## Table des Matières

1. [Vue d'Ensemble](#1-vue-densemble)
2. [Architecture](#2-architecture)
3. [Flux de Données](#3-flux-de-données)
4. [Règles Fondamentales](#4-règles-fondamentales)
5. [API Backend](#5-api-backend)
6. [Frontend — Composants Clés](#6-frontend--composants-clés)
7. [Points d'Attention pour Développeurs](#7-points-dattention-pour-développeurs)
8. [Scénarios Utilisateur](#8-scénarios-utilisateur)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Vue d'Ensemble

### Qu'est-ce qu'un Workflow ?

Un **workflow** est un espace de travail isolé contenant :
- Des **prototypes d'agents** (définitions réutilisables)
- Des **instances d'agents** (agents déployés sur le canvas)
- Des **connexions** (edges entre agents)
- Un **état de canvas** (zoom, pan, positions)

### Qui peut utiliser le multi-workflow ?

| Type d'utilisateur | Multi-workflow | Persistence |
|-------------------|----------------|-------------|
| **Guest** (non connecté) | ❌ Mono-workflow implicite | localStorage uniquement |
| **Authenticated** (connecté) | ✅ Illimité | MongoDB |

### Cycle de vie d'un Workflow

```
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐
│ CREATE  │ ───► │ SELECT  │ ───► │  USE    │ ───► │ DELETE  │
│         │      │(switch) │      │(design) │      │         │
└─────────┘      └─────────┘      └─────────┘      └─────────┘
     │                │                                  │
     │                │                                  │
     ▼                ▼                                  ▼
  isDefault=true   isActive=true                  Auto-switch
  isActive=true    Overlay jaune                  si actif
```

---

## 2. Architecture

### Collections MongoDB

| Collection | Scope | Champs clés |
|------------|-------|-------------|
| `workflows` | User | `userId`, `isActive`, `isDefault`, `canvasState` |
| `agent_prototypes` | Workflow | `userId`, `workflowId`, `robotId` |
| `agent_instances` | Workflow | `workflowId`, `prototypeId`, `position` |
| `workflow_edges` | Workflow | `workflowId`, `sourceInstanceId`, `targetInstanceId` |
| `journals` | Instance | `instanceId`, `type`, `payload` |

### Stores Zustand (Frontend)

| Store | Contenu | Reset sur Switch |
|-------|---------|------------------|
| `useDesignStore` | Prototypes, instances, nodes, edges | ✅ Oui |
| `useWorkflowStore` | Workflow actif, canvas state | ✅ Oui |
| `useRuntimeStore` | Messages, exécution, **llmConfigs** | ⚠️ Partiel |

> **CRITIQUE** : `llmConfigs` dans `useRuntimeStore` est **USER-level**, pas workflow-level. Utiliser `resetForWorkflowSwitch()` pour préserver les configs LLM !

---

## 3. Flux de Données

### 3.1 Login / Hydratation Initiale

```
User Login
    │
    ▼
GET /api/user/workspace
    │
    ├── Self-Healing: Créer workflow par défaut si inexistant
    ├── Fetch: agentPrototypes (filtrés par workflowId)
    ├── Fetch: agentInstances (filtrés par workflowId)
    ├── Fetch: edges (filtrés par workflowId)
    └── Self-Healing: Migrer prototypes orphelins (sans workflowId)
    │
    ▼
Frontend Hydration (App.tsx)
    │
    ├── resetAll() sur tous les stores
    ├── Map backend → frontend types (13 champs pour prototypes)
    ├── hydrateFromServer({ agents, instances, nodes, edges })
    ├── setAgents(hydratedPrototypes) [React state legacy]
    └── Load journals per instance
```

### 3.2 Switch Workflow

```
User clique "Sélectionner par défaut"
    │
    ▼
BosWorkflowManagementPage
    │
    └── window.dispatchEvent('workflow:switch', { workflowId, workflowName })
    │
    ▼
App.tsx — switchToWorkflow(workflowId, workflowName)
    │
    ├── Guard: isSwitchingRef (anti-double-switch)
    ├── Guard: isHydrating (attendre fin hydratation initiale)
    ├── Guard: accessToken (utilisateur connecté)
    │
    ├── ÉTAPE 1: resetForWorkflowSwitch() — PRÉSERVE llmConfigs!
    ├── ÉTAPE 2: POST /api/workflows/:id/select
    ├── ÉTAPE 3: Map prototypes (copie exacte de l'hydratation)
    ├── ÉTAPE 4: hydrateFromServer atomique
    ├── ÉTAPE 5: Load journals
    ├── ÉTAPE 6: Build V2 nodes avec data.agent
    ├── ÉTAPE 7: Refresh liste workflows
    └── ÉTAPE 8: Dispatch 'workflow:switch:success'
    │
    ▼
WorkflowSwitchOverlay (Bos amber #F59E0B)
```

### 3.3 Delete Workflow

```
User clique "Supprimer"
    │
    ├── Si dernier workflow → Bloqué (bouton disabled)
    │
    ├── Si workflow inactif → DELETE direct
    │
    └── Si workflow actif:
        ├── DELETE le workflow
        ├── Auto-switch vers remaining[0]
        └── Dispatch 'workflow:switch' avec nouveau workflowId
```

---

## 4. Règles Fondamentales

### 4.1 Scoping par workflowId

```typescript
// ✅ CORRECT: Toute requête de données workflow-scoped DOIT filtrer par workflowId
const prototypes = await AgentPrototype.find({ userId, workflowId });
const instances = await AgentInstance.find({ workflowId });

// ❌ INTERDIT: Requête sans filtre workflow (fuite de données cross-workflow)
const prototypes = await AgentPrototype.find({ userId }); // FAUX!
```

### 4.2 Reset Stores — Le Piège llmConfigs

```typescript
// ✅ CORRECT pour switch workflow (préserve llmConfigs USER-level)
useRuntimeStore.getState().resetForWorkflowSwitch();

// ❌ INTERDIT pour switch workflow (détruit les configs LLM!)
useRuntimeStore.getState().resetAll(); // Réservé au LOGOUT uniquement!
```

### 4.3 Hydratation Atomique

```typescript
// ✅ CORRECT: Un seul appel avec toutes les données
hydrateFromServer({
  agents: hydratedPrototypes,
  agentInstances: hydratedInstances,
  nodes: [],
  edges: []
});

// ❌ INTERDIT: Appels séparés (race conditions, états partiels)
setAgents(agents);
setInstances(instances); // L'UI peut render avec état incomplet!
```

### 4.4 V2 Nodes — Champ data.agent Obligatoire

```typescript
// ✅ CORRECT: V2AgentNode exige data.agent
const v2Node: V2WorkflowNode = {
  id: `node-${instanceId}`,
  type: 'agent',
  position: { x, y },
  data: {
    robotId: RobotId.Archi,
    label: instance.name,
    agent: buildAgentFromInstance(instance), // ⭐ OBLIGATOIRE
    agentInstance: instance,
    workflowId
  }
};

// ❌ INTERDIT: Omettre data.agent (cause "Agent non trouvé")
data: { agentInstance: instance } // ERREUR!
```

---

## 5. API Backend

### Endpoints Workflow

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/workflows` | Liste tous les workflows de l'utilisateur |
| `POST` | `/api/workflows` | Créer un nouveau workflow |
| `POST` | `/api/workflows/:id/select` | Sélectionner/activer un workflow |
| `PUT` | `/api/workflows/:id` | Mettre à jour un workflow |
| `DELETE` | `/api/workflows/:id` | Supprimer un workflow |

### Response de `/select`

```json
{
  "success": true,
  "workflow": { "_id", "name", "isActive", "isDefault", "canvasState" },
  "reloadedData": {
    "agents": [...],           // AgentInstance[] transformées
    "nodes": [],               // Toujours vide (positions dans instances)
    "edges": [...],            // WorkflowEdge[]
    "agentPrototypes": [...],  // AgentPrototype[] filtrés par workflowId
    "canvasState": { "zoom", "panX", "panY" }
  }
}
```

### Invariants Backend

| Code | Règle | Vérification |
|------|-------|--------------|
| G1 | Un user a toujours ≥1 workflow | Self-healing dans `/workspace` |
| G2 | Un seul workflow `isActive:true` par user | `updateMany` + `updateOne` dans `/select` |
| G3 | Un seul workflow `isDefault:true` par user | Idem G2 |
| G4 | `isDefault` togglé dans `/select` | `updateMany({isDefault:false})` + `updateOne({isDefault:true})` |

---

## 6. Frontend — Composants Clés

### BosWorkflowManagementPage

**Chemin** : `components/BosWorkflowManagementPage.tsx`

**Responsabilités** :
- Afficher la grille de workflows
- Créer nouveau workflow
- Déclencher le switch via `workflow:switch` event
- Gérer la suppression (avec auto-switch si actif)

### WorkflowSwitchOverlay

**Chemin** : `components/WorkflowSwitchOverlay.tsx`

**Caractéristiques** :
- Couleur Bos : Amber (#F59E0B / #D97706)
- Z-index : 99999
- Animation fade-in/fade-out
- Affiche le nom du workflow cible
- Barre de progression

### App.tsx — switchToWorkflow

**Lignes** : ~633-860

**Signature** : `switchToWorkflow(workflowId: string, workflowName?: string)`

**Guards** :
- `isSwitchingRef.current` — Anti-double-switch
- `isHydrating` — Attendre fin hydratation initiale
- `accessToken` — Utilisateur authentifié requis

---

## 7. Points d'Attention pour Développeurs

### 7.1 Ajouter une Nouvelle Page Robot

```typescript
// OBLIGATOIRE: Récupérer currentWorkflowId et recharger sur switch
const MyRobotPage: React.FC = () => {
  const { isAuthenticated, accessToken } = useAuth();
  const currentWorkflowId = useWorkflowStore(state => state.getCurrentWorkflowId());
  
  useEffect(() => {
    if (!isAuthenticated || !currentWorkflowId) return;
    loadMyData(accessToken, currentWorkflowId);
  }, [isAuthenticated, currentWorkflowId]); // ⭐ Recharge sur switch
  
  return <div>...</div>;
};
```

### 7.2 Ajouter une Nouvelle Entité Workflow-Scoped

1. **Model Mongoose** : Ajouter `workflowId: ObjectId` (optionnel pour backward compat)
2. **Routes** : Filtrer par `workflowId` dans toutes les requêtes
3. **Self-Healing** : Migrer les docs orphelins vers workflow par défaut
4. **Frontend** : Passer `workflowId` dans les appels API

### 7.3 Modifier l'Hydratation

⚠️ **DANGER ZONE** — Toute modification de l'hydratation peut casser le switch workflow.

**Règle** : Le mapping dans `switchToWorkflow()` DOIT être identique à celui de l'hydratation initiale (App.tsx ~L310-329).

### 7.4 Données User-Level vs Workflow-Level

| User-Level (PRÉSERVER sur switch) | Workflow-Level (RESET sur switch) |
|-----------------------------------|-----------------------------------|
| `llmConfigs` | `agentPrototypes` |
| `userSettings` | `agentInstances` |
| `templates` | `nodes`, `edges` |
| `navigationHandler` | `nodeMessages` |

---

## 8. Scénarios Utilisateur

### Scénario 1 : Premier Login

1. User se connecte
2. Self-healing crée un workflow "Mon Workflow" par défaut
3. HydrationOverlay vert s'affiche
4. Workspace vide prêt à l'utilisation

### Scénario 2 : Créer et Switch

1. User va dans BOS → "Gérer vos workflows"
2. Clique "Créer un workflow"
3. Saisit le nom, valide
4. Nouveau workflow apparaît dans la grille
5. Clique "Sélectionner par défaut" sur le nouveau
6. Overlay Bos jaune s'affiche
7. Page rechargée avec le nouveau workflow (vide)

### Scénario 3 : Retour au Workflow Précédent

1. User switch vers workflow B (vide)
2. User va dans BOS → "Gérer vos workflows"
3. Clique "Sélectionner par défaut" sur workflow A
4. Overlay Bos jaune s'affiche
5. Prototypes, agents et journaux de A restaurés
6. Chat fonctionne (llmConfigs préservés)

### Scénario 4 : Supprimer le Workflow Actif

1. User est sur workflow A (actif)
2. User a aussi workflow B
3. User clique "Supprimer" sur workflow A
4. Confirmation → DELETE
5. Auto-switch vers workflow B
6. Overlay Bos jaune → B devient actif

---

## 9. Troubleshooting

### "Agent non trouvé" après switch

**Cause** : V2 nodes construits sans `data.agent`

**Fix** : Vérifier que `switchToWorkflow()` étape 6 construit `data.agent` depuis l'instance.

### "LLM n'est pas configuré" après switch

**Cause** : `resetAll()` au lieu de `resetForWorkflowSwitch()`

**Fix** : Utiliser `useRuntimeStore.getState().resetForWorkflowSwitch()` dans le switch.

### Prototypes d'un workflow apparaissent dans un autre

**Cause** : Requête sans filtre `workflowId`

**Fix** : Vérifier que toutes les requêtes `AgentPrototype.find()` incluent `workflowId`.

### Switch bloqué / Double overlay

**Cause** : Guard `isSwitchingRef` non respecté

**Fix** : Vérifier que le guard est en place au début de `switchToWorkflow()`.

### Journaux perdus après switch-back

**Cause** : Étape 5 du switch ne charge pas les journals

**Fix** : Vérifier la boucle `for (const instance of instances)` qui appelle `/journals`.

---

## Annexe : Checklist Nouveau Workflow Feature

- [ ] Filtrer par `workflowId` dans les requêtes backend
- [ ] Passer `currentWorkflowId` depuis le frontend
- [ ] Écouter `workflow:switch:success` pour recharger
- [ ] Utiliser `resetForWorkflowSwitch()` (pas `resetAll()`)
- [ ] Mapping identique entre hydratation et switch
- [ ] V2 nodes avec `data.agent` obligatoire
- [ ] Tests QA : switch A→B→A avec données

---

> **Maintenu par** : Équipe Architecture
> **Dernière validation QA** : 2026-02-28
