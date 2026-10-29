# Plan chronologique d'implementation de la refonte V1 -> V2

**Statut :** plan validé sur la phase J0/J1 et prêt pour le jalon suivant
**Date :** 2026-10-29
**Sources :**
- `Guides/Features/feature/workflow-server.md`
- `Guides/Features/feature/architecture-v1-v2-migration-plan.md`
- `Guides/Features/feature/refonte/v1-v2-drift-analysis.md`

## 1. Objectif

Supprimer la derive entre les modeles V1 et V2 sans reecriture globale, etablir V2 comme architecture canonique et rendre l'execution des workflows persistante, observable, reprise sur panne et independante de l'ouverture du navigateur.

## 2. Decision d'architecture

La cible canonique est V2.

Toute nouvelle fonctionnalite doit ecrire exclusivement dans les entites suivantes :

- `workflows`
- `workflow_nodes`
- `workflow_edges`
- `agent_prototypes`
- `agent_instances`
- `agent_journals`
- `runs`
- `tasks`
- `artifacts`

Les champs historiques embarques dans `Workflow.nodes` et `Workflow.edges` ne doivent plus etre une source de verite. Ils peuvent subsister temporairement pour lecture legacy, migration et rollback controle, mais aucun nouveau flux metier ne doit dependre d'eux.

## 3. Principes d'execution

### 3.1 Stabilite et non-regression

- migration incrementale uniquement ;
- aucune rupture API sans couche de compatibilite ou de desactivation explicite ;
- chaque phase doit etre testable et reversible ;
- aucun couplage supplementaire entre persistance, domaine et UI.

### 3.2 Separation des couches

Le flux cible doit etre :

```text
HTTP / WebSocket
    -> Controller
    -> Use case
    -> Domain policy / state machine
    -> Repository
    -> MongoDB / infrastructure
```

### 3.3 Source de verite unique

- `workflows` : metadonnees, statut, version, revision
- `workflow_nodes` : noeuds persistants du graphe
- `workflow_edges` : relations du graphe
- `agent_instances` : configuration operationnelle des agents dans un workflow
- `agent_journals` : historique et evenements d'instance
- `runs` : execution globale
- `tasks` : execution elementaire par node
- `artifacts` : sorties persistantes et references de fichiers

### 3.4 Invariants a proteger

- un workflow archive ne recoit plus de commandes mutantes normales ;
- un edge relie deux nodes du meme workflow ;
- un node d'agent reference une `agent_instance` valide ;
- aucun run termine ne repasse en `running` ;
- aucune route n'ecrit simultanement dans V1 et V2 hors migration explicite ;
- MongoDB reste la source de verite metier ; Redis et la queue ne portent pas seuls l'etat.

## 4. Perimetre de la refonte

### Inclus

- contrats de domaine `Workflow`, `WorkflowNode`, `WorkflowEdge`, `Run`, `TaskInstance` ;
- normalisation de la persistance backend ;
- extraction des repositories et use cases ;
- activation serveur et orchestration runtime ;
- workers, queue, scheduler et reprises ;
- adaptation frontend pour ne plus piloter la persistance ;
- tests de domaine, integration et non-regression ;
- observabilite, journalisation et garde-fous de migration.

### Exclu temporairement

- refonte visuelle large hors impacts directs de navigation runtime/canvas ;
- reimplementation complete de tous les ecrans ;
- suppression physique immediate de toutes les structures V1 avant la fin du cutover.

## 5. Composants impactes

### Backend

- `backend/src/routes/**`
- `backend/src/services/**`
- `backend/src/models/**`
- `backend/src/types/**`
- `backend/src/migrations/**`
- `backend/src/server.ts`
- `backend/src/services/databaseInit.ts`

### Frontend

- `App.tsx`
- `types.ts`
- `stores/**`
- `services/**`
- `components/workflow/**`
- `components/V2AgentNode.tsx`
- ecrans de pilotage workflow et runtime

### Infra

- Redis / queue / workers
- scripts d'audit et migrations
- CI/CD et validation d'installation

## 6. Plan chronologique d'implementation

## Phase 0 - Cadrage et gel architectural

### Objectif

Empêcher toute nouvelle derive pendant la refonte.

### Actions

1. Identifier les points d'entree V1 encore actifs dans le backend et le frontend.
2. Lister les routes legacy et les marquer `@deprecated`.
3. Ajouter une regle de contribution : aucune nouvelle feature ne doit utiliser `Workflow.nodes` ou `Workflow.edges`.
4. Ajouter des logs et compteurs sur chaque appel legacy.
5. Geler l'ajout de nouvelles mutations directes depuis les controllers.

### Livrables

- inventaire des routes legacy
- annotations de depreciation
- convention de revue anti-V1

### Validation

- toutes les routes V1 sont identifiees ;
- aucun nouveau point d'ecriture V1 n'est introduit.

## Phase 1 - Inventaire technique exhaustif

### Objectif

Produire la carte exacte des lectures, ecritures et compatibilites V1/V2.

### Actions

1. Scanner le code pour les references a :
   - `Workflow.nodes`
   - `Workflow.edges`
   - `workflowNodes`
   - `workflowEdges`
   - `agentInstances`
   - `canvasState`
   - `saveWorkflow`
   - `hydrateWorkspace`
   - `persistWorkflow`
2. Classer chaque occurrence : `V1_READ`, `V1_WRITE`, `V2_READ`, `V2_WRITE`, `COMPATIBILITY`, `MIGRATION`, `TEST_ONLY`.
3. Determiner le remplacement cible de chaque acces legacy.
4. Ajouter un script d'audit reproductible pour la CI.

### Livrables

- `Guides/Features/feature/refonte/v1-v2-code-inventory.md`
- `scripts/audit-workflow-architecture.ts`
- commandes `npm run audit:workflow-architecture` et `npm run audit:workflow-architecture:strict`
- annotation runtime des routes V1 legacy dans `backend/src/routes/workflows.routes.ts`

### Validation

- 100 % des references connues sont classees ;
- aucun `UNKNOWN` ;
- la CI peut echouer sur une nouvelle regression architecturale.
- les routes V1 legacy exposent un signal explicite de depreciation et d'usage restant.
- validation confirmée avec `node scripts/audit-workflow-architecture.ts --strict` (sortie finale : `Audit result: OK`).

## Phase 2 - Stabilisation des contrats du domaine

### Objectif

Fixer les contrats canoniques avant tout deplacement de logique.

### Actions

1. Definir les types backend du domaine :
   - `WorkflowDefinition`
   - `WorkflowNode`
   - `WorkflowEdge`
   - `WorkflowRun`
   - `TaskInstance`
   - `ExecutionRequest`
   - `ExecutionResult`
2. Definir `schemaVersion`, `version` et `revision`.
3. Definir les statuts de workflow, run et task.
4. Definir les invariants et les erreurs metier stables.
5. Separer explicitement :
   - entites metier
   - DTO HTTP
   - schemas MongoDB
   - types frontend

### Livrables

- `backend/src/domain/**`
- `backend/src/types/workflow-ir.ts`
- `backend/src/types/workflow-status.ts`
- `backend/src/types/execution-policy.ts`
- documentation des contrats dans `Guides/Features/feature/refonte/`

### Validation

- aucun contrat domaine ne depend d'Express, React ou Mongoose ;
- les proprietes legacy sont explicitement exclues des contrats V2.

## Phase 3 - Validateur d'IR et machines a etats

### Objectif

Rendre l'execution deterministe et rejeter les transitions incoherentes.

### Actions

1. Implementer le validateur d'IR de workflow.
2. Verifier :
   - ports existants
   - types compatibles
   - absence de cycles interdits
   - references d'implementation valides
   - permissions compatibles
3. Implementer les state machines de `Run` et `TaskInstance`.
4. Centraliser les transitions valides et les erreurs de transition.

### Livrables

- `backend/src/validators/workflow-validator.ts`
- `backend/src/domain/run-state-machine.ts`
- `backend/src/domain/task-state-machine.ts`

### Validation

- tests unitaires sur IR valide et invalide ;
- tests de transitions valides et invalides ;
- impossibilite de repasser un `completed` ou `cancelled` en `running`.

## Phase 4 - Extraction des repositories

### Objectif

Confiner la persistance et sortir les acces MongoDB des controllers.

### Actions

1. Definir les interfaces repository pour :
   - workflows
   - workflow nodes
   - workflow edges
   - agent instances
   - runs
   - tasks
   - artifacts
2. Implementer les versions MongoDB en infrastructure.
3. Deplacer la logique de version optimiste dans les repositories.
4. Interdire dans les controllers l'usage direct de `Model.find*`, `update*`, `delete*`.

### Livrables

- `backend/src/infrastructure/repositories/**`
- tests de repository et fixtures

### Validation

- toutes les routes modifiees passent par un repository ;
- les details Mongoose sont confines a l'infrastructure.

## Phase 5 - Extraction des use cases backend

### Objectif

Sortir la logique metier de `workflows.routes.ts` et des routes adjacentes.

### Actions

1. Creer les use cases :
   - creer workflow
   - publier version
   - activer / desactiver workflow
   - ajouter / modifier / supprimer node
   - ajouter / supprimer edge
   - creer / synchroniser agent instance
   - lancer run
   - annuler run
2. Faire des controllers de simples adaptateurs HTTP.
3. Uniformiser les codes d'erreur metier.
4. Introduire l'idempotence pour les operations mutantes critiques.

### Livrables

- `backend/src/application/**`
- controllers simplifies

### Validation

- les routes ne contiennent plus de logique metier complexe ;
- les cas metier sont testables sans serveur HTTP.

## Phase 6 - Persistance V2 complete et migrations de donnees

### Objectif

Faire converger les donnees existantes vers V2 et rendre les migrations rejouables.

### Actions

1. Isoler `databaseInit.ts` en responsibilities distinctes :
   - bootstrap technique
   - migrations de schema
   - migrations de donnees
   - seed de developpement
2. Ajouter des migrations versionnees pour :
   - extraction `Workflow.nodes` -> `workflow_nodes`
   - extraction `Workflow.edges` -> `workflow_edges`
   - creation / backfill des `agent_instances`
   - creation / normalisation des `runs` et `artifacts`
3. Introduire un mecanisme de reprise si migration interrompue.
4. Rendre chaque migration idempotente et tracable.

### Livrables

- nouvelles migrations backend
- journal d'execution des migrations
- documentation de rollback

### Validation

- une base partiellement migree peut reprendre ;
- les workflows historiques sont lisibles via V2 ;
- aucun doublon cree apres reexecution.

## Phase 7 - Runtime serveur, activation et orchestration

### Objectif

Permettre a un workflow publie de s'executer sans navigateur ouvert.

### Actions

1. Introduire le concept de version immuable publiee du workflow.
2. Implementer l'activation serveur d'une version.
3. Introduire l'entite `Run` comme execution globale.
4. Generer les `TaskInstance` a partir de l'IR et des dependances.
5. Implementer les transitions :
   - `created`
   - `queued`
   - `running`
   - `waiting`
   - `waiting_for_approval`
   - `paused`
   - `completed`
   - `failed`
   - `cancel_requested`
   - `cancelled`
   - `timed_out`
6. Enregistrer tous les evenements utiles pour l'observabilite et la reprise.

### Livrables

- orchestration runtime backend
- API d'activation et de lancement manuel
- evenements temps reel versionnes

### Validation

- un run peut etre lance sans session frontend ;
- l'etat d'un run est reconstructible apres redemarrage.

## Phase 8 - Queue, workers et scheduler

### Objectif

Distribuer l'execution des taches, gerer les delais, retries et triggers temporels.

### Actions

1. Introduire Redis et la queue technique.
2. Implementer l'acquisition de lease pour `TaskInstance`.
3. Implementer timeout, retry policy et relance.
4. Implementer les workers d'execution native, sandbox et externe.
5. Implementer le scheduler pour cron, webhooks et declencheurs.
6. Garantir qu'aucun etat metier n'est perdu si Redis est vide ou redemarre.

### Livrables

- worker runtime
- scheduler runtime
- gestion des leases et reprises

### Validation

- une tache en cours peut etre reprise si un worker tombe ;
- les retries suivent la policy ;
- Redis ne porte pas seul l'etat metier.

## Phase 9 - Adaptation frontend et decouplage de `App.tsx`

### Objectif

Faire du frontend un consommateur de contrats backend plutot qu'un orchestrateur de persistance.

### Actions

1. Sortir de `App.tsx` les responsabilites de persistance et d'hydratation.
2. Introduire une couche de services ou stores par domaine :
   - workflows
   - workflow nodes
   - workflow edges
   - agent instances
   - runs
3. Separer clairement design domain et runtime domain.
4. Consommer les DTO API V2 sans reconstruire des verites concurrentes cote client.
5. Garder les journaux temps reel et l'observation de runs comme surcouche UI, pas comme source metier.

### Livrables

- stores/domain services frontend
- allegeance de `App.tsx`
- hydratation unifiee V2

### Validation

- le changement de workflow ne depend plus d'une reconstruction hybride V1/V2 ;
- la persistance runtime n'est plus orchestree depuis le composant racine.

## Phase 10 - Compatibilite, cutover et desactivation du legacy

### Objectif

Basculer sans rupture de service vers le mode canonique V2.

### Actions

1. Introduire un feature flag de lecture legacy si necessaire.
2. Basculer les ecritures exclusives sur V2.
3. Mettre les routes V1 en lecture seule si possible.
4. Desactiver progressivement les endpoints legacy restants.
5. Superviser les logs d'usage et les conflits.
6. Preparer le retrait final du code V1 non utilise.

### Livrables

- plan de bascule par environnement
- journal de desactivation des endpoints legacy

### Validation

- plus aucune ecriture metier via V1 ;
- les workflows actifs fonctionnent uniquement via V2.

## Phase 11 - Tests, QA et durcissement final

### Objectif

Verrouiller la non-regression et preparer la maintenance de long terme.

### Actions

1. Ajouter les tests de domaine : validateurs, state machines, invariants.
2. Ajouter les tests d'integration backend : routes, repositories, migrations, runs, tasks.
3. Ajouter les tests frontend sur hydratation et commandes utilisateur.
4. Ajouter un parcours E2E couvrant :
   - creation d'un workflow
   - publication
   - activation
   - lancement d'un run
   - execution de task
   - reprise apres redemarrage
5. Verifier observabilite, logs, compteurs et alertes.
6. Finaliser la suppression du code mort apres stabilisation.

### Livrables

- batterie de tests TNR
- scenarios QA
- checklist de livraison

### Validation

- couverture suffisante des invariants critiques ;
- au moins un scenario de reprise sur panne valide ;
- aucun endpoint critique non couvert ;
- aucune reference V1 non justifiee restante.

## 7. Ordre d'intervention recommande par profil

1. `Architecte BDD` : phases 0 a 3
2. `Securite` : controle d'acces, modeles d'erreurs, permissions sur activation/runs
3. `Backend` : phases 4 a 8
4. `CI/CD et installation` : Redis, workers, scripts de migration, validation d'environnements
5. `Testeur domaine` : couverture des phases 2 a 8
6. `Front-end` : phase 9
7. `Designer UX` : ajustements de parcours sur activation, observation et erreurs runtime
8. `Testeur E2E final` : phases 10 et 11

## 8. Risques principaux et parades

### Risque 1 - Double verite V1/V2 pendant trop longtemps

Parade : interdiction des nouvelles ecritures V1, audit automatique, cutover par feature flag.

### Risque 2 - Migrations partielles ou non rejouables

Parade : migrations idempotentes, journal d'execution, reprise sur echec, tests de reexecution.

### Risque 3 - Regressions frontend dues a l'hydratation hybride

Parade : store de domaine V2 unique, contrats HTTP stabilises, tests de changement de workflow et rechargement.

### Risque 4 - Perte d'etat runtime sur panne worker ou Redis

Parade : etat metier persiste en MongoDB, leases bornes, reprise par scan serveur.

### Risque 5 - Routes trop lourdes et difficiles a maintenir

Parade : extraction systematique controller -> use case -> repository.

## 9. Criteres de fin de chantier

Le chantier peut etre considere termine quand toutes les conditions suivantes sont vraies :

1. Toutes les ecritures metier passent par les contrats V2.
2. Les structures V1 ne sont plus source de verite.
3. Les runs et tasks disposent d'etats explicites et testes.
4. Un workflow publie peut etre active et execute sans navigateur ouvert.
5. Le frontend n'orchestre plus la persistance metier depuis `App.tsx`.
6. Les migrations sont rejouables et documentees.
7. Les tests TNR protegent les invariants critiques.
8. Les endpoints legacy sont supprimes ou desactives de facon maitrisee.

## 10. Sequence d'execution recommandee

L'ordre a suivre sans deviation est le suivant :

1. gel architectural ;
2. inventaire exhaustif ;
3. contrats de domaine ;
4. validateur d'IR et state machines ;
5. repositories ;
6. use cases backend ;
7. migrations V2 ;
8. runtime serveur et activation ;
9. queue, workers et scheduler ;
10. adaptation frontend ;
11. cutover legacy ;
12. QA finale et suppression du code mort.

Cet ordre est impose pour reduire les regressions : il fige d'abord les invariants, deplace ensuite la logique, migre ensuite la donnee et ne coupe enfin le legacy qu'apres validation runtime et frontend.