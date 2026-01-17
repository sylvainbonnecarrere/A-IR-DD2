# Plan d'Implémentation - Persistance Agent Journals (Phase 3)

**Date**: January 17, 2026  
**Statut**: PRÊT POUR IMPLÉMENTATION

---

## 🎯 Objectif

Implémenter la **persistance des interactions agent → agent_journals** collection MongoDB.

Actuellement : ❌ Messages/requêtes restent en mémoire (state React)  
Cible : ✅ Messages persistés en BDD avec contrôle granulaire (persistenceConfig)

---

## 🏗️ Architecture Existante (Design Pattern)

### Collections & Modèles

```
┌─────────────────────────────────────────────────────────────┐
│ agent_instances (AgentInstance.model.ts)                    │
├─────────────────────────────────────────────────────────────┤
│ - Configuration légère (name, role, llmProvider, etc.)      │
│ - persistenceConfig: { saveChatHistory, saveErrors, ... }   │
│ - État runtime court terme                                  │
│ - Indexes: workflowId, userId, prototypeId                 │
└─────────────────────────────────────────────────────────────┘
                          ↓ (ref)
┌─────────────────────────────────────────────────────────────┐
│ agent_journals (AgentJournal.model.ts)                      │
├─────────────────────────────────────────────────────────────┤
│ - Historique lourd (messages, erreurs, médias)              │
│ - Polymorphique: type ∈ {chat, error, media, task, system} │
│ - Payload: ChatJournalPayload | ErrorJournalPayload | ...   │
│ - Indexes: agentInstanceId, timestamp, type                │
│ - Lazy loaded (ne se charge pas avec le workflow)          │
└─────────────────────────────────────────────────────────────┘
```

### Types Existants

**PersistenceConfig** (backend/src/types/persistence.ts):
```typescript
export interface PersistenceConfig {
    saveChatHistory: boolean;       // Sauvegarder messages
    saveErrors: boolean;            // Sauvegarder erreurs
    saveTaskExecution: boolean;     // Sauvegarder tâches
    saveMedia: boolean;             // Sauvegarder images/vidéos
    mediaStorageMode: 'database' | 'local' | 'cloud';
    summarizeHistory: boolean;
    retentionDays?: number;
}
```

**ChatJournalPayload**:
```typescript
export interface ChatJournalPayload {
    role: 'user' | 'agent' | 'tool' | 'tool_result';
    content: string;
    llmProvider?: string;
    modelUsed?: string;
    tokensUsed?: number;
    toolCalls?: [...];
}
```

### Méthodes Statiques AgentJournal (Déjà Implémentées ✅)

```typescript
// backend/src/models/AgentJournal.model.ts

// Créer une entrée de chat
static createChatEntry(
    agentInstanceId: ObjectId,
    workflowId: ObjectId,
    payload: ChatJournalPayload,
    sessionId?: string
): Promise<IAgentJournal>

// Créer une entrée d'erreur
static createErrorEntry(
    agentInstanceId: ObjectId,
    workflowId: ObjectId,
    payload: ErrorJournalPayload
): Promise<IAgentJournal>

// Créer une entrée média
static createMediaEntry(
    agentInstanceId: ObjectId,
    workflowId: ObjectId,
    payload: MediaJournalPayload
): Promise<IAgentJournal>
```

---

## 📋 Plan d'Implémentation

### Étape 1: Backend - Route POST

**Fichier**: `backend/src/routes/agent-instances.routes.ts`

**Endpoint**: `POST /api/workflows/:workflowId/agents/:agentInstanceId/journal`

**Logique**:
```typescript
1. Récupérer agentInstance
2. Vérifier persistenceConfig (saveChatHistory, saveErrors, saveMedia)
3. Valider que l'utilisateur possède l'instance (ownership)
4. Selon le type d'entrée (chat/error/media):
   - Si type='chat' && persistenceConfig.saveChatHistory:
     - Appeler AgentJournal.createChatEntry()
   - Si type='error' && persistenceConfig.saveErrors:
     - Appeler AgentJournal.createErrorEntry()
   - Si type='media' && persistenceConfig.saveMedia:
     - Appeler AgentJournal.createMediaEntry()
   - Sinon: skip (ne pas persister)
5. Retourner { success: true, journalId }
```

**Request Body**:
```json
{
  "type": "chat" | "error" | "media",
  "payload": {
    // Pour chat:
    "role": "user" | "agent" | "tool" | "tool_result",
    "content": "...",
    "llmProvider": "gemini",
    "modelUsed": "gemini-2.0-flash",
    "tokensUsed": 45,
    
    // Ou pour error:
    "errorCode": "TIMEOUT",
    "message": "Request timeout after 30s",
    "source": "llm_service",
    "retryable": true,
    "attempts": 1,
    
    // Ou pour media:
    "mimeType": "image/png",
    "fileName": "generated_image.png",
    ...
  }
}
```

---

### Étape 2: Frontend - Envoyer Messages au Backend

**Fichier**: `components/V2AgentNode.tsx`

**Localisation**: Dans `handleSendMessage()` après avoir sauvegardé le message localement

**Logique**:
```typescript
// Après addNodeMessage(id, userMessage) et addNodeMessage(id, agentMessage):

if (agentInstance?.persistenceConfig?.saveChatHistory) {
  // Envoyer le message utilisateur
  await fetch(`/api/workflows/${workflowId}/agents/${agentInstance.id}/journal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'chat',
      payload: {
        role: 'user',
        content: userInput,
        llmProvider: agent.llmProvider,
        modelUsed: agent.model
      }
    })
  });
  
  // Envoyer la réponse de l'agent
  await fetch(`/api/workflows/${workflowId}/agents/${agentInstance.id}/journal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'chat',
      payload: {
        role: 'agent',
        content: currentResponse,
        llmProvider: agent.llmProvider,
        modelUsed: agent.model,
        tokensUsed: estimatedTokens
      }
    })
  });
}

// En cas d'erreur :
if (agentInstance?.persistenceConfig?.saveErrors && error) {
  await fetch(`/api/workflows/${workflowId}/agents/${agentInstance.id}/journal`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'error',
      payload: {
        errorCode: 'LLM_ERROR',
        message: error.message,
        source: 'llm_service',
        retryable: true,
        attempts: 1
      }
    })
  });
}
```

---

### Étape 3: Queuing & Retry (Robustesse)

Pour éviter les pertes en cas de déconnexion, implémenter une **queue locale** :

```typescript
// Frontend: useAgentChat.ts ou nouveau hook useJournalQueue.ts

interface JournalQueueItem {
  instanceId: string;
  workflowId: string;
  type: 'chat' | 'error' | 'media';
  payload: any;
  retryCount: number;
}

const journalQueue: JournalQueueItem[] = [];

async function enqueueJournalEntry(item: JournalQueueItem) {
  journalQueue.push(item);
  await flushJournalQueue();
}

async function flushJournalQueue() {
  while (journalQueue.length > 0) {
    const item = journalQueue[0];
    try {
      await fetch(`/api/workflows/${item.workflowId}/agents/${item.instanceId}/journal`, {
        method: 'POST',
        body: JSON.stringify({ type: item.type, payload: item.payload })
      });
      journalQueue.shift(); // Succès: enlever de la queue
    } catch (error) {
      if (item.retryCount < 3) {
        item.retryCount++;
        setTimeout(() => flushJournalQueue(), 2000 * item.retryCount); // Backoff
      } else {
        journalQueue.shift(); // Max retries: abandonner
        console.error('Journal entry discarded after retries');
      }
      break; // Stop processing queue
    }
  }
}
```

---

## 📝 Implémentation Détaillée

### 1. Backend Route

**Fichier**: `backend/src/routes/agent-instances.routes.ts`

```typescript
/**
 * POST /api/workflows/:workflowId/agents/:agentInstanceId/journal
 * Persister une entrée journal pour une instance d'agent
 * 
 * Respects persistenceConfig granulaire
 */
router.post(
  '/:agentInstanceId/journal',
  requireAuth,
  requireOwnershipAsync(async (req) => {
    const instance = await AgentInstance.findById(req.params.agentInstanceId);
    return instance?.userId.toString();
  }),
  async (req, res) => {
    try {
      const { agentInstanceId } = req.params;
      const { type, payload } = req.body;
      const user = req.user as IUser;

      // Validation
      if (!['chat', 'error', 'media'].includes(type)) {
        return res.status(400).json({ error: 'Invalid journal entry type' });
      }

      // Récupérer l'instance
      const instance = await AgentInstance.findById(agentInstanceId);
      if (!instance) {
        return res.status(404).json({ error: 'Agent instance not found' });
      }

      const { persistenceConfig } = instance;
      let result;

      // Persister selon le type ET la config
      switch (type) {
        case 'chat':
          if (!persistenceConfig?.saveChatHistory) {
            return res.status(200).json({ skipped: true, reason: 'saveChatHistory is false' });
          }
          result = await AgentJournal.createChatEntry(
            instance._id,
            instance.workflowId,
            payload as ChatJournalPayload
          );
          break;

        case 'error':
          if (!persistenceConfig?.saveErrors) {
            return res.status(200).json({ skipped: true, reason: 'saveErrors is false' });
          }
          result = await AgentJournal.createErrorEntry(
            instance._id,
            instance.workflowId,
            payload as ErrorJournalPayload
          );
          break;

        case 'media':
          if (!persistenceConfig?.saveMedia) {
            return res.status(200).json({ skipped: true, reason: 'saveMedia is false' });
          }
          result = await AgentJournal.createMediaEntry(
            instance._id,
            instance.workflowId,
            payload as MediaJournalPayload
          );
          break;
      }

      console.log(`[Journal] Created ${type} entry for instance ${agentInstanceId}`);
      res.json({ success: true, journalId: result._id });
    } catch (error) {
      console.error('[Journal] POST error:', error);
      res.status(500).json({ error: 'Failed to create journal entry' });
    }
  }
);
```

### 2. Frontend Integration

**Fichier**: `components/V2AgentNode.tsx`

Dans la fonction `handleSendMessage()`, après le traitement LLM:

```typescript
const handleSendMessage = async (e: React.FormEvent) => {
  // ... existing code ...

  try {
    // Envoyer le message à l'agent...
    const agentResponse = await llmService.generateContentStream(...);
    
    // Après avoir reçu la réponse :
    if (agentInstance?.persistenceConfig?.saveChatHistory) {
      // Persister le message utilisateur
      await persistJournalEntry({
        type: 'chat',
        payload: {
          role: 'user',
          content: trimmedInput,
          llmProvider: agent.llmProvider,
          modelUsed: agent.model
        }
      });

      // Persister la réponse de l'agent
      await persistJournalEntry({
        type: 'chat',
        payload: {
          role: 'agent',
          content: agentResponse,
          llmProvider: agent.llmProvider,
          modelUsed: agent.model,
          tokensUsed: calculateTokens(agentResponse)
        }
      });
    }
  } catch (error) {
    // Persister l'erreur si configuré
    if (agentInstance?.persistenceConfig?.saveErrors) {
      await persistJournalEntry({
        type: 'error',
        payload: {
          errorCode: 'AGENT_ERROR',
          message: error.message,
          source: 'llm_service',
          retryable: true,
          attempts: 1
        }
      });
    }
  }
};

async function persistJournalEntry(entry: any) {
  try {
    const response = await fetch(
      `/api/workflows/${workflowId}/agents/${agentInstance.id}/journal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      }
    );
    if (!response.ok) throw new Error('Journal persist failed');
    console.log('[Frontend] Journal entry persisted');
  } catch (error) {
    console.error('[Frontend] Failed to persist journal:', error);
    // Implémenter retry queue si nécessaire
  }
}
```

---

## 🧪 Test d'Acceptation

### Test 1: Persistance Chat Basique

```bash
1. Login (test@example.com)
2. Créer agent et ajouter au workflow
3. Envoyer 3 messages
4. Vérifier en MongoDB:
   db.agent_journals.find({agentInstanceId: <id>}).count()
   # Doit retourner 6 (3 user + 3 agent)
```

### Test 2: Respect de persistenceConfig

```bash
1. Créer agent avec persistenceConfig = { saveChatHistory: false }
2. Envoyer message
3. Vérifier que agent_journals REST VIDE
```

### Test 3: Refresh & Persistence

```bash
1. Envoyer 2 messages
2. F5 refresh
3. Vérifier que le chat local réappelle les messages
4. Vérifier que agent_journals contient les 4 entrées (persisted)
```

---

## ⚠️ Considérations

1. **Ordre d'exécution**: Persister APRÈS avoir montré le message au user (async sans await)
2. **Erreurs de persistance**: Ne pas bloquer le chat si l'API échoue (queue/retry)
3. **Performance**: Les journaux sont lazy-loaded (pas chargés avec workspace)
4. **Sécurité**: Vérifier ownership (user owns agent instance) avant création

---

## 📚 Références

- **Types**: `backend/src/types/persistence.ts`
- **Model**: `backend/src/models/AgentJournal.model.ts`
- **Existing Methods**: `AgentJournal.createChatEntry()`, `.createErrorEntry()`, `.createMediaEntry()`
- **Frontend Component**: `components/V2AgentNode.tsx` (handleSendMessage)

