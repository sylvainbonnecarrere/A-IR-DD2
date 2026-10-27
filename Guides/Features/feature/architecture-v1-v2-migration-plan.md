Oui. Le second livrable peut être ajouté ici :

```text
Guides/Features/feature/architecture-v1-v2-migration-plan.md
```

Dans Git, il est préférable d’utiliser des `/` plutôt que des `\`, même sous Windows.

Voici le plan détaillé prêt à intégrer.

# Plan global de migration et d’évolution d’architecture

**Statut :** Plan de mise en œuvre  
**Date :** 30 septembre 2026  
**Dépendance :** `v1-v2-drift-analysis.md`  
**Objectif :** supprimer progressivement la dérive V1/V2 et établir V2 comme architecture canonique

## 1. Objectif général

Le projet doit évoluer d’une architecture mixte vers une architecture où :

- les workflows sont séparés de leurs nœuds et edges ;
- les instances d’agents sont des entités persistées indépendamment ;
- les runs représentent explicitement les exécutions ;
- les transitions d’état sont contrôlées par le domaine ;
- les routes HTTP ne contiennent plus de logique métier complexe ;
- le frontend ne dépend plus directement des détails de persistance ;
- les migrations sont versionnées et rejouables ;
- les opérations mutantes sont idempotentes ;
- les événements temps réel sont versionnés ;
- les tests protègent les invariants métier.

La migration ne doit pas être une réécriture globale. Elle doit être incrémentale, observable et réversible.

## 2. Principes directeurs

### 2.1 V2 est la seule cible

Toute nouvelle fonctionnalité doit utiliser :

```text
Workflow
WorkflowNode
WorkflowEdge
AgentPrototype
AgentInstance
AgentJournal
Run
Artifact
```

Aucun nouveau code ne doit écrire dans :

```text
Workflow.nodes
Workflow.edges
```

### 2.2 Une seule source de vérité par donnée

| Donnée | Source de vérité |
|---|---|
| Métadonnées du workflow | `workflows` |
| Nœuds graphiques | `workflow_nodes` |
| Relations | `workflow_edges` |
| Configuration réutilisable | `agent_prototypes` |
| Configuration dans un workflow | `agent_instances` |
| Historique d’agent | `agent_journals` |
| Exécution | `runs` |
| Fichiers produits | `artifacts` |
| Paramètres d’exécution | `workspaces` ou configuration dédiée |

### 2.3 Les couches doivent être explicites

La logique doit suivre ce flux :

```text
HTTP / WebSocket
        ↓
Controller
        ↓
Use case
        ↓
Domain policy / state machine
        ↓
Repository
        ↓
MongoDB / infrastructure
```

Les contrôleurs ne doivent pas manipuler directement les modèles MongoDB pour implémenter une règle métier.

### 2.4 Les erreurs doivent être prévisibles

Chaque erreur métier doit disposer d’un code stable :

```text
WORKFLOW_NOT_FOUND
WORKFLOW_FORBIDDEN
WORKFLOW_ARCHIVED
REVISION_CONFLICT
NODE_NOT_FOUND
EDGE_NOT_FOUND
CROSS_WORKFLOW_REFERENCE
INVALID_RUN_TRANSITION
DUPLICATE_IDEMPOTENCY_KEY
LEGACY_API_DISABLED
```

## 3. État de départ

L’architecture actuelle mélange encore les anciennes structures embarquées et les collections V2 dans les routes workflow. Le backend utilise à la fois les tableaux historiques du document `Workflow` et des entités séparées telles que `WorkflowNodeV2` et `WorkflowEdge`. <citation src="8"></citation>

Le frontend porte une partie importante de l’orchestration dans `App.tsx`, tandis que les contrats TypeScript sont très centralisés dans `types.ts`. <citation src="3"></citation><citation src="5"></citation>

L’initialisation de la base regroupe également plusieurs responsabilités, notamment les collections, index, seeders, backfills et migrations. <citation src="7"></citation>

Le plan doit donc traiter simultanément :

```text
contrats de domaine
persistance
API
événements temps réel
stores frontend
hydratation
tests
installation
documentation
```

## 4. Architecture cible

```text
backend/src/
├── domain/
│   ├── workflows/
│   ├── workflow-nodes/
│   ├── workflow-edges/
│   ├── agent-prototypes/
│   ├── agent-instances/
│   ├── journals/
│   ├── runs/
│   └── artifacts/
│
├── application/
│   ├── workflows/
│   ├── nodes/
│   ├── edges/
│   ├── agent-instances/
│   ├── runs/
│   └── migration/
│
├── infrastructure/
│   ├── mongo/
│   ├── repositories/
│   ├── llm/
│   ├── sandbox/
│   ├── storage/
│   └── realtime/
│
├── interfaces/
│   ├── http/
│   │   ├── controllers/
│   │   ├── routes/
│   │   └── schemas/
│   └── websocket/
│
└── shared/
    ├── errors/
    ├── ids/
    ├── result/
    ├── logging/
    └── observability/
```

Frontend cible :

```text
src/
├── domains/
│   ├── workflows/
│   ├── workflow-nodes/
│   ├── workflow-edges/
│   ├── agent-instances/
│   ├── runs/
│   └── media/
│
├── application/
│   ├── workspace/
│   ├── workflow-commands/
│   └── runtime-commands/
│
├── infrastructure/
│   ├── api/
│   ├── websocket/
│   └── persistence/
│
├── stores/
├── components/
├── hooks/
└── types/
```

Cette structure ne doit pas être introduite entièrement en une seule fois. Elle sert de cible pour déplacer progressivement les responsabilités.

# 5. Plan de migration par phases

## Phase 0 — Gel architectural

### Objectif

Empêcher l’augmentation de la dette V1 pendant la préparation de la migration.

### Actions

1. Ajouter une règle dans la documentation du projet :

```text
Aucune nouvelle feature ne peut dépendre de Workflow.nodes ou Workflow.edges.
```

2. Identifier les routes V1 et V2.
3. Ajouter une annotation explicite dans le code :

```ts
/**
 * @deprecated Use the canonical V2 workflow API.
 */
```

4. Ajouter des logs sur chaque appel V1.
5. Ajouter une métrique par endpoint legacy.
6. Interdire les nouveaux imports des modèles V1 dans les fichiers métier.
7. Ajouter une règle de revue dans les instructions Copilot.

### Fichiers concernés

```text
Guides/Features/feature/v1-v2-drift-analysis.md
backend/src/routes/workflows.routes.ts
backend/src/services/databaseInit.ts
backend/src/models/*
backend/src/migrations/*
.github/CONTRIBUTING.md
```

### Critères de sortie

- toutes les routes V1 sont listées ;
- aucune nouvelle fonctionnalité ne dépend de V1 ;
- les appels legacy sont observables ;
- le périmètre de migration est connu.

---

## Phase 1 — Inventaire automatisé

### Objectif

Obtenir la liste exacte de tous les accès V1/V2.

### Recherche obligatoire

```text
Workflow.nodes
Workflow.edges
nodes:
edges:
$push
$pull
agentInstances
workflowNodes
workflowEdges
canvasState
saveWorkflow
hydrateWorkspace
persistWorkflow
```

### Classification

Chaque occurrence doit être classée comme :

```text
V1_READ
V1_WRITE
V2_READ
V2_WRITE
COMPATIBILITY
MIGRATION
TEST_ONLY
UNKNOWN
```

### Format de l’inventaire

Créer :

```text
Guides/Features/feature/v1-v2-code-inventory.md
```

avec un tableau :

| Fichier | Ligne | Fonction | Opération | Modèle | Catégorie | Remplacement |
|---|---:|---|---|---|---|---|
| `...` | `...` | `...` | lecture | V1 | `V1_READ` | repository V2 |
| `...` | `...` | `...` | écriture | V1 | `V1_WRITE` | use case |
| `...` | `...` | `...` | lecture | V2 | `V2_READ` | conserver |
| `...` | `...` | `...` | migration | V1 → V2 | `MIGRATION` | script versionné |

### Automatisation recommandée

Ajouter un script :

```text
scripts/audit-workflow-architecture.ts
```

Commandes :

```bash
npm run audit:workflow-architecture
npm run audit:workflow-architecture:strict
```

Le mode strict échoue si un nouveau fichier introduit une référence V1.

### Critères de sortie

- 100 % des références identifiées ;
- aucun élément `UNKNOWN` ;
- les routes critiques sont reliées à un remplacement cible ;
- le rapport est reproductible en CI.

---

## Phase 2 — Stabilisation des contrats du domaine

### Objectif

Définir les types canoniques avant de déplacer le code.

### Types à créer

```text
backend/src/domain/workflows/workflow.types.ts
backend/src/domain/workflow-nodes/workflow-node.types.ts
backend/src/domain/workflow-edges/workflow-edge.types.ts
backend/src/domain/agent-instances/agent-instance.types.ts
backend/src/domain/runs/run.types.ts
```

### Contrat minimal Workflow

```ts
export interface Workflow {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  status: "draft" | "active" | "archived";
  isDefault: boolean;
  schemaVersion: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Contrat minimal WorkflowNode

```ts
export interface WorkflowNode {
  id: string;
  workflowId: string;
  type: WorkflowNodeType;
  agentInstanceId?: string;
  position: {
    x: number;
    y: number;
  };
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Contrat minimal WorkflowEdge

```ts
export interface WorkflowEdge {
  id: string;
  workflowId: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: WorkflowEdgeType;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Règles

- les identifiants sont opaques ;
- les dates sont stockées et transmises dans un format uniforme ;
- les propriétés legacy ne sont pas ajoutées aux contrats V2 ;
- les DTO HTTP sont distincts des entités métier ;
- les modèles MongoDB sont distincts des entités métier ;
- les types frontend ne doivent pas devenir les contrats backend.

### Critères de sortie

- les contrats canoniques sont documentés ;
- les propriétés legacy sont explicitement exclues ;
- les invariants sont testés ;
- le domaine ne dépend pas d’Express ou de Mongoose.

---

## Phase 3 — Extraction des repositories

### Objectif

Supprimer les accès directs aux modèles MongoDB depuis les routes.

### Interfaces

```ts
export interface WorkflowRepository {
  findById(id: string): Promise<Workflow | null>;
  findByOwnerId(ownerId: string): Promise<Workflow[]>;
  create(input: CreateWorkflowInput): Promise<Workflow>;
  update(
    id: string,
    expectedRevision: number,
    patch: WorkflowPatch,
  ): Promise<Workflow>;
  archive(id: string, expectedRevision: number): Promise<Workflow>;
}
```

```ts
export interface WorkflowNodeRepository {
  findById(id: string): Promise<WorkflowNode | null>;
  findByWorkflowId(workflowId: string): Promise<WorkflowNode[]>;
  create(input: CreateWorkflowNodeInput): Promise<WorkflowNode>;
  update(
    id: string,
    expectedRevision: number,
    patch: WorkflowNodePatch,
  ): Promise<WorkflowNode>;
  delete(id: string, expectedRevision: number): Promise<void>;
}
```

```ts
export interface WorkflowEdgeRepository {
  findByWorkflowId(workflowId: string): Promise<WorkflowEdge[]>;
  create(input: CreateWorkflowEdgeInput): Promise<WorkflowEdge>;
  delete(id: string, expectedRevision: number): Promise<void>;
}
```

### Implantations

```text
backend/src/infrastructure/repositories/mongo-workflow.repository.ts
backend/src/infrastructure/repositories/mongo-workflow-node.repository.ts
backend/src/infrastructure/repositories/mongo-workflow-edge.repository.ts
```

### Règle

Aucun contrôleur ne doit appeler directement :

```ts
Model.find()
Model.findOneAndUpdate()
Model.deleteOne()
```

### Critères de sortie

- les routes utilisent des repositories ;
- les tests des routes utilisent des mocks de repositories ;
- les détails Mongoose sont confinés à l’infrastructure ;
- les opérations de version sont centralisées.

---

## Phase 4 — Extraction des use cases backend

### Objectif

Déplacer la logique métier hors de `workflows.routes.ts`.

Le fichier actuel regroupe plusieurs générations d’API et plusieurs responsabilités. <citation src="8"></citation>

### Use cases à créer

```text
application/workflows/create-workflow.use-case.ts
application/workflows/get-workflow.use-case.ts
application/workflows/update-workflow.use-case.ts
application/workflows/archive-workflow.use-case.ts
application/workflows/delete-workflow.use-case.ts

application/workflow-nodes/create-node.use-case.ts
application/workflow-nodes/update-node.use-case.ts
application/workflow-nodes/delete-node.use-case.ts

application/workflow-edges/create-edge.use-case.ts
application/workflow-edges/delete-edge.use-case.ts

application/agent-instances/create-agent-instance.use-case.ts
application/agent-instances/update-agent-instance.use-case.ts
application/agent-instances/delete-agent-instance.use-case.ts
```

### Chaque use case doit gérer

- validation métier ;
- ownership ;
- statut du workflow ;
- vérification des références ;
- révision attendue ;
- idempotence ;
- persistance ;
- événement métier ;
- réponse métier.

### Exemple de commande

```ts
type UpdateWorkflowNodeCommand = {
  nodeId: string;
  actorId: string;
  expectedRevision: number;
  idempotencyKey?: string;
  patch: {
    position?: {
      x: number;
      y: number;
    };
    dimensions?: {
      width?: number;
      height?: number;
    };
  };
};
```

### Critères de sortie

- les routes ne contiennent plus de règles métier importantes ;
- les use cases sont testables sans serveur HTTP ;
- les erreurs métier sont indépendantes d’Express ;
- les tests unitaires couvrent les règles principales.

---

## Phase 5 — Migration de la persistance

### Objectif

Migrer les workflows V1 vers la structure V2.

### Composants à créer

```text
backend/src/application/migration/migrate-workflow-v1-to-v2.use-case.ts
backend/src/infrastructure/migrations/versions/
backend/src/infrastructure/migrations/migration-runner.ts
backend/src/infrastructure/migrations/migration-lock.ts
```

### Tables ou collections de suivi

```text
schema_migrations
workflow_migrations
```

### `schema_migrations`

```ts
type SchemaMigration = {
  version: string;
  name: string;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  error?: string;
};
```

### `workflow_migrations`

```ts
type WorkflowMigration = {
  workflowId: string;
  sourceVersion: "v1";
  targetVersion: "v2";
  status: "pending" | "running" | "completed" | "failed";
  sourceChecksum: string;
  targetChecksum?: string;
  attempts: number;
  migratedAt?: Date;
  error?: string;
};
```

### Algorithme de migration

```text
1. Acquérir le verrou de migration.
2. Sélectionner un workflow V1 non migré.
3. Vérifier qu’il appartient à la source attendue.
4. Calculer le checksum source.
5. Créer ou mettre à jour le workflow V2.
6. Transformer les nœuds.
7. Transformer les edges.
8. Créer ou rattacher les instances.
9. Vérifier les références.
10. Calculer le checksum cible.
11. Valider les invariants.
12. Marquer la migration comme completed.
13. Passer au workflow suivant.
```

### Rejouabilité

Une migration relancée ne doit pas :

- créer de doublons ;
- modifier les identifiants déjà migrés ;
- perdre les nœuds ;
- recréer les edges ;
- réinitialiser les journaux ;
- écraser une modification V2 plus récente.

### Critères de sortie

- migration exécutable plusieurs fois ;
- migration interrompue reprenable ;
- rapport d’erreurs disponible ;
- checksum source/cible vérifiable ;
- aucun workflow partiellement marqué comme terminé.

---

## Phase 6 — Déplacement des routes API

### Objectif

Faire de l’API V2 l’API opérationnelle.

### Routes cibles

```text
/api/v2/workflows
/api/v2/workflows/:workflowId
/api/v2/workflows/:workflowId/nodes
/api/v2/workflows/:workflowId/edges
/api/v2/agent-instances
/api/v2/runs
```

### Organisation recommandée

```text
interfaces/http/
├── controllers/
│   ├── workflows.controller.ts
│   ├── workflow-nodes.controller.ts
│   ├── workflow-edges.controller.ts
│   └── runs.controller.ts
├── routes/
│   ├── workflows.routes.ts
│   ├── workflow-nodes.routes.ts
│   ├── workflow-edges.routes.ts
│   └── runs.routes.ts
└── schemas/
    ├── workflow.schemas.ts
    ├── workflow-node.schemas.ts
    ├── workflow-edge.schemas.ts
    └── run.schemas.ts
```

### Réponses standardisées

```ts
type ApiSuccess<T> = {
  data: T;
  meta?: {
    revision?: number;
    requestId?: string;
  };
};
```

```ts
type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
};
```

### Dépréciation V1

Pendant la transition :

```text
GET legacy
  → autorisé temporairement

POST/PATCH/DELETE legacy
  → warning ou refus progressif
```

Après migration :

```http
410 Gone
```

### Critères de sortie

- frontend connecté aux endpoints V2 ;
- aucun nouveau flux ne passe par V1 ;
- réponses d’erreurs homogènes ;
- ownership appliqué sur chaque ressource ;
- logs et métriques disponibles.

---

## Phase 7 — Concurrence et idempotence

### Objectif

Éviter les pertes de mise à jour et les duplications lors des appels répétés ou concurrents.

### Révision optimiste

Chaque ressource modifiable possède :

```text
revision
```

Une commande transmet :

```json
{
  "expectedRevision": 4
}
```

Si la révision réelle est différente :

```http
409 Conflict
```

### Idempotence

Les commandes sensibles acceptent :

```text
Idempotency-Key
```

Commandes concernées :

```text
création de workflow
création d’instance
création de run
création d’outil
création d’artefact
retry d’un run
```

### Règles

- la même clé avec le même payload retourne le même résultat ;
- la même clé avec un payload différent est rejetée ;
- une clé expirée ne peut plus être réutilisée ;
- les résultats d’idempotence sont stockés suffisamment longtemps ;
- une opération interrompue peut être reprise.

## Phase 8 — Événements temps réel

### Objectif

Remplacer les snapshots ambigus par des événements métier versionnés.

### Événements

```text
workflow.created
workflow.updated
workflow.archived

workflow.node.created
workflow.node.updated
workflow.node.deleted

workflow.edge.created
workflow.edge.deleted

agent-instance.created
agent-instance.updated
agent-instance.deleted

run.queued
run.started
run.progressed
run.completed
run.failed
run.stopped
```

### Format

```ts
type DomainEvent<T> = {
  id: string;
  type: string;
  version: 1;
  aggregateType: string;
  aggregateId: string;
  workflowId?: string;
  revision: number;
  occurredAt: string;
  correlationId: string;
  payload: T;
};
```

### Règles frontend

Le client doit :

- ignorer un événement déjà traité ;
- détecter une révision manquante ;
- demander une resynchronisation en cas de trou ;
- ne jamais écraser une modification locale plus récente ;
- afficher les conflits ;
- gérer les événements reçus dans le désordre.

## Phase 9 — Refactor frontend

### Objectif

Sortir l’orchestration métier de `App.tsx`.

`App.tsx` contient actuellement une part importante de l’hydratation, de la navigation, de la persistance et de la synchronisation. <citation src="3"></citation>

### Services à extraire

```text
src/application/workspace/hydrate-workspace.ts
src/application/workspace/switch-workflow.ts
src/application/workspace/reset-workspace.ts
src/application/workspace/validate-workspace.ts

src/application/workflows/load-workflow.ts
src/application/workflows/save-workflow.ts
src/application/workflows/patch-workflow.ts

src/application/agent-instances/synchronize-agent-instance.ts
src/application/agent-instances/remove-orphaned-instance.ts

src/infrastructure/realtime/workflow-event-client.ts
```

### Stores cibles

```text
useWorkspaceStore
useWorkflowStore
useWorkflowGraphStore
useAgentInstanceStore
useRunStore
useRealtimeStore
```

### Séparation recommandée

```text
React component
  → command hook
  → application service
  → API client
  → backend use case
```

Un composant React ne doit pas :

- décider de la source V1/V2 ;
- construire une requête Mongo-like ;
- implémenter une cascade de suppression ;
- déterminer si une transition de run est valide ;
- manipuler directement les détails de version.

### Types frontend

Le fichier central `types.ts` devra progressivement être remplacé par des modules par domaine. <citation src="5"></citation>

```text
src/domains/workflows/workflow.types.ts
src/domains/workflow-nodes/workflow-node.types.ts
src/domains/workflow-edges/workflow-edge.types.ts
src/domains/agent-instances/agent-instance.types.ts
src/domains/runs/run.types.ts
```

## Phase 10 — États et transitions des runs

### Objectif

Formaliser les exécutions pour éviter les transitions incohérentes.

Les états actuellement utilisés autour des runs comprennent notamment `queued`, `running`, `completed`, `failed`, `stopped` et `timed_out`. <citation src="6"></citation>

### Machine cible

```text
queued
  ├── running
  ├── stopped
  └── failed

running
  ├── completed
  ├── failed
  ├── cancel_requested
  └── timed_out

cancel_requested
  └── stopped
```

États terminaux :

```text
completed
failed
stopped
timed_out
```

### Transitions interdites

```text
completed → running
failed → completed
stopped → running
timed_out → completed
```

### Commandes

```text
createRun
startRun
requestStop
completeRun
failRun
timeoutRun
retryRun
```

`retryRun` doit toujours créer un nouveau run et conserver la référence vers le run d’origine.

## Phase 11 — Refactor de l’initialisation de base

### Objectif

Séparer les responsabilités actuellement concentrées dans `databaseInit.ts`. <citation src="7"></citation>

### Structure cible

```text
backend/src/infrastructure/mongo/
├── connection.ts
├── indexes.ts
├── validators.ts
├── seed/
│   ├── development-seed.ts
│   └── test-seed.ts
├── migrations/
│   ├── runner.ts
│   └── versions/
└── provisioning/
    ├── tools-provisioning.ts
    └── default-data-provisioning.ts
```

### Règles

Le démarrage de l’application ne doit plus :

- exécuter silencieusement une migration lourde ;
- créer des données métier sans signal explicite ;
- mélanger seed de développement et migration de production ;
- lancer une migration partielle sans verrou ;
- considérer une base initialisée si les migrations ne sont pas terminées.

### Commandes recommandées

```bash
npm run db:migrate
npm run db:migrate:status
npm run db:migrate:rollback
npm run db:seed:dev
npm run db:seed:test
npm run db:validate
```

## Phase 12 — Tests

### Tests unitaires domaine

```text
workflow.state-machine.test.ts
workflow.policy.test.ts
workflow-node.policy.test.ts
workflow-edge.policy.test.ts
run.state-machine.test.ts
idempotency.test.ts
```

### Tests repositories

```text
mongo-workflow.repository.test.ts
mongo-workflow-node.repository.test.ts
mongo-workflow-edge.repository.test.ts
```

### Tests API

```text
workflows.v2.routes.test.ts
workflow-nodes.v2.routes.test.ts
workflow-edges.v2.routes.test.ts
runs.v2.routes.test.ts
```

### Tests migration

```text
workflow-v1-to-v2.migration.test.ts
workflow-migration.resume.test.ts
workflow-migration.idempotency.test.ts
workflow-migration.integrity.test.ts
```

### Tests frontend

```text
workflow-hydration.test.ts
workflow-switching.test.ts
workflow-revision-conflict.test.ts
realtime-event-ordering.test.ts
orphan-agent-instance-cleanup.test.ts
```

### Tests E2E

```text
create-workflow.spec.ts
edit-workflow-canvas.spec.ts
reload-workflow.spec.ts
migrate-legacy-workflow.spec.ts
run-agent-workflow.spec.ts
stop-and-retry-run.spec.ts
workflow-permissions.spec.ts
```

## 13. CI/CD

La CI devra exécuter les étapes suivantes :

```text
1. installation avec Node 25
2. lint
3. typecheck frontend
4. typecheck backend
5. audit des références V1
6. tests unitaires
7. tests repositories
8. tests API
9. tests migration
10. build frontend
11. build backend
12. tests E2E
13. validation Docker sandbox
```

Les validations Node 25 et runtime sandbox existantes devront être conservées et intégrées au plan de migration. <citation src="1"></citation><citation src="2"></citation>

### Échec obligatoire de CI

La CI doit échouer si :

- une nouvelle référence V1 est introduite ;
- un test de migration échoue ;
- un type canonique est contourné ;
- une route modifie directement MongoDB hors repository ;
- un événement temps réel n’a pas de version ;
- un run effectue une transition interdite ;
- une migration est non rejouable.

## 14. Stratégie de déploiement

### Étape A — Compatibilité passive

```text
lectures V1 : oui
écritures V1 : oui avec warning
lectures V2 : oui
écritures V2 : oui
```

### Étape B — V2 prioritaire

```text
lectures V1 : fallback seulement
écritures V1 : refusées pour les nouveaux clients
lectures V2 : standard
écritures V2 : standard
```

### Étape C — V2 exclusive

```text
lectures V1 : supprimées
écritures V1 : supprimées
lectures V2 : standard
écritures V2 : standard
```

### Feature flags

```text
WORKFLOW_V2_READS
WORKFLOW_V2_WRITES
WORKFLOW_V1_FALLBACK
WORKFLOW_V1_WRITE_COMPATIBILITY
WORKFLOW_V2_REALTIME_EVENTS
```

Chaque flag doit être temporaire, documenté et associé à une date de suppression.

## 15. Observabilité

Ajouter les champs suivants aux logs :

```text
requestId
correlationId
userId
workflowId
nodeId
edgeId
agentInstanceId
runId
apiVersion
schemaVersion
revision
migrationVersion
```

### Métriques

```text
workflow_v1_reads_total
workflow_v1_writes_total
workflow_v2_reads_total
workflow_v2_writes_total
workflow_migration_completed_total
workflow_migration_failed_total
workflow_revision_conflicts_total
workflow_orphan_nodes_total
workflow_orphan_edges_total
run_invalid_transitions_total
idempotency_replays_total
```

### Alertes

Créer une alerte si :

- des écritures V1 surviennent après la phase de gel ;
- le nombre d’objets orphelins augmente ;
- les migrations échouent ;
- les conflits de révision dépassent un seuil ;
- les événements temps réel sont rejetés ;
- les runs restent bloqués en `running`.

## 16. Ordre d’implémentation optimal

L’ordre suivant minimise les risques :

```text
1. Documentation et gel V1
2. Inventaire automatique
3. Contrats domaine
4. Tests des invariants
5. Repositories V2
6. Use cases workflows
7. Use cases nodes et edges
8. Use cases agent instances
9. API V2
10. Migration de données
11. Événements temps réel
12. Refactor frontend
13. Machine d’état des runs
14. Refactor databaseInit
15. Désactivation progressive V1
16. Tests E2E complets
17. Suppression finale V1
```

Il ne faut pas commencer par le frontend. Le frontend dépendra des contrats API et des événements stabilisés.

## 17. Répartition entre les agents

| Agent | Responsabilité dans ce plan |
|---|---|
| Architecte BDD | contrats, collections, index, migrations, invariants |
| Sécurité | ownership, secrets, sandbox, API legacy, threat model |
| Backend | repositories, use cases, routes V2, erreurs, transitions |
| CI/CD & installation | scripts, Node 25, MongoDB, migrations, Docker, environnements |
| Testeur domaine | invariants, machines d’état, migrations, idempotence |
| Frontend | stores, hydratation V2, API client, canvas, événements |
| Designer UX | conflits, états de migration, erreurs, runs et reprise |
| Testeur E2E | parcours complets, compatibilité, non-régression et déploiement |

## 18. Découpage en lots fonctionnels

### Lot 1 — Fondations

```text
documentation
inventaire
types domaine
erreurs
révisions
idempotence
```

### Lot 2 — Workflow V2

```text
repositories
use cases
routes workflows
routes nodes
routes edges
tests API
```

### Lot 3 — Migration

```text
migration runner
workflow migration
checksums
rapports
reprise
tests de migration
```

### Lot 4 — Frontend

```text
API client V2
stores dédiés
hydratation
canvas
gestion des conflits
événements temps réel
```

### Lot 5 — Runs

```text
state machine
commands
retry
stop
timeout
artifacts
observabilité
```

### Lot 6 — Nettoyage

```text
suppression routes V1
suppression champs V1
suppression types legacy
réduction App.tsx
réduction workflows.routes.ts
réduction databaseInit.ts
```

## 19. Critères globaux de réussite

La migration sera terminée lorsque :

- V2 est la seule source de vérité ;
- aucun nouveau code ne référence le modèle V1 ;
- tous les workflows existants sont migrés ;
- les migrations sont rejouables ;
- les migrations sont observables ;
- les routes V2 sont couvertes ;
- les transitions de runs sont validées ;
- les conflits sont explicites ;
- les commandes mutantes sont idempotentes ;
- les événements temps réel sont versionnés ;
- le frontend ne dépend plus de la structure MongoDB ;
- `App.tsx` ne contient plus les use cases métier ;
- `workflows.routes.ts` ne contient plus la logique métier ;
- `databaseInit.ts` ne mélange plus migrations, seed et provisioning ;
- les tests unitaires, API et E2E passent ;
- les routes V1 peuvent être supprimées sans perte de données.

## 20. Livrables documentaires à créer

```text
Guides/Features/feature/v1-v2-drift-analysis.md
Guides/Features/feature/architecture-v1-v2-migration-plan.md
Guides/Features/feature/v1-v2-code-inventory.md

Guides/Architecture/adr/001-canonical-workflow-v2.md
Guides/Architecture/adr/002-workflow-migration-strategy.md
Guides/Architecture/adr/003-optimistic-concurrency.md
Guides/Architecture/adr/004-realtime-event-contract.md
Guides/Architecture/adr/005-run-state-machine.md
```

Si le dossier `Guides/Features/feature` est effectivement le dossier de référence utilisé par l’équipe, les documents peuvent y rester. Il faudra simplement éviter d’avoir plusieurs copies concurrentes du même plan entre `Guides/Features`, `docs/architecture` et la racine du projet.

Le prochain livrable logique est maintenant la création des huit fichiers `.md` dans :

```text
.github/agents/
```

Chaque profil pourra référencer directement :

```text
Guides/Features/feature/v1-v2-drift-analysis.md
Guides/Features/feature/architecture-v1-v2-migration-plan.md
Guides/Features/feature/v1-v2-code-inventory.md
```

et imposer l’ordre de dépendance entre agents.