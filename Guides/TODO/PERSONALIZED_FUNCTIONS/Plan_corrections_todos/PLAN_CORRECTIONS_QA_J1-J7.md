# PLAN DE CORRECTIONS — Rapport QA Jalons J1–J7
## Document ARC-1 · Analyse Ultra-Think · 11 mars 2026

> **Auteur** : ARC-1 (Agent Architecte Senior)  
> **Source** : `Rapport_TestsQA_J1-J7.md` (9 points QA)  
> **Référence architecturale** : `PLAN_ARCHITECTURE_TOOLS_V2.md`  
> **Statut** : Plan d'action — En attente approbation Chef de Projet

---

## MATRICE DE CRITICITÉ

| # | Point QA | Criticité | Catégorie Défaut | Fichiers principaux impactés |
|---|----------|-----------|------------------|------------------------------|
| C1 | AgentLoop 401 Unauthorized | 🔴 CRITIQUE | Sécurité / Auth manquante | `V2AgentNode.tsx`, `AgentLoop.ts` |
| C3 | PUT prototype 500 / fonctions non sauvegardées | 🔴 CRITIQUE | Intégration API cassée | `agentPrototypeAPI.ts`, `agent-prototypes.routes.ts` |
| C4/C5 | Fonctions héritées n'apparaissent pas | 🔴 CRITIQUE | Pipeline données rompu | `agentPrototypeAPI.ts`, `AgentConfigurationModal.tsx` |
| C6 | bash_py : UX consentement absente | 🔴 CRITIQUE | UX de sécurité manquante | `PhilFunctionsPage.tsx` |
| C9 | J4 incomplet — Sandbox/Monaco/CodingAgent | 🔴 CRITIQUE | Jalons non livrés | Multi-fichiers |
| C7 | Bouton Save description invisible | 🟠 IMPORTANT | UX formulaire | `PhilFunctionsPage.tsx` |
| C8 | Syntaxe arguments TypeScript illisible | 🟠 IMPORTANT | DX / Template | `PhilFunctionsPage.tsx`, Monaco config |
| C2 | Gemini 404 model introuvable | 🟡 IMPORTANT | Config données | `llmModels.ts` |

---

## PRINCIPES D'ARCHITECTURE APPLIQUÉS

Ces corrections s'appuient exclusivement sur les patterns du `PLAN_ARCHITECTURE_TOOLS_V2.md` :

- **Pattern Registre + Pipeline clair** (J1/J2/J5/J6) : les `functionIds` doivent traverser un pipeline complet API → BDD → UI sans rupture.  
- **Pattern Strategy** (J8) : l'AgentLoop doit recevoir son contexte d'exécution (token auth) via injection, pas via capture d'environnement ambiant.  
- **Principe Open/Closed** (J3) : l'UX bash_py s'ouvre à la confirmation sans modifier la logique backend.  
- **Principe Single Responsibility** (J4) : la sandbox, l'éditeur et l'agent codeur sont des composants indépendants et testables.  
- **Anti-régression absolue** : aucune correction ne doit casser le comportement des providers natifs (OpenAI, Anthropic, Gemini) ni des prototypes existants sans fonctions.

---

## C1 — AgentLoop 401 Unauthorized

### Diagnostic de la cause racine

L'erreur `POST http://localhost:3001/api/sandbox/run 401 (Unauthorized)` provient du fait que `runAgentLoop()` est appelé dans `V2AgentNode.tsx` **sans passer de token JWT**.

**Trace exacte** :
- `AgentLoop.ts` `executeFunction()` n'ajoute le header `Authorization` que si `authToken` est fourni (`if (authToken) headers['Authorization'] = ...`)
- `V2AgentNode.tsx` ligne ~514 appelle `runAgentLoop(adapter, ..., options)` où `options` ne contient **aucun `authToken`**
- La route backend `POST /api/sandbox/run` est protégée par `requireAuth` → 401

`V2AgentNode.tsx` n'importe pas `useAuth` et ne récupère donc jamais l'`accessToken`.

### Solution — Pattern Strategy + Injection de dépendance

Le token doit être injecté comme option, pas capturé via un contexte global dans le service. C'est un principe fondamental : les services purs (AgentLoop) ne connaissent pas le contexte React.

**Fichier : `components/V2AgentNode.tsx`**

**Étape 1** — Importer `useAuth` :
```typescript
// Ajouter dans les imports React/hooks existants :
import { useAuth } from '../contexts/AuthContext';
```

**Étape 2** — Récupérer le token dans le composant (après les autres hooks Zustand) :
```typescript
// Ajouter ~ligne 30 (après les useState/useContext existants)
const { accessToken } = useAuth();
```

**Étape 3** — Passer le token à `runAgentLoop` :
```typescript
const loopResult = await runAgentLoop(
  adapter,
  conversationHistoryForAPI,
  enabledFunctions,
  effectiveAgent.systemPrompt ?? '',
  {
    authToken: accessToken ?? undefined,   // ← CORRECTION : injecter le token
    onEvent: (event) => {
      if (event.type === 'tool_call_start') {
        setLoadingMessage(`🔧 ${event.toolCall?.name ?? '…'}`);
      } else if (event.type === 'llm_start') {
        setLoadingMessage(t('loading'));
      }
    }
  }
);
```

### Anti-régression
- Aucun impact sur les providers natifs (OpenAI/Anthropic/Gemini) qui n'utilisent pas AgentLoop
- Si `accessToken` est null (utilisateur déconnecté), `authToken: undefined` → l'appel échoue clairement (401) sans crash silencieux
- `useAuth` est déjà importé dans d'autres composants de la même application → pattern établi

---

## C3 — Prototype PUT 500 : fonctions non sauvegardées en BDD

### Diagnostic de la cause racine (multi-niveaux)

**Niveau 1 — Le payload API ne transmet pas `functionIds`**

`agentPrototypeAPI.ts` → `mapAgentToAPIPayload()` construit le payload envoyé au backend. Elle inclut `tools: agentData.tools` (legacy) mais **JAMAIS `functionIds: agentData.functionIds`** (V2).

Résultat : `selectedFunctionIds` sélectionnés via `FunctionSelector` dans `AgentFormModal` sont perdus dès la sérialisation.

**Niveau 2 — Le schéma Zod backend rejette les ObjectId strings**

La route `PUT /api/agent-prototypes/:id` valide le corps via :
```typescript
tools: z.array(z.object({}).passthrough()).optional()
```
Si jamais `tools` contient des strings (ObjectIds V2), Zod les rejette silencieusement. Si `tools` contient des objets legacy et que le modèle Mongoose attend des `ObjectId[]` → **CastError Mongoose → 500**.

**Niveau 3 — Le modèle Mongoose a deux champs incompatibles**

`AgentPrototype.model.ts` déclare désormais `tools: [{ type: ObjectId, ref: 'UserFunction' }]`. Si le frontend envoie des `Tool` legacy (objets avec `name`, `description`, `parameters`) via le champ `tools`, Mongoose ne peut pas les caster en ObjectId → erreur 500.

**Niveau 4 — La route PUT n'extrait pas `functionIds` du body**

Même si le frontend envoyait correctement `functionIds`, le handler backend fait :
```typescript
const { name, role, ..., tools, ... } = req.body;
if (tools !== undefined) prototype.tools = tools;
```
`functionIds` n'est jamais lu du body.

### Solution — Pipeline complet Front→Back→BDD

Cette correction nécessite 5 modifications coordonnées, toutes en cohérence avec le plan d'architecture (J5.3 — "La prop `tools` passe de `Tool[]` à `string[]` (tableau d'IDs)").

---

**Fichier 1 : `services/agentPrototypeAPI.ts`**

**a) `mapAgentToAPIPayload()` — inclure `functionIds`** :
```typescript
function mapAgentToAPIPayload(agentData: AgentPrototypePayload, robotId: string, workflowId?: string) {
  const payload: Record<string, any> = {
    name: agentData.name || '',
    role: agentData.role || '',
    systemPrompt: agentData.systemPrompt || '',
    llmProvider: String(agentData.llmProvider),
    llmModel: agentData.model || '',
    capabilities: agentData.capabilities?.map(c => String(c)) || [],
    historyConfig: agentData.historyConfig || undefined,
    // V2: envoyer les références ObjectId (functionIds), PAS les objets legacy (tools)
    functionIds: agentData.functionIds?.length ? agentData.functionIds : undefined,
    outputConfig: agentData.outputConfig || undefined,
    robotId: robotId
  };
  // ... reste inchangé
}
```

**b) `updateAgentPrototype()` — inclure `functionIds` dans le patch partiel** :
```typescript
// Chercher la section qui construit le partial payload (~ligne 150-160)
// Ajouter APRÈS la ligne `if (agentData.tools !== undefined) payload.tools = agentData.tools;` :
if (agentData.functionIds !== undefined) payload.functionIds = agentData.functionIds;
```

**c) `mapAPIResponseToAgent()` — mapper les `functionIds` retournés** :
```typescript
export function mapAPIResponseToAgent(apiData: any): Agent {
  return {
    // ... champs existants ...
    tools: apiData.legacyTools || apiData.tools || undefined,  // legacy tools préservés
    functionIds: apiData.functionIds || [],                    // V2: références ObjectId
    // ...
  };
}
```

---

**Fichier 2 : `backend/src/routes/agent-prototypes.routes.ts`**

**a) Étendre le schéma Zod de validation** :
```typescript
const createAgentPrototypeSchema = z.object({
  // ... champs existants ...
  tools: z.array(z.object({}).passthrough()).optional(),          // legacy (rétrocompat)
  functionIds: z.array(z.string()).optional(),                    // V2 — ObjectId strings
  // ...
});
```

**b) Extraire et mapper `functionIds` dans le handler PUT** :
```typescript
const { name, role, systemPrompt, llmProvider, llmModel, capabilities,
        historyConfig, tools, functionIds, outputConfig, robotId, workflowId, localLLMProfileId } = req.body;

// Mettre à jour les référencess fonctions V2
if (functionIds !== undefined) {
  prototype.tools = functionIds.map((id: string) => new mongoose.Types.ObjectId(id));
}
// Conserver les ancien outils legacy si fournis (rétrocompat)
if (tools !== undefined && !functionIds) {
  prototype.legacyTools = tools;
}
```

**c) Même correction pour le handler POST (création)**.

---

**Fichier 3 : `backend/src/routes/agent-prototypes.routes.ts` — Réponse API**

S'assurer que la réponse sérialisée inclut `functionIds` (les ObjectIds en strings) :
```typescript
// Après prototype.save() :
const responsePayload = prototype.toObject();
responsePayload.functionIds = (prototype.tools || []).map((id: any) => id.toString());
res.json(responsePayload);
```

### Anti-régression
- Les prototypes existants sans `functionIds` dans le body → `prototype.tools` non modifié (condition `if (functionIds !== undefined)`)
- La propriété `legacyTools` est préservée pour les anciens outils
- Le champ `tools: z.array(z.object({}).passthrough()).optional()` reste valide pour la rétrocompabilité lecture

---

## C4/C5 — Fonctions héritées n'apparaissent pas dans l'onglet "Fonctions" d'une instance

### Diagnostic de la cause racine

Ce bug est la **conséquence directe de C3**. Même si C3 est corrigé, il manque un maillon : la lecture/affichage dans `AgentConfigurationModal`.

**Chaîne de données actuellement cassée** :

```
1. AgentFormModal → selectedFunctionIds = ["abc", "def"]
2. agentPrototypeAPI.mapAgentToAPIPayload() → ❌ functionIds omis
3. Backend PUT → prototype.tools = [] (inchangé)
4. Backend GET /api/agent-prototypes → retourne { tools: [], functionIds: [] }
5. mapAPIResponseToAgent() → agent.functionIds = undefined   ← ❌ jamais mappé
6. useDesignStore → prototype.functionIds = undefined
7. AgentConfigurationModal → prototypeFunctionIds = prototype.functionIds || [] = []
8. FunctionSelector readOnly → selectedIds = [] → "Aucune fonction définie"
```

Après correction C3, le maillon manquant est le point 5.

### Solution complémentaire

**Après application de C3**, la correction `mapAPIResponseToAgent()` règle également C4/C5.

**Vérification supplémentaire dans `AgentConfigurationModal.tsx`** :

Le composant lit `prototype.functionIds` mais le prototype vient du store `useDesignStore`. Il faut s'assurer que lors du chargement depuis l'API (`fetchAgentPrototypes`), les données sont bien mappées :

```typescript
// Dans services/agentPrototypeAPI.ts — fetchAgentPrototypes()
// Vérifier que chaque prototype retourné passe par mapAPIResponseToAgent()
const agents = data.map(mapAPIResponseToAgent);
```

**Vérification dans `FunctionSelector.tsx`** — cas où le store `useFunctionStore` n'a pas encore chargé les fonctions quand la modal s'ouvre :

```tsx
// FunctionSelector.tsx — s'assurer que loadFunctions est appelé même si functions est déjà non vide
useEffect(() => {
  if (isAuthenticated && functions.length === 0) loadFunctions();
}, [loadFunctions, isAuthenticated]);
// CORRECTION : supprimer la condition functions.length === 0 pour forcer le refresh
useEffect(() => {
  if (isAuthenticated) loadFunctions();
}, [isAuthenticated]); // loadFunctions retiré des deps pour éviter boucle
```

### Anti-régression
- Les instances sans `functionIds` continuent d'afficher "Aucune fonction" (comportement attendu)
- Le toggle "Hériter du prototype" reste fonctionnel pour les deux cas (héritage et override)

---

## C6 — bash_py : UX de consentement absente

### Diagnostic de la cause racine

La **logique de sécurité backend est correcte** : le service `function.service.ts` lance une erreur `'bash_py requiert un consentement explicite (allowBashPy: true)'` → la route retourne un `403`. Le store `useFunctionStore.toggleFunction()` capture cette erreur dans `state.error`.

**Ce qui manque** : dans `PhilFunctionsPage.tsx`, le `onToggle` appelle directement `toggleFunction(fn._id)` sans :
1. Vérifier si l'erreur est liée à `bash_py`
2. Intercepter le 403 pour afficher un dialog de consentement
3. Proposer à l'utilisateur de réessayer avec `allowBashPy: true`

L'architecture prévoit (PLAN_V2 §J1.5) : "nécessite consentement explicite de l'utilisateur au premier usage". La mécanique existe côté backend mais le frontend n'a **aucun dialogue de consentement**.

### Solution — Pattern Observer + Composant Modal de consentement

**Design** : Ajouter un `<BashPyConsentModal>` dans `PhilFunctionsPage.tsx` sans modifier la logique du store ni du backend.

**a) État local pour gérer la demande de consentement** (dans `FunctionLibraryTab`) :

```typescript
// Ajouter dans FunctionLibraryTab :
const [bashPyConsentTarget, setBashPyConsentTarget] = useState<string | null>(null);
// bashPyConsentTarget = l'ID de la fonction bash_py en attente de consentement
```

**b) Handler de toggle enrichi** :

```typescript
const handleToggle = async (fn: UserFunction) => {
  if (fn.name === 'bash_py' && !fn.isEnabled) {
    // Déclencher la dialog de consentement AVANT d'appeler le store
    setBashPyConsentTarget(fn._id);
    return;
  }
  await toggleFunction(fn._id);
  // Gérer l'erreur générique si autre problème
  const storeError = useFunctionStore.getState().error;
  if (storeError) {
    addNotification({ type: 'error', title: 'Erreur', message: storeError });
  }
};
```

**c) Modal de consentement `BashPyConsentModal`** :

```tsx
// À créer directement dans PhilFunctionsPage.tsx (composant interne) :
const BashPyConsentModal: React.FC<{
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ isOpen, onConfirm, onCancel }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-red-700/50 rounded-xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-900/50 border border-red-700 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-red-300 text-base">Consentement de sécurité requis</h3>
            <p className="text-xs text-gray-500">Fonction bash_py — Exécution shell</p>
          </div>
        </div>
        <div className="bg-red-950/40 border border-red-800/30 rounded-lg p-4 mb-4 text-sm text-red-200 space-y-2">
          <p>⚠️ <strong>bash_py</strong> permet d'exécuter des commandes shell directement sur le système.</p>
          <ul className="text-xs text-red-300/80 space-y-1 ml-4 list-disc">
            <li>Sur <strong>Windows</strong> : exécution PowerShell (détection automatique)</li>
            <li>Sur <strong>Linux/macOS</strong> : exécution Bash</li>
            <li>Requiert un environnement Docker sandbox actif</li>
            <li>Les commandes dangereuses sont bloquées par whitelist</li>
          </ul>
          <p className="text-xs text-yellow-400 mt-2">Cette fonction ne doit être activée que si vous comprenez les risques d'exécution de commandes système.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg border border-gray-600 text-gray-300 text-sm hover:bg-gray-800 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition-colors"
          >
            J'accepte, activer bash_py
          </button>
        </div>
      </div>
    </div>
  );
};
```

**d) Handler de confirmation** :

```typescript
const handleBashPyConsentConfirm = async () => {
  if (!bashPyConsentTarget) return;
  setBashPyConsentTarget(null);
  await toggleFunction(bashPyConsentTarget, true);  // allowBashPy: true
  addNotification({
    type: 'success',
    title: 'bash_py activée',
    message: 'La fonction shell est maintenant disponible. Docker sandbox requis pour l\'exécution.'
  });
};
```

**e) Relier dans `FunctionLibraryTab` JSX** :

```tsx
// Remplacer l'onToggle existant :
onToggle={() => handleToggle(fn)}
// Ajouter la modal juste avant la fermeture du return :
<BashPyConsentModal
  isOpen={bashPyConsentTarget !== null}
  onConfirm={handleBashPyConsentConfirm}
  onCancel={() => setBashPyConsentTarget(null)}
/>
```

### Anti-régression
- Les autres fonctions continuent d'utiliser `toggleFunction(id)` directement (sans dialog)
- La vraie logique de sécurité reste 100% backend — le frontend ajoute uniquement la confirmation UX
- Si bash_py est déjà activée et l'utilisateur la désactive, aucun consentement requis (toggle vers false)

---

## C7 — Bouton "Sauvegarder la description" invisible

### Diagnostic de la cause racine

Le bouton existe dans `FunctionDetailPanel` mais est **conditionnel** : `{descChanged && (<button>)}`. Il n'apparaît que lorsque `editDesc.trim() !== fn.description.trim()`. Quand l'utilisateur arrive sur le panneau et lit le champ description sans le modifier, le bouton est invisible.

**UX problem** : Un bouton hidden-until-changed est un anti-pattern pour une action critique de sauvegarde. L'utilisateur pense qu'il n'y a pas de bouton et ne comprend pas comment modifier la description.

### Solution — Design pattern Always-Visible Disabled CTA

Le bouton doit être **toujours visible** (mais désactivé quand rien n'a changé), conformément aux bonnes pratiques UX de formulaire.

**Fichier : `components/PhilFunctionsPage.tsx`** — dans `FunctionDetailPanel` :

Remplacer le block conditionnel :
```tsx
// AVANT (bouton invisible) :
{descChanged && (
  <button onClick={handleSaveDesc} disabled={...}>
    Sauvegarder la description
  </button>
)}
```

Par un bouton toujours affiché :
```tsx
// APRÈS (bouton toujours visible) :
{!fn.isReadonly && (
  <button
    onClick={handleSaveDesc}
    disabled={isSavingDesc || !editDesc.trim() || !descChanged}
    className={`mt-1.5 flex items-center gap-1.5 px-3 py-1 rounded-md border text-xs transition-all
      ${descChanged && editDesc.trim()
        ? 'bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-400 cursor-pointer'
        : 'bg-gray-800/40 border-gray-700/40 text-gray-600 cursor-not-allowed opacity-50'
      }`}
    title={descChanged ? 'Enregistrer les modifications' : 'Aucune modification à sauvegarder'}
  >
    {isSavingDesc ? (
      <div className="w-3 h-3 border border-cyan-400/40 border-t-cyan-400 rounded-full animate-spin" />
    ) : (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h11a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
      </svg>
    )}
    {isSavingDesc ? 'Sauvegarde…' : 'Sauvegarder la description'}
  </button>
)}
```

### Anti-régression
- Les fonctions natives (`fn.isReadonly = true`) ne montrent jamais le bouton (comportement inchangé)
- La logique `handleSaveDesc` est inchangée — seule la visibilité du bouton change

---

## C8 — Syntaxe arguments TypeScript dans l'éditeur

### Diagnostic de la cause racine

Deux problèmes distincts :

**Problème 1 — Template de code inadapté**

Le template actuel généré à la création est :
```typescript
export function run(context: any, args: any) {
  return { result: "ok" };
}
```

`args: any` ne renseigne pas l'utilisateur sur la structure attendue. L'utilisateur a écrit `args: user_name` (en utilisant un nom de variable comme type) et `user_name` comme variable directe, alors qu'il faut `args: { user_name: string }` et accéder via `args.user_name`.

**Problème 2 — Absence de définitions de types injectées dans Monaco**

Sans injection des types `FunctionContext` et `FunctionResult` dans Monaco, l'IDE ne peut pas guider l'utilisateur (auto-complétion, erreurs inline). Monaco affiche des erreurs sur `context: any` car `FunctionContext` est inconnu.

### Solution — Template enrichi + injection de types Monaco

**Fichier : `components/PhilFunctionsPage.tsx`** — template de code TypeScript dans `handleCreate` :

```typescript
// Template TS enrichi (remplace le template actuel) :
const tsTemplate = (name: string, desc: string) => `\
/**
 * ${name} — ${desc}
 *
 * @param context  Contexte d'exécution (userId, agentId, workflowId, depth)
 * @param args     Arguments nommés passés par le LLM (objet clé-valeur)
 *                 Exemple : si l'agent appelle ${name}(param1="hello"),
 *                 alors args = { param1: "hello" }
 */
export function run(
  context: { userId: string; agentId?: string; workflowId?: string; depth: number },
  args: { [key: string]: unknown }   // ← Déclarez vos arguments ici, ex: args: { user_name: string }
): unknown {
  // Accès aux arguments : args.user_name, args.limit, etc.
  // Retournez un objet JSON sérialisable
  return { result: "ok" };
}
`;
```

**Commentaire d'aide dédié dans l'onglet Éditeur** (à ajouter dans `EditorTabPlaceholder` ou futur `FunctionEditorTab`) :

```tsx
{/* Banner d'aide en haut de l'éditeur */}
<div className="bg-blue-950/40 border border-blue-800/30 rounded-lg p-3 text-xs text-blue-300 mb-3">
  <p className="font-semibold mb-1">📐 Signature attendue (TypeScript)</p>
  <pre className="text-blue-200/80 font-mono text-[11px] leading-relaxed">
{`export function run(
  context: FunctionContext,           // userId, agentId, depth…
  args: { param_name: string }        // ← vos arguments nommés
): unknown { … }`}
  </pre>
  <p className="mt-1 text-blue-400/70">Les arguments sont toujours dans <code className="bg-blue-900/40 px-1 rounded">args</code> → accédez via <code className="bg-blue-900/40 px-1 rounded">args.param_name</code></p>
</div>
```

### Types à injecter dans Monaco (pour J4 complet)

Quand Monaco Editor sera implémenté, injecter via `monaco.languages.typescript.typescriptDefaults.addExtraLib()` :

```typescript
const FUNCTION_CONTEXT_TYPES = `
declare interface FunctionContext {
  userId: string;
  agentId?: string;
  workflowId?: string;
  depth: number;
  maxDepth: number;
  sessionId?: string;
}
declare type FunctionResult = unknown;
`;
// À appeler à l'initialisation de MonacoEditor :
// monaco.languages.typescript.typescriptDefaults.addExtraLib(FUNCTION_CONTEXT_TYPES, 'function-context.d.ts');
```

### Anti-régression
- Les fonctions existantes déjà créées ne sont pas modifiées — uniquement le template de création
- Le template Python est inchangé

---

## C9 — J4 incomplet : Monaco Editor, Sandbox UI et Agent Codeur manquants

### Diagnostic de la cause racine

L'onglet "Éditeur" de `PhilFunctionsPage.tsx` affiche actuellement `EditorTabPlaceholder` — un composant stub qui dit "L'éditeur Monaco sera disponible au Jalon J4". **J4 n'a pas été implémenté**.

Trois sous-composants critiques manquent :

| Composant | Statut | Bloquant |
|-----------|--------|----------|
| Monaco Editor + code inline | ❌ Non implémenté (stub) | Oui — empêche d'éditer les fonctions |
| `SandboxConsole.tsx` (exécution + logs) | ❌ Stub TS (`{ valid: true, errors: [] }`) | Oui — pas de test possible |
| `CodingAgentPanel.tsx` (agent codeur) | ❌ Absent | Oui — demandé explicitement par l'architecte |

**Problème additionnel — détection Python sur Windows** :

`SandboxService._runPython()` appelle `spawn('python3', ...)`. Sur Windows, la commande est souvent `python` (sans le `3`). Cette absence de détection de l'environnement cause une erreur silencieuse quand `python3` n'est pas dans le PATH.

**Problème additionnel — idempotence au démarrage** :

La spec (PLAN_V2 §J4.3) demande :
1. Setup automatique au démarrage (`/api/sandbox/health`)
2. Loader sur la page Phil/Functions en attendant que le sandbox soit prêt
3. Agent codeur disponible sur la page

### Plan de livraison J4 — 4 sous-jalons

---

### J4-C9.1 — Endpoint `/api/sandbox/health` (Backend)

**Créer dans `backend/src/routes/sandbox.routes.ts`** :

```typescript
// GET /api/sandbox/health — Vérifie que Python est disponible
router.get('/health', requireAuth, async (_req, res) => {
  const healthReport = await sandboxService.checkHealth();
  res.json(healthReport);
});
```

**Ajouter dans `SandboxService`** :

```typescript
async checkHealth(): Promise<{
  python: { available: boolean; version?: string; executable: string };
  typescript: { available: boolean };
}> {
  // Détection Python : essayer python3 puis python
  const pythonResult = await this._detectPython();
  return {
    python: pythonResult,
    typescript: { available: false /* isolated-vm non implémenté */ }
  };
}

private async _detectPython(): Promise<{ available: boolean; version?: string; executable: string }> {
  for (const exe of ['python3', 'python']) {
    try {
      const result = await this._spawnCapture(exe, ['--version']);
      if (result.code === 0) {
        return { available: true, version: result.stdout.trim(), executable: exe };
      }
    } catch { /* essayer suivant */ }
  }
  return { available: false, executable: 'python3' };
}
```

**Stocker l'exécutable détecté** : `this.pythonExecutable` pour l'utiliser dans `_runPython()` au lieu de `'python3'` en dur.

---

### J4-C9.2 — `SandboxHealthLoader` (Frontend)

**Créer `components/SandboxHealthLoader.tsx`** : 

Composant qui, au chargement de la page Phil/Functions, interroge `/api/sandbox/health` et affiche un indicateur dans le header de la page :

```tsx
// Trois états visuels :
// 🟢 Python disponible → "Sandbox Python prêt (python3 3.12)"
// 🟡 Vérification en cours → spinner
// 🔴 Indisponible → "Python non détecté — test sandbox désactivé [Aide ↗]"
```

Ce composant s'intègre dans le header de `PhilFunctionsPage` sans bloquer l'affichage de la bibliothèque.

---

### J4-C9.3 — Monaco Editor inline (priorité haute)

**Remplacer `EditorTabPlaceholder` par `FunctionEditorTab`** :

Installer le package : `@monaco-editor/react` (déjà dans le plan J4.1)

```tsx
// components/PhilFunctionsPage.tsx — FunctionEditorTab (remplacer EditorTabPlaceholder)
import MonacoEditor from '@monaco-editor/react';

const FunctionEditorTab: React.FC = () => {
  const { getSelectedFunction, updateInlineCodeOptimistic, updateFunction } = useFunctionStore();
  const { addNotification } = useNotifications();
  const fn = getSelectedFunction();
  const [localCode, setLocalCode] = useState(fn?.codeInline ?? '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setLocalCode(fn?.codeInline ?? '');
  }, [fn?._id]);

  const handleSave = async () => {
    if (!fn || fn.isReadonly) return;
    setIsSaving(true);
    updateInlineCodeOptimistic(fn._id, localCode);  // Optimistic update
    const saved = await updateFunction(fn._id, { codeInline: localCode });
    setIsSaving(false);
    if (saved) addNotification({ type: 'success', title: 'Code sauvegardé', message: fn.name });
  };

  if (!fn) return <EditorEmptyState />;

  return (
    <div className="flex flex-col h-full">
      {/* Header avec aide sur la signature */}
      <HelpBanner language={fn.language} />
      {/* Monaco Editor */}
      <div className="flex-1 min-h-0">
        <MonacoEditor
          height="100%"
          language={fn.language === 'python' ? 'python' : 'typescript'}
          theme="vs-dark"
          value={localCode}
          onChange={v => setLocalCode(v ?? '')}
          options={{
            readOnly: fn.isReadonly,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
          }}
        />
      </div>
      {/* Barre d'actions */}
      <div className="border-t border-gray-700/50 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <SandboxRunButton fn={fn} code={localCode} />
        {!fn.isReadonly && (
          <button
            onClick={handleSave}
            disabled={isSaving || localCode === fn.codeInline}
            className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-gray-900 font-semibold text-sm rounded-lg"
          >
            {isSaving ? 'Sauvegarde…' : '💾 Sauvegarder'}
          </button>
        )}
      </div>
      {/* Console sandbox */}
      <SandboxConsole />
    </div>
  );
};
```

---

### J4-C9.4 — `SandboxConsole` et `SandboxRunButton`

**Créer `components/SandboxConsole.tsx`** (extrait de `PhilFunctionsPage`) :

```tsx
// Lit sandboxResult, isSandboxRunning, sandboxError du useFunctionStore
// Affiche :
//   - Spinner pendant l'exécution
//   - Résultat JSON coloré si succès (réutiliser JsonResultViewer existant)
//   - Message d'erreur rouge si échec
//   - Durée d'exécution
//   - Bouton [Effacer]
```

**`SandboxRunButton`** — ouvre un panneau pour saisir les `testArgs` en JSON (un champ Monaco JSON ou textarea simple), puis appelle `useFunctionStore.runInSandbox(fn._id, testArgs)`.

---

### J4-C9.5 — `CodingAgentPanel` (Agent Codeur)

Composant panel latéral droit qui intègre l'interface de chat d'un agent LLM :

```tsx
// Pattern : réutiliser useAgentChat hook existant
// Props : fn (fonction courante) pour injeter le contexte
// Fonctionnalités minimales :
// 1. Sélecteur LLM (parmi llmConfigs de l'utilisateur)
// 2. Chat avec prompt système expert codeur (fr/en)
// 3. Bouton "Injecter dans l'éditeur" sur les blocs de code de la réponse
```

**System prompts** (à stocker dans `i18n/fr.ts` et `i18n/en.ts`) :
```
fr: "Tu es un expert TypeScript/Python senior. La fonction actuelle se nomme '{fn.name}'. 
Son inputSchema est : {JSON.stringify(fn.inputSchema)}. 
Génère du code qui respecte la signature : run(context: FunctionContext, args: {...}) → unknown."
```

**Intégration dans `PhilFunctionsPage`** : bouton "🤖 Agent Codeur" dans la barre de l'onglet Éditeur qui ouvre/ferme le panel.

---

### Anti-régression J4
- `EditorTabPlaceholder` est remplacé — pas de régression possible (stub → implémentation)
- `SandboxService._runPython()` : la détection d'exécutable ne change pas le comportement existant sur Linux/Mac
- Le `CodingAgentPanel` utilise le hook `useAgentChat` existant → réutilisation sans duplication

---

## C2 — Gemini model 404

### Diagnostic de la cause racine

Le modèle `gemini-3-pro-preview` n'existe pas dans l'API Gemini (version `v1beta`). La console affiche `models/gemini-3-pro-preview is not found for API version v1beta`. Il s'agit d'un nom de modèle invalide dans la liste de `llmModels.ts`.

Ce point est **non introduit par J8/J9** — anti-régression confirmée. C'est un problème de données de référence.

### Solution — Nettoyage des modèles Gemini invalides

**Fichier : `llmModels.ts`** :

1. Inspecter la liste des modèles Gemini et retirer les entrées inexistantes
2. Valider contre la liste officielle Google Gemini API (models disponibles début 2026) :
   - `gemini-2.0-flash-exp` ✅
   - `gemini-1.5-pro` ✅
   - `gemini-1.5-flash` ✅
   - `gemini-3-pro-preview` ❌ → à supprimer ou renommer

**Pattern de protection future** : Ajouter un indicateur visuel dans le sélecteur de modèle quand l'API retourne une 404 (toast d'avertissement dans `geminiService.ts` catch clause).

```typescript
// geminiService.ts — dans le catch de l'appel API :
if (error.status === 404) {
  console.warn(`[Gemini] Modèle inconnu : ${model}. Vérifiez le nom dans les paramètres.`);
  // throw avec message clair pour l'UI
}
```

---

## SÉQUENCEMENT DES CORRECTIONS — Plan de livraison

### Phase 1 — Corrections Critiques Bloquantes (à livrer en priorité)

| Ordre | Correction | Durée estimée | Dépendance |
|-------|-----------|---------------|------------|
| 1 | **C1** — Auth token AgentLoop | ~15 min | Aucune |
| 2 | **C3** — Pipeline fonctions Proto→BDD | ~60 min | Aucune |
| 3 | **C4/C5** — Héritage fonctions instance | ~15 min | Dépend de C3 |
| 4 | **C6** — UX consentement bash_py | ~30 min | Aucune |
| 5 | **C7** — Bouton save description | ~15 min | Aucune |

### Phase 2 — Améliorations UX et J4

| Ordre | Correction | Durée estimée | Dépendance |
|-------|-----------|---------------|------------|
| 6 | **C8** — Template TS + aide arguments | ~20 min | Aucune |
| 7 | **C9.1** — `/api/sandbox/health` + détection Python | ~45 min | Aucune |
| 8 | **C9.2** — `SandboxHealthLoader` | ~30 min | Dépend de C9.1 |
| 9 | **C9.3** — Monaco Editor (`FunctionEditorTab`) | ~90 min | `@monaco-editor/react` installé |
| 10 | **C9.4** — `SandboxConsole` + `SandboxRunButton` | ~45 min | Dépend de C9.3 |
| 11 | **C9.5** — `CodingAgentPanel` | ~90 min | Dépend de C9.3 |

### Phase 3 — Corrections mineures

| Ordre | Correction | Durée estimée | Dépendance |
|-------|-----------|---------------|------------|
| 12 | **C2** — Gemini model list cleanup | ~20 min | Aucune |

---

## CHECKLIST DE VALIDATION POST-CORRECTION

### Tests non-régression à exécuter

**Après Phase 1 :**
- [ ] **C1** : Créer un agent Ollama/LMStudio, poser une question nécessitant `web_search_py` → vérifier que les ToolCallBlock s'affichent et que les résultats sont valides (plus de 401)
- [ ] **C3** : Créer un nouveau prototype avec `web_search_py` sélectionné → sauvegarder → recharger la page → vérifier que la fonction apparaît dans la liste du prototype
- [ ] **C4/C5** : Créer un agent depuis ce prototype → ouvrir la configuration instance → onglet Fonctions → vérifier que `web_search_py` apparaît dans "fonctions héritées"
- [ ] **C3 anti-régression** : Un prototype existant sans fonctions s'affiche toujours correctement
- [ ] **C3 anti-régression** : OpenAI/Anthropic/Gemini → streaming inchangé (createAdapter retourne null)
- [ ] **C6** : Tenter d'activer `bash_py` → dialog de consentement apparaît → Annuler → fonction reste désactivée → Re-activer + Accepter → fonction activée
- [ ] **C7** : Sélectionner une fonction custom → le bouton "Sauvegarder la description" est visible (grisé) → modifier le texte → bouton devient actif → cliquer → notification de succès

**Après Phase 2 :**
- [ ] **C8** : Créer une nouvelle fonction TS → template montre `args: { [key: string]: unknown }` et le commentaire d'aide
- [ ] **C9.1/.2** : Ouvrir la page Phil/Functions → indicateur sandbox visible dans le header
- [ ] **C9.3** : Sélectionner une fonction custom → onglet Éditeur → Monaco Editor affiche le code → pouvoir le modifier et sauvegarder
- [ ] **C9.4** : Cliquer "Tester" dans l'éditeur → saisir des args → résultat JSON visible dans la console sandbox
- [ ] **C9.5** : Ouvrir l'Agent Codeur → sélectionner un LLM → poser une question sur la fonction → la réponse peut être injectée dans l'éditeur

---

## NOTES ARCHITECTURALES IMPORTANTES

### Sur la dette technique identifiée

La correction C3 révèle un **désalignement terminologique** entre les couches :
- Frontend `Agent` type : utilise `functionIds` (V2) ET `tools` (legacy V1)
- Backend route : accepte `tools` (legacy) mais le modèle attend des ObjectId
- API mapping (`agentPrototypeAPI.ts`) : ne traduit pas correctement entre les deux

**Recommandation post-Phase 1** : Un refactoring ciblé du mapping pour unifier sur `functionIds` côté backend et déprécier progressivement `tools` (legacy) est à planifier dans une session dédiée après validation QA.

### Sur J4 (état réel vs. plan)

J4 a été livré **partiellement** :
- ✅ Le store `useFunctionStore` avec sandbox (C9.3-C9.4 partiellement)
- ✅ Le `SandboxService` backend Python fonctionne  
- ❌ Monaco Editor → stubbed (`EditorTabPlaceholder`)
- ❌ CodingAgentPanel → absent
- ❌ Health check + détection exécutable Python → absent

Le plan de livraison **Phase 2** complète J4 tel que spécifié dans `PLAN_ARCHITECTURE_TOOLS_V2.md §J4.1-J4.4`.

---

*Document généré le 11 mars 2026 par ARC-1 après analyse des 9 points du rapport QA, lecture intégrale de PLAN_ARCHITECTURE_TOOLS_V2.md et inspection de 25+ fichiers sources.*
