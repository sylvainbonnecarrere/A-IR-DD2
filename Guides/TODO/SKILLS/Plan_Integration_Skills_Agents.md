# Plan d'Architecture
## Intégration des Skills dans un Système Multi-Agents
### *avec Support Multimodal*

---

> **Stack Technique Cible**
>
> Frontend : TypeScript / React &nbsp;|&nbsp; Backend : Node.js / Python
>
> LLM : Anthropic Claude API &nbsp;|&nbsp; Orchestration : Multi-agents avec Skills

*Version 1.0 — Mars 2026*

---

## Table des Matières

- [0. Résumé Exécutif](#0-résumé-exécutif)
- [1. Concepts Fondamentaux](#1-concepts-fondamentaux)
- [2. Format Standardisé d'un Skill](#2-format-standardisé-dun-skill)
- [3. Registre des Skills (Skill Registry)](#3-registre-des-skills-skill-registry)
- [4. Architecture d'Orchestration des Agents](#4-architecture-dorchestration-des-agents)
- [5. Skill Executor : Exécution Multi-Runtime](#5-skill-executor--exécution-multi-runtime)
- [6. Support Multimodal](#6-support-multimodal)
- [7. Intégration Frontend React / TypeScript](#7-intégration-frontend-react--typescript)
- [8. Mémoire et Contexte des Agents](#8-mémoire-et-contexte-des-agents)
- [9. Sécurité et Gouvernance](#9-sécurité-et-gouvernance)
- [10. Observabilité et Monitoring](#10-observabilité-et-monitoring)
- [11. CI/CD et Déploiement des Skills](#11-cicd-et-déploiement-des-skills)
- [12. Checklist d'Intégration](#12-checklist-dintégration)
- [Annexe A : Dépendances Recommandées](#annexe-a--dépendances-recommandées)
- [Annexe B : Template SKILL.md](#annexe-b--template-skillmd)

---

## 0. Résumé Exécutif

Ce document constitue le plan de référence pour l'intégration des skills dans votre système d'agents IA. Il couvre l'ensemble de la chaîne : de la définition d'un skill à son exécution multimodale dans un agent autonome, en passant par les couches d'orchestration, les patterns de communication inter-agents et les considérations de sécurité.

Cinq grands axes structurent ce plan :

- **Architecture des skills** : format, registre, chargement dynamique
- **Orchestration des agents** : routage, planification, mémoire
- **Intégration stack TypeScript/Node/Python** : API, contrats, bridges
- **Support multimodal** : images, audio, fichiers, vidéo
- **Opérations** : observabilité, sécurité, CI/CD

---

## 1. Concepts Fondamentaux

### 1.1 Qu'est-ce qu'un Skill dans un système multi-agents ?

Un skill est une capacité atomique, encapsulée et réutilisable qu'un agent peut invoquer pour accomplir une tâche spécifique. Contrairement à un simple appel de fonction, un skill embarque :

- **Contrat d'interface** : schéma d'entrée/sortie typé (JSON Schema ou Zod)
- **Métadonnées sémantiques** : description en langage naturel permettant au LLM de décider s'il doit l'invoquer
- **Logique d'exécution** : code Node.js ou Python, service distant, ou combinaison des deux
- **Politique de retry/timeout** : comportement en cas d'erreur défini au niveau du skill
- **Capacités multimodales** : types de médias acceptés et produits en entrée/sortie

### 1.2 Taxonomie des Skills

| Catégorie | Exemples | Exécution | Modalités |
|---|---|---|---|
| Skill Atomique | OCR, résumé texte, sentiment | Appel LLM direct | Texte, Image |
| Skill Outil | Recherche web, API REST, BDD | Exécution code / HTTP | Texte, JSON |
| Skill Fichier | Génération DOCX/XLSX/PDF | Python/Node subprocess | Fichiers binaires |
| Skill Composite | Analyse contrat (OCR + résumé + extraction) | Pipeline de skills | Multimodal |
| Skill Agent | Research agent, Code agent | Sous-agent avec LLM | Tous types |

> **Note :** Un skill composite orchestre d'autres skills et peut lui-même être invoqué par un agent parent. Cela permet une composition récursive sans limite de profondeur théorique.

---

## 2. Format Standardisé d'un Skill

### 2.1 Manifeste de Skill (`skill.manifest.json`)

Chaque skill est défini par un manifeste JSON qui sert de source de vérité pour le registre, l'agent orchestrateur et la documentation automatique.

```json
{
  "id": "document.generate.docx",
  "version": "1.2.0",
  "name": "Génération de document Word",
  "description": "Crée un fichier .docx professionnel à partir de contenu structuré. Utiliser quand l'utilisateur demande un document Word, rapport, lettre ou mémo.",
  "category": "file",
  "tags": ["document", "word", "docx", "rapport"],
  "runtime": "python",
  "entrypoint": "skills/docx/runner.py",
  "timeout_ms": 30000,
  "retries": 2,
  "modalities": {
    "input":  ["text", "json"],
    "output": ["file/docx", "text"]
  },
  "inputSchema": {
    "type": "object",
    "required": ["title", "sections"],
    "properties": {
      "title":    { "type": "string" },
      "sections": { "type": "array", "items": { "$ref": "#/$defs/Section" } },
      "style":    { "type": "string", "enum": ["professional", "casual", "legal"] }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "file_url":   { "type": "string", "format": "uri" },
      "file_size":  { "type": "integer" },
      "page_count": { "type": "integer" }
    }
  },
  "secrets": ["ANTHROPIC_API_KEY"],
  "permissions": ["filesystem:write", "network:none"]
}
```

### 2.2 Structure de Répertoire d'un Skill

```
skills/
  document.generate.docx/
    skill.manifest.json      ← Manifeste (source de vérité)
    SKILL.md                 ← Documentation humaine + prompt pour le LLM
    runner.py                ← Point d'entrée Python
    runner.test.ts           ← Tests d'intégration
    fixtures/
      input.example.json
      output.example.docx
    scripts/                 ← Scripts utilitaires internes
```

### 2.3 Le Fichier SKILL.md : Interface avec le LLM

Le SKILL.md est la pièce maîtresse pour l'intégration LLM. Il est injecté dans le contexte de l'agent pour lui apprendre comment et quand utiliser le skill. Sa structure doit être précise :

| Section SKILL.md | Contenu attendu | Usage par l'agent |
|---|---|---|
| Description (YAML front-matter) | name, description, triggers | Routage sémantique par le LLM |
| When to use / NOT to use | Conditions d'activation et d'exclusion | Décision d'invocation |
| Input Format | Exemples de payloads JSON valides | Génération du bon payload |
| Output Format | Structure de la réponse + gestion erreurs | Parsing de la réponse |
| Examples | Paires requête → invocation | Few-shot learning de l'agent |
| Edge Cases | Comportements limites documentés | Robustesse de l'agent |

---

## 3. Registre des Skills (Skill Registry)

### 3.1 Architecture du Registre

Le registre est le composant central qui rend les skills découvrables, versionables et gouvernables. Il s'implémente comme un service Node.js exposant une API REST et une interface de recherche sémantique.

> **Note :** Le registre ne stocke PAS les fichiers d'exécution — il stocke uniquement les manifestes et les métadonnées. L'exécution est déléguée au Skill Executor.

### 3.2 API du Registre

| Endpoint | Méthode | Description |
|---|---|---|
| `GET  /skills` | REST | Liste tous les skills avec filtres (category, tags, modality) |
| `GET  /skills/:id` | REST | Récupère le manifeste complet d'un skill |
| `GET  /skills/:id/prompt` | REST | Retourne le SKILL.md formaté pour injection LLM |
| `POST /skills/search` | REST | Recherche sémantique (embedding) par description de tâche |
| `POST /skills/match` | REST | LLM-assisted matching : trouve le(s) meilleur(s) skill(s) pour une requête |
| `GET  /skills/:id/schema` | REST | JSON Schema d'entrée/sortie pour validation |
| `POST /registry/validate` | REST | Valide un nouveau manifeste avant enregistrement |

### 3.3 Implémentation TypeScript du Registre

```typescript
// skill-registry/src/registry.service.ts

export interface SkillManifest {
  id: string;
  version: string;
  name: string;
  description: string;
  runtime: "node" | "python" | "llm" | "http";
  modalities: { input: string[]; output: string[] };
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  timeout_ms: number;
  retries: number;
}

export class SkillRegistry {
  private skills = new Map<string, SkillManifest>();
  private embeddings = new Map<string, number[]>(); // pour recherche sémantique

  async loadFromDirectory(dir: string): Promise<void> {
    const manifests = await glob(`${dir}/**/skill.manifest.json`);
    for (const path of manifests) {
      const manifest = await this.validateAndLoad(path);
      this.skills.set(manifest.id, manifest);
      this.embeddings.set(manifest.id, await this.embed(manifest.description));
    }
  }

  async semanticSearch(query: string, topK = 5): Promise<SkillManifest[]> {
    const queryEmb = await this.embed(query);
    return this.cosineSimilaritySearch(queryEmb, topK);
  }

  getPromptForAgent(skillId: string): string {
    // Retourne SKILL.md + schémas formatés pour injection dans le contexte LLM
    const manifest = this.skills.get(skillId);
    const skillMd  = fs.readFileSync(`${manifest.path}/SKILL.md`, "utf-8");
    return `${skillMd}\n\n## JSON Schema\n\`\`\`json\n${JSON.stringify(manifest.inputSchema, null, 2)}\n\`\`\``;
  }
}
```

---

## 4. Architecture d'Orchestration des Agents

### 4.1 Pattern Recommandé : Orchestrator + Specialized Agents

Le pattern retenu est une architecture hiérarchique à deux niveaux. L'agent orchestrateur ne s'occupe que du routage et de la planification. Les agents spécialisés exécutent les skills de leur domaine.

| Agent Orchestrateur | Agents Spécialisés |
|---|---|
| Analyse l'intention utilisateur | DocumentAgent → skills DOCX/XLSX/PDF |
| Décompose en sous-tâches | ResearchAgent → skills Web/RAG |
| Route vers agents spécialisés | VisionAgent → skills Image/OCR |
| Agrège les résultats finaux | CodeAgent → skills Exec/Test |
| Maintient la mémoire de session | DataAgent → skills SQL/Analyse |

### 4.2 Cycle de Vie d'une Requête

| Étape | Composant | Action | Output |
|---|---|---|---|
| 1. Réception | API Gateway (Express) | Authentification, rate limiting, normalisation | Request object typé |
| 2. Intent Analysis | Orchestrator Agent | LLM analyse + classe l'intention | Intent + entities extraites |
| 3. Skill Discovery | Skill Registry | Recherche sémantique des skills adaptés | Liste de skill IDs candidats |
| 4. Planning | Orchestrator Agent | LLM crée un plan d'exécution (DAG) | Execution plan JSON |
| 5. Dispatch | Agent Router | Route vers agent(s) spécialisé(s) | Job IDs par agent |
| 6. Skill Execution | Skill Executor | Exécute le skill (Node/Python) | Raw skill output |
| 7. Validation | Output Validator | Vérifie conformité au outputSchema | Validated output |
| 8. Aggregation | Orchestrator Agent | LLM synthétise les résultats | Final response |
| 9. Streaming | SSE / WebSocket | Stream de la réponse vers le frontend | Text + files + events |

### 4.3 Implémentation : Agent Runner

```typescript
// agents/src/agent-runner.ts

export class AgentRunner {
  constructor(
    private registry: SkillRegistry,
    private executor: SkillExecutor,
    private memory: AgentMemory
  ) {}

  async run(request: AgentRequest): Promise<AsyncIterable<AgentEvent>> {
    // 1. Charger le contexte des skills pertinents
    const relevantSkills = await this.registry.semanticSearch(request.userMessage, 8);
    const skillsContext  = relevantSkills.map(s => this.registry.getPromptForAgent(s.id)).join("\n\n---\n\n");

    // 2. Appeler le LLM avec les skills injectés dans le contexte
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: buildSystemPrompt(skillsContext),
      tools: relevantSkills.map(s => skillToAnthropicTool(s)),
      messages: await this.memory.getHistory(request.sessionId),
      stream: true
    });

    // 3. Traiter les tool_use blocks → exécuter les skills
    for await (const event of response) {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        yield* this.executeSkill(event.content_block);
      }
      yield event; // Stream vers le frontend
    }
  }
}
```

---

## 5. Skill Executor : Exécution Multi-Runtime

### 5.1 Architecture de l'Executor

L'executor abstrait les différents runtimes (Node.js, Python, HTTP, LLM) derrière une interface commune. Il gère le sandboxing, les timeouts, les retries et la gestion des fichiers temporaires.

```typescript
// skill-executor/src/executor.ts

interface SkillExecutionResult {
  status:       "success" | "error" | "timeout";
  output:       unknown;               // Validé contre outputSchema
  files?:       SkillOutputFile[];     // Fichiers générés (DOCX, PDF, etc.)
  duration_ms:  number;
  tokens_used?: number;                // Si runtime === "llm"
}

export class SkillExecutor {
  private runners: Map<string, SkillRunner> = new Map([
    ["node",   new NodeRunner()],
    ["python", new PythonRunner()],
    ["llm",    new LLMRunner(anthropic)],
    ["http",   new HttpRunner()],
  ]);

  async execute(skillId: string, input: unknown): Promise<SkillExecutionResult> {
    const manifest = await this.registry.get(skillId);
    const validated = await this.validateInput(input, manifest.inputSchema);
    const runner    = this.runners.get(manifest.runtime);

    return withTimeout(
      withRetry(
        () => runner.run(manifest, validated),
        { attempts: manifest.retries, backoff: "exponential" }
      ),
      manifest.timeout_ms
    );
  }
}
```

### 5.2 Python Runner : Bridge Node ↔ Python

Le bridge entre Node.js et Python est un point critique. Deux approches coexistent selon la latence requise :

| Approche | Mécanisme | Latence | Use Case |
|---|---|---|---|
| Subprocess | `child_process.spawn()`, stdin/stdout JSON | 50–200 ms | Scripts one-shot (DOCX, PDF) |
| FastAPI sidecar | HTTP REST vers service Python persistant | 5–20 ms | Skills fréquents (OCR, ML) |

```typescript
// Subprocess approach pour skills Python one-shot
async runPythonSkill(manifest: SkillManifest, input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [manifest.entrypoint], {
      env: { ...process.env, SKILL_INPUT: JSON.stringify(input) },
      timeout: manifest.timeout_ms
    });
    let stdout = ""; let stderr = "";
    proc.stdout.on("data", d => stdout += d);
    proc.stderr.on("data", d => stderr += d);
    proc.on("close", code => {
      if (code !== 0) return reject(new SkillError(stderr));
      resolve(JSON.parse(stdout));
    });
  });
}
```

---

## 6. Support Multimodal

### 6.1 Taxonomie des Modalités

| Modalité | Formats | Ingest côté Agent | Traitement Skill |
|---|---|---|---|
| Texte | UTF-8, Markdown | Injection directe dans context | LLM natif |
| Image | PNG, JPEG, WebP, GIF | Base64 dans message Claude | Vision API Claude / OCR Python |
| Document | PDF, DOCX, XLSX | Extraction text + images | pdfplumber, python-docx, openpyxl |
| Audio | MP3, WAV, M4A | Transcription préalable (Whisper) | Texte résultant + métadonnées |
| Vidéo | MP4, MOV | Extraction frames + audio | Vision sur frames + Whisper audio |
| Données | JSON, CSV, SQL | Injection structurée ou résumé | pandas, DuckDB, analyse LLM |

### 6.2 Pipeline d'Ingestion Multimodale

Toute entrée multimodale passe par un pipeline de normalisation avant d'atteindre l'agent. Ce pipeline est implémenté en Node.js avec délégation Python pour les traitements lourds.

```typescript
// multimodal/src/ingestor.ts

export class MultimodalIngestor {
  async ingest(file: UploadedFile): Promise<NormalizedContent> {
    const { mimeType, buffer, filename } = file;

    switch (mimeType) {
      case "image/png":
      case "image/jpeg":
      case "image/webp":
        return { type: "image", base64: buffer.toString("base64"), mimeType };

      case "application/pdf":
        // Extraction texte + images via Python (pdfplumber)
        const extracted = await this.pythonExtract("pdf", buffer);
        return { type: "document", text: extracted.text, images: extracted.images, metadata: extracted.metadata };

      case "audio/mpeg":
      case "audio/wav":
        // Transcription via Whisper (FastAPI sidecar)
        const transcript = await this.whisperTranscribe(buffer);
        return { type: "audio_transcript", text: transcript.text, duration_s: transcript.duration };

      case "text/csv":
        const parsed = await parseCSV(buffer);
        return { type: "structured_data", rows: parsed.rows, schema: parsed.schema };

      default:
        throw new UnsupportedModalityError(mimeType);
    }
  }
}
```

### 6.3 Construction du Message Multimodal pour Claude

L'agent construit dynamiquement le tableau de content blocks pour l'API Anthropic selon les modalités présentes dans la requête :

```typescript
function buildAnthropicMessage(request: AgentRequest): Anthropic.MessageParam {
  const content: Anthropic.ContentBlockParam[] = [];

  // Texte utilisateur
  if (request.text) {
    content.push({ type: "text", text: request.text });
  }

  // Images (max 20 par message, 5 MB chacune)
  for (const img of request.images ?? []) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mimeType, data: img.base64 }
    });
  }

  // Documents (PDF via source "document" si API supportée, sinon texte extrait)
  for (const doc of request.documents ?? []) {
    content.push({ type: "text", text: `[Document: ${doc.filename}]\n${doc.text}` });
  }

  return { role: "user", content };
}
```

### 6.4 Handling des Outputs Multimodaux

Les skills peuvent produire des fichiers binaires (DOCX, PDF, XLSX, images). Le pipeline de sortie gère leur stockage temporaire et leur transmission au frontend :

- **Stockage temporaire** : bucket S3 ou système de fichiers avec TTL de 1h
- **URL signée** : générée et renvoyée dans la réponse agent pour téléchargement sécurisé
- **Streaming de progression** : événements SSE pendant la génération du fichier
- **Prévisualisation** : thumbnails PNG générés automatiquement pour DOCX/PDF/XLSX
- **Nettoyage** : job CRON purge les fichiers temporaires > TTL

---

## 7. Intégration Frontend React / TypeScript

### 7.1 Architecture Frontend

Le frontend consomme l'API agent via un hook React dédié qui gère le streaming SSE, les états de chargement par skill, les uploads multimodaux et les téléchargements de fichiers.

```typescript
// hooks/useAgent.ts

export function useAgent() {
  const [state, setState] = useState<AgentState>({ status: "idle", events: [] });

  const send = useCallback(async (message: string, files?: File[]) => {
    setState({ status: "loading", events: [] });

    // Upload des fichiers multimodaux
    const uploadedFiles = files ? await uploadFiles(files) : [];

    // Ouverture du stream SSE
    const eventSource = new EventSource(
      `/api/agent/stream?session=${sessionId}`,
      { withCredentials: true }
    );

    eventSource.addEventListener("skill_start",    handleSkillStart);
    eventSource.addEventListener("skill_complete", handleSkillComplete);
    eventSource.addEventListener("file_ready",     handleFileReady);
    eventSource.addEventListener("text_delta",     handleTextDelta);
    eventSource.addEventListener("error",          handleError);

    // POST de la requête (déclenche le stream)
    await fetch("/api/agent/message", {
      method: "POST",
      body: JSON.stringify({ message, files: uploadedFiles }),
    });
  }, [sessionId]);

  return { state, send };
}
```

### 7.2 Événements SSE : Protocole de Communication

| Event Type | Payload | Usage UI |
|---|---|---|
| `text_delta` | `{ delta: string }` | Streaming du texte dans le chat |
| `skill_start` | `{ skillId, skillName, icon }` | Affichage de l'indicateur de skill en cours |
| `skill_progress` | `{ skillId, percent, message }` | Barre de progression (génération fichier) |
| `skill_complete` | `{ skillId, duration_ms }` | Fin de l'indicateur de skill |
| `file_ready` | `{ url, filename, mimeType, size, thumbnail }` | Bouton de téléchargement + preview |
| `agent_error` | `{ code, message, skillId? }` | Affichage d'erreur contextuelle |
| `session_done` | `{ totalTokens, duration_ms }` | Fin du stream, reset UI |

---

## 8. Mémoire et Contexte des Agents

### 8.1 Stratégie de Mémoire Multi-Niveaux

| Niveau | Portée | Stockage | Contenu |
|---|---|---|---|
| In-Context | Tour actuel | RAM (contexte LLM) | Messages, tool_use/result de la session |
| Session | Conversation | Redis (TTL 24h) | Historique compressé, préférences utilisateur |
| Long-terme | Persistant | PostgreSQL + pgvector | Faits extraits, résultats de skills importants |
| Knowledge | Global | Pinecone / Weaviate | Documents indexés, base de connaissances |

> **Note :** La compression du contexte est critique : après chaque échange, résumer les anciens messages via LLM pour rester dans la fenêtre de contexte tout en préservant l'information essentielle.

---

## 9. Sécurité et Gouvernance

### 9.1 Modèle de Permissions

Chaque skill déclare ses permissions requises dans son manifeste. L'executor vérifie ces permissions avant d'autoriser l'exécution.

```json
"permissions": [
  "filesystem:read",           // Lecture fichiers (répertoire sandbox uniquement)
  "filesystem:write",          // Écriture fichiers (répertoire sandbox uniquement)
  "network:http",              // Appels HTTP sortants (liste blanche de domaines)
  "network:none",              // Aucun accès réseau
  "database:read",             // Lecture BDD (connexion en lecture seule)
  "secrets:ANTHROPIC_API_KEY", // Accès secret spécifique
  "llm:invoke"                 // Permission d'appeler le LLM
]
```

### 9.2 Sandboxing des Skills Python

- **Isolation** : chaque skill Python s'exécute dans un venv dédié ou un container Docker léger
- **Filesystem** : accès restreint à `/tmp/skill-{jobId}/` uniquement
- **Réseau** : iptables rules ou network namespace selon le niveau d'isolation requis
- **CPU/Mémoire** : limits via cgroups (max 2 CPU, 512 MB RAM par défaut)
- **Durée** : timeout strict via SIGKILL après `timeout_ms` + 2s de grâce

### 9.3 Validation des Entrées/Sorties

- Toutes les entrées de skills sont validées via Ajv (JSON Schema) avant exécution
- Toutes les sorties sont validées avant d'être renvoyées à l'agent
- Les fichiers uploadés sont scannés (type MIME, taille, malware si données sensibles)
- Les outputs LLM sont sanitisés pour éviter les injections de prompt dans les réponses

---

## 10. Observabilité et Monitoring

### 10.1 Traces Distribuées

Chaque invocation d'agent génère un trace ID propagé à travers tous les skills exécutés. Utiliser OpenTelemetry avec export vers Jaeger ou Datadog.

```
agent.request              // Span racine : requête utilisateur → réponse finale
  ├─ agent.intent_analysis // Temps d'analyse de l'intention
  ├─ skill.registry.search // Recherche sémantique des skills
  ├─ skill.execute: docx   // Exécution du skill DOCX
  │    ├─ skill.validate   // Validation input/output
  │    └─ python.runner    // Subprocess Python
  └─ agent.aggregate       // Agrégation finale
```

### 10.2 Métriques Clés à Monitorer

| Métrique | Type | Seuil d'alerte | Dashboard |
|---|---|---|---|
| `skill.execution.duration_ms` | Histogram | > p95 × 2 | Skills Performance |
| `skill.execution.error_rate` | Counter | > 5% / 5min | Skills Reliability |
| `agent.tokens.used` | Gauge | > 80% budget mensuel | Cost Management |
| `skill.queue.depth` | Gauge | > 50 jobs en attente | Capacity |
| `multimodal.ingest.duration_ms` | Histogram | > 10s | Multimodal Pipeline |
| `skill.cache.hit_rate` | Gauge | < 30% | Cache Efficiency |

---

## 11. CI/CD et Déploiement des Skills

### 11.1 Pipeline de Déploiement d'un Skill

Les skills suivent leur propre cycle de déploiement, indépendant du déploiement de l'application principale. Cela permet des mises à jour sans downtime et un rollback granulaire.

1. **Lint & Format** : validation du manifeste JSON Schema + SKILL.md
2. **Unit Tests** : jest (Node) + pytest (Python) sur les fixtures
3. **Integration Tests** : skill exécuté contre l'API réelle en staging
4. **Skill Eval** : LLM invoque le skill sur 20 cas de test, vérification des outputs
5. **Registry Publish** : upload du manifeste + artefacts au registre
6. **Canary Deploy** : 5% du trafic → monitorer les métriques 10 min
7. **Full Deploy** : déploiement complet si canary OK

### 11.2 Versionning des Skills

Les skills suivent le Semantic Versioning (semver). Les agents peuvent épingler une version ou cibler un range :

```json
{
  "skillRequirements": {
    "document.generate.docx": "^1.0.0",  // Accepte 1.x.x
    "vision.ocr":             "2.1.3",    // Version exacte
    "research.web.search":    ">=1.5.0"   // Minimum
  }
}
```

> **Note :** Un breaking change (nouveau major) déclenche automatiquement un test de compatibilité sur tous les agents qui utilisent le skill avant que la nouvelle version soit marquée comme stable.

---

## 12. Checklist d'Intégration

### Phase 1 : Fondations (Semaines 1-2)

- [ ] Créer le modèle de `skill.manifest.json` et le validateur JSON Schema
- [ ] Implémenter le `SkillRegistry` avec chargement depuis le filesystem
- [ ] Implémenter le `SkillExecutor` avec support Node et Python (subprocess)
- [ ] Mettre en place le bridge HTTP vers un FastAPI sidecar Python
- [ ] Créer les 3 premiers skills : génération DOCX, recherche web, résumé texte

### Phase 2 : Orchestration (Semaines 3-4)

- [ ] Implémenter l'`OrchestratorAgent` avec tool_use Claude
- [ ] Ajouter la recherche sémantique au registre (embeddings)
- [ ] Mettre en place le streaming SSE vers le frontend
- [ ] Implémenter le hook `useAgent()` React avec gestion d'états
- [ ] Ajouter la gestion de la mémoire de session (Redis)

### Phase 3 : Multimodal (Semaines 5-6)

- [ ] Implémenter le `MultimodalIngestor` (images, PDF, CSV)
- [ ] Créer le skill OCR (Python : pdfplumber + pytesseract)
- [ ] Créer le skill Vision (Claude vision API)
- [ ] Ajouter le support upload multifile dans le frontend React
- [ ] Mettre en place la gestion des fichiers générés (S3 + URLs signées)

### Phase 4 : Production (Semaines 7-8)

- [ ] Configurer OpenTelemetry + dashboards Grafana
- [ ] Implémenter le sandboxing Python (Docker ou venv isolés)
- [ ] Mettre en place la validation des permissions par skill
- [ ] Créer le pipeline CI/CD de déploiement des skills
- [ ] Tests de charge et optimisation des p95

---

## Annexe A : Dépendances Recommandées

| Package | Runtime | Usage |
|---|---|---|
| `@anthropic-ai/sdk` | Node.js | Client officiel API Claude (messages, streaming, tool_use) |
| `zod` | Node.js | Validation des schémas skill en TypeScript |
| `ajv` | Node.js | Validation JSON Schema runtime des I/O skills |
| `ioredis` | Node.js | Mémoire de session Redis |
| `opentelemetry` | Node.js | Tracing distribué |
| `fastapi + uvicorn` | Python | Sidecar HTTP pour skills Python persistants |
| `pdfplumber` | Python | Extraction texte/tableaux de PDF |
| `python-docx` | Python | Manipulation fichiers Word |
| `openai-whisper` | Python | Transcription audio (peut tourner en local) |
| `pandas + duckdb` | Python | Analyse de données structurées |
| `pillow + pytesseract` | Python | OCR sur images |

---

## Annexe B : Template SKILL.md

```markdown
---
name: nom-du-skill
description: "Description concise pour routing sémantique. Quand utiliser ce skill."
version: 1.0.0
category: document | file | research | vision | data | code
---

# Nom du Skill

## When to Use
Use this skill when the user asks to [use case principal].
Examples: "Génère un rapport Word", "Crée un document professionnel"

## When NOT to Use
- Si l'utilisateur veut un PDF → utiliser le skill pdf.generate
- Si le document est < 1 page → répondre directement en Markdown

## Input Format

{ "title": "Titre du document", "sections": [...], "style": "professional" }

## Output Format

{ "file_url": "https://...", "page_count": 3, "file_size": 45230 }

## Examples
User: "Crée un rapport de réunion"
→ skill_call: { title: "Rapport de réunion", sections: [{...}], style: "professional" }

## Edge Cases & Errors
- `sections` vide → retourne une erreur VALIDATION_ERROR
- Timeout > 30s → réessayer avec un contenu plus court
```

---

*Document préparé par Expert Agent Workflows — Mars 2026*
