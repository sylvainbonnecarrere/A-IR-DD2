# 🎯 TÂCHE DÉDIÉE : AGENT MONGO-PERSISTANCE

**Tâche**: Implémentation MongoDB de la table `agent_templates` au démarrage backend  
**Agent**: `.github/agents/mongo-persistance.agent.md`  
**Intégration**: `backend/src/services/databaseInit.ts`  
**Priorité**: 🔴 BLOQUANTE (fondation templates)

---

## 📍 CONTEXTE

L'application A-IR-DD2 utilise un système d'initialisation **idempotent** MongoDB via `databaseInit.ts`:
- ✅ Appelé au démarrage backend (`server.ts`)
- ✅ Crée collections + indexes + schémas de validation
- ✅ Safe à relancer (vérifications d'existence)
- ✅ Code-first (pas de migrations externes)

**Tu dois**: Ajouter la nouvelle table `agent_templates` à ce système.

---

## 🏗️ ARCHITECTURE ACTUELLE

### Fichier Clé: `backend/src/services/databaseInit.ts`

Structure existante:
```typescript
// 1️⃣ COLLECTION_SCHEMAS - Validation JSON Schema pour chaque collection
const COLLECTION_SCHEMAS = {
  users: { validator: { $jsonSchema: {...} } },
  llm_configs: { validator: { $jsonSchema: {...} } },
  agent_prototypes: { validator: { $jsonSchema: {...} } },  ← Exemple existant
  agent_instances: { validator: { $jsonSchema: {...} } },
  // ... autres collections
};

// 2️⃣ INDEX_DEFINITIONS - Indexes de performance par collection
const INDEX_DEFINITIONS = {
  users: [{ spec: { email: 1 }, options: { unique: true } }],
  agent_prototypes: [{ spec: { creator_id: 1 }, options: {} }],
  // ... autres
};

// 3️⃣ initializeDatabase() - Fonction appelée au démarrage
export async function initializeDatabase(): Promise<void> {
  // PHASE 1: Vérifier collections existantes
  // PHASE 2: Créer collections manquantes
  // PHASE 3: Créer indexes
  // PHASE 4: Validation
}
```

### Intégration dans `server.ts`

```typescript
// backend/src/server.ts - Ligne ~220
app.listen(PORT, async () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
  
  // ⭐ Appelé APRÈS connection MongoDB
  await initializeDatabase();
});
```

---

## 📋 TÂCHE DÉTAILLÉE

### Étape 1️⃣ : Ajouter le Schéma de Validation

**Fichier**: `backend/src/services/databaseInit.ts`  
**Localisation**: Après `agent_instances` dans `COLLECTION_SCHEMAS`  
**Contenu**: Ajouter ce bloc

```typescript
  agent_templates: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          userId: { bsonType: 'objectId' },
          name: { bsonType: 'string' },
          description: { bsonType: 'string' },
          category: { bsonType: 'string' },
          robotId: { bsonType: 'string' },
          icon: { bsonType: 'string' },
          template: { bsonType: 'object' },
          sourcePrototypeId: { bsonType: 'objectId' },
          usageCount: { bsonType: 'int' },
          isStarred: { bsonType: 'bool' },
          tags: { bsonType: 'array' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' }
        }
      }
    }
  },
```

**Context avant** (où ajouter):
```typescript
  agent_instances: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          agentId: { bsonType: 'objectId' },
          workflowId: { bsonType: 'objectId' },
          executionState: { bsonType: 'object' },
          capabilities: { bsonType: 'array' },
          logs: { bsonType: 'array' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' }
        }
      }
    }
  },
  
  // ⭐ AJOUTER ICI ⭐
  agent_templates: { ... }
};
```

---

### Étape 2️⃣ : Ajouter les Indexes de Performance

**Fichier**: `backend/src/services/databaseInit.ts`  
**Localisation**: Après `agent_instances` dans `INDEX_DEFINITIONS`  
**Contenu**: Ajouter ce bloc

```typescript
  agent_templates: [
    { spec: { userId: 1, createdAt: -1 }, options: {} },
    { spec: { userId: 1, category: 1 }, options: {} },
    { spec: { userId: 1, isStarred: 1 }, options: {} }
  ],
```

**Context avant** (où ajouter):
```typescript
  agent_instances: [
    { spec: { agentId: 1, createdAt: 1 }, options: {} },
    { spec: { workflowId: 1 }, options: {} }
  ],
  
  // ⭐ AJOUTER ICI ⭐
  agent_templates: [
    { spec: { userId: 1, createdAt: -1 }, options: {} },
    { spec: { userId: 1, category: 1 }, options: {} },
    { spec: { userId: 1, isStarred: 1 }, options: {} }
  ]
};
```

---

### Étape 3️⃣ : S'assurer que la Fonction `initializeDatabase()` Traite le Schéma

**Fichier**: `backend/src/services/databaseInit.ts`  
**Vérification** (lecture uniquement):

La fonction `initializeDatabase()` utilise `COLLECTION_SCHEMAS` et `INDEX_DEFINITIONS` en boucle:

```typescript
// ✅ Automatique - pas de modification requise
// La fonction boucle sur toutes les clés de COLLECTION_SCHEMAS et INDEX_DEFINITIONS
// Donc ta nouvelle collection `agent_templates` sera traitée automatiquement

for (const collectionName of Object.keys(COLLECTION_SCHEMAS)) {
  // Vérifie si collection exists
  // Si NON → crée collection avec schéma JSON
  // ✅ agent_templates sera traité ici
}

for (const collectionName of Object.keys(INDEX_DEFINITIONS)) {
  // Crée indexes pour collection
  // ✅ agent_templates indexes seront créés ici
}
```

---

### Étape 4️⃣ : Ajouter le Modèle Mongoose (Séparé)

**Fichier**: `backend/src/models/AgentTemplate.model.ts`  
**Ce fichier est CRÉÉ par toi SÉPARÉMENT** (pas dans databaseInit.ts)

⚠️ **NOTE**: Le `databaseInit.ts` crée la **collection MongoDB**  
Le **Modèle Mongoose** (`AgentTemplate.model.ts`) fournit une interface TypeScript

```typescript
// ✅ Ceci est CRÉÉ comme un fichier séparé
// backend/src/models/AgentTemplate.model.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface IAgentTemplate extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  // ... autres champs
}

const AgentTemplateSchema = new Schema<IAgentTemplate>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  // ... autres champs
}, { timestamps: true });

// Indexes (redondants avec databaseInit.ts mais TypeScript-typed)
AgentTemplateSchema.index({ userId: 1, createdAt: -1 });
AgentTemplateSchema.index({ userId: 1, category: 1 });
AgentTemplateSchema.index({ userId: 1, isStarred: 1 });

export const AgentTemplate = mongoose.model<IAgentTemplate>('AgentTemplate', AgentTemplateSchema);
```

---

## 🔄 WORKFLOW COMPLET D'INITIALISATION

### Au Démarrage Backend

```
1. npm run dev (backend/)
   ↓
2. server.ts démarre
   ├─ Connecte MongoDB
   └─ Attendez connection OK
   ↓
3. server.ts appelle initializeDatabase()
   ├─ PHASE 1: Vérifie collections existantes
   │  └─ agent_templates exists? NON → Go Phase 2
   ├─ PHASE 2: Crée collection + schéma JSON
   │  └─ db.createCollection('agent_templates', { validator: {...} })
   ├─ PHASE 3: Crée indexes
   │  └─ db.agent_templates.createIndex({ userId: 1, createdAt: -1 })
   │  └─ db.agent_templates.createIndex({ userId: 1, category: 1 })
   │  └─ db.agent_templates.createIndex({ userId: 1, isStarred: 1 })
   └─ PHASE 4: Valide
      └─ Log "✅ agent_templates collection initialized"
   ↓
4. Backend prêt pour requêtes API
   ├─ POST /api/agent-templates (crée document)
   └─ GET /api/agent-templates (liste templates user)
```

### Lors Deuxième Démarrage

```
1. Redémarre backend
   ↓
2. initializeDatabase() relancée
   ├─ agent_templates exists? OUI
   └─ Skip creation (idempotent - safe)
   ↓
3. Indexes vérifiés
   └─ Déjà existent, pas de duplication
   ↓
4. Backend prêt
```

---

## ✅ CHECKLIST POUR L'AGENT MONGO-PERSISTANCE

### Phase 1: Code Review
- [ ] Lire `backend/src/services/databaseInit.ts` complètement (444 lignes)
- [ ] Identifier `COLLECTION_SCHEMAS` (ligne ~30)
- [ ] Identifier `INDEX_DEFINITIONS` (ligne ~198)
- [ ] Identifier `initializeDatabase()` (ligne ~238)

### Phase 2: Modifications
- [ ] Ajouter schéma `agent_templates` dans `COLLECTION_SCHEMAS`
- [ ] Ajouter indexes `agent_templates` dans `INDEX_DEFINITIONS`
- [ ] Vérifier indentation/syntaxe TypeScript

### Phase 3: Modèle Mongoose
- [ ] Créer `backend/src/models/AgentTemplate.model.ts`
- [ ] Exporter interface `IAgentTemplate`
- [ ] Exporter const `AgentTemplate` (mongoose model)
- [ ] Indexes TypeScript-typed (redondants avec databaseInit.ts mais ok)

### Phase 4: Testing
- [ ] Lancer `npm run dev` dans `backend/`
- [ ] Vérifier logs: "✅ agent_templates collection initialized"
- [ ] Vérifier MongoDB: collection existe
- [ ] Vérifier MongoDB: indexes créés

### Phase 5: Integration
- [ ] Vérifier `server.ts` appelle `initializeDatabase()` ✅ (déjà fait)
- [ ] Pas de modifications requises dans `server.ts`
- [ ] Routes API seront ajoutées au Jalon 2 par autre agent

---

## 📊 STRUCTURE DONNÉES COMPLÈTE

### Document Exemple `agent_templates`

```json
{
  "_id": ObjectId("507f1f77bcf86cd799439011"),
  "userId": ObjectId("507f1f77bcf86cd799439012"),
  "name": "Analyste de Données Senior",
  "description": "Expert en statistiques et data science",
  "category": "specialist",
  "robotId": "AR_001",
  "icon": "📊",
  
  "template": {
    "name": "Analyste de Données Senior",
    "role": "Data Scientist",
    "systemPrompt": "Tu es UN expert en analyse de données...",
    "llmProvider": "OpenAI",
    "llmModel": "gpt-4",
    "capabilities": ["Chat", "File Analysis", "Web Search"],
    "tools": [
      {
        "name": "python_executor",
        "description": "Exécuter code Python",
        "parameters": { "type": "object" }
      }
    ],
    "outputConfig": { "enabled": true, "format": "json" },
    "historyConfig": { "enabled": true, "limits": { "token": 4096 } }
  },
  
  "sourcePrototypeId": ObjectId("507f1f77bcf86cd799439013"),
  "usageCount": 12,
  "isStarred": true,
  "tags": ["data-science", "python", "statistics"],
  
  "createdAt": "2026-02-18T10:30:00Z",
  "updatedAt": "2026-02-18T15:45:00Z"
}
```

---

## 🔗 FICHIERS RÉFÉRENCE

| Fichier | Rôle | Modification |
|---------|------|--------------|
| `backend/src/services/databaseInit.ts` | Initialisation MongoDB | ✏️ Ajouter schéma + indexes |
| `backend/src/models/AgentTemplate.model.ts` | Modèle Mongoose | ✨ Créer (nouveau) |
| `backend/src/server.ts` | Démarrage backend | ✅ Pas de modif (appelle already initDB) |
| `backend/src/routes/agent-templates.routes.ts` | Routes API | ✨ Créé par autre agent (Jalon 2) |

---

## 🚀 PROCHAINES ÉTAPES (après cette tâche)

1. ✅ **CETTE TÂCHE**: Ajouter table MongoDB (`databaseInit.ts` + `AgentTemplate.model.ts`)
2. ⏳ **Jalon 2**: Créer routes API (`agent-templates.routes.ts`)
3. ⏳ **Jalon 3**: Service frontend + React Query

---

## 💬 QUESTIONS FRÉQUENTES

**Q: Pourquoi pas un script de migration (Flyway, etc.)?**  
A: Pattern choisi: **Code-First** via `databaseInit.ts` idempotent. Plus simple, testable, versionnable.

**Q: Dois-je créer les indexes ailleurs?**  
A: Non, `databaseInit.ts` les crée automatiquement. Le modèle Mongoose les ajoute aussi (RedundAnce ok).

**Q: Et si la table existe déjà?**  
A: `initializeDatabase()` vérifie l'existence et skips création (idempotent).

**Q: Faut-il créer des documents seed?**  
A: Non pour cette table. Les templates sont créés via API (`POST /api/agent-templates`).

---

## ✨ RÉSUMÉ

**Tâche simple** (15-30 min):
1. Ajouter 2 blocs de code dans `databaseInit.ts` (schéma + indexes)
2. Créer `AgentTemplate.model.ts` (Mongoose model)
3. Tester: `npm run dev` → vérifier logs

**Résultat**: Table `agent_templates` prête pour API Jalon 2 ✅
