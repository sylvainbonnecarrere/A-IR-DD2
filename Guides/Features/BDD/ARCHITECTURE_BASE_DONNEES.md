# Architecture Base de Données MongoDB - Guide Complet
**A-IR-DD2 - Système d'Orchestration d'Agents IA**  
**Date**: Mars 2026  
**Audience**: Architectes, Développeurs, DevOps

---

## Table des Matières

1. [Vue Globale](#vue-globale)
2. [Installation et Configuration](#installation-et-configuration)
3. [Modèles et Collections](#modèles-et-collections)
4. [Patterns de Persistance](#patterns-de-persistance)
5. [Authentification et Permissions](#authentification-et-permissions)
6. [Hydratation des Données](#hydratation-des-données)
7. [Gestion des Indexs](#gestion-des-indexs)
8. [Opérations Courantes](#opérations-courantes)

---

## Vue Globale

### Architecture Système

```
┌─────────────────────────────────────────────────────────┐
│                   FRONTEND (React/TypeScript)            │
│  ┌────────────────┐  ┌───────────────┐  ┌─────────────┐ │
│  │ App State      │  │ useRuntimeStore │  │ localStorage │ │
│  │ (Design/Auth)  │  │ (Chat, LLM)   │  │ (Guest Mode) │ │
│  └────────────────┘  └───────────────┘  └─────────────┘ │
└────────────────┬─────────────────────────────────────────┘
                 │ API REST + JWT Authentication
┌────────────────▼─────────────────────────────────────────┐
│              BACKEND (Node.js/Express)                    │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Routes API                                           │ │
│  │ - /api/auth (Jalon 2)                                │ │
│  │ - /api/workflows (Jalon 3)                           │ │
│  │ - /api/agent-prototypes, /agent-instances (Jalon 4) │ │
│  │ - /api/llm-configs (Jalon 4.4)                       │ │
│  │ - /api/user-settings, /user-workspace (Settings)    │ │
│  └──────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Services                                             │ │
│  │ - Mongoose Models (ORM)                              │ │
│  │ - Encryption Service (JWT, API Key, AES-256)        │ │
│  │ - Database Init Service                             │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────┬─────────────────────────────────────────┘
                 │ MongoDB Driver
┌────────────────▼─────────────────────────────────────────┐
│            MONGODB (Données Persistantes)                 │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Collections (13 modèles)                             │ │
│  │ ✅ users (utilisateurs connectés)                    │ │
│  │ ✅ llm_configs (configurations LLM - persistantes)  │ │
│  │ ✅ workflows (workflows utilisateur)                 │ │
│  │ ✅ agent_prototypes (prototypes d'agents)           │ │
│  │ ✅ agent_instances (exécutions d'agents)            │ │
│  │ ✅ agent_journals (logs/historique d'exécution)    │ │
│  │ ✅ user_settings (préférences utilisateur)          │ │
│  │ ... 6 autres collections                            │ │
│  └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Modèle de Persistance Hybride

**⭐ Principe Fondamental: Seuls les utilisateurs authentifiés peuvent persister**

| Contexte | Storage | Persistence | Chiffrement | Durée |
|----------|---------|-------------|-------------|-------|
| **Connecté** | MongoDB | ✅ Permanente | ✅ (API Keys) | ∞ |
| **Invité (Guest)** | localStorage | ⚠️ Fragile | ❌ (dev only) | Session |

---

## Installation et Configuration

### Prérequis

```bash
# Node.js & npm
node --version  # v18+
npm --version   # 9+

# MongoDB
mongodb --version  # 5.0+
```

### Étape 1: Cloner et Installer

```bash
# Cloner le projet
git clone <repo-url>
cd A-IR-DD2

# Installer les dépendances
npm install
cd backend && npm install && cd ..
```

### Étape 2: Configuration MongoDB

#### Option A: MongoDB Atlas (Cloud)

```bash
# 1. Créer un compte sur mongodb.com/cloud
# 2. Créer un cluster MongoDB (Free Tier disponible)
# 3. Créer un utilisateur:
#    - Username: workflow_user
#    - Password: [Generate secure password]
# 4. Obtenir l'URI de connexion
```

#### Option B: MongoDB Localement (Docker Recommandé)

```bash
# Installation Docker (Windows/Mac/Linux)
# https://www.docker.com/products/docker-desktop

# Lancer MongoDB dans Docker
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=password \
  mongo:7.0

# Vérifier la connexion
mongosh "mongodb://admin:password@localhost:27017"
```

#### Option C: MongoDB Installation Directe

```bash
# Windows (via Chocolatey)
choco install mongodb

# macOS (via Homebrew)
brew tap mongodb/brew
brew install mongodb-community

# Linux (Ubuntu/Debian)
sudo apt-get install -y mongodb

# Lancer le service
sudo systemctl start mongod
sudo systemctl enable mongod
```

### Étape 3: Configuration Environnement

Créer le fichier `.env` à la racine du projet:

```env
# ============================================================================
# MONGODB
# ============================================================================
MONGODB_URI=mongodb+srv://workflow_user:YOUR_PASSWORD@cluster.mongodb.net/workflow_db
MONGODB_TEST_URI=mongodb://localhost:27017/workflow_db_test

# ============================================================================
# SÉCURITÉ
# ============================================================================
JWT_SECRET=votre_secret_jwt_très_sécurisé_minimum_32_caractères
JWT_EXPIRATION=24h
REFRESH_TOKEN_SECRET=votre_refresh_secret_très_sécurisé
REFRESH_TOKEN_EXPIRATION=7d

# Clé de chiffrement pour les API Keys (32 bytes = 256 bits)
# Générer: openssl rand -hex 16 | tr '[:lower:]' '[:upper:]'
ENCRYPTION_KEY=YOUR_32_CHARACTER_HEX_KEY_HERE_1234567890AB

BCRYPT_ROUNDS=10

# ============================================================================
# APPLICATION
# ============================================================================
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:4000

# ============================================================================
# LLM LOCAL (Optionnel - pour tests sans cloud API)
# ============================================================================
LMSTUDIO_BASE_URL=http://localhost:1234
OLLAMA_BASE_URL=http://localhost:11434
```

### Étape 4: Initialisation de la Base de Données

```bash
# Le backend initialise automatiquement les collections et indexes
# lors du premier démarrage (voir backend/src/services/databaseInit.ts)

# Démarrer le backend
cd backend
npm run dev

# Vérifier dans les logs:
# ✅ MongoDB connecté avec succès
# ✅ Collections créées
# ✅ Indexes créés
```

### Étape 5: Vérification de la Connexion

```bash
# Via MongoDB Compass (GUI)
# 1. Télécharger: https://www.mongodb.com/products/tools/compass
# 2. Connexion URI: mongodb://localhost:27017
# 3. Vérifier les collections

# Via CLI mongosh
mongosh "mongodb://localhost:27017"
> use workflow_db
> db.users.countDocuments()
> db.llm_configs.find().pretty()
```

---

## Modèles et Collections

### 1. Collection: `users`
**Portée**: Utilisateurs authentifiés du système

```typescript
{
  _id: ObjectId,
  email: string,              // Unique, lowercase
  password: string,           // Bcrypt hash (10 rounds)
  role: 'admin' | 'user' | 'viewer',
  isActive: boolean,
  createdAt: Date,
  updatedAt: Date,
  lastLogin?: Date,
  
  // ⭐ Phase 1: Multi-workflows support
  defaultWorkflowId?: ObjectId,    // Référence au workflow par défaut
  workflowCount: number,           // Compteur workflows (dénormalisé)
  lastActiveWorkflowId?: ObjectId  // Dernier workflow utilisé
}
```

**Indexes**:
- Unique sur `email`
- Composite: `(isActive, createdAt)`

**Opérations Courantes**:
```javascript
// Créer utilisateur
db.users.insertOne({
  email: "user@example.com",
  password: "$2b$10$...",  // Hasié via bcrypt
  role: "user",
  isActive: true,
  workflowCount: 0
});

// Récupérer par JWT (userId dans token)
db.users.findOne({ _id: ObjectId("...") });
```

---

### 2. Collection: `llm_configs`
**Portée**: Configurations des fournisseurs LLM (Cloud & Local)  
**Restriction**: ✅ Authentifiés uniquement

**Structure**:

```typescript
{
  _id: ObjectId,
  userId: ObjectId,              // Référence utilisateur (FK)
  provider: string,              // "OpenAI", "Gemini", "LLM local (on premise)", etc.
  enabled: boolean,
  
  // Cloud providers
  apiKeyEncrypted?: string,      // Chiffré avec AES-256-GCM
  
  // Local providers
  localEndpoint?: string,        // http://localhost:1234 (plaintext, not encrypted)
  
  capabilities: {                // Capacités du fournisseur
    Chat: boolean,
    "Function Calling": boolean,
    "Image Generation": boolean,
    // ... 10+ autres capacités
  },
  
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- Unique composite: `(userId, provider)` - 1 config par provider par utilisateur
- Simple: `enabled` - filtrage configurations actives

**Caractéristiques Sécurité**:
- **API Keys**: Chiffrées côté backend (AES-256-GCM)
- **Endpoints locaux**: Stockés en plaintext (URLs publiques)
- **Frontend masquage**: API keys retournées comme `••••••••` (FrontEndMasking pattern)

**Opérations Courantes**:
```javascript
// Récupérer configs activées d'un utilisateur
db.llm_configs.find({
  userId: ObjectId("user_id"),
  enabled: true
});

// Ajouter config OpenAI
db.llm_configs.insertOne({
  userId: ObjectId("user_id"),
  provider: "OpenAI",
  enabled: true,
  apiKeyEncrypted: "<encrypted_key>",
  capabilities: { Chat: true, "Function Calling": true, ... }
});
```

---

### 3. Collection: `workflows`
**Portée**: Workflows (canvas de noeuds agents)  
**Restriction**: ✅ Authentifiés uniquement

```typescript
{
  _id: ObjectId,
  userId: ObjectId,              // Propriétaire du workflow
  name: string,                  // "My AI Pipeline", etc.
  description?: string,
  isActive: boolean,             // Workflow actuellement actif
  isDefault: boolean,            // ⭐ Un seul par utilisateur
  
  // ⭐ État du canvas
  canvasState: {
    zoom: number,                // 0.5 à 3.0
    panX: number,                // Position X du pan
    panY: number                 // Position Y du pan
  },
  
  isDirty: boolean,              // Modifications non sauvegardées
  lastEditedBy?: string,         // user._id pour audit
  lastSavedAt?: Date,
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- Composite: `(userId, isActive)` - un seul workflow actif
- Composite: `(userId, updatedAt DESC)` - workflows récents
- Unique composite spark: `(userId, isDefault)` avec filtre partiel

**Opérations Courantes**:
```javascript
// Récupérer workflows utilisateur
db.workflows.find({ userId: ObjectId("user_id") })
  .sort({ updatedAt: -1 });

// Obtenir workflow actif
db.workflows.findOne({
  userId: ObjectId("user_id"),
  isActive: true
});

// Créer workflow par défaut
db.workflows.insertOne({
  userId: ObjectId("user_id"),
  name: "Default Workflow",
  isDefault: true,
  isActive: true,
  canvasState: { zoom: 1, panX: 0, panY: 0 }
});
```

---

### 4. Collection: `agent_prototypes`
**Portée**: Prototypes d'agents réutilisables  
**Restriction**: ✅ Authentifiés uniquement

```typescript
{
  _id: ObjectId,
  userId: ObjectId,              // Créateur du prototype
  workflowId?: ObjectId,         // ⭐ V2: Portée workflow optional
  
  name: string,                  // "Data Analyzer", "Code Generator", etc.
  role: string,                  // "analyste", "développeur", etc.
  systemPrompt: string,          // Instruction système pour le LLM
  
  llmProvider: string,           // "OpenAI", "LLM local (on premise)", etc.
  llmModel: string,              // "gpt-4", "claude-opus", "mistral-7b", etc.
  
  capabilities: [string],        // ["Chat", "Function Calling", "Image Generation"]
  tools?: Tool[],                // Outils disponibles (format JSON)
  historyConfig?: HistoryConfig, // Config gestion historique messages
  outputConfig?: OutputConfig,   // Format de sortie attendu
  
  robotId: string,               // "AR_001", "BOS_001", etc.
  isPrototype: true,
  
  // ⭐ Persistance granulaire
  persistenceConfig: {
    saveChat: boolean,           // Sauvegarder messages (défaut: true)
    saveErrors: boolean,         // Sauvegarder erreurs (défaut: true)
    saveHistorySummary: boolean,
    saveLinks: boolean,
    saveTasks: boolean,
    mediaStorage: 'db' | 'local' | 'cloud',
    retentionDays?: number       // Durée conservation
  },
  
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- Simple: `userId` - prototypes d'un utilisateur
- Composite: `(userId, workflowId)` - prototypes d'un workflow
- Composite: `(userId, updatedAt DESC)` - prototypes récents

---

### 5. Collection: `agent_instances`
**Portée**: Instances (exécutions) des prototypes  
**Restriction**: ✅ Authentifiés uniquement

```typescript
{
  _id: ObjectId,
  userId: ObjectId,
  workflowId: ObjectId,          // FK workflows
  agentPrototypeId: ObjectId,    // FK agent_prototypes
  
  name: string,                  // Instance name
  status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped',
  
  configuration_json: {          // Configuration au moment Instance
    role: string,
    llmProvider: string,
    llmModel: string,
    systemPrompt: string,
    tools: Tool[],
    outputConfig: OutputConfig
  },
  
  executionStats: {
    startedAt?: Date,
    completedAt?: Date,
    durationMs?: number,
    messagesCount: number,
    tokensUsed?: number,
    costEstimate?: number
  },
  
  persistenceConfig: {           // Config persistance granulaire
    saveChat: boolean,
    saveErrors: boolean,
    // ... autres options
  },
  
  createdAt: Date,
  updatedAt: Date
}
```

---

### 6. Collection: `agent_journals`
**Portée**: Journaux d'exécution des instances (logs, messages, erreurs)  
**Restriction**: ✅ Authentifiés uniquement  
**Caractéristique**: Collection "lourde" (peut être très grande)

```typescript
{
  _id: ObjectId,
  agentInstanceId: ObjectId,     // FK agent_instances
  workflowId: ObjectId,          // Dénormalisé pour nettoyage en cascade
  
  type: 'chat' | 'error' | 'media' | 'task' | 'system',
  severity: 'info' | 'warning' | 'error' | 'critical',
  
  timestamp: Date,               // Quand l'événement s'est produit
  sessionId?: string,            // Groupement logique (ex: web search session)
  
  // Payload polymorphe selon type
  payload: {
    // Pour 'chat':
    role?: 'user' | 'agent' | 'tool',
    content?: string,
    llmProvider?: string,
    modelUsed?: string,
    tokensUsed?: number,
    imageBase64?: string,        // Images inline
    
    // Pour 'error':
    errorCode?: string,
    message?: string,
    source?: 'llm_service' | 'tool_executor' | 'frontend',
    retryable?: boolean,
    
    // Pour 'media':
    mimeType?: string,
    fileName?: string,
    size?: number,
    storageMode?: 'database' | 'local' | 'cloud',
    
    // ... autres
  },
  
  _deduplicationKey?: string,    // Hash pour éviter doublons
  _createdAt: Date
}
```

**Indexes**:
- Composite: `(agentInstanceId, timestamp ASC)` - récupération chronologique
- Simple: `type` - filtrage par type
- TTL: `_createdAt` avec 90 jours expiration (auto-suppression)

---

### 7. Collection: `user_settings`
**Portée**: Préférences utilisateur  
**Restriction**: ✅ Authentifiés uniquement

```typescript
{
  _id: ObjectId,
  userId: ObjectId,              // Unique FK users
  
  theme: 'light' | 'dark',       // Thème UI
  language: 'en' | 'fr',         // Langue UI
  
  saveMode: 'manual' | 'auto',   // Fréquence sauvegarde workflows
  saveInterval?: number,         // Intervalle si auto (ms)
  
  notifications: {
    email: boolean,
    browser: boolean,
    sound: boolean
  },
  
  defaultLLMProvider?: string,   // Provider par défaut
  defaultModel?: string,         // Modèle par défaut
  
  createdAt: Date,
  updatedAt: Date
}
```

---

### 8-13. Collections Annexes

**Voir modèles complets**: `backend/src/models/`

| Collection | Purpose | Restriction |
|------------|---------|------------|
| `agent_templates` | Bibliothèque d'agents pré-configurés | Public/Authentifiés |
| `workflow_nodes` | Nœuds du canvas (V1 legacy) | Authentifiés |
| `workflow_edges` | Connexions entre nœuds (V1 legacy) | Authentifiés |
| `workflow_nodes_v2` | Nœuds V2 (référence prototype) | Authentifiés |
| `media_references` | Métadonnées images/fichiers | Authentifiés |

---

## Patterns de Persistance

### Pattern 1: Hydratation Guest vs Authentifiés

```
GUEST MODE (localStorage)
├── App.tsx initialLLMConfigs
├── SettingsModal charge depuis localStorage
├── Zéro chiffrement (dev only)
└── Persiste jusqu'à fermeture navigateur

AUTHENTICATED MODE (MongoDB)
├── AuthContext reçoit JWT
├── useRuntimeStore obtient llmConfigs d'API
├── Backend retourne configs depuis llm_configs
├── API Keys masquées (••••••••)
├── Persiste indéfiniment
└── Chiffrement AES-256-GCM
```

### Pattern 2: Cycle de Vie Données LLM Configs

```
Frontend (User enters endpoint/key)
  ↓
SettingsModal handleSave()
  ├─ Validation Zod
  ├─ Call useLLMConfigs.updateConfig()
  │   ↓
  │ API POST /api/llm-configs
  │   ├─ Middleware: Vérifier JWT (utilisateur authentifié)
  │   ├─ Chiffrer apiKey (si fourni)
  │   ├─ Valider localEndpoint (pas de chiffrement)
  │   ├─ Upsert dans llm_configs
  │   └─ Retourner config avec apiKey masqué
  │   ↓
  └─ Frontend met à jour useRuntimeStore
  
Utilisation en Chat:
  ├─ V2AgentNode demande credential via getEffectiveCredential()
  ├─ Backend déchiffre apiKey (ou utilise endpoint directement)
  └─ LLM streaming utilise credential non-chiffré
```

### Pattern 3: Auto-Sauvegarde Workflows

```
User modifie workflow (drag node, change config)
  ↓
WorkflowCanvasContext notifie changement
  ↓
useWorkflowPersistence.tsx
  ├─ Debounce 2000ms (éviter save excessif)
  ├─ Marquer isDirty = true
  └─ Auto-save trigger
     ↓
     POST /api/workflows/:id
       ├─ JWT verification
       ├─ PATCH MongoDB (modifications uniquement)
       ├─ Retourner success
       └─ Frontend: isDirty = false
```

### Pattern 4: Cascade Deletion (Garbage Collection)

```
DELETE /api/workflows/:id
  ├─ Supprimer document workflow
  ├─ Trigger: Supprimer agent_instances liées
  │   └─ Trigger: Supprimer agent_journals (TTL policy)
  └─ Frontend: Recharger la liste workflows
```

---

## Authentification et Permissions

### Modèle de Sécurité

```
┌─────────────────────────────────────┐
│ FRONTEND: localStorage              │
├─────────────────────────────────────┤
│ accessToken (JWT, 24h)              │
│ refreshToken (JWT, 7d)              │
│ userId (plaintext)                  │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│ BACKEND: Middleware Passport        │
├─────────────────────────────────────┤
│ 1. Extraire Authorization header    │
│ 2. Vérifier signature JWT           │
│ 3. Décoder payload (userId, role)   │
│ 4. Attacher à req.user              │
│ 5. Vérifier permissions pour route  │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│ MONGODB: Queries                    │
├─────────────────────────────────────┤
│ where userId = req.user._id         │
│ (jamais exposer données autres)     │
└─────────────────────────────────────┘
```

### Vérification Permissions

**Principe**: Propriété = userId

```javascript
// Route: GET /api/workflows/:id
router.get('/:id', passport.authenticate('jwt'), async (req, res) => {
  const workflow = await Workflow.findById(req.params.id);
  
  // Vérifier: workflow appartient à utilisateur authentifié
  if (!workflow || !workflow.userId.equals(req.user._id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  // ✅ Appartient à utilisateur → retourner données
  res.json(workflow);
});
```

### Types d'Authentification Supportés

| Type | Endpoint | Expiration | Usage |
|------|----------|-----------|-------|
| **JWT Access** | POST /api/auth/login | 24h | API calls |
| **JWT Refresh** | POST /api/auth/refresh | 7d | Obtenir nouveau access token |
| **Session** | Cookie (OPTIONAL) | Variable | Cross-origin (future) |

---

## Hydratation des Données

### Stratégie Hydratation Frontend

```typescript
// App.tsx initialization

// 1. Charger config MÀJ utilisateur
const loadLLMConfigs = async (isAuthenticated: boolean) => {
  if (!isAuthenticated) {
    // Guest mode: récupérer localStorage
    return JSON.parse(localStorage.getItem('llmConfigs') || '[]');
  }
  
  // Authenticated: récupérer MongoDB via API
  const response = await fetch('/api/llm-configs', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return response.json();  // Array of LLMConfig
};

// 2. Merger API configs avec defaults (initialLLMConfigs)
const mergedConfigs = initialLLMConfigs.map(initial => {
  const apiConfig = apiConfigs.find(c => c.provider === initial.provider);
  
  if (!apiConfig) return initial;  // Pas dans BD → utiliser défaut
  
  return {
    ...initial,
    ...apiConfig,
    localEndpoint: apiConfig.localEndpoint,  // ⭐ CRITICAL FIX
    capabilities: merge(initial.capabilities, apiConfig.capabilities)
  };
});

// 3. Mettre à useRuntimeStore pour composant accès
updateLLMConfigs(mergedConfigs);
```

### Points d'Hydratation Critiques

| Point | Déclencheur | Risque |
|-------|-------------|--------|
| **AuthContext.login()** | JWT reçu | LocalStorage non nettoyé → désync |
| **App.tsx useEffect(isAuth)** | Changement authentification | llmConfigs peut être vide brief |
| **SettingsModal open** | Utilisateur clique settings | Données obsolètes si pas refresh |

**Mitigation**:
```typescript
// Toujours rafraîchir auth avant chaque requête sensible
const { user, refreshLLMApiKeys } = useAuth();

useEffect(() => {
  if (user) {
    refreshLLMApiKeys();  // Tirer données fraîches du backend
  }
}, [user?.id]);
```

---

## Gestion des Indexs

### Stratégie Indexation

**Objectifs**:
1. ✅ Requêtes rapides (< 10ms)
2. ✅ Minimal storage overhead
3. ✅ Éviter replication lag

### Index Par Collection

```javascript
// users
db.users.getIndexes();
/*
[
  { _id: 1 },
  { email: 1, unique: true },
  { isActive: 1, createdAt: 1 }
]
*/

// llm_configs
/*
[
  { _id: 1 },
  { userId: 1, provider: 1, unique: true },
  { enabled: 1 }
]
*/

// workflows
/*
[
  { _id: 1 },
  { userId: 1, isActive: 1 },
  { userId: 1, updatedAt: -1 },
  { userId: 1, isDefault: 1, unique: true, sparse: true }
]
*/

// agent_instances
/*
[
  { _id: 1 },
  { workflowId: 1 },
  { userId: 1, workflowId: 1 },
  { status: 1 }
]
*/

// agent_journals (TTL Index)
/*
[
  { _id: 1 },
  { agentInstanceId: 1, timestamp: 1 },
  { type: 1 },
  { _createdAt: 1, expireAfterSeconds: 7776000 }  // 90 jours
]
*/
```

### Monitoring Indexes

```bash
# Via MongoDB Compass: Indexes tab

# Via mongosh CLI
db.llm_configs.stats()
/*
{
  "ns": "workflow_db.llm_configs",
  "size": 8192,
  "count": 2,
  "indexSizes": {
    "_id_": 4096,
    "userId_1_provider_1": 4096,
    "enabled_1": 4096
  }
}
*/

# Exécution plans requête (avant optimization)
db.llm_configs.find({ userId: "...", enabled: true }).explain("executionStats");
```

---

## Opérations Courantes

### Opération 1: Créer Utilisateur et Configurer LLM

```javascript
// ÉTAPE 1: Créer utilisateur via POST /api/auth/register
// Frontend → Backend fait ceci:

const user = new User({
  email: "developer@example.com",
  password: bcrypt.hashSync("SecurePassword123!", 10),
  role: "user",
  isActive: true,
  workflowCount: 0
});
await user.save();

// ÉTAPE 2: Récupérer JWT
const token = jwt.sign(
  { userId: user._id, email: user.email },
  JWT_SECRET,
  { expiresIn: '24h' }
);

// ÉTAPE 3: Frontend loggué, créer LLM Config
// POST /api/llm-configs
{
  "provider": "OpenAI",
  "enabled": true,
  "apiKey": "sk-..." // Frontend envoie, backend chiffre
}

// Backend côté:
const config = new LLMConfig({
  userId: req.user._id,
  provider: "OpenAI",
  enabled: true
});
config.setApiKey("sk-...");  // Chiffre et stocke
await config.save();
```

### Opération 2: Charger Workflow Utilisateur

```javascript
// GET /api/workflows
// Backend retourne:

const workflows = await Workflow.find({
  userId: req.user._id
}).sort({ updatedAt: -1 });

[
  {
    _id: ObjectId("..."),
    userId: ObjectId("user_id"),
    name: "Data Pipeline",
    isActive: true,
    isDefault: true,
    canvasState: { zoom: 1.2, panX: 100, panY: 50 },
    createdAt: "2026-03-05T10:00:00Z"
  }
]
```

### Opération 3: Persister Message Chat

```javascript
// POST /api/agent-instances/:id/journal
{
  "type": "chat",
  "severity": "info",
  "payload": {
    "role": "user",
    "content": "Analyze this data",
    "imageBase64": "data:image/png;base64,iVBORw0KGgo..."
  }
}

// Backend crée:
const entry = new AgentJournal({
  agentInstanceId: ObjectId("instance_id"),
  workflowId: ObjectId("workflow_id"),
  type: "chat",
  severity: "info",
  timestamp: new Date(),
  sessionId: "session_123",
  payload: { ... },
  _deduplicationKey: sha256("instance_id:user:content"),
  _createdAt: new Date()
});
await entry.save();

// TTL Index va auto-expirer après 90 jours
```

### Opération 4: Récupérer Historique Conversation

```javascript
// GET /api/agent-instances/:id/journal?type=chat&limit=50
// Backend retourne (paginated):

const entries = await AgentJournal
  .find({
    agentInstanceId: ObjectId("instance_id"),
    type: "chat"
  })
  .sort({ timestamp: 1 })  // Chronologique (ancien → récent)
  .limit(50);

// Frontend utilise pour afficher chat messages
```

---

## Troubleshooting

### Problème 1: "MongoDB connection refused"

```bash
# Vérifier que MongoDB est running
docker ps | grep mongodb

# Vérifier URI dans .env
echo $MONGODB_URI

# Test connexion directe
mongosh "YOUR_MONGODB_URI"

# Si local Docker:
docker start mongodb  # Relancer
```

### Problème 2: "Unauthorized" sur API authentifiée

```typescript
// Vérifier JWT token:
const token = localStorage.getItem('accessToken');
console.log('Token:', token);
console.log('Headers:', { Authorization: `Bearer ${token}` });

// Peut être expiré:
// Solution: Utiliser POST /api/auth/refresh pour obtenir nouveau token
```

### Problème 3: "Unique constraint violation" sur llm_configs

```bash
# Causé par: 2 configs du même provider pour même utilisateur
# Solution: Vérifier qu'un seul OpenAI config existe

db.llm_configs
  .find({ userId: ObjectId("user_id"), provider: "OpenAI" })
  .pretty();

# Si doublons, supprimer un:
db.llm_configs.deleteOne({ _id: ObjectId("...") });
```

### Problème 4: "Hydration mismatch" (Frontend/Backend désync)

```typescript
// Cause: localStorage différent de MongoDB
// Solution: Forcer refresh
const { refreshLLMApiKeys } = useAuth();
refreshLLMApiKeys();  // Retirer depuis backend

// Vérifier logs:
console.log('localStorage:', JSON.parse(localStorage.getItem('llmConfigs')));
console.log('runtime store:', useRuntimeStore().llmConfigs);
```

---

## Références et Ressources

### Documentation Officielle
- [MongoDB Docs](https://docs.mongodb.com)
- [Mongoose Docs](https://mongoosejs.com)
- [JWT.io](https://jwt.io)

### Code Source
- **Models**: `backend/src/models/`
- **Routes**: `backend/src/routes/`
- **Services**: `backend/src/services/`
- **Database Config**: `backend/src/config/database.ts`

### Patterns Architecturaux
- **SOLID Principles**: Single Responsibility, Open/Closed, Dependency Inversion
- **Encryption Strategy**: AES-256-GCM pour API Keys, plaintext pour endpoints locaux
- **TTL Indexes**: Auto-cleanup agent_journals après 90 jours

---

## Checklist pour Développeurs

- [ ] `.env` configuré avec `MONGODB_URI`
- [ ] MongoDB accessible (`mongosh` fonctionne)
- [ ] Backend démarre sans erreur MongoDB
- [ ] Collections créées automatiquement
- [ ] Indexes visibles dans MongoDB Compass
- [ ] JWT tokens valides après login
- [ ] `llm_configs` persiste après SettingsModal save
- [ ] Chat messages sauvegardés dans `agent_journals`
- [ ] Historique chargé correctement après page reload

---

**Document Version**: 1.0  
**Dernière mise à jour**: Mars 2026  
**Auteur**: Architecture Team  
**Status**: ✅ Production Ready
