# Backlog de refonte V1 -> V2

**Statut :** backlog validé pour la phase de stabilisation J0/J1
**Date :** 2026-10-29
**Source principale :** `Guides/Features/feature/refonte/v1-v2-implementation-plan.md`

## Mise à jour de validation (2026-10-29)

Les garde-fous V1/V2 sont maintenant operationalisés :

- l'inventaire versionné est en place dans `Guides/Features/feature/refonte/v1-v2-code-inventory.md` ;
- le script d'audit reproductible est validé via `npm run audit:workflow-architecture` et `npm run audit:workflow-architecture:strict` ;
- le seuil strict ne remonte plus d'`UNKNOWN` sur les surfaces connues ;
- le plan doit maintenant passer au jalon suivant sans réintroduire de nouvelles écritures métier V1.

Ce dossier est donc aligné sur l'état actuel du code et sert de référence pour le prochain jalon de migration / cutover.

## 1. Objectif du backlog

Ce backlog transforme le plan de refonte V1 -> V2 en jalons executables et en user stories attribuees a des agents specialises presents dans `.github/agents`.

Chaque user story precise :

- l'agent responsable ;
- son niveau de criticite ;
- l'objectif metier et technique ;
- les dependances ;
- les risques et consequences applicatives ;
- les impacts potentiels sur fichiers, dossiers, tests et fixtures ;
- les criteres d'acceptation.

## 2. Regles d'execution

- L'ordre des jalons est chronologique et ne doit pas etre inverse sans justification architecturale.
- Aucun jalon ne doit reintroduire une ecriture metier sur `Workflow.nodes` ou `Workflow.edges`.
- Toute user story impactant les contrats, la securite ou la persistance doit etre validee par tests cibles avant passage au jalon suivant.
- Les user stories frontend ne doivent pas inventer de contrat local si le backend n'est pas stabilise.
- Les user stories de migration doivent etre idempotentes et rejouables.
- Toute creation, suppression ou modification de fichier ou dossier doit rester motivee par la responsabilite architecturale visee.

## 3. Niveaux de criticite

- `Critique` : bloque la refonte, menace l'integrite des donnees, la securite ou la capacite a livrer sans regression.
- `Haute` : impact direct sur les parcours principaux, les contrats inter-couches ou la stabilite runtime.
- `Moyenne` : necessaire a la clarte, a la maintenabilite ou a la couverture, avec risque fonctionnel indirect.
- `Basse` : optimisation non bloquante pour le cutover initial.

## 4. Ancrage codebase a respecter

### 4.1 Garde-fous securite deja presents

Le backlog doit s'aligner sur les mecanismes deja presents dans la codebase et les renforcer sans les contourner :

- authentification JWT et Passport dans `backend/src/middleware/auth.middleware.ts` ;
- filtrage d'ownership dans `backend/src/middleware/ownership.middleware.ts` ;
- validation Zod dans `backend/src/middleware/validation.middleware.ts` et les routes backend ;
- protections `express-mongo-sanitize`, `helmet` et `express-rate-limit` dans le backend ;
- chiffrement et gestion JWT dans `backend/src/utils/encryption.ts` et `backend/src/utils/jwt.ts`.

Point de vigilance immediat : `backend/src/websocket/WebSocketManager.ts` genere encore un `userId` temporaire cote socket au lieu de s'appuyer sur une authentification forte. Toute user story touchant le runtime temps reel doit traiter cette dette explicitement.

### 4.2 Exigence de clarte vis-a-vis de la codebase

Le backlog doit conduire a une implementation lisible et coherente avec la structure existante :

- aucune logique metier complexe ne reste dans `backend/src/routes/**` ;
- `App.tsx` ne doit plus etre le point d'orchestration de la persistance metier ;
- les nouveaux fichiers doivent suivre la separation domaine/application/infrastructure decrite par le plan ;
- les deplacements de code doivent reduire la derive V1/V2, pas la masquer.

### 4.3 Exigence de stabilite des tests

La base de reference est que les tests actuels sont attendus a 100 % de reussite avant et apres les travaux.

Toute user story qui modifie du code, des fichiers ou des dossiers doit donc definir :

- les suites minimales a rejouer ;
- les fixtures a adapter ;
- les tests de non-regression a ajouter ;
- les criteres de retour a l'etat vert avant fusion.

Commandes de reference deja presentes dans la codebase :

- `npm test`
- `npm run test:coverage`
- `npm run test:integration:hydration`
- `npm run test:components:ci`
- `npm run test:canvas:non-regression`
- `npm run test:j7:editor:semi-e2e`
- `cd backend && npm test`
- `cd backend && npm run test:coverage`
- `npm run ci:node25:runtime`

### 4.4 Fixtures et donnees QA deja presentes

Les testeurs QA et les tests automatiques s'appuient deja sur des fixtures qu'il faut preserver ou faire evoluer explicitement :

- `tests/fixtures/workspaceHydration.fixtures.ts` pour l'hydratation frontend ;
- `backend/src/__tests__/workspace-snapshot.test.ts` pour le snapshot unifie backend ;
- les fixtures d'authentification, runs, sandbox et routes backend dans `backend/src/__tests__/**` ;
- les seeds et jeux de donnees techniques dans `backend/src/seeds/**` et `backend/src/services/databaseInit.ts`.

Toute evolution de contrat ou de comportement touchant workflow, hydratation, runtime, runs, tasks ou snapshots doit identifier l'adaptation fonctionnelle attendue sur ces fixtures.

## 5. Vue d'ensemble des jalons

### Mise a jour d'etat (2026-10-27)

Le projet a ete stabilise sur la ligne runtime supportee Node 24.22.1 LTS, avec les garde-fous de securite et de qualite valides sur les zones critiques. Le backlog doit donc etre lu comme suit :

- `J0` : valide, avec inventaire et garde-fous anti-derive en place.
- `J1` : valide sur le plan des contrats metier, des permissions, de la validation d'entree et de la journalisation.
- `J2` : valide et clos sur le plan backend V2, avec repositories, use cases et validation d'IR stabilises, et avec couverture de non-regression sur les points de securite critiques.
- `Phase 1` : terminee. Elle a fixe le cadrage architectural, la cartographie V1/V2, les garde-fous anti-derive et la migration V1 -> V2 des graphes comme bascule reproductible et idempotente.
- `Phase 2` : maintenant active. Son objectif est de remplacer progressivement les lectures legacy restantes, de faire de V2 la seule source de verite operationnelle et d'aboutir a un cutover complet sans reliquat de la V1.
- `J3` : devient le jalon actif suivant et doit etre pris en charge par l'agent `04-cicd-installation.agent.md` avec la logique de migration, runtime et bootstrap comme priorite.
- `J4` a `J6` : non demarres ou a lancer selon les validations de migration, de resilience et de cutover associees.

> Point de vigilance majeur : la lecture legacy n'est pas encore remplacee dans l'ensemble du codebase. Les migrations et les garde-fous imposent maintenant la bonne direction, mais le plan n'est considere comme complet que lorsque V2 est operationnelle et qu'il ne reste plus aucun reliquat fonctionnel ou technique de V1.

| Jalon | Intitule | Criticite | Agent pilote | Resultat attendu |
|---|---|---|---|---|
| J0 | Gel architectural et inventaire | Critique | `01-architecte-bdd.agent.md` | Carte exacte de la derive V1/V2 et garde-fous anti-regression |
| J1 | Contrats metier et securite | Critique | `02-securite.agent.md` | Contrats V2 stabilises, regles d'acces et erreurs metier cadrees |
| J2 | Refactoring backend coeur | Critique | `03-backend.agent.md` | Repositories, use cases et routes minces sur base V2 |
| J3 | Migrations et runtime infra | Critique | `04-cicd-installation.agent.md` | Migrations rejouables, worker, queue et scheduler fiables |
| J4 | Validation domaine et resilience | Haute | `05-testeur-domaine.agent.md` | Invariants, transitions et scenarios de panne couverts |
| J5 | Cutover frontend V2 | Critique | `06-frontend.agent.md` | Frontend decouple de V1 et pilote par contrats V2 |
| J6 | Validation finale de livraison | Critique | `08-testeur-e2e.agent.md` | Non-regression bout en bout et recommandation Go/No-Go |
| J7 | Remediation des blocages J6 | Critique | `03-backend.agent.md` (coordination technique) | Runs durables et annulables, sortie sure de quarantaine (fencing label/ID + fence-and-retry), deploiement valide sur l'hote cible, UI runtime V2, J6 reexecute avec gate Go/No-Go |

### Mise a jour d'etat au 2026-11-03

- `J6` est en cours avec un verdict provisoire `NO-GO`; son rapport initial et les preuves sont suivis dans `Guides/Features/feature/refonte/j6-validation-report.md`.
- J5 reste partiellement ferme. Cela ne bloque pas la preparation J6, mais l'UI commandes/runtime demeure une condition du cutover et du verdict final.
- `J7` est ajoute pour traiter les ecarts runtime et UI prouvees par J6, puis fermer J6 sur une nouvelle campagne. Les tests live doivent utiliser une base de test explicitement isolee; ne pas lancer de smoke destructif sur la base de developpement par defaut.

### Mise a jour d'etat au 2026-11-18 (reprise US-J7-02)

- reprise de `US-J7-02` sur la branche `feat/j7-02-quarantine-exit-fencing` ; le travail J7-02 existant est committe (`e05f977`) et la baseline est verte : `npm test` 90 suites/542 tests, `cd backend && npm test` 114 suites/715 tests, `npm run ci:node25:runtime` 3 suites/20 tests, `npm run audit:workflow-architecture:strict` OK.
- la conception de la sortie sure de quarantaine est validee et documentee dans `Guides/Features/feature/refonte/j7-02-quarantine-exit-fencing-design.md` (commit `aa2e6db`).
- arbitrages retenus (responsable projet) : fencing automatique des operations `unknown` de l'ancienne epoch a l'activation d'une nouvelle epoch (le demon rouvre l'admission, plus aucun blocage global) ; run incertain en statut terminal `worker_lost`/`quarantined` avec verrou workspace tenu jusqu'a resolution ; operateur legitime = l'utilisateur proprietaire via `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry` (fallback CLI admin reserve a la maintenance) ; `recoveryPolicy: { autoFenceAndRetry, maxAttempts }` optionnelle par agent (defaut `false`/`0`) ; borne de fencing 30 s (`RECONCILE_TIMEOUT_MS`) puis `504 FENCING_TIMEOUT_ESCALATED` + alerte critique persistée, verrou retenu.
- `US-J7-02` devient un chapeau decoupe en `US-J7-05` a `US-J7-10` (gateway fencing label/ID, contrat de statuts, endpoint fence-and-retry, recoveryPolicy, visibilite, deploiement hote cible) ; `US-J7-11` stabilise les deux echecs connus (`minimize-restore`, attachement workspace live) avant la campagne finale ; `US-J7-12` traite la dette WebSocket (`userId` temporaire) ; `US-J7-03` consommera le nouvel endpoint pour le bouton Reset & Relance (plan UI detaille produit separement par `09-architecte-applicatif` avant execution) ; `US-J7-04` rejouera J6 apres livraison.
- verdict J6 : toujours `NO-GO` tant que le chapeau J7 n'est pas ferme.

## 6. Backlog detaille par jalon

## J0 - Gel architectural et inventaire

**Agent pilote :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite du jalon :** Critique
**But :** figer le perimetre de derive, empecher toute aggravation et etablir la base factuelle de la refonte.

**Fichiers a toucher en priorite :**
- `Guides/Features/feature/refonte/v1-v2-implementation-plan.md`
- `Guides/Features/feature/refonte/v1-v2-drift-analysis.md`
- `Guides/Features/feature/refonte/backlog/v1-v2-refonte-backlog.md`
- `backend/src/routes/workflows.routes.ts`
- `backend/src/routes/agent-instances.routes.ts`
- `backend/src/routes/runs.routes.ts`
- `backend/src/services/databaseInit.ts`
- `App.tsx`
- `types.ts`
- `package.json`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** hydratation frontend, snapshot backend, seeds de bootstrap.
**Changements fonctionnels a anticiper :** aucun changement utilisateur volontaire a ce jalon, mais toute zone legacy identifiee doit etre signalee comme impact potentiel de refactor ou de suppression.

### US-J0-01 - Cartographier les points d'entree V1 et V2

**Agent responsable :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite :** Critique
**Description :** identifier tous les flux backend et frontend qui lisent, ecrivent ou reconstruisent des donnees de workflow a partir des representations V1 et V2.
**Dependances :** aucune.
**Risques et consequences :**
- si une zone V1 reste non detectee, une future migration peut laisser une double source de verite ;
- si la cartographie est incomplete, des suppressions de code legacy risquent de casser des parcours encore actifs ;
- un oubli dans l'hydratation frontend peut produire des workflows partiellement affiches ou incorrectement restaures.
**Impacts codebase et tests :**
- peut conduire a creer ou mettre a jour des fichiers d'inventaire dans `Guides/Features/feature/refonte/` ;
- doit pointer les surfaces a risque dans `App.tsx`, `backend/src/routes/**` et `backend/src/services/databaseInit.ts` ;
- doit aussi signaler les surfaces de derive non prioritaires mais actives comme `stores/useWorkflowStore.ts` et `services/workspacePersistenceService.ts` lorsqu'elles reconstruisent ou reroutent des writes workflow ;
- ne doit modifier aucun contrat applicatif a ce stade.
**Criteres d'acceptation :**
- chaque point d'entree est classe en lecture, ecriture ou compatibilite ;
- les zones backend, frontend et migration sont traitees ;
- le resultat est documente de facon exploitable par les jalons suivants.

### US-J0-02 - Etablir l'inventaire automatise V1/V2

**Agent responsable :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite :** Critique
**Description :** produire un audit reproductible des references V1/V2 avec une classification exploitable en revue et en CI.
**Dependances :** US-J0-01.
**Risques et consequences :**
- sans audit automatise, la dette peut revenir silencieusement dans de nouveaux fichiers ;
- un script trop permissif laissera passer des ecritures V1 en production ;
- un script trop strict bloquera la migration en signalant des cas de compatibilite legitimes.
**Impacts codebase et tests :**
- peut ajouter `scripts/audit-workflow-architecture.ts` et des scripts npm associes ;
- doit pouvoir s'integrer a la CI sans casser les suites existantes ;
- doit rester compatible avec les zones legacy tolerees pendant la transition.
**Criteres d'acceptation :**
- presence d'un rapport d'inventaire versionne ;
- presence d'une commande d'audit reutilisable ;
- absence de references classees `UNKNOWN`.

### US-J0-03 - Poser les garde-fous anti-derive

**Agent responsable :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite :** Critique
**Description :** marquer les routes legacy, formaliser l'interdiction des nouvelles ecritures V1 et preparer le terrain pour le cutover.
**Dependances :** US-J0-01, US-J0-02.
**Risques et consequences :**
- sans garde-fous, les correctifs opportunistes continueront de s'ajouter au mauvais modele ;
- une depreciation non instrumentee rendra le retrait legacy aveugle ;
- un gel mal cible peut freiner des correctifs legitimes sur des parcours critiques existants.
**Impacts codebase et tests :**
- peut modifier de la documentation, des annotations de routes et des scripts de revue ;
- ne doit pas changer le comportement fonctionnel sans test de non-regression ;
- doit conserver toutes les suites existantes au vert.
**Criteres d'acceptation :**
- les points legacy sont marques de maniere explicite ;
- les nouvelles contributions ont une regle claire anti-V1 ;
- des logs ou compteurs permettent de mesurer l'usage restant.

## J1 - Contrats metier et securite

**Agent pilote :** `02-securite.agent.md` - Securite
**Criticite du jalon :** Critique
**But :** stabiliser les contrats V2 et encadrer la refonte par des regles d'acces, de validation et de protection des donnees.

**Fichiers a toucher en priorite :**
- `backend/src/domain/**`
- `backend/src/types/workflow-ir.ts`
- `backend/src/types/workflow-status.ts`
- `backend/src/types/execution-policy.ts`
- `backend/src/middleware/auth.middleware.ts`
- `backend/src/middleware/ownership.middleware.ts`
- `backend/src/middleware/validation.middleware.ts`
- `backend/src/utils/jwt.ts`
- `backend/src/utils/encryption.ts`
- `backend/src/websocket/WebSocketManager.ts`
- `backend/src/routes/workflows.routes.ts`
- `backend/src/routes/runs.routes.ts`
- `backend/src/routes/agent-instances.routes.ts`
- `backend/src/__tests__/schemas.test.ts`
- `backend/src/__tests__/auth-workflows.routes.test.ts`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** `tests/fixtures/workspaceHydration.fixtures.ts`, `backend/src/__tests__/workspace-snapshot.test.ts`, fixtures d'auth et de permissions.
**Changements fonctionnels a anticiper :** validation plus stricte, refus explicites sur transitions invalides, restrictions d'acces plus fermes, eventuels workflows legacy desormais rejetes a la publication.

### US-J1-01 - Definir les contrats canoniques du domaine V2

**Agent responsable :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite :** Critique
**Description :** definir les entites et DTO cibles pour `WorkflowDefinition`, `WorkflowNode`, `WorkflowEdge`, `WorkflowRun`, `TaskInstance` et les erreurs metier stables.
**Dependances :** J0 termine.
**Risques et consequences :**
- un contrat ambigu creera des divergences entre backend, frontend et migrations ;
- un melange entre entites domaine et schemas MongoDB figera une dette de conception ;
- des erreurs metier non stabilisees rendront les clients difficiles a maintenir.
**Impacts codebase et tests :**
- peut creer ou deplacer des types backend dans `backend/src/domain/**` et `backend/src/types/**` ;
- doit identifier avant modification les impacts sur `tests/fixtures/workspaceHydration.fixtures.ts` et `backend/src/__tests__/workspace-snapshot.test.ts` ;
- toute evolution de contrat doit entrainer des mises a jour coordonnees des DTO, schemas et tests.
**Criteres d'acceptation :**
- les contrats V2 sont documentes et distincts des structures V1 ;
- les statuts et revisions sont definis ;
- les proprietes legacy ne sont pas reintroduites dans le domaine canonique.

### US-J1-02 - Definir les state machines de run et de task

**Agent responsable :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite :** Critique
**Description :** centraliser toutes les transitions valides et interdire explicitement les transitions illegales.
**Dependances :** US-J1-01.
**Risques et consequences :**
- des transitions diffuses dans plusieurs services creent des courses et des etats impossibles ;
- une annulation mal definie peut laisser des runs visibles comme actifs alors que les workers ont cesse ;
- une reprise mal bornee peut dupliquer des executions ou des artefacts.
**Impacts codebase et tests :**
- peut creer des modules de domaine et des tests unitaires dedies ;
- doit rester independant d'Express, React et Mongoose ;
- doit augmenter la couverture sans casser les parcours existants.
**Criteres d'acceptation :**
- toutes les transitions valides et invalides sont testees ;
- les etats terminaux sont irreversibles ;
- les state machines sont independantes du transport et de la persistance.

### US-J1-03 - Construire le threat model et la matrice de permissions

**Agent responsable :** `02-securite.agent.md` - Securite
**Criticite :** Critique
**Description :** analyser la surface d'attaque de la refonte et definir les regles d'autorisation sur workflows, nodes, runs, tasks et artefacts.
**Dependances :** US-J1-01.
**Risques et consequences :**
- une faille d'IDOR sur les runs ou artefacts exposerait des donnees d'un autre utilisateur ;
- des permissions floues sur activation et annulation peuvent laisser un utilisateur piloter des executions hors de son perimetre ;
- l'absence de modelisation des frontieres de confiance fragilise les integrations async et temps reel.
**Impacts codebase et tests :**
- peut modifier middlewares, filtres d'ownership ou schemas de route ;
- doit traiter explicitement la situation actuelle de `backend/src/websocket/WebSocketManager.ts` ;
- doit ajouter ou renforcer des tests d'acces autorise/refuse.
**Criteres d'acceptation :**
- threat model documente ;
- matrice de permissions ressource/action disponible ;
- regles deny-by-default definies sur les ressources critiques.

### US-J1-04 - Verrouiller validation d'entree et politiques de journalisation

**Agent responsable :** `02-securite.agent.md` - Securite
**Criticite :** Critique
**Description :** imposer validation Zod, protection contre les injections, hygiene des logs et non-exposition des secrets dans API et Socket.IO.
**Dependances :** US-J1-03.
**Risques et consequences :**
- une validation insuffisante peut corrompre le graphe ou provoquer des executions invalides ;
- des logs trop verbeux peuvent exposer des tokens, prompts ou secrets d'integration ;
- un durcissement tardif obligera a reprendre plusieurs routes et evenements deja livres.
**Impacts codebase et tests :**
- peut modifier routes, middleware de validation, middleware de logs et payloads temps reel ;
- doit conserver la compatibilite avec les schemas Zod deja testes ;
- doit s'accompagner de tests sur refus d'entrees invalides et masquage des secrets.
**Criteres d'acceptation :**
- politique de validation et de journalisation documentee ;
- tests sur refus d'entrees invalides et masquage des secrets ;
- aucune route ciblee n'accepte d'identifiant client non filtre par proprietaire.

## J2 - Refactoring backend coeur

**Agent pilote :** `03-backend.agent.md` - Backend
**Criticite du jalon :** Critique
**But :** deplacer la logique metier hors des routes et faire de V2 l'unique chemin d'ecriture metier.

**Fichiers a toucher en priorite :**
- `backend/src/routes/workflows.routes.ts`
- `backend/src/routes/runs.routes.ts`
- `backend/src/routes/agent-instances.routes.ts`
- `backend/src/controllers/workflow.controller.ts`
- `backend/src/application/**`
- `backend/src/infrastructure/repositories/**`
- `backend/src/validators/workflow-validator.ts`
- `backend/src/domain/run-state-machine.ts`
- `backend/src/domain/task-state-machine.ts`
- `backend/src/services/**`
- `backend/src/__tests__/workflow-crud-flow.test.ts`
- `backend/src/__tests__/transition-routes.test.ts`
- `backend/src/__tests__/workspace-snapshot.test.ts`
- `backend/src/__tests__/function-runs.routes.test.ts`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** fixtures runs, snapshots backend, transitions workflow, routes legacy encore supportees.
**Changements fonctionnels a anticiper :** nouvelles erreurs metier homogenes, publication bloquee sur IR invalide, annulation et reprise plus strictes, payloads de runs susceptibles d'evoluer.

**Etat d'avancement au 2026-10-27 :**
- `J0` et `J1` sont stabilises sur la ligne runtime supportee Node 24.22.1 LTS et sur les garde-fous de securite / validation documentes dans le backlog.
- `J2` est valide et ferme : extraction des repositories/use cases, validation d'IR sur activation et non-regression sur les nœuds agent dont `instanceId` n'existe pas dans le workflow courant, ainsi que stabilisation des erreurs metier sur les routes workflow.
- Les endpoints legacy restent a surveiller comme surfaces de derive, mais ils sont maintenant encadres par des validations et une politique de non-regression.
- **Point de securite J2 impose :** toute validation d'activation de workflow doit rejeter les nœuds agent dont `instanceId` ne correspond pas a une instance existante dans le workflow. Ce garde-fou est documente dans le backlog et couvert par test de non-regression ; la main bascule maintenant vers le jalon J3.
- **Basculement de jalon :** la suite du backlog est transferee a l'agent `04-cicd-installation.agent.md` pour `J3 - Migrations et runtime infra`, avec focus sur bootstrap, migrations idempotentes, workers, queues et health checks.

### US-J2-01 - Extraire les repositories canoniques

**Agent responsable :** `03-backend.agent.md` - Backend
**Criticite :** Critique
**Description :** definir et implementer les repositories V2 pour workflows, nodes, edges, agent instances, runs, tasks et artifacts.
**Dependances :** J1 termine.
**Risques et consequences :**
- sans couche repository, la logique Mongoose restera dupliquee et difficile a fiabiliser ;
- une extraction incomplete laissera des contournements directs depuis les controllers ;
- un mauvais traitement de revision peut provoquer des conflits silencieux et des pertes de mise a jour.
**Impacts codebase et tests :**
- peut creer `backend/src/infrastructure/repositories/**` et deplacer du code hors des routes ;
- doit maintenir la compatibilite comportementale des routes existantes ;
- doit s'accompagner de tests de repositories et de conflits de revision.
**Criteres d'acceptation :**
- les controllers ne font plus d'acces directs critiques a Mongoose ;
- les repositories encapsulent la gestion des revisions et des erreurs de persistance ;
- des tests ciblent les chemins nominaux et les conflits.

### US-J2-02 - Extraire les use cases workflow et agent instance

**Agent responsable :** `03-backend.agent.md` - Backend
**Criticite :** Critique
**Description :** deplacer les commandes de creation, edition, publication, activation et suppression dans des use cases testables.
**Dependances :** US-J2-01.
**Risques et consequences :**
- tant que la logique reste dans les routes, toute evolution multiplie le risque de regression transversale ;
- une extraction partielle peut laisser deux comportements differents pour une meme commande ;
- des use cases mal delimites peuvent reintroduire un couplage route/persistance.
**Impacts codebase et tests :**
- peut creer `backend/src/application/**` et alleger `backend/src/routes/**` ;
- doit conserver les contrats HTTP existants tant que le cutover n'est pas annonce ;
- doit etre couvert par tests unitaires et integration API.
**Criteres d'acceptation :**
- les routes deviennent des adaptateurs minces ;
- chaque commande critique possede un use case dedie ;
- les erreurs metier sont homogenes.

### US-J2-03 - Implementer le validateur d'IR dans le flux de publication

**Agent responsable :** `03-backend.agent.md` - Backend
**Criticite :** Critique
**Description :** imposer la validation du graphe et des references avant qu'une version de workflow soit publiee ou activee.
**Dependances :** US-J1-01, US-J1-02, US-J2-02.
**Risques et consequences :**
- sans verrou a la publication, des workflows invalides atteindront le runtime ;
- une activation d'IR incoherente peut produire des runs bloques, des tasks orphelines ou des erreurs de reprise ;
- une validation trop tardive cote worker augmentera le cout de diagnostic.
**Impacts codebase et tests :**
- peut creer `backend/src/validators/workflow-validator.ts` ;
- doit faire evoluer les tests de publication et de transition sans casser les fixtures d'hydratation ;
- doit expliciter tout changement fonctionnel sur les workflows actuellement valides.
**Criteres d'acceptation :**
- la publication echoue sur IR invalide ;
- les erreurs de validation sont explicites et stables ;
- des tests couvrent ports, cycles, references et permissions ;
- un test de non-regression confirme que les nœuds agent ne peuvent plus pointer vers une `instanceId` absente du workflow courant.

### US-J2-04 - Introduire l'API de run et d'annulation idempotente

**Agent responsable :** `03-backend.agent.md` - Backend
**Criticite :** Critique
**Description :** exposer les commandes de lancement, annulation, reprise et suivi de run avec idempotence et erreurs previsibles.
**Dependances :** US-J2-02, US-J1-03, US-J1-04.
**Risques et consequences :**
- une commande non idempotente peut lancer plusieurs executions pour une meme intention utilisateur ;
- une annulation sans semantique stable peut laisser des tasks encore actives ;
- un contrat de run instable casserait rapidement le frontend de pilotage.
**Impacts codebase et tests :**
- peut modifier ou etendre `backend/src/routes/runs.routes.ts` et les services runtime associes ;
- doit garder verts `cd backend && npm test` et `npm run ci:node25:runtime` si le runtime d'execution est touche ;
- doit identifier les fixtures backend impactees sur runs, annulations et snapshots.
**Criteres d'acceptation :**
- un idempotency key est pris en compte sur les commandes critiques ;
- les codes d'erreur sont stables ;
- les tests couvrent doublons, annulation et reprise.
**Etat de transfert au 2026-10-27 :** la main est passee au pilote CI/CD et installation apres validation de J2 sur le backend V2, avec les garde-fous de securite et la non-regression backend confirmee.

## J3 - Migrations et runtime infra

**Agent pilote :** `04-cicd-installation.agent.md` - CI/CD et installation
**Criticite du jalon :** Critique
**But :** rendre la migration de donnees, les workers et le runtime operables, redemarrables et deployables de facon fiable.

**Fichiers a toucher en priorite :**
- `backend/src/services/databaseInit.ts`
- `backend/src/migrations/**`
- `backend/src/seeds/**`
- `backend/src/scripts/**`
- `backend/src/services/runtimeHealth.service.ts`
- `backend/src/services/nativePythonProvisioning.service.ts`
- `backend/docker/**`
- `backend/package.json`
- `package.json`
- `.github/workflows/**`
- `backend/src/__tests__/database-init.seeding.test.ts`
- `backend/src/__tests__/workflow-self-healing.test.ts`
- `backend/src/__tests__/runtime-health.service.test.ts`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** seeds backend, base Mongo locale d'entrainement QA, snapshots backend dependants des migrations, scripts de bootstrap.
**Changements fonctionnels a anticiper :** nouvelles etapes d'initialisation locale, re-seed ou reprise de migration possiblement necessaires, comportements runtime differents apres redemarrage ou panne worker.

### US-J3-01 - Decouper le bootstrap base, migrations et seed

**Agent responsable :** `04-cicd-installation.agent.md` - CI/CD et installation
**Criticite :** Critique
**Description :** separer l'initialisation technique, les migrations de schema, les migrations de donnees et le seed de developpement.
**Dependances :** J2 termine.
**Risques et consequences :**
- un bootstrap monolithique rend les incidents de demarrage difficiles a diagnostiquer ;
- des migrations melangees aux seeders peuvent polluer des environnements de test ou de production ;
- un couplage fort au demarrage complique le rollback et les reprises partielles.
**Impacts codebase et tests :**
- peut scinder `backend/src/services/databaseInit.ts` et ajouter des scripts de demarrage ;
- doit preserver le comportement des seeds QA et techniques existants ;
- doit rester compatible avec `backend/src/__tests__/database-init.seeding.test.ts` et les suites runtime associees.
**Criteres d'acceptation :**
- les responsabilites sont separees ;
- le projet dispose d'un chemin de demarrage explicite par environnement ;
- les scripts sont rejouables sans effet destructif inattendu.

### US-J3-02 - Implementer les migrations V1 vers V2 idempotentes

**Agent responsable :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite :** Critique
**Description :** concevoir et produire les migrations de donnees pour extraire nodes, edges et instances depuis V1 vers V2 avec reprise sur echec.
**Dependances :** US-J3-01, J1 termine.
**Risques et consequences :**
- une migration non idempotente peut dupliquer nodes, edges, runs ou artefacts ;
- un echec sans mecanisme de reprise peut laisser des workflows dans un etat hybride ;
- une perte de correspondance d'identifiants peut casser les edges ou les references d'instance.
- le fait que la lecture legacy ne soit pas encore remplacee impose une discipline stricte : la migration ne doit pas perpetuer la source V1 comme source de verite operationnelle.
**Impacts codebase et tests :**
- peut creer de nouvelles migrations dans `backend/src/migrations/**` ;
- doit inventorier avant changement les impacts sur les fixtures backend de snapshot, auth workflow et runs ;
- doit etre valide par tests de migration verte, rerun et reprise sur echec.
**Criteres d'acceptation :**
- les migrations peuvent etre relancees sans doublon ;
- une execution interrompue peut reprendre ;
- des tests couvrent une base historique et une base deja partiellement migree ;
- la phase suivante doit commencer avec un plan de remplacement explicite des chemins de lecture legacy encore actifs.
**Etat de transfert au 2026-10-28 :** l'US-J3-02 est validée. La migration V1 -> V2 est idempotente, rejouable et couverte par tests de rerun et de reprise. La source de vérité pour le graphe workflow est orientée vers V2, et la phase 2 de cutover opérationnel a été validée par neutralisation explicite des lectures legacy restantes et par la garde-fou V2-only sur les snapshots / routes de compatibilité. La main est transmise au jalon J3 suivant avec les composants runtime, les workers et les health checks en priorité.

**Livrables confirmes :**
- migration `008_workflow_v1_to_v2_migration.ts` et script npm `migrate:workflow-v1-v2` ;
- tests de migration verts sur scenario nominal et rerun idempotent ;
- document de phase 1 `v1-v2-workflow-migration-phase-1.md` aligne sur le contrat V2 ;
- garde-fous anti-derive et contraintes de source de verite explicites pour la suite ;
- neutralisation des lectures legacy restantes sur les flux de compatibilité workflow et snapshot V2.

**Travail restant après J3-02 :**
- aucune blocage de cutover V2 opérationnel restant sur le cœur de migration graphe/workflow ;
- lancer `US-J3-03` sur worker, queue, scheduler et health checks ;
- poursuivre avec `US-J3-04` sur les evenements runtime versionnes ;
- maintenir la vigilance sur les compatibilites explicites qui doivent rester marquées comme V2-only.

**Handoff J3-02 -> J3-03 :** la migration est fermée sur le plan V1->V2; la suite est désormais pilotée par l'agent `04-cicd-installation.agent.md` pour le runtime infra, avec l'agent `03-backend.agent.md` qui reprend la responsabilité des événements runtime versionnés dès la livraison de la base runtime stabilisée.
### Phase 2 - Remplacement des lectures legacy / cutover V2 operationnel

**Objet :** achever la bascule de V1 vers V2 en faisant de V2 la source de verite operationnelle et en supprimant les reliquats de lecture legacy.

**Etat courant :** la phase 1 a produit le cadrage, les garde-fous anti-derive, les validations et les migrations idempotentes. La lecture legacy ne reste pas encore remplacee sur l'ensemble du système, donc le cutover total n'est pas encore termine.

**Cibles phase 2 :**
- neutraliser ou retirer les points de lecture legacy encore actifs dans les routes, services et snapshots ;
- faire de V2 le chemin de lecture et d'ecriture par defaut pour les workflows, nodes, edges, runs et tasks ;
- verifier qu'aucun symptome de reliquat V1 n'est present dans les fixtures, les hydrations et les deploiements locaux ;
- conclure sur un etat operationnel V2 sans dette de lecture residuelle de V1.

**Definition of Done de la phase 2 :**
- V2 est la seule source de verite operationnelle ;
- les chemins V1 legacy sont desactivees ou supprimes avec compatibilite explicite et tracee ;
- les tests et fixtures critiques restent verts ;
- le projet est capable de fonctionner en V2 operationnelle sans reliquat de la V1.

### Cartographie runtime et delegation frontend

**Producteurs backend :**
- `backend/src/services/userToolRun.service.ts` publie les transitions de run et de task au moment des changements d'etat critiques ;
- `backend/src/services/taskRuntimeInfra.service.ts` pilote la file, le lease et les retries, en produisant les etats de runtime utilises pour le suivi ;
- `backend/src/services/runtimeEventPublisher.service.ts` normalise le type d'evenement, le payload et la deduplication par workspace / aggregate.

**Consommateurs / canaux :**
- `backend/src/websocket/WebSocketManager.ts` autorise uniquement les sockets authentifiees et appartenant au bon workspace avant l'emission ;
- le client consomme `runtime:event` via un pont d'observation runtime (bridge / router / reducer), sans reconstruire de source de verite locale V1 ;
- le frontend affiche uniquement l'etat serveur expose par le flux event-sourcing versionne, avec gestion propre des etats loading, error, offline et partial.

**Regles de semantique a conserver :**
- `run:queued`, `run:started`, `run:progressed`, `run:completed`, `run:failed`, `run:stopped` sont exclusifs et interpretes comme des evenements de cycle, pas comme des proprietes ad hoc ;
- `task:queued`, `task:started`, `task:progressed`, `task:completed`, `task:failed`, `task:cancelled`, `task:blocked` suivent la meme logique de versionnage et de filtration ;
- les payloads ne doivent jamais contenir des champs secrets, tokens ou cles d'API ; les filtres doivent rester centralises dans le contrat V2 et le publisher.

**Delegation frontend :**
- la vue front ne doit plus recalculer l'etat de run depuis une reconstruction locale de `Workflow.nodes` ;
- l'UI doit se brancher sur le contrat backend V2 et sur les evenements runtime versionnes, avec un reducer de state dedie pour le suivi des runs et tasks activement executés ;
- toute adaptation de fixtures d'hydratation ou de canvas doit rester liee a une evolution fonctionnelle explicite du contrat, pas a une correction locale d'UI.

### US-J3-03 - Industrialiser worker, queue et scheduler

**Agent responsable :** `04-cicd-installation.agent.md` - CI/CD et installation
**Criticite :** Critique
**Description :** definir et mettre en place l'execution asynchrone, les leases de task, les health checks et les comportements de reprise.
**Dependances :** US-J2-04, US-J3-01.
**Risques et consequences :**
- un worker sans lease robuste peut executer une meme task deux fois ;
- Redis utilise comme source de verite provoquerait une perte d'etat au redemarrage ;
- un scheduler mal borne peut declencher des runs en double ou hors fenetre attendue.
**Impacts codebase et tests :**
- peut ajouter des fichiers runtime, docker, health checks ou variables d'environnement ;
- doit documenter tout nouveau dossier ou service auxiliaire ;
- doit rester compatible avec `npm run ci:node25:runtime` et les tests de reprise.
**Criteres d'acceptation :**
- les roles de MongoDB et Redis sont documentes ;
- health checks et scripts de demarrage existent ;
- les tests couvrent panne worker, tache abandonnee et redemarrage.

**Etat de transfert au 2026-10-28 :** l'US-J3-03 est validée. Le worker, la queue, le scheduler, les leases de task, les retries et les chemins de reprise après redémarrage sont stabilisés, et les health checks couvrent la disponibilité du runtime sans dépendance Redis comme source de vérité métier. La main est transmise à l'agent `03-backend.agent.md` pour `US-J3-04`, avec la responsabilité de livrer les événements runtime versionnés, filtrés et cohérents avec le runtime J3 validé. Le contrat d'exécution asynchrone est désormais stable et la suite backend doit s'appuyer sur ce socle sans réintroduire de lecture legacy dans le flux temps réel.

### US-J3-04 - Publier les evenements runtime versionnes

**Agent responsable :** `03-backend.agent.md` - Backend
**Criticite :** Hautes
**Description :** exposer les evenements temps reel necessaires au suivi des runs et tasks sans divulgation de donnees sensibles.
**Dependances :** US-J2-04, US-J1-04, US-J3-03.
**Risques et consequences :**
- un schema d'evenement instable forcera des adaptations frontend frequentes ;
- une emission trop verbeuse peut degrader les performances ou exposer des informations sensibles ;
- l'absence de versionnage rendra les clients fragiles lors des evolutions futures.
**Impacts codebase et tests :**
- peut modifier `backend/src/websocket/**` et les services runtime ;
- doit documenter l'impact sur les parcours de reconnexion et de suivi frontend ;
- doit ajouter des tests de payload et de filtrage utilisateur.
**Criteres d'acceptation :**
- les evenements runtime utiles sont identifies et versionnes ;
- les donnees sensibles sont exclues ;
- des tests couvrent le payload et le filtrage utilisateur.

**Etat de transfert au 2026-10-28 :** l'US-J3-04 est validée. Les événements runtime sont désormais versionnés, filtrés, sécurisés par workspace et couverts par tests de contrat et de publication. Le socle runtime J3/J3-04 est stable et le handoff est explicitement donné à l'agent `05-testeur-domaine.agent.md` pour `J4 - Validation domaine et resilience`. La validation J4 doit s'appuyer sur les invariants runtime déjà stabilisés, les fixtures backend et les suites de migration / runtime déjà vertes, sans reintroduire de reconstruction V1 dans le parcours de suivi temps réel.

## J4 - Validation domaine et resilience

**Agent pilote :** `05-testeur-domaine.agent.md` - Testeur domaine
**Criticite du jalon :** Haute
**But :** prouver que les invariants V2 tiennent face aux transitions, erreurs de reseau, reprises et donnees legacy.

**Fichiers a toucher en priorite :**
- `backend/src/__tests__/**`
- `tests/**`
- `backend/src/domain/**`
- `backend/src/migrations/**`
- `backend/src/routes/runs.routes.ts`
- `backend/src/routes/workflows.routes.ts`
- `backend/src/websocket/WebSocketManager.ts`
- `backend/src/__tests__/workspace-snapshot.test.ts`
- `backend/src/__tests__/workflow-self-healing.test.ts`
- `backend/src/__tests__/auth-workflows.routes.test.ts`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** toutes les fixtures backend liees aux runs, migrations, auth, snapshots et runtime.
**Changements fonctionnels a anticiper :** aucun changement produit par les tests eux-memes, mais toute regression decouverte doit etre reclassifiee en impact fonctionnel, securite ou donnees avant correction.

### US-J4-01 - Couvrir les invariants et transitions critiques

**Agent responsable :** `05-testeur-domaine.agent.md` - Testeur domaine
**Criticite :** Haute
**Description :** mettre en place les tests unitaires et integration couvrant statuts, transitions, refus et erreurs de contrat.
**Dependances :** J2 termine.
**Risques et consequences :**
- sans matrice de couverture claire, des regressions de domaine passeront jusqu'en E2E ;
- des transitions invalides non testees peuvent reintroduire des etats impossibles ;
- une couverture insuffisante sur les erreurs laissera des comportements differents selon les routes.
**Impacts codebase et tests :**
- peut creer de nouveaux tests unitaires et integration backend ;
- doit preciser quelles suites existantes doivent rester vertes sans baisse de couverture utile ;
- ne doit pas masquer une regression par simple assouplissement d'assertions.
**Criteres d'acceptation :**
- chaque etat majeur de run et task est teste ;
- les transitions interdites sont explicitement verifiees ;
- les erreurs de contrat sont couvertes.

### US-J4-02 - Tester migrations, idempotence et compatibilite legacy

**Agent responsable :** `05-testeur-domaine.agent.md` - Testeur domaine
**Criticite :** Critique
**Description :** valider la migration V1 -> V2, sa reexecution et la lisibilite des donnees historiques apres bascule.
**Dependances :** US-J3-02.
**Risques et consequences :**
- une migration apparemment correcte peut casser des cas historiques rares ;
- un rerun non teste peut produire des doublons une fois en CI/CD ou en reprise reelle ;
- une compatibilite surestimee peut faire perdre des workflows existants a l'ouverture.
**Impacts codebase et tests :**
- s'appuie sur fixtures backend ou jeux de donnees representatifs ;
- doit verifier que les snapshots, runs et hydrations restaurent les memes informations utiles ;
- doit produire un rapport des ecarts residuels si des cas legacy restent differes.
**Criteres d'acceptation :**
- tests de migration verte, relance et reprise apres echec ;
- verification des donnees V1 converties ;
- rapport des ecarts residuels documente.

### US-J4-03 - Tester resilience runtime, retries et annulations

**Agent responsable :** `05-testeur-domaine.agent.md` - Testeur domaine
**Criticite :** Haute
**Description :** reproduire les scenarios de panne sur worker, queue, dependance externe et annulation en cours d'execution.
**Dependances :** US-J3-03, US-J3-04.
**Risques et consequences :**
- sans test de panne, la premiere reprise reelle se fera en production ;
- une annulation non fiable peut laisser des effets de bord ou des artefacts incomplets ;
- des retries mal bornes peuvent creer des surcouts ou des blocages en cascade.
**Impacts codebase et tests :**
- peut ajouter des tests de panne et de redemarrage ;
- doit couvrir timeout, retry, tache dupliquee et abandonnee ;
- doit verifier que les evenements temps reel ne masquent pas l'etat metier reel.
**Criteres d'acceptation :**
- panne worker et reprise validees ;
- tache dupliquee et abandonnee testees ;
- timeout, retry et annulation couverts avec assertions precises.

**Etat de transfert au 2026-10-28 :** l'US-J4-03 est validée. Le runtime a été vérifié sur les scénarios de retry, annulation terminale, lease expiré, tâche abandonnée, worker redémarré et reprise après panne, avec les familles de tests backend associées vertes. Les invariants V2 sont donc confirmés pour la validation métier du J4, et le J4 est clos sur les critères de résilience runtime. La main est transmise à l'agent `06-frontend.agent.md` pour `J5 - Cutover frontend V2`, avec la consigne de ne plus reconstruire une source de vérité locale à partir des structures legacy et de ne consommer que les DTO et événements runtime V2 validés.

## J5 - Cutover frontend V2

**Agent pilote :** `06-frontend.agent.md` - Front-end
**Criticite du jalon :** Critique
**But :** retirer la logique de persistance hybride du frontend et consommer les contrats serveur comme source de verite unique.

**Fichiers a toucher en priorite :**
- `App.tsx`
- `types.ts`
- `stores/**`
- `services/**`
- `contexts/**`
- `components/workflow/**`
- `components/V2AgentNode.tsx`
- `components/WorkflowCanvas.tsx`
- `components/RobotPageRouter.tsx`
- `tests/fixtures/workspaceHydration.fixtures.ts`
- `tests/fonctionnels/App.workspaceHydration.integration.test.tsx`
- `tests/unitaires/App.workspaceHydration.test.tsx`
- `tests/components/WorkflowCanvas.render.test.tsx`
- `tests/components/WorkflowCanvas.drag-collision.test.tsx`
- `tests/components/WorkflowCanvas.minimize-restore.test.tsx`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** `tests/fixtures/workspaceHydration.fixtures.ts`, tests d'hydratation, tests canvas, parcours live utilisant des payloads de workspace.
**Changements fonctionnels a anticiper :** changement de forme ou de timing de l'hydratation, actions runtime desactivees selon l'etat reel serveur, messages d'erreur et etats partiels plus explicites.

### US-J5-01 - Decouper `App.tsx` et isoler les domaines frontend

**Agent responsable :** `06-frontend.agent.md` - Front-end
**Criticite :** Critique
**Description :** sortir de `App.tsx` les responsabilites d'hydratation, persistance et orchestration au profit de services ou stores par domaine.
**Dependances :** J2 termine.
**Risques et consequences :**
- tant que `App.tsx` centralise tout, chaque changement runtime menace les parcours design ;
- un decoupage mal sequence peut casser l'initialisation globale de l'application ;
- une migration front trop rapide peut rendre le canvas inutilisable si les stores ne sont pas synchronises.
**Impacts codebase et tests :**
- peut creer ou deplacer des fichiers dans `stores/**`, `services/**` et `components/**` ;
- doit adapter `tests/fixtures/workspaceHydration.fixtures.ts` uniquement si les contrats evoluent reellement ;
- doit conserver au vert `npm run test:integration:hydration`.
**Criteres d'acceptation :**
- `App.tsx` n'orchestre plus directement la persistance workflow ;
- les domaines workflow, nodes, edges, instances et runs sont separes ;
- les tests d'hydratation restent verts.

### US-J5-02 - Brancher l'UI sur les contrats V2 de workflow et run

**Agent responsable :** `06-frontend.agent.md` - Front-end
**Criticite :** Critique
**Description :** consommer les DTO backend pour publication, activation, lancement, annulation et suivi des runs sans reconstruire de verite locale V1.
**Dependances :** US-J5-01, US-J2-04, US-J3-04.
**Risques et consequences :**
- une UI qui reconstruit encore des objets legacy peut afficher un etat faux par rapport au serveur ;
- un mauvais mappage des statuts peut activer des actions interdites ;
- un suivi temps reel mal filtre peut melanger les runs de plusieurs workflows.
**Impacts codebase et tests :**
- peut modifier services API, stores runtime et composants de pilotage ;
- doit laisser verts `npm run test:integration:hydration`, `npm run test:components:ci` et `npm run test:canvas:non-regression` ;
- doit tracer explicitement toute adaptation de fixtures comme evolution fonctionnelle et non comme simple correction de test.
**Criteres d'acceptation :**
- les commandes runtime sont basees sur les API V2 ;
- les etats loading, error, empty, offline et partial sont traites ;
- les actions impossibles sont desactivees.

### US-J5-03 - Finaliser l'observation runtime et la non-regression d'usage

**Agent responsable :** `06-frontend.agent.md` - Front-end
**Criticite :** Haute
**Description :** afficher les runs et tasks en temps reel, gerer la reconnexion et maintenir la stabilite du canvas pendant les executions.
**Dependances :** US-J5-02.
**Risques et consequences :**
- une mise a jour temps reel mal integree peut perturber le canvas ou reinitialiser des selections utilisateur ;
- l'absence de mode degrade rendra l'application opaque en cas de perte de canal ;
- une mauvaise gestion des erreurs runtime peut donner l'impression que le workflow est bloque alors que seul le suivi l'est.
**Impacts codebase et tests :**
- peut modifier les composants runtime et le branchement socket ;
- doit rester coherent avec le durcissement securite du temps reel ;
- doit ajouter des tests d'interaction et de reconnexion si le comportement change.
**Criteres d'acceptation :**
- suivi des runs et tasks visible et coherent ;
- comportement de reconnexion defini ;
- tests d'interaction et de non-regression sur les parcours critiques.

### Etat de contexte J5 au 2026-10-29 (relecture de validation)

**Verdict : J5 partiellement realise.** Les ecarts 1 a 3 sont reportes dans J7 et ne bloquent pas la preparation ni les tests J6 isoles. Ils restent bloquants pour les parcours UI correspondants et pour tout verdict final `GO` ; le handoff J6 de cloture intervient apres leur correction.

**Realise et verifie**
- US-J5-01 : l'orchestration hydratation / bascule de workflow est sortie de `App.tsx` (`hooks/useAppWorkflowController.ts`, `hooks/useWorkspaceHydrationOrchestrator.ts`) ; `useDesignStore` est la source canonique de l'identite workflow, `WorkflowCanvas` ne lit plus `useWorkflowStore` pour l'identifiant.
- US-J5-02 (partiel) : `services/workflowRunService.ts` expose lancement, lecture et annulation via `/api/runs` (V2, idempotence geree cote backend) ; `services/runtimeActionPolicy.ts` desactive les actions selon l'etat serveur.
- US-J5-03 (partiel) : `App.tsx` branche `webSocketService` (`runtimeEvent`, etat de connexion) sur `useRuntimeStore` (`runStatuses`, `taskStatuses`, `runtimeConnectionState`), couvert par `tests/stores/useRuntimeStore.runtime-events.test.ts`.
- Stabilite du canvas : le viewport par workflow est restaure au retour sur la carte (correctif du decalage haut/gauche, reproduit puis valide en navigateur reel par `tests/fonctionnels/WorkflowCanvas.route-reentry.semi-e2e.spec.ts` avec des agents authentifies).
- Verts au 2026-10-29 : `npm run test:integration:hydration` (3), `npm run test:components:ci` (31 suites, 109 tests), `npm run test:canvas:non-regression` (11), jest `tests/unitaires` + `tests/fonctionnels` (53 suites au total avec les precedentes), `npm run audit:workflow-architecture:strict` (OK).

**Ecarts restants avant handoff J6 (mise a jour 2026-10-29)**
1. A implementer, documente dans `Guides/Features/WORKFLOWLINKS/README.md` : `components/workflow/WorkflowToolbar.tsx` n'est monte nulle part dans l'application (seulement dans ses tests) : aucune commande de run n'est accessible a l'utilisateur.
2. A implementer, documente dans `Guides/Features/WORKFLOWLINKS/README.md` : `Reprendre` relance un nouveau run, `Pause` et `Arreter` appellent tous deux `cancelRun`, et l'annulation n'a pas de confirmation.
3. A implementer, documente dans `Guides/Features/WORKFLOWLINKS/README.md` : `useRuntimeStore.runStatuses`, `taskStatuses` et `runtimeConnectionState` sont alimentes mais aucun composant ne les affiche ; la toolbar passe `isOffline` et `isPartial` a `false` en dur.
4. **CORRIGE le 2026-10-29** : `useWorkflowStore` ne conserve plus de graphe (plus de `nodes` / `edges`, de liste `workflows` ni de persistance locale `workflow-editor-data`) ; la toolbar lit le graphe dans `useDesignStore`. `NodeConfigPanel` et `useWorkflowIntegration` (sans importeur, dependants de l'agregat local) sont supprimes. Suite jest complete verte : 90 suites, 541 tests.
5. Reporte dans un autre backlog : `WorkspacePersistenceService.saveEdges` reste en place pour le seul mode invite et leve une erreur en mode authentifie ; son usage par le front applicatif est a confirmer avant retrait.
6. Reporte dans un autre backlog : tests manquants (interaction de reconnexion socket, affichage des statuts temps reel, parcours lancer / annuler / reprendre depuis l'UI).

**Consigne au prochain agent front (`06-frontend.agent.md`)** : implementer les ecarts 1 a 3 selon `Guides/Features/WORKFLOWLINKS/README.md`, traiter les ecarts 5 et 6 via leur backlog dedie, puis mettre a jour cet etat et seulement alors transmettre a `08-testeur-e2e.agent.md`.

**Anticipation du TODO - Gate de cutover V2 (section 13)**
- Audit architecture V1/V2 strict : OK, aucune lecture legacy critique (reste `COMPATIBILITY` documente).
- Migrations, transitions, resilience : valides (J3 / J4), non modifies par ce chantier.
- Front sans verite locale V1 : atteint pour le graphe (ecart 4 ferme) ; le gate reste conditionnel a la fermeture des ecarts 1 a 3 (commandes de run accessibles) et 5 a 6.
- Fixtures QA : aucune fixture d'hydratation modifiee ; `tests/builders/storeStateBuilders.ts` etendu pour l'etat de viewport (changement UI uniquement, sans contrat serveur).

## J6 - Validation finale de livraison

**Agent pilote :** `08-testeur-e2e.agent.md` - Testeur E2E final
**Criticite du jalon :** Critique
**But :** valider que la refonte est livrable, que les parcours critiques fonctionnent et que la suppression progressive du legacy est soutenable.

**État au 2026-11-03 :** J6 est commencé. Les travaux J5 1 à 3 ne bloquent pas la préparation ni l'exécution des tests isolés J6 ; ils restent des conditions de validation finale et de GO au cutover. La matrice des 18 scénarios, les todolists par US, les anomalies et les résultats de baseline sont suivis dans `Guides/Features/feature/refonte/j6-validation-report.md`. Verdict initial : **NO-GO**, campagne incomplète.

**Fichiers a toucher en priorite :**
- `tests/fonctionnels/**`
- `playwright.config.ts`
- `playwright.live.config.ts`
- `tests/fonctionnels/J7.Editor.RealBrowser.semi-e2e.spec.ts`
- `tests/fonctionnels/AuthenticatedWorkspaceMedia.live.smoke.spec.ts`
- `backend/src/__tests__/workspace-snapshot.test.ts`
- `tests/fixtures/workspaceHydration.fixtures.ts`
- `Guides/Features/feature/refonte/backlog/v1-v2-refonte-backlog.md`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** scenarios Playwright, fixtures d'hydratation, snapshots backend, donnees Mongo d'entrainement QA, smoke tests live.
**Changements fonctionnels a anticiper :** differences visibles de parcours de chargement, de suivi runtime, de reprise apres redemarrage et de refus d'acces sur ressources non possedees.

### US-J6-01 - Executer la campagne E2E complete V2

**Agent responsable :** `08-testeur-e2e.agent.md` - Testeur E2E final
**Criticite :** Critique
**Description :** couvrir installation, authentification, creation ou chargement workflow, activation, lancement de run, suivi runtime, annulation, retry et reprise.
**Dependances :** J3 et J4 termines. Les tests de preparation J6 peuvent demarrer avant la fermeture de J5 si le scenario est isole ; les parcours UI de run et le verdict final restent conditionnes a la fermeture du cutover J5 via J7.
**Risques et consequences :**
- sans campagne complete, des ruptures inter-couches resteront invisibles jusqu'a la livraison ;
- les scenarios temps reel ou reprise apres redemarrage sont des zones ou les regressions sont souvent tardives ;
- une validation partielle donnera une confiance artificielle sur un chantier fortement transverse.
**Impacts codebase et tests :**
- s'appuie sur Playwright et sur les fixtures applicatives existantes ;
- doit verifier que les donnees de test QA restent exploitables apres migration ;
- doit produire des traces et rapports utilisables pour arbitrer la livraison.
**Criteres d'acceptation :**
- les scenarios nominaux et d'echec majeurs sont automatises ;
- les traces utiles sont capturees ;
- un rapport de validation est produit.

### US-J6-02 - Valider l'absence de regression legacy bloquante

**Agent responsable :** `08-testeur-e2e.agent.md` - Testeur E2E final
**Criticite :** Critique
**Description :** verifier que les parcours existants encore supportes restent operationnels pendant la phase de cutover et que la desactivation legacy n'introduit pas de panne cachee.
**Dependances :** US-J6-01.
**Risques et consequences :**
- une coupure legacy prematuree peut bloquer des utilisateurs sur des workflows historiques ;
- un parcours encore utilise mais non documente peut tomber sans alerte ;
- l'absence de verification multi-navigateurs ou de rechargement en cours de run peut masquer des regressions visibles chez les utilisateurs.
**Impacts codebase et tests :**
- s'appuie sur la matrice de non-regression et sur les fixtures BDD d'entrainement QA ;
- doit identifier les adaptations fonctionnelles necessaires sur snapshots, hydrations et donnees seedees ;
- doit classer clairement ce qui releve d'une correction, d'un changement de contrat ou d'une dette reportee.
**Criteres d'acceptation :**
- la matrice de non-regression est executee ;
- les anomalies sont classees en bloquantes, majeures et mineures ;
- une recommandation Go ou No-Go est formulee.

## J7 - Remediation des blocages J6 et fermeture du gate

**Agent pilote :** `03-backend.agent.md` - Backend (coordination du contrat run)
**Co-responsables :** `04-cicd-installation.agent.md` (worker durable), `06-frontend.agent.md` (cutover UI), `08-testeur-e2e.agent.md` (validation et gate).
**Criticite du jalon :** Critique
**But :** resoudre les causes runtime qui rendent le verdict J6 `NO-GO`, terminer les ecarts de cutover J5 encore visibles dans l'interface, puis reexecuter les US J6-01/J6-02 sur un environnement isole.

**Dependances :** J3 et J4 valides. J5 reste en cours sur les ecarts commandes/runtime visibles ; sa fermeture est integree a US-J7-03. Les tests de preparation J6 deja verts ne sont pas a refaire sans raison.

**Principes non negociables**
- MongoDB et `UserToolRun` restent la source de verite metier. Un transport de queue peut signaler du travail, mais ne doit pas etre l'unique stockage d'une execution en attente.
- Un statut terminal de run ne revient jamais a `queued` ou `running`. Relancer apres un echec cree un nouvel `executionId` lie au run parent ; ne pas appeler cette action `resume` si aucun checkpoint d'execution n'est restaure.
- L'annulation n'est confirmee comme `stopped` qu'apres confirmation que le runner/processus sandbox a effectivement cesse. Un simple changement du document Mongo ne vaut pas annulation.
- Ne pas presenter `Pause` tant qu'une vraie semantique de pause n'existe pas dans le contrat serveur.
- Aucune regression de source de graphe : l'UI lit nodes/edges depuis `useDesignStore` V2 et les runs depuis les API/runtime V2 ; aucune reconstruction V1.
- Les tests live utilisent une base Mongo de test explicite, disposable et verifiee avant toute operation destructive. Aucun compte, workspace ou fournisseur reel.

### US-J7-01 - Rendre le cycle de vie des runs durable et cancellable

**Agent responsable :** `03-backend.agent.md` - Backend
**Criticite :** Critique
**Description :** remplacer le chemin synchrone actuel de `POST /api/runs/execute` par une commande durable qui enregistre l'intention, repond avec un run `queued`, et permet une annulation qui stoppe effectivement le runner. Formaliser le retry comme creation d'un nouveau run, sans transition illegale d'un terminal.

**État backend :** Implémentée et validée. `POST /api/runs/execute` persiste avant l'accusé de réception et retourne une commande queued; les exécutions restent dispatchées par un ordonnanceur en mémoire jusqu'à US-J7-02. Cancel propage un signal jusqu'au runner et garde le run non terminal si l'arrêt n'est pas confirmé. Retry crée un enfant avec lineage, ownership, nouvelle clé d'idempotence et contexte privé chiffré au repos.

**Validation réalisée :** build backend PASS; 83 suites / 417 tests backend PASS; 90 suites / 542 tests racine PASS; `ci:node25:runtime` PASS (20 tests, avec Node 24 indiqué par le script). Les tests J7-01 ciblés couvrent idempotence, dispatch concurrent, cancellation/timeout confirmés ou non, course cancel/complete, ownership, retry et publication d'événements.

**Dependances :** US-J2-04, US-J3-04.
**Risques et consequences :**
- une reponse HTTP synchrone perd le suivi si le client se deconnecte ou si le serveur redemarre ;
- marquer `stopped` avant l'arret effectif laisse du code continuer a produire des effets de bord ;
- un retry automatique apres crash peut dupliquer des effets externes non idempotents ;
- une nouvelle route sans ownership et idempotence strictes peut permettre de piloter le run d'un autre utilisateur.

**Impacts codebase et tests :**
- `backend/src/routes/runs.routes.ts`, `backend/src/services/sandbox.service.ts`, `backend/src/services/runtime/ExecutionOrchestrator.ts` ;
- `backend/src/domain/execution/userToolRun.contract.ts`, `backend/src/models/UserToolRun.model.ts`, `backend/src/services/userToolRun.service.ts` et les schemas/routes de run ;
- tests `runs-command.routes`, `user-tool-run.service`, `execution-orchestrator`, sandbox et contrat d'evenement ;
- migration idempotente uniquement si de nouveaux champs de correlation/lease/retry sont necessaires ; fixtures backend runs et snapshots a maintenir strictes.

**Solution retenue a valider avec l'architecte/backend :**
- la commande de lancement persiste le run `queued` et son contexte/version/policy avant d'accuser reception ; l'`Idempotency-Key` reutilisee retourne le meme run et ne planifie pas deux executions ;
- l'annulation est une demande idempotente au worker. Le worker propage un signal d'annulation jusqu'au processus/container sandbox, attend sa terminaison et persiste ensuite `stopped` ; erreur/timeout d'arret reste visible et ne doit pas mentir sur le statut ;
- pour un run terminal retryable, une commande explicite cree un nouveau run avec `retryOfExecutionId` (ou champ de lineage convenu), conserve l'ownership et la version de tool, et exige une nouvelle cle d'idempotence ; le run parent reste immutable ;
- `Pause` est retiree de l'UI tant que le backend n'expose pas pause/resume/checkpoint.

**Criteres d'acceptation :**
- `POST /api/runs/execute` persiste `queued` et retourne sans attendre la fin du sandbox ; execution, progression, resultat et erreur restent lisibles via l'API ;
- doublon d'idempotency key : un seul run et une seule mise en file ;
- annulation d'un run queued et running, courses cancel/complete, annulation repetees et runner impossible a stopper sont testees ; le statut expose correspond a l'etat effectif du processus ;
- les statuts terminaux restent irreversibles ; retry = nouvel `executionId` lie au parent, non mutation/reprise mensongere du run terminal ;
- tests d'ownership refusent cancel/retry sur un run d'un autre proprietaire ; aucun secret n'apparait dans payload runtime ou logs.

### US-J7-02 - Brancher un worker durable avec reprise apres redemarrage

**Agent responsable :** `04-cicd-installation.agent.md` - CI/CD et installation
**Co-responsable :** `03-backend.agent.md`
**Criticite :** Critique
**Description :** connecter le traitement de run a un worker de production et remplacer le `TaskQueueService`/`TaskWorkerService` purement en memoire comme preuve de resilience. La file durable doit pouvoir etre reconstruite depuis MongoDB apres redemarrage.

**Plan de reprise (2026-11-18) :** la sortie sure de quarantaine d'un `run` incertain est desormais concue et decoupee en US executables : `US-J7-05` (gateway : label d'operation `airdd2.gateway.op`, etat `fenced` + `fencedOperations`, fencing auto a la rotation d'epoch, `verifyFenced` label/ID + reservation de nom, control plane `/v1/operations/:id/fence|verify`), `US-J7-06` (contrat : statuts terminaux `worker_lost`/`quarantined`, `recoveryAttemptCount`, reconciler quarantiné si preuve absente), `US-J7-07` (endpoint `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry` + audit immuable + alertes + idempotence), `US-J7-08` (`recoveryPolicy` par agent + auto-recovery `AGENT_AUTO_RECOVERY`), `US-J7-09` (visibilite : journeaux agent, evenements runtime versionnes, alertes), `US-J7-10` (deploiement corrige sur l'hote Linux cible + validation operationnelle reelle). Conception de reference : `Guides/Features/feature/refonte/j7-02-quarantine-exit-fencing-design.md`. Branche de travail : `feat/j7-02-quarantine-exit-fencing`.

**Avancement CI/CD et isolation Docker :** le gateway Unix dédié, l'autorité d'epoch persistée MongoDB, le routage des commandes Docker backend (runs, health checks et provisioning Python) et les unités systemd sont raccordés ; le déploiement Linux a été validé par le responsable du projet. La réconciliation des runs expirés est branchée avant le démarrage du worker. Les scénarios Linux/Docker ciblés ont été exécutés dans un environnement local isolé ; l'US reste ouverte notamment pour la sortie sûre des opérations `run` incertaines et la validation complète des critères ci-dessous.

**Dependances :** US-J7-01.
**Risques et consequences :**
- une queue volatile perd les runs queued apres panne ;
- deux workers peuvent reclamer le meme run sans claim atomique/lease persiste ;
- une reprise aveugle d'un run running peut dupliquer des appels/outils externes ;
- une initialisation ou migration non idempotente peut bloquer le backend ou reprendre plusieurs fois une execution.

**Impacts codebase et tests :**
- `backend/src/services/taskRuntimeInfra.service.ts`, nouveau worker/bootstrap uniquement si aucun composant J3 existant ne peut etre reconnecte ;
- `backend/src/services/databaseInit.ts`, migration/indexes seulement si requis, scripts de demarrage et `backend/package.json` ;
- tests worker lease, `user-tool-run.service`, migration, runtime health, arret/redemarrage et tests avec deux workers concurrents.

**Decision de reprise :**
- les runs queued sont recuperables et reclamables par compare-and-set/lease durable ;
- un run running dont le lease expire est marque en erreur terminale stable (`WORKER_LOST`, retryable) apres reconciliation, puis relance explicite via un nouveau run. Ne pas rejouer automatiquement un run au resultat externe incertain ;
- les evenements WebSocket sont des signaux best-effort, jamais la seule source d'etat : apres reconnexion, l'UI relit le run serveur.

**Criteres d'acceptation :**
- le worker de production est demarre par un chemin documente/health-checke et consomme les runs Mongo persistants ; aucune `Map` en memoire ne constitue la file de verite ;
- deux workers concurrents ne peuvent pas executer un meme lease simultanement ; lease expire, run queued et run running sont reconciliables ;
- test d'integration : persister un run, arreter/recreer le worker, verifier sa reprise ou sa classification `WORKER_LOST`, puis tester retry explicite sans modifier le parent ;
- migration/bootstrap rejouables, tests de reprise et `npm run ci:node25:runtime` verts ;
- Redis, s'il sert de transport de reveil, reste non autoritaire et sa perte ne perd aucun run persiste.

**Etat d'avancement du cutover :**
- le dispatcher en memoire a ete retire du chemin d'enqueue ; les appels legacy passent maintenant par les runs Mongo et attendent leur resultat persiste ;
- le backend demarre le worker durable apres la connexion Mongo et l'initialisation de la base, et expose `/api/health/ready` ;
- les runs queued sont repris apres redemarrage et les runs running au resultat incertain restent en quarantaine avec leur workspace verrouille ;
- un conflit de workspace differe le run queued sans faire tomber le worker ; la cible est reverifiee apres sa preparation, avant de la lancer ;
- la reconstruction apres redemarrage est volontairement limitee aux sources inline dont l'empreinte est verifiable ; les sources sur disque ou natives sont mises en quarantaine plutot que relues depuis un chemin mutable ;
- le gateway Docker est raccorde : admission par epoch, serveur/client HTTP sur socket Unix avec permissions 0660 sur Linux, commandes restreintes et tests de transport ; l'autorite Mongo conserve des epochs monotones, les jetons sous forme de hash et une operation en attente, et transforme celle-ci en incertaine au redemarrage ;
- l'admission persistante est testee contre les epochs perimees, les admissions concurrentes et la reprise fail-closed ; l'entrypoint autonome impose Node.js >=24.22.1 <25, publie le credential d'epoch atomiquement en mode 0640 et une unite systemd Linux est fournie ;
- le gateway ferme l'admission avant l'arret normal ; le worker de production utilise le gateway et ne demarre qu'apres la reconciliation de reprise. Une operation `run` incertaine reste bloquee au redemarrage : une inspection ponctuelle ne prouve pas qu'une creation ou un demarrage ne peut plus arriver ;
- le deploiement Linux du gateway et son raccordement au backend de production ont ete valides par le responsable du projet ; les nouveaux chemins de reconciliation de runs expires ont ete testes sous systemd dans un environnement Linux local isole, pas sur l'hote de production ;
- les reponses de `kill` restent incertaines jusqu'a preuve externe de quiescence ; ni une reponse Docker ni une inspection seule n'autorisent la liberation du workspace ;
- au demarrage, les runs `running` au lease expire sont inspectes et arretes via le gateway lorsque l'admission n'est pas bloquee ; un etat Docker terminal/absence apres fencing permet alors le passage a `WORKER_LOST`, puis la liberation conditionnelle du verrou propre au run ; une preuve absente conserve le run et son verrou en quarantaine ;
- la liberation de verrou interrompue est rejouee au demarrage sans supprimer le verrou d'un autre run ;
- validation du 17/11/2026 : moteur Docker Linux de Docker Desktop, MongoDB isole, gateway execute sous Windows ; arret d'un conteneur reel, rejet de l'ancienne epoch, identite incorrecte et conteneur en pause testes. Un test separe du socket Unix `0660` et du fencing a ete execute dans un processus Linux avec runner Docker simule (Node 25.9.0, hors plage de production) ;
- une creation Docker differee apres deconnexion a revele que l'absence du conteneur ne prouve pas la quiescence. Le gateway conserve maintenant l'operation `run` incertaine et bloque son redemarrage ; une preuve durable permettant une sortie sure de cette quarantaine reste a implementer et valider sur l'hote Linux de production ;
- les chemins `dist/src/...` des entrees npm et systemd ont ete alignes sur la sortie effective du build ; le redeploiement des unites corrigees sur l'hote cible reste a effectuer ;
- validation Linux locale : 10 suites et 61 tests reussis avec Node 24.22.1, MongoDB et moteur Docker-in-Docker isoles. Apres `SIGKILL` du backend systemd, un conteneur actif est arrete, `WORKER_LOST` est persiste et le verrou libere ; un conteneur en pause conserve run et verrou en quarantaine ;
- au redemarrage systemd du gateway, une operation `run` en attente injectee dans le journal de test devient incertaine et bloque l'ouverture du socket. Cette injection est synthetique et ne prouve pas la neutralisation d'une requete Docker reellement en transit ; la creation differee a ete testee separement ;
- essais complementaires Docker-in-Docker : un demarrage par ID retarde peut lancer un conteneur observe `created` ; apres suppression du conteneur initial et reservation inerte de son nom, ce demarrage sur ancien ID est refuse. Ces essais ne prouvent pas la neutralisation des effets deja executes ou des suppressions tardives par nom ;
- les metadonnees d'effet conservees dans MongoDB sont transmises a `reconcileUnknown` ; au redemarrage, les `run` et `kill` incertains restent bloques. Des tests Docker reels montrent qu'un `kill` retarde peut toucher un remplacement et qu'une suppression retardee par nom peut detruire une reservation inerte ;
- nouvelle validation ciblee : build backend, 11 suites/72 tests Linux Docker/Mongo, 8 tests de quarantaine queued et 7 tests de requetes retardees reussis ; les pannes backend systemd et la quarantaine gateway synthetique sont aussi validees. Campagne navigateur semi-E2E complete en serie : 10 reussites, 1 echec `minimize-restore` ;
- campagne live sur backend/Mongo ephemeres : 6 reussites, 1 echec reproductible d'attachement workspace et 1 test d'artefact runtime ignore (sandbox Python non pret). Le test d'election replica Mongo n'a pas ete execute ; aucun E2E complet du worker n'est revendique ;
- les permissions testees interdisent Docker directement au compte backend, autorisent le compte gateway et permettent au backend d'acceder au socket gateway. `npm run ci:node25:runtime` reussit avec Node 24.22.1 (3 suites, 20 tests) ;
- reste a faire (2026-11-18) : livrer `US-J7-05` a `US-J7-10` selon la conception `j7-02-quarantine-exit-fencing-design.md`, valider le deploiement corrige sur l'hote Linux cible et achever la validation E2E et les criteres ci-dessous. Ne jamais effacer le journal (`docker_gateway_state`, `dockerJournal` du run, `gateway_fence_audit`) ni liberer un verrou sur simple inspection : la liberation exige `verifyFenced` (label/ID + reservation de nom + fenetre de grace, fail-closed) et `owner === runId`. **US-J7-02 reste ouverte (chapeau).**

### US-J7-05 - Gateway : label d'operation, etat `fenced`, fencing auto a la rotation d'epoch, `verifyFenced` label/ID, control plane

**Agent responsable :** `04-cicd-installation.agent.md` - CI/CD et installation
**Co-responsable :** `03-backend.agent.md`
**Criticite :** Critique
**Description :** rendre le gateway resilient et sortable de quarantaine. Injecter par le serveur le label `airdd2.gateway.op=<operationId>` sur tout `run` admis ; ajouter `fencedOperations[]` a `docker_gateway_state` et passer l'operation `unknown` de l'ancienne epoch en `fenced` (fencing auto, `fenceKind: 'auto_epoch_rotation'`) a l'activation d'une nouvelle epoch, avec reservation de nom inerte (`docker create` labelise `airdd2.fence.op=<id>`), puis rouvrir l'admission immediatement. Implementer `verifyFenced` (aucun conteneur labelise non terminal, reservation verifiee par label, fenetre de grace 2x poll, fail-closed, borne `RECONCILE_TIMEOUT_MS` = 30 s) et exposer `POST /v1/operations/:operationId/fence` et `POST /v1/operations/:operationId/verify` sur le serveur, consommables via `DockerGatewayControlClient`.

**Dependances :** US-J7-02 (chapeau) ; conception `Guides/Features/feature/refonte/j7-02-quarantine-exit-fencing-design.md` sections 3.1 a 3.5.

**Risques et consequences :**
- une reservation de nom verifiee par le nom seul rouvrirait la course a la suppression tardive par nom ; ne jamais cibler un nom nu pour les commandes mutantes apres fencing (ID/label uniquement) ;
- le fencing auto confine mais ne pretend pas prouver la quiescence : ne pas marquer `quiescenceProven` sans `verifyFenced` ;
- une regression de la serialisation mono-operation (`pendingOperation` unique) casserait l'exclusion mutuelle deux workers ;
- le demon doit ouvrir son socket meme avec des operations fencées, sinon un seul run incertain bloque toute la production.

**Impacts codebase et tests :**
- `backend/src/services/runtime/DockerGatewayServer.ts` (injection label, routes `/v1/operations/*`), `DockerGatewayAdmission.ts`, `MongoDockerGatewayAdmission.ts` (`fencedOperations`, etat `fenced`, activation avec fencing auto), `DockerGatewayOperationReconciler.ts` (`verifyFenced`), `DockerGatewayDaemon.ts` (ouverture avec operations fencées), `DockerGatewayControlClient.ts` (fence/verify), `dockerGatewayMain.ts` ;
- tests : `mongo-docker-gateway-admission.test.ts`, `docker-gateway-daemon.test.ts`, `docker-gateway-transport.test.ts`, `docker-gateway-recovery.integration.test.ts`, `docker-inflight-reservation.integration.test.ts`, `docker-name-reservation.integration.test.ts` + nouveaux tests unitaires `verifyFenced`.

**Criteres d'acceptation :**
- a chaque rotation d'epoch, l'operation `unknown` est fencée automatiquement et l'admission rouvre sans intervention ; epoch perimee toujours rejetee ;
- tout `run` admis porte le label `airdd2.gateway.op=<operationId>` ; `docker ps -a --filter label=...` retrouve le conteneur meme apres deconnexion ;
- `verifyFenced` retourne true seulement avec reservation labelisee + aucun conteneur labelise non terminal + fenetre de grace ; false sur inspect en erreur, label mismatch ou etat inconnu ;
- deux workers concurrents ne peuvent pas executer le meme lease ; tests de restart gateway avec operation `run` unknown, creation differee (echoue sur nom reserve), kill differe par nom (ne touche pas la reservation), conteneur en pause (reste quarantine).

**Etat d'avancement (2026-11-18, agent `04-cicd-installation`, branche `feat/j7-02-quarantine-exit-fencing`) : IMPLEMENTEE ET VALIDEE (commit voir `git log`).** Label `airdd2.gateway.op=<operationId>` injecte par le serveur sur tout `run` admis (re-validation post-injection, fail-closed) ; `fencedOperations[]` dans `docker_gateway_state` (`fenceKind`, `nameReservation`, `quiescenceProven`), fencing auto `auto_epoch_rotation` a l'activation d'epoch (pipeline Mongo atomique) avec reouverture immediate de l'admission, `admit` toujours exige `pendingOperation: null` (exclusion mutuelle) ; `verifyFenced` fail-closed (ps par label op/attempt, kill par ID uniquement, reservation verifiee par inspect nom+label `airdd2.fence.op`, fenetre de grace 2x poll, borne 30 s) ; control plane `POST /v1/operations/:id/fence` et `/verify` consomme via `DockerGatewayControlClient.fenceOperation/verifyFenced` ; daemon : `start()` fence best-effort puis ouvre le socket quoi qu'il arrive (plus de blocage global) ; `dockerGatewayMain` resout l'image inerte (sha256) pour la reservation. Apres fencing, aucune commande mutante ne cible un nom nu (tests : kill/rm par ID uniquement). Tests : `docker-gateway-fencing.test.ts` (unitaires fail-closed), `docker-gateway-fencing.integration.test.ts` (live Docker : restart avec run unknown -> admission rouvre + reservation ; creation differee refusee sur nom reserve ; kill differe par nom ne touche pas la reservation ; conteneur en pause reste en quarantaine), + mises a jour des 4 suites gateway existantes. Validations : audit strict OK, `ci:node25:runtime` 3/20 OK, 5 suites unitaires gateway 65 tests OK, 4 suites live Docker 23 tests OK, suites backend/racine completes en cours. **Handoff US-J7-06 (`03-backend`) :** la preuve de quiescence est disponible cote gateway via `DockerGatewayControlClient.verifyFenced(operationId)` (`{ quiescent }`) et l'etat `fencedOperations[].quiescenceProven` dans `docker_gateway_state` ; lire la conception §4.5 et cette section. Le reconciler de runs doit appeler `/verify` (borne 30 s) avant toute liberation de verrou ; `quiescenceProven: false` ou erreur = `quarantined`, verrou tenu.

### US-J7-06 - Contrat de run : statuts terminaux `worker_lost`/`quarantined`, `recoveryAttemptCount`, reconciler quarantinant

**Agent responsable :** `03-backend.agent.md` - Backend
**Co-responsable :** `01-architecte-bdd.agent.md` (contrat domaine)
**Criticite :** Critique
**Description :** etendre le contrat de statuts de `UserToolRun` avec deux statuts terminaux `worker_lost` et `quarantined` (transitions `[]`, `error.code` conserve pour compatibilite), ajouter `recoveryAttemptCount` (defaut 0), faire poser `status: 'worker_lost'` par `markExpiredRunWorkerLost`, et faire poser `status: 'quarantined'` (verrou tenu) par le reconciler quand la preuve de quiescence est absente au lieu de laisser le run `running` indefiniment. Migrer les filtres et index partiels existants.

**Dependances :** US-J7-05 (preuve `verifyFenced`), US-J7-01.

**Risques et consequences :**
- changement de contrat versionne : impacter l'UI, les filtres (`$in: ['queued','running']` restent les seuls non terminaux), les fixtures runs et le snapshot ;
- une transition illegale vers `queued`/`running` depuis un terminal casserait l'irreversibilite ; la state machine doit rester le garde-fou ;
- les index partiels (`idx_user_tool_runs_active_watchdog`, running lease expiry) doivent etre revus pour les nouveaux statuts.

**Impacts codebase et tests :**
- `backend/src/domain/execution/userToolRun.contract.ts`, `backend/src/models/UserToolRun.model.ts`, `backend/src/services/userToolRun.service.ts` (`markExpiredRunWorkerLost`, `markRunQuarantined`, `listWorkerLostLockCleanup`, `listExpiredSupervisedRuns`), `backend/src/services/runtime/MongoExpiredRunReconciler.ts`, `backend/src/services/databaseInit.ts` (index) ;
- tests : `user-tool-run.contract.test.ts`, `user-tool-run.service.test.ts`, `mongo-expired-run-reconciler.test.ts`, `runs-command.routes.test.ts`, `durable-worker-restart.integration.test.ts`, `queued-run-quarantine.integration.test.ts`, `database-init.run-lease.test.ts`.

**Criteres d'acceptation :**
- `worker_lost` et `quarantined` sont terminaux et irreversibles (`canTransitionUserToolRun` refuse toute sortie) ;
- preuve de quiescence presente -> `worker_lost` + liberation conditionnelle du verrou ; preuve absente -> `quarantined` + verrou tenu ;
- `recoveryAttemptCount` persiste et s'incremente uniquement via les chemins de retry/fence-and-retry ;
- toutes les requêtes et index existants sont migrés et les suites impactees restent vertes.

**Etat d'avancement (2026-11-18, agent `03-backend`, branche `feat/j7-02-quarantine-exit-fencing`) : IMPLEMENTEE ET VALIDEE (commit voir `git log`).** Contrat : `worker_lost`/`quarantined` ajoutes a `USER_TOOL_RUN_STATUS_VALUES` avec transitions `[]` (irréversibles ; `running -> worker_lost|quarantined` admises pour le reconciler, jamais depuis `queued`), constantes `USER_TOOL_RUN_NON_TERMINAL/TERMINAL/RECONCILABLE_TERMINAL_STATUS_VALUES` + `isUserToolRunTerminalStatus` ; `error.code` `WORKER_LOST`/`QUARANTINED` conserve. Modele : `recoveryAttemptCount` (Number, min 0, defaut 0) + index partiels `idx_user_tool_runs_recovery_attempts` (`ownerUserId, retryOfExecutionId, recoveryAttemptCount`) et `idx_user_tool_runs_terminal_reconcilable` (`status, updatedAt` pour `worker_lost|quarantined`) ; `idx_user_tool_runs_active_watchdog` reste `queued|running` (seuls non terminaux), recréés idempotents dans `databaseInit.ts` (INDEX_DEFINITIONS + branche base existante, validateur `recoveryAttemptCount` ajoute). Service : `markExpiredRunWorkerLost` pose `status: 'worker_lost'` (journal Docker du run JAMAIS efface : `pending`/`hasUnknownOutcome` conserves), nouveau `markRunQuarantined` pose `status: 'quarantined'` (verrou tenu : `workspaceRetentionProtected` conserve, pas de `workerLossReconciliation`), `listWorkerLostLockCleanup`/`markWorkerLostWorkspaceLockReleased` migrés sur `status: 'worker_lost'`, `createQueuedRun` persiste `recoveryAttemptCount` (retry explicite l'incremente : parent + 1 via `sandbox.service` -> orchestrateur). Reconciler : nouveau port `DockerAttemptFencingProofPort` (`DockerGatewayFencedAttemptProof`) qui retrouve l'opération fencée par `effect.attemptId`/nom via `MongoDockerGatewayAdmission.getFencedOperations()`, appelle le control plane `fenceOperation` puis `verifyFenced` (borne 30 s, fail-closed : erreur ou `quiescent: false` -> preuve absente) et observe l'état terminal read-only via `docker inspect` du nom (label `airdd2.fence.op` = réservation inerte -> `absent`) ; preuve presente -> `worker_lost` + `releaseForRun` (owner === runId) ; preuve absente -> `markRunQuarantined`, verrou tenu, `unresolved += 1`. `DockerGatewayAttemptRecovery` (stopAndVerify, kill par nom) supprime, remplace dans `server.ts`. Filtres terminaux migrés : `ExecutionOrchestrator`, `MonitoredRunDispatch`, `DurableRunWorker`, `userToolRunRetention.service`, `userToolRunQuery.service` (statusRank), `workspaceSnapshot.ts` (union). Tests : contrat (transitions interdites worker_lost/quarantined), service (worker_lost/quarantined persistés, irréversibilité, recoveryAttemptCount, cleanup), reconciler unitaire (8 cas fail-closed), `supervised-attempt-launcher` (worker_lost + quarantine avec verrou tenu), `database-init.run-lease` (nouveaux index idempotents), live Docker `docker-gateway-recovery.integration.test.ts` reworké (quiescence prouvée -> worker_lost + libération + réservation labelisée ; identité mismatch / conteneur en pause -> quarantined + verrou tenu). Validations : `tsc --noEmit` OK, `npm run audit:workflow-architecture:strict` OK, `npm run ci:node25:runtime` 3 suites/20 tests OK, suites cibles (`user-tool-run.contract`, `user-tool-run.service`, `mongo-expired-run-reconciler`, `runs-command.routes`, `database-init.run-lease`, `supervised-attempt-launcher`, `durable-worker-restart`, `queued-run-quarantine`, `sandbox-retry-snapshot`, `user-tool-run-retention`) vertes, live Docker `AIRDD2_TEST_DOCKER_RESERVATION=1` : `docker-gateway-recovery.integration` 3/3, `docker-gateway-fencing.integration` 2/2, `durable-worker-restart` + `queued-run-quarantine` 12/12, `cd backend && npm test -- --runInBand` 115 suites passées/5 skippées (752 tests, EXIT=0), `npm test -- --runInBand` racine 90 suites/542 tests (EXIT=0). **Handoff US-J7-07 (`03-backend`) :** lire la conception §4.1-4.4 ; préconditions `worker_lost|quarantined` (`USER_TOOL_RUN_RECONCILABLE_TERMINAL_STATUS_VALUES`), preuve gateway via `DockerGatewayFencedAttemptProof`/`DockerGatewayControlClient.fenceOperation|verifyFenced`, libération `MongoWorkspaceLockService.releaseForRun` (owner === runId), `recoveryAttemptCount` = parent + 1 sur le nouvel `executionId` (`retryOfExecutionId`), route `backend/src/routes/workspaceRuns.routes.ts` + audit `gateway_fence_audit` + alertes `runtime_alerts` + idempotence `Idempotency-Key`, réponses 202/400/404/409/504.

### US-J7-07 - Endpoint `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry` + service + audit + alertes

**Agent responsable :** `03-backend.agent.md` - Backend
**Co-responsable :** `02-securite.agent.md` (ownership, idempotence)
**Criticite :** Critique
**Description :** implementer le contrat applicatif `fence-and-retry` de la conception section 4 : route dans un nouveau `backend/src/routes/workspaceRuns.routes.ts` monte sur `/api/workspaces`, `requireAuth` + ownership strict (workflow et run appartiennent a `req.user.id`), header `Idempotency-Key` obligatoire (Zod, rejeu idempotent), precondition run en `worker_lost`/`quarantined` sinon `409 RUN_NOT_QUARANTINED`. Sequence : fencing via gateway (`/v1/operations/:id/fence` puis `/verify`, 30 s) -> `504 FENCING_TIMEOUT_ESCALATED` + alerte critique persistée + verrou retenu si quiescence non prouvee ; marquage `fenced` + entree d'audit signee dans `gateway_fence_audit` (`actorUserId`, `timestamp`, `fencedOpUuid`, `reason: 'USER_MANUAL_RESET'`) ; liberation du verrou uniquement si `owner === runId` sinon `409 WORKSPACE_LOCKED_BY_OTHER_RUN` ; creation d'un nouveau run `queued` avec nouvel `executionId`, `retryOfExecutionId`, `recoveryAttemptCount` incremente, parent immutable. Reponse `202 { fencedRunId, newExecutionId, status: 'queued', recoveryAttemptCount }`.

**Dependances :** US-J7-05, US-J7-06.

**Risques et consequences :**
- liberation de verrou sans preuve de quiescence = fail-open interdit ; toute erreur d'inspection reste fail-closed ;
- l'idempotence doit couvrir le rejeu apres timeout client sans re-fencing ni double run ;
- l'atomicite (transaction Mongo si replica set, sinon CAS ordonne + idempotency) doit laisser un etat coherent meme en cas d'echec intermediaire ;
- aucun secret ni token dans les reponses ni les logs.

**Impacts codebase et tests :**
- nouveaux `backend/src/routes/workspaceRuns.routes.ts`, `backend/src/services/fenceAndRetry.service.ts` (ou `services/runtime/`), collections `gateway_fence_audit` (immuable) et `runtime_alerts`, montage dans `server.ts` ;
- test nouveau `backend/src/__tests__/workspace-runs.fence-and-retry.routes.test.ts` : 202/400/404/409/504, idempotency replay, ownership 404, verrou tiers, parent immutable, audit persiste.

**Criteres d'acceptation :**
- tableau des reponses HTTP respecte (202/400/404/409/504 + codes) ;
- `Idempotency-Key` obligatoire, rejeu sans effet de bord double ;
- le verrou n'est libere que si `owner === runId` et apres quiescence prouvee ; sinon retenu + alerte ;
- le journal et l'audit ne sont jamais modifies/effaces, seulement enrichis ;
- parent terminal strictement immutable ; nouveau run `queued` avec lineage et compteur.

**Etat d'avancement (2026-11-18, agent `03-backend`, branche `feat/j7-02-quarantine-exit-fencing`) : IMPLEMENTEE ET VALIDEE (commit voir `git log`).** Ports/erreurs types dans `services/runtime/fenceAndRetry.ports.ts` (`FenceControlPort`, `FencedOperationLookupPort`, `FenceAuditPort`, `RuntimeAlertPort`, `RunCommandIdempotencyPort`, stores run/workflow/retry, `FenceAndRetryError{statusCode,code}`, borne `FENCE_AND_RETRY_TIMEOUT_MS=30s`) ; stores Mongo `services/runtime/fenceAndRetry.stores.ts` : `gateway_fence_audit` (append-only, insert seul), `runtime_alerts`, `run_command_idempotency` (`_id = userId:fence-and-retry:key`), `MongoQuarantinedRunStore` (run owner+workspace, `+supervisedAttempt`), `MongoWorkflowOwnershipStore` ; schemas+validateurs+index des 3 collections dans `databaseInit.ts` (creation idempotente). Service `services/fenceAndRetry.service.ts` : rejeu idempotent (200 sans re-fencing, 409 `IDEMPOTENCY_KEY_REUSED` si autre cible) -> ownership workflow+run (404 `RUN_NOT_FOUND`) -> precondition `worker_lost|quarantined` (409 `RUN_NOT_QUARANTINED`) -> fencing gateway (`fenceOperation` kind selon `reason` + `verifyFenced`, `Promise.race` borne 30 s, fail-closed ; non prouve/erreur/absence d'operation fencee => 504 `FENCING_TIMEOUT_ESCALATED` + alerte `critical` persistee + verrou tenu + aucun audit) -> audit signe (`actorUserId`, `fencedOpUuid`, `reason`, `quiescenceProven: true`) -> `releaseForRun` (`owner === runId`, sinon 409 `WORKSPACE_LOCKED_BY_OTHER_RUN` avec audit deja persiste) -> run fils via `SandboxService.retryQuarantinedRun` (nouvel `executionId`, `retryOfExecutionId`, `recoveryAttemptCount` = parent+1, contexte prive rechiffre, parent immutable) -> reponse 202 persistee dans `run_command_idempotency`. `SandboxService.retryRun` refactorise (`loadOwnedRun` + `enqueueRetry` partages) ; `retryQuarantinedRun` reserve aux terminaux reconciliables. Route `routes/workspaceRuns.routes.ts` (`POST /:workspaceId/runs/:runId/fence-and-retry`, `requireAuth`, Zod params, `Idempotency-Key` obligatoire 400, mapping 202/200/400/404/409/504, `createWorkspaceRunsRouter(service)` injectable + routeur par defaut fail-closed sans `DOCKER_GATEWAY_SOCKET`), montee dans `server.ts` sur `/api/workspaces`. Tests `workspace-runs.fence-and-retry.routes.test.ts` (11 tests) : 400/401/404/409 RUN_NOT_QUARANTINED/202 avec audit+liberation+parent immutable/200 replay sans effets de bord/409 IDEMPOTENCY_KEY_REUSED/409 WORKSPACE_LOCKED_BY_OTHER_RUN (audit persiste, verrou intact)/504 quiescence non prouvee ou control plane en erreur ou aucune operation fencee (alerte critique persistee, verrou tenu, pas d'audit)/creation reelle d'un run fils `queued` avec lineage et `recoveryAttemptCount` incremente. Validations : `tsc --noEmit` OK, `npm run audit:workflow-architecture:strict` OK, `npm run ci:node25:runtime` 3 suites/20 tests OK, suites cibles vertes (7 suites/84 tests + nouvelle suite 11 tests), live Docker `docker-gateway-recovery` 3/3 + `docker-gateway-fencing` 2/2, `cd backend && npm test -- --runInBand` 116 suites passees/5 skippees (763 tests, EXIT=0), `npm test -- --runInBand` racine 90 suites/542 tests (EXIT=0). **Handoff US-J7-08 (`03-backend`) :** lire la conception §4.6 ; `recoveryPolicy` sur `AgentPrototype` (defaut `{ autoFenceAndRetry: false, maxAttempts: 0 }`, Zod), auto-recovery au reconciler/worker en reutilisant `FenceAndRetryService.fenceAndRetry({ reason: 'AGENT_AUTO_RECOVERY' })` (audit `agent_auto_recovery`, `actorUserId = ownerUserId`) sous le seuil `recoveryAttemptCount < maxAttempts`, sinon le run reste `quarantined` ; env `AGENT_AUTO_RECOVERY`.

### US-J7-08 - `recoveryPolicy` par agent et auto-recovery worker (`AGENT_AUTO_RECOVERY`)

**Agent responsable :** `03-backend.agent.md` - Backend
**Co-responsable :** `01-architecte-bdd.agent.md` (contrat domaine)
**Criticite :** Haute
**Description :** ajouter `recoveryPolicy: { autoFenceAndRetry: boolean; maxAttempts: number }` (defaut `{ autoFenceAndRetry: false, maxAttempts: 0 }`, validation Zod) sur le prototype d'agent et son snapshot d'instance ; quand un run `quarantined` appartient a un agent avec auto-recovery activee et `recoveryAttemptCount < maxAttempts`, le worker execute la meme sequence que `fence-and-retry` avec `reason: 'AGENT_AUTO_RECOVERY'` (audit signe) ; au seuil, le run reste `quarantined` et la main est rendue a l'utilisateur.

**Dependances :** US-J7-06, US-J7-07.

**Risques et consequences :**
- une auto-recovery trop agressive pourrait relancer des effets externes non idempotents ; le seuil `maxAttempts` et l'audit sont obligatoires ;
- la policy doit etre snapshotée sur le run au lancement (comme `policySnapshot`) pour rester coherente apres changement du prototype.

**Impacts codebase et tests :**
- `backend/src/models/AgentPrototype.model.ts`, snapshot d'instance, schemas Zod, reconciler/worker (`MongoExpiredRunReconciler` ou `DurableRunWorker`), tests unitaires + integration.

**Criteres d'acceptation :**
- policy persistee, validee par Zod, defaut off ;
- auto-recovery sous le seuil : fencing + nouveau run + audit `AGENT_AUTO_RECOVERY` ; au seuil : run reste `quarantined`, aucune relance automatique.

**Etat d'avancement (2026-11-18, agent `03-backend`, branche `feat/j7-02-quarantine-exit-fencing`) : IMPLEMENTEE ET VALIDEE (commit voir `git log`).** Contrat `domain/execution/recoveryPolicy.contract.ts` : `RecoveryPolicySchema` strict Zod (`maxAttempts` int 0..10), `DEFAULT_RECOVERY_POLICY = { autoFenceAndRetry: false, maxAttempts: 0 }`, `normalizeRecoveryPolicy`, `canAutoRecoverRun` (seuil `recoveryAttemptCount < maxAttempts`), `isAgentAutoRecoveryEnvEnabled` (`AGENT_AUTO_RECOVERY === 'true'`), `buildAutoRecoveryIdempotencyKey` = `auto-recovery:<runId>:<count>`. Persistance : sous-schema `recoveryPolicy` (defaut off) sur `AgentPrototype` et `AgentInstance` (snapshot), validateurs `agent_prototypes`/`agent_instances` dans `databaseInit.ts`. Routes : Zod `recoveryPolicy` optionnel sur creation/update de prototype et creation d'instance ; `POST /instances/from-prototype` snapshotte la policy (override `configuration_json` > prototype > defaut off). Service `services/runtime/agentAutoRecovery.service.ts` (`AutoRecoveryPort`) : double garde-fou env + policy (snapshot instance > prototype > defaut off), puis reutilise `FenceAndRetryService.fenceAndRetry({ reason: 'AGENT_AUTO_RECOVERY', idempotencyKey: auto-recovery:<runId>:<count> })` — audit signe `agent_auto_recovery`, `actorUserId = ownerUserId` ; toute erreur fail-closed (`failed`, run reste `quarantined`, alerte 504 persistee par fence-and-retry) ; au seuil `threshold_reached`, aucune relance. Store : `listQuarantinedRunsForRecovery()` + `agentInstanceId`/`agentPrototypeId`/`recoveryAttemptCount` dans `listExpiredSupervisedRuns()`. Reconciler `MongoExpiredRunReconciler` : 4e port optionnel `autoRecovery`, evaluation apres chaque `markRunQuarantined` et pour les runs deja `quarantined` (une fois par run par pass, `Set` d'executionId), summary `+ autoRecovered`. `server.ts` : `FenceAndRetryService` partage gateway admission/control avec `AgentAutoRecoveryService` passe au reconciler. Tests : `recovery-policy.contract.test.ts` (7), `agent-auto-recovery.service.test.ts` (8 : env off, no_workspace, policy off, fallback prototype, cle idempotence par tentative, seuil, fail-closed, erreur resolution policy), `recovery-policy.routes.test.ts` (6 : persistance prototype, defaut off, 400 invalide, snapshot from-prototype, override frontend, defaut), reconciler +3 tests (auto-recovery run quarante ce pass, run deja quarantine, jamais sur worker_lost). Validations : `tsc --noEmit` OK, `npm run audit:workflow-architecture:strict` OK, `npm run ci:node25:runtime` 3 suites/20 tests OK, suites cibles 11 suites/90 tests OK, `cd backend && npm test -- --runInBand` 119 suites passees/5 skippees, 791 tests, EXIT=0, `npm test -- --runInBand` racine 90 suites/542 tests EXIT=0, live Docker `AIRDD2_TEST_DOCKER_RESERVATION=1` 2 suites passees/2 skippees (gateway socket absent), 12 tests, EXIT=0. **Handoff US-J7-09 (`03-backend`) :** visibilite — journeaux agent, evenements runtime versionnes `run.quarantined`/`run.fenced`/`run.recovery_relaunched`, alertes ; lire la conception §5 et cette section.

### US-J7-09 - Visibilite : journeaux agent, evenements runtime versionnes, alertes

**Agent responsable :** `03-backend.agent.md` - Backend
**Co-responsable :** `06-frontend.agent.md` (contrat consommateur)
**Criticite :** Haute
**Description :** rendre la quarantaine visible et tracable : nouveaux types d'evenements runtime versionnes `run.quarantined`, `run.fenced`, `run.recovery_relaunched` (whitelist de payload, aucun secret), entree dans `agent_journals` pour l'agent/noeud concerne (cause, etat du verrou, operation fencee), persistance des alertes dans `runtime_alerts` (severite `critical` sur `FENCING_TIMEOUT_ESCALATED`), exposition via `useRuntimeStore` pour la carte et le panneau de supervision (consommation UI realisee en US-J7-03).

**Dependances :** US-J7-06, US-J7-07.

**Risques et consequences :**
- un payload d'evenement trop riche fuirait des donnees sensibles ; la whitelist Zod reste le garde-fou ;
- un evenement de quarantaine emis vers le mauvais workspace casserait l'isolation ; filtrage strict par `workspaceId`.

**Impacts codebase et tests :**
- `backend/src/domain/execution/runtimeEvent.contract.ts`, `backend/src/services/runtimeEventPublisher.service.ts`, `backend/src/models/AgentJournal.model.ts`, `runtime_alerts`, tests `runtime-event.contract.test.ts`, `runtime-event.publisher.test.ts`, `websocket-auth.test.ts`.

**Criteres d'acceptation :**
- evenements versionnes emis et valides Zod, consommables par le front sans casser les clients existants ;
- entree journal avec agent/noeud, cause, etat du verrou ; alerte critique persistée sur 504 ;
- aucun secret dans les payloads ni les logs.

**Etat d'avancement (2026-11-18, agent `03-backend`, branche `feat/j7-02-quarantine-exit-fencing`) : IMPLEMENTEE ET VALIDEE (commit voir `git log`).** Contrat `domain/execution/runtimeEvent.contract.ts` : extension additive (version 1 conservee) des types `run:quarantined`, `run:fenced`, `run:recovery_relaunched` et de la whitelist payload (`lockHeld`, `reason`, `operationId`, `recoveryAttemptCount`, `newRunId`) ; la liste des cles sensibles et le filtrage restent le garde-fou. Publisher `runtimeEventPublisher.service.ts` : mapping `quarantined -> run:quarantined` (avec `lockHeld` depuis `publishRuntimeStateChange`), nouvelles methodes `publishRunQuarantined`/`publishRunFenced`/`publishRunRecoveryRelaunched` (payload whiteliste, dedup, blocage si `roomWorkspaceId !== workspaceId`). Journal : enum `SystemJournalPayload.event` etendu (`run_quarantined`/`run_fenced`/`run_recovery_relaunched`) dans `types/persistence.ts` + `AgentJournal.model.ts`. Service `services/runtime/runVisibility.service.ts` (`RunVisibilityPort` + `MongoRunVisibilityService`) : pour chaque evenement, entree `agent_journals` type `system` (cause, `lockHeld`, `fencedOperationId`, `recoveryAttemptCount`, `newRunId` — whitelist, aucun secret) si `agentInstanceId` valide, plus emission de l'evenement runtime vers le workspace ; fail-safe (aucune erreur propagee). Hooks : `MongoExpiredRunReconciler` (5e port optionnel) apres `markRunQuarantined` (`run_quarantined`, `lockHeld: true`) ; `FenceAndRetryService` (10e param optionnel) apres audit (`run_fenced`, `lockHeld: true`) puis apres retry (`run_recovery_relaunched`, `lockHeld: false`, `newRunId`, `recoveryAttemptCount`) ; `FenceAndRetryRunView` + store : `agentInstanceId` ; `server.ts` et routeur `workspaceRuns` par defaut : `MongoRunVisibilityService` partage. WebSocket non touche (le `userId` temporaire reste le perimetre exclusif d'US-J7-12) ; l'isolation par workspace reste appliquee dans `WebSocketManager.emitRuntimeEvent`. Alertes `runtime_alerts` critical sur 504 deja en place (US-J7-07). Tests : `runtime-event.contract.test.ts` +3, `runtime-event.publisher.test.ts` +3, `run-visibility.service.test.ts` (6), `fence-and-retry.visibility.test.ts` (3), `mongo-expired-run-reconciler.test.ts` +2 ; `websocket-auth.test.ts` inchange et vert. Validations : `tsc --noEmit` OK, `npm run audit:workflow-architecture:strict` OK, `npm run ci:node25:runtime` OK, suites cible 16 suites/128 tests OK, `cd backend && npm test -- --runInBand` 121 suites passees/5 skippees, 808 tests, EXIT=0, `npm test -- --runInBand` racine 90 suites/542 tests EXIT=0, live Docker `AIRDD2_TEST_DOCKER_RESERVATION=1` 2 suites passees/2 skippees, 12 tests, EXIT=0. **Handoff US-J7-10 (`04-cicd-installation`) :** deploiement systemd corrige + validation operationnelle reelle sur l'hote Linux (SIGKILL backend, restart gateway, fence-and-retry reel via API) ; lire la section US-J7-10, le README (deploiement systemd, « Isolated Linux recovery validation ») et la conception §8.

### US-J7-10 - Deploiement corrige sur l'hote Linux cible et validation operationnelle

**Agent responsable :** `04-cicd-installation.agent.md` - CI/CD et installation
**Criticite :** Critique
**Description :** deployer les unites systemd corrigees (`airdd2-docker-gateway.service`, `airdd2-backend.service`, env files root-owned 0640) sur l'hote Linux de production apres build (`dist/src/server.js`, `dist/src/services/runtime/dockerGatewayMain.js` verifies), `systemctl daemon-reload`, enable/start, puis valider : `/api/health/ready` = 200 (Mongo + epoch gateway + worker), SIGKILL reel du backend sous systemd (conteneur arrete, `worker_lost`/`quarantined` persiste, verrou tenu/libere selon preuve), restart du gateway avec operation incertaine reelle (admission rouvre, operation fencee, reservation de nom), puis `fence-and-retry` reel via API avec preuve label/ID -> `202` + nouveau run `queued`. Ne jamais lancer de smoke destructif sur la base de production ; base de test explicite, disposable et verifiee.

**Dependances :** US-J7-05, US-J7-06, US-J7-07.

**Risques et consequences :**
- un deploiement sur la mauvaise base ou le mauvais hote serait destructif ; verifier l'URI Mongo et l'hote avant toute operation ;
- les chemins `dist/src/...` doivent correspondre a la sortie reelle du build ;
- aucun nettoyage de journal ni liberation de verrou manuel sur l'hote ; uniquement la procédure fence-and-retry.

**Impacts codebase et tests :**
- `backend/deploy/systemd/*`, `backend/deploy/recovery-validation/*` (scenarios fencing label/ID en labo isole avant l'hote), section deploiement du `README.md`, `backend/documentation/**` ;
- validation documentee (commandes exactes, captures, resultats) dans `j6-validation-report.md`.

**Criteres d'acceptation :**
- unites a jour deployees sur l'hote cible, health/ready 200 ;
- scenario SIGKILL + restart gateway + fence-and-retry reel execute et trace sur l'hote ;
- aucune donnee de production perdue ou nettoyee manuellement.

**Etat d'avancement (2026-11-18, agent `04-cicd-installation`, branche `feat/j7-02-quarantine-exit-fencing`) : IMPLEMENTEE ET VALIDEE EN LABO ISOLE (commit voir `git log`).** Unites systemd corrigees : `ConditionPathExists` sur les env files, `RequiresMountsFor=/opt/airdd2/backend/storage/workspaces`, `ExecStartPre=/usr/bin/test -f` sur `dist/src/server.js` / `dist/src/services/runtime/dockerGatewayMain.js` ; env examples documentes (root-owned 0640, secrets JWT/REFRESH/ENCRYPTION requis, `RUNTIME_*_IMAGE` identiques des deux cotes). README corrige : le paragraphe « le gateway ne rouvre pas » est remplace par la semantique US-J7-05 (fencing auto `auto_epoch_rotation` a la rotation d'epoch, admission rouverte immediatement, reservation de nom, runbook `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry` avec preuve `verifyFenced`, journaux jamais effaces). Labo `backend/deploy/recovery-validation` : `setup.sh` fixe `RUNTIME_*_IMAGE=ubuntu:noble` (image inerte resoluble par le gateway) ; `validate-systemd.cjs` reecri aux nouvelles semantiques et execute pour de vrai sous systemd + dind (5/5 PASS, exit 0, run propre `up --build --wait` / `docker pull ubuntu:noble` / validate / `down -v`) : (1) SIGKILL reel du backend -> run sans preuve `quarantined`, verrou tenu, conteneur intact ; (2) restart gateway avec operation `run` reelle incertaine (pending injecte + conteneur labelise `airdd2.gateway.op`/`airdd2.execution.attempt`) -> fencing auto, epoch+1, socket rouvert, reservation de nom (`docker run` differee sur le nom echoue), quiescence prouvee, conteneur tue par ID ; (3) restart backend -> run `worker_lost`, verrou libere (`owner === runId`) ; (4) `fence-and-retry` reel via API (JWT + Idempotency-Key) -> 202 + run fils `queued` (`retryOfExecutionId`, `recoveryAttemptCount` 1) + audit `gateway_fence_audit` immuable + verrou libere, rejeu 200 sans effet ; (5) cas negatif sans operation fencee -> 504 `FENCING_TIMEOUT_ESCALATED` + alerte `critical` persistee + verrou tenu + aucun audit. Journaux jamais effaces, cleanup limite aux fixtures. Non-regression : build `tsc` exit 0, backend 121 suites/808 tests EXIT=0, root 90 suites/542 tests EXIT=0, `audit:workflow-architecture:strict` OK, `ci:node25:runtime` 20/20 PASS, `audit:all` exit 0, live Docker 4 suites/23 tests PASS. Resultats detailles dans `j6-validation-report.md`. **Reste ouvert :** deploiement reel sur l'hote Linux de production (hors acces agent — procedure README § deploiement systemd, push/merge faits par l'utilisateur) ; la validation labo ne le remplace pas. **Handoff US-J7-11 (`08-testeur-e2e`) :** lire cette section + conception §7-§8.

### US-J7-11 - Stabilisation avant campagne finale : `minimize-restore` et attachement workspace live

**Agent responsable :** `08-testeur-e2e.agent.md` - Testeur E2E final
**Co-responsable :** `06-frontend.agent.md`
**Criticite :** Haute
**Description :** corriger les deux echecs connus avant la campagne J7-04 : le scenario semi-E2E `minimize-restore` qui ciblait le port 4000 au lieu du serveur de test 4173, et l'echec reproductible d'attachement workspace en campagne live (fichier non retrouve dans l'UI). Aucune assertion ne doit etre assouplie pour masquer une regression.

**Dependances :** aucune bloquante ; requis avant `US-J7-04`.

**Risques et consequences :**
- un test corrige en affaiblissant ses assertions invaliderait la campagne ; les corrections portent sur la cible (port, fixture, timing) pas sur les criteres.

**Impacts codebase et tests :**
- `tests/fonctionnels/minimize-restore.semi-e2e.spec.ts`, `tests/fonctionnels/AuthenticatedWorkspaceMedia.live.smoke.spec.ts`, `playwright.config.ts`, fixtures concernees.

**Criteres d'acceptation :**
- les deux scenarios passent en environnement isole sans assertion affaiblie ;
- `npm run test:j6:semi-e2e` et la campagne live isolee sont vertes.

**Etat d'avancement (2026-11-19, agent `08-testeur-e2e`, branche `main`) : IMPLEMENTEE ET VALIDEE EN ISOLE.** Diagnostic : (1) `minimize-restore` — la cible port 4000 etait deja corrigee (goto relatif, baseURL 4173) mais le scenario echouait encore : au `onNodeDragStop`, `node.measured.width` restait fige a la largeur non minimisee (384) alors que le DOM mesurait 256, donc `findCollisionFreeWorkflowNodePosition` rapprochait le noeud de 452 u (384+pad 20+gap 48) du voisin et l'assertion `minimized.x + stationary.width > stationary.x` etait mathematiquement inaccessible (clamp a 321.6 px ecran, seuil 369.2). Correction racine dans `components/WorkflowCanvas.tsx` : `onNodeDragStop` resout la collision avec la taille DOM reelle (`offsetWidth/offsetHeight`, repli sur `measured`/`width`) ; le spec attend la geometrie minimisee stabilisee et calcule la cible du drag depuis la boite stabilisee (bord droit a 10 px du voisin) — assertions inchangees. `playwright.config.ts` : `--strictPort` sur le webServer (plus de bascule silencieuse vers 4000) et `expect.timeout` 10 s -> 30 s (rendu dev a froid) ; `package.json` : `minimize-restore.semi-e2e.spec.ts` ajoute a `test:j6:semi-e2e`. (2) campagne live — l'echec « fichier non retrouve dans l'UI » venait du demarrage a froid (compilation Vite a la demande + hydratation) qui depassait les timeouts de 20 s/15 s : `AuthenticatedWorkspaceMedia.live.smoke.spec.ts` timeouts 20 s -> 60 s (14 sites, criteres inchanges), `playwright.live.config.ts` `expect.timeout` 15 s -> 45 s ; `tests/fonctionnels/AuthWorkspace.live.smoke.spec.ts` gagne `test.slow()` (le reload a froid depassait le budget 120 s). Validations : `npm run test:j6:semi-e2e` 11/11 PASS (2 runs consecutives, serveur 4173 demarre a froid par Playwright), campagne live isolee (Mongo ephemere dedie + backend dedie, frontend froid) : `AuthenticatedWorkspaceMedia` 5 PASS / 1 skip (sandbox Python non pret) / 0 fail, `AuthWorkspace` PASS, `GuestStartup` PASS ; `test:canvas:non-regression` 12/12, `test:components:ci` 111/111, jest `tests/utils` + hydratation 24/24. **Reste ouvert :** sur le backend dev partage (port 3001, base dev) la campagne live reste flaky a froid (overlay d'hydratation qui ne se leve pas dans les 60 s) — non reproductible sur stack isolee ; a confirmer lors du prochain labo isole US-J7-04.

**Etat d'avancement (2026-11-19, agent `06-frontend`, co-responsable, branche `main`) : les deux points rapportes par `08-testeur-e2e` hors perimetre de son US sont traites a la racine dans `components/WorkflowCanvas.tsx`.** (1) `measured` perime apres minimize — cause racine confirmee et corrigee : le wrapper `onToggleNodeMinimize` ecrivait `node.measured` depuis un `offsetWidth` lu pendant la transition CSS (`transition-all duration-300`, `w-96` <-> `w-64`), et React Flow v11 ne gere pas `measured` (il maintient `width`/`height` via son propre ResizeObserver) : la valeur transitoire masquait ensuite la vraie taille (`measured?.width ?? width`). Le wrapper n'ecrit plus jamais `measured` ; il observe desormais le noeud (ResizeObserver + `transitionend`, debounce 120 ms, secours 600 ms) et ne re-evalue la collision qu'avec la taille stabilisee, avec repli sur `width`/`height` (l'heuristique `> 300 -> 384` est supprimee). Le contournement au point de consommation (`onNodeDragStop` avec taille DOM reelle) est conserve comme defense en profondeur. (2) Second drag immediat apres un drop resolu par collision — cause racine : en mode controle, le `node` passe a `onNodeDragStop` est lu dans le store interne de React Flow, resynchronise seulement au commit du rendu suivant ; lors d'un second drag immediat, `node.position` pouvait etre la position d'avant le drag, et la resolution de collision depuis cette position ramenait le noeud en arriere (« ne bouge pas »). `onNodeDragStop` utilise desormais la derniere position appliquee via `onNodesChange` (ref `lastNodePositionChangesRef`), source de verite du point de lacher. (3) L'overlay d'hydratation > 60 s sur backend dev partage (port 3001) reste « ouvert » comme note par `08-testeur-e2e` — non reproductible en stack isolee, a confirmer au labo US-J7-04 ; aucune assertion assouplie. Tests de regression ajoutes (echouent sur l'ancien code, passent sur le nouveau) : `tests/components/WorkflowCanvas.drag-collision.test.tsx` (second drag resolu depuis la derniere position appliquee, pas depuis le noeud evenementiel perime) et `tests/components/WorkflowCanvas.minimize-restore.test.tsx` (aucun `measured` ecrit, correction avec la taille stabilisee 256x120 via `findCollisionFreeWorkflowNodePosition`). Validations : `test:canvas:non-regression` 14/14, `test:components:ci` 113/113, jest `tests/utils` + hydratation 43/43, `npm run test:j6:semi-e2e` 11/11 PASS (serveur 4173 froid, incluant `minimize-restore.semi-e2e.spec.ts` 1/1). Aucun critere assoupli. **Verification croisee `08-testeur-e2e` (2026-11-19) :** les 2 nouveaux tests de regression echouent bien sur le `WorkflowCanvas.tsx` de HEAD (2/5 failed) et passent sur le nouveau (5/5) ; re-executions independantes : `test:canvas:non-regression` 14/14, `test:components:ci` 113/113, jest racine complet EXIT=0 (542 tests), `npm run test:j6:semi-e2e` 11/11 PASS (serveur 4173 froid), campagne live isolee complete (Mongo ephemere + backend dedie, frontend 4174 froid) 7 PASS / 1 skip (sandbox Python non pret) / 0 fail incluant le scenario d'attachement workspace ; `tsc --noEmit` : 14 erreurs, toutes identiques au baseline HEAD (aucune nouvelle). **Verdict `08-testeur-e2e` : GO pour merge sur `main` de l'US-J7-11** (criteres d'acceptation remplis, aucune assertion assouplie).

### US-J7-12 - Securite WebSocket : remplacer le `userId` temporaire par une authentification JWT stricte

**Agent responsable :** `02-securite.agent.md` - Securite
**Criticite :** Critique
**Description :** traiter la dette signalee en section 4.1 : `backend/src/websocket/WebSocketManager.ts` genere encore un `userId` temporaire cote socket. Remplacer par une authentification JWT stricte a la connexion/join, avec filtrage strict par `workspaceId` avant d'exposer les etats runtime (y compris les etats de quarantaine US-J7-09). Aucun `userId` temporaire ne doit subsister.

**Dependances :** US-J7-09 (les evenements de quarantaine seront exposés sur ce canal).

**Risques et consequences :**
- exposer des etats de run/quarantaine sans authentification forte serait une fuite inter-utilisateurs ;
- la reconnexion navigateur doit revalider le token (pas de session implicite).

**Impacts codebase et tests :**
- `backend/src/websocket/WebSocketManager.ts`, `backend/src/middleware/auth.middleware.ts` (helper de verification socket), tests `websocket-auth.test.ts` (etendus), contrat `runtime-events-versioning.md`.

**Criteres d'acceptation :**
- join refuse sans JWT valide ; invite et autre proprietaire refuses ; filtrage `workspaceId` verifie ;
- aucun `userId` temporaire dans le code ; tests websocket-auth etendus restent verts.

**Etat d'avancement (2026-11-19, agent `02-securite`, branche `main`) : IMPLEMENTEE ET VALIDEE.** Dette section 4.1 traitee : plus aucun `userId` temporaire cote socket. Nouveau helper dedie `backend/src/middleware/socketAuth.middleware.ts` : `extractSocketToken` (auth.token ou Authorization Bearer), `verifySocketAccessToken` (verifyAccessToken + chargement User actif, erreurs `SOCKET_AUTH_REQUIRED`/`SOCKET_AUTH_INVALID`), `buildAuthenticatedSocketData`, `generateUserColor`. `WebSocketManager.ts` : le middleware `io.use` appelle `verifySocketAccessToken` et rejette toute connexion sans JWT valide (deny by default, plus de branche guest) ; `SocketData` devient `AuthenticatedSocketData` (userId/role/userInfo issus du JWT verifie + DB, `isAuthenticated` supprime) ; `handleWorkspaceJoin` conserve le filtrage ownership `Workflow.exists({_id, userId})` avant join ; `emitRuntimeEvent` conserve le filtrage strict (workspaceId valide + contrat Zod + `event.workspaceId === room`) et n'emet que vers des rooms peuplees exclusivement de proprietaires authentifies ; nouvelle methode publique `canAccessWorkspace(userId, workspaceId)`. Frontend `services/webSocketService.ts` : plus de tentative de connexion sans token (message d'erreur explicite), arret des retries auto sur erreur `SOCKET_AUTH_*`, `connectionState.userId` ne derive plus de `socket.id` ; la reconnexion relit un token frais via `readAccessToken()` (pas de session implicite). Contrat `runtime-events-versioning.md` mis a jour (section US-J7-12 : regles deny-by-default, filtrage workspaceId, reconnexion). Tests `websocket-auth.test.ts` etendus : 16/16 PASS — connexion refusee sans token / token invalide / Bearer invalide / user inactif ; connexion owner acceptee ; join refuse pour autre proprietaire et workspaceId invalide ; aucun `guest:` dans le source WebSocketManager ni socketAuth ; `emitRuntimeEvent` rejette mismatch workspaceId, format invalide, payload malforme ; `run:quarantined` emis uniquement vers la room du proprietaire (intruder ne recoit rien) ; `canAccessWorkspace` owner vs intruder ; reconnexion avec JWT frais acceptee. Validations : `tsc --noEmit` backend exit 0, 8 suites cibles (websocket-auth, runtime-event.contract, runtime-event.publisher, runtime-health, auth-workflows, runtime-wrappers x2, runtime-legacy-coupling) 59/59 PASS, `npm run audit:workflow-architecture:strict` OK, `tsc --noEmit` racine 14 erreurs identiques au baseline HEAD (aucune nouvelle). **Handoff US-J7-03 (`06-frontend`) :** le canal temps reel est desormais JWT-strict ; les etats de quarantaine US-J7-09 transitent uniquement vers les proprietaires authentifies du workspace.

### US-J7-03 - Terminer le cutover UI J5 des commandes et statuts runtime

**Agent responsable :** `06-frontend.agent.md` - Front-end
**Criticite :** Critique
**Description :** exposer les commandes V2 sur la carte et afficher l'etat serveur/realtime, en utilisant le contrat livre par US-J7-01/02 et sans graphe local concurrent.

**Dependances :** US-J7-01, US-J7-02 (chapeau : `US-J7-05` a `US-J7-10` livrees) ; `US-J7-07` (endpoint `fence-and-retry` consomme par le bouton Reset & Relance) ; `US-J7-09` (statuts et evenements de quarantaine a afficher) ; `US-J7-12` (canal temps reel securise avant d'exposer les etats de quarantaine). Le plan UI detaille (toolbar, bouton Reset & Relance, statuts `worker_lost`/`quarantined`, etat du verrou) sera produit par `09-architecte-applicatif` avant execution.
**Risques et consequences :**
- boutons sans contrat serveur coherents peuvent afficher pause/reprise alors qu'ils annulent ou relancent ;
- un statut local ou un evenement d'un autre workflow peut afficher un run faux ;
- l'ajout d'une barre overlay peut deplacer le canvas et violer la non-regression de position/minimap/controls.

**Impacts codebase et tests :**
- `components/RobotPageRouter.tsx`, `components/workflow/WorkflowToolbar.tsx`, `services/workflowRunService.ts`, `services/runtimeActionPolicy.ts`, stores runtime/design, localization `i18n/*.ts` ;
- tests toolbar, router, `tests/stores/useRuntimeStore.runtime-events.test.ts` et `WorkflowCanvas.route-reentry.semi-e2e.spec.ts` ;
- `Guides/Features/WORKFLOWLINKS/README.md` et l'etat J5 du backlog a actualiser a la cloture.

**Decision UX/contrat :**
- monter la toolbar uniquement sur la carte workflow et la garder dans le flux layout, hors viewport React Flow ;
- afficher `Lancer`, `Annuler` avec confirmation, et `Relancer` pour creer un nouveau run parent-enfant ; ne pas afficher `Pause`/`Reprendre` tant qu'ils ne sont pas reellement supportes ;
- afficher les statuts run/task et etats `loading`, `empty`, `error`, `offline`, `reconnecting`, `degraded/partial` ; filtres stricts par `workflowId` ; actions desactivees selon l'etat serveur et la connectivite ;
- le statut REST reste autoritaire et recharge le dernier etat apres reconnexion ; aucun token/secret dans affichage ou localStorage.

**Criteres d'acceptation :**
- toolbar visible sur `/bos/dashboard` et `/bos/supervision`, absente des autres routes ; graph nodes/edges pris dans `useDesignStore` ;
- confirmation refusee = aucune commande; confirmation acceptee = annulation serveur effective ; erreur serveur conserve et affiche l'etat autoritaire ;
- evenement de progression/succes/echec du workflow actif met a jour l'UI sans reload ; evenement d'un autre workflow ignore ; refresh REST retablit l'etat apres reconnexion ;
- commandes indisponibles lorsque le run est actif/terminal ou le canal est hors ligne/partiel ; clavier, focus, `role="status"` et messages d'erreur accessibles ;
- Playwright verifie que nodes, minimap et controls gardent leurs positions avec la toolbar, durant un run et apres retour/reload.

### US-J7-04 - Rejouer J6 en environnement isole et prononcer le gate

**Agent responsable :** `08-testeur-e2e.agent.md` - Testeur E2E final
**Criticite :** Critique
**Description :** reexecuter les 18 scenarios J6-01 et la matrice J6-02 apres livraison des US-J7-01 a J7-03 ; classer les anomalies et fournir un verdict final documente.

**Dependances :** US-J7-01, US-J7-02 (chapeau : `US-J7-05` a `US-J7-10` livrees et validees), `US-J7-11` (stabilisation des deux echecs connus), US-J7-03 ; suites J3/J4 restent vertes.
**Risques et consequences :**
- smoke live sur une base partagee peut detruire ou polluer des donnees ;
- test uniquement chromium peut manquer des regressions de reload/focus/scroll ;
- une fixture assouplie peut masquer une vraie regression historique ;
- un PASS partiel presente comme GO annulerait la valeur de la validation finale.

**Impacts codebase et tests :**
- `tests/fonctionnels/**`, `playwright.config.ts`, `playwright.live.config.ts`, `backend/src/__tests__/**` et `Guides/Features/feature/refonte/j6-validation-report.md` ;
- reutiliser le compte synthétique et les mocks semi-E2E ; test backend live seulement sur URI de test explicitement isolee et verifiee ;
- couverture `npm test`, `npm run test:coverage`, backend, `npm run ci:node25:runtime`, `npm run test:j6:semi-e2e`, `npm run test:j6:backend`, audit strict ; Chromium + Firefox/WebKit si ces projets sont declares dans la matrice CI.

**Criteres d'acceptation :**
- les 18 scenarios nominaux/echec sont executes ou chaque exception est approuvee et classee bloquante/non bloquante ; aucun `test.skip` opportuniste ;
- auth, creation/chargement, ajout agent, activation, run queued/running, succes/echec, annulation effective, retry nouveau-run, reload en run, reconnexion, ownership, migration, redemarrage/recovery et panne sandbox sont verifies ;
- J6-02 revalide toutes les routes V1, lecture V2-only, donnees historiques, mode invite et API refusee, sans affaiblir aucune fixture ;
- traces/captures/video d'echec conserves tant que les deux US J6 ne sont pas fermees ; le nettoyage des traces est une action post-cloture distincte, jamais un substitut a la preuve ;
- rapport final contient matrice resultat, anomalies classees, commandes/config exactes et decision signee `GO` ou `NO-GO` ; `GO` impossible si une anomalie critique ou un scenario de redemarrage/cancel reste ouvert.

## 7. Adaptations fonctionnelles et structurelles a anticiper

Les modifications du backlog impliquent potentiellement :

- creation de nouveaux modules sous `backend/src/domain/**`, `backend/src/application/**` et `backend/src/infrastructure/repositories/**` ;
- refactor de `backend/src/routes/**` pour alleger les controllers ;
- decoupage de `backend/src/services/databaseInit.ts` ;
- ajout ou mise a jour de migrations dans `backend/src/migrations/**` ;
- creation ou adaptation de stores et services frontend hors de `App.tsx` ;
- adaptation des fixtures d'hydratation, de snapshot et de runs si les contrats changent reellement.

Toute suppression de fichier ou dossier legacy doit etre precedee d'un inventaire d'usage, d'une verification de compatibilite et d'une strategie de repli.

## 8. Matrice d'adaptation des fixtures QA et BDD

| Surface | Fichiers ou sources | Jalon principal | Adaptation attendue | Nature du changement |
|---|---|---|---|---|
| Hydratation frontend | `tests/fixtures/workspaceHydration.fixtures.ts` | J1, J5 | aligner le payload de workflow, nodes, edges, agentInstances et etats runtime sur les contrats V2 reellement retenus | fonctionnel |
| Snapshot backend unifie | `backend/src/__tests__/workspace-snapshot.test.ts` | J1, J2, J3, J4 | mettre a jour le snapshot si la source de verite, les runs, les edges ou les journaux changent | fonctionnel |
| Fixtures auth workflow | `backend/src/__tests__/auth-workflows.routes.test.ts` | J1, J4 | adapter si les droits, claims JWT ou filtres d'ownership evoluent | securite |
| Fixtures runs et artifacts | `backend/src/__tests__/function-runs.routes.test.ts` | J2, J4 | adapter aux nouvelles transitions, a l'idempotence et aux payloads d'artefacts | fonctionnel |
| Fixtures runtime sandbox | `backend/src/__tests__/sandbox.routes.test.ts` | J2, J3, J4 | adapter si les statuts de run/task, policies d'execution ou erreurs changent | runtime |
| Seeds techniques backend | `backend/src/seeds/**` | J3 | maintenir la compatibilite des jeux de donnees et documenter tout nouveau seed | donnees |
| Bootstrap et seed central | `backend/src/services/databaseInit.ts` | J0, J3 | isoler bootstrap, migrations et seed sans casser les donnees d'entrainement QA | donnees |
| Smoke tests live QA | `tests/fonctionnels/AuthenticatedWorkspaceMedia.live.smoke.spec.ts` | J5, J6 | verifier si les parcours rehydrates, medias ou journaux changent de forme ou de source | fonctionnel |
| Parcours hydratation | `tests/fonctionnels/App.workspaceHydration.integration.test.tsx` | J5 | adapter a la nouvelle autorite V2 sans reintroduire de reconstruction V1 cote client | fonctionnel |
| Fixtures BDD d'entrainement QA | base Mongo locale, seeds et scripts de demarrage | J3, J6 | verifier que les donnees de formation restent exploitables apres migration et cutover | donnees |

### Regles pour les agents

- toute modification de fixture doit etre rattachee a une evolution fonctionnelle identifiee ;
- une fixture ne doit jamais etre assouplie pour masquer une regression ;
- si une fixture change de forme, documenter quel contrat a change, quel jalon l'impose et quels tests doivent etre rejoues ;
- si les QA utilisent des donnees seedees en BDD, toute migration doit inclure un mode de reprise ou de re-seed documente.

## 9. Changements fonctionnels a anticiper

| Theme | Changement probable | Jalons concernes | Impact utilisateur ou QA |
|---|---|---|---|
| Workflow comme source de verite | fin progressive de la dependance a `Workflow.nodes` et `Workflow.edges` | J0 a J3 | differences possibles de contenu hydrate ou de restauration si la compatibilite n'est pas preservee |
| Publication et activation | validation plus stricte avant activation d'un workflow | J1, J2 | certains workflows historiquement acceptes peuvent devenir invalides tant qu'ils ne sont pas corriges |
| Runs et tasks | apparition d'etats explicites et comportements d'annulation ou retry plus stricts | J1 a J4 | les QA devront tester davantage de transitions et de cas d'echec |
| Temps reel | filtrage utilisateur et payloads versionnes | J1, J3, J5 | comportements de reconnexion et d'observation potentiellement modifies |
| Hydratation frontend | source V2 prioritaire et reduction de la reconstruction locale | J5 | le chargement initial peut changer de forme, de timing ou de messages d'etat |
| Migrations de donnees | backfill V1 -> V2 et suppression progressive du legacy | J3, J4, J6 | besoin de verifier la conservation des workflows historiques et des jeux de donnees QA |
| Seeds et bootstrap | separation bootstrap / migrations / seed | J3 | les environnements de formation QA peuvent requerir un nouveau mode d'initialisation |

### Consigne explicite aux agents

- avant tout changement de code, verifier si le jalon implique une matrice d'adaptation de fixtures QA/BDD ;
- si oui, mettre a jour a la fois la liste des fichiers touches et l'impact fonctionnel attendu ;
- ne jamais supposer qu'une adaptation de fixture est neutre fonctionnellement ;
- si un changement met en danger le 100 % vert des tests existants, traiter cela comme un bloqueur de jalon.

## 10. Sequence d'execution imposee

1. Terminer J0 avant toute extraction lourde.
2. Terminer J1 avant les repositories et use cases backend.
3. Terminer J2 avant les migrations de donnees et le runtime distribue.
4. Terminer J3 avant la campagne de resilience et avant le cutover frontend complet.
5. Terminer J4 avant la validation finale.
6. Terminer J5 avant J6.
7. Si J6 conclut `NO-GO`, executer les US J7 applicable(s), puis reexecuter J6-01 et J6-02 avant tout verdict `GO`.
8. Ordre impose dans J7 (2026-11-18) : `US-J7-05` -> `US-J7-06` -> `US-J7-07` -> `US-J7-08` et `US-J7-09` -> `US-J7-10` ; `US-J7-11` et `US-J7-12` peuvent tourner en parallele mais doivent etre fermees avant `US-J7-03` et avant la campagne `US-J7-04` ; `US-J7-04` rejouera J6-01/J6-02 apres livraison complete de J7.

## 11. Points de vigilance transverses

- `App.tsx` est une zone a haut risque de regression car il centralise encore hydratation, persistance et navigation.
- `backend/src/routes/**` est une zone a haut risque de derive car elle melange historiquement plusieurs generations de contrats.
- `backend/src/services/databaseInit.ts` est une zone a haut risque car elle concentre bootstrap, migration et seed.
- `stores/useWorkflowStore.ts` ne maintient plus d'agregat local `Workflow` avec `nodes` et `edges` (retire le 2026-10-29) ; il ne porte que les metadonnees du workflow courant et l'etat de run.
- `services/workspacePersistenceService.ts` reste une surface de derive frontend car `saveEdges()` pointe encore vers un write path legacy `/api/workflows/:id/edges`.
- `backend/src/websocket/WebSocketManager.ts` doit etre traite comme surface de securite et de coherence runtime, pas comme simple detail technique.
- Toute user story touchant les statuts de run ou task doit verifier l'impact sur le temps reel, les retries et les annulations.
- Toute user story touchant les migrations doit verifier l'impact sur les workflows existants, les fixtures QA et la reprise apres incident.

## 12. Definition of Done du backlog

Le backlog est considere execute quand :

1. toutes les user stories critiques sont implementees et testees ;
2. V2 est la seule source d'ecriture metier ;
3. les migrations sont rejouables sans doublon ;
4. les runs et tasks sont pilotables sans navigateur ouvert ;
5. le frontend ne reconstruit plus de verite concurrente depuis V1 ;
6. les fixtures QA et automatiques ont ete adaptees explicitement quand les contrats ont change ;
7. les suites de tests impactees restent au vert ;
8. la validation domaine et E2E produit un resultat exploitable pour la livraison.

## 13. TODO - Gate de cutover V2

**Trigger de decision :** apres `J4` et avant `J5`.

**Objectif :** verifier que le système est prêt pour le cutover effectif de V2 sans reliquat fonctionnel ou technique majeur de `V1`.

**Critere d'entree :**
- `J3` est valide sur bootstrap, migrations idempotentes, reprise et runtime infra ;
- `J4` est valide sur invariants, transitions, migrations, reprise et resilience runtime ;
- les lectures legacy critiques restantes sont neutralisees, documentees ou explicitement compatibilisees ;
- `V2` est la source de verite operationnelle pour workflows, nodes, edges, runs et tasks.

**Checklist de validation avant cutover :**
- audit architecture V1/V2 a zero lecture legacy critique sur les routes, services et snapshots ;
- migration V1 -> V2 relancee sans doublon et reprise apres echec verifiees ;
- tests de non-regression sur les workflows invalides, les transitions interdites et les contraintes d'ownership ;
- tests de panne, retry, annulation et reprise sur runs/tasks ;
- traitement particulier de gestion des runs et des erreurs : definir la retention, la reconciliation, la liberation et le nettoyage des preuves d'execution, ainsi que l'exploitation des etats incertains ; ne jamais supprimer ces preuves ni liberer un workspace avant verification des garanties de surete ;
- validation des fixtures QA et des jeux de donnees historiques ;
- verification que la Definition of Done de la phase 2 est satisfaite ;
- validation fonctionnelle minimale sur le front et le runtime avant ouverture du cutover complet.

**Decision gate :**
- `GO` : si tous les criteres sont satisfaits et que la resilience et la coherences des donnees sont confirmes ;
- `NO-GO` : si au moins un chemin legacy critique reste actif, ou si une migration, une transition ou une reprise n'est pas stable.

**Responsabilites de validation :**
- `01-architecte-bdd.agent.md` : verifie l'etat des sources de verite et le plan de compatibilite ;
- `03-backend.agent.md` : valide le backend V2 et les chemins d'ecriture/lecture ;
- `05-testeur-domaine.agent.md` : confirme les invariants, la reprise et la resilience ;
- `06-frontend.agent.md` : valide que le front consomme V2 sans reconstruire de verite locale V1.

**Condition de continuation :**
- le cutover ne doit pas etre lance tant que le gate n'est pas validé par la triade architecture / backend / validation domaine ;
- `J5` doit alors servir la bascule front sur le contrat V2 deja verrouille, tandis que `J6` confirme la livraison finale et la non-regression E2E.