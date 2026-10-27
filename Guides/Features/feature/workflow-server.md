Parfait. Avec ces sept profils, le découpage devient clair. Je propose de les utiliser dans un ordre strict, avec quelques interventions en parallèle uniquement lorsque les contrats sont stabilisés.

Les identifiants ci-dessous correspondent aux responsabilités des agents. Dans les user stories, chaque agent devra naturellement utiliser le fichier réel de `.github/agents` qui correspond à son profil.

# Plan global validé

## Objectif du chantier

Transformer l’application actuelle en moteur de workflows persistants capable de :

- publier une version immuable d’un workflow ;
- l’activer côté serveur ;
- déclencher des runs sans navigateur ouvert ;
- créer et persister des tâches ;
- exécuter ces tâches par des workers ;
- relier des nodes de types différents ;
- gérer agents, tools, schedulers, bases de données et fonctions ;
- reprendre après redémarrage ou panne ;
- afficher l’exécution en temps réel lorsque le navigateur est connecté ;
- conserver l’historique complet des runs et artefacts.

## Architecture cible

```text
Frontend React
  ├── édition du workflow
  ├── activation/désactivation
  ├── lancement manuel
  ├── observation des runs
  └── commandes utilisateur

API Backend
  ├── workflow/version
  ├── activation
  ├── runs/tasks
  ├── commandes d'exécution
  └── événements temps réel

Orchestrateur
  ├── interprétation de l'IR
  ├── dépendances entre nodes
  ├── transitions d'état
  ├── retries/timeouts
  └── approbations

Scheduler
  ├── cron
  ├── déclencheurs
  ├── webhooks
  └── création idempotente des runs

Queue
  └── distribution des tâches prêtes

Workers
  ├── exécution native
  ├── sandbox
  ├── tools
  └── collecte des résultats

MongoDB
  ├── workflows/version
  ├── runs
  ├── tâches
  ├── événements
  └── artefacts/références

Redis
  ├── queue
  ├── jobs différés
  ├── locks techniques
  └── état temporaire de distribution
```

MongoDB reste la source de vérité métier. Redis et la queue ne doivent jamais être la seule conservation de l’état d’un run.

## Ordre d’intervention

| Étape | Agent | Objectif principal | Dépendance |
|---|---|---|---|
| 1 | Architecte BDD | Contrats, modèle de données, IR, états et migrations | Aucune |
| 2 | Sécurité | Threat model et règles de permissions | Étape 1 partiellement |
| 3 | Backend | API, orchestration, runs, tâches et transitions | Étape 1 |
| 4 | CI/CD & installation | Redis, workers, environnements et scripts | Contrats backend |
| 5 | Testeur | Tests du domaine et scénarios de panne | Étapes 1 à 4 |
| 6 | Front-end | Canvas, activation, suivi et commandes d’exécution | API stabilisée |
| 7 | Designer UX | Parcours, états visuels et interaction utilisateur | Peut commencer à l’étape 1, finalisation après étape 6 |
| 8 | Testeur | Validation end-to-end et non-régression finale | Tous les agents |

Le Designer UX peut travailler en parallèle sur les parcours et wireframes, mais son implémentation finale doit suivre les contrats définis par le Front-end et le Backend.

---

# Modèle de domaine à implémenter

Les noms suivants constituent les contrats de référence. L’agent Architecte BDD devra les adapter aux conventions déjà présentes dans le dépôt.

## Workflow versionné

```ts
type WorkflowDefinition = {
  workflowId: string;
  workspaceId: string;
  version: number;
  schemaVersion: string;
  status:
    | "draft"
    | "validated"
    | "published"
    | "active"
    | "paused"
    | "disabled";
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  triggers: WorkflowTrigger[];
  policies: ExecutionPolicies;
  inputs: JsonSchema;
  outputs: JsonSchema;
  createdAt: Date;
  publishedAt?: Date;
};
```

## Node

```ts
type WorkflowNode = {
  nodeId: string;
  kind:
    | "agent"
    | "tool"
    | "scheduler"
    | "database"
    | "webhook"
    | "code"
    | "condition";
  implementationRef: string;
  implementationVersion?: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  capabilities: string[];
  executionMode:
    | "native"
    | "worker"
    | "sandbox"
    | "external";
  timeoutMs: number;
  retryPolicy: RetryPolicy;
};
```

## Edge

```ts
type WorkflowEdge = {
  edgeId: string;
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
  kind:
    | "data"
    | "control"
    | "condition"
    | "delegation"
    | "event";
  condition?: unknown;
};
```

## Run

```ts
type WorkflowRun = {
  runId: string;
  workflowId: string;
  workflowVersion: number;
  workspaceId: string;
  status: RunStatus;
  trigger: RunTrigger;
  input: unknown;
  output?: unknown;
  policySnapshot: ExecutionPolicies;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: StructuredError;
};
```

## Task

```ts
type TaskInstance = {
  taskId: string;
  runId: string;
  nodeId: string;
  status: TaskStatus;
  input?: unknown;
  output?: unknown;
  dependencyTaskIds: string[];
  attempt: number;
  maxAttempts: number;
  lease?: {
    workerId: string;
    acquiredAt: Date;
    expiresAt: Date;
  };
  artifacts: ArtifactRef[];
  error?: StructuredError;
};
```

## États obligatoires

```text
Run:
created
queued
running
waiting
waiting_for_approval
paused
completed
failed
cancel_requested
cancelled
timed_out

Task:
pending
ready
queued
leased
running
waiting
retry_scheduled
completed
failed
cancelled
timed_out
```

---

# User stories chronologiques des agents IDE

## Agent 1 — Architecte BDD

### US-ARCH-01 — Cartographier le domaine actuel

**Objectif :** identifier les modèles déjà présents afin de ne pas créer de doublons incompatibles.

**Travail demandé :**

1. Inspecter les modèles, types, routes, services et migrations existants.
2. Identifier les concepts actuels correspondant à :
   - workflow ;
   - agent ;
   - tâche ;
   - node ;
   - tool ;
   - run ;
   - log ;
   - artefact ;
   - workspace.
3. Produire une table de correspondance entre l’existant et le modèle cible.
4. Identifier les chemins legacy à préserver.
5. Documenter les modèles qui devront être étendus plutôt que remplacés.

**Fichiers à inspecter en priorité :**

```text
backend/src/models/**
backend/src/types/**
backend/src/services/**
backend/src/routes/**
backend/src/migrations/**
frontend/src/**
```

**Livrable :**

```text
docs/architecture/current-domain-map.md
docs/architecture/domain-migration-map.md
```

**Critères d’acceptation :**

- aucun nouveau modèle n’est introduit sans justification ;
- tous les modèles actuels liés à l’exécution sont identifiés ;
- les incompatibilités avec le futur `Run`/`TaskInstance` sont listées ;
- les chemins legacy à maintenir sont documentés.

---

### US-ARCH-02 — Définir l’IR versionné du workflow

**Objectif :** permettre au moteur d’exécuter un workflow indépendant du canvas.

**Travail demandé :**

1. Définir les types `WorkflowDefinition`, `WorkflowNode`, `WorkflowEdge`, `WorkflowTrigger` et `ExecutionPolicies`.
2. Définir les types de liaisons :
   - `data` ;
   - `control` ;
   - `condition` ;
   - `delegation` ;
   - `event`.
3. Définir les règles de validation :
   - ports existants ;
   - types compatibles ;
   - node cible valide ;
   - absence de cycles interdits ;
   - références d’implémentation valides ;
   - permissions disponibles.
4. Définir `schemaVersion` et `version`.
5. Définir le comportement d’un workflow `draft`, `published` et `active`.

**Fichiers à créer ou adapter :**

```text
backend/src/types/workflow-ir.ts
backend/src/types/workflow-status.ts
backend/src/types/execution-policy.ts
backend/src/validators/workflow-validator.ts
docs/architecture/workflow-ir.md
```

**Tests obligatoires :**

```text
backend/src/validators/__tests__/workflow-validator.test.ts
```

Les tests doivent couvrir :

- IR valide ;
- port inexistant ;
- types incompatibles ;
- cycle interdit ;
- edge conditionnel incomplet ;
- node sans implementation ;
- workflow actif modifié ;
- version incohérente.

---

### US-ARCH-03 — Définir les machines à états

**Objectif :** empêcher les transitions incohérentes et rendre les runs reprenables.

**Fichiers cibles :**

```text
backend/src/domain/run-state-machine.ts
backend/src/domain/task-state-machine.ts
backend/src/domain/__tests__/run-state-machine.test.ts
backend/src/domain/__tests__/task-state-machine.test.ts
```

**Critères d’acceptation :**

- chaque transition valide est explicitement déclarée ;
- chaque transition invalide est rejetée ;
- les transitions sont indépendantes d’Express, MongoDB et React ;
- les tests couvrent les états terminaux ;
- `cancelled` et `completed` ne peuvent pas redevenir `running`.

---

### US-ARCH-04 — Définir les contrats d’exécution

**Objectif :** fournir un contrat commun aux workers et aux sandboxes.

```ts
type ExecutionRequest = {
  runId: string;
  taskId: string;
  workflowId: string;
  workflowVersion: number;
  nodeId: string;
  action: string;
  input: unknown;
  workspaceId: string;
  capabilities: string[];
  timeoutMs: number;
  networkPolicy: NetworkPolicy;
  resourceLimits: ResourceLimits;
};

type ExecutionResult = {
  status: "completed" | "failed" | "timeout" | "cancelled";
  output?: unknown;
  artifacts: ArtifactRef[];
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs: number;
  usage?: ResourceUsage;
  error?: StructuredError;
};
```

**Fichiers cibles :**

```text
backend/src/execution/execution-contract.ts
backend/src/execution/execution-errors.ts
backend/src/execution/__tests__/execution-contract.test.ts
```

**Handoff :**

L’agent Backend, CI/CD et Sécurité ne doivent pas modifier ces contrats sans validation de l’Architecte BDD et mise à jour des tests.

---

## Agent 2 — Sécurité

### US-SEC-01 — Produire le threat model du runtime

**Objectif :** identifier les menaces liées aux runs serveur, workers, agents et sandboxes.

**Menaces à couvrir :**

- exécution de code utilisateur ;
- sortie de workspace par `../` ;
- accès réseau non autorisé ;
- fuite de secrets ;
- injection dans les prompts ;
- tool poisoning ;
- délégation infinie ;
- boucle de workflow ;
- dépassement de coût ;
- double exécution d’un effet externe ;
- accès inter-workspace ;
- worker compromis ;
- artefact malveillant.

**Livrables :**

```text
docs/security/runtime-threat-model.md
docs/security/capability-matrix.md
```

---

### US-SEC-02 — Définir les capacités et permissions

**Objectif :** rattacher les permissions au node et à la tâche, pas à l’agent de manière implicite.

**Capacités initiales :**

```text
workspace.read
workspace.write
artifact.read
artifact.write
network.http
network.browser
database.read
database.write
code.execute
credential.use
workflow.delegate
human.approval.request
```

**Fichiers cibles :**

```text
backend/src/security/capabilities.ts
backend/src/security/permission-resolver.ts
backend/src/security/__tests__/permission-resolver.test.ts
```

**Tests :**

- capacité absente ;
- capacité accordée ;
- workspace différent ;
- credential non autorisé ;
- node demandant une capacité interdite ;
- délégation dépassant la profondeur maximale.

---

### US-SEC-03 — Sécuriser l’activation et les commandes de run

**Objectif :** empêcher qu’un utilisateur ou un agent non autorisé puisse activer, modifier ou contrôler un workflow.

**À vérifier :**

- permission d’activation ;
- permission de lancement ;
- permission d’annulation ;
- permission d’approbation ;
- isolation par workspace ;
- validation du propriétaire du run ;
- impossibilité de modifier une version publiée.

**Tests obligatoires :**

```text
backend/src/security/__tests__/run-permissions.integration.test.ts
```

---

### US-SEC-04 — Sécuriser les sandboxes et artefacts

**Objectif :** appliquer les contraintes de sécurité au runtime d’exécution.

**Exigences :**

- utilisateur non privilégié ;
- filesystem minimal ;
- réseau désactivé par défaut ;
- chemins normalisés ;
- timeout obligatoire ;
- limites de mémoire et CPU ;
- suppression garantie du conteneur ;
- aucune clé secrète dans `stdout`, `stderr` ou les logs.

**Tests obligatoires :**

- traversal de chemin ;
- tentative d’accès au filesystem hôte ;
- accès réseau interdit ;
- sortie contenant une valeur secrète ;
- artefact non déclaré ;
- dépassement de quota.

---

## Agent 3 — Backend

### US-BE-01 — Créer les modèles persistants

**Objectif :** persister les définitions, versions, runs, tâches et événements.

**Fichiers à créer ou adapter, selon l’organisation existante :**

```text
backend/src/models/workflow-definition.model.ts
backend/src/models/workflow-run.model.ts
backend/src/models/task-instance.model.ts
backend/src/models/execution-event.model.ts
backend/src/models/artifact-reference.model.ts
```

**Index obligatoires :**

```text
workspaceId + workflowId
workspaceId + status
runId + sequence
runId + taskId
status + lease.expiresAt
idempotencyKey
```

**Tests :**

- création ;
- lecture par workspace ;
- unicité de version ;
- unicité de clé d’idempotence ;
- index et requêtes principales.

---

### US-BE-02 — Implémenter publication et activation

**Endpoints cibles :**

```text
POST /workflows/:workflowId/validate
POST /workflows/:workflowId/publish
POST /workflows/:workflowId/activate
POST /workflows/:workflowId/deactivate
```

**Règles :**

- un draft ne peut pas être activé ;
- un workflow invalide ne peut pas être publié ;
- une version publiée est immuable ;
- activer une version désactive l’ancienne version active si la politique le prévoit ;
- désactiver empêche les nouveaux runs ;
- les runs existants continuent selon la politique choisie.

**Tests :**

- happy path ;
- workflow invalide ;
- double activation ;
- modification après publication ;
- désactivation avec run actif ;
- accès depuis un autre workspace.

---

### US-BE-03 — Créer un run sans exécution synchrone

**Endpoint :**

```text
POST /workflows/:workflowId/runs
```

**Comportement :**

1. vérifier que la version est active ou explicitement exécutable ;
2. créer le run ;
3. prendre un snapshot des politiques ;
4. créer les premières tâches ;
5. publier le job ;
6. retourner immédiatement `runId`.

**Réponse attendue :**

```json
{
  "runId": "run_123",
  "workflowId": "workflow_123",
  "workflowVersion": 4,
  "status": "queued"
}
```

**Tests :**

- le HTTP ne reste pas bloqué ;
- le navigateur peut être fermé immédiatement ;
- le même `Idempotency-Key` ne crée pas deux runs ;
- le run conserve la version activée au démarrage.

---

### US-BE-04 — Implémenter l’orchestrateur

**Objectif :** générer les tâches prêtes et activer les dépendances.

**Fichiers cibles :**

```text
backend/src/orchestrator/workflow-orchestrator.ts
backend/src/orchestrator/task-planner.ts
backend/src/orchestrator/dependency-resolver.ts
backend/src/orchestrator/condition-evaluator.ts
backend/src/orchestrator/__tests__/*
```

**Scénarios obligatoires :**

- chaîne A → B ;
- tâches parallèles ;
- branche conditionnelle ;
- node en attente ;
- tâche échouée ;
- retry ;
- délégation bornée ;
- run terminé quand toutes les tâches terminales sont résolues.

---

### US-BE-05 — Implémenter la persistance atomique des transitions

**Objectif :** éviter que deux workers fassent progresser simultanément la même tâche.

**Exigences :**

- transition conditionnelle sur l’état attendu ;
- version ou numéro de révision ;
- événement enregistré avec la transition ;
- opération idempotente ;
- détection d’une transition déjà appliquée.

**Tests de concurrence :**

- deux workers réservant la même tâche ;
- deux retries simultanés ;
- annulation pendant `running` ;
- completion après expiration du lease ;
- événement dupliqué.

---

### US-BE-06 — Implémenter API d’observation et commandes

**Endpoints :**

```text
GET  /runs/:runId
GET  /runs/:runId/tasks
GET  /runs/:runId/events
POST /runs/:runId/pause
POST /runs/:runId/resume
POST /runs/:runId/cancel
POST /runs/:runId/signals
POST /runs/:runId/tasks/:taskId/approve
POST /runs/:runId/tasks/:taskId/reject
POST /runs/:runId/tasks/:taskId/retry
```

**Tests :**

- autorisation ;
- transition correcte ;
- commande répétée ;
- commande sur run terminal ;
- événements manqués avec curseur ;
- réponse après reconnexion.

---

## Agent 4 — CI/CD et installation

### US-CI-01 — Ajouter les services d’exécution locaux

**Objectif :** permettre de lancer l’architecture complète en développement.

**Fichiers probables :**

```text
docker-compose.yml
docker-compose.dev.yml
.env.example
scripts/dev/*
backend/Dockerfile
worker/Dockerfile
```

**Services :**

```text
frontend
backend
worker
scheduler
mongodb
redis
```

Si le backend et le worker partagent le même package, le déploiement peut rester dans un seul conteneur au début, mais les processus doivent conserver des responsabilités séparées.

**Critères :**

- installation documentée ;
- démarrage reproductible ;
- healthchecks ;
- logs identifiables ;
- variables d’environnement documentées ;
- aucun secret commité.

---

### US-CI-02 — Créer les scripts worker et scheduler

**Scripts attendus, à adapter aux scripts existants :**

```json
{
  "worker": "tsx src/workers/worker.ts",
  "scheduler": "tsx src/scheduler/scheduler.ts",
  "worker:dev": "...",
  "scheduler:dev": "...",
  "queue:inspect": "...",
  "runtime:health": "..."
}
```

**Tests :**

- démarrage du worker ;
- démarrage du scheduler ;
- arrêt propre ;
- signal SIGTERM ;
- fermeture des connexions MongoDB et Redis ;
- absence de tâche abandonnée pendant un arrêt normal.

---

### US-CI-03 — Préparer les migrations et déploiements

**Objectif :** rendre les évolutions de schéma reproductibles.

**Exigences :**

- migrations versionnées ;
- migration réversible lorsque possible ;
- mode dry-run ;
- logs de migration ;
- vérification de compatibilité ;
- déploiement backend avant activation frontend ;
- stratégie de rollback.

**Pipeline :**

```text
lint
→ typecheck
→ tests unitaires
→ tests backend
→ tests frontend
→ tests intégration
→ build
→ migration check
→ build Docker
→ smoke tests
```

---

### US-CI-04 — Définir les checks de non-régression

**Checks obligatoires :**

- aucun secret dans les logs CI ;
- `npm audit` selon la politique existante ;
- lint ;
- typecheck ;
- tests ;
- build frontend ;
- build backend ;
- démarrage MongoDB/Redis ;
- smoke test création de run ;
- smoke test worker ;
- smoke test artefact.

---

## Agent 5 — Testeur

### US-TEST-01 — Créer la stratégie de test du runtime

**Fichiers :**

```text
docs/testing/runtime-test-strategy.md
docs/testing/failure-matrix.md
```

**Matrice minimale :**

| Domaine | Tests |
|---|---|
| IR | validation, ports, cycles, types |
| États | transitions valides et invalides |
| API | auth, idempotence, erreurs |
| Queue | retry, lease, double livraison |
| Worker | crash, timeout, arrêt |
| Scheduler | cron, concurrence, occurrences manquées |
| Sandbox | quotas, fichiers, réseau |
| Frontend | reconnect, états, commandes |
| E2E | workflow complet sans navigateur |
| Sécurité | permissions, workspace, secrets |

---

### US-TEST-02 — Tester le scénario vertical

**Scénario obligatoire :**

```text
publier
→ activer
→ fermer le navigateur
→ déclencher
→ créer un run
→ consommer une tâche
→ exécuter la sandbox
→ produire un artefact
→ terminer
→ rouvrir l'application
→ consulter le résultat
```

Ce test doit être exécuté avec :

- navigateur ouvert ;
- navigateur fermé ;
- API redémarrée ;
- worker redémarré ;
- tâche en retry ;
- tâche nécessitant une approbation.

---

### US-TEST-03 — Tester les pannes et la concurrence

**Tests fonctionnels obligatoires :**

1. deux workers prennent simultanément la même tâche ;
2. un worker meurt après l’acquisition du lease ;
3. une tâche est livrée deux fois ;
4. Redis redémarre ;
5. MongoDB redémarre ;
6. l’API redémarre pendant un run ;
7. un workflow est désactivé pendant un run ;
8. une nouvelle version est publiée pendant un run existant ;
9. une sandbox dépasse son timeout ;
10. une tâche externe ne doit pas être rejouée sans idempotence.

---

### US-TEST-04 — Ajouter les tests Playwright

**Parcours :**

- publier un workflow ;
- activer un workflow ;
- lancer manuellement un run ;
- suivre les états ;
- fermer puis rouvrir la page ;
- approuver une tâche ;
- annuler un run ;
- télécharger un artefact ;
- consulter un run terminé ;
- vérifier qu’un workflow désactivé ne peut plus être lancé automatiquement.

---

## Agent 6 — Front-end

### US-FE-01 — Afficher le cycle de vie du workflow

**Objectif :** rendre visible la différence entre édition, publication et activation.

**Éléments UI :**

```text
Draft
Validated
Published
Active
Paused
Disabled
```

**Fichiers à inspecter en priorité :**

```text
frontend/src/pages/**
frontend/src/components/**
frontend/src/store/**
frontend/src/hooks/**
frontend/src/api/**
frontend/src/types/**
```

**Critères :**

- une version active est identifiable ;
- un draft modifié n’est pas présenté comme exécutable ;
- l’activation est confirmée ;
- la désactivation est distinguée d’un arrêt de run.

---

### US-FE-02 — Connecter le canvas à l’IR

**Objectif :** ne plus envoyer directement des objets React Flow au moteur.

**Travail demandé :**

1. convertir le canvas vers l’IR ;
2. afficher les erreurs de validation ;
3. afficher les ports invalides ;
4. afficher les liaisons interdites ;
5. préserver les métadonnées visuelles sans les mélanger au contrat runtime.

**Tests :**

- conversion node/edge ;
- erreur de node incomplet ;
- erreur de port ;
- edge conditionnel ;
- workflow ancien ;
- non-régression du déplacement et de la sauvegarde des nodes.

---

### US-FE-03 — Ajouter le lancement et le suivi d’un run

**Comportement :**

- lancement asynchrone ;
- réception immédiate de `runId` ;
- navigation vers la vue du run ;
- affichage des tâches ;
- affichage des artefacts ;
- affichage des erreurs structurées.

Le frontend ne doit jamais considérer Socket.IO comme source de vérité. Après chaque reconnexion, il doit appeler l’API et resynchroniser l’état.

---

### US-FE-04 — Implémenter les commandes utilisateur

**Actions :**

```text
pause
resume
cancel
retry
approve
reject
send signal
```

**Règles UI :**

- les actions disponibles dépendent de l’état serveur ;
- une action est désactivée pendant son traitement ;
- les erreurs API sont affichées ;
- une double soumission ne crée pas deux commandes ;
- l’utilisateur est averti lorsqu’une action est irréversible.

---

### US-FE-05 — Reconnexion et synchronisation

**Objectif :** rendre l’interface indépendante de la continuité de la connexion.

**Scénarios :**

- fermeture de l’onglet ;
- perte réseau ;
- reconnexion ;
- événement manqué ;
- run terminé hors ligne ;
- API redémarrée.

**Tests :**

```text
frontend/src/**/__tests__/*
frontend/e2e/workflow-runtime.spec.ts
```

---

## Agent 7 — Designer UX

### US-UX-01 — Définir les parcours de statut

**Livrables :**

```text
docs/ux/workflow-lifecycle.md
docs/ux/run-lifecycle.md
docs/ux/interaction-rules.md
```

**Parcours à définir :**

- créer ;
- valider ;
- publier ;
- activer ;
- désactiver ;
- déclencher ;
- observer ;
- mettre en pause ;
- reprendre ;
- annuler ;
- approuver ;
- rejeter ;
- rejouer.

---

### US-UX-02 — Concevoir les états visuels des nodes

Chaque node doit pouvoir afficher :

```text
idle
ready
queued
running
waiting
waiting_for_approval
retrying
completed
failed
cancelled
timed_out
```

Il faut distinguer visuellement :

- état du node dans le workflow ;
- état de la tâche dans un run ;
- erreur de configuration ;
- erreur d’exécution ;
- attente d’une entrée humaine ;
- node non exécuté à cause d’une branche.

---

### US-UX-03 — Concevoir les liaisons typées

Les edges doivent être reconnaissables sans dépendre uniquement de la couleur.

Prévoir au minimum :

- variation de style pour `data` ;
- variation de style pour `control` ;
- indication de condition ;
- indication de délégation ;
- indication d’événement ;
- légende accessible ;
- état invalide clairement signalé.

---

### US-UX-04 — Concevoir l’expérience d’un workflow actif

L’utilisateur doit comprendre que :

- le workflow continue sans la page ouverte ;
- le canvas connecté est une vue du serveur ;
- une version active peut générer plusieurs runs ;
- modifier un draft ne modifie pas un run passé ;
- désactiver le workflow ne détruit pas nécessairement les runs existants ;
- un run peut attendre plusieurs heures une approbation.

---

# Contrat de handoff entre agents

Chaque agent doit terminer sa story avec un rapport contenant :

```markdown
## Handoff

### Agent
...

### Stories terminées
...

### Fichiers ajoutés
...

### Fichiers modifiés
...

### Migrations
...

### Tests exécutés
...

### Commandes utilisées
...

### Résultats
...

### Décisions d'architecture
...

### Limites connues
...

### Risques pour l'agent suivant
...
```

Aucun agent ne doit :

- modifier silencieusement un contrat partagé ;
- supprimer un chemin legacy sans migration ;
- ajouter une dépendance sans justification ;
- désactiver un test pour faire passer la CI ;
- faire dépendre le backend du canvas ;
- faire dépendre l’exécution de Socket.IO ;
- stocker un état métier uniquement dans Redis ;
- créer une nouvelle machine à états locale non documentée.

# Définition de terminé du chantier

Le chantier sera considéré comme terminé lorsque les conditions suivantes seront réunies :

- un workflow peut être publié et activé ;
- sa version est immuable ;
- un run est créé côté serveur ;
- le navigateur peut être fermé immédiatement ;
- le scheduler peut créer un run ;
- un worker peut prendre une tâche ;
- un lease expire après disparition du worker ;
- un autre worker peut reprendre la tâche ;
- les transitions sont idempotentes ;
- un artefact est conservé après destruction de la sandbox ;
- un workflow désactivé ne reçoit plus de nouveaux déclenchements ;
- les runs existants gardent leur version d’origine ;
- le frontend se resynchronise après reconnexion ;
- les tests unitaires, intégration, fonctionnels et Playwright passent ;
- les scénarios de crash et de double livraison sont couverts ;
- aucune capacité dangereuse n’est implicite ;
- les migrations et l’installation sont reproductibles.

La première implémentation doit donc rester limitée à une vertical slice : **un déclencheur, un node agent ou code, une tâche worker, une sandbox, un artefact et une reprise après panne**. Une fois ce parcours fiable, les nodes BDD, scheduler, webhooks, MCP et agents collaboratifs pourront être ajoutés sans fragiliser le noyau.