# PLAN 1 — Architecture Applicative, BDD, Sandboxing et Installation

> Date: 16 mars 2026
> Statut: Plan directeur structurel
> Portee: Fondation technique de la feature Tools avant toute refonte detaillee des fonctions natives
> Sources: `RECOMMANDATION_SANDBOX_2.md`, `REFERENCE_ERREURS_ET_LECONS_TOOLS_V2.md`, `TOOLS_V2.md`

---

## 1. Objet du plan

Ce document etablit le **premier plan d'implementation** de la nouvelle architecture Tools.

Il ne traite **pas encore** la reconstruction detaillee de chaque fonction native. Il traite d'abord les fondations qui ont manque lors de la premiere tentative:
- architecture applicative cible,
- redesign BDD,
- sandboxing et orchestration d'execution,
- installation et validation runtime,
- impacts sur l'application existante,
- ordre d'implementation anti-regression.

Ce plan applique explicitement les garde-fous de [REFERENCE_ERREURS_ET_LECONS_TOOLS_V2.md](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/REFERENCE_ERREURS_ET_LECONS_TOOLS_V2.md):
1. partir des invariants d'execution et de la BDD,
2. modeliser l'idempotence avant le sandbox,
3. traiter l'installation comme une partie de l'architecture,
4. separer workspace, build, runtime et execution,
5. imposer un contrat d'execution unique pour l'editeur Phil et la carte Bos.

---

## 2. Decision architecturale retenue

### 2.1 Decision centrale

L'architecture cible abandonne le modele invalide:
- sandbox central ad hoc,
- subprocess Python host-dependant comme socle principal,
- `isolated-vm` comme pivot TypeScript,
- confusion entre stockage, build et execution,
- collection `user_functions` comme registre trop large et trop couplant.

Elle adopte a la place le modele suivant:

1. **Workspace persistant** par utilisateur et projet/workflow
2. **Build isole** pour produire des artefacts executables
3. **Sandbox d'execution ephemere** par run
4. **Orchestrateur d'execution** cote backend
5. **Modele BDD decouple** entre definition, version, run et resultat

### 2.2 Choix de runtime et d'isolation

#### Court terme retenu
- Docker/OCI rootless durci
- conteneurs ephemeres par run
- images distinctes `node` et `python`
- base `Debian slim`, pas Alpine par defaut

#### Moyen terme vise
- segmentation par niveau de confiance
- Docker rootless pour les runs internes de confiance
- gVisor ou Firecracker pour le code utilisateur non approuve

### 2.3 Separation de responsabilites obligatoire

Le nouveau systeme doit separer strictement:
1. workspace persistant utilisateur/projet,
2. environnement de build,
3. environnement d'execution,
4. metadonnees de fonction,
5. executions et resultats,
6. permissions et secrets.

### 2.4 Hypotheses fermes et non-objectifs

Afin d'eviter toute ambiguite pour l'equipe d'implementation, les hypotheses suivantes sont retenues comme vraies:

1. le scope fonctionnel reste celui de `TOOLS_V2.md`
2. l'UX validee de Phil est conservee autant que possible
3. la carte Bos conserve sa presentation actuelle des tool calls, mais sa source de verite change
4. le support TypeScript et Python reste obligatoire
5. le MVP d'isolation utilise Docker rootless durci, pas Firecracker
6. la refonte detaillee des fonctions natives est hors perimetre de ce plan 1

Ne font pas partie de ce plan:
- le detail d'implementation unitaire de chaque fonction native
- la conception fine du function calling des LLMs locaux
- la politique complete de secret broker multi-tenant
- la generalisation Firecracker a tous les runs

### 2.5 Vocabulaire normatif

Les termes ci-dessous sont utilises avec un sens strict:

- `ToolDefinition` : definition metier stable d'un tool
- `ToolVersion` : version editable ou publiee d'un tool
- `BuildArtifact` : resultat buildable/executable produit a partir d'une version
- `Workspace` : espace persistant utilisateur/workflow/projet
- `Run` : execution unique et persistable d'un tool
- `Binding` : liaison prototype/instance vers un tool et sa politique d'usage
- `Ready` : version techniquement executable dans le runtime cible
- `Healthy` : runtime/install/process de verification OK

---

## 3. Impact sur la version actuelle de l'application

### 3.1 Backend — structures actuellement incompatibles ou partielles

Les composants suivants existent mais ne correspondent plus a l'architecture cible:

- [UserFunction.model.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/models/UserFunction.model.ts)
  - aujourd'hui: collection centrale unique pour natif + custom + code + dependances + activation
  - probleme: melange definition, code, activation, scope et execution
  - consequence: doit etre **decomposee** ou lourdement refondue

- [sandbox.service.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/services/sandbox.service.ts)
  - aujourd'hui: subprocess Python + pseudo-sandbox TypeScript via `isolated-vm`/fallback
  - probleme: pas de separation build/run, pas de preflight, pas d'orchestrateur, pas d'idempotence forte
  - consequence: doit etre **remplace par un Execution Orchestrator**

- [pythonExecutor.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/pythonExecutor.ts)
  - aujourd'hui: whitelist/subprocess runner direct
  - probleme: executeur concret trop bas niveau, pas une couche d'orchestration
  - consequence: doit etre **repositionne** comme adapter legacy temporaire ou supprime a terme

- [functions.routes.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/routes/functions.routes.ts)
  - aujourd'hui: CRUD direct sur `user_functions`
  - consequence: a scinder en plusieurs API metier: definitions, versions, builds, executions, health

- [sandbox.routes.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/routes/sandbox.routes.ts)
  - aujourd'hui: `/run`, `/check`, `/health`
  - consequence: a refondre pour exposer un contrat d'execution structurel, pas juste un test de snippet

- [UserSettings.model.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/models/UserSettings.model.ts)
  - aujourd'hui: `functionPaths[]` par workflow
  - probleme: cette responsabilite ne suffit pas pour modeliser workspace/build/runtime
  - consequence: soit simplifiee a une reference de workspace, soit deplacee vers une nouvelle collection dediee

- [AgentPrototype.model.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/models/AgentPrototype.model.ts)
- [AgentInstance.model.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/models/AgentInstance.model.ts)
  - aujourd'hui: references `tools` vers `user_functions`
  - consequence: devront pointer vers des **definitions/version refs stables**, pas vers un registre trop polymorphe

### 3.2 Frontend — elements a conserver vs refondre

#### A conserver largement
- [PhilFunctionsPage.tsx](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/components/PhilFunctionsPage.tsx)
  - l'UX generale et la logique de navigation ont ete validees
  - a conserver comme shell fonctionnel

- [FunctionEditorTab.tsx](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/components/FunctionEditorTab.tsx)
  - a conserver comme base UI editor/test
  - a rebrancher sur un nouveau contrat backend

- [FunctionSelector.tsx](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/components/FunctionSelector.tsx)
  - a conserver comme base de selection des fonctions dans Archi et Bos
  - a alimenter via nouvelles APIs et nouveaux DTOs

#### A refondre logiquement
- le test sandbox depuis Phil
- la resolution des fonctions executees par les agents sur Bos
- la persistance et rehydratation des tool calls/resultats dans les chats

### 3.3 Risques de regression si on modifie sans plan

1. casser l'heritage prototype -> instance pour les tools
2. casser la selection de fonctions dans Archi/Bos
3. conserver un couplage dangereux entre UI et runtime reel
4. reintroduire des resolutions singleton ou provider-level au lieu de l'identite d'instance
5. re-coder un sandbox non fiable avant d'avoir defini les executions et leurs etats

### 3.4 Cartographie de remplacement recommandee

Pour la nouvelle equipe, la regle suivante est imperative:

- a conserver principalement comme facade UI:
  - `PhilFunctionsPage.tsx`
  - `FunctionEditorTab.tsx`
  - `FunctionSelector.tsx`

- a convertir en couche de compatibilite temporaire:
  - `functions.routes.ts`
  - `sandbox.routes.ts`
  - `pythonExecutor.ts`

- a sortir du coeur d'architecture cible:
  - `sandbox.service.ts`
  - `user_functions` comme source de verite finale

- a refondre en priorite:
  - schemas Mongoose des tools
  - persistance des runs
  - contrat d'execution editor/workflow

---

## 4. Architecture cible par domaine

## 4.1 Domaine A — Workspace persistant

### Objectif
Fournir un espace durable par utilisateur et projet/workflow qui stocke:
- code source,
- manifests declaratifs,
- artefacts de sortie,
- eventuals depots git,
- metadonnees locales au projet.

### Decision de design
Le workspace n'est **pas** l'environnement d'execution.

### Consequences sur l'existant
- abandon du simple `functionPaths[]` comme modele suffisant
- necessite d'un service `WorkspaceManager`
- necessite de normaliser les repertoires Python et TypeScript

### Proposition de structure logique

#### Python
- `backend/users_functions/{userId}/{workflowId}/...`

#### TypeScript
- `users_functions/{userId}/{workflowId}/...`

#### Metadonnees a centraliser en BDD
- workspace root logique
- manifests presents
- quota / statut
- dernier scan
- snapshot courant

### Plan d'implementation — Domaine A

#### Etape A1
Creer une couche backend `WorkspaceManager` responsable de:
- creation idempotente du workspace,
- verification d'existence,
- resolution des chemins,
- quotas et metadonnees,
- APIs de lecture/ecriture controlees.

#### Etape A2
Introduire une collection BDD dediee au workspace au lieu de stocker cette logique dans `user_settings`.

#### Etape A3
Faire migrer la page Phil et les operations de CRUD de fonction pour qu'elles ne manipulent plus directement un simple `codeInline/codePath` ambigu, mais un workspace resolu.

#### Etape A4
Ajouter les tests d'idempotence:
- creation d'un meme workspace 2 fois,
- recreation apres suppression,
- reconstruction apres redemarrage applicatif.

### Structure cible de repository — Domaine A

L'equipe d'implementation doit viser cette organisation logique:

```text
backend/
  src/
    services/
      workspace/
        WorkspaceManager.ts
        WorkspacePathResolver.ts
        WorkspaceQuotaService.ts
    routes/
      workspaces.routes.ts
  users_functions/
    {userId}/
      {workflowId}/
        python/
        manifests/
        outputs/

users_functions/
  {userId}/
    {workflowId}/
      typescript/
      manifests/
      outputs/
```

Si un autre emplacement physique est choisi, il faut conserver un `WorkspacePathResolver` unique et testable, et interdire toute logique de chemins dispersee dans les composants ou routes.

---

## 4.2 Domaine B — Tool Registry et versioning

### Objectif
Separer la definition fonctionnelle d'un tool de son code et de son execution.

### Critique de l'etat actuel
`user_functions` est aujourd'hui trop central:
- metadata,
- code,
- dependances,
- activation,
- scope user/workflow,
- natif/custom.

Cela rend les migrations, la validation, le build et l'audit trop fragiles.

### Cible de design

Le modele cible doit distinguer au minimum:

1. **ToolDefinition**
   - identite metier stable
   - owner / scope / type / runtime / schema I/O / policy declarative

2. **ToolVersion**
   - hash de contenu
   - code source ou reference workspace
   - manifests
   - version semantique/interne
   - statut de validation

3. **ToolBuildArtifact**
   - artefact build produit
   - runtime cible
   - lockfile / provenance / digest
   - compatibilite image runtime

4. **ToolActivationBinding**
   - liaison prototype -> tool
   - liaison instance -> tool
   - override/heritage explicite

### Consequences sur l'existant
- [AgentPrototype.model.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/models/AgentPrototype.model.ts) doit cesser de pointer simplement vers un registre ambigu
- [AgentInstance.model.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/models/AgentInstance.model.ts) doit modeliser l'override comme un binding stable et relisable
- la notion `origin: native|custom` reste utile, mais ne suffit plus comme structure pivot

### Plan d'implementation — Domaine B

#### Etape B1
Definir les nouveaux schemas Mongoose et leurs index.

#### Etape B2
Introduire une strategie de migration depuis `user_functions` vers:
- definitions,
- versions,
- bindings prototype/instance.

#### Etape B3
Conserver temporairement un adaptateur legacy de lecture pour les objets existants le temps de la migration.

#### Etape B4
Refactorer les endpoints de Phil/Archi/Bos pour consommer des DTOs derives des nouvelles entites et non plus directement les documents legacy.

#### Etape B5
Ajouter les contraintes d'integrite:
- unicite logique de nom par scope,
- index par owner/workflow,
- reference stable de version active,
- prevention des suppressions invalidant des bindings encore actifs.

### Contrat minimum des nouvelles entites — Domaine B

#### `tool_definitions`
Champs minimums obligatoires:
- `_id`
- `ownerType` = `system` | `user`
- `ownerId?`
- `workflowScope` = `global_user` | `workflow_scoped` | `system_shared`
- `workflowId?`
- `name`
- `displayName`
- `runtime` = `python` | `typescript`
- `origin` = `native` | `user`
- `inputSchema`
- `outputSchema`
- `policyRef?`
- `trustLevel` = `internal` | `user_private` | `unverified`
- `createdAt`
- `updatedAt`

#### `tool_versions`
Champs minimums obligatoires:
- `_id`
- `toolDefinitionId`
- `versionNumber`
- `sourceRef`
- `sourceHash`
- `manifestRef?`
- `validationStatus` = `draft` | `validated` | `invalid`
- `readinessStatus` = `pending` | `ready` | `failed`
- `createdBy`
- `createdAt`

#### `tool_bindings`
Champs minimums obligatoires:
- `_id`
- `bindingType` = `prototype` | `instance`
- `targetId`
- `toolDefinitionId`
- `pinnedVersionId?`
- `enabled`
- `inheritanceMode` = `inherited` | `added` | `removed` | `overridden`
- `createdAt`
- `updatedAt`

---

## 4.3 Domaine C — Build Service

### Objectif
Ne jamais installer des dependances a chaud dans un run normal.
Le build produit un artefact versionne a partir d'un manifest declaratif.

### Consequences sur l'existant
- [FunctionEditorTab.tsx](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/components/FunctionEditorTab.tsx) ne doit plus directement assimiler "sauver" et "executer"
- `dependencies` dans le modele actuel ne doivent plus etre un simple tableau informatif
- les fonctions natives devront plus tard passer par la meme logique de validation et de readiness, meme si leur artefact est preconstruit

### Cible de design
- build Node/TS via `esbuild` ou `tsc`
- build Python via environnement de build isole
- sortie: artefact versionne, hash, metadata, statut

### Plan d'implementation — Domaine C

#### Etape C1
Creer un `BuildService` backend separe du runtime d'execution.

#### Etape C2
Definir les manifests acceptes:
- TS: `package.json` + lockfile
- Python: `requirements.txt` dans un premier temps

#### Etape C3
Mettre en place le cycle:
- validate static
- build/install deps
- artifactize
- store metadata
- mark version `ready` ou `failed`

#### Etape C4
Interdire qu'un tool de production lance `npm install` ou `pip install` pendant un run normal.

### Contrat de build obligatoire — Domaine C

Chaque build doit produire un resultat persistable contenant au minimum:
- `buildId`
- `toolVersionId`
- `runtime`
- `startedAt`
- `finishedAt`
- `status` = `running` | `succeeded` | `failed`
- `logsRef?`
- `artifactRef?`
- `artifactHash?`
- `lockfileHash?`
- `errorSummary?`

Une version de tool ne peut jamais passer a `ready` sans trace de build associee ou sans politique explicite de bypass pour les natives prepackaged.

---

## 4.4 Domaine D — Execution Orchestrator et sandboxing

### Objectif
Introduire une vraie orchestration d'execution par run, avec identite, logs, quotas, timeout et destruction automatique du runtime.

### Cible de design

#### Composants
1. `ExecutionOrchestrator`
2. `SandboxRunner`
3. `PolicyEngine`
4. `SecretBroker`
5. `ObservabilityEmitter`

#### Contrat d'execution commun
Tout appel, depuis Phil ou Bos, doit passer par le meme contrat:
- `executionId`
- `toolDefinitionId`
- `toolVersionId`
- `userId`
- `workflowId`
- `agentInstanceId?`
- `source` = `editor_test` | `workflow_run` | `system_validation`
- `input`
- `policyRef`

#### Reponse normalisee
- `success`
- `result`
- `error`
- `stdout`
- `stderr`
- `diagnostics`
- `durationMs`
- `exitCode`
- `executionId`

#### Machine d'etat minimale d'un run

Les statuts d'execution autorises sont:
- `queued`
- `preflight_failed`
- `running`
- `succeeded`
- `failed`
- `timed_out`
- `cancelled`

Transitions autorisees uniquement:
1. `queued -> preflight_failed`
2. `queued -> running`
3. `running -> succeeded`
4. `running -> failed`
5. `running -> timed_out`
6. `queued -> cancelled`
7. `running -> cancelled`

### Consequences sur l'existant
- [sandbox.service.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/services/sandbox.service.ts) doit etre remplace
- [sandbox.routes.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/routes/sandbox.routes.ts) doit devenir une facade vers l'orchestrateur
- [pythonExecutor.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/pythonExecutor.ts) devient legacy ou adaptateur temporaire
- les agents sur Bos doivent enregistrer les executions et non seulement afficher des blocs UI

### Choix de sandbox

#### MVP retenu
- Docker rootless durci
- container ephemere par run
- images runtime distinctes `node` et `python`
- base Debian slim
- `read-only rootfs`
- `network=none` par defaut
- quotas CPU/memoire/pids
- logs structures

#### Cible securite ulterieure
- gVisor / Firecracker pour code user non approuve

### Plan d'implementation — Domaine D

#### Etape D1
Creer l'abstraction `ExecutionOrchestrator` et son interface.

#### Etape D2
Creer un `DockerSandboxRunner` rootless durci.

#### Etape D3
Mettre en place un pre-tool hook obligatoire:
- validation du contexte,
- verification version/tool ready,
- verification policy,
- verification quotas,
- verification manifests/runtime.

#### Etape D4
Mettre en place un post-tool hook:
- normalisation resultat/erreur,
- collecte logs,
- persistence run,
- emission websocket.

#### Etape D5
Refondre les appels de la carte Bos pour qu'un tool call soit une entite persistable, rehydratable et rejouable.

### Surface API minimale — Domaine D

La nouvelle equipe ne doit pas improviser les routes. Le minimum attendu est:

#### Definitions / versions
- `GET /api/tools`
- `POST /api/tools`
- `GET /api/tools/:definitionId`
- `PUT /api/tools/:definitionId`
- `POST /api/tools/:definitionId/versions`
- `GET /api/tools/:definitionId/versions`
- `GET /api/tool-versions/:versionId`

#### Build
- `POST /api/tool-versions/:versionId/build`
- `GET /api/tool-builds/:buildId`

#### Runs
- `POST /api/tool-runs`
- `GET /api/tool-runs/:executionId`
- `POST /api/tool-runs/:executionId/cancel`

#### Workspaces / health
- `GET /api/workspaces/:workflowId`
- `POST /api/workspaces/:workflowId/ensure`
- `GET /api/tools-runtime/health`

Ces routes peuvent etre exposees derriere une facade de compatibilite, mais ces primitives doivent exister en backend.

---

## 4.5 Domaine E — BDD et idempotence des executions

### Objectif
Faire de la base la source de verite des executions et de leur cycle de vie.

### Collections cibles recommandees

#### `tool_definitions`
- metadonnees de tool
- owner
- scope
- runtime
- schemas I/O
- permissions declarees
- niveau de confiance

#### `tool_versions`
- contenu source ou reference workspace
- hash
- manifest
- statut validation
- statut readiness
- version logique

#### `tool_build_artifacts`
- artefacts produits
- runtime cible
- digest image
- metadata build

#### `tool_runs`
- `executionId`
- refs user/workflow/agent/tool/version
- input canonicalise
- resultat ou erreur
- stdout/stderr
- status lifecycle
- duration
- resource usage
- retry parent / replay metadata

### Modele detaille des `tool_runs`

Champs minimums a imposer:
- `_id`
- `executionId` unique
- `source` = `editor_test` | `workflow_run` | `system_validation`
- `userId`
- `workflowId`
- `agentInstanceId?`
- `toolDefinitionId`
- `toolVersionId`
- `status`
- `inputCanonical`
- `resultPayload?`
- `errorPayload?`
- `stdoutRef?`
- `stderrRef?`
- `diagnostics?`
- `startedAt?`
- `finishedAt?`
- `durationMs?`
- `resourceUsage?`
- `retryOfExecutionId?`
- `createdAt`

### Regles d'idempotence complementaires

1. un `executionId` ne doit jamais etre regenere sur retry d'un meme run sans trace de filiation
2. un run finalise (`succeeded`, `failed`, `timed_out`, `cancelled`, `preflight_failed`) est immuable hors annotations non critiques
3. les projections UI de Bos et Phil doivent deriver de `tool_runs`, jamais d'un cache frontend seul
4. les messages de chat affichant un tool call doivent stocker la reference `executionId`

#### `tool_bindings`
- bindings prototype -> definition/version policy
- bindings instance -> overrides

#### `workspaces`
- path logique
- owner/scope
- manifests
- snapshots
- quotas
- health

#### `secret_policies` / `secrets_metadata` (si active)
- alias
- scope
- permissions

### Consequences sur l'existant

#### `user_functions`
Ne doit plus etre la source finale. Deux options:
1. migration complete vers nouvelles collections,
2. conservation transitoire comme vue legacy/adaptateur.

#### `agent_prototypes.tools`
Doit evoluer vers un binding reference-safe.

#### `agent_instances.tools`
Doit sortir du simple tableau de refs pour modeliser:
- heritage,
- ajout,
- retrait,
- version cible,
- politique associee.

#### `user_settings.functionPaths`
Probablement a simplifier ou deplacer vers `workspaces`.

### Invariants d'idempotence obligatoires

1. tout run a un `executionId` unique
2. une relance ne doit pas dupliquer silencieusement un run deja finalise sans lien explicite
3. les transitions de statut sont bornees
4. l'UI peut rehydrater un run sans recomputation
5. les tool calls du chat sont des projections d'entites persistantes, pas seulement des fragments UI

### Plan d'implementation — Domaine E

#### Etape E1
Rediger les schemas Mongoose et les transitions d'etat.

#### Etape E2
Creer les index critiques:
- par owner/workflow,
- par `executionId`,
- par tool/version,
- par statut/date.

#### Etape E3
Mettre en place une migration progressive et idempotente depuis les structures actuelles.

#### Etape E4
Creer les DTOs de projection pour Bos et Phil afin que la rehydratation UI se fasse depuis `tool_runs`.

### Strategie de migration imposee — Domaine E

La migration doit etre additive en 4 temps:

1. creer nouvelles collections et nouvelles routes sans couper les anciennes
2. dupliquer/ecrire dans ancien + nouveau modele si necessaire pendant une phase transitoire
3. lire via projections prioritaires sur le nouveau modele avec fallback legacy
4. supprimer les structures legacy seulement apres validation QA et migration complete

La nouvelle equipe ne doit pas faire de migration big bang.

---

## 4.6 Domaine F — Installation et validation runtime

### Objectif
Transformer l'installation en composant produit verifiable.

### Problemes actuels a ne plus reproduire
- runtime Python reel ambigu
- dependances visibles dans un fichier mais non garanties dans le runtime executeur
- outils exposes avant validation
- absence de verification au boot

### Cible de design
Le demarrage applicatif doit pouvoir verifier:
1. que les runtimes build et run existent,
2. que les images sandbox sont presentes ou buildables,
3. que les dependances natives obligatoires sont installes,
4. que les imports critiques passent,
5. que les fonctions natives sont marquees `ready` ou `unhealthy`,
6. que les routes de health exposent cet etat.

### Consequences sur l'existant
- `requirements.txt` ne suffit pas comme preuve de disponibilite
- les fonctions natives ne doivent plus etre "activables" si leur readiness est KO
- il faut un bootstrap d'installation et des checks de sante au demarrage

### Plan d'implementation — Domaine F

#### Etape F1
Definir un processus d'installation officiel:
- prerequis Docker,
- prebuild images sandbox,
- init Mongo,
- verification runtimes,
- verification manifests.

#### Etape F2
Creer un `RuntimeHealthService` qui effectue:
- test des images runtime,
- test des imports natifs,
- test des executables build/run,
- exposition d'un rapport de sante.

#### Etape F3
Ajouter des scripts idempotents:
- `setup:tools-runtime`
- `check:tools-runtime`
- `build:tool-runtimes`
- `seed:tool-registry`

#### Etape F4
Ajouter un test CI bloquant qui verifie qu'aucune fonction native declaree n'est `missing dependency`.

### Sequence d'installation normative — Domaine F

L'installation cible doit suivre cet ordre, sans permutation:

1. initialiser MongoDB
2. construire les images runtime sandbox
3. verifier la disponibilite Docker rootless ciblee
4. creer/valider les workspaces de base
5. seed des tool definitions systeme
6. executer les health checks runtime
7. marquer les versions systeme `ready` ou `unhealthy`
8. seulement ensuite exposer les tools dans l'UI

### Responsabilites d'installation

- `setup script` : prepare l'environnement
- `seed script` : installe definitions et metadata systeme
- `health service` : verifie la readiness runtime
- `UI` : ne doit jamais rendre une fonction executable sans readiness backend

---

## 5. Repercussions fonctionnelles sur les pages de l'application

## 5.1 Page Phil — Fonctions personnalisees

### Ce qui reste vrai
- l'UX globale de la page est conservee
- l'editeur et la bibliotheque restent les deux points d'entree

### Ce qui change
- l'editeur ne teste plus un snippet directement dans un pseudo-sandbox legacy
- il cree/edite une definition + une version de travail
- le test passe par un run structure `editor_test`
- les erreurs doivent remonter `stdout/stderr/diagnostics`

### Impact de code
- [PhilFunctionsPage.tsx](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/components/PhilFunctionsPage.tsx): faible impact UX, fort impact data-loading
- [FunctionEditorTab.tsx](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/components/FunctionEditorTab.tsx): fort impact backend contract

## 5.2 Page Archi — Prototypage d'agents

### Ce qui change
- la selection de tools doit porter sur des definitions/version bindings, pas sur des documents `user_functions` trop polymorphes
- l'heritage prototype -> instance doit etre explicite et persistable

### Impact de code
- modales prototype a refactorer cote DTO et persistance
- [FunctionSelector.tsx](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/components/FunctionSelector.tsx) peut etre conserve avec adaptation de source de donnees

## 5.3 Page Bos — Carte du workflow

### Ce qui change
- les tool calls affiches doivent etre reconstruits depuis des runs persistes
- les executions doivent garder la structure visuelle actuelle, mais derivee d'une source de verite BDD
- l'appel depuis un agent doit passer par `tool_runs` et non par un executeur ad hoc

### Impact de code
- la logique de chat/tool call doit persister davantage qu'un bloc de texte
- les balises invisibles de rehydratation demandees par le besoin fonctionnel doivent provenir d'identifiants de run et non d'un bricolage frontend

---

## 6. Plan de migration par phases

## Phase 0 — Stabilisation et preparation

### But
Geler les points instables avant refonte profonde.

### Actions
- conserver l'UX validee de Phil
- figer les endpoints legacy comme "compat mode"
- documenter la liste des composants impactes
- preparer les scripts de migration et de nettoyage test

### Exit criteria
- liste complete des fichiers impactes approuvee
- strategie de migration additive validee
- anciens endpoints tagges `legacy/compat`

## Phase 1 — Fondations BDD + contrat d'execution

### But
Creer les nouvelles entites et le contrat d'execution commun sans encore rebrancher toute l'UI.

### Livrables
- schemas Mongoose
- transitions d'etat des runs
- DTOs unifies
- services `WorkspaceManager`, `BuildService`, `ExecutionOrchestrator`, `RuntimeHealthService`

### Exit criteria
- schemas et index valides
- machine d'etat des runs implementee
- DTOs de projection figes

## Phase 2 — Runtime et sandbox MVP

### But
Rendre executable un run ephemere fiable.

### Livrables
- images runtime Debian slim
- Docker rootless durci
- pre/post hooks
- logs structures
- health checks runtime

### Exit criteria
- un run `editor_test` et un run `workflow_run` passent par le meme orchestrateur
- les timeouts et quotas sont appliques et testes
- les logs et erreurs sont normalises

## Phase 3 — Integration Phil

### But
Brancher l'editeur sur le nouveau systeme.

### Livrables
- CRUD definition/version
- test editor via `tool_runs`
- affichage normalise de resultat/erreur

### Exit criteria
- l'editeur Phil n'utilise plus `sandbox.service.ts`
- la console affiche `stdout/stderr/diagnostics/executionId`

## Phase 4 — Integration Archi/Bos

### But
Rebrancher selection et execution reelles des tools dans les agents.

### Livrables
- bindings prototype/instance
- run workflow persistants
- rehydratation UI depuis BDD

### Exit criteria
- Archi selectionne des bindings stables
- Bos rehydrate les tool calls depuis `tool_runs`
- l'heritage prototype -> instance est teste

## Phase 5 — Nettoyage legacy

### But
Sortir les anciennes abstractions devenues toxiques.

### Livrables
- deprecation `sandbox.service.ts`
- deprecation `pythonExecutor.ts` comme executeur principal
- migration ou suppression `user_functions` legacy selon strategie retenue

### Exit criteria
- aucun flux critique ne depend encore des executeurs legacy
- documentation de suppression/migration finalisee

---

## 7. Risques et contre-mesures

### Risque 1 — Refactor BDD trop brutal
Contre-mesure: migration additive, projections legacy, suppression differée.

### Risque 2 — Bloquer l'editeur pendant la refonte
Contre-mesure: conserver l'UX, changer uniquement le backend contract par etapes.

### Risque 3 — Refaire une architecture de sandbox avant la readiness runtime
Contre-mesure: imposer `RuntimeHealthService` et `ToolVersion.status` avant l'execution generalisee.

### Risque 4 — Confusion persistante entre configuration prototype et instance
Contre-mesure: modeliser explicitement les bindings et l'heritage.

### Risque 5 — Coupler les fonctions natives au meme plan detaille que les fondations
Contre-mesure: garder la reconstruction des natives dans un **second plan distinct**, comme demande par l'equipe.

---

## 8. Definition of Done de ce premier plan

Le premier plan sera considere comme correctement execute par les futurs agents si:

1. le nouveau modele BDD est specifie et migre sans ambiguite
2. le contrat d'execution est unique entre Phil et Bos
3. le sandbox n'est plus un service ad hoc mais une couche d'orchestration remplaçable
4. l'installation et les checks runtime sont industrialises
5. Archi/Bos/Phil pointent vers les nouvelles projections sans casser l'UX validee
6. la base permet la rehydratation des tool calls et des executions de facon idempotente

## 8.1 Zones d'ombre traitees par cette revision

Les zones d'ombre suivantes ont ete explicitement levees dans cette revision du plan:

1. definition normative des objets `ToolDefinition`, `ToolVersion`, `BuildArtifact`, `Run`, `Binding`
2. machine d'etat minimale des runs
3. structure cible du repository pour `WorkspaceManager`
4. contrat minimum des collections critiques
5. surface API minimale attendue
6. strategie de migration additive et non destructive
7. sequence d'installation normative
8. exit criteria par phase

## 8.2 Zones encore volontairement hors perimetre

Restent volontairement hors de ce plan 1, car reservees au plan 2:

1. detail de chaque fonction native systeme
2. policies fines par tool natif specifique
3. implementation detaillee du function calling pour Ollama, LMStudio et Jan
4. taxonomie complete des permissions reseau et secrets par tool natif

---

## 9. Suite attendue

Une fois ce plan structurel valide par l'equipe, le **second plan** devra se concentrer exclusivement sur:
- la reconstruction des fonctions natives,
- leurs manifests et dependances,
- leurs protocoles d'erreur,
- leurs tests,
- la prise en charge particuliere des LLMs locaux pour le function calling.

Ce second plan ne devra pas reouvrir les choix structurels deja arbitres ici.