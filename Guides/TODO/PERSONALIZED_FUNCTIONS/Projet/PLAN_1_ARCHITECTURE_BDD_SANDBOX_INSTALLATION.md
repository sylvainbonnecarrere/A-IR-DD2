# PLAN 1 - ARCHITECTURE APPLICATIVE, BDD, SANDBOXING ET INSTALLATION

> Date: 17 mars 2026
> Statut: plan directeur corrige
> Portee: premiere partie structurante du projet Tools
> Sources de verite exclusives: `Guides/TODO/PERSONALIZED_FUNCTIONS/RECOMMANDATION_SANDBOX_1.md` et `Guides/TODO/PERSONALIZED_FUNCTIONS/RECOMMANDATION_SANDBOX_2.md`

---

## 1. Statut de ce document

Ce document remplace la version precedente du Plan 1.

Pour cette premiere partie du projet, les documents suivants ne sont **pas** la source directrice:

1. `Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/TOOLS_V2.md`
2. les anciens decoupages produits a partir de ce document
3. toute formulation qui contredit les recommandations sandbox 1 et 2

Le role de ce plan est de transformer les deux recommandations de reference en un plan d'implementation exploitable, sans reinterpretation libre.

---

## 2. Decisions architecturales retenues

Les decisions suivantes sont retenues comme obligatoires.

### 2.1 Modele d'execution retenu

1. ne pas creer un conteneur persistant par utilisateur a l'inscription
2. creer un **workspace persistant** par utilisateur et par projet ou workflow
3. executer chaque invocation de tool dans une **sandbox ephemere** dediee
4. separer explicitement le **workspace**, le **build** et le **run**
5. detruire systematiquement l'environnement d'execution apres chaque run

### 2.2 Runtime sandbox retenu

1. **Socle runtime de developpement et test**: sandboxes Docker durcies, avec rootless quand l'hote Linux le permet
2. **Cas Windows / Docker Desktop**: mode acceptable pour developpement local uniquement, avec warning explicite et sans pretendre fournir une securite de production
3. **Cible de securite de production retenue**: Firecracker microVM pour le code utilisateur non fiable
4. **Consequence de planification**: la preparation du port Firecracker et de la factory de selection runtime commence des le jalon 6 et ne doit pas etre repoussee a une phase post-developpement
5. **gVisor n'est pas retenu dans ce plan**: il peut apparaitre dans les recommandations comme option de comparaison, mais il ne fait pas partie du chemin choisi pour ce projet

### 2.3 Images et distribution retenues

1. images separees pour Node.js et Python
2. image de build distincte de l'image de run lorsque necessaire
3. base recommandee pour les images sandbox: **Debian slim** ou equivalent debuggable
4. les images sandbox d'execution de code arbitraire ne doivent pas basculer en distroless si cela supprime les capacites d'inspection et de diagnostic attendues pendant le developpement et le durcissement
5. **Alpine n'est pas le choix par defaut** pour ce plan

### 2.4 Gouvernance d'execution retenue

1. reseau desactive par defaut
2. utilisateur non root dans les sandboxes
3. root filesystem en lecture seule autant que possible
4. quotas CPU, memoire, disque temporaire et pids imposes
5. timeout strict par run
6. aucun montage du Docker socket
7. secrets hors du code utilisateur, injectes au moment du run seulement
8. logs, resultats et metriques traces depuis le backend

---

## 3. Ce que ce plan couvre et ce qu'il ne couvre pas

### 3.1 Ce que ce plan couvre

1. architecture applicative cible de la premiere phase Tools
2. redesign BDD pour workspaces, tools, runs et metadonnees associees
3. separation workspace / build / run
4. installation et verification des runtimes Node.js et Python
5. mise en place du sandboxing MVP avec Docker durci, rootless quand disponible, et mode Docker Desktop documente comme dev-only
6. definition et preparation immediate de la cible Firecracker pour le code utilisateur non fiable
7. impact sur le backend, Phil, Archi et Bos
8. sequence d'implementation anti-regression

### 3.2 Ce que ce plan ne couvre pas

1. la reconstruction detaillee de chaque fonction native
2. la politique complete de secret broker multi-tenant
3. l'implementation immediate de Firecracker dans le MVP
4. toute architecture reposant sur un conteneur persistant par utilisateur
5. toute solution basee sur Alpine comme standard des sandboxes utilisateur

---

## 4. Invariants d'architecture

Les invariants suivants ne doivent jamais etre violes pendant l'implementation.

1. le workspace persistant n'est pas l'environnement d'execution
2. l'installation des dependances ne se fait pas a chaud dans le run normal
3. le backend orchestre, autorise, journalise et limite chaque execution
4. les agents n'executent jamais directement du code hors gouvernance backend
5. les tools sont traites comme des capacites gouvernees, pas comme de simples snippets
6. toute execution doit etre versionnable, observable et destructible apres usage
7. les parcours valides de Phil, Archi et Bos ne doivent pas etre casses pendant la migration

---

## 5. Architecture cible

## 5.1 Vue logique

```text
React UI
  |
  v
Backend Node.js / TypeScript
  |
  +--> MongoDB
  |      - workspaces
  |      - user_tools
  |      - user_tool_runs
  |      - secrets_metadata
  |      - references projets/workflows et agents
  |
  +--> Workspace Manager
  |      - code utilisateur
  |      - manifests
  |      - assets
  |      - sorties de build et output
  |
  +--> Tool Registry
  |      - metadata tool
  |      - runtime
  |      - versions
  |      - schema input/output
  |      - policy minimale
  |
  +--> Build Service
  |      - installation dependances
  |      - cache controle
  |      - artefacts de build
  |
  +--> Execution Orchestrator
         |
    +--> DockerSandboxRunner (MVP dev/test, rootless si disponible)
    +--> FirecrackerRunner (cible de production preparee des J6/J7)
         +--> RuntimeHealthService
         +--> Policy checks minimaux
         +--> Observability
```

## 5.2 Composants backend obligatoires

1. `WorkspaceManager`
   - creation idempotente du workspace
   - resolution de chemins
   - lecture/ecriture controlees
   - gestion des manifests et outputs

2. `ToolRegistry`
   - enregistrement des tools utilisateur
   - versioning
   - schemas d'entree et de sortie
   - metadonnees de runtime et de policy

3. `BuildService`
   - build isole
   - installation dependances hors run
   - production d'artefacts ou sorties preparatoires

4. `ExecutionOrchestrator`
   - planification et declenchement des runs
   - application des limites
   - collecte des logs et resultats
   - destruction de la sandbox

5. `SandboxRunner`
   - contrat d'abstraction du moteur d'execution
   - implementation de developpement: `DockerSandboxRunner`
   - implementation Linux durcie: variante rootless quand l'hote le permet
   - implementation cible de production: `FirecrackerRunner`

6. `SandboxRunnerFactory`
   - selection explicite du runner selon l'environnement
   - mode Docker Desktop journalise comme `dev-only`
   - preparation du basculement futur vers Firecracker sans recouplage au legacy

7. `RuntimeHealthService`
   - verification installation Node.js, Python, Docker, variantes runtime et images runtime
   - exposition d'un etat exploitable par backend et UI avec `mode`, `securityLevel` et `executionReady`
   - warning explicite sur Docker Desktop et sur tout runtime non apte a la production

8. `PolicyChecks`
   - reseau
   - systeme de fichiers
   - timeouts
   - ressources
   - secrets autorises

---

## 6. Modele BDD conforme aux recommandations

Ce plan retient une BDD orientee usage, execution et auditabilite.

### 6.1 Collections et entites minimales

1. `workspaces`
   - owner
   - projet ou workflow de rattachement
   - racine logique
   - manifests detectes
   - statut
   - quotas
   - dernier scan

2. `user_tools`
   - owner
   - workspace de rattachement
   - runtime `typescript | python`
   - metadata tool
   - version courante
   - versions publiees ou brouillons
   - schema input/output
   - hash de contenu
   - policy minimale
   - statut de validation

3. `user_tool_runs`
   - tool id
   - version
   - user
   - contexte de lancement
   - inputs valides
   - outputs et logs references
   - statut de run
   - duree et ressources consommees
   - policy appliquee
   - runner utilise

4. `secrets_metadata`
   - alias
   - owner
   - scope
   - rotation
   - usage trace

5. references existantes a adapter
   - `AgentPrototype.model.ts`
   - `AgentInstance.model.ts`
   - `UserSettings.model.ts`

### 6.2 Regles de modelisation retenues

1. `user_functions` n'est plus la cible finale de verite
2. la migration depuis `user_functions` doit etre additive et reversible
3. les agents et workflows referencent un tool et une version, pas un blob polymorphe non gouverne
4. un run est persiste comme unite d'audit et de rehydratation
5. les outputs de fichiers vont dans le workspace ou dans une zone output controlee, pas dans le conteneur persistant

---

## 7. Sandboxing et installation

## 7.1 MVP sandboxing

Le MVP doit livrer:

1. Docker durci avec sandboxes ephemeres par run
2. rootless quand l'hote Linux le permet, sans rendre le developpement Windows impossible
3. `SandboxRunnerFactory` et contrat `SandboxRunner` poses des cette phase
4. `DockerSandboxRunner` avec flags d'isolation explicites
5. warning `dev-only` explicite quand l'environnement courant est Docker Desktop
6. preparation concrete du chemin Firecracker des cette phase, meme si tous les environnements de developpement ne peuvent pas l'executer
7. user non root
8. root filesystem read-only autant que possible
9. `cap-drop=ALL`
10. `no-new-privileges`
11. seccomp et AppArmor ou equivalent selon environnement
12. `--network=none` par defaut
13. quotas CPU, memoire, pids, tmpfs et timeout
14. destruction systematique apres run

Ce MVP ne doit pas etre confondu avec un niveau de securite de production si l'execution passe par Docker Desktop.

## 7.2 Installation runtime

Le plan impose:

1. une image runtime Node.js separee
2. une image runtime Python separee
3. une image ou un environnement de build distinct si necessaire
4. des scripts de setup, check et rebuild des runtimes
5. une verification health avant d'annoncer un tool executable
6. des images sandbox debuggables et coherentes entre Node.js et Python, avec structure filesystem, UID et conventions d'execution homogenes
7. pour Node.js sandbox, un Debian slim durci cible est prefere a une image distroless si le container sert a l'execution de code arbitraire et au diagnostic de bugs

## 7.3 Cible Firecracker

La cible de securite retenue pour le code utilisateur non fiable est Firecracker.

Consequence immediate pour le MVP:

1. l'orchestrateur doit etre concu autour d'un port `SandboxRunner`
2. une `SandboxRunnerFactory` doit choisir explicitement entre Docker et Firecracker selon l'environnement
3. Docker ne doit pas etre code comme une dependance structurelle irreversible
4. le mode Docker Desktop doit etre journalise comme `dev-only` et ne pas etre presente comme securite de production
5. la preparation du runner Firecracker commence pendant la sequence J6/J7, avec au minimum le contrat, la factory, la detection de disponibilite et un plan d'execution Linux/KVM testable
6. aucune documentation de ce plan ne doit presenter gVisor comme cible retenue pour ce projet

---

## 8. Impact sur le code existant

## 8.1 Backend a refondre ou reclasser

1. `backend/src/models/UserFunction.model.ts`
   - source legacy a migrer, pas modele final

2. `backend/src/services/sandbox.service.ts`
   - coeur actuel a remplacer par `ExecutionOrchestrator`

3. `backend/src/pythonExecutor.ts`
   - adaptateur legacy transitoire au mieux, pas coeur cible

4. `backend/src/routes/functions.routes.ts`
   - a faire evoluer vers des routes outillees `workspaces`, `tools`, `runs`

5. `backend/src/routes/sandbox.routes.ts`
   - a faire evoluer vers un contrat d'execution structure, pas seulement un test de snippet

6. `backend/src/models/UserSettings.model.ts`
   - a simplifier vers des references de workspace et preferences, plus `functionPaths[]` comme socle

7. `backend/src/models/AgentPrototype.model.ts` et `backend/src/models/AgentInstance.model.ts`
   - a faire pointer vers des references de tools/version compatibles avec le nouveau registry

8. `backend/src/services/function.service.ts`
   - service actuellement centre sur `UserFunction`
   - a faire evoluer vers le nouveau registry et la nouvelle resolution des references tools pour prototypes et instances

9. `backend/src/routes/user-workspace.routes.ts`
   - endpoint d'hydratation transverse deja critique pour le frontend
   - doit etre pris en compte dans la migration pour exposer le nouvel etat tools et runs sans casser la rehydratation globale

10. `backend/src/routes/index.ts`
    - point d'entree de composition des routes
    - doit etre mis a jour lors de l'introduction des nouvelles routes `tools`, `runs` et de leurs facades de compatibilite

11. `backend/src/migrations/004_tools_v2_function_registry.ts`
    - migration existante deja liee a `user_functions`
    - doit etre analysee pour eviter de superposer une nouvelle migration incoherente

12. `backend/src/seeds/nativeFunctions.seed.ts`
    - seed existant des fonctions natives
    - doit etre re-evalue au regard du futur registry et de la separation definition/version/run

## 8.2 Frontend a preserver puis rebrancher

1. `components/PhilFunctionsPage.tsx`
2. `components/FunctionEditorTab.tsx`
3. `components/FunctionSelector.tsx`

4. `stores/useFunctionStore.ts`
   - store de reference actuel pour le CRUD et le sandbox frontend
   - devra etre adapte au nouveau contrat API et au nouveau modele de types

5. `types/function.types.ts`
   - contrat frontend actuel miroir de `IUserFunction`
   - devra migrer vers les DTOs du nouveau registry et des runs

6. `components/modals/AgentFormModal.tsx` et `components/modals/AgentConfigurationModal.tsx`
   - utilisent `FunctionSelector` et portent la serialisation des references tools cote prototype et instance
   - doivent etre prises en compte pour ne pas casser la configuration agent

7. `types.ts`
   - contient `functionIds`, `ToolCallRecord` et la structure d'heritage d'instance
   - devra etre aligne sur les nouvelles references tools/version et sur la nouvelle persistence des runs

8. `components/RobotPageRouter.tsx`
   - routeur d'acces a `PhilFunctionsPage`
   - point d'integration a conserver stable pendant la transition

9. projection Bos et hydratation globale
   - la transition ne touche pas seulement les composants visuels Bos
   - elle impacte aussi la facon dont les executions sont relues apres refresh et apres hydratation workspace

## 8.3 Couplages metier actuellement sous-documentes mais critiques

1. `services/llm/AgentLoop.ts`
   - execute aujourd'hui les tools via `/api/sandbox/run`
   - devra etre rebranche vers le nouveau contrat d'execution sans casser la boucle agent locale

2. `services/llm/FunctionCallingPromptBuilder.ts`
   - documente les tools disponibles a partir de `UserFunction`
   - devra consommer les futures definitions exposees au prompt builder

3. `services/adapters/ILLMAdapter.ts` et usages associes
   - dependent indirectement du contrat de fonction disponible pour un agent
   - doivent etre consideres dans la migration du design domain vers le nouveau registry

4. `buildWorkspaceSnapshot` et l'hydratation workspace
   - le snapshot de rehydratation devra savoir exposer la nouvelle source de verite tools et les runs pertinents sans fuite de secrets

La regle est la suivante:

1. conserver le shell UX valide
2. changer la source de verite et les contrats backend
3. ne pas casser les parcours Phil pendant le basculement
4. faire de Bos une projection de `user_tool_runs`
5. conserver l'hydratation workspace stable pendant la migration

---

## 9. Sequence d'implementation retenue

## Phase 0 - Cadrage et inventaire

1. confirmer les invariants issus des recommandations 1 et 2
2. cartographier les ecarts legacy -> cible
3. figer les DTOs et le contrat d'execution minimal
4. inventorier les couplages secondaires: store frontend, modales agent, AgentLoop, hydration workspace, migrations et seeds existants

## Phase 1 - BDD et registry

1. creer `workspaces`
2. creer `user_tools`
3. creer `user_tool_runs`
4. definir la migration additive depuis `user_functions`
5. adapter les references agents et workflows

## Phase 2 - Workspace et build

1. implementer `WorkspaceManager`
2. separer les repertoires code, manifests, build et output
3. implementer `BuildService`
4. interdire l'installation de dependances dans le run normal

## Phase 3 - Runtime et sandbox MVP

1. mettre en place les images sandbox Debian slim Node.js et Python, debuggables et durcies
2. implementer `RuntimeHealthService` avec `mode`, `securityLevel`, `executionReady` et warning `dev-only`
3. poser `SandboxRunner`, `SandboxRunnerFactory` et `DockerSandboxRunner`
4. brancher l'orchestrateur sur ce contrat remplaçable
5. preparer la detection Firecracker/KVM et le point d'extension du futur runner de production

## Phase 4 - Compatibilite applicative

1. faire evoluer les routes legacy vers des facades de compatibilite
2. rebrancher Phil
3. rebrancher Archi et Bos
4. persister et rehydrater les runs
5. adapter `useFunctionStore`, `function.types.ts`, `types.ts`, `AgentLoop` et `user-workspace.routes.ts`

## Phase 5 - Validation et durcissement

1. tests de non regression backend et frontend
2. tests de charge et d'execution concurrente
3. tests de securite et d'escape attempts sur la sandbox Docker durcie
4. validation explicite du comportement `dev-only` sur Docker Desktop et du comportement Linux rootless quand disponible
5. validation de la preparation Firecracker dans la branche active de developpement, et non comme promesse post-projet

---

## 10. Anti-regressions obligatoires

1. aucune bascule big bang
2. aucune suppression immediate de `user_functions`
3. aucune rupture de Phil sans facade de transition
4. aucune execution annoncee `ready` sans verification runtime
5. aucun acces reseau par defaut dans les runs
6. aucune dependance a Alpine comme standard sandbox
7. aucune documentation de ce plan ne doit presenter gVisor comme choix retenu
8. aucune rupture de l'hydratation workspace ou de la boucle AgentLoop pendant la migration
9. aucune migration ne doit ignorer les seeds et migrations deja presentes autour de `user_functions`
10. aucune image sandbox d'execution arbitraire ne doit etre basculee en distroless sans justification technique explicite sur le debug, l'observabilite et le risque traite
11. aucun mode Docker Desktop ne doit etre presente comme securite de production

---

## 11. Definition of done du Plan 1

Le Plan 1 est considere termine quand les conditions suivantes sont toutes vraies:

1. le modele `workspace + user_tools + user_tool_runs` est en place ou fige contractuellement
2. le build est separe du run
3. le runtime MVP est installable et verifiable sur Docker durci, avec distinction explicite entre `dev-only` et securite de production
4. le backend orchestre les executions ephemeres via un contrat deja prepare pour Firecracker
5. Phil, Archi et Bos peuvent etre rebranches sans rupture structurelle
6. les documents de mission derives du present plan sont alignes sur ces decisions et sur aucune autre source
7. les couches store frontend, AgentLoop, hydration workspace, modales agent et migrations legacy sont explicitement traitees dans le chantier
