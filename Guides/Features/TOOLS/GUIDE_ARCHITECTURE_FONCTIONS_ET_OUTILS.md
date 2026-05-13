# Guide architecture fonctions et outils

Statut: guide developpeur et reprise agent apres convergence Tools V2  
Public: developpeurs backend/frontend, reviewers, futurs agents de maintenance

---

## 1. Objet du document

Ce guide decrit l'architecture effective des fonctions et outils telle qu'elle existe maintenant dans la codebase.

Il doit permettre a un futur agent ou a un developpeur de:

1. identifier la source de verite de chaque flux
2. comprendre les points de passage obligatoires du catalogue, du build, du provisioning et du run
3. eviter de reintroduire les surfaces legacy qui viennent d'etre neutralisees

Ce document ne couvre pas le stockage media/documents. Ce point sera traite comme chantier distinct.

---

## 2. Invariants non negociables

1. `user_tools` est l'unique autorite du catalogue.
2. `toolSelection` est l'unique contrat canonique d'appel agent.
3. `functionId` est un alias de bordure, jamais une autorite de domaine.
4. `user_tool_runs` est l'autorite de l'execution, des erreurs, des timings et des artefacts.
5. le runtime moderne passe par `ExecutionOrchestrator` et le sandbox Docker.
6. les tools Python natifs avec dependances relevent du provisionnement plateforme.
7. les fonctions custom workflow-scoped relevent du build auteur.
8. `user_functions` ne doit plus etre reintroduit dans le runtime, le startup ou les commandes de catalogue.

Si une modification viole un de ces huit points, elle doit etre consideree comme regressive jusqu'a preuve du contraire.

---

## 3. Bounded contexts et roles

### 3.1 Tool Catalog

Responsabilite:

- stocker la definition des tools
- porter la version courante
- exposer schemas, tags, dependances, policy, readiness

Pieces principales:

- `backend/src/models/UserTool.model.ts`
- `backend/src/services/toolCommand.service.ts`
- `backend/src/services/toolReadAdapter.service.ts`
- `backend/src/services/userToolQuery.service.ts`
- `backend/src/routes/tools.routes.ts`

### 3.2 Preparation

Responsabilite:

- distinguer build auteur et provisionnement plateforme
- preparer les artefacts de runtime en dehors de l'execution normale

Pieces principales:

- `backend/src/services/toolPreparationPolicy.service.ts`
- `backend/src/services/build.service.ts`
- `backend/src/services/nativePythonProvisioning.service.ts`

### 3.3 Runtime

Responsabilite:

- executer un tool dans une sandbox ephemere
- persister un run avec `executionId`
- recuperer les artefacts produits

Pieces principales:

- `backend/src/routes/sandbox.routes.ts`
- `backend/src/services/sandbox.service.ts`
- `backend/src/services/runtime/ExecutionOrchestrator.ts`
- `backend/src/services/runtime/DockerSandboxRunner.ts`
- `backend/src/services/runtime/runtimeWrappers.ts`
- `backend/src/models/UserToolRun.model.ts`

### 3.4 Frontend design/runtime boundary

Responsabilite:

- projeter le read model backend dans l'UI Phil/Archi
- conserver `toolSelection` comme contrat principal des agents
- resoudre les alias legacy sans les laisser devenir centraux

Pieces principales:

- `services/toolRepository.ts`
- `stores/useFunctionStore.ts`
- `services/toolSelectionResolver.ts`
- `utils/functionCommandId.ts`
- `components/PhilFunctionsPage.tsx`
- `components/FunctionEditorTab.tsx`
- `components/FunctionSelector.tsx`
- `components/modals/AgentFormModal.tsx`
- `services/agentToolExecution.ts`
- `services/llm/AgentLoop.ts`
- `components/V2AgentNode.tsx`

---

## 4. Modeles de donnees centraux

### 4.1 `UserTool`

Modele: `backend/src/models/UserTool.model.ts`

Champs a connaitre:

- `scopeType`: `native` ou `user`
- `runtime`: `python` ou `typescript`
- `currentVersion`
- `versions`
- `dependencies`
- `policy`
- `workflowId`
- `workspaceId`
- `isReadonly`
- `isEnabled`

Lecture architecturale:

- `scopeType = native` + `ownerUserId = null` = tool natif seed ou global
- `scopeType = user` = tool custom utilisateur
- `currentVersion` est la version active exploitee par le runtime
- `versions` est deja la structure a conserver pour les evolutions ulterieures du versioning

### 4.2 `UserToolRun`

Modele: `backend/src/models/UserToolRun.model.ts`

Champs a connaitre:

- `executionId`
- `toolId`
- `toolVersionTag`
- `launchContext`
- `status`
- `runner`
- `inputs`
- `outputs`
- `policySnapshot`
- `timing`
- `resourceUsage`
- `error`

Lecture architecturale:

- `user_tool_runs` n'est pas un log debug annexe: c'est le ledger d'execution
- toute nouvelle observabilite BOS doit partir de cette collection

### 4.3 `UserFunction` frontend

Projection frontend principale:

- type: `types/function.types.ts`
- projection backend -> frontend: `services/toolRepository.ts`

Important:

- `UserFunction` n'est plus la source de verite metier
- c'est un read model UI de compatibilite
- caveat connu: `mapToolToUserFunction()` projette encore `userId: null`, donc ne pas s'appuyer sur ce champ pour raisonner sur la possession

---

## 5. Surface publique backend reelle

### 5.1 Routes montees dans `backend/src/server.ts`

Surfaces pertinentes pour le domaine:

- `/api/workspaces`
- `/api/tools`
- `/api/runs`
- `/api/sandbox`

Important:

- `backend/src/routes/functions.routes.ts` existe encore en source
- mais `backend/src/server.ts` ne le monte plus
- donc `/api/functions` n'est plus une surface publique cible du backend courant

### 5.2 Catalogue canonique: `/api/tools`

Fichier: `backend/src/routes/tools.routes.ts`

Routes:

- `GET /api/tools`
- `POST /api/tools`
- `GET /api/tools/:id`
- `PUT /api/tools/:id`
- `DELETE /api/tools/:id`
- `PATCH /api/tools/:id/toggle`
- `GET /api/tools/:id/build-status`
- `POST /api/tools/:id/build`
- `POST /api/tools/:id/provision`

Services relies:

- `ToolCommandService`
- `ToolReadAdapterService`
- `BuildService`
- `NativePythonProvisioningService`
- `ToolReadinessService`
- `RuntimeCompatibilityService`

### 5.3 Execution: `/api/sandbox`

Fichier: `backend/src/routes/sandbox.routes.ts`

Routes:

- `POST /api/sandbox/run`
- `POST /api/sandbox/check`
- `GET /api/sandbox/health`

Contrat de `POST /api/sandbox/run`:

```json
{
  "toolSelection": {
    "toolId": "...",
    "versionRef": {
      "versionTag": "v1",
      "versionNumber": 1,
      "workspaceId": "..."
    }
  },
  "testArgs": {},
  "privateContext": {}
}
```

Le champ `functionId` reste accepte comme fallback legacy, mais uniquement si aucun `toolSelection` n'est disponible.

### 5.4 Observabilite: `/api/runs`

Fichier: `backend/src/routes/runs.routes.ts`

Routes:

- `GET /api/runs`
- `GET /api/runs/tool/:toolId`
- `GET /api/runs/executions/:executionId`
- `GET /api/runs/tool/:toolId/:executionId/artifacts/content`
- `GET /api/runs/tool/:toolId/:executionId/artifacts/download`
- `POST /api/runs/tool/:toolId/cleanup`

---

## 6. Flux techniques a connaitre

### 6.1 Startup et installation canonique

Flux:

1. `backend/src/server.ts`
2. `connectDatabase()`
3. `initializeDatabase()`
4. `seedNativeFunctions()` + `seedSharedExampleFunctions()`

Script d'installation complet:

1. `backend/src/scripts/setupToolsV2.ts`
2. `initializeDatabase()`
3. `migrateLegacyUserFunctionsToUserToolsAndDropCollection()` depuis `backend/src/migrations/005_user_functions_eol.ts`

But:

- garantir un catalogue canonique seed
- nettoyer `user_functions` si un reliquat subsiste

### 6.2 Creation ou edition d'un tool custom

Flux:

1. `components/PhilFunctionsPage.tsx`
2. `stores/useFunctionStore.ts`
3. `utils/functionCommandId.ts`
4. `services/toolRepository.ts`
5. `POST/PUT /api/tools`
6. `backend/src/services/toolCommand.service.ts`
7. `UserTool`

Regles:

- `ToolCommandService` ecrit directement dans `user_tools`
- la version courante est recalculee via `buildVersionPayload()`
- l'etat de readiness est ensuite derive depuis le modele canonique

### 6.3 Build auteur d'un tool custom

Flux:

1. `components/FunctionEditorTab.tsx`
2. `useFunctionStore.runBuild()`
3. `toolRepository.runBuild()`
4. `POST /api/tools/:id/build`
5. `BuildService.prepareToolVersion()`

Regles:

- seulement pour les tools custom rattaches a un workflow
- les artefacts sont ecrits dans les repertoires `manifests` et `build` du workspace
- `BuildService` fournit aussi les gardes de readiness avant execution

### 6.4 Provisionnement plateforme d'un natif Python

Flux:

1. `POST /api/tools/:id/provision`
2. `NativePythonProvisioningService.provisionToolVersion()`
3. execution Docker de la commande de provisioning
4. ecriture dans le depot provisionne backend
5. passage du `buildStatus` a `built`

Regles:

- reserve aux tools `scopeType = native`, `runtime = python`, `isReadonly = true`
- la liste des modules critiques est derivee du seed natif

### 6.5 Run manuel Phil

Flux:

1. `FunctionEditorTab.handleRun()`
2. `buildToolSelectionFromFunction(fn)` dans `services/toolSelectionResolver.ts`
3. `toolRepository.runInSandbox()`
4. `POST /api/sandbox/run`
5. `SandboxService.runFunction()`
6. `ExecutionOrchestrator.execute()`

Regles:

- l'UI bloque `Executer` si `fn.readinessStatus?.runnable === false`
- pour une fonction custom modifiee, l'editeur sauvegarde d'abord le code si necessaire
- les tools natifs readonly peuvent etre executes seulement si leur readiness le permet

### 6.6 Run workflow agent

Flux:

1. `components/V2AgentNode.tsx`
2. `services/llm/AgentLoop.ts`
3. `services/agentToolExecution.ts`
4. `buildToolSelectionFromFunction()`
5. `POST /api/sandbox/run`

Regles:

- `AgentLoop` ne doit pas serialiser un appel outil en `functionId` legacy si le tool est connu
- `agentToolExecution.ts` construit aussi `privateContext` pour certains tools comme `web_search_py`

### 6.7 Syntax check Python

Flux:

1. `POST /api/sandbox/check`
2. `SandboxService.checkSyntax()`
3. `ExecutionOrchestrator.checkSyntax()`
4. `DockerSandboxRunner.checkPythonSyntax()`

Regle cle:

- le check syntaxique Python ne doit plus dependre du Python hote

### 6.8 Runs et artefacts

Flux:

1. `ExecutionOrchestrator` cree un `executionId`
2. `UserToolRunService` cree `queued`, puis `running`
3. `ExecutionOrchestrator` collecte les artefacts sous `outputRoot`
4. `UserToolRunService` marque `completed`, `failed` ou `timed_out`
5. lecture via `UserToolRunQueryService` et `runs.routes.ts`

---

## 7. Frontend: conventions et points de vigilance

### 7.1 `toolRepository.ts`

Role:

- consommer `/api/tools`
- projeter les records backend vers `UserFunction`
- appeler `/api/tools/:id/build`, `/api/runs`, `/api/sandbox`

Point de vigilance:

- `mapToolToUserFunction()` est une projection de compatibilite, pas une API metier canonique

### 7.2 `useFunctionStore.ts`

Role:

- store principal Phil
- resolution des identites via `resolveFunctionCommandId()`
- bridge UI -> repository

Point de vigilance:

- tout appel de commande doit etre resolu vers `toolId` des que possible

### 7.3 `toolSelectionResolver.ts`

Role:

- construire `toolSelection`
- normaliser `toolSelections` / `functionIds`
- resoudre le scope outille d'un agent

Point de vigilance:

- ce fichier est la frontiere officielle entre compatibilite legacy et contrat canonique agent

### 7.4 `AgentFormModal.tsx` et `FunctionSelector.tsx`

Role:

- edition des tools attaches a un agent
- emission de `toolSelections`
- derivee de `functionIds` pour compatibilite

Point de vigilance:

- le state durable doit rester `toolSelections`

---

## 8. Backend: conventions et points de vigilance

### 8.1 `ToolCommandService`

Role:

- create/update/delete/toggle directs sur `UserTool`

Point de vigilance:

- ne pas reintroduire une delegation vers un service legacy `FunctionService`

### 8.2 `ToolReadAdapterService`

Role:

- produire une projection legacy lecture seule depuis `user_tools`

Point de vigilance:

- l'adapter est acceptable comme ACL read-only
- il ne doit pas redevenir une brique de commande

### 8.3 `BuildService`

Role:

- preparer les artefacts custom
- verifier la readiness avant run

Point de vigilance:

- `platform_provision` et `author_build` sont des politiques distinctes
- ne pas detourner le build auteur pour des natifs readonly

### 8.4 `NativePythonProvisioningService`

Role:

- installer les dependances Python natives dans le depot backend provisionne

Point de vigilance:

- garder la separation entre code natif applicatif et code custom workspace

### 8.5 `ExecutionOrchestrator`

Role:

- coeur du runtime
- serialisation par workspace
- persistence du ledger d'execution
- syntax check Python via runner prefere

Point de vigilance:

- toute nouvelle execution doit passer par lui

---

## 9. Surface legacy restante

### 9.1 `functionId`

Encore present comme:

- alias dans certains read models UI
- fallback dans `toolRepository.runInSandbox()`
- derivee de compatibilite dans `AgentFormModal`

Regle:

- ne jamais introduire un nouveau flux qui exige `functionId` alors qu'un `toolSelection` est disponible

### 9.2 `backend/src/routes/functions.routes.ts`

Etat:

- facade lecture seule en source
- non montee dans `backend/src/server.ts`

Regle:

- ne pas la rebrancher sans decision explicite de migration
- ne pas y accrocher de nouvelle commande

### 9.3 `user_functions`

Etat:

- retire du runtime et du startup
- migration EOL explicite disponible dans `005_user_functions_eol.ts`
- cleanup live deja execute sur la base locale via `setup:tools-v2`

Regle:

- toute reintroduction d'un write path vers `user_functions` est une regression

---

## 10. Carte de fichiers recommandee pour une reprise

Ordre de lecture conseille si un futur agent reprend ce domaine:

1. `Guides/Features/TOOLS/README.md`
2. `backend/src/server.ts`
3. `backend/src/routes/tools.routes.ts`
4. `backend/src/services/toolCommand.service.ts`
5. `backend/src/services/build.service.ts`
6. `backend/src/services/nativePythonProvisioning.service.ts`
7. `backend/src/routes/sandbox.routes.ts`
8. `backend/src/services/sandbox.service.ts`
9. `backend/src/services/runtime/ExecutionOrchestrator.ts`
10. `backend/src/routes/runs.routes.ts`
11. `services/toolRepository.ts`
12. `stores/useFunctionStore.ts`
13. `services/toolSelectionResolver.ts`
14. `components/FunctionEditorTab.tsx`
15. `components/modals/AgentFormModal.tsx`
16. `services/agentToolExecution.ts`
17. `services/llm/AgentLoop.ts`

---

## 11. Tests de reference

### 11.1 Frontend

- `tests/services/toolRepository.test.ts`
- `tests/services/toolSelectionResolver.test.ts`
- `tests/services/agentToolExecution.test.ts`
- `tests/services/AgentLoop.test.ts`
- `tests/components/FunctionSelector.test.tsx`
- `tests/components/AgentFormModal.test.tsx`
- `tests/components/PhilFunctionsPage.test.tsx`
- `tests/components/FunctionEditorTab.test.tsx`
- `tests/fonctionnels/J7.Editor.RealBrowser.semi-e2e.spec.ts`

### 11.2 Backend

- `backend/src/__tests__/tool-command-service.architecture.test.ts`
- `backend/src/__tests__/tool-read-adapter.architecture.test.ts`
- `backend/src/__tests__/tool-read-adapter.service.test.ts`
- `backend/src/__tests__/tool-readiness.service.test.ts`
- `backend/src/__tests__/user-functions-eol-migration.test.ts`
- `backend/src/__tests__/user-functions-reliquat.architecture.test.ts`
- `backend/src/__tests__/database-init.seeding.test.ts`
- `backend/src/__tests__/native-python-provisioning.service.test.ts`
- `backend/src/__tests__/build.service.test.ts`
- `backend/src/__tests__/function-runs.routes.test.ts`
- `backend/src/__tests__/sandbox.routes.test.ts`
- `backend/src/__tests__/execution-orchestrator.test.ts`
- `backend/src/__tests__/runtime-legacy-coupling.architecture.test.ts`
- `backend/src/__tests__/legacy-function-containment.architecture.test.ts`

---

## 12. Checklist avant toute modification

1. verifier si le changement touche le catalogue, la preparation, le runtime, ou seulement une projection UI
2. preferer `toolId` et `toolSelection` a toute autre identite
3. verifier que `user_tools` reste l'unique autorite d'ecriture
4. verifier que l'execution continue de passer par `ExecutionOrchestrator`
5. rejouer au minimum les tests cibles lies a la zone touchee
6. si le changement touche Phil ou l'appel agent, rejouer aussi le semi-e2e J7 ou une preuve equivalente

---

## 13. Anti-patterns a eviter

1. remonter une commande via `/api/functions`
2. utiliser `functionId` comme identite principale en nouveau code
3. reintroduire un sync startup vers `user_functions`
4. faire executer un natif Python dependant sans provisioning plateforme
5. faire dependre le syntax check Python d'un executable hote
6. contourner `user_tool_runs` pour reconstruire l'observabilite d'execution

---

## 14. Etat final du domaine

Le domaine fonctions/outils n'est plus en phase de convergence structurante. Il est stabilise sur son perimetre courant.

Les travaux suivants peuvent partir du principe que:

1. le catalogue canonique est `user_tools`
2. l'appel canonique est `toolSelection`
3. le runtime canonique passe par le sandbox Docker et `ExecutionOrchestrator`
4. la dette principale restante n'est plus le cutover fonctions/outils, mais les sujets stockage fichiers/documents et convergence media
