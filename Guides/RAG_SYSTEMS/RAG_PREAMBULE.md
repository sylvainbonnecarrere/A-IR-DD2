# RAG_PREAMBULE : Bienvenue dans A-IR-DD2

> **Document d'accueil pour les architectes spécialisés en systèmes RAG (Retrieval-Augmented Generation)**
>
> *Édition février 2026 - Application A-IR-DD2 v4.9*

---

## 📖 Table des Matières

1. [Vue d'Ensemble](#vue-densemble)
2. [Objectifs & Vision](#objectifs--vision)
3. [Architecture Globale](#architecture-globale)
4. [Stack Technique](#stack-technique)
5. [Les 5 Robots Spécialisés](#les-5-robots-spécialisés)
6. [Intégration des RAG](#intégration-des-rag)
7. [Flux de Données RAG](#flux-de-données-rag)
8. [Cas d'Usage & Scénarios](#cas-dusage--scénarios)
9. [Bonnes Pratiques & Patterns](#bonnes-pratiques--patterns)
10. [Roadmap RAG Integrations](#roadmap-rag-integrations)

---

## 🎯 Vue d'Ensemble

### Qu'est-ce que A-IR-DD2 ?

**A-IR-DD2** (AI Robot Design & Development System V2) est une **plateforme d'orchestration de workflows multi-LLM de nouvelle génération** conçue pour :

- **Créer** des agents IA spécialisés via des prototypes visuels
- **Orchestrer** des workflows complexes avec 5 robots spécialisés
- **Exécuter** du code Python, d'appels API, et des tâches asynchrones
- **Gérer** des bases de données vectorielles et des RAGs
- **Gouverner** les utilisateurs, les permissions, et les coûts en temps réel

L'application combine les paradigmes de :
- **N8N** (orchestration visuelle de workflows)
- **CrewAI** (systèmes multi-agents spécialisés)
- **LangChain/LlamaIndex** (gestion de contexte et chaînes de traitement)

### En une phrase

*Une plateforme SaaS où des utilisateurs créent et exécutent des workflows d'agents IA avec gestion multi-RAG, gouvernance granulaire, et monitoring en temps réel.*

---

## 🚀 Objectifs & Vision

### Objectifs Court Terme (J4.x - 2026)

1. ✅ **Authentification & Persistance** (J4.9 complété)
   - JWT + refresh tokens
   - Chiffrement AES-256-GCM des clés API
   - Stockage des préférences utilisateur en MongoDB

2. 🔄 **Intégration Multi-RAG** (Phase actuelle)
   - Support de Qdrant, Pinecone, Milvus, Weaviate
   - Configuration via l'interface COM (Connector Hub)
   - Gestion des collections vectorielles par Phil (RAG Configuration)

3. 🤖 **Agents Contextuels** (Prochain)
   - Agents avec accès RAG intégré
   - Auto-summarization for token optimization
   - Context window management

### Objectifs Long Terme (Roadmap 2026-2027)

1. **Hybrid RAG Architecture**
   - Dense retrieval + BM25 + semantic search
   - Multi-hop reasoning avec agents chaining

2. **Fine-tuning & Model Adaptation**
   - Adaptation de modèles spécialisés par domaine
   - LoRA/QLoRA avec integration dans les workflows

3. **Edge & On-Premise Deployment**
   - Support Docker Compose pour déploiement local
   - LMStudio integration (local LLM running)
   - Offline RAG indexing

---

## 🏗️ Architecture Globale

### 1. Séparation Domain-Driven Design (DDD)

L'application respecte une **séparation stricte** entre deux domaines :

```
┌─────────────────────────────────────────────────────┐
│                  DESIGN DOMAIN                      │
│                                                     │
│  Responsabilité : Prototypes, définitions          │
│  Persistance : JSON-serializable                   │
│  Store : useDesignStore (Zustand)                  │
│  Étendue : Agents, Workflows, RAG Configs          │
│  Nature : STATIC, VERSIONNÉE                       │
│                                                     │
└─────────────────────────────────────────────────────┘
                         ↕️ Transformation
┌─────────────────────────────────────────────────────┐
│                 RUNTIME DOMAIN                      │
│                                                     │
│  Responsabilité : Exécution, états volatiles       │
│  Persistance : In-memory + WebSocket sync          │
│  Store : useRuntimeStore (Zustand)                 │
│  Étendue : Instances actives, chats en cours       │
│  Nature : DYNAMIC, EPHEMERAL (+ audit logs)        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**⚠️ Règle Critique** : Ne JAMAIS mélanger les responsabilités.
- ❌ Mauvais : Stocker l'état d'exécution dans les prototypes
- ✅ Bon : Prototype (Design) → Instance (Runtime)

### 2. Architecturé par Robots Spécialisés

Chaque robot gère un domaine métier spécifique :

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│  UTILISATEUR (via Interface Web)                          │
│         ↓                                                  │
├─────────────────────────────────────────────────────────── │
│  ARCHI (AR_001)        │ DESIGN PROTOTYPES                 │
│  → Création agents     │ Agent prototypes, Tools, Workflows
│  → Orchestration       │ Governance (creator_id, versions)
│                        │                                  │
│  BOS (BO_002)          │ RUNTIME MONITORING               │
│  → Live monitoring     │ Execution traces, Costs, Metrics │
│  → Analytics & Coûts   │ Public playground for demos      │
│                        │                                  │
│  COM (CO_003)          │ EXTERNAL INFRASTRUCTURE          │
│  → API connections     │ REST/GraphQL endpoints           │
│  → SQL/NoSQL DBs       │ PostgreSQL, MySQL, MongoDB       │
│  → Vector DBs          │ Qdrant, Pinecone, Milvus, ...   │
│  → MCP Integrations    │ Model Context Protocol servers   │
│                        │                                  │
│  PHIL (PH_004)         │ DATA & RAG LAYER                 │
│  → RAG Configuration   │ Vector collections, Embeddings   │
│  → File handling        │ Knowledge base management        │
│  → Custom functions    │ Data transformations             │
│  → External libraries  │ Library imports & integration    │
│                        │                                  │
│  TIM (TI_005)          │ ASYNC & SCHEDULING               │
│  → Triggers & Webhooks │ Event-driven execution           │
│  → Scheduling          │ CRON jobs and polling            │
│  → Rate limiting       │ Throttling & backpressure        │
│  → Async tasks         │ Background jobs & queues         │
│                        │                                  │
└────────────────────────────────────────────────────────────┘
         ↓
    BACKEND
    - Express server (Node.js)
    - Python executor
    - LLM services dispatcher
    - WebSocket for real-time sync
```

### 3. Communication Inter-domaines

```typescript
// Flux typique d'exécution
1. Utilisateur selectionne un Agent (DESIGN via Archi)
   ↓
2. Instancie l'agent (transformation DESIGN → RUNTIME)
   ↓
3. Lance une instance (Bos observe via WebSocket)
   ↓
4. Instance charge contexte RAG (Com accède vector DBs, Phil gère collections)
   ↓
5. Agent appelle LLM avec système RAG enrichi
   ↓
6. Résultat et coûts remontés vers Bos (monitoring)
   ↓
7. Historique vers MongoDB (audit trail)
```

---

## 💾 Stack Technique

### Frontend (Vite + React 18 + TypeScript)

```
├─ React 18.2.0         │ UI framework
├─ TypeScript 5.2.2     │ Type safety
├─ Vite 6.4.1           │ Build tool (HMR, optimization)
├─ Zustand              │ State management (Design + Runtime stores)
├─ React Flow           │ Canvas for visual workflows
├─ Tailwind CSS         │ Styling
├─ Framer Motion        │ Animations
├─ Zod                  │ Schema validation for forms/APIs
├─ i18n (custom)        │ Internationalization (5 languages)
└─ Vitest + RTL         │ Testing framework
```

**Structure Frontend** :
```
src/
├─ App.tsx              # Entry point, layout master
├─ types.ts             # Centralized type definitions
├─ components/          # React components
│  ├─ (UI atoms)        # Icons, buttons, panels
│  ├─ RobotPageRouter   # Route to each robot's menu
│  ├─ ArchiPrototypingPage  # Agent CRUD
│  ├─ ComApiPage        # API connections + Vector DBs
│  ├─ PhilDataPage      # RAG Configuration
│  ├─ TimEventsPage     # Triggers & scheduling
│  └─ BosSubMenu        # Monitoring & analytics
├─ services/            # LLM + API service layer
│  ├─ llmService.ts     # Dispatcher (provider routing)
│  ├─ openAIService.ts  # OpenAI provider
│  ├─ geminiService.ts  # Google Gemini provider
│  └─ ...               # Other providers
├─ stores/              # Zustand stores
│  ├─ useDesignStore    # Prototypes (agents, workflows)
│  ├─ useRuntimeStore   # Instances (active chats)
│  └─ useAuthStore      # User auth + settings
├─ hooks/               # Custom React hooks
├─ i18n/                # Localization keys
└─ utils/               # Helpers, validators
```

### Backend (Node.js + Express + MongoDB)

```
├─ Node.js 24.8.0       │ Runtime
├─ TypeScript 5.2.2     │ Type safety
├─ Express 4.18.2       │ HTTP server framework
├─ MongoDB 6.0+         │ Document database (MANDATORY)
├─ Mongoose 7.5.0       │ Schema & validation layer
├─ JWT 9.1.0            │ Authentication
├─ bcrypt               │ Password hashing
├─ Helmet               │ Security headers (CORS, CSP)
├─ child_process        │ Python executor
└─ Jest                 │ Testing framework
```

**Structure Backend** :
```
backend/src/
├─ server.ts            # Express entry point
├─ config.ts            # Whitelisted Python tools, env vars
├─ pythonExecutor.ts    # Execute Python scripts safely
├─ routes/              # API endpoints
│  ├─ auth.ts           # Login, register, refresh
│  ├─ agents.ts         # CRUD agents (Archi)
│  ├─ workflows.ts      # CRUD workflows
│  ├─ executePython.ts  # POST /api/execute-python-tool
│  └─ ...
├─ models/              # MongoDB schemas
│  ├─ User.ts           # User + encrypted API keys
│  ├─ Agent.ts          # Agent prototype
│  ├─ Workflow.ts       # Workflow definition
│  ├─ VectorDB.ts       # Vector DB credentials
│  └─ RAGConfig.ts      # RAG settings per user
├─ services/            # Business logic
│  ├─ authService.ts    # JWT + encryption
│  ├─ agentService.ts   # Agent CRUD logic
│  ├─ vectorDBService.ts # Vector DB connection pool
│  └─ ragService.ts     # RAG orchestration
├─ middleware/          # Express middleware
│  ├─ auth.ts           # JWT verification
│  ├─ errorHandler.ts   # Error catching
│  └─ validator.ts      # Zod schema validation
└─ utils/               # Helpers
```

### LLM Provider Architecture

**Contrat implicite (à formaliser)** :

```typescript
// Chaque provider DOIT implémenter :

export const generateContentStream = async function* (
  apiKey: string,
  model: string,
  systemInstruction: string,
  history: ChatMessage[],
  tools?: Tool[],
  outputConfig?: OutputConfig
): AsyncGenerator<StreamChunk>;

export const generateContent = async (
  apiKey: string,
  model: string,
  systemInstruction: string,
  history: ChatMessage[],
  tools?: Tool[],
  outputConfig?: OutputConfig
): Promise<{ text: string; toolCalls?: ToolCall[] }>;

// Optionnel (selon capabilities) :
export const generateImage = async (apiKey, prompt) => {...}
export const generateContentWithSearch = async (apiKey, model, prompt, systemInstruction) => {...}
export const editImage = async (apiKey, prompt, image) => {...}
```

**Providers actuellement supportés** :

| Provider | Chat | Function Calling | Image Gen | Web Search | Reasoning |
|----------|:----:|:----------------:|:---------:|:----------:|:---------:|
| OpenAI (GPT-4) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Gemini (Pro 2.0) | ✅ | ✅ | ❌ | ✅ | ✅ |
| Anthropic (Claude 4) | ✅ | ✅ | ❌ | ✅ | ✅ (Extended Thinking) |
| Mistral | ✅ | ✅ | ❌ | ❌ | ❌ |
| Grok | ✅ | ✅ | ❌ | ✅ | ❌ |
| Perplexity | ✅ | ❌ | ❌ | ✅ | ❌ |
| Qwen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Kimi K2 | ✅ | ✅ | ❌ | ❌ | ❌ |
| DeepSeek | ✅ | ✅ | ❌ | ❌ | ✅ |
| LMStudio (Local) | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## 🤖 Les 5 Robots Spécialisés

### ARCHI (AR_001) - Architecte & Prototype Designer

**Responsabilités** :
- Création et gestion des **prototypes agents** (CRUD)
- Conception des **workflows d'orchestration**
- Définition des **interconnexions inter-agents**
- Gestion des **versions et historiques** des prototypes
- **Gouvernance** : Validation `creator_id` pour les prototypes

**Interface Utilisateur** :
- Menu : `ArchiPrototypingPage` dans `components/ArchiSubMenu.tsx`
- Canvas : Sélection d'agents et construction de workflows
- Forms : `AgentFormModal.tsx`, `WorkflowFormModal.tsx`

**Domaine de Données** :
```typescript
interface Agent {
  id: string;
  name: string;
  description: string;
  creator_id: string;                // Validation ARCHI
  llmProvider: LLMProvider;
  llmModel: string;
  systemPrompt: string;
  tools: Tool[];                       // Array of callable tools
  contextConfig?: ContextConfig;       // Token management
  ragConfig?: RAGConfig;               // ← Intégration RAG
  metadata: {
    version: number;
    created_at: Date;
    updated_at: Date;
    tags: string[];
  };
}

interface Tool {
  id: string;
  name: string;
  description: string;
  type: 'python_script' | 'api_call' | 'rag_query' | 'webhook';
  handler: string;                     // Reference to handler
  parameters: JSONSchema;              // Zod schema
  returnType: 'text' | 'json' | 'file';
}
```

**Flux Typique (ARCHI)** :

```
1. Utilisateur crée Agent "Question Answerer"
   → Sélectionne LLM (Gemini Pro 2.0)
   → Ajoute Tools : [query_rag, format_output]
   → Configure RAG source : "Company Knowledge Base" (Qdrant)
   ↓
2. ARCHI persiste en MongoDB (designStore)
   ↓
3. Utilisateur instancie l'agent
   → DESIGN → RUNTIME (useRuntimeStore)
   ↓
4. Instance ouverte en chat
   → Attend messages utilisateur
   → Query RAG internally via Phil
   → Appelle LLM avec contexte enrichi
   → Retour réponse + sources
```

---

### BOS (BO_002) - Workflow Supervisor & Monitor

**Responsabilités** :
- **Monitoring en temps réel** des workflows actifs
- **Analytics & métriques** : tokens, latency, coûts
- **Debugging** : Logs d'exécution, stack traces
- **Governance** : Gestion des utilisateurs, MAJ permissions
- **Public Playground** : Démos publiques de workflows

**Interface Utilisateur** :
- Menu : `BosSubMenu.tsx`
- Dashboard : Monitoring en temps réel via WebSocket
- Analytics : Graphiques de coûts, performances

**Domaine de Données** :
```typescript
interface WorkflowExecution {
  id: string;
  workflow_id: string;
  user_id: string;
  status: 'running' | 'completed' | 'failed' | 'paused';
  started_at: Date;
  ended_at?: Date;
  
  metrics: {
    tokens_input: number;
    tokens_output: number;
    latency_ms: number;
    cost_usd: number;
    model_used: string;
  };
  
  logs: LogEntry[];           // Audit trail
  error?: {
    message: string;
    stack: string;
    context: Record<string, unknown>;
  };
}

interface LogEntry {
  timestamp: Date;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  component: string;          // Which robot/service
  message: string;
  context?: Record<string, unknown>;
}
```

**Flux Typique (BOS)** :

```
1. Instance lancée (RUNTIME domain)
   ↓
2. BOS observe via WebSocket
   → Reçoit events : "agent_started", "rag_query", "llm_call", "tool_executed"
   ↓
3. Chaque event enrichi avec metrics
   → Tokens, latency, coûts calculés
   ↓
4. Dashboard BOS mis à jour en temps réel
   → Graphiques live
   → Coûts accumulés
   ↓
5. À la fin de l'exécution
   → Report complet stocké en MongoDB
   → Statistiques par utilisateur
```

---

### COM (CO_003) - Connector Hub & External Infrastructure

**Responsabilités** :
- **API connections** : Configuration REST/GraphQL endpoints
- **SQL/NoSQL databases** : PostgreSQL, MySQL, MongoDB, ...
- **Vector databases** : Qdrant, Pinecone, Milvus, Weaviate, Couchbase
- **MCP integrations** : Model Context Protocol servers
- **Credentials management** : Chiffrement AES-256-GCM

**Interface Utilisateur** :
- Menu : `ComApiPage`, `ComConnectionsPage`, `ComDatabasesPage`
- Forms : `ApiConnectionListItem.tsx`, `DatabaseListItem.tsx`
- Panels : Test connections, validate credentials

**Domaine de Données (Design)** :
```typescript
interface ApiConnection {
  id: string;
  name: string;
  creator_id: string;                // Governance
  type: 'rest' | 'graphql' | 'webhook';
  baseUrl: string;
  headers?: Record<string, string>;
  authentication: AuthConfig;         // API key, JWT, OAuth
  metadata: {
    version: number;
    created_at: Date;
    updated_at: Date;
  };
}

interface VectorDatabaseConfig {
  id: string;
  name: string;
  creator_id: string;                // Governance
  type: 'qdrant' | 'pinecone' | 'milvus' | 'weaviate' | 'couchbase' | 'mongodb_atlas';
  
  credentials: {
    // Encrypted before storage
    host?: string;                   // For self-hosted
    apiKey?: string;
    projectId?: string;
    namespace?: string;
  };
  
  collections: VectorCollection[];
  
  config: {
    dimension: number;               // Vector embedding dimension
    distanceMetric: 'cosine' | 'euclidean' | 'dotproduct';
    searchMode: 'vector' | 'hybrid' | 'bm25';  // For Weaviate/Qdrant
  };
}

interface VectorCollection {
  id: string;
  name: string;
  vectorDb_id: string;
  documents_count: number;
  last_sync?: Date;
  metadata_filters?: Record<string, DataType>;  // For filtering
  embedding_model: string;           // e.g., "text-embedding-3-small"
}
```

**Flux Typique (COM)** :

```
1. Utilisateur configure Vector DB (Qdrant instance)
   → Nom : "Company Knowledge Base"
   → Host : "qdrant.example.com:6333"
   → API Key : [chiffré]
   ↓
2. COM créé VectorDatabaseConfig + ApiConnection
   → Stocké en MongoDB avec creator_id
   ↓
3. Phil peut maintenant accéder cette DB (voir plus bas)
   → Collections listées
   → Sync de documents possibles
```

---

### PHIL (PH_004) - Data Layer, RAG & Knowledge Base Manager

**Responsabilités** :
- **RAG Configuration** : Gestion des collections vectorielles
- **File handling** : Upload, processing, chunking
- **Knowledge base management** : Indexation, synchronisation
- **Data transformations** : Chunking strategies, metadata extraction
- **Custom functions** : Data processing pipelines
- **External libraries** : Imports et intégrations

**Interface Utilisateur** :
- Menu : `PhilDataPage` dans `components/PhilSubMenu.tsx`
- Sections :
  - RAG Collections Management
  - File Upload & Processing
  - Knowledge Base Sync
  - Data Transformation Configs

**Domaine de Données (Design)** :
```typescript
interface RAGConfig {
  id: string;
  name: string;
  creator_id: string;
  agent_id?: string;                 // Optional: linked to specific agent
  
  vectorDB: {
    id: string;                      // Reference to VectorDatabaseConfig
    collectionName: string;
  };
  
  retrieval: {
    embeddingModel: string;          // "text-embedding-3-small", "all-MiniLM-L6-v2"
    embeddingProvider: LLMProvider;   // OpenAI, Gemini, Mistral, ...
    topK: number;                    // Number of results to retrieve (default: 5)
    scoreThreshold?: number;         // Min similarity score (0.0-1.0)
    maxRetries: number;
    timeout_ms: number;
  };
  
  processing: {
    strategy: 'hybrid' | 'dense' | 'bm25' | 'semantic';
    chunkingStrategy: 'fixed' | 'semantic' | 'recursive';
    chunkSize: number;               // Tokens or chars
    chunkOverlap: number;
    extractMetadata: boolean;
    metadataFields: string[];
  };
  
  augmentation: {
    contextWindowSize: number;       // Max context to inject in prompt
    reranking?: {
      enabled: boolean;
      model: string;                 // e.g., "rerank-english-v2.0"
    };
    synthesis: 'direct' | 'reasoning' | 'multi-hop';  // Strategy
  };
  
  lifecycle: {
    version: number;
    created_at: Date;
    updated_at: Date;
    last_sync?: Date;
  };
}

interface DocumentChunk {
  id: string;
  content: string;
  vector: number[];                  // Embedding vector
  metadata: {
    source: string;
    document_id: string;
    page?: number;
    section?: string;
    created_at: Date;
  };
  statistics: {
    token_count: number;
    similarity_score?: number;        // Set during retrieval
  };
}
```

**Flux Typique (PHIL - RAG Configuration)** :

```
1. Utilisateur crée RAG Config "Company Knowledge Base"
   → Sélectionne Vector DB : Qdrant (from COM)
   → Collection : "kb-2026"
   → Embedding model : "text-embedding-3-small" (OpenAI)
   → Chunking : semantic, 512 tokens, 10% overlap
   → Retrieval : topK=5, hybrid search
   ↓
2. PHIL persiste RAGConfig en MongoDB
   ↓
3. Utilisateur sélectionne RAGConfig dans ARCHI
   → Associe à un Agent prototype
   ↓
4. Utilisateur upload documents (.pdf, .txt, .md)
   → PHIL processes :
     • Extraction de contenu
     • Chunking automatique
     • Génération d'embeddings (appel OpenAI)
     • Indexation dans Qdrant
   ↓
5. À l'runtime : Agent peut query RAG
   → Phil récupère des documents similaires
   → Injecte dans le contexte du LLM
```

---

### TIM (TI_005) - Triggers, Scheduling & Async Manager

**Responsabilités** :
- **Triggers & Webhooks** : Event-driven execution
- **Scheduling** : CRON jobs, periodic tasks
- **Rate limiting & backpressure** : Control flow
- **Async task management** : Queues, background jobs
- **Polling** : Regular checks for external state changes

**Interface Utilisateur** :
- Menu : `TimEventsPage` dans `components/TimSubMenu.tsx`
- Trigger configurations with cron expressions
- Queue monitoring, failed jobs retry

**Domaine de Données (Design)** :
```typescript
interface Trigger {
  id: string;
  name: string;
  creator_id: string;
  
  type: 'webhook' | 'schedule' | 'polling' | 'manual';
  
  // For 'webhook'
  webhook?: {
    endpoint: string;                // Public URL exposed by backend
    method: 'POST' | 'GET' | 'PUT';
    secret: string;                  // HMAC verification
    retryPolicy: {
      maxRetries: number;
      backoffMs: number;
    };
  };
  
  // For 'schedule'
  schedule?: {
    cronExpression: string;          // e.g., "0 9 * * MON-FRI"
    timezone: string;
    nextRun?: Date;
  };
  
  // For 'polling'
  polling?: {
    interval_ms: number;
    endpoint: string;
    condition: string;               // JS expression to check
  };
  
  // Action upon trigger
  action: {
    workflow_id: string;
    parameters?: Record<string, unknown>;
  };
  
  rateLimit?: {
    maxExecutions: number;
    windowMs: number;               // Sliding window
    throttle: boolean;              // Queue or drop excess
  };
  
  lifecycle: {
    enabled: boolean;
    created_at: Date;
    updated_at: Date;
  };
}

interface AsyncTask {
  id: string;
  trigger_id?: string;
  workflow_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  
  execution: {
    started_at?: Date;
    ended_at?: Date;
    duration_ms?: number;
  };
  
  retries: {
    attempt: number;
    maxAttempts: number;
    lastError?: string;
    nextRetryAt?: Date;
  };
}
```

**Flux Typique (TIM)** :

```
1. Administrateur configure Trigger
   → Type : schedule (CRON)
   → Expression : "0 9 * * MON-FRI" (Lundi-Vendredi 9h du matin)
   → Action : Lancer workflow "Daily Report Generation"
   ↓
2. TIM enregistre le trigger en MongoDB
   ↓
3. À chaque 9h du matin (lundi-vendredi)
   → Backend crée AsyncTask, l'ajoute à la queue
   ↓
4. Worker asynchrone consomme la task
   → Instancie workflow
   → Exécute agents
   → Collecte résultats
   → Stocke rapport en MongoDB
   ↓
5. Utilisateur peut voir l'historique des exécutions
   → Temps, statut, erreurs
```

---

## 🧠 Intégration des RAG

### Vision Générale

L'intégration RAG dans A-IR-DD2 suit un modèle **modulaire et composable** :

```
┌─────────────────────────────────────────────────────────────┐
│                     USER INTERACTION LAYER                   │
│  (Web Interface: React components + forms)                   │
└──────────────────────┬─────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────┐
│  DESIGN LAYER (MongoDB Persistence)                         │
│                                                             │
│  1. RAGConfig (Phil's responsibility)                      │
│     - Vector DB connection                                 │
│     - Retrieval parameters (topK, distance metric)         │
│     - Chunking & embedding strategies                      │
│     - Reranking configs                                    │
│                                                             │
│  2. VectorDatabaseConfig (Com's responsibility)            │
│     - Connection credentials                              │
│     - Collections metadata                                │
│                                                             │
│  3. DocumentChunk (Phil's knowledge base)                  │
│     - Indexed documents + embeddings                       │
│     - Metadata for filtering                              │
└──────────────────────┬─────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────┐
│  RUNTIME LAYER (In-Memory + External Services)             │
│                                                             │
│  ┌────────────────────────────────────────────────┐        │
│  │ 1. RETRIEVAL PHASE                             │        │
│  │    a) Embed user query using embedding model   │        │
│  │    b) Search vector DB with retrieval strategy │        │
│  │    c) Optional: Rerank results                 │        │
│  │    d) Return top-K chunks                      │        │
│  └────────────────────────────────────────────────┘        │
│                       │                                     │
│  ┌────────────────────▼────────────────────────────┐       │
│  │ 2. AUGMENTATION PHASE                           │       │
│  │    a) Format retrieved chunks                   │       │
│  │    b) Inject into system prompt or history      │       │
│  │    c) Respect context window size               │       │
│  │    d) Add metadata (sources, timestamps)        │       │
│  └────────────────────────────────────────────────┘        │
│                       │                                     │
│  ┌────────────────────▼────────────────────────────┐       │
│  │ 3. LLM GENERATION PHASE                         │       │
│  │    a) Call LLM with augmented prompt            │       │
│  │    b) Optional: Multi-hop reasoning             │       │
│  │    c) Format response with source citations     │       │
│  └────────────────────────────────────────────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Modèles de RAG Supportés

#### 1. **Naive RAG** (Baseline)
```
User Query → Embed → Search VectorDB → Retrieve TopK → LLM(query + context)
```
- **Quand l'utiliser** : Prototypage rapide, petits documents
- **Limitations** : Pas d'optimisation de contexte, pas de raisonnement multi-hop

#### 2. **Advanced RAG** (Production-ready)
```
User Query → Embed → Reranker → Search VectorDB → Context Condenser → LLM
```
- **Optimisations** :
  - Reranking (semantic) après retrieval
  - Context compression before injection
  - Metadata filtering for precise results

#### 3. **Hybrid Retrieval** (Qdrant/Weaviate specialty)
```
User Query → Dense (vector) + Sparse (BM25) search → Fusion → LLM
```
- **Quand l'utiliser** : Recherche de mots-clés importants + sémantique
- **Exemples** : Mélange de terminologie technique + concepts
- **Implémentation** : Qdrant hybrid mode ou Weaviate hybrid fusion

#### 4. **Multi-Hop Reasoning** (Agent-based)
```
Initial Query → Agent Think → Query RAG → Refine → Query Again → Synthesize
```
- **Quand l'utiliser** : Requêtes complexes nécessitant plusieurs recherches
- **Implémentation** : Agent dans workflow avec boucle de raisonnement

### Configuration RAG dans Agents (ARCHI)

Quand un utilisateur crée un Agent avec RAG :

```typescript
// Step 1: Selectioner une RAGConfig (créée par Phil)
const agent = {
  name: "Q&A Bot",
  llmProvider: LLMProvider.OpenAI,
  llmModel: "gpt-4-turbo",
  ragConfig: {
    id: "rag-config-123",  // Reference to Phil's RAGConfig
    retrievalMode: "hybrid",
    contextWindowSize: 4000,
    reranking: true,
  },
  systemPrompt: `You are a helpful assistant.
    When answering questions, use the provided context from the knowledge base.
    Always cite the sources.`,
};

// Step 2: At runtime, when user asks a question:
// - Backend retrieves RAGConfig
// - Initializes vector DB client (from Com's credentials)
// - Embeds user query
// - Searches vector DB for similar chunks
// - Injects into LLM prompt
// - LLM responds with citations

// Step 3: LLM sees augmented prompt
const augmentedPrompt = `
System: ${agent.systemPrompt}

Knowledge Base Context:
[Chunk 1] [Source: Doc A, p.5] "..." - Similarity: 0.92
[Chunk 2] [Source: Doc B, p.12] "..." - Similarity: 0.87
[Chunk 3] [Source: Doc C, p.3] "..." - Similarity: 0.81

User Question: "${userQuery}"
`;
```

---

## 📊 Flux de Données RAG

### Diagramme de Flux Complet

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    SETUP PHASE (Design Domain)                 │
│                                                                 │
│  1. COM : Créer VectorDatabaseConfig                           │
│     Input: Connection params (Host, API Key, etc.)             │
│     Output: VectorDatabaseConfig object                        │
│                                                                 │
│  2. PHIL : Créer RAGConfig                                     │
│     Input: Select VectorDB (from COM) + chunking + embedding   │
│     Output: RAGConfig object                                   │
│                                                                 │
│  3. PHIL : Upload documents & indexing                         │
│     Input: PDF, TXT, MD files                                  │
│     Process:                                                   │
│       a) Extract text content                                  │
│       b) Chunk by strategy (semantic, recursive)               │
│       c) Generate embeddings (call OpenAI/Gemini/etc.)         │
│       d) Store in VectorDB via Com's connection                │
│     Output: DocumentChunk objects indexed                      │
│                                                                 │
│  4. ARCHI : Link RAGConfig to Agent                            │
│     Input: Existing Agent + RAGConfig                          │
│     Output: Agent.ragConfig = reference to RAGConfig           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    RUNTIME PHASE (Runtime Domain)              │
│                                                                 │
│  User launches agent instance and types question               │
│                                                                 │
│  1. Backend receives message                                   │
│     Input: { agentId, message: "What is...?" }                 │
│                                                                 │
│  2. Load Agent + RAGConfig from design store                   │
│     Query MongoDB for Agent.ragConfig                          │
│                                                                 │
│  3. RETRIEVAL PHASE                                            │
│     a) Embed user query using RAGConfig.embeddingModel         │
│        Call: LLMService.embedding(message, embedder)           │
│        Returns: Float32Array (embedding vector)                │
│                                                                 │
│     b) Search VectorDB                                         │
│        Query VectorDB client (via Com credentials)             │
│        With: { vector: embedding, topK: 5, filters: {...} }    │
│        Retrieval strategy: hybrid/dense/bm25                   │
│        Returns: [ { text, score, metadata }, ... ]             │
│                                                                 │
│     c) Optional: Rerank                                        │
│        If RAGConfig.reranking.enabled:                         │
│          Call: RerankService.rerank(query, candidates)         │
│        Returns: Reordered candidates                           │
│                                                                 │
│  4. AUGMENTATION PHASE                                         │
│     a) Build context string from top-K chunks                  │
│        Format: "[Source: Doc1, p.5] ... [Sim: 0.92]"          │
│                                                                 │
│     b) Inject into system prompt or history                    │
│        Place in message history before LLM call                │
│                                                                 │
│     c) Respect context window                                  │
│        If (tokens > contextWindowSize):                        │
│          Truncate oldest chunks                                │
│                                                                 │
│  5. LLM CALL PHASE                                             │
│     a) Build final prompt                                      │
│        [System Prompt + RAG Context + User Query]              │
│                                                                 │
│     b) Call LLM via LLMService                                 │
│        Input: {                                                │
│          model: Agent.llmModel,                                │
│          history: [..., systemContext, userQuery],             │
│          tools: Agent.tools,                                   │
│        }                                                       │
│                                                                 │
│     c) Stream response to frontend                             │
│        Bos observes: tokens, latency                           │
│                                                                 │
│  6. POST-PROCESSING PHASE                                      │
│     a) Add citations to response                               │
│        Format: "As mentioned in Doc1, p.5, ..."               │
│                                                                 │
│     b) Store execution metadata                                │
│        In MongoDB: WorkflowExecution record                    │
│          - Retrieved chunks (for auditing)                     │
│          - LLM response                                        │
│          - Tokens used                                         │
│          - Cost calculation                                    │
│                                                                 │
│     c) Update metrics for Bos                                  │
│        Send: { tokens, latency, cost, ragHits }               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Détails Techniques : Appels API

#### Embedding Generation (via LLM Provider)

```typescript
// Dans PHIL workflow (document indexing)
const embedding = await llmService.generateEmbedding(
  apiKey: userApiKey,  // OpenAI/Gemini key
  provider: LLMProvider.OpenAI,
  model: "text-embedding-3-small",
  text: documentChunk,  // Max 8191 tokens
  dimension: 1536,      // Output dimension
);
// Returns: Float32Array[1536]

// Batch embedding (for multiple chunks)
const embeddings = await Promise.all(
  chunks.map(chunk => llmService.generateEmbedding(...))
);
```

#### Vector Search (via VectorDB Client)

```typescript
// Dans Agent runtime (retrieval phase)
const vectorDbClient = initializeVectorDBClient(
  type: "qdrant",  // From VectorDatabaseConfig.type
  credentials: vectorDbCfg.credentials,
);

const results = await vectorDbClient.search(
  collectionName: "kb-2026",
  vector: queryEmbedding,
  limit: 5,
  scoreThreshold: 0.75,
  filter: {
    user_id: currentUserId,  // Multi-tenancy
    category: ["general", "faq"],  // Metadata filter
  },
);
// Returns: [
//   { id, text, score: 0.92, metadata: {...} },
//   { id, text, score: 0.87, metadata: {...} },
//   ...
// ]
```

#### Reranking (Optional Enhancement)

```typescript
// If enabled in RAGConfig.reranking
const rerankedResults = await rerankService.rerank(
  model: "rerank-english-v2.0",  // Cohere or other
  query: userQuery,
  documents: retrievedChunks,
);
// Returns: Reordered list based on semantic relevance
```

#### Injecting into LLM Prompt

```typescript
// Build augmented prompt for LLM
const ragContext = retrievedChunks
  .map((chunk, i) => `[${i+1}] (Source: ${chunk.metadata.source}) ${chunk.text}`)
  .join("\n\n");

const augmentedHistory = [
  ...previousMessages,
  {
    sender: 'system',
    content: `
      Answer the following question using the provided context.
      
      CONTEXT:
      ${ragContext}
      
      If the context is insufficient, say so.
      Always cite the source of information.
    `,
  },
  {
    sender: 'user',
    content: userQuery,
  },
];

// Call LLM with augmented history
const response = await llmService.generateContent(
  apiKey,
  model: "gpt-4-turbo",
  systemInstruction: agent.systemPrompt,
  history: augmentedHistory,  // ← Includes RAG context
);
```

---

## 💡 Cas d'Usage & Scénarios

### Scenario 1 : Q&A Bot avec Knowledge Base Privée

**Besoin** : Une entreprise veut répondre aux questions des utilisateurs basées sur sa documentation interne.

**Architecture** :

```
1. COM: Configurer Qdrant cloud
   - Host: "https://my-qdrant.cloud"
   - API Key: [encrypted]

2. PHIL: Créer RAGConfig "Internal KB"
   - VectorDB: Qdrant cloud (from COM)
   - Embedding model: "text-embedding-3-small"
   - Chunking: semantic, 512 tokens
   - Retrieval: hybrid search, topK=5

3. PHIL: Upload documents
   - product_docs.pdf → 50 chunks indexed
   - faq.md → 100 chunks indexed
   - pricing.txt → 20 chunks indexed

4. ARCHI: Create Agent "Q&A Bot"
   - LLM: Gemini Pro 2.0
   - RAGConfig: "Internal KB" (from PHIL)
   - SystemPrompt: "You are a helpful assistant. Use the knowledge base to answer questions."

5. User Interface: Chat widget
   - User types: "What's the refund policy?"
   - Agent queries RAG → finds relevant chunks
   - LLM generates response with citations
   - User sees: "According to [pricing.txt], customers have 30 days for refunds."
```

---

### Scenario 2 : Multi-Agent Orchestration avec RAG Partage

**Besoin** : Plusieurs agents partageant une base de connaissances commune mais avec contextes différents.

**Architecture** :

```
1. PHIL: Shared RAGConfig "Company Knowledge"
   - Vector DB: Milvus (large scale, 1M+ documents)
   - Indexed documents: 50k technical guides
   - Metadata: { department, level, language }
   - Filters: Enable filtering by department/level

2. ARCHI: Agent "Technical Support"
   - RAGConfig: "Company Knowledge" with filter level=beginner
   - Retrieves: Only beginner-level content

3. ARCHI: Agent "Advanced Engineering"
   - RAGConfig: "Company Knowledge" with filter level=advanced
   - Retrieves: Only advanced technical content

4. Workflow: Support Escalation
   - Beginner query → Agent "Technical Support" queries RAG
   - If confidence < 0.5 → Escalate to "Advanced Engineering"
   - That agent queries same RAG with different filters
```

---

### Scenario 3 : Real-time Data RAG avec External API

**Besoin** : RAG augmentée avec données externes en temps réel.

**Architecture** :

```
1. COM: Configure API connection
   - endpoint: "https://api.data-provider.com/search"
   - authentication: API key

2. PHIL: Hybrid RAGConfig
   - Primary: Vector DB (static knowledge base)
   - Secondary: External API (real-time data)
   - Fusion strategy: Combine results

3. ARCHI: Agent "Real-time Analytics"
   - At runtime:
     a) Query RAG (static KB) → get historical context
     b) Call external API via Com → get live data
     c) Combine results
     d) Pass to LLM for synthesis

4. User Query: "What's the current status?"
   - Agent retrieves historical context from RAG
   - Agent fetches live data from API
   - LLM combines both: "Historically X, currently Y"
```

---

### Scenario 4 : Fine-tuned Model + RAG

**Besoin** : Utiliser un modèle fine-tuné pour un domaine spécifique, augmenté par RAG.

**Architecture** :

```
1. PHIL: Domain-specific fine-tuned model training
   - Collect domain data
   - Fine-tune OpenAI GPT-4 on company terminology
   - Deploy as "Company GPT-4"

2. PHIL: RAGConfig for fine-tuned model
   - Embedding model: fine-tuned embedding
   - VectorDB: Pinecone (optimized for this scale)
   - Chunking: domain-specific strategy

3. ARCHI: Agent with fine-tuned model
   - llmModel: "gpt-4-turbo-fine-tuned"
   - ragConfig: custom-tuned RAG
   - Result: Domain expert system

4. Execution:
   - Fine-tuned model understands domain terminology
   - RAG provides specific company context
   - Combined: Highly accurate domain expert responses
```

---

## 🎯 Bonnes Pratiques & Patterns

### Pattern 1 : Isolation Multi-Tenant via Metadata Filtering

```typescript
// ✅ BON: Filter by user_id dans chaque requête RAG
const results = await vectorDB.search({
  vector: embedding,
  filter: {
    user_id: currentUserId,  // ← Mandatory
  },
});

// ❌ MAUVAIS: Pas de filtrage
const results = await vectorDB.search({
  vector: embedding,
  limit: 5,  // Sans user_id filter → data leak!
});
```

**Implémentation** :

```typescript
// Dans [RAGConfig.processing.metadataFields]
// Toujours inclure : user_id, tenant_id, permissions

interface DocumentChunk {
  metadata: {
    user_id: string;      // ← Always
    tenant_id: string;    // ← For SaaS
    permissions: string[]; // ← Fine-grained access
    // ...
  };
}
```

### Pattern 2 : Gestion des Jetons pour Context Window

```typescript
// ✅ BON: Respect context window et budget tokens
const contextBudget = agent.contextWindow - promptTokens - reservedTokens;
let currentTokens = 0;

for (const chunk of retrievedChunks) {
  const chunkTokens = estimateTokens(chunk.text);
  if (currentTokens + chunkTokens > contextBudget) {
    break; // Stop adding chunks
  }
  context.push(chunk);
  currentTokens += chunkTokens;
}

// ❌ MAUVAIS: Pas de gestion des tokens
const context = retrievedChunks.slice(0, 5);  // Peut surpasser context window!
```

### Pattern 3 : Caching des Embeddings

```typescript
// ✅ BON: Cache embeddings pendant session
const embeddingCache = new Map<string, Float32Array>();

async function getEmbedding(text: string) {
  const cacheKey = hash(text);
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey);
  }
  
  const embedding = await llmService.generateEmbedding(text);
  embeddingCache.set(cacheKey, embedding);
  return embedding;
}

// ❌ MAUVAIS: Appel API à chaque fois
async function getEmbedding(text: string) {
  return await llmService.generateEmbedding(text);  // Coûteux!
}
```

### Pattern 4 : Retry & Graceful Degradation

```typescript
// ✅ BON: Retry avec backoff, fallback adaptatif
async function queryRAGWithFallback(query: string) {
  try {
    return await retryWithExponentialBackoff(
      () => vectorDB.search(query),
      { maxAttempts: 3, baseDelay: 500 }
    );
  } catch (error) {
    logger.warn("RAG query failed, using BM25 fallback", error);
    return await bmSearch(query);  // Simple keyword search
  }
}

// ❌ MAUVAIS: Pas de retry, crashes
async function queryRAG(query: string) {
  return await vectorDB.search(query);  // Fails immediately!
}
```

### Pattern 5 : Audit Trail & Compliance

```typescript
// ✅ BON: Log tous les accès à RAG
interface RAGAccessLog {
  timestamp: Date;
  query: string;
  userId: string;
  retrievedDocuments: {
    id: string;
    source: string;
    relevanceScore: number;
  }[];
  responseGenerated: boolean;
  costUsd: number;
}

// Store in MongoDB for audit
await RAGAccessLog.create(logEntry);

// ❌ MAUVAIS: Pas de logging
async function queryRAG(...) {
  const results = await vectorDB.search(...);
  return results;  // No audit trail!
}
```

### Pattern 6 : Retrieval Strategy Selection

```typescript
// ✅ BON: Adapter la stratégie selon le domaine
function selectRetrievalStrategy(query: string, domain: string): 'hybrid' | 'dense' | 'bm25' {
  if (domain === 'technical') {
    // Technical domain: hybrid (keywords + semantics)
    return 'hybrid';
  } else if (domain === 'news') {
    // News domain: dense (semantic relevance)
    return 'dense';
  } else if (domain === 'faq') {
    // FAQ domain: BM25 (exact keyword match)
    return 'bm25';
  }
  return 'hybrid'; // Default
}

// Configure RAGConfig.retrieval.strategy accordingly
```

---

## 📈 Roadmap RAG Integrations

### Phase 1 : Fondamentaux (Q2 2026) ✅

- [x] Vector DB connections via COM (Qdrant, Pinecone, Weaviate)
- [x] RAGConfig management via PHIL
- [x] Document indexing pipeline
- [x] Basic retrieval (topK search)
- [x] Injection into Agent prompts

### Phase 2 : Production-Ready (Q3 2026) 🚀

- [ ] Hybrid retrieval (dense + BM25)
- [ ] Reranking for precision
- [ ] Metadata filtering for multi-tenancy
- [ ] Context window optimization
- [ ] Document versioning & sync capabilities
- [ ] Streaming chunk generation for large documents
- [ ] Caching strategy (Redis backend)

### Phase 3 : Advanced Reasoning (Q4 2026)

- [ ] Multi-hop reasoning with RAG
- [ ] Chain-of-Thought augmentation
- [ ] Knowledge graph extraction from documents
- [ ] Fact verification with external sources
- [ ] Dynamic prompt optimization

### Phase 4 : Fine-tuning & Adapation (Q1 2027)

- [ ] Fine-tuning workflows for domain models
- [ ] Embedding model optimization (domain-specific)
- [ ] Adaptive retrieval strategy based on domain
- [ ] A/B testing retrieval strategies
- [ ] Cost optimization (token reduction)

### Phase 5 : Enterprise Features (Q2+ 2027)

- [ ] OpenLM hub integration (managed service)
- [ ] Advanced permissions & access control
- [ ] Data lineage & provenance tracking
- [ ] Real-time RAG updates (streaming updates)
- [ ] Multi-language support for RAG
- [ ] Compliance & data residency management

---

## 🔑 Key Concepts for RAG Architects

### 1. Embedding Space

- **Definition** : Mathematical representation of text meaning in N-dimensional space
- **Purpose** : Enable semantic similarity search
- **Models** : text-embedding-3-small (1536-dim), all-MiniLM-L6-v2 (384-dim)
- **Distance Metrics** : Cosine (most common), Euclidean, DotProduct

### 2. Chunking Strategies

| Strategy | Pros | Cons | Use Case |
|----------|------|------|----------|
| **Fixed** | Simple, predictable | May split semantic units | Large homogeneous docs |
| **Semantic** | Respects meaning | Slower, variable sizes | Technical docs, papers |
| **Recursive** | Balances both | More complex | Mixed content types |

### 3. Reranking

- **Purpose** : Refine top-K results with more sophisticated models
- **When** : Low precision in initial retrieval
- **Cost** : Higher latency per query
- **Models** : Cohere rerank, ms-marco, custom fine-tuned

### 4. Context Window Management

```
Total Context Available = Model's context window
Breakdown:
  - Input (prompt) = X tokens
  - Output (response) = Y tokens
  - RAG Context = Z tokens
  
Challenge: X + Y + Z <= Total
Solution: Dynamically calculate Z based on X budget
```

### 5. Multi-tenancy in RAG

```
┌─────────────────────────────────────────┐
│ Shared VectorDB                         │
│                                         │
│ User A's KnowledgeBase:                │
│  ├─ [100 chunks] (metadata: user=A)    │
│                                         │
│ User B's KnowledgeBase:                │
│  ├─ [200 chunks] (metadata: user=B)    │
│                                         │
│ When User A queries:                   │
│  → Search with filter: user=A ONLY     │
│  → No data leakage                     │
│                                         │
└─────────────────────────────────────────┘
```

---

## 📚 Ressources pour Architecte RAG

### Documentation Technique

- **Vector DB Comparisons**: See `Guides/RAG_SYSTEMS/COMPARATIFS_VECTORDB.md`
- **Architecture Guide**: See `Guides/ARCHITECTURE_GUIDE.md`
- **LLM Capabilities**: See `llmModels.ts` (all providers and features)

### Code References

- **LLM Service Dispatcher**: `services/llmService.ts`
- **Agent Types**: `types.ts` (Agent, Tool, RAGConfig interfaces)
- **Storage**: Backend models in `backend/src/models/`
- **API Contracts**: Backend routes in `backend/src/routes/`

### Key Files for RAG Integration

```
Frontend:
├─ components/PhilDataPage.tsx         # RAG Configuration UI
├─ components/ComDatabasesPage.tsx     # Vector DB Management
├─ services/ragService.ts              # (To be created)
├─ stores/useRAGStore.ts               # (To be created)

Backend:
├─ src/services/ragService.ts          # RAG orchestration
├─ src/models/RAGConfig.ts             # RAGConfig schema
├─ src/models/VectorDatabaseConfig.ts  # VectorDB schema
├─ src/routes/rag.ts                   # RAG API endpoints
├─ src/vectorDBClient/                 # (To be created)
│  ├─ qdrantClient.ts
│  ├─ pineconeClient.ts
│  └─ weaviateClient.ts
```

---

## ✅ Checklist pour démarrer

Comme nouvel architecte RAG, voici les étapes recommandées :

- [ ] **Repository familiarization**
  - [ ] Clone repo & install dependencies
  - [ ] Read `README.md` & `DOCUMENTATION_MAP.md`
  - [ ] Explore `documentation/jalons/` for context
  - [ ] Review `Guides/ARCHITECTURE_GUIDE.md`

- [ ] **Setup local environment**
  - [ ] Install Node.js 20+ & MongoDB 6.0+
  - [ ] Run: `npm install` + `cd backend && npm install`
  - [ ] Start frontend: `npm run dev` (http://127.0.0.1:4000)
  - [ ] Start backend: `cd backend && npm run dev` (http://localhost:3001)

- [ ] **Understand current stack**
  - [ ] Review `types.ts` for Agent, Tool, RAGConfig interfaces
  - [ ] Study `services/llmService.ts` for provider dispatch
  - [ ] Check `store/useDesignStore` & `store/useRuntimeStore`

- [ ] **Explore RAG requirements**
  - [ ] Review `Guides/RAG_SYSTEMS/COMPARATIFS_VECTORDB.md`
  - [ ] Understand VectorDB options (Qdrant vs Pinecone vs Weaviate)
  - [ ] Plan initial RAG implementation (Q2 2026 phase)

- [ ] **Coordinate with robot teams**
  - [ ] COM: Discuss VectorDB connection interfaces
  - [ ] PHIL: Clarify RAGConfig data model & chunking strategy
  - [ ] ARCHI: Align on Agent-RAG linking
  - [ ] BOS: Plan monitoring for RAG queries

- [ ] **Plan initial implementation**
  - [ ] Design VectorDatabaseConfig schema
  - [ ] Design RAGConfig schema
  - [ ] Plan API contracts (retrieval, indexing)
  - [ ] Document chunking strategy options

---

## 📞 Contacts & Collaboration

**Role in Team**:
- You are the **RAG Architecture Lead**
- Report to: **Project Manager (Chef de Projet)**
- Collaborate closely with: **COM** (Connectors) & **PHIL** (Data)
- Design contracts for: **ARCHI** (Agent integration) & **BOS** (Monitoring)

**Communication Channels**:
- Decisions & approvals: Through Project Manager
- Technical discussions: With respective robot teams
- Documentation: Update `Guides/RAG_SYSTEMS/` folder
- Code reviews: All RAG-related PRs require architecture review

---

## 🎓 Conclusion

A-IR-DD2 est une plateforme **modular, scalable et extensible** pour l'orchestration d'agents IA. L'intégration RAG amplifiera ses capacités en permettant :

- **Knowledge-grounded agents** : Agents avec accès à une connaissance privée
- **Multi-domain expertise** : Différentes RAG configs pour différents domaines
- **Production-grade QA** : Q&A systems avec citations et traçabilité
- **Enterprise AI** : Gouvernance, multi-tenancy, compliance
- **Cost optimization** : Context compression et token management

Bienvenue dans l'équipe ! 🚀

---

**Document Version**: 1.0  
**Last Updated**: February 2026  
**Author**: Architecture Team  
**Status**: Ready for RAG Architect Onboarding
