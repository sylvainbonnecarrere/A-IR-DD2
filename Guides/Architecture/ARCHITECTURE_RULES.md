# Architecture Rules — Agent Orchestration Platform

> **Document de référence** pour les agents développeurs et contributeurs.
> Dernière mise à jour : 2026-02-28

---

## Table des Matières

1. [Principes Fondamentaux](#1-principes-fondamentaux)
2. [Séparation Guest / Authenticated Users](#2-séparation-guest--authenticated-users)
3. [Workflow Scoping — La Règle du workflowId](#3-workflow-scoping--la-règle-du-workflowid)
4. [Hydratation : DB → Backend → Store → UI](#4-hydratation--db--backend--store--ui)
5. [Séparation Backend / Frontend](#5-séparation-backend--frontend)
6. [Schémas Mongoose/MongoDB — Principes SOLID](#6-schémas-mongoosemongodb--principes-solid)
7. [Fonctions d'Agent (Tools) — Python vs TypeScript](#7-fonctions-dagent-tools--python-vs-typescript)
8. [Conventions de Nommage et Structure](#8-conventions-de-nommage-et-structure)
9. [Sécurité et Validation](#9-sécurité-et-validation)
10. [Gestion d'État et Stores Zustand](#10-gestion-détat-et-stores-zustand)

---

## 1. Principes Fondamentaux

### 1.1 Architecture Générale

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (React + Vite)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Zustand     │  │ Components  │  │ Services    │  │ Hooks       │    │
│  │ Stores      │  │ (UI)        │  │ (API calls) │  │ (Logic)     │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ HTTP/REST (apiClient)
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (Express + TypeScript)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Routes      │  │ Middleware  │  │ Services    │  │ Python      │    │
│  │ (REST API)  │  │ (Auth,Val)  │  │ (Business)  │  │ Executor    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ Mongoose ODM
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           MongoDB (Persistence)                          │
│  Collections: users, workflows, agent_prototypes, agent_instances, etc. │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Les 5 Robots

| Robot | Code | Domaine | Responsabilités |
|-------|------|---------|-----------------|
| **Archi** | AR_001 | Prototypage | Création/édition de prototypes d'agents |
| **Bos** | BO_002 | Supervision | Gestion workflows, monitoring, debugging |
| **Com** | CO_003 | Connexions | APIs externes, BDD, authentifications |
| **Phil** | PH_004 | Data | Transformations, validations, fichiers |
| **Tim** | TI_005 | Events | Triggers, scheduling, rate limiting |

> **RÈGLE** : Chaque robot a un mandat précis. Un prototype créé doit avoir un `robotId` correspondant à son créateur.

---

## 2. Séparation Guest / Authenticated Users

### 2.1 Imperméabilité Totale

```
┌────────────────────────────────────────────────────────────────┐
│  GUEST MODE (Non connecté)          AUTHENTICATED MODE        │
├────────────────────────────────────────────────────────────────┤
│  • localStorage uniquement          • MongoDB persistence     │
│  • Zustand state local              • JWT authentication      │
│  • Pas d'API calls                  • Full API access         │
│  • Données perdues au refresh       • Données persistées      │
│  • Pas de workflowId                • workflowId obligatoire  │
│  • Pas de multi-workflow            • Multi-workflow complet  │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 Règles d'Implémentation

```typescript
// ✅ CORRECT : Vérifier l'authentification AVANT tout appel API
if (isAuthenticated && accessToken) {
  const result = await apiClient.post('/api/...', data);
}

// ❌ INTERDIT : Appeler l'API sans vérification
const result = await apiClient.post('/api/...', data); // CRASH pour guests!
```

### 2.3 Stockage par Mode

| Donnée | Guest | Authenticated |
|--------|-------|---------------|
| Prototypes | `localStorage` via Zustand persist | MongoDB `agent_prototypes` |
| Instances | `localStorage` via Zustand persist | MongoDB `agent_instances` |
| Workflows | N/A (mono-workflow implicite) | MongoDB `workflows` |
| Templates | `localStorage` (`arc_templates_*`) | MongoDB `templates` |
| LLM Configs | N/A | MongoDB `llm_configs` |
| Journaux | N/A | MongoDB `journals` |

### 2.4 Pattern de Code Conditionnel

```typescript
const handleSave = async (data: AgentData) => {
  // Local store update (TOUJOURS, pour les deux modes)
  const localResult = addAgent(data);
  
  // Persistence MongoDB (SEULEMENT si connecté)
  if (isAuthenticated && accessToken) {
    const apiResult = await createAgentPrototype(data, accessToken, robotId, workflowId);
    if (apiResult.success) {
      updateAgentId(localResult.agentId, apiResult.data._id);
    }
  }
};
```

---

## 3. Workflow Scoping — La Règle du workflowId

### 3.1 Principe Fondamental

> **RÈGLE CRITIQUE** : Toutes les données liées au design (prototypes, instances, nodes, edges) DOIVENT être scopées par `workflowId` pour les utilisateurs connectés.

### 3.2 Entités Scopées par Workflow

| Collection | Champ FK | Obligatoire |
|------------|----------|-------------|
| `agent_prototypes` | `workflowId` | Oui (V2+) |
| `agent_instances` | `workflowId` | Oui |
| `workflow_edges` | `workflowId` | Oui |
| `journals` | Via `instanceId` → `workflowId` | Indirect |

### 3.3 Entités Scopées par User (Global)

| Collection | Scope | Raison |
|------------|-------|--------|
| `templates` | `userId` | Templates réutilisables cross-workflow |
| `llm_configs` | `userId` | Configuration LLM globale |
| `user_settings` | `userId` | Préférences utilisateur |

### 3.4 Pattern de Chargement par Page Robot

```typescript
// ⭐ OBLIGATOIRE dans chaque page robot (Archi, Bos, Com, Phil, Tim)
const MyRobotPage: React.FC = () => {
  const { isAuthenticated, accessToken } = useAuth();
  const currentWorkflowId = useWorkflowStore(state => state.getCurrentWorkflowId());
  
  useEffect(() => {
    if (!isAuthenticated || !accessToken || !currentWorkflowId) return;
    
    // Charger les données scopées par workflow
    loadDataForWorkflow(accessToken, currentWorkflowId);
  }, [isAuthenticated, accessToken, currentWorkflowId]);
  
  // Re-charger quand le workflow change (switch)
  useEffect(() => {
    const handleSwitch = (e: CustomEvent) => {
      // Décharger données ancien workflow
      clearLocalData();
      // Le re-chargement se fait via la dépendance currentWorkflowId
    };
    
    window.addEventListener('workflow:switch:success', handleSwitch as EventListener);
    return () => window.removeEventListener('workflow:switch:success', handleSwitch as EventListener);
  }, []);
  
  return <div>...</div>;
};
```

### 3.5 Self-Healing pour Données Orphelines

```typescript
// Backend : Migration automatique des prototypes sans workflowId
if (defaultWorkflow) {
  const orphanedPrototypes = await AgentPrototype.find({
    userId,
    $or: [{ workflowId: { $exists: false } }, { workflowId: null }]
  });
  
  if (orphanedPrototypes.length > 0) {
    await AgentPrototype.updateMany(
      { userId, workflowId: { $exists: false } },
      { workflowId: defaultWorkflow._id }
    );
    console.log(`Self-healing: Migrated ${orphanedPrototypes.length} orphaned prototypes`);
  }
}
```

---

## 4. Hydratation : DB → Backend → Store → UI

### 4.1 Flux d'Hydratation

```
┌─────────────┐    GET /api/user/workspace    ┌─────────────┐
│   MongoDB   │ ────────────────────────────► │   Backend   │
└─────────────┘                               └──────┬──────┘
                                                     │
                    JSON Response                    │
      ┌──────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (App.tsx)                       │
│  1. resetAll() — Clear stale state                          │
│  2. Map backend → frontend types                            │
│  3. hydrateFromServer({ agents, instances, nodes, edges })  │
│  4. setAgents(hydratedPrototypes) — React state legacy      │
│  5. Load journals per instance                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Règles d'Hydratation

#### Règle 1 : Reset Atomique
```typescript
// ✅ TOUJOURS reset avant hydratation pour éviter les données stales
useDesignStore.getState().resetAll();
useRuntimeStore.getState().resetAll();
```

#### Règle 2 : Mapping Exact (13 champs pour prototypes)
```typescript
// Le mapping frontend doit être IDENTIQUE entre hydratation initiale et switch
const hydratedPrototype: Agent = {
  id: proto._id || proto.id,
  name: proto.name,
  role: proto.role || 'assistant',
  systemPrompt: proto.systemPrompt || '',
  llmProvider: proto.llmProvider || LLMProvider.Gemini,
  model: proto.llmModel || 'gemini-2.0-flash',
  capabilities: proto.capabilities || [],
  tools: proto.tools || [],
  outputConfig: proto.outputConfig || {},
  historyConfig: proto.historyConfig || {},
  creator_id: proto.robotId || RobotId.Archi,
  created_at: proto.createdAt || now,
  updated_at: proto.updatedAt || now
};
```

#### Règle 3 : Hydratation Atomique (Single Call)
```typescript
// ✅ CORRECT : Un seul appel avec toutes les données
hydrateFromServer({
  agents: hydratedPrototypes,
  agentInstances: hydratedInstances,
  nodes: [],
  edges: []
});

// ❌ INTERDIT : Appels séparés (race conditions)
setAgents(agents);       // State partiel!
setInstances(instances); // Race condition!
```

#### Règle 4 : Backend = Source de Vérité
```typescript
// Le backend reconstruit configuration_json via transformAgentInstanceForFrontend()
// Ne JAMAIS reconstruire côté frontend si le backend le fournit déjà
const configJson = instance.configuration_json || buildFallback(instance);
```

### 4.3 Transformation Backend → Frontend

```typescript
// backend/src/utils/transforms.ts
export function transformAgentInstanceForFrontend(instance: any) {
  const { _id, role, llmProvider, llmModel, systemPrompt, capabilities, tools, ...rest } = instance;
  
  return {
    id: _id?.toString(),
    // ... top-level fields ...
    configuration_json: {
      role: role || 'assistant',
      model: llmModel || 'gpt-4o-mini',
      llmProvider: llmProvider || 'openai',
      systemPrompt: systemPrompt || '',
      capabilities: capabilities || [],
      tools: tools || [],
      // ... etc
    },
    ...rest
  };
}
```

---

## 5. Séparation Backend / Frontend

### 5.1 Responsabilités

| Layer | Responsabilités | Interdit |
|-------|-----------------|----------|
| **Frontend** | UI, state local, appels API, validation UX | Accès direct MongoDB, crypto, secrets |
| **Backend** | Auth, validation server, persistence, crypto | DOM, React, state UI |

### 5.2 Structure des Dossiers

```
Frontend (racine)
├── components/          # Composants React (UI)
├── contexts/            # React contexts (Auth, Notifications)
├── hooks/               # Custom hooks
├── services/            # Appels API (agentPrototypeAPI.ts, llmService.ts)
├── stores/              # Zustand stores (useDesignStore, useRuntimeStore)
├── types/               # TypeScript interfaces
└── utils/               # Helpers frontend

Backend (backend/)
├── src/
│   ├── routes/          # Express routes (REST API)
│   ├── models/          # Mongoose schemas
│   ├── middleware/      # Auth, validation, ownership
│   ├── services/        # Business logic
│   ├── utils/           # Helpers (transforms, crypto)
│   └── pythonTools/     # Scripts Python pour tools d'agents
└── docker/              # Configuration Docker
```

### 5.3 Communication Frontend ↔ Backend

```typescript
// Frontend: services/apiClient.ts (Facade Pattern)
import apiClient from '../utils/apiClient';

// Tous les appels passent par apiClient qui:
// - Injecte le JWT automatiquement
// - Gère les erreurs 401/403
// - Centralise la base URL

const { data } = await apiClient.get('/api/workflows');
const { data } = await apiClient.post('/api/agent-prototypes', payload);
```

### 5.4 Validation Duale

```typescript
// Frontend: Validation UX (feedback rapide)
const schema = z.object({
  name: z.string().min(1).max(100),
  // ...
});

// Backend: Validation sécurité (source de vérité)
router.post('/',
  validateRequest(createAgentPrototypeSchema), // Zod middleware
  async (req, res) => { /* ... */ }
);
```

---

## 6. Schémas Mongoose/MongoDB — Principes SOLID

### 6.1 Règles de Conception

#### Règle 1 : Open/Closed Principle
```typescript
// ✅ CORRECT : Schema ouvert à l'extension via Mixed
const AgentPrototypeSchema = new Schema({
  // Champs structurés (validés)
  name: { type: String, required: true },
  llmProvider: { type: String, required: true },
  
  // Champs flexibles (extensibles sans migration)
  historyConfig: Schema.Types.Mixed,
  tools: [Schema.Types.Mixed],
  outputConfig: Schema.Types.Mixed,
  persistenceConfig: PersistenceConfigSchema // Sub-schema
});
```

#### Règle 2 : Éviter les Enums Fermés
```typescript
// ❌ ÉVITER : Enum fermé en string (nécessite migration pour ajouter)
llmProvider: {
  type: String,
  enum: ['openai', 'gemini', 'anthropic'] // Bloqué!
}

// ✅ PRÉFÉRER : String libre avec validation Zod côté route
llmProvider: {
  type: String,
  required: true
  // Validation dans la route, pas le schema
}
```

#### Règle 3 : Foreign Keys Optionnelles pour Évolutions
```typescript
const AgentPrototypeSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  
  // ⭐ Optionnel dès le départ pour évolutions futures
  workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: false },
  teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: false }
});
```

#### Règle 4 : Index Composites pour Performance
```typescript
// Index pour les queries fréquentes
AgentPrototypeSchema.index({ userId: 1, createdAt: -1 });
AgentPrototypeSchema.index({ userId: 1, workflowId: 1 });
AgentPrototypeSchema.index({ userId: 1, robotId: 1 });
```

#### Règle 5 : Sub-Schemas pour Structures Répétées
```typescript
// Sub-schema réutilisable (sans _id)
const PersistenceConfigSchema = new Schema({
  saveChat: { type: Boolean, default: true },
  saveErrors: { type: Boolean, default: true },
  // ...
}, { _id: false });

// Utilisation
persistenceConfig: {
  type: PersistenceConfigSchema,
  default: () => ({ saveChat: true, saveErrors: true })
}
```

### 6.2 Pattern de Migration Self-Healing

```typescript
// Au lieu de migrations manuelles, utiliser le self-healing au runtime
router.get('/workspace', async (req, res) => {
  // Fetch with backward-compatible query
  const prototypes = await AgentPrototype.find({
    userId,
    $or: [
      { workflowId: defaultWorkflow._id },
      { workflowId: { $exists: false } } // Legacy docs
    ]
  });
  
  // Self-heal: Migrate orphans
  await AgentPrototype.updateMany(
    { userId, workflowId: { $exists: false } },
    { workflowId: defaultWorkflow._id }
  );
});
```

---

## 7. Fonctions d'Agent (Tools) — Python vs TypeScript

### 7.1 Architecture des Tools

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AGENT TOOLS ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Frontend (TypeScript/React)              Backend (Python)              │
│  ─────────────────────────────            ────────────────────────      │
│  • UI-related tools                       • Heavy computation           │
│  • Browser APIs                           • File system access          │
│  • Real-time interactions                 • External API calls          │
│  • State management                       • Data processing             │
│  • Notifications                          • ML/AI inference             │
│                                                                          │
│  Exécution: Direct dans le navigateur     Exécution: Via pythonExecutor │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Tools TypeScript (Frontend)

```typescript
// types.ts — Déclaration du tool
interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}

// Exécution côté frontend (V2AgentNode.tsx)
const executeToolCall = async (toolCall: ToolCall) => {
  switch (toolCall.name) {
    case 'show_notification':
      addNotification({ type: 'info', message: toolCall.args.message });
      return { success: true };
    
    case 'navigate_to':
      router.push(toolCall.args.path);
      return { success: true };
    
    // ...
  }
};
```

### 7.3 Tools Python (Backend)

#### Structure
```
backend/
├── src/
│   ├── pythonExecutor.ts       # Orchestrateur d'exécution
│   ├── config.ts               # WHITELISTED_PYTHON_TOOLS
│   └── pythonTools/            # Scripts Python
│       ├── search_web.py
│       ├── analyze_data.py
│       ├── generate_report.py
│       └── ...
```

#### Whitelist de Sécurité
```typescript
// backend/src/config.ts
export const WHITELISTED_PYTHON_TOOLS = [
  'search_web',
  'analyze_data',
  'generate_report',
  // Ajouter ici les nouveaux tools autorisés
];
```

#### Contrat d'Exécution
```bash
# Appel
python3 <script.py> '<json_args>'

# Sortie attendue
{ "success": true, "result": {...} }  # stdout (JSON)

# Erreurs
{ "error": "message" }                 # stdout (JSON)
# ou
exit code != 0                         # stderr pour logs
```

#### Exemple de Tool Python
```python
#!/usr/bin/env python3
# backend/src/pythonTools/search_web.py

import sys
import json

def main():
    try:
        args = json.loads(sys.argv[1])
        query = args.get('query', '')
        
        # Logique de recherche...
        results = perform_search(query)
        
        print(json.dumps({
            "success": True,
            "result": results
        }))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)

if __name__ == '__main__':
    main()
```

#### Exécuteur Backend
```typescript
// backend/src/pythonExecutor.ts
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { WHITELISTED_PYTHON_TOOLS } from './config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function executePythonTool(
  toolName: string,
  args: Record<string, any>
): Promise<{ success: boolean; result?: any; error?: string }> {
  // Security check
  if (!WHITELISTED_PYTHON_TOOLS.includes(toolName)) {
    return { success: false, error: `Tool '${toolName}' not whitelisted` };
  }
  
  const scriptPath = path.join(__dirname, 'pythonTools', `${toolName}.py`);
  
  return new Promise((resolve) => {
    const process = spawn('python3', [scriptPath, JSON.stringify(args)]);
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => { stdout += data; });
    process.stderr.on('data', (data) => { stderr += data; });
    
    process.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: stderr || `Exit code ${code}` });
        return;
      }
      
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ success: false, error: 'Invalid JSON output' });
      }
    });
  });
}
```

### 7.4 Quand Utiliser Quoi ?

| Critère | TypeScript (Frontend) | Python (Backend) |
|---------|----------------------|------------------|
| Latence | < 100ms | 100ms - 10s |
| Accès UI | ✅ Direct | ❌ Via response |
| Accès fichiers | ❌ Sandbox browser | ✅ Filesystem |
| APIs externes | ⚠️ CORS limité | ✅ Libre |
| ML/AI inference | ❌ Limité | ✅ PyTorch, TensorFlow |
| State React | ✅ Direct | ❌ Via API |

---

## 8. Conventions de Nommage et Structure

### 8.1 Fichiers

| Type | Convention | Exemple |
|------|------------|---------|
| Composant React | PascalCase | `ArchiPrototypingPage.tsx` |
| Hook | camelCase avec `use` | `useLocalization.ts` |
| Service | camelCase | `agentPrototypeAPI.ts` |
| Store Zustand | camelCase avec `use` | `useDesignStore.ts` |
| Model Mongoose | PascalCase + `.model.ts` | `AgentPrototype.model.ts` |
| Route Express | kebab-case + `.routes.ts` | `agent-prototypes.routes.ts` |
| Utilitaire | camelCase | `transforms.ts` |

### 8.2 Variables et Fonctions

```typescript
// Variables
const currentWorkflowId = '...';        // camelCase
const WHITELISTED_TOOLS = [...];        // SCREAMING_SNAKE pour constantes

// Fonctions
function handleSaveAgent() {}           // camelCase, verbe d'action
async function fetchAgentPrototypes() {} // async explicite

// Types/Interfaces
interface IAgentPrototype {}            // I prefix pour interfaces Mongoose
type AgentPrototypePayload = {};        // PascalCase pour types
```

### 8.3 Collections MongoDB

| Collection | Naming | Index Pattern |
|------------|--------|---------------|
| `users` | pluriel snake_case | `{ email: 1 }` unique |
| `workflows` | pluriel | `{ userId: 1, isDefault: 1 }` |
| `agent_prototypes` | snake_case | `{ userId: 1, workflowId: 1 }` |
| `agent_instances` | snake_case | `{ workflowId: 1, status: 1 }` |
| `llm_configs` | snake_case | `{ userId: 1, provider: 1 }` unique |

---

## 9. Sécurité et Validation

### 9.1 Authentification

```typescript
// Middleware obligatoire pour routes protégées
router.get('/protected',
  requireAuth,                    // Vérifie JWT
  requireOwnership(resourceId),   // Vérifie propriété
  async (req, res) => { /* ... */ }
);
```

### 9.2 Ownership Check

```typescript
// Toujours vérifier que l'utilisateur possède la ressource
const requireOwnershipAsync = (getOwnerId: (req) => Promise<string | null>) => {
  return async (req, res, next) => {
    const ownerId = await getOwnerId(req);
    if (ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    next();
  };
};
```

### 9.3 Validation Zod

```typescript
// Validation stricte des entrées
const createSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  workflowId: z.string().regex(/^[a-f\d]{24}$/i).optional() // ObjectId format
});

router.post('/', validateRequest(createSchema), handler);
```

### 9.4 Secrets et Credentials

```typescript
// ❌ JAMAIS exposer les clés API
res.json({
  llmConfigs: configs.map(c => ({
    provider: c.provider,
    hasApiKey: !!c.apiKeyEncrypted, // Boolean seulement
    // apiKey: c.apiKeyEncrypted    // INTERDIT!
  }))
});
```

---

## 10. Gestion d'État et Stores Zustand

### 10.1 Séparation des Stores

| Store | Domaine | Persistance | Contenu |
|-------|---------|-------------|---------|
| `useDesignStore` | Design | MongoDB | Prototypes, instances, nodes, edges |
| `useRuntimeStore` | Runtime | Aucune | Messages, execution state, UI temp |
| `useWorkflowStore` | Workflow | MongoDB | Workflow actif, canvas state |
| `useLocalizationStore` | i18n | localStorage | Langue, traductions |

### 10.2 Pattern Anti-Rerenders

```typescript
// ✅ CORRECT : Sélecteur spécifique
const currentWorkflowId = useWorkflowStore(state => state.getCurrentWorkflowId());

// ❌ ÉVITER : Destructuration complète (rerenders sur tout changement)
const { getCurrentWorkflowId, setWorkflow, ... } = useWorkflowStore();
```

### 10.3 Reset sur Switch Workflow

```typescript
// ⭐ CRITIQUE: Utiliser resetForWorkflowSwitch() pour le switch (préserve llmConfigs)
useRuntimeStore.getState().resetForWorkflowSwitch();

// ❌ INTERDIT pour switch workflow: resetAll() détruit les configs LLM
useRuntimeStore.getState().resetAll(); // Uniquement pour logout!
```

### 10.4 Données User-Level vs Workflow-Level

| Donnée | Scope | Reset sur Switch | Reset sur Logout |
|--------|-------|------------------|------------------|
| `llmConfigs` | USER | ❌ Préservé | ✅ Reset |
| `nodeMessages` | WORKFLOW | ✅ Reset | ✅ Reset |
| `executingNodes` | WORKFLOW | ✅ Reset | ✅ Reset |
| `lastSavedAt` | WORKFLOW | ✅ Reset | ✅ Reset |
| `navigationHandler` | SESSION | Préservé | Préservé |

---

## Annexes

### A. Checklist Nouveau Composant

- [ ] Vérifier `isAuthenticated` avant appels API
- [ ] Récupérer `currentWorkflowId` si données scopées
- [ ] Écouter `workflow:switch:success` pour reload
- [ ] Validation Zod côté service
- [ ] i18n pour tous les textes visibles
- [ ] Tests unitaires (Vitest)

### B. Checklist Nouveau Model Mongoose

- [ ] Interface `I{Model}` avec tous les champs
- [ ] Schema avec types appropriés
- [ ] Champs optionnels pour évolutions (`required: false`)
- [ ] `Schema.Types.Mixed` pour structures flexibles
- [ ] Index composite pour queries fréquentes
- [ ] Timestamps automatiques (`timestamps: true`)
- [ ] Collection name explicite (`collection: '...'`)

### C. Checklist Nouveau Tool Python

- [ ] Ajouter à `WHITELISTED_PYTHON_TOOLS`
- [ ] Créer fichier dans `backend/src/pythonTools/`
- [ ] Input: `sys.argv[1]` JSON
- [ ] Output: JSON sur stdout
- [ ] Erreurs: JSON `{ error: '...' }` + exit code
- [ ] Logs debug sur stderr uniquement
- [ ] Documentation des paramètres attendus

---

> **Maintenu par** : Équipe Architecture
> **Contact** : Chef de Projet via les instructions Copilot
