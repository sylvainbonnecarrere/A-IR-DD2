# Validation des Schémas : Docker ↔ Mongoose

## ✅ Collections Synchronisées

### 1. **users**
| Champ | Docker | Mongoose | Statut |
|-------|--------|----------|--------|
| email | ✅ string, unique | ✅ string, unique | ✅ OK |
| password | ✅ string (renamed) | ✅ string | ✅ OK |
| role | ✅ enum | ✅ enum (admin/user/viewer) | ✅ OK |
| isActive | ✅ bool | ✅ bool | ✅ OK |
| lastLogin | ✅ date | ✅ date | ✅ OK |
| createdAt/updatedAt | ✅ timestamps | ✅ timestamps: true | ✅ OK |

**Index** : `{ email: 1 }` unique ✅

---

### 2. **llm_configs** (forcé via `collection: 'llm_configs'`)
| Champ | Docker | Mongoose | Statut |
|-------|--------|----------|--------|
| userId | ✅ objectId | ✅ ObjectId ref User | ✅ OK |
| provider | ✅ string | ✅ string, enum | ✅ OK |
| apiKeyEncrypted | ✅ string | ✅ string | ✅ OK |
| enabled | ✅ isEnabled (bool) | ✅ enabled (bool) | ⚠️ Nom différent |
| capabilities | ✅ object | ✅ Mixed | ✅ OK |
| createdAt/updatedAt | ✅ timestamps | ✅ timestamps: true | ✅ OK |

**Index** : `{ userId: 1, provider: 1 }` unique ✅

**⚠️ MINOR** : Docker utilise `isEnabled`, Mongoose `enabled` (tolérable car validation flexible)

---

### 3. **user_settings**
| Champ | Docker | Mongoose | Statut |
|-------|--------|----------|--------|
| userId | ✅ objectId, unique | ✅ ObjectId, unique | ✅ OK |
| llmConfigs | ✅ object | ✅ Mixed | ✅ OK |
| preferences | ✅ object (lang/theme) | ✅ object (lang/theme) | ✅ OK |
| version | ✅ int | ✅ number | ✅ OK |
| createdAt/updatedAt | ✅ timestamps | ✅ timestamps: true | ✅ OK |

**Index** : `{ userId: 1 }` unique ✅

---

### 4. **workflows**
| Champ | Docker (CORRIGÉ) | Mongoose | Statut |
|-------|------------------|----------|--------|
| userId | ✅ objectId | ✅ ObjectId ref User | ✅ OK |
| name | ✅ string | ✅ string (1-100 chars) | ✅ OK |
| description | ✅ string | ✅ string (max 500) | ✅ OK |
| isActive | ✅ bool | ✅ bool, default false | ✅ OK |
| lastSavedAt | ✅ date | ✅ date | ✅ OK |
| isDirty | ✅ bool | ✅ bool, default false | ✅ OK |
| createdAt/updatedAt | ✅ timestamps | ✅ timestamps: true | ✅ OK |

**Index** :
- `{ userId: 1, isActive: 1 }` ✅
- `{ userId: 1, updatedAt: -1 }` ✅

---

### 5. **agent_prototypes** (forcé via `collection: 'agent_prototypes'`)
| Champ | Docker (CORRIGÉ) | Mongoose | Statut |
|-------|------------------|----------|--------|
| userId | ✅ objectId | ✅ ObjectId ref User | ✅ OK |
| name | ✅ string | ✅ string (1-100) | ✅ OK |
| role | ✅ string | ✅ string (max 200) | ✅ OK |
| systemPrompt | ✅ string | ✅ string | ✅ OK |
| llmProvider | ✅ string | ✅ string | ✅ OK |
| llmModel | ✅ string | ✅ string | ✅ OK |
| capabilities | ✅ array | ✅ [string] | ✅ OK |
| historyConfig | ✅ object | ✅ Mixed | ✅ OK |
| tools | ✅ array | ✅ [Mixed] | ✅ OK |
| outputConfig | ✅ object | ✅ Mixed | ✅ OK |
| robotId | ✅ string, enum | ✅ string, enum 5 robots | ✅ OK |
| isPrototype | ✅ bool | ✅ bool, immutable | ✅ OK |
| createdAt/updatedAt | ✅ timestamps | ✅ timestamps: true | ✅ OK |

**Index** :
- `{ userId: 1, createdAt: -1 }` ✅
- `{ userId: 1, robotId: 1 }` ✅

---

### 6. **agent_instances** (forcé via `collection: 'agent_instances'`)
| Champ | Docker (CORRIGÉ) | Mongoose | Statut |
|-------|------------------|----------|--------|
| workflowId | ✅ objectId | ✅ ObjectId ref Workflow | ✅ OK |
| userId | ✅ objectId | ✅ ObjectId ref User | ✅ OK |
| prototypeId | ✅ objectId (optional) | ✅ ObjectId ref Prototype | ✅ OK |
| name/role/systemPrompt/etc. | ✅ snapshot fields | ✅ snapshot fields | ✅ OK |
| position | ✅ {x, y} required | ✅ {x, y} required | ✅ OK |
| isMinimized | ✅ bool | ✅ bool, default false | ✅ OK |
| isMaximized | ✅ bool | ✅ bool, default false | ✅ OK |
| zIndex | ✅ number | ✅ number, default 0 | ✅ OK |
| createdAt/updatedAt | ✅ timestamps | ✅ timestamps: true | ✅ OK |

**Index** :
- `{ workflowId: 1, createdAt: -1 }` ✅
- `{ userId: 1, workflowId: 1 }` ✅
- `{ prototypeId: 1 }` ✅

---

### 7. **workflow_nodes** (forcé via `collection: 'workflow_nodes'`)
| Champ | Docker (CORRIGÉ) | Mongoose | Statut |
|-------|------------------|----------|--------|
| ownerId | ✅ objectId | ✅ ObjectId ref User | ✅ OK |
| nodeType | ✅ enum (4 types) | ✅ enum (4 types) | ✅ OK |
| nodeData | ✅ object | ✅ Mixed | ✅ OK |
| position | ✅ {x, y} required | ✅ {x, y} required | ✅ OK |
| metadata | ✅ object | ✅ Mixed | ✅ OK |
| createdAt/updatedAt | ✅ timestamps | ✅ timestamps: true | ✅ OK |

**Index** :
- `{ ownerId: 1, nodeType: 1 }` ✅
- `{ ownerId: 1, createdAt: -1 }` ✅

---

### 8. **workflow_edges** (forcé via `collection: 'workflow_edges'`)
| Champ | Docker (CORRIGÉ) | Mongoose | Statut |
|-------|------------------|----------|--------|
| workflowId | ✅ objectId | ✅ ObjectId ref Workflow | ✅ OK |
| userId | ✅ objectId | ✅ ObjectId ref User | ✅ OK |
| sourceInstanceId | ✅ objectId | ✅ ObjectId ref Instance | ✅ OK |
| targetInstanceId | ✅ objectId | ✅ ObjectId ref Instance | ✅ OK |
| sourceHandle | ✅ string | ✅ string | ✅ OK |
| targetHandle | ✅ string | ✅ string | ✅ OK |
| edgeType | ✅ enum (4 types) | ✅ enum (4 types) | ✅ OK |
| animated | ✅ bool | ✅ bool, default false | ✅ OK |
| label | ✅ string | ✅ string | ✅ OK |
| createdAt/updatedAt | ✅ timestamps | ✅ timestamps: true | ✅ OK |

**Index** :
- `{ workflowId: 1 }` ✅
- `{ sourceInstanceId: 1 }` ✅
- `{ targetInstanceId: 1 }` ✅

---

## 🗑️ Collections Legacy

### **agents** (conservé pour compatibilité)
Collection maintenue pour rétrocompatibilité mais non utilisée dans l'architecture actuelle (remplacée par `agent_prototypes` et `agent_instances`).

---

## 📋 Résumé des Corrections Appliquées

### ✅ **Modèles Mongoose** (5 fichiers modifiés)
- ✅ LLMConfig.model.ts → `collection: 'llm_configs'`
- ✅ AgentPrototype.model.ts → `collection: 'agent_prototypes'`
- ✅ AgentInstance.model.ts → `collection: 'agent_instances'`
- ✅ WorkflowNode.model.ts → `collection: 'workflow_nodes'`
- ✅ WorkflowEdge.model.ts → `collection: 'workflow_edges'`

### ✅ **Script Docker** (init-collections.js)
- ✅ users: `passwordHash` → `password` (+ ajout role enum, lastLogin)
- ✅ workflows: `creator_id` → `userId` (+ ajout champs complets)
- ✅ agent_prototypes: Ajout validation complète avec userId
- ✅ agent_instances: Ajout validation complète (position, canvas props)
- ✅ workflow_nodes: Ajout validation complète avec ownerId
- ✅ workflow_edges: Ajout validation complète
- ✅ agents: Marqué legacy, conversion userId

---

## ⚠️ Point d'Attention

**LLMConfig** : Légère différence de nommage (`isEnabled` vs `enabled`) mais MongoDB acceptera les deux car la validation n'est pas stricte sur ce champ. Si besoin d'uniformiser :

```javascript
// Option : Aligner Docker sur Mongoose
enabled: {  // au lieu de isEnabled
  bsonType: 'bool',
  description: 'Whether this provider is active'
}
```

---

## 🧪 Prochaines Étapes de Test

1. **Supprimer les collections en double** :
```bash
docker exec -it a-ir-dd2-mongodb mongosh -u "$MONGO_USER" -p "$MONGO_PASSWORD" --authenticationDatabase admin
use a-ir-dd2-dev
db.llmconfigs.drop()
db.agentprototypes.drop()
db.agentinstances.drop()
db.workflownodes.drop()
db.workflowedges.drop()
```

2. **Recréer avec le script corrigé** :
```bash
cd backend/docker
docker-compose down -v
docker-compose up -d
```

3. **Vérifier dans Mongoose** que les collections matchent :
```bash
npm run dev
# Tester création Workflow, AgentPrototype, AgentInstance
```

---

## ✅ Convention de Nommage Adoptée

**Standard final** : **snake_case** pour toutes les collections
- ✅ Cohérence avec conventions NoSQL/SQL standard
- ✅ Lisibilité accrue (workflow_edges vs workflowedges)
- ✅ Facilite les migrations futures vers d'autres DB
- ✅ Respect des best practices MongoDB

**Mongoose forcé explicitement** : Option `collection: 'nom_exact'` dans schema options
