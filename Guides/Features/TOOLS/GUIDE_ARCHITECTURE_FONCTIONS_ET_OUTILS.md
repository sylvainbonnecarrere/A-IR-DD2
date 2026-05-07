# Guide architecture fonctions et outils

## 1. Objectif du document

Ce document sert de base de travail pour un futur agent de code qui devra faire evoluer la pile "fonctions/outils" sans casser l'existant.

Le systeme actuel n'est pas monolithique. Il combine encore plusieurs surfaces en transition:

- une surface legacy d'edition et CRUD autour de `user_functions`
- une surface cible Tools V2 autour de `user_tools`
- une surface runtime sandboxee pour les executions persistantes
- une surface provider/cloud pour les outils natifs exposes directement par certains LLM
- une petite surface legacy de fallback dans le frontend via `utils/toolExecutor.ts`

La regle la plus importante pour un futur agent est donc la suivante:

> Ne jamais supposer qu'un seul stockage ou qu'une seule route controle tout le cycle de vie d'une fonction.


## 2. Taxonomie reelle des fonctions

### 2.1 Vue d'ensemble

| Categorie | Source principale | Editable par utilisateur | Scope | Runtime principal | Exemple |
| --- | --- | --- | --- | --- | --- |
| Fonctions cloud-only / provider-native | provider LLM + `services/llmService.ts` + modules provider | Non, seulement activation/configuration | session agent / requete | API du provider | `webFetch`, `webSearch`, grounding web |
| Fonctions natives de l'application | seed backend + code Python natif applicatif | Non en pratique, lecture seule | global app | sandbox runtime via `python-native` | `backend/python/native/*.py` |
| Fonctions creees par l'utilisateur | `user_functions` + miroir `user_tools` | Oui | prive workflow ou partage selon regles | sandbox runtime via `typescript-custom` ou `python-custom` | `hello_test`, fonctions Phil TS/Python |

### 2.2 Fonctions cloud-only / provider-native

Ce sont les outils exposes par certains fournisseurs LLM, sans passer par l'editeur Phil ni par les workspaces utilisateur.

Points clefs:

- Ils sont transportes dans le flux de chat via `components/V2AgentNode.tsx`.
- Ils sont injectes dans `services/llmService.ts` au moment de `generateContentStream(...)`.
- Le provider Anthrop ic supporte explicitement des flags `nativeToolsConfig` avec `webFetch` et `webSearch` dans `services/anthropicService.ts`.
- Le grounding web et certaines capacites de recherche passent aussi par `services/llmService.ts`, `services/arcLLMService.ts` et l'etat local du noeud agent.
- Ils ne sont pas stockes dans `user_functions` ni `user_tools`.
- Ils n'ont pas de workspace dedie, pas de build applicatif, pas de `user_tool_runs` si l'appel reste 100% provider-side.

Important:

- Il faut les distinguer des fonctions applicatives, car leur cycle de vie depend du provider et non du sandbox local.
- Activer `webFetch` ou `webSearch` sur un agent ne cree pas une fonction Phil.

### 2.3 Fonctions natives de l'application

Ce sont les fonctions maintenues par l'application elle-meme, generalement en Python, avec un contrat stable et gouverne par le backend.

Points clefs:

- La definition catalogue se trouve dans `backend/src/seeds/nativeFunctions.seed.ts`.
- Le registre d'execution natif Python se trouve dans `backend/python/runner.py` via `FUNCTION_REGISTRY`.
- Leur code source reside dans `backend/python/native/`.
- Elles sont marquees `origin: 'native'`, globales, et en lecture seule dans la logique de seed.
- Elles sont executees par le runtime sandbox via `ExecutionOrchestrator` avec le mode `python-native`.

Important:

- Elles ne sont pas des fonctions cloud.
- Elles ne sont pas des fonctions utilisateur, meme si elles peuvent apparaitre dans les listes d'outils selectionnables.
- Elles ont un pipeline de provisioning/build different des fonctions custom.

### 2.4 Fonctions creees par l'utilisateur

Ce sont les fonctions gerees depuis Phil, editees en TypeScript ou Python, puis executees dans le sandbox.

Points clefs:

- La surface canonique de commande passe maintenant par `backend/src/routes/tools.routes.ts` et `ToolCommandService`.
- `backend/src/routes/functions.routes.ts` subsiste comme facade de compatibilite legacy.
- La lecture catalogue runtime et readiness passe par `backend/src/routes/tools.routes.ts`.
- Le frontend lit via `services/toolRepository.ts` puis `stores/useFunctionStore.ts`.
- Le stockage legacy editable est `user_functions`.
- Le stockage cible runtime/readiness/versioning est `user_tools`.
- Le miroir entre les deux est maintenu par `backend/src/services/userToolMirror.service.ts`.

Important:

- Tant que la convergence n'est pas terminee, `user_functions` reste la verite d'edition et `user_tools` la verite de lecture runtime enrichie.
- Un futur agent ne doit pas supprimer cette dualite sans plan de migration complet.


## 3. Pages, menus et composants concernes

### 3.1 Menu et navigation

- `data/robotNavigation.ts`
  - declare les entrees de navigation robot, dont la zone Phil pour les fonctions
- `components/RobotPageRouter.tsx`
  - route `/phil/functions` vers `PhilFunctionsPage`
  - route les surfaces Bos/Workflow qui consomment ensuite les fonctions dans l'execution agent

### 3.2 Surface Phil pour creer et tester les fonctions

- `components/PhilFunctionsPage.tsx`
  - bibliotheque de fonctions
  - creation/suppression/activation
  - choix du template de depart
- `components/FunctionEditorTab.tsx`
  - edition de code
  - test args JSON
  - execution sandbox manuelle
  - affichage build/runtime/artifacts

### 3.3 Surface Archi pour selectionner les fonctions sur les agents

- `components/modals/AgentFormModal.tsx`
  - onglet `fonctions`
  - utilise `FunctionSelector`
- `components/modals/AgentConfigurationModal.tsx`
  - gere l'heritage prototype -> instance
  - permet override des fonctions au niveau instance
  - utilise aussi `FunctionSelector`
- `components/FunctionSelector.tsx`
  - charge le catalogue via le store
  - supporte IDs legacy et IDs canoniques `toolId`

### 3.4 Surface runtime workflow

- `components/WorkflowCanvas.tsx`
  - heberge les cartes agent runtime
- `components/V2AgentNode.tsx`
  - coeur du runtime de chat outille
  - assemble les tools accessibles au noeud
  - declenche l'execution locale ou provider-native
  - construit les blocs visuels de tool call
- `components/workflow/ToolCallBlock.tsx`
  - bloc expandable Input / Output / artifacts / metadata
- `components/modals/FullscreenChatModal.tsx`
  - rehydratation de l'historique chat en plein ecran
  - ne persiste plus via `/content`, mais conserve encore une logique de compatibilite legacy autour des anciens `toolCalls`


## 4. Fichiers et verites de domaine

### 4.1 Design domain

Ce domaine couvre la definition des fonctions, leur selection, leur edition, leur build et leur lisibilite dans le catalogue.

Pieces principales:

- `stores/useFunctionStore.ts`
- `services/toolRepository.ts`
- `backend/src/routes/functions.routes.ts`
- `backend/src/routes/tools.routes.ts`
- `backend/src/services/function.service.ts`
- `backend/src/services/toolReadAdapter.service.ts`
- `backend/src/services/userToolQuery.service.ts`
- `backend/src/services/userToolMirror.service.ts`

### 4.2 Runtime domain

Ce domaine couvre l'execution, les traces runtime, les artefacts et le rendu chat.

Pieces principales:

- `components/V2AgentNode.tsx`
- `services/agentToolExecution.ts`
- `services/llm/AgentLoop.ts`
- `backend/src/routes/sandbox.routes.ts`
- `backend/src/services/sandbox.service.ts`
- `backend/src/services/runtime/ExecutionOrchestrator.ts`
- `backend/src/services/runtime/DockerSandboxRunner.ts`
- `backend/src/services/runtime/runtimeWrappers.ts`
- `backend/src/models/UserToolRun.model.ts`

### 4.3 Journal et persistance conversationnelle

Pieces principales:

- `hooks/useJournalQueue.ts`
- `backend/src/services/journal.service.ts`
- `backend/src/models/AgentJournal.model.ts`
- `backend/src/types/persistence.ts`

Etat actuel:

- `user_tool_runs` est riche et structure pour l'execution outil.
- `agent_journals` est encore relativement grossier pour les appels outil.
- C'est la principale zone de convergence manquante si l'on veut un historique robuste des tools.


## 5. Flux end-to-end par categorie

### 5.1 E2E creation d'une fonction utilisateur depuis Phil

Chaine principale:

1. `components/PhilFunctionsPage.tsx`
2. `stores/useFunctionStore.ts`
3. `services/toolRepository.ts`
4. `backend/src/routes/functions.routes.ts`
5. `backend/src/services/function.service.ts`
6. `backend/src/services/userToolMirror.service.ts`
7. `user_functions` + miroir `user_tools`

Ce qu'il faut retenir:

- Le frontend Phil lit le catalogue via `/api/tools` et les operations create/update/delete/toggle passent maintenant aussi par `/api/tools`.
- `/api/functions` reste une facade de compatibilite temporaire, mais elle delegue desormais au meme `ToolCommandService` que `/api/tools`.
- Quand une fonction custom workflow-scoped legacy est manipulee, le backend doit encore synchroniser les chemins legacy du workspace via `WorkspaceManager.syncLegacyFunctionPaths(...)`.
- Le miroir `syncUserToolMirrorFromLegacyFunction(...)` garantit que la fonction redevient visible dans la surface Tools V2 tant que la couche legacy subsiste.
- Le run manuel Phil est maintenant aligne sur une selection canonique de tool, ce qui retire ce point de la liste des divergences majeures restantes.

### 5.2 E2E test manuel d'une fonction dans l'editeur Phil

Chaine principale:

1. `components/FunctionEditorTab.tsx`
2. `stores/useFunctionStore.ts`
3. `services/toolRepository.ts`
4. `POST /api/sandbox/run`
5. `backend/src/routes/sandbox.routes.ts`
6. `backend/src/services/sandbox.service.ts`
7. `backend/src/services/runtime/ExecutionOrchestrator.ts`
8. `backend/src/services/runtime/DockerSandboxRunner.ts`
9. `backend/src/services/runtime/runtimeWrappers.ts`

Ce qu'il faut retenir:

- L'editeur Phil ne passe pas par le provider LLM.
- Il passe directement par le sandbox runtime.
- C'est le meilleur chemin pour verifier la sante build/runtime d'une fonction.
- Le frontend peut maintenant appeler `POST /api/sandbox/run` sans `functionId` legacy, en envoyant un `toolSelection` canonique.
- Le backend accepte desormais soit `toolSelection`, soit le fallback legacy `functionId`, afin de garder la compatibilite des callers non encore migres.
- Les resultats d'execution enrichis peuvent produire execution id, stdout, stderr, runner et artifacts.

### 5.3 E2E selection de fonctions sur un prototype Archi

Chaine principale:

1. `components/modals/AgentFormModal.tsx`
2. `components/FunctionSelector.tsx`
3. `stores/useFunctionStore.ts`
4. `services/toolRepository.ts`
5. `GET /api/tools`
6. `backend/src/routes/tools.routes.ts`
7. `backend/src/services/toolReadAdapter.service.ts`
8. `backend/src/services/userToolQuery.service.ts`

Ce qu'il faut retenir:

- Archi ne manipule pas directement `user_functions`.
- Le selecteur consomme un catalogue read-side deja adapte au frontend.
- Le selecteur accepte une transition legacy/canonique grace a `toolId ?? _id`.

### 5.4 E2E execution locale par un agent workflow

Cas: provider local ou boucle AgentLoop emulee.

Chaine principale:

1. `components/V2AgentNode.tsx`
2. chargement du scope d'outils selectionnes
3. `services/llm/AgentLoop.ts`
4. `services/adapters/LocalLLMAdapter.ts`
5. emission `tool_call_start`
6. `services/agentToolExecution.ts`
7. `POST /api/sandbox/run`
8. `SandboxService` -> `ExecutionOrchestrator`
9. emission `tool_call_done`
10. rendu `ToolCallBlock`
11. reponse finale agent

Ce qu'il faut retenir:

- Le bloc outil apparait avant la reponse finale de l'agent.
- Le resultat final de l'outil est attache a un `toolCallRecord` riche.
- Le noeud runtime n'attend plus la fin complete de la reponse LLM pour montrer qu'un outil est parti.

### 5.5 E2E execution provider-native avec fonctions applicatives mergees

Cas: provider cloud qui supporte le function calling natif.

Chaine principale:

1. `components/V2AgentNode.tsx`
2. merge entre tools provider et `scopedFunctions`
3. `services/llmService.ts`
4. module provider (`services/anthropicService.ts`, autres)
5. retour de `toolCalls`
6. `services/agentToolExecution.ts`
7. si la fonction correspond a une fonction applicative connue -> `/api/sandbox/run`
8. sinon fallback `utils/toolExecutor.ts`

Ce qu'il faut retenir:

- Le merge des `scopedFunctions` dans les tools envoyes au provider est indispensable. Sans cela, la fonction existe dans le catalogue mais pas dans la requete LLM.
- `executeAgentToolCall(...)` choisit le sandbox quand le nom correspond a une vraie fonction catalogue et qu'un token auth est disponible.
- Sinon il tombe sur `executeTool(...)`, qui est une couche legacy/utilitaire, pas la cible architecturale finale.

### 5.6 E2E fonction native Python applicative

Chaine principale:

1. `backend/src/seeds/nativeFunctions.seed.ts`
2. publication catalogue via `/api/tools`
3. selection par `FunctionSelector`
4. execution via `/api/sandbox/run`
5. `ExecutionOrchestrator.resolveExecutionMode(...)` -> `python-native`
6. `DockerSandboxRunner`
7. wrapper `buildPythonNativeWrapper(...)`
8. `backend/python/runner.py`
9. `FUNCTION_REGISTRY`
10. module `backend/python/native/*.py`

Ce qu'il faut retenir:

- Le code n'est pas pris depuis le workspace utilisateur.
- Le runtime appelle le registre natif applicatif.
- Les dependances peuvent etre provisionnees par `NativePythonProvisioningService`.

### 5.7 E2E fonction custom Python utilisateur

Chaine principale:

1. creation/edition Phil
2. build readiness
3. `ExecutionOrchestrator.resolveExecutionMode(...)` -> `python-custom`
4. resolution du code depuis `codeInline` ou depuis le workspace
5. `DockerSandboxRunner`
6. wrapper `buildPythonCustomWrapper(...)`
7. execution dans le container avec le workspace persistant monte

Ce qu'il faut retenir:

- Le code peut vivre inline ou dans le workspace persistant.
- Le contexte prive et les args sont injectes dans le wrapper runtime.

### 5.8 E2E fonction custom TypeScript utilisateur

Chaine principale:

1. creation/edition Phil
2. build readiness
3. `ExecutionOrchestrator.resolveExecutionMode(...)` -> `typescript-custom`
4. transpilation/preparation par le backend
5. `DockerSandboxRunner`
6. wrapper `buildTypescriptWrapper(...)`
7. execution par `node --eval`

Ce qu'il faut retenir:

- Le runtime TypeScript est distinct du runtime Python.
- Il passe par un wrapper JS/TS genere, pas par `runner.py`.


## 6. Regles de fonctionnement des blocs expandables

### 6.1 Types de messages utilises par le chat runtime

Le rendu runtime manipule au moins quatre roles utiles:

- `user`
- `agent`
- `tool`
- `tool_result`

### 6.2 Regle d'affichage principale

Le bloc riche et expandable est rendu par `components/workflow/ToolCallBlock.tsx` a partir d'un message `sender: 'tool'` qui porte un `toolCallRecord`.

Ce bloc peut exposer:

- nom de la fonction appelee
- statut
- duree
- runner
- Input detaille
- Output detaille
- artifacts
- erreurs structurees

### 6.3 Pending block puis bloc finalise

Dans `components/V2AgentNode.tsx`:

- a `tool_call_start`, l'UI ajoute immediatement un message `tool`
- tant que l'execution n'est pas terminee, il peut s'afficher comme bloc en attente
- a `tool_call_done`, le bloc est finalise avec les details complets
- la reponse texte finale de l'agent arrive ensuite dans le flux habituel

### 6.4 Regle de deduplication `tool_result`

`utils/toolResultVisibility.ts` cache un `tool_result` quand un bloc `tool` correspondant existe deja.

But:

- eviter un double rendu visuel du meme appel outil
- garder un rendu clair: un bloc outil detaille + un bloc de reponse LLM classique

### 6.5 Implication pour un futur agent

Si vous changez la structure des messages, vous devez conserver en meme temps:

- la possibilite d'afficher l'appel outil avant la fin du texte LLM
- la correlation fiable entre `tool`, `tool_result` et `toolCallRecord.id`
- la compatibilite de rehydratation de l'historique


## 7. Workspace utilisateur: point essentiel et detaille

### 7.1 Arborescence reelle

Le resolveur `backend/src/services/workspace/WorkspacePathResolver.ts` produit cette structure:

```text
storage/workspaces/
  users/<ownerUserId>/
    <scopeType>s/<scopeId>/
      source/
      manifests/
      build/
      output/
```

Pour un workflow, le chemin logique devient:

```text
storage/workspaces/users/<ownerUserId>/workflows/<workflowId>/
```

### 7.2 Sens de chaque dossier

- `source/`
  - code source custom utilisateur
  - fichiers referencables par `codePath`
- `manifests/`
  - manifests detectes ou materialises: `package.json`, `requirements.txt`, etc.
- `build/`
  - sorties intermediaires de build / metadonnees de build
- `output/`
  - sorties runtime et artifacts d'execution

### 7.3 Provisioning et synchronisation

`backend/src/services/workspace/WorkspaceManager.ts`:

- cree les repertoires s'ils n'existent pas
- maintient un document `Workspace` en base
- detecte les manifests disponibles
- met a jour aussi les anciens `UserSettings.functionPaths` pour compatibilite legacy

### 7.4 Ce qui va dans le workspace et ce qui n'y va pas

Va dans le workspace:

- le code custom utilisateur base workflow
- les manifests de build custom
- les outputs et artifacts de runs

N'y va pas:

- les fonctions natives applicatives de `backend/python/native/`
- les outils cloud-only provider
- les vieilles mini fonctions utilitaires frontend de `utils/toolExecutor.ts`

### 7.5 Lien entre workspace et selection de version

Le runtime sandbox passe un `toolSelection` contenant:

- `toolId`
- `versionTag`
- `versionNumber`
- `workspaceId`

Ce point est critique:

- l'execution n'est pas seulement `functionId + args`
- elle peut viser une version precise rattachee a un workspace precis

### 7.6 Impact architecture

Le workspace est la frontiere entre:

- definition logique de la fonction
- materiel runtime reel a executer
- outputs persistants exploitables apres execution

Un futur agent ne doit pas traiter le workspace comme un simple cache jetable.


## 8. Journal, input/output, erreurs, abandon/retry, flags exploitables

### 8.1 Etat actuel

Le systeme dispose de deux niveaux de persistance qui ne sont pas encore converges:

- `backend/src/models/UserToolRun.model.ts`
  - structuree pour le runtime outil
  - inputs, outputs, stdout, stderr, status, artifacts, policy snapshot, resource usage
- `backend/src/models/AgentJournal.model.ts`
  - structuree pour le chat et d'autres evenements
  - mais encore trop legere pour capturer toute la semantique d'un appel outil moderne

### 8.2 Limite actuelle principale

Le payload chat de `backend/src/types/persistence.ts` supporte surtout:

- `role`
- `content`
- `toolCalls` simplifie

Il ne capture pas correctement, en premiere classe:

- `toolCallRecord.id`
- `executionId`
- input parse
- output parse
- artifacts
- `failureKind`
- `runner`
- tentative courante
- retryable ou non
- horodatages debut/fin d'appel outil

### 8.3 Consequence produit

Aujourd'hui:

- l'UI runtime live est plus riche que le journal rehydrate a froid
- `user_tool_runs` contient la verite d'execution
- `agent_journals` contient surtout la verite conversationnelle

Cela cree une dette claire pour:

- l'audit d'execution
- le replay
- l'analyse de fiabilite outil
- l'affichage coherent en plein ecran/hydratation

### 8.4 Architecture cible recommandee pour les logs d'outils

Option recommandee:

- conserver `user_tool_runs` comme source d'audit d'execution detaillee
- enrichir `agent_journals` avec soit:
  - un nouveau type d'entree `tool_invocation`
  - soit un payload chat enrichi qui reference explicitement un run

Payload minimal recommande pour une invocation outil:

```json
{
  "toolCallId": "string",
  "executionId": "string",
  "toolId": "string",
  "toolName": "string",
  "origin": "provider-native|app-native|user-custom|legacy-fallback",
  "status": "started|completed|failed|cancelled|timed_out",
  "attempt": 1,
  "maxAttempts": 3,
  "retryable": true,
  "failureKind": "validation|build|runtime|timeout|policy|unknown",
  "startedAt": "ISO date",
  "finishedAt": "ISO date",
  "runner": "python-native|python-custom|typescript-custom|provider",
  "workspaceId": "string|null",
  "input": {},
  "output": {},
  "stdout": "string",
  "stderr": "string",
  "artifacts": []
}
```

### 8.5 Recommandations sur abandon/retry

Pour rendre le systeme pilotable, il faut des flags exploitables et indexables.

Flags recommandes:

- `retryable`
- `failureKind`
- `timedOut`
- `cancelledByUser`
- `policyBlocked`
- `validationFailed`
- `buildRequired`
- `provisionRequired`
- `runner`
- `origin`

Champs retry recommandes:

- `attempt`
- `maxAttempts`
- `nextRetryAt`
- `backoffMs`
- `lastRetryReason`

### 8.6 Ce qu'un futur agent doit eviter

- ne pas melanger les erreurs provider et sandbox sous un message texte unique
- ne pas perdre la correlation entre message chat et run detaille
- ne pas stocker seulement du texte alors que le systeme possede deja des metadonnees structurees utiles


## 9. Cas particulier important: la couche legacy fallback

`services/agentToolExecution.ts` appelle le sandbox si une vraie fonction catalogue est reconnue.

Sinon il bascule sur `utils/toolExecutor.ts`, qui gere encore:

- des mini tools TypeScript frontend (`get_weather`, `get_current_time`)
- une voie legacy `*_py` vers `POST /api/execute-python-tool`

Cette route legacy existe encore dans `backend/src/server.ts` et passe par `backend/src/pythonExecutor.ts` + `WHITELISTED_PYTHON_TOOLS`.

Implications:

- cette voie ne suit pas la cible Tools V2 complete
- elle contourne en partie le modele workspace/versioning moderne
- elle doit etre traitee comme dette technique de convergence, pas comme modele d'extension futur


## 10. Revue de code et nettoyage effectue

### 10.1 Nettoyage effectue dans cette passe

Nettoyage sur `components/V2AgentNode.tsx`:

- suppression d'un import inutilise
- suppression de setters du runtime store lus mais jamais utilises
- suppression d'un handler mort `handleImageClick`

Nettoyage sur `backend/python/runner.py`:

- suppression d'un import Python inutilise `SecurityGuard`

Validation realisee:

- diagnostics statiques sans erreur sur `components/V2AgentNode.tsx`
- diagnostics statiques sans erreur sur `backend/python/runner.py`
- test cible valide: `tests/components/V2AgentNode.agentloop.test.tsx`

### 10.2 Findings de revue de code a garder en tete

Finding A - dualite legacy / V2 encore forte

- `useFunctionStore` lit le catalogue via `/api/tools`
- `services/toolRepository.ts` ecrit maintenant lui aussi via `/api/tools`
- `/api/functions` reste expose uniquement comme facade de compatibilite legacy, delegatee au meme `ToolCommandService`
- `GET /api/functions` continue de lire via `ToolReadAdapterService.listLegacyFunctions`, donc la read side legacy n'est deja plus une source d'autorite autonome
- la dette residuelle n'est donc plus la divergence de write policy, mais la coexistence de deux facades et de deux shapes UI transitoires

Finding B - journal outil insuffisamment structure

- `user_tool_runs` et `agent_journals` ne portent pas encore la meme richesse semantique
- `POST /api/workflows/:workflowId/instances/:agentInstanceId/journal` delegue maintenant vers `JournalService`, avec preservation du payload top-level legacy utilise par l'hydratation actuelle
- la deduplication backend regarde toujours `payload.messageId`, mais ce champ reste insuffisamment formalise dans les contrats types
- le flux runtime partage desormais un helper commun qui emet `chat` et `tool_invocation` avec `messageId` et `executionId`
- la faiblesse residuelle est donc surtout semantique, de typage strict et de projection hydratee, plus un bypass de service ni un chemin `/content`

Finding C - `FullscreenChatModal` reste plus legacy que `V2AgentNode`

- le runtime live a encore une meilleure semantique des blocs outil que l'historique plein ecran
- `useAgentChat` et `FullscreenChatModal` n'ecrivent plus via `/content` et reutilisent la persistance journal partagee
- la seam legacy residuelle n'est plus le transport `/content`, mais la projection hydratee et le shim de compatibilite `chat.toolCalls`

Finding F - seam legacy `/content` desormais reduite a de la compatibilite de lecture

- le chemin d'ecriture `/content` n'est plus la voie d'autorite pour `useAgentChat`
- `hooks/useAgentChat.ts` et `hooks/useAgentJournalPersistence.ts` convergent maintenant sur la meme ecriture journal que `V2AgentNode`
- la dette restante est limitee a la forme hydratee legacy attendue par certaines surfaces UI et a la preservation minimale de `chat.toolCalls`
- un futur lot ne doit donc pas "retablir" `/content`, mais finir de supprimer les projections legacy cote lecture seulement

Finding D - verification syntaxique TypeScript incomplete

- `backend/src/services/sandbox.service.ts` documente explicitement un "TypeScript syntax check stub"
- la verification Python est reelle via compilation Python
- la verification TS reste un point d'amelioration concret pour l'editeur Phil

Finding E - couche fallback historique encore presente

- `utils/toolExecutor.ts` et `/api/execute-python-tool` restent utiles pour compatibilite
- mais ils ne doivent pas devenir la reference pour de nouvelles fonctions


## 11. Preconisations d'architecture

### 11.1 Priorite 1 - converger vers un write model unique

Objectif:

- faire de `user_tools` la source canonique de definition, versioning, readiness et acces
- releguer `user_functions` a une couche de migration puis la retirer proprement

Conditions avant migration:

- route de creation/mise a jour Tools V2 complete
- migration de tous les champs utiles du legacy model
- compatibilite read/write testee sur Phil + Archi + runtime

### 11.2 Priorite 2 - creer une vraie semantique de journal d'outils

Objectif:

- relier explicitement le chat a l'execution outil
- permettre replay, audit, retry, KPI de fiabilite

Action recommandee:

- ajouter un type `tool_invocation` ou enrichir fortement `chat`
- stocker la reference `executionId`
- indexer `status`, `failureKind`, `origin`, `runner`, `workspaceId`

### 11.3 Priorite 3 - aligner runtime live et historique hydrate

Objectif:

- rendre `FullscreenChatModal` aussi fidele que `V2AgentNode`
- conserver la meme UX de blocs tool expandable apres rechargement

### 11.4 Priorite 4 - fermer la dette fallback legacy

Objectif:

- encapsuler puis decommissionner progressivement `utils/toolExecutor.ts`
- basculer les vrais cas utiles vers le sandbox moderne ou vers des provider tools clairement identifies

### 11.5 Priorite 5 - renforcer l'editeur Phil

Objectif:

- fournir une vraie validation syntaxique TS
- expliciter les erreurs de build/provision/runtime par type
- mieux exposer la relation entre version, workspace et artefacts


## 12. Plan sain de convergence write path + journaux

### 12.0 Etat apres lot de stabilisation valide

Etat courant confirme:

- la write policy backend est maintenant centralisee par `ToolCommandService`
- `/api/tools` expose les commandes canoniques create/update/delete/toggle
- `services/toolRepository.ts` ecrit desormais via `/api/tools`
- `/api/functions` reste une facade legacy de compatibilite, delegatee au meme service applicatif
- la route `/journal` delegue maintenant vers `JournalService`
- `useAgentChat` n'ecrit plus via `/content` et reutilise la meme persistance journal partagee que `V2AgentNode`
- la forme persisted legacy du payload journal a ete preservee pour ne pas casser l'hydratation actuelle
- les TNR cibles de ce lot sont au vert: `legacy-tools-coexistence.test.ts`, `journal.service.test.ts`, `agent-instance-journal.routes.test.ts`

### 12.1 Write path Tools V2 - cible recommandee

Constat decisionnel:

- le frontend charge deja le catalogue depuis `/api/tools`
- le frontend cree/modifie/supprime maintenant aussi via `/api/tools`
- `/api/functions` lit deja un read model projete depuis la couche tools et delegue ses commandes au meme service commun
- la write policy est donc deja unifiee, mais la coexistence d'une facade legacy subsiste encore

Decision recommande:

- faire de `user_tools` la seule source d'autorite pour les commandes de creation, mise a jour, suppression, activation et versioning
- conserver `/api/functions` uniquement comme facade de compatibilite temporaire
- faire deleguer `/api/functions` et `/api/tools` au meme service applicatif de commande, au lieu de laisser coexister plusieurs points de decision

Structure cible minimale:

- `ToolCommandService` pour les commandes create/update/delete/toggle
- `ToolReadAdapterService` conserve pour les projections legacy tant que Phil et certaines surfaces UI n'ont pas fini la migration
- un DTO canonique de retour cote tools, puis un mapping legacy seulement aux frontieres qui en ont encore besoin

Plan de migration recommande:

1. Deja fait: introduire un `ToolCommandService` backend qui encapsule les regles aujourd'hui porteuses pour les fonctions custom editables.
2. Deja fait: ajouter les endpoints canoniques `POST /api/tools`, `PUT/PATCH /api/tools/:id`, `DELETE /api/tools/:id`, `PATCH /api/tools/:id/toggle` sans supprimer `/api/functions`.
3. Deja fait: faire deleguer `/api/functions` vers ce meme service puis re-projeter en DTO legacy, afin d'avoir une seule write policy mais deux facades temporaires.
4. Deja fait: basculer `services/toolRepository.ts` pour que `createFunction`, `updateFunction`, `deleteFunction` et `toggleFunction` appellent `/api/tools`.
5. En cours: garder `mapToolToUserFunction()` comme shim de lecture/UI transitoire, pas comme contrat d'ecriture.
6. Deja fait: aligner le run manuel sandbox de Phil sur une selection canonique de tool via `toolSelection`, sans rendre `functionId` obligatoire.
7. Deja fait: faire accepter ce contrat par `POST /api/sandbox/run` tout en preservant temporairement le fallback legacy `functionId`.
8. Apres validation de parite sur Phil, selection agent, builds, readiness et runtime live, retrograder `user_functions` en miroir de compatibilite puis supprimer son autorite d'ecriture.

Risques anti-regression a respecter:

- ne pas faire de big bang route par route sans service commun
- ne pas casser les callers qui attendent encore le shape legacy `UserFunction`
- conserver le fallback backend `functionId` tant que tous les callers n'ont pas bascule sur `toolSelection`
- ne pas supprimer la projection legacy avant d'avoir une validation TNR sur Phil, AgentConfiguration et runtime agent

### 12.2 Journal des tool calls - structuration SOLID recommandee

Constat decisionnel:

- `user_tool_runs` est deja la verite d'execution detaillee
- `agent_journals` reste une verite conversationnelle tres partielle
- la route journal delegue maintenant vers `JournalService`, mais la projection conversationnelle reste encore trop pauvre semantiquement
- la deduplication et les types de payloads ne sont pas assez explicites pour supporter proprement outil start/done/retry/hydratation

Decision recommande:

- conserver `user_tool_runs` comme source d'autorite d'execution
- faire d'`agent_journals` une projection conversationnelle structuree, referencee explicitement sur les runs
- centraliser toute ecriture journal dans `JournalService`, puis decomposer en sous-ecrivains specialises si necessaire
- ajouter un type de journal de premiere classe `tool_invocation` plutot que continuer a surcharger `chat.toolCalls`

Responsabilites cibles:

- `JournalService`: facade d'orchestration et point d'entree unique pour toutes les ecritures journal
- `ChatJournalWriter`: messages conversationnels user/agent/system/tool_result legers
- `ToolInvocationJournalWriter`: etats `started|completed|failed|timed_out|cancelled` relies a un `executionId`
- `UserToolRunService`: execution authority, transitions d'etat, timings, stdout/stderr, resource usage, artifacts
- `bosRunProjectionService`: hydratation UI par jointure journal conversationnel + run detaille

Payload minimal recommande pour `tool_invocation`:

- `toolCallId`
- `executionId`
- `toolId`
- `toolName`
- `origin`
- `runner`
- `workspaceId`
- `versionTag`
- `status`
- `attempt`
- `maxAttempts`
- `retryable`
- `failureKind`
- `startedAt`
- `finishedAt`
- `input`
- `outputSummary`
- `artifacts`
- `sourceMessageId`
- `resultMessageId`

Indexation recommandee des journaux outilles:

- `agentInstanceId + timestamp`
- `agentInstanceId + type + timestamp`
- `payload.executionId`
- `payload.toolCallId`
- `payload.status + timestamp`

Plan de migration recommande:

1. Etendre `JournalEntryType` et `types/persistence.ts` avec `tool_invocation` et des payloads strictement types.
2. Deja fait: faire deleguer la route `/journal` vers `JournalService` tout en preservant le payload legacy attendu par l'hydratation actuelle.
3. Formaliser `messageId`, `toolCallId` et `executionId` dans les contrats frontend/backend, au lieu de les laisser implicites dans `payload: any`.
4. Etendre `useJournalQueue` pour supporter `tool_invocation` avec une cle de dedup explicite.
5. Emettre des entrees `tool_invocation` au `tool_call_start` et au `tool_call_done` depuis le flux runtime/agent.
6. A l'hydratation, charger d'abord les journaux, puis completer les blocs outils via `executionId` depuis `user_tool_runs` comme le fait deja la projection Bos.
7. Une fois cette projection stable, reduire le champ legacy `chat.toolCalls` a un role de compatibilite minimale.

Risques anti-regression a respecter:

- ne pas dupliquer integralement les outputs riches du run dans plusieurs collections sans raison
- ne pas casser le rendu live actuel de `V2AgentNode` en voulant normaliser trop tot l'historique
- ne pas inventer une deuxieme logique de dedup frontend differente de celle backend
- ne pas faire porter au seul chat la responsabilite d'audit d'execution

### 12.3 Todo detaillee des 2 prochaines etapes naturelles

Etape naturelle 1 - introduire `tool_invocation` sans doubler la verite d'execution:

1. Ajouter des TNR backend et front cibles qui verrouillent le payload attendu, la dedup et l'hydratation des blocs outils.
2. Formaliser `messageId`, `toolCallId` et `executionId` dans les contrats types partages avant toute emission runtime.
3. Etendre `JournalEntryType`, `types/persistence.ts` et `JournalService` avec un payload `tool_invocation` strictement type.
4. Emettre `tool_invocation` sur les transitions runtime minimales `started|completed|failed`, en reliant chaque entree a `executionId`.
5. Etendre `useJournalQueue` et la logique de dedup front pour accepter `tool_invocation` sans dupliquer la regle backend.
6. Hydrater `V2AgentNode` puis `FullscreenChatModal` en joignant `agent_journals` et `user_tool_runs` via `executionId`.
7. Conserver `chat.toolCalls` uniquement comme compatibilite transitoire tant que toutes les surfaces n'ont pas bascule.

Etape naturelle 2 - fermer la seam legacy de lecture apres convergence du run manuel Phil:

1. Garder `toolSelection` comme contrat canonique commun a Phil et au runtime agent.
2. Preserver seulement le fallback backend `functionId` tant que les derniers callers legacy n'ont pas disparu.
3. Continuer a verifier que les workspaces, artifacts et version refs affiches par Phil correspondent au meme tool que celui execute par le runtime live.
4. Reducer les projections de lecture legacy autour de `chat.toolCalls` et de l'ancien shape hydrate sans reintroduire `/content`.
5. Garder des TNR de non-regression sur le run manuel TS/Python, les artifacts workspace et les erreurs de build/provision associees.


## 13. Regles pratiques pour un futur agent de code

### 13.1 Avant toute modification

- identifier si la fonction touche le design domain, le runtime domain, ou les deux
- verifier si la surface legacy `/api/functions` est encore impliquee
- verifier si la lecture passe deja par `/api/tools`
- verifier si le changement impacte le workspace, le build ou le journal

### 13.2 Si vous ajoutez un nouveau type de fonction

- definir son `origin`
- definir sa strategie de stockage
- definir sa strategie d'execution
- definir sa strategie de trace et journal
- definir si elle doit passer par `FunctionSelector`

### 13.3 Si vous modifiez les messages chat outil

- ne pas casser `ToolCallBlock`
- ne pas casser la deduplication `tool_result`
- ne pas perdre l'affichage immediat du `tool_call_start`
- verifier `V2AgentNode` et `FullscreenChatModal`

### 13.4 Si vous modifiez le runtime sandbox

- verifier les trois modes d'execution: `python-native`, `python-custom`, `typescript-custom`
- verifier les workspaces et les version refs
- verifier les artifacts et `user_tool_runs`


## 14. Resume executif

Le systeme actuel est deja capable de:

- distinguer un appel outil visuel de la reponse LLM
- executer des fonctions custom utilisateur dans un sandbox persistant
- executer des fonctions natives applicatives hors workspace utilisateur
- melanger tools provider natifs et fonctions applicatives selectionnees

Les deux vraies frontieres a respecter pour la suite sont:

1. la frontiere entre catalogue/edition legacy et registre runtime V2
2. la frontiere entre persistance conversationnelle et persistance d'execution outil

Si un futur agent respecte ces deux frontieres, il pourra faire evoluer la plateforme sans regression majeure.