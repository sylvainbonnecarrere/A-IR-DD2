# LIVRABLE JALON 1 - CADRAGE D'EXECUTION DU PLAN 1 TOOLS

> Date: 17 mars 2026
> Auteur logique: `planificateur`
> Source directrice unique: `PLAN_1_ARCHITECTURE_BDD_SANDBOX_INSTALLATION.md`
> Sources amont exclusives: `RECOMMANDATION_SANDBOX_1.md` et `RECOMMANDATION_SANDBOX_2.md`

---

## 1. Objet du livrable

Ce document initialise effectivement la feature Tools v2 au niveau du **cadrage d'execution**.

Il fige pour l'equipe:

1. la matrice `legacy -> cible`
2. l'ordre des phases 0 a 5
3. les impacts backend et frontend
4. les risques de regression majeurs
5. les dependances inter-jalons

Ce document ne redecide pas l'architecture. Il operationalise le Plan 1.

---

## 2. Invariants geles

Les invariants suivants sont maintenant consideres fermes pour toute la suite du chantier:

1. workspace persistant par utilisateur/projet ou workflow
2. sandbox ephemere par execution de tool
3. build separe du run
4. Docker durci comme base MVP dev/test, avec rootless quand l'environnement Linux le permet
5. Firecracker comme cible de securite de production a preparer des le chantier runtime
6. Debian slim comme base standard des runtimes
7. gVisor exclu du chemin choisi pour ce plan
8. aucune bascule big bang depuis `user_functions`
9. aucune regression de Phil, Archi, Bos, hydration workspace et AgentLoop

---

## 3. Matrice legacy -> cible

| Zone legacy | Probleme actuel | Cible Plan 1 | Nature du changement |
|---|---|---|---|
| `UserFunction.model.ts` | melange definition, code, activation et execution | `user_tools` + versioning + references outillees | decomposition additive |
| `sandbox.service.ts` | coeur d'execution monolithique et ad hoc | `ExecutionOrchestrator` + `SandboxRunner` | remplacement progressif |
| `pythonExecutor.ts` | execution concrete couplee au legacy | adaptateur transitoire ou retrait progressif | declassement |
| `functions.routes.ts` | CRUD centre sur `user_functions` | routes `tools` + facades de compatibilite | refonte avec facade |
| `sandbox.routes.ts` | test snippet / run sans orchestration cible | contrat d'execution structure | refonte avec facade |
| `function.service.ts` | service CRUD centre `UserFunction` | service registry / references tools-version | refonte de domaine |
| `user-workspace.routes.ts` | hydration critique sans nouveau contrat tools/runs | hydration compatible nouvelle source de verite | adaptation transverse |
| `UserSettings.model.ts` | `functionPaths[]` insuffisant | references workspace et preferences | simplification |
| `AgentPrototype.model.ts` | references tools vers legacy | references tool/version cibles | migration additive |
| `AgentInstance.model.ts` | heritage fonctionnel centre legacy | references tool/version + runs persistants | migration additive |
| `useFunctionStore.ts` | store CRUD + sandbox sur routes legacy | store branche sur registry, workspace et runs | adaptation frontend |
| `types/function.types.ts` | miroir `IUserFunction` | DTOs design + execution cibles | refonte de contrat |
| `types.ts` | `functionIds` et `ToolCallRecord` centres legacy | references tools/version + run ids | alignement transverse |
| `PhilFunctionsPage.tsx` | shell valide mais source legacy | shell conserve, backend rebranche | preservation UX |
| `FunctionEditorTab.tsx` | test et edition sur contrats legacy | edition registry + test via runs persistants | rebranchement |
| `FunctionSelector.tsx` | selection sur `UserFunction` | selection sur registry cible | rebranchement |
| `AgentFormModal.tsx` | serialisation function ids legacy | serialisation refs tool/version compatibles | adaptation |
| `AgentConfigurationModal.tsx` | overrides d'instance sur logique legacy | overrides sur references cible | adaptation |
| `AgentLoop.ts` | POST `/api/sandbox/run` direct | execution via nouveau contrat backend | rebranchement critique |
| `FunctionCallingPromptBuilder.ts` | documentation des tools depuis `UserFunction` | documentation depuis registry cible | adaptation |
| `workspaceSnapshot` / hydration | ne connait pas les futures structures tools/runs | snapshot hydrate nouvelle source de verite sans fuite | adaptation critique |
| migration `004_tools_v2_function_registry.ts` | migration deja presente autour de `user_functions` | base a analyser et eventuellement prolonger | rationalisation |
| `nativeFunctions.seed.ts` | seed lie au legacy | seed a reevaluer pour registry cible | rationalisation |

---

## 4. Phases 0 a 5 sequencees

## Phase 0 - Cadrage et inventaire

**But:** fermer les ambiguities avant toute implementation lourde.

**A produire:**

1. matrice `legacy -> cible`
2. cartographie fichiers impactes
3. contrat d'execution minimal
4. backlog sequence des phases 1 a 5

**Sortie attendue:**

1. `mongo-persistance` et `codeur-specialiste` peuvent travailler sans reinterpretation

## Phase 1 - BDD et registry

**But:** installer la source de verite cible.

**A produire:**

1. `workspaces`
2. `user_tools`
3. `user_tool_runs`
4. `secrets_metadata`
5. references prototypes et instances compatibles

**Sortie attendue:**

1. la BDD cible minimale est figee et migrable additivement

## Phase 2 - Workspace et build

**But:** separer persistance, preparation et output.

**A produire:**

1. `WorkspaceManager`
2. conventions filesystem `code / manifests / build / output`
3. `BuildService`
4. interdiction effective des installs a chaud dans le run normal

**Sortie attendue:**

1. le systeme peut preparer un tool hors execution utilisateur

## Phase 3 - Runtime et sandbox MVP

**But:** rendre executable le MVP en environnement contraint et verifiable.

**A produire:**

1. images Debian slim Node.js et Python
2. `RuntimeHealthService`
3. `DockerRootlessRunner`
4. `ExecutionOrchestrator`

**Sortie attendue:**

1. chaque run passe par une sandbox ephemere gouvernee et persistante

## Phase 4 - Compatibilite applicative

**But:** basculer sans casser le frontend ni la logique agentique locale.

**A produire:**

1. facades legacy backend
2. rebranchement Phil
3. rebranchement Archi et Bos
4. adaptation `useFunctionStore`, `function.types.ts`, `types.ts`, `AgentLoop`, `user-workspace.routes.ts`

**Sortie attendue:**

1. les parcours critiques restent operationnels pendant la migration

## Phase 5 - Validation et durcissement

**But:** produire un go/no-go defendable.

**A produire:**

1. TNR backend et frontend
2. tests de charge de base
3. tests de securite MVP Docker rootless
4. validation de la preparation du port Firecracker

**Sortie attendue:**

1. le MVP est valide ou bloque sur preuves techniques explicites

---

## 5. Impacts backend

Les impacts backend sont ordonnes par priorite d'architecture.

1. remplacer le socle `UserFunction + sandbox.service + pythonExecutor` par `registry + build + orchestrator + runner`
2. introduire les nouvelles collections sans casser les lectures legacy
3. maintenir `functions.routes.ts` et `sandbox.routes.ts` en facades transitoires
4. faire evoluer `function.service.ts` vers la nouvelle resolution des tools
5. adapter l'hydratation `user-workspace.routes.ts` et la composition des routes dans `routes/index.ts`
6. reprendre migrations et seeds existants pour eviter les trajectoires contradictoires

---

## 6. Impacts frontend

Les impacts frontend sont ordonnes par priorite de non-regression.

1. conserver le shell UX de Phil
2. rebrancher l'edition et le test sur `user_tools` et `user_tool_runs`
3. adapter `useFunctionStore` et `function.types.ts`
4. adapter `FunctionSelector`, `AgentFormModal` et `AgentConfigurationModal`
5. realigner `types.ts` avec les nouvelles references et les runs persistants
6. rebrancher `AgentLoop` et `FunctionCallingPromptBuilder`
7. maintenir une hydratation workspace stable pour refresh et reprise de session

---

## 7. Risques de regression majeurs

1. casser la selection des tools dans les modales agent en migrant trop tot les references
2. casser Phil si le store frontend reste en contrat legacy pendant que le backend bascule
3. casser Bos si les runs ne sont pas persistables et rehydratables avant rebranchement UI
4. casser `AgentLoop` si `/api/sandbox/run` disparait avant facade de transition
5. dupliquer ou contredire les migrations existantes autour de `user_functions`
6. exposer un runtime annonce `ready` sans verification health reelle
7. reintroduire des installs a chaud dans le run normal
8. casser l'hydratation workspace en oubliant `user-workspace.routes.ts` et `workspaceSnapshot`

---

## 8. Dependances inter-jalons

1. Jalon 2 depend de la fermeture du cadrage Jalon 1
2. Jalon 3 depend des schemas et conventions poses au Jalon 2
3. Jalon 4 depend de la modelisation workspace de Jalon 2
4. Jalon 5 depend du cadrage workspace de Jalon 4
5. Jalon 6 depend des decisions build/runtime de Jalon 5
6. Jalon 7 depend de Jalon 3 et Jalon 6
7. Jalon 8 depend du nouveau coeur backend et des facades de Jalon 7
8. Jalon 9 depend des nouveaux DTOs et routes stabilises par Jalon 8
9. Jalon 10 depend de Jalon 3, Jalon 8 et Jalon 9
10. Jalon 11 depend de la completion fonctionnelle minimale des Jalons 2 a 10
11. Jalon 12 depend de la stabilisation des contrats exposes par les jalons precedents

---

## 9. Definition of done du Jalon 1

Le Jalon 1 est termine quand:

1. la matrice `legacy -> cible` est explicite
2. les phases 0 a 5 sont sequencees et exploitables
3. les risques de regression majeurs sont listes
4. les impacts backend et frontend sont identifies, y compris les couplages secondaires
5. les dependances entre jalons sont claires pour les agents suivants
