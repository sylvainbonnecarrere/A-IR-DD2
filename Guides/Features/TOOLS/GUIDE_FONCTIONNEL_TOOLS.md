 1. Qualification du domaine et catégories de fonctions

  Catégorie canonique du système actuel :

  ┌───────────────────────────────────────────┬──────────────────────────────────┬─────────────────────────────────────────┬──────────────────────────────────────────────┐
  │ Catégorie                                 │ Statut                           │ Autorité                                │ Exécution                                    │
  ├───────────────────────────────────────────┼──────────────────────────────────┼─────────────────────────────────────────┼──────────────────────────────────────────────┤
  │ Fonction utilisateur custom               │ canonique                        │ user_tools avec scopeType: "user"       │ Sandbox Docker via ExecutionOrchestrator     │
  ├───────────────────────────────────────────┼──────────────────────────────────┼─────────────────────────────────────────┼──────────────────────────────────────────────┤
  │ Fonction native applicative               │ canonique                        │ user_tools avec scopeType: "native"     │ Sandbox Docker via ExecutionOrchestrator     │
  ├───────────────────────────────────────────┼──────────────────────────────────┼─────────────────────────────────────────┼──────────────────────────────────────────────┤
  │ Fonction cloud-only / provider-native     │ hors autorité Tools V2           │ provider LLM / fallback local           │ pas le chemin canonique des tools workflow   │
  ├───────────────────────────────────────────┼──────────────────────────────────┼─────────────────────────────────────────┼──────────────────────────────────────────────┤
  │ Fallback legacy                           │ toléré uniquement en bordure     │ alias functionId + executeTool()        │ compatibilité, surtout pour outillage simple │
  └───────────────────────────────────────────┴──────────────────────────────────┴─────────────────────────────────────────┴──────────────────────────────────────────────┘

  Invariant central :

   1. user_tools = unique source d’autorité catalogue.
   2. toolSelection = unique contrat canonique d’appel agent.
   3. user_tool_runs = unique autorité d’exécution/persistance runtime.
   4. Le runtime canonique passe par /api/sandbox/run -> SandboxService -> ExecutionOrchestrator -> sandbox Docker.
   5. /api/functions n’est plus monté.

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  2. Stack technique réellement utilisée

  ┌──────────────────────────────────┬─────────────────────────────────────────────────────────────────┐
  │ Couche                           │ Stack                                                           │
  ├──────────────────────────────────┼─────────────────────────────────────────────────────────────────┤
  │ Frontend design/runtime          │ React 18, TypeScript, Zustand, Vite                             │
  ├──────────────────────────────────┼─────────────────────────────────────────────────────────────────┤
  │ Backend API                      │ Node.js, Express, TypeScript                                    │
  ├──────────────────────────────────┼─────────────────────────────────────────────────────────────────┤
  │ Validation contrats              │ Zod                                                             │
  ├──────────────────────────────────┼─────────────────────────────────────────────────────────────────┤
  │ Persistance                      │ MongoDB + Mongoose                                              │
  ├──────────────────────────────────┼─────────────────────────────────────────────────────────────────┤
  │ Runtime fonctions                │ Docker, wrappers Node/Python, images runtime dédiées            │
  ├──────────────────────────────────┼─────────────────────────────────────────────────────────────────┤
  │ Build custom tools               │ transpilation TypeScript, snapshot Python, workspace filesystem │
  ├──────────────────────────────────┼─────────────────────────────────────────────────────────────────┤
  │ Provisionnement natif Python     │ image Docker de provisioning + pip install --target             │
  ├──────────────────────────────────┼─────────────────────────────────────────────────────────────────┤
  │ Observabilité runtime            │ user_tool_runs, agent_journals, artefacts workspace             │
  ├──────────────────────────────────┼─────────────────────────────────────────────────────────────────┤
  │ Sécurité d’accès                 │ JWT requireAuth, ownership checks, validation stricte           │
  └──────────────────────────────────┴─────────────────────────────────────────────────────────────────┘

  Config runtime centralisée :

   backend/src/config/environment.ts
     runtime.nodeExecutable
     runtime.pythonExecutables
     runtime.dockerExecutable
     runtime.nodeRuntimeImage
     runtime.pythonRuntimeImage
     runtime.pythonProvisioningImage
     runtime.probeTimeoutMs
     runtime.provisionTimeoutMs

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  3. Architecture globale : séparation design domain / runtime domain

  3.1 Design domain

  Responsabilité : définir, éditer, sélectionner, versionner, préparer une fonction.

   Frontend
     components/
       PhilFunctionsPage.tsx
       FunctionEditorTab.tsx
       FunctionSelector.tsx
       modals/AgentFormModal.tsx
     stores/
       useFunctionStore.ts
     services/
       toolRepository.ts
       toolSelectionResolver.ts
   
   Backend
     routes/
       tools.routes.ts
     services/
       toolCommand.service.ts
       toolReadAdapter.service.ts
       userToolQuery.service.ts
       build.service.ts
       nativePythonProvisioning.service.ts
     models/
       UserTool.model.ts

  Règle d’architecture :

   - l’UI manipule encore un read model UserFunction,
   - mais l’écriture réelle part toujours vers /api/tools,
   - et la donnée métier persistée est UserTool.

  3.2 Runtime domain

  Responsabilité : exécuter, journaliser, persister le run, relire les artefacts, réhydrater l’UI.

   Frontend
     components/
       V2AgentNode.tsx
       workflow/ToolCallBlock.tsx
     services/
       llm/AgentLoop.ts
       agentToolExecution.ts
     hooks/
       useAgentJournalPersistence.ts
       useJournalQueue.ts
   
   Backend
     routes/
       sandbox.routes.ts
       runs.routes.ts
     services/
       sandbox.service.ts
       runtime/ExecutionOrchestrator.ts
       runtime/DockerSandboxRunner.ts
       runtime/runtimeWrappers.ts
       userToolRun.service.ts
       workspace/WorkspaceManager.ts
       workspace/WorkspacePathResolver.ts
     models/
       UserToolRun.model.ts
       AgentJournal.model.ts

  Règle d’architecture :

   - le catalogue n’exécute rien,
   - le runtime n’invente pas de définition de tool,
   - tout run réel passe par l’orchestrateur.

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  4. Modèles centraux à connaître

  4.1 Catalogue : UserTool

   backend/src/models/UserTool.model.ts

  Champs structurants :

   - scopeType: native | user
   - runtime: python | typescript
   - currentVersion
   - versions
   - dependencies
   - policy
   - workflowId
   - workspaceId
   - isReadonly
   - isEnabled

  Lecture architecturale :

   - native applicatif = scopeType: native, ownerUserId: null, souvent isReadonly: true
   - custom utilisateur = scopeType: user
   - la version active exploitable par le runtime = currentVersion

  4.2 Sélection d’outil : toolSelection

   {
     "toolId": "mongoObjectId",
     "versionRef": {
       "versionTag": "v1",
       "versionNumber": 1,
       "workspaceId": "mongoObjectId|null"
     }
   }

  C’est le contrat d’appel agent canonique.
  functionId n’est plus qu’un alias de compatibilité.

  4.3 Ledger runtime : UserToolRun

   backend/src/models/UserToolRun.model.ts

  Champs structurants :

   - executionId
   - toolId
   - toolVersionTag
   - launchContext
   - status
   - runner
   - inputs
   - outputs
   - policySnapshot
   - timing
   - resourceUsage
   - error

  Lecture architecturale :

   - c’est la vérité d’exécution,
   - pas un log secondaire,
   - toute observabilité fiable doit repartir de cette collection.

  4.4 Journal conversationnel : AgentJournal

   backend/src/models/AgentJournal.model.ts

  Usage :

   - messages chat,
   - événements tool_invocation,
   - erreurs UI/conversation,
   - médias.

  Important :

   - AgentJournal ne remplace pas UserToolRun,
   - il sert à la projection conversationnelle,
   - le lien robuste entre UI et run passe par toolCallId, executionId, toolId.

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  5. Flux exact de déclenchement d’une fonction par un agent workflow

  5.1 Attachement de fonctions à l’agent

   components/modals/AgentFormModal.tsx
     -> components/FunctionSelector.tsx
     -> services/toolSelectionResolver.ts
     -> sauvegarde de agent.toolSelections

  Ce qui est persisté côté agent :

   - toolSelections = durable et canonique
   - functionIds = dérivé de compatibilité

  Conséquence pour l’équipe externe :

   - une fonction intégrable doit être adressable par un toolId,
   - et idéalement par une version.

  5.2 Démarrage runtime dans le nœud agent

   components/V2AgentNode.tsx
     -> runAgentLoop() ou executeAgentToolCall()

  Deux chemins existent :

   1. Boucle agent locale / provider simulé V2AgentNode.tsx
      -> services/llm/AgentLoop.ts
      -> POST /api/sandbox/run
   2. Exécution directe d’un tool call V2AgentNode.tsx
      -> services/agentToolExecution.ts
      -> POST /api/sandbox/run

  5.3 Résolution du contrat d’appel

   services/toolSelectionResolver.ts
     buildToolSelectionFromFunction(fn)

  Le frontend construit :

   {
     "toolSelection": {
       "toolId": "...",
       "versionRef": {
         "versionTag": "...",
         "versionNumber": 1,
         "workspaceId": "..."
       }
     },
     "testArgs": {},
     "privateContext": {}
   }

  5.4 API sandbox

   backend/src/routes/sandbox.routes.ts
     POST /api/sandbox/run

  Protections d’entrée :

   - requireAuth
   - validation Zod stricte
   - toolSelection.toolId validé ObjectId
   - privateContext séparé de testArgs

  5.5 Service de résolution runtime

   backend/src/services/sandbox.service.ts

  Chaîne :

   1. résolution du tool via toolSelection
   2. contrôle ownership / accès natif
   3. refus si isEnabled = false
   4. contrôle build/provision readiness
   5. contrôle santé runtime
   6. délégation à ExecutionOrchestrator.execute()

  5.6 Orchestrateur d’exécution

   backend/src/services/runtime/ExecutionOrchestrator.ts

  Chaîne :

   1. génère executionId
   2. choisit le runner préféré
   3. crée user_tool_runs en queued
   4. sérialise l’exécution par workspace
   5. passe running
   6. exécute le runner
   7. collecte les artefacts output
   8. persiste completed | failed | timed_out
   9. expose executionId, runner, failureKind, artifacts

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  6. Architecture du sandbox sécurisé

  6.1 Runner principal

   backend/src/services/runtime/DockerSandboxRunner.ts
   backend/src/services/runtime/runtimeWrappers.ts

  Runtimes supportés :

   - python-native
   - python-custom
   - typescript-custom

  6.2 Conteneurs et wrappers

  Images runtime :

   - airdd2-runtime-python:3.12-ubuntu-noble
   - airdd2-runtime-node:22.22.2-ubuntu-noble

  Modes d’exécution :

   - Python natif : wrapper buildPythonNativeWrapper()
   - Python custom : wrapper buildPythonCustomWrapper()
   - TypeScript custom : wrapper buildTypescriptWrapper()

  6.3 Mesures de confinement

  Le conteneur est lancé avec :

   - --rm
   - --interactive
   - --read-only
   - --tmpfs /sandbox/tmp:size=...
   - --security-opt no-new-privileges
   - --cap-drop=ALL
   - --pids-limit=128
   - --cpus=0.50
   - --memory=<limit>
   - --network=none ou bridge si restricted

  Donc :

   - pas d’écriture libre hors volumes autorisés,
   - pas de privilèges ajoutés,
   - réseau coupé par défaut,
   - mémoire/CPU/PIDs plafonnés.

  6.4 Arborescence montée dans le conteneur

  Côté hôte :

   storage/
     workspaces/
       users/
         <ownerUserId>/
           workflows/
             <workflowId>/
               source/
               manifests/
               build/
               output/

  Résolution :

   backend/src/services/workspace/WorkspacePathResolver.ts
   backend/src/services/workspace/WorkspaceManager.ts

  Côté conteneur :

   /persistent-workspace/
     source/
     manifests/
     build/
     output/

  Cas natif Python :

   /opt/airdd2/backend-python

  monté read-only pour les fonctions natives.

  6.5 Données injectées au runtime

  Pour custom tools

   {
     "context": {
       "userId": "...",
       "workflowId": "...",
       "depth": 0,
       "maxDepth": 8,
       "sessionId": "executionId"
     },
     "args": {},
     "code": "..."
   }

  Pour natifs Python

   {
     "functionName": "...",
     "toolVersionTag": "...",
     "args": {},
     "privateContext": {}
   }

  Point critique :

   - privateContext est injecté au runtime,
   - mais n’est pas le contrat visible utilisateur,
   - et ne doit pas être mélangé à testArgs.

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  7. Build auteur vs provisionnement plateforme

  7.1 Build auteur pour fonctions custom

   components/FunctionEditorTab.tsx
     -> stores/useFunctionStore.ts
     -> services/toolRepository.ts
     -> POST /api/tools/:id/build
     -> backend/src/services/build.service.ts

  Résultat :

   - écrit les manifests dans manifests/tools/<toolKey>/
   - écrit les artefacts dans build/tools/<toolKey>/

  Python custom :

   - snapshot code + requirements.txt

  TypeScript custom :

   - transpilation en CommonJS + package.json + tsconfig.json

  7.2 Provisionnement plateforme pour natifs Python

   POST /api/tools/:id/provision
     -> NativePythonProvisioningService

  Réservé à :

   - scopeType = native
   - runtime = python
   - isReadonly = true

  Effet :

   - pip install --target ...
   - validation des imports critiques
   - écriture dans dépôt provisionné backend
   - statut de version basculé en built

  Conclusion :

   - custom = build auteur dans workspace,
   - natif Python dépendant = provisionnement plateforme,
   - surtout ne pas fusionner ces deux politiques.

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  8. Persistance, erreurs, artefacts, hydratation UI

  8.1 Persistance d’exécution

   backend/src/services/userToolRun.service.ts
   backend/src/models/UserToolRun.model.ts

  Cycle :

   - queued
   - running
   - completed | failed | timed_out | stopped

  Erreurs structurées :

   - code
   - subsystem
   - failureKind
   - message
   - retryable

  Sous-systèmes observables :

   - runner
   - wrapper
   - user_code
   - dependency
   - sandbox_runtime
   - build_preparation
   - runtime_readiness
   - validation

  8.2 Artefacts runtime

  Les nouveaux fichiers sous output/ sont détectés par diff avant/après run.

  Restitution :

   - metadata.artifacts[] dans la réponse de run
   - lecture via :
    - GET /api/runs/tool/:toolId/:executionId/artifacts/content
    - GET /api/runs/tool/:toolId/:executionId/artifacts/download

  8.3 Journal conversationnel

   hooks/useAgentJournalPersistence.ts
   hooks/useJournalQueue.ts
   backend/src/models/AgentJournal.model.ts

  Rôle :

   - persister tool_invocation started/completed/failed,
   - conserver le récit conversationnel,
   - offrir une hydratation UI chronologique.

  Important :

   - useJournalQueue applique queue locale + retry/backoff + JWT,
   - AgentJournal n’est pas le ledger d’exécution,
   - le ledger reste user_tool_runs.

  8.4 Affichage UI live

   components/V2AgentNode.tsx
   components/workflow/ToolCallBlock.tsx

  L’UI affiche :

   - nom du tool,
   - arguments,
   - résultat,
   - executionId,
   - runner,
   - exitCode,
   - failureKind,
   - artefacts téléchargeables.

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  9. Surfaces publiques à connaître pour l’intégration

   /api/tools
   /api/sandbox
   /api/runs
   /api/workspaces

  9.1 Catalogue

   - GET /api/tools
   - POST /api/tools
   - GET /api/tools/:id
   - PUT /api/tools/:id
   - DELETE /api/tools/:id
   - PATCH /api/tools/:id/toggle
   - GET /api/tools/:id/build-status
   - POST /api/tools/:id/build
   - POST /api/tools/:id/provision

  9.2 Exécution

   - POST /api/sandbox/run
   - POST /api/sandbox/check
   - GET /api/sandbox/health

  9.3 Observabilité

   - GET /api/runs
   - GET /api/runs/tool/:toolId
   - GET /api/runs/executions/:executionId
   - endpoints artefacts

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  10. Contrat d’intégration à fournir à l’équipe externe

  L’équipe externe doit livrer des fonctions modulaires intégrables sous forme de contrats explicites, pas seulement du code.

  10.1 Contrat minimal attendu par fonction

   {
     "name": "snake_case_unique",
     "description": "Description operationnelle",
     "category": "custom_user | native_applicative | cloud_only",
     "runtime": "python | typescript",
     "inputSchema": {
       "type": "object",
       "properties": {},
       "required": []
     },
     "outputSchema": {
       "type": "object",
       "properties": {}
     },
     "dependencies": {
       "python": [],
       "npm": []
     },
     "policy": {
       "networkMode": "none | restricted",
       "timeoutSeconds": 15,
       "maxMemoryMb": 256,
       "secretAliases": [],
       "writablePaths": []
     },
     "privateContextSchema": {
       "type": "object",
       "properties": {}
     },
     "artifacts": {
       "canWriteOutput": true,
       "artifactKinds": ["json", "log", "file"]
     },
     "buildRequirement": "none | author_build | platform_provision",
     "entrypointContract": "run(context, args)"
   }

  10.2 Règles de livraison pour eux

   1. Décrire les arguments visibles dans inputSchema.
   2. Séparer les paramètres invisibles dans privateContextSchema.
   3. Déclarer explicitement les dépendances.
   4. Déclarer la politique runtime.
   5. Déclarer si la fonction produit des artefacts dans output/.
   6. Ne jamais supposer un accès réseau ou disque non déclaré.
   7. Respecter l’entrypoint :
    - Python custom : run(context, args) ou __result__
    - TypeScript custom : run(context, args)
    - Python natif : fonction enregistrée dans le registre natif

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  11. Recommandation de découpage modulaire pour l’équipe d’architectes

  11.1 Module “contrat de fonction”

  À produire pour chaque fonction :

   - nom
   - description
   - catégorie
   - runtime
   - schéma d’entrée
   - schéma de sortie
   - dépendances
   - politique d’exécution
   - besoins de privateContext
   - artefacts produits

  11.2 Module “adaptateur d’intégration”

  À prévoir côté intégration interne :

   - mapping vers UserTool
   - mapping vers toolSelection
   - stratégie build ou provision
   - enregistrement dans catalogue

  11.3 Module “exécution”

  À respecter :

   - aucune exécution hors sandbox canonique,
   - aucun secret dans testArgs,
   - aucun nouveau flux centré sur functionId.

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  12. Conclusion opérationnelle

  Architecture actuelle en une phrase :
  un agent sélectionne des tools via toolSelections, les exécute via /api/sandbox/run, le backend résout la version dans user_tools, prépare si nécessaire, exécute en sandbox Docker sécurisée, puis persiste le résultat dans user_tool_runs et projette l’expérience conversationnelle via agent_journals.

  Pour l’équipe externe, le bon niveau d’abstraction est donc :

   1. livrer des fonctions contractuelles,
   2. avec schémas d’arguments et de sortie,
   3. politique runtime explicite,
   4. besoin de build/provision identifié,
   5. séparation stricte entre données visibles, privateContext, erreurs structurées et artefacts.