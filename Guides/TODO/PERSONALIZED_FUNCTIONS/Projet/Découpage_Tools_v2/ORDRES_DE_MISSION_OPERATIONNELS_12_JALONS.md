# ORDRES DE MISSION OPERATIONNELS - 12 JALONS TOOLS PLAN 1

Ce document fournit les 12 ordres de mission directement exploitables pour l'implementation du Plan 1 corrige.

Regles:

1. executer les jalons dans l'ordre
2. ne pas demarrer un jalon si la condition de sortie du precedent n'est pas atteinte
3. ne jamais deriver des recommandations sandbox 1 et 2
4. ne jamais presenter gVisor comme choix retenu du projet
5. Docker durci = socle multiplateforme de dev/test, rootless quand disponible, et Firecracker = cible de securite de production a preparer des le jalon 6

---

## Jalon 1 - Ordre de mission pour `planificateur`

```text
Mission: geler le cadrage du Plan 1 Tools a partir des seules recommandations sandbox 1 et 2.

Tu dois produire un cadrage d'execution sans derive. Le document `TOOLS_V2.md` n'est pas la source directrice de cette phase. Le plan doit etre relu uniquement a travers le prisme workspace persistant + build separe + sandbox ephemere.

Objectif principal:
- figer les invariants du Plan 1
- confirmer Docker durci comme base MVP dev/test, avec rootless quand l'environnement Linux le permet
- confirmer Firecracker comme cible de securite de production a preparer des le chantier runtime
- exclure gVisor comme choix de plan
- produire l'ordre d'execution anti-regression

Fichiers a analyser obligatoirement:
- backend/src/models/UserFunction.model.ts
- backend/src/services/sandbox.service.ts
- backend/src/pythonExecutor.ts
- backend/src/routes/functions.routes.ts
- backend/src/routes/sandbox.routes.ts
- components/PhilFunctionsPage.tsx
- components/FunctionEditorTab.tsx
- components/FunctionSelector.tsx
- backend/src/services/function.service.ts
- backend/src/routes/user-workspace.routes.ts
- stores/useFunctionStore.ts
- services/llm/AgentLoop.ts
- components/modals/AgentFormModal.tsx
- components/modals/AgentConfigurationModal.tsx

Ce que tu dois produire:
- une matrice legacy -> cible
- le sequenceur des phases 0 a 5 du Plan 1
- les risques de regression
- les impacts backend et frontend
- les dependances inter-jalons

Interdictions:
- ne pas repartir de TOOLS_V2.md comme source principale
- ne pas presenter gVisor comme choix retenu
- ne pas proposer de conteneur persistant par utilisateur

Condition de sortie:
- tous les autres agents peuvent travailler sans ambiguite de perimetre ni de decision technique
```

---

## Jalon 2 - Ordre de mission pour `mongo-persistance`

```text
Mission: definir la BDD cible minimale du Plan 1.

Tu dois poser un modele de persistence conforme aux recommandations: workspace persistant, tools versionnes, runs persistants et metadata de secrets. Le legacy `user_functions` reste une source a migrer, pas la cible finale.

Fichiers a analyser obligatoirement:
- backend/src/models/UserFunction.model.ts
- backend/src/models/UserSettings.model.ts
- backend/src/models/AgentPrototype.model.ts
- backend/src/models/AgentInstance.model.ts
- backend/src/migrations/004_tools_v2_function_registry.ts
- backend/src/seeds/nativeFunctions.seed.ts

Collections minimales a poser:
- workspaces
- user_tools
- user_tool_runs
- secrets_metadata

Ce que tu dois produire:
- schemas Mongoose minimaux
- index critiques
- references de rattachement workspace/projet/workflow
- conventions tool/version utilisables par les agents

Interdictions:
- ne pas imposer de migration big bang
- ne pas conserver user_functions comme modele final

Condition de sortie:
- la BDD cible minimale est figee et branchable par les autres jalons
```

---

## Jalon 3 - Ordre de mission pour `mongo-persistance`

```text
Mission: verrouiller la persistence des runs et la migration additive legacy -> cible.

Tu dois definir comment un run est cree, stocke, relu et rattache a un tool/version. Tu dois aussi definir comment les references existantes migrent sans casser l'application.

Base d'analyse obligatoire:
- schemas du jalon 2
- usages Phil et Bos des executions
- references tools dans prototypes et instances
- services/llm/AgentLoop.ts
- backend/src/routes/user-workspace.routes.ts
- mecanisme actuel de dual-write legacy -> cible sur create, update, toggle et delete
- synchronisation de demarrage `user_functions -> user_tools` et future inversion d'autorite

Ce que tu dois produire:
- schema final user_tool_runs
- machine d'etat de run
- plan de migration additive depuis user_functions
- conventions de reference tool/version pour agents et workflows
- garde-fou explicite pour la robustesse du dual-write: transaction Mongo si applicable, sinon mecanisme de reparation compensatoire documente pour update, toggle et delete
- regle explicite de bornage de la synchronisation au demarrage pour qu'elle cesse d'ecraser l'historique de versions de `user_tools` une fois le registre cible devenu autorite

Interdictions:
- ne pas laisser de statut de run ambigu
- ne pas dependre d'un cache frontend pour l'historique
- ne pas supposer que la coexistence Jalon 2 est deja robuste en production tant que le dual-write de mutation n'est pas durci
- ne pas autoriser la synchronisation de demarrage a reecrire le payload metier complet de `user_tools` apres inversion d'autorite

Condition de sortie:
- les runs sont persistables, rehydratables et auditables
- la strategie de migration des runs integre explicitement le durcissement du dual-write et la limitation de la synchronisation de demarrage
```

---

## Jalon 4 - Ordre de mission pour `codeur-specialiste`

```text
Mission: implementer WorkspaceManager et la structure filesystem cible.

Tu dois separer proprement workspace, build et output. Le workspace est persistant, mais il ne doit jamais etre l'environnement d'execution.

Avant d'ouvrir le chantier principal, tu dois traiter un sas de stabilisation J4-A. Ce sas est obligatoire pour eviter qu'un chantier filesystem transverse ne se construise sur un contrat d'autorite ou d'hydratation encore ambigu.

J4-A - stabilisation obligatoire avant implementation large:
- coder le bornage de la synchronisation de demarrage dans `backend/src/services/databaseInit.ts`
- rendre explicite une logique par phase: `legacy-authority` tant que `user_functions` reste la facade publique, puis `repair-only` apres inversion d'autorite
- interdire que la synchronisation de demarrage reecrive les champs metier cibles de `user_tools` quand le registre cible devient source de verite
- verifier que `backend/src/utils/workspaceSnapshot.ts`, `backend/src/routes/user-workspace.routes.ts` et `hooks/useWorkspaceHydration.ts` conservent un contrat d'hydratation non regressif apres introduction de la projection `toolRuns`
- tracer explicitement que le `runner` renseigne depuis `pythonExecutor` reste une dette de modelisation runtime non bloquante pour Jalon 4 et ne doit pas deriver en changement de schema opportuniste ici

Analyse obligatoire:
- backend/src/models/UserSettings.model.ts
- usages actuels des chemins fonctionnels
- structure actuelle des repertoires tools
- backend/src/routes/user-workspace.routes.ts
- backend/src/services/databaseInit.ts
- backend/src/utils/workspaceSnapshot.ts
- hooks/useWorkspaceHydration.ts
- backend/src/services/userToolRun.service.ts

Fichiers et zones techniques a considerer explicitement:
- `backend/src/services/databaseInit.ts` pour la politique de synchronisation de demarrage et la phase d'autorite
- `backend/src/routes/user-workspace.routes.ts` pour eviter la dispersion de logique workspace dans la route
- `backend/src/utils/workspaceSnapshot.ts` comme facade de projection backend vers le frontend
- `hooks/useWorkspaceHydration.ts` comme consommateur critique du snapshot
- futurs points d'integration `WorkspaceManager` / `WorkspacePathResolver` pour centraliser tous les chemins code, manifest, build et output

Design patterns attendus:
- Service Layer: `WorkspaceManager` porte l'orchestration metier du workspace
- Value Object / Resolver: `WorkspacePathResolver` derive les chemins de facon deterministe et testable
- Facade / Anti-Corruption Layer: les routes et services legacy passent par le contrat workspace au lieu de recalculer des chemins localement
- Strategy ou Policy Object pour la synchronisation de demarrage selon la phase d'autorite
- Single Source of Truth: aucune route ou hook ne doit devenir autorite concurrente sur les chemins ou la source runtime

Ce que tu dois produire:
- WorkspaceManager
- WorkspacePathResolver
- conventions code / manifests / build / output
- creation idempotente du workspace
- garde-fou de synchronisation de demarrage phase-aware dans `databaseInit.ts`
- contrat d'hydratation documente implicitement par le code entre `workspaceSnapshot` et `useWorkspaceHydration`
- jeu minimal de TNR backend/frontend couvrant le snapshot workspace et la lecture additive de `toolRuns`

Interdictions:
- ne pas melanger workspace et sandbox de run
- ne pas disperser la logique de chemins
- ne pas profiter de Jalon 4 pour faire une inversion d'autorite implicite
- ne pas modifier opportunistement le schema `user_tool_runs` pour resoudre la dette `runner` si cela n'est pas necessaire au contrat workspace
- ne pas introduire un contrat d'hydratation frontend different entre route backend, snapshot et hook

Condition de sortie:
- le backend dispose d'un contrat workspace unique et stable
- la synchronisation de demarrage est bornee par phase et ne peut plus ecraser l'historique cible apres inversion d'autorite
- l'hydratation workspace reste compatible avec la projection additive de `user_tool_runs`
- un socle de TNR existe sur transitions de runs et hydratation workspace pour prevenir les regressions transverses
```

---

## Jalon 5 - Ordre de mission pour `codeur-specialiste`

```text
Mission: mettre en place le BuildService separe du run.

Tu dois permettre la preparation d'un tool sans utiliser le run comme environnement de build. Les dependances se gerent hors execution normale.

Analyse obligatoire:
- manifests Node.js et Python
- besoins de build et d'artefacts
- outputs necessaires dans le workspace
- types/function.types.ts
- stores/useFunctionStore.ts

Ce que tu dois produire:
- BuildService
- workflow de build isole
- stockage des outputs de build
- garde-fous contre npm install ou pip install a chaud dans le run normal

Interdictions:
- ne pas installer les dependances dans l'execution normale du tool
- ne pas fusionner build et run dans le meme cycle

Condition de sortie:
- un tool peut etre prepare hors execution utilisateur
```

---

## Jalon 6 - Ordre de mission pour `codeur-specialiste`

```text
Mission: industrialiser le runtime MVP et l'installation.

Tu dois poser l'installation et la verification des runtimes comme une partie de l'architecture. Le MVP repose sur des sandboxes Docker durcies, rootless quand l'hote Linux le permet, Node.js et Python separes, Debian slim debuggable par defaut. Tu dois aussi preparer des cette phase le port runtime qui permettra le passage a Firecracker sans rupture.

Analyse obligatoire:
- prerequis Docker rootless sur Linux et limites structurelles de Docker Desktop sur Windows/macOS
- images runtime Node.js et Python
- verification health avant run
- backend/src/routes/index.ts
- besoins de debug et d'inspection de containers executant du code arbitraire

Ce que tu dois produire:
- RuntimeHealthService
- scripts setup, check et rebuild runtime
- images sandbox Debian slim Node.js et Python, coherentes, debuggables et durcies
- diagnostic exploitable par backend et UI avec mode, securityLevel, executionReady et warning dev-only
- port SandboxRunner et SandboxRunnerFactory poses des cette phase
- DockerSandboxRunner durci, meme si l'orchestrateur complet est finalise au jalon 7

Interdictions:
- ne pas utiliser Alpine comme standard sandbox
- ne pas annoncer un runtime ready sans verification reelle
- ne pas utiliser distroless comme reflexe de securite sur les images sandbox d'execution arbitraire si cela casse le debug et ne traite pas l'isolation reelle
- ne pas presenter Docker Desktop comme une securite de production

Condition de sortie:
- le runtime MVP est installable et verifiable
- le runtime expose explicitement les modes dev-only vs securite de production
- le jalon 7 peut brancher l'orchestrateur sur un port deja stable et prepare pour Firecracker
```

---

## Jalon 7 - Ordre de mission pour `codeur-specialiste`

```text
Mission: implementer l'orchestrateur d'execution ephemere du MVP.

Tu dois remplacer le coeur d'execution legacy par un orchestrateur gouverne. Chaque invocation doit lancer une sandbox ephemere, appliquee aux limites de ressources et detruite apres run. Ce jalon doit utiliser le port pose au jalon 6, brancher DockerSandboxRunner comme fallback multiplateforme explicite, et preparer concretement le runner Firecracker au lieu de le laisser en dette post-projet.

Analyse obligatoire:
- backend/src/services/sandbox.service.ts
- backend/src/pythonExecutor.ts
- points d'appel Phil et workflow
- services/llm/AgentLoop.ts
- SandboxRunnerFactory, DockerSandboxRunner et preconditions Firecracker/KVM

Ce que tu dois produire:
- ExecutionOrchestrator
- port SandboxRunner
- SandboxRunnerFactory
- DockerSandboxRunner avec quotas, timeouts, network none par defaut, tmpfs, cap-drop et no-new-privileges
- preparation FirecrackerRunner avec detection de disponibilite Linux/KVM et point de branchement testable
- collecte logs, outputs et persistence des runs

Interdictions:
- ne pas laisser les routes lancer des subprocess directs
- ne pas coder Docker comme verrou irreversible empechant Firecracker ensuite
- ne pas ouvrir le reseau par defaut
- ne pas releguer Firecracker a une simple promesse documentaire sans integration preparatoire reelle

Condition de sortie:
- chaque run passe par une sandbox ephemere gouvernee et persistante
- le fallback Docker vs Firecracker est explicite, observable et testable
```

---

## Jalon 8 - Ordre de mission pour `codeur-specialiste`

```text
Mission: maintenir la compatibilite backend pendant la migration.

Tu dois faire evoluer les routes legacy vers des facades de transition. Le frontend ne doit pas etre casse pendant le basculement vers le nouveau modele.

Analyse obligatoire:
- backend/src/routes/functions.routes.ts
- backend/src/routes/sandbox.routes.ts
- appels frontend existants Phil, Archi et Bos
- backend/src/routes/user-workspace.routes.ts
- stores/useFunctionStore.ts

Ce que tu dois produire:
- facades de compatibilite legacy
- routes workspaces, tools et runs
- cartographie de deprecation progressive
- exposition explicite des warnings runtime dev-only dans les facades et contrats frontend

Interdictions:
- ne pas faire de cutover big bang
- ne pas laisser deux contrats contradictoires faire autorite

Condition de sortie:
- le frontend continue de fonctionner pendant la migration backend
```

---

## Jalon 9 - Ordre de mission pour `designer_ux`

```text
Mission: rebrancher Phil sur la nouvelle architecture du Plan 1.

Tu dois conserver l'UX validee de Phil tout en remplaçant la source de verite et le flux d'execution. Phil doit parler au registry, au workspace et aux runs persistants.

Analyse obligatoire:
- components/PhilFunctionsPage.tsx
- components/FunctionEditorTab.tsx
- services frontend lies a l'edition et au test des tools
- stores/useFunctionStore.ts
- types/function.types.ts

Ce que tu dois produire:
- edition branchee sur user_tools
- test branche sur user_tool_runs
- affichage des logs, statuts et outputs

Interdictions:
- ne pas garder le sandbox legacy comme coeur cible
- ne pas casser le parcours principal editer -> tester

Condition de sortie:
- Phil fonctionne sur la nouvelle architecture sans regression majeure
```

---

## Jalon 10 - Ordre de mission pour `designer_ux`

```text
Mission: rebrancher Archi et Bos sur le nouveau modele tools/runs.

Tu dois faire en sorte que la selection des tools et la lecture des executions s'appuient sur la nouvelle source de verite backend.

Analyse obligatoire:
- components/FunctionSelector.tsx
- composants Bos lisant les tool calls et l'historique
- references tools dans prototypes et instances
- components/modals/AgentFormModal.tsx
- components/modals/AgentConfigurationModal.tsx
- types.ts
- services/llm/FunctionCallingPromptBuilder.ts

Ce que tu dois produire:
- selection tool/version depuis le nouveau registry
- Bos alimente par user_tool_runs
- rehydratation des runs apres refresh

Interdictions:
- ne pas reconstruire l'historique uniquement depuis le frontend
- ne pas laisser user_functions piloter Archi

Condition de sortie:
- Archi et Bos reposent sur la nouvelle persistence
```

---

## Jalon 11 - Ordre de mission pour `testeur`

```text
Mission: produire le go/no-go du Plan 1.

Tu dois couvrir la non-regression applicative, la securite minimale du runtime Docker durci, et la preparation effective du chemin Firecracker. Le verdict doit porter sur backend, frontend, runs ephemeres, migration additive et charge de base.

Analyse obligatoire:
- suites backend workflows, auth, persistence et routes
- suites frontend Phil, Archi, Bos, hydration
- preconditions runtime et execution concurrente
- compatibilite AgentLoop et stores frontend

Ce que tu dois produire:
- matrice TNR du Plan 1
- tests sur user_tools et user_tool_runs
- tests de charge et d'escape attempts de base
- verdict go/no-go documente
- preuve que Docker Desktop est borne comme dev-only et que le chemin Firecracker est reellement preparatoire

Interdictions:
- ne pas valider le plan sans tests sur le runtime Docker durci et sans verification du comportement Linux rootless quand l'environnement le permet
- ne pas se limiter a des tests unitaires isoles

Condition de sortie:
- le basculement MVP est valide ou bloque sur preuves techniques
```

---

## Jalon 12 - Ordre de mission pour `traducteur`

```text
Mission: stabiliser la terminologie des documents et de l'implementation.

Tu dois aligner le vocabulaire technique avec le nouveau plan: workspace, build, run, runtime, registry, output, health, Firecracker cible. Toute terminologie issue de l'ancien cadrage erroné doit etre purgee.

Analyse obligatoire:
- plan source
- DTOs et labels exposes
- documentation derivee du Plan 1
- types/function.types.ts
- types.ts
- services/llm/AgentLoop.ts

Ce que tu dois produire:
- glossaire stable
- harmonisation des libelles critiques
- suppression des termes ambigus ou faux

Interdictions:
- ne pas laisser coexister plusieurs termes pour la meme realite
- ne pas reintroduire d'anciens choix faux comme gVisor retenu ou conteneur persistant utilisateur

Condition de sortie:
- toute la documentation d'implementation parle le meme langage
```
