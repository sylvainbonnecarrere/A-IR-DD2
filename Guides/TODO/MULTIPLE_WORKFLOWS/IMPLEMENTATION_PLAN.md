# Plan d'Implémentation - Gestion de Multiples Workflows (MULTIPLE_WORKFLOWS)

> **Objectif** : Permettre aux utilisateurs connectés de créer, gérer et basculer entre plusieurs workflows avec persistance complète dans MongoDB.

> **Responsable Planning** : Agent Planificateur  
> **Destinataires** : Agents de codage spécialisés (.github/agents)  
> **Date** : Février 2026  

---

## 📋 Vue d'Ensemble du Plan

### Résumé de la Feature

**Actuelle** : Un utilisateur connecté a accès à **un seul workflow** actif par défaut.

**Nouvelle Logique** :
1. Tout nouvel utilisateur reçoit **un workflow par défaut** à sa création
2. L'utilisateur peut créer des **workflows supplémentaires**
3. Via une **nouvelle page BOS "Gérer ses workflows"**, l'utilisateur peut :
   - Voir tous ses workflows avec métadonnées (dates, nombre d'agents/nodes)
   - Créer un nouveau workflow
   - Sélectionner un workflow (devient actif, recharge tous les contenus)
   - Supprimer un workflow (cascade complète)
4. **Les utilisateurs invités** voient : "Utilisateur invité, workflow de démonstration"
5. **Templates de prototypes** : Communs à tous les workflows (non filtrés par workflow)

---

## 🏗️ Impact Architectural

### Domaines Affectés

#### 1. **Design Domain** (Zustand useDesignStore)
```typescript
// AJOUT: Gestion du workflow actif
currentWorkflowId: string | null;        // Workflow sélectionné
workflows: IWorkflow[];                  // Liste des workflows utilisateur
isLoadingWorkflow: boolean;               // État de chargement

// ACTIONS
selectWorkflow: (workflowId: string) => void;  // Activer un workflow
loadUserWorkflows: () => void;                  // Charger liste workflows
deleteWorkflow: (workflowId: string) => void;   // Supprimer workflow
createWorkflow: (name, desc) => void;          // Créer workflow
```

#### 2. **Runtime Domain** (Zustand useRuntimeStore)
```typescript
// MODIFICATION: L'état des messages et exécution reste par nodeId
// AJOUT: Métadonnées de chargement
workflowLoadingState: 'idle' | 'loading' | 'error';
workflowLoadError: string | null;
```

#### 3. **Backend - Collections MongoDB**
```
Existing:
  - workflows               (déjà existe avec userId)
  - agents (prototypes)     (existants, communs à tous workflows)
  - agent_instances         (par workflow via workflowId)
  - workflow_nodes (V2)     (par workflow)
  - workflow_edges (V2)     (par workflow)
  - journals                (par workflow/instance)

Modifications:
  - users                   (AJOUT: defaultWorkflowId field)
```

---

## 🗄️ Spécifications Base de Données MongoDB

### 1. Schéma User.model.ts - EXTENSION

```typescript
// Ajouter defaultWorkflowId au schéma User
interface IUser extends Document {
    // ... champs existants
    defaultWorkflowId?: mongoose.Types.ObjectId;  // Créé à l'inscription
    workflowCount: number;                         // Compteur workflows (0 initial)
    lastActiveWorkflowId?: mongoose.Types.ObjectId;  // Tracking pour hydration
}

// Index composite pour performance
UserSchema.index({ email: 1, defaultWorkflowId: 1 });
```

### 2. Schéma Workflow.model.ts - VALIDATION

✅ **DÉJÀ IMPLÉMENTÉ** (Confirmer conformité) :
```typescript
interface IWorkflow extends Document {
    userId: mongoose.Types.ObjectId;     // ✅ Lien utilisateur
    name: string;                        // ✅ Nom workflow
    description?: string;                // ✅ Description
    isActive: boolean;                   // ✅ Workflow actif
    isDefault: boolean;                  // ✅ Marqué comme défaut
    canvasState: ICanvasState;           // ✅ État visuel
    createdAt: Date;                     // ✅ Métadonnées
    updatedAt: Date;
    lastEditedBy?: string;
    isDirty: boolean;
}

// ✅ INDEXES EXISTANTS À CONFIRMER
Composite: { userId: 1, isDefault: 1 }
Simple: { userId: 1, createdAt: -1 }     // Pour tri
```

### 3. Cascade Delete Strategy

**Suppression de Workflow: TOUT ce qui en dépend**

```sql
DELETE FROM workflows WHERE _id = :workflowId

-- Cascade cascade:
DELETE FROM agent_instances WHERE workflowId = :workflowId
DELETE FROM workflow_nodes_v2 WHERE workflowId = :workflowId
DELETE FROM workflow_edges_v2 WHERE workflowId = :workflowId
DELETE FROM journals WHERE workflowId = :workflowId

-- Note: agent_prototypes (templates) NOT deleted (shared across workflows)
```

**Transaction atomique requise** (MongoDB transactions via Mongoose).

---

## 🔌 API Backend - Endpoints RESTful

### Existing Endpoints à VALIDER

```
GET    /api/workflows                    ✅ Liste workflows utilisateur
POST   /api/workflows                    ✅ Créer workflow
GET    /api/workflows/:id                ✅ Get workflow spécifique
PUT    /api/workflows/:id                ✅ Update workflow
DELETE /api/workflows/:id                ✅ Delete workflow (NEED CASCADE)
```

### NEW Endpoints pour Gestion

```
1. POST /api/workflows/:id/select
   ---
   Objectif: Activer un workflow (rendre isActive=true, autres=false)
   Authentification: requireAuth + requireOwnershipAsync
   
   Request Body: {} (empty)
   Response: 
   {
     success: true,
     workflow: { ...updated workflow object },
     reloadedData: {
       agents: [...],              // Agent instances du workflow
       prototypes: [...],          // Templates globaux (non filtrés)
       nodes: [...],               // Nodes du workflow
       edges: [...],               // Edges du workflow
       canvasState: {...}          // État canvas sauvegardé
     }
   }
   
   Error Codes:
   - 404: Workflow not found
   - 403: Unauthorized
   - 500: Activation failed

2. GET /api/workflows/:id/stats
   ---
   Objectif: Récupérer métadonnées pour affichage en bloc
   Authentification: requireAuth + requireOwnershipAsync
   
   Response:
   {
     workflow: {
       _id: "...",
       name: "...",
       description: "...",
       isActive: boolean,
       isDefault: boolean,
       createdAt: "2026-02-19T...",
       updatedAt: "2026-02-19T...",
       agentInstanceCount: number,      // Nombre d'agents dans ce workflow
       nodeCount: number,               // Nombre de nodes dans ce workflow
       lastModifiedBy: "...",           // User email ou "system"
     }
   }

3. POST /api/workflows/:id/duplicate    (OPTIONNEL PHASE 2)
   Objectif: Dupliquer un workflow (clone avec tous ses contenus)
   Response: { newWorkflow: {...}, message: "..." }

4. POST /api/workflows/:id/export       (OPTIONNEL PHASE 2)
   Objectif: Exporter workflow en JSON
   Response: JSON serialized workflow

5. POST /api/workflows/import           (OPTIONNEL PHASE 2)
   Objectif: Importer dari JSON
```

### UPDATE Existing DELETE Endpoint

```
DELETE /api/workflows/:id
---
CURRENT: Supprime juste le workflow
UPDATE: Ajouter transaction Mongoose pour:

   1. Commencer transaction
   2. Vérifier ownership (requireOwnershipAsync)
   3. Vérifier que ce n'est pas le SEUL workflow
      - Si oui: erreur 400 "Cannot delete last workflow"
   4. Atomically delete:
      - Workflow document
      - Toutes agent_instances avec workflowId
      - Tous workflow_nodes v2 avec workflowId
      - Tous workflow_edges v2 avec workflowId
      - Tous journals avec workflowId
   5. Si user.defaultWorkflowId === deleted: 
      - Reassign à un autre workflow (le plus ancien)
   6. Committer transaction
   7. Response: { success: true, deletedWorkflowId, nextActiveWorkflowId }
   
Error:
   - 400: "Cannot delete the only workflow"
   - 403: Unauthorized
   - 500: Delete failed (rollback transaction)
```

### User Auth Endpoint - ENSURE Creation Default Workflow

```
POST /api/auth/signup
---
UPDATE: Après création user, créer automatiquement:

   const defaultWorkflow = await Workflow.create({
       userId: newUser._id,
       name: "Mon premier workflow",
       description: "Workflow créé par défaut",
       isActive: true,
       isDefault: true,
       canvasState: { zoom: 1, panX: 0, panY: 0 },
       isDirty: false
   });
   
   // Mettre à jour User reference
   newUser.defaultWorkflowId = defaultWorkflow._id;
   await newUser.save();
```

---

## 🎨 Frontend - Composants React

### 1. Nouvelle Page: BosWorkflowManagementPage

**Chemin**: `components/BosWorkflowManagementPage.tsx`

**Structure**:
```tsx
interface BosWorkflowManagementPageProps {
  isAuthenticated: boolean;
  workflows: IWorkflow[];          // Depuis useDesignStore
  currentWorkflowId: string | null;
  onSelectWorkflow: (id: string) => void;
  onCreateWorkflow?: () => void;
  onDeleteWorkflow?: (id: string) => void;
  llmConfigs: LLMConfig[];
  t: (key: string) => string;
}

const BosWorkflowManagementPage: React.FC<...> = ({
  isAuthenticated,
  workflows,
  currentWorkflowId,
  onSelectWorkflow,
  onCreateWorkflow,
  onDeleteWorkflow,
  llmConfigs,
  t
}) => {
  // Render logic:
  
  // IF NOT authenticated:
  //   <GuestMessage text="Utilisateur invité, workflow de démonstration" />
  
  // ELSE:
  //   <Header>
  //     <Title>"Gérer vos workflows"</Title>
  //     <Button onClick={onCreateWorkflow} text="Créer nouveau workflow" />
  //   </Header>
  //   
  //   <WorkflowGrid>
  //     {workflows.map(wf => (
  //       <WorkflowCard
  //         workflow={wf}
  //         isActive={wf._id === currentWorkflowId}
  //         onSelect={() => onSelectWorkflow(wf._id)}
  //         onDelete={() => onDeleteWorkflow(wf._id)}
  //         stats={{
  //           createdAt,
  //           updatedAt,
  //           agentCount,
  //           nodeCount
  //         }}
  //       />
  //     ))}
  //   </WorkflowGrid>
}
```

### 2. Composant WorkflowCard

**Chemin**: `components/workflow/WorkflowCard.tsx`

**Responsabilité**: Afficher un bloc workflow avec:
- Nom + description
- Dates (création, modification)
- Compteurs (agents, nodes)
- Statut (actif/inactif)
- Boutons (Sélectionner, Supprimer)

**Styling**: Adopter charte BOS (jaune/or glow, supervision theme)
```tsx
// Utiliser Tailwind + couleurs jaune glow BOS
// border: 'border-yellow-400' (actif)
// border: 'border-gray-600' (inactif)
// hover: 'hover:shadow-[0 0 15px rgba(234,179,8,0.4)]'

const WorkflowCard: React.FC<WorkflowCardProps> = ({
  workflow,
  isActive,
  stats,
  onSelect,
  onDelete
}) => {
  return (
    <div className={`
      p-4 rounded-lg border transition-all
      ${isActive 
        ? 'bg-yellow-500/20 border-yellow-400 shadow-[0 0 15px rgba(234,179,8,0.4)]'
        : 'bg-gray-800/50 border-gray-600 hover:border-yellow-400/50'
      }
    `}>
      {/* Card Header */}
      <h3 className="text-lg font-semibold text-yellow-300">{workflow.name}</h3>
      {workflow.description && (
        <p className="text-sm text-gray-400 mt-2">{workflow.description}</p>
      )}
      
      {/* Stats Row */}
      <div className="flex gap-4 mt-4 text-xs text-gray-400">
        <span>📅 Créé: {formatDate(stats.createdAt)}</span>
        <span>✏️ Modifié: {formatDate(stats.updatedAt)}</span>
        <span>🤖 Agents: {stats.agentCount}</span>
        <span>🔗 Nodes: {stats.nodeCount}</span>
      </div>
      
      {/* Buttons */}
      <div className="flex gap-2 mt-4">
        <button
          onClick={onSelect}
          className="flex-1 px-3 py-2 bg-yellow-500 text-black rounded hover:bg-yellow-400"
        >
          {isActive ? "Workflow actif" : "Sélectionner"}
        </button>
        {!workflow.isDefault && (
          <button
            onClick={onDelete}
            className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            title="Supprimer workflow et tout son contenu"
          >
            Supprimer
          </button>
        )}
      </div>
      
      {workflow.isDefault && (
        <p className="text-xs text-yellow-400 mt-2">⭐ Workflow par défaut</p>
      )}
    </div>
  );
};
```

### 3. Modal/Dialog: CreerWorkflowDialog

**Chemin**: `components/modals/CreerWorkflowDialog.tsx`

**Responsabilité**: Dialogue modale pour créer nouveau workflow

```tsx
interface CreerWorkflowDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
  isLoading?: boolean;
}

const CreerWorkflowDialog: React.FC<...> = ({
  isOpen,
  onClose,
  onCreat onCreate,
  isLoading
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  
  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Le nom du workflow est requis');
      return;
    }
    try {
      await onCreate(name, description);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Créer un nouveau workflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-yellow-300">
              Nom du workflow *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mon workflow..."
              className="w-full mt-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-yellow-300">
              Description (optionnel)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Décrivez votre workflow..."
              rows={3}
              className="w-full mt-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white">
            Annuler
          </button>
          <button
            onClick={handleCreate}
            disabled={isLoading}
            className="px-4 py-2 bg-yellow-500 text-black rounded hover:bg-yellow-400 disabled:opacity-50"
          >
            {isLoading ? 'Création...' : 'Créer'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
```

### 4. Update BosSubMenu Navigation

**Fichier**: `data/robotNavigation.ts`

**Ajouter item** sous menus BOS (nestedItems) :
```typescript
{
  id: RobotId.Bos,
  name: 'bos_manage_workflows',  // Clé i18n nouvelle
  iconComponent: FolderOpenIcon,  // Icon nouvelle
  path: '/bos/workflows/manage',
  description: 'bos_manage_workflows_desc'
}
```

### 5. Update RobotPageRouter

**Fichier**: `components/RobotPageRouter.tsx`

**Ajouter routing**:
```tsx
// Ajouter import
import { BosWorkflowManagementPage } from './BosWorkflowManagementPage';

// Dans le main switch
if (currentPath.startsWith('/bos/workflows/manage')) {
  return (
    <BosWorkflowManagementPage
      isAuthenticated={isAuthenticated}
      workflows={workflows}
      currentWorkflowId={currentWorkflowId}
      onSelectWorkflow={handleSelectWorkflow}
      onCreateWorkflow={() => setShowCreateDialog(true)}
      onDeleteWorkflow={handleDeleteWorkflow}
      llmConfigs={llmConfigs}
      t={t}
    />
  );
}

// Else render workflow canvas as normal
```

---

## 🧠 Zustand Store Updates

### useDesignStore.ts - MODIFICATIONS

```typescript
interface DesignStore {
  // EXISTING
  agents: Agent[];
  agentInstances: AgentInstance[];
  nodes: V2WorkflowNode[];
  edges: V2WorkflowEdge[];
  
  // ⭐ NEW: Workflow Management
  workflows: IWorkflow[];                    // Liste utilisateur
  currentWorkflowId: string | null;          // Actif
  isLoadingWorkflows: boolean;
  workflowLoadError: string | null;
  
  // ⭐ ACTIONS
  setWorkflows: (workflows: IWorkflow[]) => void;
  setCurrentWorkflowId: (id: string | null) => void;
  selectWorkflow: (workflowId: string) => Promise<void>;
  createWorkflow: (name: string, desc?: string) => Promise<IWorkflow>;
  deleteWorkflow: (workflowId: string) => Promise<void>;
  loadUserWorkflows: () => Promise<void>;
  updateWorkflowStats: (id: string, agents: number, nodes: number) => void;
  
  // ⭐ UTILITY
  getActiveWorkflow: () => IWorkflow | undefined;
  getWorkflowStats: (id: string) => { agentCount: number; nodeCount: number };
}

// Implementation snippet
export const useDesignStore = create<DesignStore>((set, get) => ({
  // ...existing fields
  workflows: [],
  currentWorkflowId: null,
  isLoadingWorkflows: false,
  workflowLoadError: null,
  
  setWorkflows: (workflows) => set({ workflows }),
  
  setCurrentWorkflowId: (id) => set({ currentWorkflowId: id }),
  
  selectWorkflow: async (workflowId) => {
    set({ isLoadingWorkflows: true, workflowLoadError: null });
    try {
      const response = await fetch(`/api/workflows/${workflowId}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) throw new Error(`Cannot select workflow: ${response.statusText}`);
      
      const data = await response.json();
      
      // Update stores atomically
      set({
        currentWorkflowId: workflowId,
        agentInstances: data.reloadedData.agents || [],
        nodes: data.reloadedData.nodes || [],
        edges: data.reloadedData.edges || [],
        isLoadingWorkflows: false
      });
      
      // Update runtime store (via callback to App.tsx)
      // Reset all messages and charts
      
    } catch (error) {
      set({
        workflowLoadError: error.message,
        isLoadingWorkflows: false
      });
      throw error;
    }
  },
  
  createWorkflow: async (name, desc) => {
    try {
      const response = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: desc })
      });
      
      if (!response.ok) throw new Error('Failed to create workflow');
      
      const newWorkflow = await response.json(); const state = get();
      set({ workflows: [...state.workflows, newWorkflow] });
      
      return newWorkflow;
    } catch (error) {
      throw error;
    }
  },
  
  deleteWorkflow: async (workflowId) => {
    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) throw new Error('Failed to delete workflow');
      
      const state = get();
      const remaining = state.workflows.filter(w => w._id !== workflowId);
      
      let newActivId = state.currentWorkflowId;
      if (newActivId === workflowId && remaining.length > 0) {
        newActivId = remaining[0]._id;
      }
      
      set({
        workflows: remaining,
        currentWorkflowId: newActivId
      });
      
    } catch (error) {
      throw error;
    }
  },
  
  loadUserWorkflows: async () => {
    set({ isLoadingWorkflows: true });
    try {
      const response = await fetch('/api/workflows');
      if (!response.ok) throw new Error('Failed to load workflows');
      
      const workflows = await response.json();
      set({ workflows, isLoadingWorkflows: false });
      
      // Auto-select first active (or first if none active)
      const activeWf = workflows.find((w: IWorkflow) => w.isActive) || workflows[0];
      if (activeWf) {
        set({ currentWorkflowId: activeWf._id });
      }
      
    } catch (error) {
      set({ workflowLoadError: error.message, isLoadingWorkflows: false });
    }
  }
}));
```

---

## 🔄 Flux Utilisateur - Scenarios

### Scenario 1: Création Nouvel Utilisateur

```
1. User signs up via /auth/signup
2. Backend: 
   - Create user document
   - Atomically create default workflow:
     {
       userId: newUser._id,
       name: "Mon premier workflow",
       isActive: true,
       isDefault: true,
       createdAt: now(),
       ...
     }
   - Assign user.defaultWorkflowId = workflow._id
3. Frontend (after authentication):
   - useDesignStore.loadUserWorkflows()
   - useDesignStore.selectWorkflow(default._id)
   - Loads agents/nodes/edges for default workflow
   - Renders BosWorkflowManagementPage OR WorkflowCanvas (depending on current path)
```

### Scenario 2: User Creates New Workflow

```
1. User navigates to /bos/workflows/manage
2. Clicks "Créer nouveau workflow"
3. Dialog appears (CreerWorkflowDialog)
4. Enters name + description
5. Clicks "Créer"
6. Frontend:
   - useDesignStore.createWorkflow(name, desc)
   - POST /api/workflows { name, description }
7. Backend:
   - Create workflow document (isActive=false initially)
   - Return new workflow
8. Frontend:
   - Add to workflows array
   - Show notification "Workflow créé"
   - Dialog closes
   - New workflow appears in list (NOT selected)
```

### Scenario 3: User Selects Different Workflow

```
1. User in BosWorkflowManagementPage sees list of workflows
2. Clicks "Sélectionner" on workflow X
3. Frontend:
   - Show loading state
   - useDesignStore.selectWorkflow(workflowId)
   - Calls POST /api/workflows/:id/select
4. Backend:
   - Transaction BEGIN
   - Update Workflows: isActive=false for all other
   - isActive=true for this one
   - Return reloadedData containing:
     - agents/nodes/edges for this workflow
     - canvas state
   - Transaction COMMIT
5. Frontend:
   - useDesignStore.setCurrentWorkflowId(id)
   - useDesignStore.setNodes/setEdges/setAgentInstances()
   - useRuntimeStore.resetAll() (clear old chat messages)
   - Redirect to /bos/dashboard or /workflow (canvas view)
   - Show notification "Workflow sélectionné"
```

### Scenario 4: User Deletes Workflow

```
1. User in BosWorkflowManagementPage
2. Clicks "Supprimer" on workflow X
3. Confirmation dialog:
   "Êtes-vous sûr? Cette action supprimera le workflow et TOUS ses contenus
    (agents, notes, journaux)."
4. If confirm:
   - Frontend: useDesignStore.deleteWorkflow(id)
   - DELETE /api/workflows/:id
5. Backend:
   - Transaction BEGIN
   - Delete workflow
   - Delete all agent_instances with workflowId
   - Delete all workflow_nodes/edges with workflowId
   - Delete all journals with workflowId
   - If this was user.defaultWorkflowId, reassign to another
   - Transaction COMMIT
6. Frontend:
   - workflows array updated (filter out deleted)
   - If deleted was active, auto-select another available
   - Redirect to /bos/workflows/manage or new active workflow
   - Show notification "Workflow supprimé"
```

### Scenario 5: Guest User Accesses Workflow Management

```
1. Guest user (no auth token) navigates to /bos/workflows/manage
2. Frontend:
   - useAuthContext detects isAuthenticated=false
   - BosWorkflowManagementPage renders with isAuthenticated=false
3. Display:
   <GuestMessage>
     "Utilisateur invité, workflow de démonstration"
     <p>Connectez-vous pour gérer plusieurs workflows</p>
   </GuestMessage>
4. Guest can still access /workflow (canvas) to use demo
5. Data NOT persisted on page close
```

---

## 🌐 Internationalization (i18n)

### Nouvelles Clés i18n

**Fichier**: `i18n/*.ts` (toutes les langues)

```typescript
// BOS Menu Items
bos_manage_workflows: "Gérer ses workflows",
bos_manage_workflows_desc: "Créer, sélectionner et gérer multiples workflows",

// BosWorkflowManagementPage
page_bos_manage_workflows_title: "Gérer vos workflows",
page_bos_manage_workflows_description: "Créez et basculez entre plusieurs workflows",
nav_create_workflow: "Créer nouveau workflow",
nav_guest_message: "Utilisateur invité, workflow de démonstration",
nav_connect_for_workflows: "Connectez-vous pour gérer plusieurs workflows",

// WorkflowCard
workflow_card_created: "Créé",
workflow_card_modified: "Modifié",
workflow_card_agents: "Agents",
workflow_card_nodes: "Nœuds",
workflow_card_select: "Sélectionner",
workflow_card_delete: "Supprimer",
workflow_card_active: "Workflow actif",
workflow_card_default: "Workflow par défaut",
workflow_card_confirm_delete: "Êtes-vous sûr? Cette action est irréversible.",

// CreerWorkflowDialog
dialog_create_workflow_title: "Créer un nouveau workflow",
dialog_workflow_name: "Nom du workflow",
dialog_workflow_name_required: "Le nom du workflow est requis",
dialog_workflow_description: "Description (optionnel)",
dialog_workflow_description_placeholder: "Décrivez votre workflow...",
dialog_workflow_create_button: "Créer",
dialog_workflow_cancel_button: "Annuler",
dialog_workflow_creating: "Création...",

// Notifications
notification_workflow_created: "Workflow créé avec succès",
notification_workflow_selected: "Workflow sélectionné",
notification_workflow_deleted: "Workflow suprimé",
notification_workflow_error: "Erreur lors de l'opération sur le workflow",

// Errors
error_cannot_delete_last_workflow: "Impossible de supprimer le seul workflow",
error_workflow_not_found: "Workflow non trouvé",
error_load_workflows: "Erreur lors du chargement des workflows",
```

---

## 🧪 Tests et Validation

### Cas de Test Non-Régression

#### Frontend Tests

```typescript
// test/integration/MultipleWorkflows.test.tsx

describe('Multiple Workflows Feature', () => {
  
  1. Guest User Cannot Access Management Page
     - Navigates to /bos/workflows/manage
     - Sees guest message, not workflow list
     - Cannot click "Créer"
  
  2. New User Gets Default Workflow
     - After signup, only 1 workflow exists
     - isDefault=true on first workflow
     - isActive=true
  
  3. Create Workflow
     - Click "Créer nouveau workflow"
     - Enters name & description
     - New workflow appears in list
     - isDefault=false, isActive=false
  
  4. Select Workflow
     - List shows multiple workflows
     - Click select on workflow B
     - B becomes active, others inactive
     - Canvas updates with B's agents/nodes
     - Messages reset (runtime store cleared)
     - Prototypes still visible (shared across workflows)
  
  5. Delete Workflow
     - Click delete on workflow C
     - Confirm dialog shows
     - After confirm: C removed from list
     - If C was active, auto-select another
     - Cascade delete verified (no orphaned data)
  
  6. Cannot Delete Last Workflow
     - Try to delete when only 1 workflow
     - Error notification "Cannot delete..."
     - Workflow remains listed
  
  7. Navigation After Select
     - Select workflow A
     - Navigate to /archi/prototype
     - Prototypes for any workflow visible (not filtered)
     - Navigate back to /bos/workflows/manage
     - Workflow A still marked as active
  
  8. Persistence After Refresh
     - Select workflow X
     - Reload page (F5)
     - Should reload into workflow X (via lastActiveWorkflowId)
     - Agents/nodes/edges correct
     - Messages reset (runtime volatile)
});
```

#### Backend Tests

```typescript
// backend/tests/workflows.test.ts

describe('Workflows API', () => {
  
  1. Create Default on User Signup
     - POST /auth/signup
     - Verify user.defaultWorkflowId exists
     - Verify workflow created with isDefault=true
  
  2. List User Workflows
     - GET /api/workflows (auth required)
     - Returns only user's workflows
     - Sorted by updatedAt DESC
     - includes agentCount
  
  3. Select Workflow Transaction
     - POST /api/workflows/:id/select (auth + ownership)
     - Only target workflow has isActive=true
     - Others have isActive=false
     - Response contains reloadedData
     - No orphaned data
  
  4. Delete Workflow Cascade
     - DELETE /api/workflows/:id
     - Workflow deleted
     - agent_instances filtered (count = 0)
     - workflow_nodes filtered (count = 0)
     - workflow_edges filtered (count = 0)
     - journals filtered (count = 0)
     - If was default, reassigned to next
     - Cannot delete if only 1 remaining
  
  5. Ownership & Isolation
     - User A deletes their workflow
     - User B's workflows unaffected
     - User B cannot access/delete User A's
  
  6. Stats Endpoint
     - GET /api/workflows/:id/stats
     - Returns accurate agentInstanceCount
     - Returns accurate nodeCount
     - Includes metadata (created, updated, etc)
});
```

#### MongoDB Integrity Tests

```sql
// backend/tests/mongodb-integrity.test.ts

1. No Orphaned Children
   - For each workflow deleted, verify:
     Select count(*) FROM agent_instances WHERE workflowId = :deletedId = 0
     Select count(*) FROM workflow_nodes_v2 WHERE workflowId = :deletedId = 0
     Select count(*) FROM workflow_edges_v2 WHERE workflowId = :deletedId = 0
     Select count(*) FROM journals WHERE workflowId = :deletedId = 0

2. Templates Not Deleted
   - Verify agent_prototypes count unchanged
   - Templates shared across workflows

3. User Isolation
   - No queries allow cross-user access
   - All workflows filtered by userId

4. Indexes Correct
   - Confirm { userId, isDefault } index
   - Confirm { userId, createdAt } index for sorting
```

---

## 📋 Checklist d'Implémentation

### Phase 1: Backend Core (⭐ START HERE)

- [ ] **Database**
  - [ ] Confirm Workflow.model.ts is correct (isDefault, isActive, canvasState)
  - [ ] Index optimization verified
  - [ ] Cascade delete logic implemented
  
- [ ] **API Endpoints**
  - [ ] POST /api/workflows/:id/select (NEW)
  - [ ] GET /api/workflows/:id/stats (NEW)
  - [ ] DELETE /api/workflows/:id (UPDATE cascade)
  - [ ] POST /api/auth/signup (UPDATE create default)
  - [ ] POST /api/workflows (VERIFY existing)
  - [ ] GET /api/workflows (VERIFY existing)
  
- [ ] **Error Handling**
  - [ ] Cannot delete last workflow error
  - [ ] Transaction rollback on failure
  - [ ] Ownership validation on all endpoints
  
- [ ] **Backend Tests**
  - [ ] Unit: CRUD workflows
  - [ ] Integration: Cascade delete
  - [ ] E2E: Select workflow flow

### Phase 2: Frontend UI (THEN)

- [ ] **Components**
  - [ ] BosWorkflowManagementPage.tsx
  - [ ] WorkflowCard.tsx + styling
  - [ ] CreerWorkflowDialog.tsx
  
- [ ] **Navigation**
  - [ ] Update robotNavigation.ts (add BOS item)
  - [ ] Update RobotPageRouter.tsx
  - [ ] Update BosSubMenu.tsx
  
- [ ] **Store**
  - [ ] Extend useDesignStore (workflows, actions)
  - [ ] Extend useRuntimeStore if needed
  
- [ ] **Integration**
  - [ ] Hook into App.tsx for workflow selection
  - [ ] Handle loading/error states
  - [ ] Reset data on select
  
- [ ] **Frontend Tests**
  - [ ] Component unit tests
  - [ ] Integration: user workflows
  - [ ] Scenario: select/delete

### Phase 3: Polish & Docs

- [ ] **i18n**
  - [ ] Add all translation keys
  - [ ] Test all languages
  
- [ ] **UX/Design**
  - [ ] BOS yellow/gold theme applied
  - [ ] Responsive layout (PC only)
  - [ ] Animations/transitions smooth
  - [ ] Accessibility (WCAG)
  
- [ ] **Documentation**
  - [ ] Update architectural guide
  - [ ] User flow documentation
  - [ ] API documentation
  
- [ ] **Final Tests**
  - [ ] Full regression suite
  - [ ] Guest mode
  - [ ] Multi-user isolation
  - [ ] Performance (large workflow count)

---

## ⚠️ Points d'Attention & Risques

### 1. Cascade Delete - Atomicité

**Risque**: Si une deletion échoue mi-chemin, orphaned data reste.

**Mitigation**:
- Utiliser MongoDB Transactions (require replica set ou sharded cluster)
- Falback: Implement soft-delete + cleanup job si transactions unavailable
- Log toutes les deletions pour audit

### 2. Performance - Large Workflow Count

**Risque**: User avec 100+ workflows → listing slow

**Mitigation**:
- Index { userId, createdAt }
- Pagination sur GET /api/workflows (limit 20, offset)
- Lazy load stats (don't fetch agentCount per workflow unless asked)

### 3. User Switching Workflow - Race Conditions

**Risque**: User A et B select différents workflows simultanément → conflicts

**Mitigation**:
- Per-user locking via isActive flag (atomic update)
- Frontend: Optimistic UI + revert on error
- Backend: Verify ownership before any update

### 4. Prototypes Shared Across Workflows

**Issu**: User expects prototypes filtered to current workflow

**Solution**:
- Prototypes (agent_prototypes) = **GLOBAL TEMPLATES**
- Explicitly NOT filtered by workflow
- Only agent_instances filtered
- Clearly communicate in UX

### 5. First Workflow Cannot Be Deleted

**Risque**: User accidentally left with 0 workflows

**Mitigation**:
- Enforce min_workflows = 1 per user
- Backend: Error 400 "Cannot delete last workflow"
- Frontend: Disable delete button on last workflow

### 6. Persistence - Guest Mode

**Risque**: Guest expects workflow to persist, but doesn't

**Mitigation**:
- Clear messaging: "Utilisateur invité - workflow de démonstration"
- Only show BosWorkflowManagementPage to authenticated users
- Guest still has 1 demo workflow in session (Zustand)
- On auth, replace with real user workflows

---

## 🔗 Dépendances & Interdépendances

### Composants qui dépendent de cette feature:

- **BosSubMenu.tsx** → Dépend de nova item dans robotNavigation
- **RobotPageRouter.tsx** → Dépend de BosWorkflowManagementPage
- **App.tsx** → Dépend des actions selectWorkflow/createWorkflow
- **useDesignStore.ts** → Dépend de backend API
- **useAuthContext.tsx** → Dépend de signup with default workflow

### API/Backend dépendances:

- **Workflow.model.ts** → Utilise isDefault, isActive
- **User.model.ts** → Ajout de defaultWorkflowId
- **Auth middleware** → requireOwnershipAsync pour workflows
- **Mongoose transactions** → Pour cascade delete

---

## 📚 Fichiers à Créer/Modifier

### CREAR (Newgame Files):

```
components/BosWorkflowManagementPage.tsx       (Neue page)
components/workflow/WorkflowCard.tsx            (Neue component)
components/modals/CreerWorkflowDialog.tsx       (Neue dialog)
Guides/TODO/MULTIPLE_WORKFLOWS/PHASE1_BACKEND.md (Backend details)
Guides/TODO/MULTIPLE_WORKFLOWS/PHASE2_FRONTEND.md (Frontend details)
Guides/TODO/MULTIPLE_WORKFLOWS/TEST_CASES.md    (Test strategy)
```

### MODIFY:

```
data/robotNavigation.ts                         (ADD bos item)
components/RobotPageRouter.tsx                  (ADD routing)
components/BosSubMenu.tsx                       (No change needed)
stores/useDesignStore.ts                        (ADD workflow methods)
App.tsx                                         (Integrate workflows)
backend/src/models/Workflow.model.ts            (VERIFY schema)
backend/src/models/User.model.ts                (ADD defaultWorkflowId)
backend/src/routes/workflows.routes.ts          (ADD endpoints,UPDATE delete)
backend/src/routes/auth.routes.ts               (UPDATE signup)
i18n/*.ts                                       (ADD keys - ALL languages)
```

---

## 🎯 Success Criteria

✅ **Feature complet si**:

1. [x] Utilisateur peut créer multiples workflows
2. [x] Utilisateur peut basculer entre workflows (data correcte chargée)
3. [x] Utilisateur peut supprimer workflow + cascade complete
4. [x] Utilisateur invité voit message approprié
5. [x] Templates communs visibles dans tous les workflows
6. [x] Aucun orphaned data après delete
7. [x] Aucune régression - tous les tests passent
8. [x] Multi-user isolation verified
9. [x] i18n complet (FR, EN, etc)
10. [x] UX respecte charte BOS (jaune/or, supervision theme)
11. [x] Performance acceptable (< 100ms load time pour 50 workflows)
12. [x] Documentation complète pour devs futures

---

**FIN DU PLAN**

Generated: February 19, 2026  
Planning Agent: Planificateur  
Status: ✅ Ready for Development Team
