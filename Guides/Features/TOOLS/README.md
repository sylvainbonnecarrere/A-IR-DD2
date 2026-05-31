# TOOLS - README

Statut: reference technique mise a jour apres convergence Tools V2  
Public: utilisateurs avances, architectes, tech leads, agents IA de revue

---

## 1. Objet du document

Ce document explique le fonctionnement actuel du systeme de fonctions et d'outils de l'application.

Il vise deux publics:

1. les utilisateurs avances et architectes qui doivent comprendre le parcours produit reel
2. les responsables techniques qui doivent savoir ou regarder dans le code sans repartir de zero

Ce document couvre le domaine fonctions/outils. Le chantier stockage media/documents est volontairement hors perimetre ici.

---

## 2. Resume executif

L'architecture actuellement livree repose sur les invariants suivants:

1. `user_tools` est l'autorite canonique du catalogue.
2. `toolSelection { toolId, versionRef }` est le contrat canonique d'appel.
3. `functionId` ne subsiste qu'en alias de compatibilite de bordure.
4. le runtime moderne des fonctions custom et natives passe par le sandbox Docker, pas par le Python hote.
5. les executions sont persistees dans `user_tool_runs` avec `executionId`, statut, timings, policy snapshot et artefacts.
6. `user_functions` a ete sorti du runtime et du startup; la collection legacy locale a ete nettoyee via la migration EOL `005_user_functions_eol.ts`.

Consigne operative:

- tout nouveau travail doit partir de `/api/tools`, `/api/runs`, `/api/sandbox/run` et `toolSelection`
- ne pas reintroduire une autorite d'ecriture sur `user_functions`

---

## 3. Ce que couvre le systeme Tools

Le systeme Tools gere aujourd'hui quatre usages distincts:

1. creer et editer des fonctions custom TypeScript ou Python depuis Phil
2. preparer ces fonctions pour le runtime via un build auteur workflow-scoped
3. provisionner les tools Python natifs qui portent des dependances plateforme
4. executer les tools depuis Phil ou depuis un agent workflow avec persistance des runs

Le systeme ne couvre pas le cycle de vie des tools provider-native purs (web search provider, web fetch provider, grounding cloud) qui restent rattaches aux integrations LLM et non au catalogue `user_tools`.

---

## 4. Concepts de base

### 4.1 Tool

Un tool est une entree du catalogue `user_tools`.

Il porte notamment:

- son identite canonique `_id`
- son `scopeType` (`native` ou `user`)
- son `runtime` (`python` ou `typescript`)
- sa `currentVersion`
- ses schemas d'entree et de sortie
- ses dependances et sa policy d'execution
- son etat `isReadonly` / `isEnabled`

Modele principal: `backend/src/models/UserTool.model.ts`

### 4.2 ToolSelection

`toolSelection` est la reference canonique envoyee aux executants.

Structure:

```ts
{
  toolId: string,
  versionRef?: {
    versionTag?: string,
    versionNumber?: number,
    workspaceId?: string | null,
  }
}
```

Construction et normalisation frontend: `services/toolSelectionResolver.ts`

### 4.3 Workspace

Le workspace est la racine persistante associee a un workflow.

Il contient notamment:

- `source`
- `manifests`
- `build`
- `output`

Gestion: `backend/src/services/workspace/WorkspaceManager.ts`

### 4.4 Build auteur

Le build auteur prepare une fonction custom rattachee a un workflow.

- TypeScript: preparation du bundle executable
- Python: preparation du snapshot source et des metadonnees de run

Service: `backend/src/services/build.service.ts`

### 4.5 Provisionnement plateforme

Le provisionnement plateforme concerne les tools Python natifs lecture seule dont les dependances doivent etre preparees par le backend.

Service: `backend/src/services/nativePythonProvisioning.service.ts`

### 4.6 Run persistant

Chaque execution produit une entree `user_tool_runs`.

Modele principal: `backend/src/models/UserToolRun.model.ts`

---

## 5. Parcours produit reels

### 5.1 Creer une fonction custom dans Phil

Parcours:

1. `components/PhilFunctionsPage.tsx`
2. `stores/useFunctionStore.ts`
3. `services/toolRepository.ts`
4. `POST /api/tools`
5. `backend/src/routes/tools.routes.ts`
6. `backend/src/services/toolCommand.service.ts`
7. `user_tools`

Important:

- la creation passe par le backend canonique `/api/tools`
- le frontend continue a projeter la reponse vers un read-model `UserFunction` pour l'UI

### 5.2 Preparer une fonction custom

Parcours:

1. `components/FunctionEditorTab.tsx`
2. `stores/useFunctionStore.ts`
3. `services/toolRepository.ts`
4. `POST /api/tools/:id/build`
5. `backend/src/services/build.service.ts`
6. ecriture dans les repertoires `manifests` et `build` du workspace

Important:

- le bouton build n'est actif que pour une fonction custom rattachee a un workflow
- la readiness affiche ensuite si le build est confirme ou encore requis

### 5.3 Provisionner un tool Python natif

Parcours backend:

1. `POST /api/tools/:id/provision`
2. `backend/src/services/nativePythonProvisioning.service.ts`
3. installation des dependances dans le depot provisionne backend
4. mise a jour de la version `built` dans `user_tools`

Important:

- le provisionnement est un workflow plateforme/backend
- l'UI Phil affiche la readiness et bloque l'execution tant que `runnable === false`
- l'exposition d'un bouton produit dedie au provisionnement n'est pas encore la surface principale

### 5.4 Executer depuis Phil

Parcours:

1. `components/FunctionEditorTab.tsx`
2. `services/toolSelectionResolver.ts`
3. `services/toolRepository.ts`
4. `POST /api/sandbox/run`
5. `backend/src/routes/sandbox.routes.ts`
6. `backend/src/services/sandbox.service.ts`
7. `backend/src/services/runtime/ExecutionOrchestrator.ts`
8. `backend/src/services/runtime/DockerSandboxRunner.ts`

Important:

- le frontend prefere `toolSelection`
- le fallback `functionId` n'est envoye que si aucune selection canonique n'est disponible
- les resultats remontent avec `executionId`, `runner`, `stdout`, `stderr`, `resourceUsage` et eventuels artefacts

### 5.5 Attacher des tools a un agent

Parcours:

1. `components/modals/AgentFormModal.tsx`
2. `components/FunctionSelector.tsx`
3. `services/toolSelectionResolver.ts`
4. persistance de `toolSelections`

Important:

- `toolSelections` est le contrat principal
- `functionIds` est derive pour compatibilite, pas l'inverse

### 5.6 Executer depuis un agent workflow

Parcours:

1. `components/V2AgentNode.tsx`
2. `services/llm/AgentLoop.ts`
3. `services/agentToolExecution.ts`
4. `POST /api/sandbox/run`
5. `ExecutionOrchestrator`
6. `user_tool_runs`

Important:

- le runtime agent n'exploite plus `functionId` comme contrat principal
- `toolSelection` est envoye au backend pour les executions connues du catalogue

### 5.7 Consulter les runs et artefacts

Surfaces:

- `GET /api/runs`
- `GET /api/runs/executions/:executionId`
- `GET /api/runs/tool/:toolId/:executionId/artifacts/content`
- `GET /api/runs/tool/:toolId/:executionId/artifacts/download`
- `POST /api/runs/tool/:toolId/cleanup`

Route owner: `backend/src/routes/runs.routes.ts`

---

## 6. API et scripts a connaitre

### 6.1 Routes backend canoniques

Catalogue:

- `GET /api/tools`
- `POST /api/tools`
- `GET /api/tools/:id`
- `PUT /api/tools/:id`
- `DELETE /api/tools/:id`
- `PATCH /api/tools/:id/toggle`
- `GET /api/tools/:id/build-status`
- `POST /api/tools/:id/build`
- `POST /api/tools/:id/provision`

Execution:

- `POST /api/sandbox/run`
- `POST /api/sandbox/check`
- `GET /api/sandbox/health`

Observabilite:

- `GET /api/runs`
- `GET /api/runs/executions/:executionId`
- routes artefacts et cleanup sous `/api/runs/tool/...`

Workspace:

- `GET /api/workspaces/:workflowId`

### 6.2 Scripts backend utiles

Depuis `backend/`:

- `npm run setup:tools-v2`
- `npm run seed:tools`
- `npm run migrate:user-functions:eol`
- `npm run runtime:check`
- `npm run runtime:setup`

### 6.3 Scripts de validation utiles

Depuis la racine:

- `npm run test:j7:editor:semi-e2e`
- `npm run test:web-search-py`
- `npm test`

Depuis `backend/`:

- `npm test`

---

## 7. Ou regarder dans le code

### 7.1 Frontend

- `services/toolRepository.ts`
  adaptateur frontend vers `/api/tools`, `/api/runs`, `/api/sandbox`
- `stores/useFunctionStore.ts`
  store Zustand du domaine Phil
- `components/PhilFunctionsPage.tsx`
  bibliotheque, creation, readiness, detail
- `components/FunctionEditorTab.tsx`
  edition, build, run, runs, artefacts, runtime health
- `components/FunctionSelector.tsx`
  selecteur de tools pour Archi/configuration agent
- `components/modals/AgentFormModal.tsx`
  sauvegarde `toolSelections` et derive `functionIds`
- `services/toolSelectionResolver.ts`
  normalisation `toolSelection`, `deriveSelectedToolIds`, scope agent
- `services/agentToolExecution.ts`
  execution outillee cote agent
- `services/llm/AgentLoop.ts`
  boucle multi-tours avec appels outils
- `components/V2AgentNode.tsx`
  orchestration runtime UI et rendu des tool calls

### 7.2 Backend

- `backend/src/server.ts`
  surface publique montee: `/api/tools`, `/api/runs`, `/api/sandbox`, `/api/workspaces`
- `backend/src/routes/tools.routes.ts`
  API canonique catalogue + build + provision
- `backend/src/routes/runs.routes.ts`
  ledger d'execution et artefacts
- `backend/src/routes/sandbox.routes.ts`
  execution et syntax check
- `backend/src/services/toolCommand.service.ts`
  create/update/delete/toggle directs sur `user_tools`
- `backend/src/services/toolReadAdapter.service.ts`
  projection legacy lecture seule depuis `user_tools`
- `backend/src/services/build.service.ts`
  build auteur et verifications de preparation
- `backend/src/services/nativePythonProvisioning.service.ts`
  provisionnement plateforme des natifs Python
- `backend/src/services/runtime/ExecutionOrchestrator.ts`
  coeur d'execution, serialisation par workspace, persistence des runs
- `backend/src/services/databaseInit.ts`
  creation collections/indexes + seed canonique
- `backend/src/scripts/setupToolsV2.ts`
  installation canonique safe
- `backend/src/migrations/005_user_functions_eol.ts`
  migration explicite de fin de vie `user_functions`
- `backend/src/models/UserTool.model.ts`
  schema canonique catalogue
- `backend/src/models/UserToolRun.model.ts`
  schema canonique des runs
- `backend/src/seeds/nativeFunctions.seed.ts`
  definition des tools natifs seedes
- `backend/python/runner.py`
  registre Python natif et dispatch d'execution

---

## 8. Limites et frontieres connues

1. `toolRepository` projette toujours les records backend en `UserFunction`; cette couche existe pour compatibilite UI.
2. `functionId` n'est pas totalement disparu du frontend, mais doit rester un alias de bordure uniquement.
3. un fichier source `backend/src/routes/functions.routes.ts` existe encore comme facade legacy en lecture seule, mais il n'est pas monte dans `backend/src/server.ts`; il ne doit pas redevenir une surface cible.
4. le provisionnement plateforme est livre cote backend; l'experience produit completement guidee pour ce workflow peut encore evoluer.
5. le stockage media/documents n'est pas encore converge avec le domaine Tools et sera traite separement.

---

## 9. Regles de non-regression

Ne pas casser les invariants suivants:

1. toute commande de catalogue doit ecrire dans `user_tools`
2. toute execution moderne doit preferer `toolSelection`
3. aucun nouveau code ne doit reintroduire une dependance runtime/startup a `user_functions`
4. les tools Python natifs avec dependances doivent passer par le provisionnement plateforme, pas par un build auteur detourne
5. `user_tool_runs` doit rester la verite de l'execution et des artefacts

---

## 10. Etat de validation

Le perimetre actuel a ete verrouille par:

1. suites backend vertes sur build, provisioning, runs, migration EOL et contrats runtime
2. suites frontend vertes sur `toolRepository`, `FunctionSelector`, `AgentFormModal`, `PhilFunctionsPage`, `AgentLoop`, `agentToolExecution`
3. semi-e2e navigateur reel `J7.Editor.RealBrowser.semi-e2e.spec.ts` vert sur `create -> build -> provision -> run`

Conclusion:

Le domaine Tools est maintenant suffisamment stabilise pour servir de base au prochain chantier, qui porte sur le stockage fichiers et documents plutot que sur la convergence fonctions/outils elle-meme.
