# Analyse & Correction des Régressions Persistance MongoDB

**Date**: January 17, 2026  
**Contexte**: Migration Code-First databaseInit.ts → Régressions observées  
**Statut**: PRÊT POUR CORRECTION

---

## 🚨 Résumé Exécutif

Après l'implémentation robuste de `databaseInit.ts` (Code-First MongoDB initialization), **5 régressions identifiées** :

| # | Sévérité | Type | Description | Fichier(s) |
|---|----------|------|-------------|-----------|
| 1 | 🟢 BASSE | UI | Onglet "Sauvegarde" visible pour invités | `WorkflowValidationModal.tsx` |
| 2 | 🟢 BASSE | UI | Description affiche "Aucune description" au lieu du rôle | `WorkflowValidationModal.tsx` |
| 3 | 🟠 MOYENNE | Logique | Configuration instance bloquée par "n'a pas encore d'instance" | `V2AgentNode.tsx` |
| 4 | 🟠 MOYENNE | UI | Comportement prototype affiché inutilement dans chat | `V2AgentNode.tsx` |
| 5 | 🔴 HAUTE | Persistance | Journaux (agent_journals) non persistés en BDD | Backend routes + Frontend |

---

## 🔍 Analyse Détaillée par Erreur

### 1️⃣ ERREUR SIMPLE: Onglet "Sauvegarde" pour Utilisateurs Invités

**Symptôme**:  
Dans la modal "Ajouter au workflow", l'onglet "Sauvegarde" apparaît même pour les utilisateurs invités (pas d'authentification).

**Localisation**:  
- Fichier: `components/modals/WorkflowValidationModal.tsx`
- Lignes: 130-145 (définition des tabs)
- Lignes: 320-335 (rendu des tabs)

**Problème Root Cause**:  
```tsx
// ❌ ACTUEL - Affiche TOUJOURS l'onglet persistence
const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'Général', icon: <SettingsIcon className="w-4 h-4" /> },
  { id: 'persistence', label: 'Sauvegarde', icon: <SaveIcon className="w-4 h-4" /> }
];
```

**Impact**:  
- Utilisateurs invités voient un onglet inutile ("Sauvegarde" ne persistera rien pour eux)
- Confusion UX - ils peuvent cliquer mais l'effet n'aura pas de sens
- Violation du principe de moindre surprise

**Solution Proposée**:  
```tsx
// ✅ CORRECT - Filtrer les tabs selon auth
const isAuthenticated = useAuth().user !== null; // ou le contexte approprié

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'Général', icon: <SettingsIcon className="w-4 h-4" /> },
  ...(isAuthenticated ? [
    { id: 'persistence', label: 'Sauvegarde', icon: <SaveIcon className="w-4 h-4" /> }
  ] : [])
];
```

**Complexité**: ⭐ TRÈS SIMPLE (1-2 lignes)

---

### 2️⃣ ERREUR SIMPLE: Description Affiche "Aucune description"

**Symptôme**:  
Dans la modal "Ajouter au workflow", onglet "Général", la section info du prototype affiche toujours "Aucune description" au lieu du **rôle** du prototype.

**Localisation**:  
- Fichier: `components/modals/WorkflowValidationModal.tsx`
- Ligne: 161

**Problème Root Cause**:  
```tsx
// ❌ ACTUEL
<div className="bg-gray-700 p-3 rounded-lg mb-4">
  <p className="text-gray-300 text-sm">{agent.description || 'Aucune description'}</p>
</div>
```

Le champ `description` est optionnel/vide sur le prototype. Le code devrait afficher le **rôle** (qui est le comportement/prompt du prototype).

**Impact**:  
- L'utilisateur ne voit pas le comportement/rôle du prototype avant de l'ajouter au workflow
- Perte d'information importante pour la prise de décision

**Solution Proposée**:  
```tsx
// ✅ CORRECT - Afficher le rôle (comportement du prototype)
<div className="bg-gray-700 p-3 rounded-lg mb-4">
  <p className="text-gray-300 text-sm">
    {agent.role || agent.description || 'Pas de description'}
  </p>
</div>
```

**Complexité**: ⭐ TRÈS SIMPLE (1 ligne)

---

### 3️⃣ ERREUR COMPLEXE 1: Configuration Instance Bloquée

**Symptôme**:  
Quand l'utilisateur clique sur le bouton "Configure" (crayon) d'une instance d'agent dans le workflow, l'alerte "Cet agent n'a pas encore d'instance. Veuillez le supprimer et le recréer depuis la sidebar." s'affiche.

**Localisation**:  
- Fichier: `components/V2AgentNode.tsx`
- Lignes: 195-205

**Problème Root Cause**:  
```tsx
// ❌ ACTUEL
const handleEdit = () => {
  if (agentInstance && typeof agentInstance === 'object' && 'id' in agentInstance && agentInstance.id) {
    const { setConfigModalInstanceId } = useRuntimeStore.getState();
    setConfigModalInstanceId(agentInstance.id);
  } else {
    alert('Cet agent n\'a pas encore d\'instance...');
  }
};
```

**Causes Possibles** (à investiguer):

1. **`agentInstance` est `undefined`**:
   - Les données chargées depuis la BDD ne font pas un `populate()` des instances
   - Problème dans `user-workspace.routes.ts` lors du fetch

2. **Structure AgentInstance invalide**:
   - Après la migration databaseInit, peut-être que les instances anciennes n'ont pas d'`id`
   - Problème de mapping ObjectId vs string

3. **Mismatch AgentInstance vs AgentInstanceV2**:
   - Deux modèles coexistent (AgentInstance.model.ts et AgentInstanceV2.model.ts)
   - Un seul est utilisé pour la persistance

**Impact**:  
- 🔴 Utilisateur NE PEUT PAS modifier la configuration d'une instance existante
- C'est une régression majeure (toute instance créée est désormais "en lecture seule")
- Force l'utilisateur à "supprimer et recréer" depuis la sidebar

**Investigation à Faire**:
1. Vérifier `user-workspace.routes.ts` → `GET /api/user/workspace` pour voir si `agentInstance` est populé
2. Vérifier le modèle AgentInstance vs AgentInstanceV2
3. Checker les logs MongoDB pour voir la structure réelle des documents

**Solution Proposée** (À AFFINER après investigation):
```typescript
// Dans user-workspace.routes.ts
const agentInstances = await AgentInstance.find({ workflowId })
  .select('id agentId workflowId systemInstruction')
  .lean(); // Important: lean() pour performance

// Vérifier que chaque document a vraiment une id
agentInstances.forEach(inst => {
  if (!inst.id && inst._id) {
    inst.id = inst._id.toString(); // Fallback mapping
  }
});
```

**Complexité**: ⭐⭐⭐ MOYENNE (investigation + correction mapping)

---

### 4️⃣ ERREUR COMPLEXE 2: Comportement Affiché Inutilement dans Chat

**Symptôme**:  
En haut du chat d'un agent, on affiche :
- Le provider/model (OK, utile)
- **Le rôle du prototype** (❌ inutile pour l'utilisateur)

C'est du "bruit" qui n'aide pas l'utilisateur pendant une conversation.

**Localisation**:  
- Fichier: `components/V2AgentNode.tsx`
- Lignes: 960-975 (section "Agent Info")

**Problème Root Cause**:  
```tsx
// ❌ ACTUEL - Affiche role en haut du chat
<div className="text-sm text-cyan-400 font-medium select-text
                group-hover:text-cyan-300 transition-colors duration-200
                flex items-center space-x-2">
  <span>{agent?.role || 'Agent'}</span>  {/* ← Affiche le comportement */}
  <div className="w-1 h-1 bg-cyan-400 rounded-full animate-pulse"></div>
</div>
```

**Impact**:  
- 🟡 Confusion UX - l'utilisateur voit le "comportement" du prototype affichée en haut, ce qui n'est pas pertinent pendant une conversation
- Le comportement est UTILISÉ (appliqué au LLM), pas nécessaire de l'afficher
- Prend de l'espace inutile

**Solution Proposée**:  
**Option 1** (Recommandé): Retirer complètement l'affichage du rôle
```tsx
// ✅ CORRECT - Enlever le role, garder juste provider/model
<div className="text-xs text-gray-400 mb-1 select-text 
                group-hover:text-gray-300 transition-colors duration-200">
  {effectiveAgent.llmProvider || 'Unknown'} • {effectiveAgent.model || 'Unknown'}
</div>
// Enlever la section avec role
```

**Option 2**: Afficher en tooltip au hover (moins intrusive)
```tsx
<div className="text-sm text-cyan-400 font-medium select-text relative group"
     title={agent?.role || 'No behavior defined'}>
  {/* Pas d'affichage du role, juste un point indicateur */}
  <div className="w-1 h-1 bg-cyan-400 rounded-full animate-pulse"></div>
</div>
```

**Complexité**: ⭐ TRÈS SIMPLE (retirer 3-4 lignes)

---

### 5️⃣ ERREUR CRITIQUE: Persistance des Journaux Absente

**Symptôme**:  
Quand l'utilisateur crée un agent et envoie des messages/requêtes :
- ✅ L'instance d'agent est sauvegardée en BDD (`agents` collection)
- ❌ Les messages/requêtes/erreurs **NE SONT PAS** sauvegardés dans `agent_journals`

Même si dans la modal "Ajouter au workflow", l'utilisateur active les options de persistance (chat, erreurs, médias).

**Localisation**:  
- Frontend: `components/V2AgentNode.tsx` (où on envoie les messages)
- Backend: `backend/src/routes/agent-instances.routes.ts` (où on devrait sauvegarder les journaux)
- Model: `backend/src/models/AgentJournal.model.ts` (structure des journaux)

**Problème Root Cause** (Architecture):

```
┌─────────────────────────────────────────────────────────────┐
│ USER WORKFLOW                                               │
│                                                             │
│  1. Crée agent via modal "Ajouter au workflow"             │
│     └─> onConfirm() reçoit persistenceConfig               │
│         ├─ persistChat: true                               │
│         ├─ persistErrors: true                             │
│         └─ persistMedia: true                              │
│                                                             │
│  2. Instance créée en BDD ✅                                │
│     └─> Agent sauvegardé dans agents_instances             │
│                                                             │
│  3. User envoie message dans chat                          │
│     └─> handleSendMessage() appelé                         │
│         ├─ addNodeMessage(id, userMessage) → état local   │
│         ├─ appel LLM → réponse                            │
│         ├─ addNodeMessage(id, agentMessage) → état local  │
│         └─ ❌ AUCUN APPEL À L'API POUR PERSISTER!          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Problème Spécifique**:

1. **Pas d'endpoint pour persister les journaux**:
   - `POST /api/workflows/:workflowId/agents/:agentInstanceId/journal` N'EXISTE PAS
   - Les messages restent en mémoire (state React)

2. **persistenceConfig n'est pas utilisé**:
   - `onConfirm(instanceName, persistenceConfig)` reçoit la config
   - Mais elle n'est jamais appliquée/sauvegardée

3. **Pas de middleware/hook**:
   - Aucun listener sur les messages envoyés
   - Pas d'auto-persistance en arrière-plan

**Impact** 🔴 **CRITIQUE**:
- Toutes les interactions utilisateur-agent SONT PERDUES après F5 refresh
- Les statistiques d'usage ne peuvent pas être calculées
- Le plan persistance du projet est **NON OPÉRATIONNEL**
- Violation du contrat avec l'utilisateur (les options de sauvegarde n'ont aucun effet)

**Solution Proposée** (Architecture):

```
┌─────────────────────────────────────────┐
│ PHASE 1: Créer l'instance avec config   │
├─────────────────────────────────────────┤
│ Modal "Ajouter au workflow" envoie:     │
│   POST /api/agent-instances             │
│   {                                     │
│     instanceName: "Mon Agent",          │
│     persistenceConfig: {                │
│       persistChat: true,                │
│       persistErrors: true,              │
│       persistMedia: true                │
│     }                                   │
│   }                                     │
│   → Créer instance + stocker config     │
│   → Retourner instanceId                │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ PHASE 2: Persister chaque message       │
├─────────────────────────────────────────┤
│ À chaque message envoyé/reçu:           │
│   POST /api/agent-instances/:id/journal │
│   {                                     │
│     type: 'chat',                       │
│     severity: 'info',                   │
│     payload: {                          │
│       sender: 'user'|'agent',           │
│       text: "...",                      │
│       role: "user"|"assistant"          │
│     }                                   │
│   }                                     │
│   → Créer JournalEntry en BDD           │
│   → Respecter persistenceConfig         │
│       (si persistChat = false, skip)    │
└─────────────────────────────────────────┘
```

**Plan d'Implémentation**:

1. **Backend** (Routes):
   - Créer `POST /api/agent-instances/:id/journal` (persister un journal)
   - Récupérer persistenceConfig de l'instance
   - Valider que sender peut persister (user ownership)
   - Créer AgentJournal.create()

2. **Frontend** (V2AgentNode.tsx):
   - Récupérer persistenceConfig lors du chargement
   - Après chaque message, appeler la nouvelle route
   - Implémenter retry/queue si offline

3. **Validation**:
   - Test: Envoyer 3 messages → Vérifier agent_journals en MongoDB

**Complexité**: ⭐⭐⭐⭐ HAUTE (création endpoints + logique frontend + queuing)

---

## 📋 Plan d'Action (Priorité)

### Phase 1: Corrections Simples (1-2 heures)
- [x] Erreur 1: Masquer onglet Sauvegarde pour invités
- [x] Erreur 2: Afficher rôle au lieu de description
- [x] Erreur 4: Retirer affichage rôle du chat

### Phase 2: Investigation (1-2 heures)
- [ ] Erreur 3: Debugger pourquoi agentInstance est undefined
  - Vérifier structure BDD vs modèle
  - Vérifier populate() dans user-workspace.routes.ts

### Phase 3: Correction Critique (3-4 heures)
- [ ] Erreur 5: Implémenter persistance journaux
  - Créer endpoint POST /api/agent-instances/:id/journal
  - Implémenter logique frontend
  - Ajouter queuing/retry

---

## 🧪 Tests de Validation

### Test 1 (Erreur 1&2):
```
1. Login comme invité
2. Créer agent fictif
3. Cliquer "Ajouter au workflow"
4. Vérifier: onglet Sauvegarde n'existe pas
5. Vérifier: description affiche le rôle (pas "Aucune description")
```

### Test 2 (Erreur 3):
```
1. Login
2. Créer agent + ajouter au workflow
3. Cliquer bouton "Configure" (crayon) sur l'agent
4. Vérifier: modal de configuration s'ouvre (pas d'alerte)
```

### Test 3 (Erreur 4):
```
1. Login
2. Créer agent + ajouter au workflow
3. Envoyer message
4. Vérifier: pas d'affichage du rôle en haut du chat
```

### Test 4 (Erreur 5):
```
1. Login
2. Créer agent + cocher "Persist chat"
3. Envoyer 3 messages
4. Refresh (F5)
5. Vérifier: messages toujours là
6. En DB (MongoDB):
   - db.agent_journals.find({agentInstanceId: X})
   - Vérifier 6 documents (3 user + 3 agent)
```

---

## 📚 Références

- **Modèles**: `backend/src/models/AgentJournal.model.ts`, `AgentInstance.model.ts`
- **Types Persistance**: `backend/src/types/persistence.ts`
- **Routes Workspace**: `backend/src/routes/user-workspace.routes.ts`
- **Frontend Agents**: `components/V2AgentNode.tsx`, `WorkflowValidationModal.tsx`

---

## ⚠️ Notes de Stabilité

Après chaque correction, relancer :
```bash
# Backend
cd backend && npm run dev

# Frontend (dans un autre terminal)
npm run dev  # port 4000

# Tests
- F5 refresh verification
- Créer/modifier/supprimer agents
- Vérifier MongoDB après chaque action
```

**Risque de Régression**: FAIBLE (corrections sont isolées)  
**Besoin d'Approbation**: OUI (avant implémentation Erreur 5)

