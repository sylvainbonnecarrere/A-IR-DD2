Je vais formaliser la première étape comme un document versionnable dans le dépôt, puis seulement après validation de ce document produire le plan de migration et les profils Copilot.La première étape doit être un document de référence qui transforme la dérive V1/V2 en problème explicite, mesurable et traitable. Je recommande de créer :

```text
Guides\Features\feature\refontev1-v2-drift-analysis.md
```

Voici le contenu prêt à ajouter au dépôt.

# Analyse de la dérive entre les architectures V1 et V2

**Statut :** Draft architectural  
**Date :** 30 septembre 2026  
**Périmètre :** workflows, nœuds, edges, instances d’agents, journaux, runs et persistance MongoDB  
**Objectif :** établir une architecture canonique avant toute nouvelle évolution fonctionnelle

## 1. Résumé

Le projet possède actuellement deux représentations concurrentes des workflows.

L’architecture V1 stocke une partie du graphe directement dans le document `Workflow`, notamment au travers de tableaux `nodes` et `edges`.

L’architecture V2 externalise progressivement les éléments du graphe dans des collections dédiées :

```text
workflows
workflow_nodes
workflow_edges
agent_instances
agent_journals
```

Les deux modèles coexistent encore dans le backend, notamment dans les routes workflows. Les routes V2 utilisent des entités séparées comme `WorkflowNodeV2` et `WorkflowEdge`, tandis que certains endpoints historiques continuent de manipuler les tableaux embarqués de `Workflow`. Les endpoints legacy sont déjà identifiés comme dépréciés dans le code, mais ils restent présents dans l’application. <citation src="8"></citation>

Cette coexistence entraîne un risque de divergence entre :

- l’état affiché dans le canvas ;
- l’état stocké dans `Workflow` ;
- les collections V2 ;
- les instances d’agents ;
- les journaux ;
- les événements temps réel ;
- les données restaurées au changement de workflow.

La priorité est donc de définir une seule architecture canonique, puis d’organiser la migration contrôlée des anciens chemins.

## 2. Décision architecturale proposée

L’architecture V2 devient le modèle canonique.

L’ancien modèle V1 ne doit plus être utilisé pour les nouvelles fonctionnalités. Il est conservé temporairement uniquement pour :

- lecture de données historiques ;
- migration ;
- compatibilité temporaire ;
- export ou restauration d’anciens workflows ;
- rollback contrôlé pendant la période de transition.

La cible est la suivante :

```text
Workflow
  └── métadonnées et état global

WorkflowNode
  └── nœud visuel persistant

WorkflowEdge
  └── relation entre deux nœuds

AgentPrototype
  └── définition réutilisable d’un agent

AgentInstance
  └── instance d’un prototype dans un workflow

AgentJournal
  └── messages, événements et historique d’une instance

Run
  └── exécution d’un outil, d’une tâche ou d’un workflow

Artifact
  └── fichier ou résultat produit par un run
```

Un document `Workflow` canonique ne doit plus contenir de vérité métier concurrente dans des champs `nodes` ou `edges`.

## 3. État actuel observé

### 3.1 Frontend

Le frontend possède plusieurs responsabilités liées aux workflows :

- hydratation du workspace ;
- restauration des workflows ;
- changement de workflow courant ;
- synchronisation des instances ;
- persistance automatique ;
- validation de cohérence ;
- nettoyage d’instances orphelines ;
- navigation entre les vues runtime et canvas.

Ces responsabilités sont actuellement fortement centralisées dans `App.tsx`, qui joue le rôle d’orchestrateur général de l’application. Le fichier contient notamment les flux d’hydratation, de persistance et de changement de workflow. <citation src="3"></citation>

Les types frontend sont également fortement regroupés dans `types.ts`. Ils représentent simultanément :

- les anciennes structures de workflow ;
- les structures V2 ;
- les agents ;
- les instances ;
- les tâches ;
- les journaux ;
- les runs ;
- les erreurs ;
- les outils ;
- les paramètres de runtime. <citation src="5"></citation>

### 3.2 Backend

Le backend expose des routes workflow qui mélangent :

- des routes historiques fondées sur `Workflow.nodes[]` et `Workflow.edges[]` ;
- des routes V2 fondées sur des collections distinctes ;
- des opérations de création et de suppression d’instances ;
- des patches partiels ;
- des mécanismes de version optimiste ;
- des opérations de journalisation ;
- des comportements de compatibilité.

Le fichier `workflows.routes.ts` concentre donc plusieurs générations de contrat API et plusieurs niveaux de responsabilité. <citation src="8"></citation>

### 3.3 Persistance

L’initialisation de la base regroupe actuellement :

- la création des collections ;
- les validateurs MongoDB ;
- les index ;
- les seeders ;
- les backfills ;
- certaines migrations ;
- le provisioning d’outils ;
- la préparation de collections liées aux workspaces et aux runs.

Cette concentration rend difficile la distinction entre :

```text
initialisation technique
migration de schéma
migration de données
seed de développement
provisioning fonctionnel
```

Le fichier `databaseInit.ts` doit donc être traité comme une zone critique de l’architecture. <citation src="7"></citation>

## 4. Modèle V1

La structure V1 représente le workflow comme un document contenant directement une partie de son graphe :

```text
Workflow
  ├── id
  ├── name
  ├── description
  ├── userId
  ├── isActive
  ├── isDefault
  ├── nodes[]
  ├── edges[]
  ├── canvasState
  ├── version
  └── timestamps
```

### 4.1 Avantages historiques

Le modèle V1 a probablement été introduit pour sa simplicité :

- un seul document à charger ;
- restauration directe du canvas ;
- sauvegarde relativement simple ;
- peu de requêtes ;
- modèle adapté à un prototype ou à un petit graphe.

### 4.2 Limites structurelles

Le modèle V1 devient problématique lorsque le workflow contient :

- beaucoup de nœuds ;
- de nombreuses instances ;
- des journaux volumineux ;
- des exécutions concurrentes ;
- des modifications partielles ;
- des mises à jour temps réel ;
- des opérations de collaboration ;
- des suppressions en cascade ;
- des versions de configuration.

Les principales limites sont :

1. **Document trop chargé**

   Le workflow devient le conteneur du graphe, de la configuration et parfois de données d’exécution.

2. **Patches difficiles**

   Une modification d’un seul nœud peut entraîner la réécriture d’une partie importante du document.

3. **Concurrence limitée**

   Deux utilisateurs ou deux événements peuvent modifier le même document et provoquer des conflits difficiles à résoudre.

4. **Indexation moins fine**

   Il est plus difficile d’indexer ou de rechercher un nœud isolé, une instance ou une relation.

5. **Suppression complexe**

   Supprimer un agent implique de modifier plusieurs tableaux embarqués et de nettoyer les références associées.

6. **Couplage entre stockage et affichage**

   La structure persistée tend à reproduire directement la structure du canvas.

## 5. Modèle V2

Le modèle V2 sépare les responsabilités :

```text
workflows
  └── métadonnées du workflow

workflow_nodes
  └── positions, types et références des nœuds

workflow_edges
  └── relations entre les nœuds

agent_instances
  └── configuration opérationnelle des agents

agent_journals
  └── historique des échanges et événements

runs
  └── exécutions

artifacts
  └── résultats persistés
```

### 5.1 Avantages

Le modèle V2 permet :

- des mises à jour partielles ;
- une meilleure indexation ;
- des contrôles d’ownership plus précis ;
- une meilleure gestion des suppressions ;
- une séparation entre graphe et exécution ;
- une évolution indépendante des nœuds et des workflows ;
- une meilleure traçabilité ;
- une intégration plus propre avec les runs ;
- des contrats API plus spécialisés.

Les routes V2 disposent déjà d’un mécanisme de patch partiel avec version attendue et conflit `409`, ce qui constitue une base adaptée à la concurrence optimiste. <citation src="8"></citation>

### 5.2 Risques du modèle V2 actuel

Le modèle V2 n’est pas encore totalement canonique parce que :

- les anciens tableaux V1 subsistent ;
- certains types frontend représentent encore plusieurs formes de données ;
- certaines routes utilisent encore les opérations MongoDB sur les champs historiques ;
- les migrations ne semblent pas encore avoir supprimé définitivement les anciennes structures ;
- l’hydratation frontend doit potentiellement reconstruire des données depuis plusieurs sources ;
- les opérations multi-collections ne disposent pas toujours d’une garantie transactionnelle globale.

## 6. Matrice de divergence

| Sujet | V1 | V2 | Risque |
|---|---|---|---|
| Nœuds | `Workflow.nodes[]` | `workflow_nodes` | Deux états possibles |
| Edges | `Workflow.edges[]` | `workflow_edges` | Relations divergentes |
| Instance d’agent | Partiellement embarquée | Collection `agent_instances` | Configuration incohérente |
| Journal | Mélangé aux données runtime ou agent | `agent_journals` | Historique incomplet |
| Version | Version du workflow | Version par ressource ou patch | Conflits mal définis |
| Suppression | `$pull` dans un document | Suppression de plusieurs documents | Cascade non homogène |
| Hydratation | Lecture d’un document global | Agrégation de plusieurs collections | Restauration différente |
| Temps réel | État global à diffuser | Événements ciblés | Événements incompatibles |
| Tests | Scénarios basés sur le document V1 | Scénarios basés sur les collections V2 | Couverture contradictoire |
| Migrations | Backfills ponctuels | Modèle cible permanent | Migration incomplète |

## 7. Sources potentielles de divergence

### 7.1 Écriture via des endpoints différents

Un workflow peut être modifié par :

```text
PUT /api/workflows/:id
PATCH /api/workflows/:id
POST /api/workflows/:id/nodes
PATCH /api/workflows/:id/nodes/:nodeId
DELETE /api/workflows/:id/nodes/:nodeId
POST /api/workflows/:id/edges
DELETE /api/workflows/:id/edges/:edgeId
```

Si certains endpoints écrivent dans les tableaux V1 et d’autres dans les collections V2, le système ne possède pas de source de vérité unique.

### 7.2 Hydratation du frontend

Le frontend peut reconstruire son état à partir :

- d’un snapshot V1 ;
- de collections V2 ;
- du cache local ;
- des stores Zustand ;
- de réponses API partielles ;
- d’événements Socket.IO.

Une hydratation qui mélange plusieurs sources doit être interdite ou explicitement documentée.

### 7.3 Suppression partielle

Une suppression V2 peut réussir pour le nœud mais échouer pour :

- l’instance d’agent ;
- le journal ;
- les tâches ;
- les connexions ;
- les références frontend ;
- les événements temps réel.

Le système doit posséder une stratégie explicite de cascade.

### 7.4 Migrations au démarrage

L’initialisation de base effectue des opérations de seed, indexation et backfill. Cela peut laisser un déploiement dans un état intermédiaire si une opération échoue au milieu du processus. <citation src="7"></citation>

## 8. Contrat canonique cible

### 8.1 Workflow

```ts
type Workflow = {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  status: "draft" | "active" | "archived";
  isDefault: boolean;
  canvasSettings: CanvasSettings;
  schemaVersion: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};
```

Le workflow ne doit pas contenir :

```text
nodes[]
edges[]
agentJournals[]
runs[]
```

Il peut éventuellement contenir une information de snapshot ou de compatibilité, mais celle-ci ne doit pas être utilisée comme source opérationnelle.

### 8.2 WorkflowNode

```ts
type WorkflowNode = {
  id: string;
  workflowId: string;
  type: "agent" | "trigger" | "condition" | "output" | "note";
  agentInstanceId?: string;
  position: {
    x: number;
    y: number;
  };
  dimensions?: {
    width?: number;
    height?: number;
  };
  visualState?: {
    collapsed: boolean;
    selected: boolean;
  };
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};
```

### 8.3 WorkflowEdge

```ts
type WorkflowEdge = {
  id: string;
  workflowId: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: "default" | "conditional" | "data";
  label?: string;
  condition?: unknown;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};
```

### 8.4 AgentInstance

```ts
type AgentInstance = {
  id: string;
  workflowId: string;
  prototypeId: string;
  name: string;
  configuration: AgentConfiguration;
  status: "draft" | "ready" | "disabled";
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};
```

### 8.5 Run

```ts
type Run = {
  id: string;
  workflowId?: string;
  agentInstanceId?: string;
  toolId?: string;
  requestedBy: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "stopped"
    | "timed_out"
    | "cancel_requested";
  idempotencyKey: string;
  startedAt?: Date;
  completedAt?: Date;
  error?: RunError;
  artifacts: ArtifactReference[];
  createdAt: Date;
  updatedAt: Date;
};
```

## 9. Invariants à imposer

Les invariants suivants doivent être vrais après migration.

### Workflow

- chaque workflow appartient à un seul owner ;
- un workflow ne possède plus de graphe opérationnel embarqué ;
- `schemaVersion` identifie le format persistant ;
- `revision` augmente à chaque modification métier ;
- un workflow archivé ne peut plus recevoir de commande mutante normale.

### Nœud

- chaque nœud appartient à un workflow existant ;
- un nœud ne peut être référencé que par un edge du même workflow ;
- un nœud d’agent référence une instance existante ;
- un identifiant de nœud est unique dans son workflow.

### Edge

- `sourceNodeId` et `targetNodeId` existent ;
- les deux nœuds appartiennent au même workflow ;
- une relation interdite est rejetée par le domaine ;
- la suppression d’un nœud traite ses edges associés.

### Instance d’agent

- l’instance référence un prototype existant ou une définition clonée explicitement ;
- elle appartient au même workflow que son nœud ;
- sa configuration est versionnée ;
- les secrets ne sont jamais stockés dans la configuration frontend.

### Run

- aucune transition illégale n’est acceptée ;
- un run ne peut être démarré deux fois ;
- une commande de retry produit un nouvel identifiant de run ;
- un arrêt est idempotent ;
- un run terminé ne peut plus être relancé directement ;
- tout artefact est lié à son run et à son workspace.

## 10. Stratégie de migration recommandée

### Phase 0 — Geler la dérive

Avant toute migration :

- ne plus ajouter de fonctionnalités aux routes V1 ;
- marquer les nouveaux développements comme V2 uniquement ;
- ajouter des logs lorsqu’un endpoint V1 est utilisé ;
- ajouter des métriques par route V1/V2 ;
- interdire les nouveaux accès à `Workflow.nodes` et `Workflow.edges`.

### Phase 1 — Inventorier

Créer un inventaire exhaustif :

```text
route
service
repository
model
store frontend
hook
test
migration
```

Pour chaque occurrence de :

```text
Workflow.nodes
Workflow.edges
nodes[]
edges[]
$push
$pull
agentInstances
workflowNodes
workflowEdges
```

indiquer :

```text
fichier
fonction
lecture/écriture
V1/V2
appelant
remplacement cible
statut
```

Le rapport versionne de reference pour ce gel J0 est `Guides/Features/feature/refonte/v1-v2-code-inventory.md`. Il complete cette analyse avec la classification effective des surfaces `App.tsx`, `backend/src/routes/workflows.routes.ts`, `backend/src/routes/agent-instances.routes.ts`, `backend/src/routes/runs.routes.ts`, `backend/src/services/databaseInit.ts`, `stores/useWorkflowStore.ts` et `services/workspacePersistenceService.ts`.

### Phase 2 — Introduire les repositories canoniques

Créer des interfaces :

```ts
interface WorkflowRepository {}
interface WorkflowNodeRepository {}
interface WorkflowEdgeRepository {}
interface AgentInstanceRepository {}
interface RunRepository {}
```

Les contrôleurs ne doivent plus accéder directement aux modèles MongoDB.

### Phase 3 — Migrer les use cases

Migrer progressivement :

1. création de workflow ;
2. lecture de workflow ;
3. ajout de nœud ;
4. déplacement de nœud ;
5. création d’instance ;
6. ajout d’edge ;
7. suppression de nœud ;
8. suppression d’edge ;
9. archivage ;
10. duplication de workflow ;
11. import/export.

### Phase 4 — Dual read temporaire

Une lecture de compatibilité peut être conservée temporairement :

```text
si V2 existe :
    lire V2
sinon :
    lire V1
    convertir en V2 en mémoire
```

La lecture V1 ne doit pas réécrire silencieusement la base sans migration explicite.

### Phase 5 — Migration persistante

Pour chaque workflow :

1. lire la structure V1 ;
2. créer le document `workflows` canonique ;
3. créer les `workflow_nodes` ;
4. créer les `workflow_edges` ;
5. créer ou rattacher les `agent_instances` ;
6. vérifier les références ;
7. calculer un checksum ;
8. marquer la migration comme terminée ;
9. conserver un rapport d’anomalies.

Exemple de suivi :

```ts
type WorkflowMigrationRecord = {
  workflowId: string;
  sourceVersion: "v1";
  targetVersion: "v2";
  status: "pending" | "running" | "completed" | "failed";
  sourceChecksum: string;
  targetChecksum?: string;
  migratedAt?: Date;
  error?: string;
};
```

### Phase 6 — Basculer les lectures

Une fois les données V2 vérifiées :

- toutes les lectures applicatives utilisent V2 ;
- le fallback V1 est limité aux workflows non migrés ;
- les métriques doivent confirmer que l’usage V1 diminue à zéro.

### Phase 7 — Basculer les écritures

Les endpoints V1 deviennent :

```text
lecture seule
```

ou renvoient :

```http
410 Gone
```

avec un code applicatif explicite :

```json
{
  "code": "WORKFLOW_V1_ENDPOINT_DEPRECATED",
  "migration": "USE_WORKFLOW_V2_API"
}
```

### Phase 8 — Supprimer V1

La suppression ne doit intervenir qu’après :

- zéro lecture V1 pendant une période définie ;
- zéro écriture V1 ;
- migration de tous les workflows ;
- validation des exports ;
- validation des tests E2E ;
- sauvegarde vérifiée ;
- plan de rollback documenté.

## 11. Contrats API cibles

Les commandes métier devraient être explicites :

```text
POST   /api/v2/workflows
GET    /api/v2/workflows/:workflowId
PATCH  /api/v2/workflows/:workflowId
DELETE /api/v2/workflows/:workflowId

POST   /api/v2/workflows/:workflowId/nodes
PATCH  /api/v2/workflows/:workflowId/nodes/:nodeId
DELETE /api/v2/workflows/:workflowId/nodes/:nodeId

POST   /api/v2/workflows/:workflowId/edges
PATCH  /api/v2/workflows/:workflowId/edges/:edgeId
DELETE /api/v2/workflows/:workflowId/edges/:edgeId

POST   /api/v2/workflows/:workflowId/agent-instances
PATCH  /api/v2/agent-instances/:instanceId
DELETE /api/v2/agent-instances/:instanceId

POST   /api/v2/runs
GET    /api/v2/runs/:runId
POST   /api/v2/runs/:runId/stop
POST   /api/v2/runs/:runId/retry
```

Chaque commande mutante doit accepter, lorsque nécessaire :

```json
{
  "expectedRevision": 12,
  "idempotencyKey": "uuid"
}
```

Les conflits doivent produire :

```http
409 Conflict
```

avec une réponse structurée :

```json
{
  "code": "REVISION_CONFLICT",
  "resource": "workflow_node",
  "resourceId": "node-id",
  "expectedRevision": 12,
  "actualRevision": 13
}
```

## 12. Événements temps réel cibles

Les événements Socket.IO ne doivent plus transmettre uniquement des snapshots ambigus. Ils doivent porter une intention et une révision :

```ts
type WorkflowRealtimeEvent =
  | {
      type: "workflow.node.created";
      workflowId: string;
      nodeId: string;
      revision: number;
    }
  | {
      type: "workflow.node.updated";
      workflowId: string;
      nodeId: string;
      revision: number;
      changes: Record<string, unknown>;
    }
  | {
      type: "workflow.node.deleted";
      workflowId: string;
      nodeId: string;
      revision: number;
    }
  | {
      type: "workflow.edge.created";
      workflowId: string;
      edgeId: string;
      revision: number;
    }
  | {
      type: "workflow.edge.deleted";
      workflowId: string;
      edgeId: string;
      revision: number;
    };
```

Chaque événement doit être :

- versionné ;
- identifiable ;
- idempotent côté client ;
- lié à un workflow ;
- associé à une révision ;
- traçable par un `requestId` ou `correlationId`.

## 13. Plan de suppression des structures V1

Les champs suivants doivent être considérés comme legacy :

```text
Workflow.nodes
Workflow.edges
Workflow.agentInstances
Workflow.logs
```

La suppression doit se faire en trois temps :

### Étape A — Interdiction d’écriture

Ajouter une règle de développement et une règle de revue :

```text
Aucun nouveau code ne peut écrire dans les champs V1.
```

### Étape B — Interdiction de lecture applicative

Remplacer les lectures V1 par :

- repository V2 ;
- use case ;
- adaptateur de compatibilité temporaire.

### Étape C — Suppression du schéma

Après migration complète :

- retirer les champs des modèles ;
- retirer les validateurs MongoDB V1 ;
- retirer les index V1 ;
- retirer les routes ;
- retirer les types frontend ;
- supprimer les tests legacy ;
- ajouter une migration de nettoyage.

## 14. Tests obligatoires

### Tests de migration

- workflow V1 minimal ;
- workflow V1 avec plusieurs agents ;
- edges invalides ;
- nœuds orphelins ;
- instances manquantes ;
- doublons ;
- champs inconnus ;
- migration rejouée ;
- migration interrompue ;
- rollback ou reprise.

### Tests d’invariants

- edge entre deux workflows refusé ;
- instance appartenant à un autre workflow refusée ;
- suppression d’un nœud avec edges ;
- suppression d’un nœud avec instance ;
- workflow archivé non modifiable ;
- conflit de révision correctement renvoyé ;
- commande répétée sans effet secondaire.

### Tests de compatibilité

- lecture d’un workflow V1 non migré ;
- lecture d’un workflow V2 ;
- refus des écritures V1 après bascule ;
- réponse d’erreur stable ;
- absence de divergence après un patch V2.

### Tests frontend

- hydratation V2 uniquement ;
- changement de workflow ;
- restauration après rechargement ;
- événement temps réel dupliqué ;
- événement reçu dans le désordre ;
- conflit de révision ;
- suppression d’un nœud et de ses dépendances.

## 15. Critères de sortie

La migration V1/V2 sera considérée comme terminée lorsque :

- tous les workflows ont une représentation V2 valide ;
- aucune écriture applicative ne vise `Workflow.nodes` ou `Workflow.edges` ;
- aucune lecture normale ne dépend de V1 ;
- les routes V1 sont supprimées ou limitées à une compatibilité documentée ;
- les repositories V2 sont utilisés par les use cases ;
- les révisions sont contrôlées ;
- les suppressions sont idempotentes ;
- les tests de migration et de non-régression passent ;
- les événements temps réel sont versionnés ;
- les métriques ne montrent plus d’usage V1 ;
- la procédure de rollback est documentée.

## 16. Décision pour la suite

Ce document devient la référence obligatoire des prochains agents.

Avant de modifier le code, chaque agent devra :

1. consulter ce document ;
2. identifier si le fichier ciblé appartient à V1, V2 ou à la couche de compatibilité ;
3. ne jamais ajouter de nouvelle dépendance à l’architecture V1 ;
4. mettre à jour ce document si une décision modifie la stratégie de migration ;
5. ajouter les tests correspondant aux invariants touchés.

## 17. ADR à créer immédiatement

Le document doit être accompagné de trois ADR :

```text
Guides\Features\feature\refonteadr/001-canonical-workflow-v2.md
Guides\Features\feature\refonteadr/002-workflow-migration-strategy.md
Guides\Features\feature\refonteadr/003-optimistic-concurrency-and-idempotency.md
```

### ADR 001

Décision : V2 devient la source de vérité pour workflows, nœuds et edges.

### ADR 002

Décision : migration progressive avec compatibilité temporaire, métriques et suppression différée de V1.

### ADR 003

Décision : les commandes mutantes utilisent une révision optimiste et une clé d’idempotence lorsque l’opération peut être répétée.

## 18. Points à vérifier dans le code avant implémentation

L’inventaire définitif doit encore recenser toutes les occurrences de :

```text
Workflow.nodes
Workflow.edges
nodes:
edges:
$push
$pull
findOneAndUpdate
agentInstances
workflowNodes
workflowEdges
canvasState
saveWorkflow
hydrateWorkspace
persistWorkflow
```

Cet inventaire devra couvrir :

```text
App.tsx
types.ts
stores/
hooks/
services/
backend/src/routes/
backend/src/services/
backend/src/models/
backend/src/migrations/
backend/tests/
frontend tests
Playwright tests
```

Le but est d’obtenir une matrice de migration concrète :

| Fichier | Fonction | Lecture/écriture | Modèle | Statut | Remplacement |
|---|---|---|---|---|---|
| `...` | `...` | lecture | V1 | à migrer | repository V2 |
| `...` | `...` | écriture | V1 | critique | use case V2 |
| `...` | `...` | lecture | V2 | canonique | conserver |
| `...` | `...` | compatibilité | V1/V2 | temporaire | supprimer après migration |

# Découpage des prochaines étapes

## Étape 1 — Document d’architecture

Livrable immédiat :

```text
Guides\Features\feature\refontev1-v2-drift-analysis.md
Guides\Features\feature\refonteadr/001-canonical-workflow-v2.md
Guides\Features\feature\refonteadr/002-workflow-migration-strategy.md
Guides\Features\feature\refonteadr/003-optimistic-concurrency-and-idempotency.md
```

## Étape 2 — Plan global de modification

Le second document sera :

```text
Guides\Features\feature\refontetarget-architecture-migration-plan.md
```

Il détaillera :

- les modifications par dossier ;
- l’ordre exact des migrations ;
- les contrats backend ;
- les changements MongoDB ;
- les modifications frontend ;
- les tests par étape ;
- les risques ;
- les critères de validation ;
- les conditions de rollback.

## Étape 3 — Agents Copilot

Les agents seront ensuite placés dans :

```text
.github/agents/
```

avec les profils suivants :

```text
01-architecte-bdd.md
02-securite.md
03-backend.md
04-ci-cd-installation.md
05-testeur-domaine.md
06-frontend.md
07-designer-ux.md
08-testeur-e2e.md
```

Chaque agent devra lire les documents d’architecture avant toute modification et devra respecter la règle fondamentale :

> aucune nouvelle fonctionnalité ne doit renforcer la dépendance à l’architecture V1.