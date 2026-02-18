# 📋 PLAN D'IMPLÉMENTATION - Correction Bug Doublons Journaux

**Date:** 2026-02-18  
**Status:** 🟢 APPROUVÉ - Prêt pour implémentation  
**Estimé:** 2.5-3 heures  

---

## 📊 DÉCISIONS FINALES ARRÊTÉES

| Décision | Choix | Raison |
|----------|-------|--------|
| **Timestamp Precision** | Second-level (à la seconde) | Plus safe, collision très rare |
| **State Persistence** | YES - Zustand hydration | Survit page refresh automatiquement |
| **Manual Reset API** | NO - edge cases handled | Pas de complexité inutile |
| **Migration journaux** | DELETE ALL + restart | Démarre de zéro, valide immédiatement la solution |

---

## 🎯 PHASES D'IMPLÉMENTATION

### PHASE 1️⃣: Frontend - useRuntimeStore Modifications
**Durée estimée:** 40 minutes  
**Fichiers à modifier:** 1  
**Complexité:** Faible  

#### Étape 1.1 - Lire et comprendre l'état actuel
- [ ] Lire `stores/useRuntimeStore.ts` (lignes 1-100)
- [ ] Identifier la structure `nodeMessages`
- [ ] Vérifier les actions existantes

#### Étape 1.2 - Ajouter lastSavedAt state
- [ ] Ajouter champ `lastSavedAt: Record<string, Date | null>`
- [ ] Initialiser avec `{}`
- [ ] Ajouter type dans l'interface

#### Étape 1.3 - Implémenter actions
- [ ] `setLastSavedAt: (nodeId: string, timestamp: Date) => void`
- [ ] `clearLastSavedAt: (nodeId: string) => void`
- [ ] `getNewMessages: (nodeId: string) => ChatMessage[]`

#### Étape 1.4 - Tester logique getNewMessages
```typescript
getNewMessages: (nodeId) => {
    const messages = get().nodeMessages[nodeId] || [];
    const lastSaved = get().lastSavedAt[nodeId];
    
    if (!lastSaved) {
        console.log(`[useRuntimeStore] First save for ${nodeId}: returning all messages`);
        return messages;
    }
    
    const newMessages = messages.filter(msg => {
        const msgTime = msg.timestamp ? new Date(msg.timestamp) : new Date(0);
        const isnew = msgTime.getTime() > lastSaved.getTime();
        return isnew;
    });
    
    console.log(`[useRuntimeStore] New messages for ${nodeId}: ${newMessages.length}/${messages.length}`);
    return newMessages;
}
```

**Validation:**
- [ ] TypeScript compiles without errors
- [ ] No console errors
- [ ] getNewMessages returns [] when no new messages
- [ ] getNewMessages returns all on first save

---

### PHASE 2️⃣: Backend - AgentJournal Model + Cleanup
**Durée estimée:** 35 minutes  
**Fichiers à modifier:** 2  
**Complexité:** Moyenne  

#### Étape 2.1 - Préparer nettoyage de la BDD
- [ ] Créer script de cleanup: `backend/scripts/cleanup-journals.ts`
- [ ] Script doit: DELETE ALL from agent_journals
- [ ] Script doit: Log nombre de documents supprimés
- [ ] Runner le script pour nettoyer la DB

#### Étape 2.2 - Ajouter fields de déduplication au modèle
**Fichier:** `backend/src/models/AgentJournal.model.ts`

```typescript
interface IAgentJournal extends Document {
    agentInstanceId: mongoose.Types.ObjectId;
    workflowId: mongoose.Types.ObjectId;
    type: JournalEntryType;
    severity: JournalSeverity;
    timestamp: Date;
    payload: ChatJournalPayload | ErrorJournalPayload | MediaJournalPayload | ...;
    sessionId?: string;
    
    // ⭐ NEW FIELDS:
    _deduplicationKey?: string;  // hash(instanceId + timestamp + content)
    _createdAt: Date;            // When inserted into MongoDB
}
```

- [ ] Ajouter `_deduplicationKey?: string` au schema
- [ ] Ajouter `_createdAt: { type: Date, default: Date.now }` 
- [ ] Créer index: `{ _deduplicationKey: 1 } UNIQUE, SPARSE`

#### Étape 2.3 - Ajouter logique de déduplication au service
**Fichier:** `backend/src/services/journal.service.ts`

```typescript
private generateDeduplicationKey(
    agentInstanceId: string, 
    timestamp: Date, 
    content: string
): string {
    const key = `${agentInstanceId}|${timestamp.toISOString()}|${content.substring(0, 100)}`;
    return crypto.createHash('sha256').update(key).digest('hex');
}
```

- [ ] Importer `crypto` module
- [ ] Ajouter méthode `generateDeduplicationKey()`
- [ ] Appeler dans `createJournalEntry()` avant insert

#### Étape 2.4 - Test backend
- [ ] TypeScript compiles
- [ ] build succeeds: `npm run build`
- [ ] No runtime errors on startup

**Validation:**
- [ ] Agent journals table est vide ✅
- [ ] Deduplication key généré correctement
- [ ] Index créé sans erreur

---

### PHASE 3️⃣: Frontend - SavePrototypeButton Modifications
**Durée estimée:** 35 minutes  
**Fichiers à modifier:** 2  
**Complexité:** Moyenne  

#### Étape 3.1 - Importer les nouvelles fonctions
**Fichier:** `components/SavePrototypeButton.tsx`

- [ ] Import `getNewMessages` depuis useRuntimeStore
- [ ] Import `setLastSavedAt` depuis useRuntimeStore

#### Étape 3.2 - Modifier persistJournals()
```typescript
const persistJournals = useCallback(async (): Promise<{ saved: number; errors: number }> => {
    let saved = 0;
    let errors = 0;
    const backendUrl = getBackendUrl();
    const runtimeStore = useRuntimeStore.getState();
    
    // Map pour tracker les lastSavedAt à jour après succès
    const nodesToUpdate: Map<string, Date> = new Map();

    for (const [nodeId, messages] of Object.entries(nodeMessages)) {
        if (!messages || messages.length === 0) continue;

        const node = nodes.find(n => n.id === nodeId) as V2WorkflowNode | undefined;
        const agentInstance = node?.data?.agentInstance;
        const effectiveWorkflowId = node?.data?.workflowId || workflowId;

        if (!agentInstance?.id || !effectiveWorkflowId) {
            console.warn(`[SavePrototypeButton] Skipping node ${nodeId} - no agentInstance`);
            continue;
        }

        // ⭐ NEW: Récupérer SEULEMENT les nouveaux messages
        const newMessages = runtimeStore.getNewMessages(nodeId);
        
        if (newMessages.length === 0) {
            console.log(`[SavePrototypeButton] No new messages for node ${nodeId}`);
            continue;
        }

        console.log(`[SavePrototypeButton] 📤 Persisting ${newMessages.length} NEW messages (from total ${messages.length})`);

        // Envoyer chaque NOUVEAU message au backend
        for (const message of newMessages) {
            try {
                const response = await fetch(
                    `${backendUrl}/api/workflows/${effectiveWorkflowId}/instances/${agentInstance.id}/journal`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${accessToken}`
                        },
                        body: JSON.stringify({
                            type: 'chat',
                            payload: {
                                role: message.sender === 'user' ? 'user' : 'agent',
                                content: message.text || '',
                                llmProvider: node?.data?.agent?.llmProvider,
                                modelUsed: node?.data?.agent?.model
                            }
                        })
                    }
                );

                if (response.ok) {
                    const result = await response.json();
                    if (result.skipped) {
                        console.log(`[SavePrototypeButton] Message skipped: ${result.reason}`);
                    } else {
                        saved++;
                    }
                } else {
                    console.warn(`[SavePrototypeButton] Failed to persist message:`, await response.text());
                    errors++;
                }
            } catch (err) {
                console.error(`[SavePrototypeButton] Error persisting message:`, err);
                errors++;
            }
        }
        
        // ⭐ IMPORTANT: Marquer le timestamp SEULEMENT si des messages nouveaux ont été envoyés
        if (newMessages.length > 0) {
            nodesToUpdate.set(nodeId, new Date());
        }
    }

    // ⭐ CRITIQUE: Mettre à jour lastSavedAt APRÈS le succès
    for (const [nodeId, timestamp] of nodesToUpdate) {
        runtimeStore.setLastSavedAt(nodeId, timestamp);
        console.log(`[SavePrototypeButton] Updated lastSavedAt for ${nodeId}: ${timestamp.toISOString()}`);
    }

    console.log(`[SavePrototypeButton] ✅ Journals persisted: ${saved} saved, ${errors} errors`);
    return { saved, errors };
}, [nodeMessages, nodes, workflowId, accessToken]);
```

#### Étape 3.3 - Test SavePrototypeButton
- [ ] TypeScript compiles
- [ ] No console errors on click
- [ ] Console logs show correct behavior

**Validation:**
- [ ] Bouton Save fonctionne sans erreur
- [ ] Console logs "Persisting X NEW messages"
- [ ] Console logs "Updated lastSavedAt"

---

### PHASE 4️⃣: Validation End-to-End
**Durée estimée:** 30 minutes  
**Complexité:** Moyenne  

#### Scénario de Test 1: Premier Save
```
1. ✓ Créer agent A
2. ✓ Envoyer 3 messages
3. ✓ Click Save button
4. ✓ Vérifier: Console affiche "Persisting 3 NEW messages"
5. ✓ Vérifier: MongoDB a 3 documents
6. ✓ Vérifier: lastSavedAt[nodeId] = timestamp
```

- [ ] Exécuter
- [ ] Vérifier MongoDB: 3 docs
- [ ] Vérifier console logs

#### Scénario de Test 2: Deuxième Save (aucun nouveau message)
```
1. ✓ Click Save button (sans ajouter messages)
2. ✓ Vérifier: Console affiche "No new messages"
3. ✓ Vérifier: 0 POST requests
4. ✓ Vérifier: MongoDB inchangé (3 docs)
```

- [ ] Exécuter
- [ ] Network tab: 0 POST requests
- [ ] MongoDB: Toujours 3 docs

#### Scénario de Test 3: Reconnexion + Nouveaux Messages + Save
```
1. ✓ Logout complet
2. ✓ Reconnect (login)
3. ✓ Ouvrir même workflow/agent
4. ✓ Envoyer 2 NEW messages
5. ✓ Click Save
6. ✓ Vérifier: Console affiche "Persisting 2 NEW messages"
7. ✓ Vérifier: MongoDB a 5 documents (3 + 2, PAS de doublons!)
8. ✓ Vérifier: lastSavedAt mis à jour
```

- [ ] Exécuter
- [ ] Network tab: 2 POST requests exactement
- [ ] MongoDB: 5 documents total
- [ ] ✅ NO DUPLICATES = SUCCESS!

#### Scénario de Test 4: Multiple Saves Rapides
```
1. ✓ Envoyer message 1
2. ✓ Click Save
3. ✓ Envoyer message 2
4. ✓ Click Save (rapidement)
5. ✓ Vérifier: Pas de race condition
6. ✓ Vérifier: MongoDB a 2 docs
```

- [ ] Exécuter
- [ ] MongoDB: 2 documents exacts
- [ ] No duplicates

---

## 📋 CHECKLIST FINALE

### Code Quality
- [ ] TypeScript compiles without errors
- [ ] No console errors/warnings (async not handled, etc)
- [ ] Code follows SOLID principles
- [ ] Comments added where necessary
- [ ] No magic numbers or string literals

### Performance
- [ ] getNewMessages() is efficient (O(n))
- [ ] No unnecessary re-renders
- [ ] No memory leaks (useCallback dependencies correct)

### Testing
- [ ] Unit tests for getNewMessages()
- [ ] Integration tests for persist flow
- [ ] E2E tests for all 4 scenarios above
- [ ] Stress test: 100+ messages

### Documentation
- [ ] Code comments explain logic
- [ ] Console.logs helpful for debugging
- [ ] Update Dev_rules.md journal section (optional)

### Deployment
- [ ] Database backup before cleanup
- [ ] Cleanup script verified
- [ ] Rollback plan documented
- [ ] Monitor MongoDB journal collection size

---

## 🚀 STARTING NOW - GO TO PHASE 1

Commençons par la Phase 1: useRuntimeStore modifications!

