# ORDRES DE MISSION - PLAN 1 TOOLS PAR AGENT

> Date: 17 mars 2026
> Source directrice unique: `Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_1_ARCHITECTURE_BDD_SANDBOX_INSTALLATION.md`
> Sources de verite de niveau superieur: `RECOMMANDATION_SANDBOX_1.md` et `RECOMMANDATION_SANDBOX_2.md`
> Contrainte absolue: zero regression sur Phil, Archi, Bos, les workflows et l'execution existante

---

## 1. Objet du decoupage

Ce document distribue le Plan 1 entre les agents disponibles.

Agents concernes:

1. `planificateur`
2. `mongo-persistance`
3. `codeur-specialiste`
4. `designer_ux`
5. `testeur`
6. `traducteur`

Le decoupage doit rester conforme aux decisions suivantes:

1. workspace persistant par utilisateur/projet ou workflow
2. sandbox ephemere par execution
3. build separe du run
4. Docker durci comme socle multiplateforme de dev/test, rootless quand l'hote Linux le permet
5. Firecracker retenu comme cible de securite de production a preparer des le jalon 6, pas a repousser apres le reste du developpement
6. Debian slim debuggable retenu pour les images sandbox, Alpine exclu comme standard et distroless exclu par defaut pour l'execution de code arbitraire
7. gVisor non retenu pour ce plan

---

## 2. Architecture logique a faire emerger

### 2.1 Couches obligatoires

1. Presentation Layer
   - routes Express
   - DTOs API
   - shells UI Phil, Archi, Bos

2. Application Layer
   - WorkspaceManager
   - ToolRegistry
   - BuildService
   - ExecutionOrchestrator
   - RuntimeHealthService

3. Domain Layer
   - workspaces
   - user_tools
   - user_tool_runs
   - policies minimales
   - contrat SandboxRunner

4. Infrastructure Layer
   - repositories Mongoose
   - DockerSandboxRunner
   - SandboxRunnerFactory
   - FirecrackerRunner prepare des J6/J7
   - file system workspace
   - images runtime Node.js et Python
   - websocket et observabilite

### 2.2 Patterns a imposer

1. Ports and Adapters pour isoler l'orchestrateur du runner
2. Facade Pattern pour maintenir la compatibilite des routes legacy
3. Repository Pattern pour la persistence MongoDB
4. State Pattern pour le cycle de vie des runs
5. Service Layer pour workspace, build, runtime health et execution

---

## 3. Cartographie des fichiers impactes

### 3.1 Backend prioritaire

1. `backend/src/models/UserFunction.model.ts`
2. `backend/src/models/UserSettings.model.ts`
3. `backend/src/models/AgentPrototype.model.ts`
4. `backend/src/models/AgentInstance.model.ts`
5. `backend/src/services/sandbox.service.ts`
6. `backend/src/pythonExecutor.ts`
7. `backend/src/routes/functions.routes.ts`
8. `backend/src/routes/sandbox.routes.ts`
9. `backend/src/services/function.service.ts`
10. `backend/src/routes/user-workspace.routes.ts`
11. `backend/src/routes/index.ts`
12. `backend/src/migrations/004_tools_v2_function_registry.ts`
13. `backend/src/seeds/nativeFunctions.seed.ts`

### 3.2 Frontend a rebrancher

1. `components/PhilFunctionsPage.tsx`
2. `components/FunctionEditorTab.tsx`
3. `components/FunctionSelector.tsx`
4. composants Bos lisant les tool calls et les runs
5. `stores/useFunctionStore.ts`
6. `types/function.types.ts`
7. `components/modals/AgentFormModal.tsx`
8. `components/modals/AgentConfigurationModal.tsx`
9. `types.ts`
10. `services/llm/AgentLoop.ts`
11. `services/llm/FunctionCallingPromptBuilder.ts`
12. `backend/src/utils/workspaceSnapshot*` et la rehydratation associee

---

## 4. Sequence macro imposee

1. cadrer les invariants et les ecarts legacy -> cible
2. poser la BDD cible et la migration additive
3. construire workspace et build separes
4. mettre en place runtime health, Docker durci et le port sandbox
5. introduire l'orchestrateur d'execution ephemere et preparer Firecracker sans le repousser hors sequence
6. maintenir les facades legacy pendant la migration
7. rebrancher Phil, Archi et Bos
8. verrouiller la non-regression, les warnings `dev-only` et la preparation Firecracker

---

## 5. Ordres de mission par agent

## OM-01 - Agent `planificateur`

### Mission
Geler le cadrage d'execution du Plan 1 sans derive par rapport aux recommandations 1 et 2.

### Analyse obligatoire

1. comparer le code existant au modele `workspace + build + sandbox ephemere`
2. identifier les ecarts dans `UserFunction.model.ts`, `sandbox.service.ts`, `pythonExecutor.ts`, `functions.routes.ts`, `sandbox.routes.ts`
3. geler les impacts frontend sur Phil, Archi et Bos
4. inventorier les impacts sur `function.service.ts`, `useFunctionStore.ts`, `types/function.types.ts`, `AgentLoop.ts`, `user-workspace.routes.ts` et les modales agent

### Livrables attendus

1. matrice `legacy -> cible`
2. backlog sequence des phases 0 a 5 du Plan 1
3. matrice de risques de regression
4. contrat d'execution minimal backend
5. definition of done de chaque phase

### Interdictions

1. ne pas reintroduire `TOOLS_V2.md` comme source directrice
2. ne pas presenter gVisor comme choix retenu
3. ne pas proposer de conteneur persistant par utilisateur

### Condition de sortie

1. les autres agents peuvent travailler sans ambiguite architecturale

---

## OM-02 - Agent `mongo-persistance`

### Mission
Concevoir la BDD cible du Plan 1 a partir des collections et usages decrits dans les recommandations.

### Analyse obligatoire

1. `backend/src/models/UserFunction.model.ts`
2. `backend/src/models/UserSettings.model.ts`
3. `backend/src/models/AgentPrototype.model.ts`
4. `backend/src/models/AgentInstance.model.ts`
5. les besoins de `workspaces`, `user_tools`, `user_tool_runs`, `secrets_metadata`
6. `backend/src/migrations/004_tools_v2_function_registry.ts`
7. `backend/src/seeds/nativeFunctions.seed.ts`

### Livrables attendus

1. schemas Mongoose des nouvelles collections minimales
2. index critiques pour user_tools et user_tool_runs
3. strategie de coexistence avec `user_functions`
4. references outillees pour agents, workflows et workspaces

### Interdictions

1. ne pas imposer de migration big bang
2. ne pas garder `user_functions` comme source finale de verite
3. ne pas inventer un modele non justifie par les recommandations

### Condition de sortie

1. la BDD cible du Plan 1 est figee et migrable de facon additive

---

## OM-03 - Agent `mongo-persistance`

### Mission
Verrouiller la persistence des runs et la migration additive depuis le legacy.

### Analyse obligatoire

1. cycle de vie des runs depuis Phil et Bos
2. migration de `user_functions` vers `user_tools`
3. references prototype et instance vers tool et version
4. impact de `AgentLoop.ts` et de la rehydratation workspace sur la persistence des runs
5. mecanisme actuel de dual-write legacy -> cible sur create, update, toggle et delete
6. synchronisation de demarrage `user_functions -> user_tools` et regle future d'inversion d'autorite

### Livrables attendus

1. schema `user_tool_runs`
2. machine d'etat de run bornee
3. plan de migration reversible
4. conventions de reference tool/version pour agents et workflows
5. decision de durcissement du dual-write: transaction Mongo si possible, sinon mecanisme compensatoire de reparation pour update, toggle et delete
6. regle de bornage de la synchronisation de demarrage pour empecher l'ecrasement de l'historique de versions de `user_tools` quand le registre cible devient source d'autorite

### Interdictions

1. ne pas laisser de statuts de run ambigus
2. ne pas dependre d'un cache frontend pour reconstituer un run
3. ne pas considerer la coexistence Jalon 2 comme suffisamment robuste pour une inversion d'autorite sans durcissement explicite du dual-write
4. ne pas laisser la synchronisation de demarrage reecrire le payload metier complet de `user_tools` apres bascule de l'autorite vers le registre cible

### Condition de sortie

1. un run est persistable, rehydratable et auditable sans ambiguite
2. la migration des runs est cadree avec une politique explicite de durcissement des mutations dual-write et de limitation de la synchronisation de demarrage

---

## OM-04 - Agent `codeur-specialiste`

### Mission
Implementer la couche `WorkspaceManager` et la structure filesystem cible.

Cette mission commence par un sas J4-A de stabilisation. L'objectif est d'eviter qu'une centralisation filesystem transverse soit construite alors que la politique d'autorite et le contrat d'hydratation restent encore fragiles apres Jalon 3.

### Analyse obligatoire

1. `UserSettings.model.ts`
2. usages actuels de chemins fonctionnels
3. structure actuelle des repertoires tools
4. `user-workspace.routes.ts` et `workspaceSnapshot` pour la compatibilite d'hydratation
5. `backend/src/services/databaseInit.ts` pour le bornage du startup sync
6. `hooks/useWorkspaceHydration.ts` pour la lecture frontend du snapshot
7. `backend/src/services/userToolRun.service.ts` pour verifier la compatibilite de projection runtime/workspace

### Stabilisation J4-A obligatoire

1. implementer dans `backend/src/services/databaseInit.ts` une politique de synchronisation de demarrage explicite par phase
2. garder `legacy-authority` tant que `user_functions` reste la facade publique et preparer `repair-only` pour l'apres inversion d'autorite
3. empecher la synchronisation de demarrage de reecrire les champs metier cibles de `user_tools` une fois le registre cible devenu source de verite
4. confirmer que `workspaceSnapshot` et `useWorkspaceHydration` restent compatibles avec l'ajout additif de `toolRuns`
5. consigner la dette technique actuelle sur le champ `runner` du chemin `pythonExecutor` comme hors perimetre J4, sauf si elle bloque directement le contrat workspace

### Architecture et design patterns attendus

1. Service Layer: `WorkspaceManager` orchestre creation, resolution et acces controle aux workspaces
2. Value Object / Resolver: `WorkspacePathResolver` centralise la derivation des chemins `code`, `manifest`, `build`, `output`
3. Facade / Anti-Corruption Layer: les routes et services existants deleguent au contrat workspace au lieu de recomposer des chemins locaux
4. Strategy / Policy Object: la synchronisation de demarrage doit etre gouvernee par une politique de phase d'autorite plutot que par des `if` disperses
5. Single Source of Truth: le contrat workspace doit devenir l'unique point de verite pour les chemins persistants, sans concurrencer la sandbox d'execution

### Livrables attendus

1. `WorkspaceManager`
2. `WorkspacePathResolver`
3. conventions code / manifest / build / output
4. creation idempotente des workspaces
5. bornage phase-aware du startup sync dans `databaseInit.ts`
6. compatibilite explicite de `user-workspace.routes.ts` / `workspaceSnapshot.ts` / `useWorkspaceHydration.ts`
7. TNR minimaux sur snapshot workspace, `toolRuns` et transitions critiques de `user_tool_runs`

### Interdictions

1. ne pas confondre workspace et sandbox d'execution
2. ne pas disperser la logique de chemins dans les routes
3. ne pas effectuer d'inversion d'autorite implicite pendant Jalon 4
4. ne pas faire evoluer opportunistement le schema `user_tool_runs` pour traiter la dette `runner` si cela ne sert pas directement le contrat workspace
5. ne pas introduire un contrat d'hydratation divergent entre backend et frontend

### Condition de sortie

1. le workspace est centralise et exploitable par build et execution
2. le startup sync est borne par phase et ne peut plus ecraser les champs cibles apres inversion d'autorite
3. `workspaceSnapshot` et `useWorkspaceHydration` restent compatibles avec la projection additive des runs
4. les regressions les plus probables sont couvertes par un socle TNR backend/frontend

---

## OM-05 - Agent `codeur-specialiste`

### Mission
Mettre en place le `BuildService` separe du run.

### Analyse obligatoire

1. manifests Node.js et Python
2. flux de build et d'installation de dependances
3. sorties a produire dans le workspace
4. impacts sur les types et DTOs remontes au frontend

### Livrables attendus

1. `BuildService`
2. build isole Node.js et Python
3. interdiction explicite des installs a chaud dans le run normal
4. traces de build et sorties controlees

### Interdictions

1. ne pas installer des dependances dans l'execution normale d'un tool
2. ne pas melanger l'image de build et l'image de run quand elles doivent etre distinctes

### Condition de sortie

1. le systeme peut preparer un tool sans detourner le run comme environnement de build

---

## OM-06 - Agent `codeur-specialiste`

### Mission
Industrialiser le runtime MVP avec Docker durci, `RuntimeHealthService` explicite et le socle d'abstraction preparant Firecracker.

### Analyse obligatoire

1. prerequis Docker rootless sur Linux et limites structurelles de Docker Desktop sur Windows/macOS
2. images runtime Node.js et Python
3. besoins de verification health avant execution
4. points d'integration avec `routes/index.ts` et les endpoints de verification existants
5. besoins de debug et d'inspection des containers sandbox executant du code arbitraire

### Livrables attendus

1. `RuntimeHealthService`
2. scripts setup, check et rebuild runtime
3. images sandbox Debian slim Node.js et Python, coherentes et debuggables
4. diagnostic lisible par backend et UI avec `mode`, `securityLevel`, `executionReady` et warning `dev-only`
5. contrat `SandboxRunner` et `SandboxRunnerFactory` poses des cette phase
6. `DockerSandboxRunner` durci, meme si l'orchestrateur complet arrive au jalon suivant

### Interdictions

1. ne pas utiliser Alpine comme standard sandbox
2. ne pas annoncer un runtime pret sans verification reelle
3. ne pas basculer les images sandbox d'execution arbitraire vers distroless pour masquer des CVE de surface si cela casse le debug et ne traite pas le vrai modele de menace
4. ne pas presenter Docker Desktop comme une securite de production

### Condition de sortie

1. le runtime MVP est installable, verifiable et observable
2. le runtime expose clairement quand l'environnement courant est `dev-only`
3. le chantier J7 peut brancher l'orchestrateur sur un port deja stable et compatible Firecracker

---

## OM-07 - Agent `codeur-specialiste`

### Mission
Implementer l'orchestrateur d'execution ephemere du MVP sur le port sandbox deja pose et faire entrer Firecracker dans la trajectoire active du projet.

### Analyse obligatoire

1. `sandbox.service.ts`
2. `pythonExecutor.ts`
3. points d'appel Phil et execution workflow
4. `services/llm/AgentLoop.ts` et son contrat actuel `/api/sandbox/run`
5. `SandboxRunnerFactory`, `DockerSandboxRunner` et preparation `FirecrackerRunner`

### Livrables attendus

1. `ExecutionOrchestrator`
2. port `SandboxRunner`
3. `SandboxRunnerFactory`
4. `DockerSandboxRunner` avec flags d'isolation explicites (`network=none`, `cap-drop=ALL`, `no-new-privileges`, quotas, tmpfs, timeout)
5. `FirecrackerRunner` prepare ou prototype, avec detection de disponibilite Linux/KVM et point de branchement testable
6. collecte logs, resultats, quotas et timeouts
7. persistence des runs dans `user_tool_runs`

### Interdictions

1. ne pas laisser les routes lancer directement des subprocess
2. ne pas figer l'orchestrateur sur Docker au point d'empecher Firecracker ensuite
3. ne pas autoriser le reseau par defaut
4. ne pas laisser Firecracker comme simple note documentaire non branchable avant la fin du sprint architecture

### Condition de sortie

1. chaque run passe par un flux ephemere gouverne et persiste
2. le fallback Docker vs Firecracker est explicite, teste et observable

---

## OM-08 - Agent `codeur-specialiste`

### Mission
Maintenir la compatibilite applicative pendant la migration backend.

### Analyse obligatoire

1. `functions.routes.ts`
2. `sandbox.routes.ts`
3. appels frontend existants Phil, Archi et Bos
4. `user-workspace.routes.ts`
5. `useFunctionStore.ts`

### Livrables attendus

1. facades de compatibilite legacy
2. nouvelles routes outillees `workspaces`, `tools`, `runs`
3. cartographie de deprecation progressive
4. exposition claire des warnings runtime `dev-only` vers backend et UI sans casser les parcours existants

### Interdictions

1. ne pas faire de cutover big bang
2. ne pas exposer deux verites metier contradictoires

### Condition de sortie

1. le frontend continue de fonctionner pendant le basculement backend

---

## OM-09 - Agent `designer_ux`

### Mission
Rebrancher Phil sur le nouveau contrat backend sans casser son parcours valide.

### Analyse obligatoire

1. `components/PhilFunctionsPage.tsx`
2. `components/FunctionEditorTab.tsx`
3. services frontend lies a l'edition et au test
4. `stores/useFunctionStore.ts`
5. `types/function.types.ts`

### Livrables attendus

1. edition outillee depuis `user_tools`
2. execution de test branchee sur `user_tool_runs`
3. affichage des logs, outputs et statuts de run

### Interdictions

1. ne pas conserver le sandbox legacy comme coeur cible
2. ne pas casser le parcours principal d'edition et de test

### Condition de sortie

1. Phil fonctionne sur la nouvelle architecture du Plan 1

---

## OM-10 - Agent `designer_ux`

### Mission
Rebrancher Archi et Bos sur le nouveau modele de tools et de runs.

### Analyse obligatoire

1. `components/FunctionSelector.tsx`
2. composants Bos de projection des tool calls
3. references tools dans prototypes et instances
4. `components/modals/AgentFormModal.tsx`
5. `components/modals/AgentConfigurationModal.tsx`
6. `types.ts`
7. `services/llm/FunctionCallingPromptBuilder.ts`

### Livrables attendus

1. selection des tools basee sur les references `user_tools` et version
2. Bos alimente par `user_tool_runs`
3. rehydratation des executions apres refresh

### Interdictions

1. ne pas reconstruire l'etat d'execution uniquement depuis le frontend
2. ne pas laisser Archi dependu directement de `user_functions`

### Condition de sortie

1. Archi et Bos lisent la nouvelle source de verite sans perte de comportement critique

---

## OM-11 - Agent `testeur`

### Mission
Verrouiller le go/no-go du Plan 1 par la non-regression, la validation du mode Docker `dev-only` et la preparation securitaire effective vers Firecracker.

### Analyse obligatoire

1. suites backend workflows, persistence, auth et routes
2. suites frontend Phil, Archi, Bos et hydration
3. preconditions runtime et executions concurrentes
4. compatibilite `AgentLoop`, hydration workspace et stores frontend

### Livrables attendus

1. matrice TNR du Plan 1
2. tests des runs ephemeres et de la persistence associee
3. tests de charge de base et tentatives d'escape
4. verdict go/no-go documente
5. preuve explicite que le runtime Docker Desktop est borne comme `dev-only` et que le chemin Firecracker est reellement preparatoire, pas purement narratif

### Interdictions

1. ne pas valider le plan sans tests sur le runtime Docker durci et sans verification du comportement Linux rootless quand l'environnement de test le permet
2. ne pas limiter la validation a des tests unitaires isoles

### Condition de sortie

1. le basculement MVP est defendable techniquement et securitairement

---

## OM-12 - Agent `traducteur`

### Mission
Stabiliser la terminologie du Plan 1 et des documents derives.

### Analyse obligatoire

1. plan source
2. DTOs backend exposes
3. libelles UI Phil, Archi et Bos lies aux tools
4. terminology existante dans `function.types.ts`, `types.ts` et `AgentLoop.ts`

### Livrables attendus

1. vocabulaire stabilise pour workspace, build, run, runtime, registry, output, health
2. suppression des termes ambigus venant de l'ancien plan
3. coherence documentaire FR/EN si necessaire

### Interdictions

1. ne pas laisser coexister plusieurs termes pour la meme realite technique
2. ne pas reintroduire d'anciens termes faux comme source normative

### Condition de sortie

1. la documentation et l'implementation parlent le meme langage technique
