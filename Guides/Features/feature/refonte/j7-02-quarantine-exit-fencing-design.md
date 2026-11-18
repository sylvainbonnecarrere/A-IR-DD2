# US-J7-02 — Conception : sortie sûre de quarantaine d'un `run` incertain (fencing label/ID + `fence-and-retry`)

**Auteur :** `09-architecte-applicatif`
**Date :** 2026-11-18
**Branche :** `feat/j7-02-quarantine-exit-fencing` (base commitée `e05f977`, baseline verte : root 90 suites/542 tests, backend 114 suites/715 tests, `ci:node25:runtime` 3/20, audit strict OK)
**Référence backlog :** `Guides/Features/feature/refonte/backlog/v1-v2-refonte-backlog.md` §US-J7-02 (ligne 957) — « reste à faire : concevoir et prouver la sortie sûre de quarantaine d'un `run` incertain, valider le déploiement corrigé sur l'hôte cible et achever la validation E2E ».

---

## 1. Contexte et arbitrages retenus (responsable projet, 2026-11-18)

1. **Pas d'opérateur sysadmin au quotidien.** L'opérateur légitime est **l'utilisateur propriétaire du workspace**, via l'interface applicative. Un fallback CLI admin existe uniquement pour la maintenance d'infrastructure.
2. **Niveau gateway (disponibilité globale)** : fencing **automatique** des opérations `unknown` de l'ancienne epoch à l'activation d'une nouvelle epoch. Le démon rouvre l'admission immédiatement et ne bloque jamais les autres workspaces.
3. **Niveau workspace (sécurité métier)** : le run incertain passe en état terminal réconciliable (`worker_lost` / `quarantined`) et le **verrou workspace reste tenu** jusqu'à résolution explicite par `fence-and-retry`.
4. **Visibilité** : erreur persistée dans le journal (`agent_journals` / `UserToolRun`) avec agent/nœud, cause et état du verrou ; remontée UI (carte + panneau de supervision, US-J7-03).
5. **Action manuelle** : bouton « Reset & Relance » pour l'utilisateur authentifié propriétaire.
6. **Auto-recovery optionnelle par agent** : `recoveryPolicy: { autoFenceAndRetry: boolean; maxAttempts: number }`, défaut `false` / `0`. Si activée et sous le seuil, le worker exécute automatiquement fencing + nouveau `executionId`.
7. **Borne de fencing** : `RECONCILE_TIMEOUT_MS = 30 s`, avec retour `504 FENCING_TIMEOUT_ESCALATED` et persistance d'une alerte critique (verrou reste fermé).
8. **Dette WebSocket** (`userId` temporaire côté socket) : US sécurité dédiée (ou rattachée à J7-03), **hors périmètre** de cette conception.
9. Les deux échecs connus (`minimize-restore` semi-E2E, attachement workspace live) sont intégrés au lot de stabilisation avant la campagne J7-04.

## 2. Principes non négociables (rappel)

- MongoDB + `UserToolRun` = source de vérité métier. Le transport gateway/queue n'est jamais l'unique stockage d'une exécution.
- **On n'efface jamais le journal** (`docker_gateway_state`, `dockerJournal` du run, audit de fencing) et **on ne libère jamais un verrou sur simple inspection** : la libération exige une preuve de quiescence par label/ID + réservation de nom.
- Statuts terminaux irréversibles. Retry = nouveau `executionId` lié (`retryOfExecutionId`), parent immutable. Jamais de `resume`.
- Le backend en production n'exécute jamais Docker directement : toute commande passe par le gateway (`DOCKER_GATEWAY_REQUIRED=true`).
- Tests live uniquement sur base Mongo de test explicite, disposable et vérifiée.

## 3. Architecture cible

### 3.1 Label d'opération gateway (injected label)

Tout `docker run` admis par le gateway se voit ajouter **par le serveur** le label `--label airdd2.gateway.op=<operationId>` (injecté après `admit(...)`, exactement comme `ensureRunContainerName` injecte le `--name`). Ainsi, même si la réponse HTTP est perdue (déconnexion client), **tout conteneur créé porte le label de l'opération** et reste retrouvable :

```bash
docker ps -a --filter label=airdd2.gateway.op=<operationId> --format '{{.ID}} {{.Names}} {{.Status}}'
```

Le label est déterministe : `airdd2.gateway.op = operation.id` (UUID v4 déjà journalisé dans Mongo).

### 3.2 État `fenced` et quarantaine isolée côté gateway

`docker_gateway_state` gagne un champ `fencedOperations: FencedOperation[]` :

```ts
interface FencedOperation {
  id: string;            // operationId d'origine
  epoch: number;         // epoch de l'ancien worker
  effect?: DockerGatewayOperationEffect; // { command: 'run'|'kill', containerName, attemptId? }
  fencedAt: Date;
  fenceKind: 'auto_epoch_rotation' | 'user_manual_reset' | 'agent_auto_recovery' | 'admin_maintenance';
  nameReservation: { containerName: string; reserved: boolean } | null;
  quiescenceProven: boolean;
}
```

**À l'activation d'une nouvelle epoch** (`fenceAndActivateWorker` / `activateWorker`) :
1. si `pendingOperation.state === 'unknown'` (ou `in_flight` d'une epoch morte), le déplacer dans `fencedOperations` avec `fenceKind: 'auto_epoch_rotation'` — **sans exiger de preuve de quiescence** (l'ancien worker est mort par définition ; on confine, on ne prétend pas prouver) ;
2. tenter le **fencing par réservation de nom** (best-effort, journalisé) : `docker create --name=<effect.containerName> --label airdd2.fence.op=<operationId> <image-inerte>` (conteneur inerte, `--entrypoint=/bin/true`, réseau none, cap-drop ALL — même profil que `DockerAttemptReservation`) ;
3. rouvrir l'admission (`pendingOperation: null`, `admissionClosed: false`). **Le démon ouvre son socket même avec des opérations fencées.**

Conséquence : une opération `run` incertaine ne bloque plus jamais l'admission globale. La `pendingOperation` unique reste réservée à l'opération courante de l'epoch active (sérialisation stricte côté client déjà en place via `commandQueue`).

### 3.3 Fencing par réservation de nom + opérations par ID/label (jamais par nom)

La garantie recherchée n'est pas « prouver qu'aucune requête n'arrivera plus » (impossible avec l'API Docker seule), mais **rendre la requête différée inoffensive** :

- la réservation inerte occupe le nom → toute création/démarrage différé par **nom** échoue (`Conflict. The container name is already in use`) ;
- toute création **antérieure** au fencing est retrouvée par **label** et tuée par **ID** (`docker kill <ID>`, jamais par nom) ;
- un `start`/`kill` différé par ancien ID sur un conteneur supprimé échoue naturellement ;
- la suppression tardive par nom ne peut détruire que la réservation inerte, qui est re-créable et re-vérifiable par label.

Règle absolue côté gateway après fencing : **les commandes mutantes ne ciblent plus que des ID immuables ou des labels**, jamais un nom nu (le nom sert uniquement à réserver/vérifier la réservation).

### 3.4 Preuve de quiescence : `verifyFenced(operation)`

Nouveau vérifieur (remplace le `false` inconditionnel pour `run`) :

```
verifyFenced(op) === true  ssi, dans la fenêtre RECONCILE_TIMEOUT_MS (30 s) :
  1. aucun conteneur portant le label airdd2.gateway.op=<op.id> n'est en état
     running/paused/restarting/removing (on kill par ID, on attend terminal/absent) ;
  2. la réservation inerte existe sous op.effect.containerName avec le label
     airdd2.fence.op=<op.id> (vérifiée par inspect du nom + label, pas par le nom seul) ;
  3. la fenêtre de grâce (2× POLL_INTERVAL_MS après la dernière observation stable)
     est écoulée, pour laisser une éventuelle requête en transit arriver et échouer
     sur le nom réservé.
```

Le vérifieur **échoue fermé** (`false`) sur toute inspection douteuse (inspect en erreur, label mismatch, état inconnu) — jamais sur « ça a l'air absent ».

### 3.5 Control plane gateway (nouveaux endpoints)

`DockerGatewayServer` expose, en plus de `/v1/worker/activate` et `/v1/worker/close` :

- `POST /v1/operations/:operationId/fence` → exécute le fencing (réservation de nom + kill par ID/label) et retourne `{ fenced: boolean, nameReserved: boolean, quiescent: boolean, observed: [...] }` ;
- `POST /v1/operations/:operationId/verify` → exécute `verifyFenced` et retourne `{ quiescent: boolean }`.

Le backend les appelle via `DockerGatewayControlClient` (étendu), **uniquement** pendant la procédure `fence-and-retry`. Le daemon local (`dockerGatewayMain`) utilise le même vérifieur au démarrage pour les opérations fencées (réconciliation best-effort, sans bloquer l'ouverture du socket).

## 4. Contrat applicatif : `fence-and-retry`

### 4.1 Endpoint

```
POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry
```

Monté dans un nouveau routeur `backend/src/routes/workspaceRuns.routes.ts` sur `/api/workspaces` (à côté de `workspaces.routes.ts`).

- `:workspaceId` = ObjectId du workflow/workspace, **ownership strict** : le workflow doit appartenir à `req.user.id` (vérification explicite, comme `ownership.middleware`) ;
- `:runId` = `executionId` (UUID v4), le run doit appartenir au user **et** au workspace ;
- `requireAuth` (JWT) obligatoire ;
- header **`Idempotency-Key` obligatoire** (validation Zod, même pattern que `/api/runs/executions/:id/retry`) ; rejeu idempotent : même clé + même cible → même réponse (200 replay) sans re-fencing.

### 4.2 Préconditions métier

Le run cible doit être dans un état terminal réconciliable : `worker_lost` ou `quarantined`. Sinon `409 { code: 'RUN_NOT_QUARANTINED', status }`.

### 4.3 Séquence (ordre strict, chaque étape persistée avant la suivante)

1. **Fencing Docker par label/ID via le gateway** (`POST /v1/operations/:opId/fence` puis `/verify`), timeout global `RECONCILE_TIMEOUT_MS` = 30 s.
   - Si quiescence non prouvée → **504 `{ code: 'FENCING_TIMEOUT_ESCALATED' }`**, verrou workspace **retained**, alerte critique persistée (collection `runtime_alerts`, severité `critical`, visible UI), aucune libération. L'opération gateway reste `fenced`/`unknown` — le journal n'est pas touché.
2. **Marquage `fenced` + audit signé** : l'opération gateway passe de `unknown` à `fenced` avec `fenceKind` = `user_manual_reset` (ou `agent_auto_recovery`), et une entrée est insérée dans `gateway_fence_audit` (collection immuable, jamais supprimée) : `{ actorUserId, timestamp, fencedOpUuid, operationId, reason, quiescenceProven }`.
3. **Libération conditionnelle du verrou** : `MongoWorkspaceLockService.releaseForRun(ownerUserId, workflowId, runId)` — ne libère que si `owner === runId`. Si le verrou appartient à un autre run → **409 `{ code: 'WORKSPACE_LOCKED_BY_OTHER_RUN' }`** (étapes 1-2 déjà persistées, le run reste terminal réconciliable, l'UI explique).
4. **Création du nouveau run** : `UserToolRun` `queued`, nouvel `executionId`, `retryOfExecutionId: runId`, `recoveryAttemptCount` = parent + 1 (nouveau champ, défaut 0), contexte privé rechiffré, parent **strictement immutable** (aucun `$set` sur le parent hors champs de résolution).

**Atomicité** : étapes 2-4 dans une transaction Mongo (session) si replica set disponible ; sinon séquence CAS ordonnée avec rejeu idempotent sur `Idempotency-Key` (table `run_command_idempotency` réutilisée). En cas d'échec entre 2 et 4, l'état reste cohérent : opération fencée + audit + run terminal ; le verrou est soit libéré soit retenu, jamais dans un état intermédiaire non persisté.

### 4.4 Réponses HTTP

| Code | Corps | Cas |
|---|---|---|
| 202 | `{ fencedRunId, newExecutionId, status: 'queued', recoveryAttemptCount }` | succès (ou 200 si rejeu idempotent) |
| 400 | `{ code: 'IDEMPOTENCY_KEY_REQUIRED' }` | header absent |
| 404 | `{ code: 'RUN_NOT_FOUND' }` | run/workspace inconnu ou non possédé |
| 409 | `{ code: 'RUN_NOT_QUARANTINED' \| 'WORKSPACE_LOCKED_BY_OTHER_RUN' }` | précondition ou verrou tiers |
| 504 | `{ code: 'FENCING_TIMEOUT_ESCALATED' }` | quiescence non prouvée sous 30 s |

### 4.5 Modèle de données (évolutions)

- **Contrat de statuts** (`userToolRun.contract.ts`) : ajout de deux statuts terminaux `worker_lost` et `quarantined` (transitions `[]`). `error.code` conservé (`WORKER_LOST` / `QUARANTINED`) pour la rétrocompatibilité des filtres existants. `markExpiredRunWorkerLost` pose désormais `status: 'worker_lost'` ; quand la preuve de quiescence est **absente** au démarrage, le reconciler pose `status: 'quarantined'` (verrou tenu) au lieu de laisser le run `running` indéfiniment. Les requêtes existantes (`listWorkerLostLockCleanup`, `listExpiredSupervisedRuns`, index partiels) sont mises à jour et testées.
- **`UserToolRun`** : nouveau champ `recoveryAttemptCount: number` (défaut 0, indexé avec `retryOfExecutionId`).
- **`AgentPrototype`** (et snapshot sur l'instance/nœud) : `recoveryPolicy: { autoFenceAndRetry: boolean; maxAttempts: number }`, défaut `{ autoFenceAndRetry: false, maxAttempts: 0 }`, validé par Zod.
- **Nouvelles collections** : `gateway_fence_audit` (immuable), `runtime_alerts` (alertes, dont `FENCING_TIMEOUT_ESCALATED` critique).
- **Événements runtime** (`runtimeEvent.contract.ts`) : nouveaux types versionnés `run.quarantined`, `run.fenced`, `run.recovery_relaunched` émis vers `useRuntimeStore` (UI carte + supervision).

### 4.6 Auto-recovery par agent (`recoveryPolicy`)

Lors de la réconciliation au démarrage (ou via le worker), si le run `quarantined` appartient à un agent dont la `recoveryPolicy.autoFenceAndRetry === true` et `recoveryAttemptCount < maxAttempts`, le worker exécute la **même séquence** que `fence-and-retry` avec `reason: 'AGENT_AUTO_RECOVERY'` (audit signé `actorUserId = ownerUserId`, `fenceKind: 'agent_auto_recovery'`). Si le seuil est atteint, le run reste `quarantined` et la main est rendue à l'utilisateur (bouton Reset & Relance).

## 5. Visibilité et journalisation

- `UserToolRun.error` : `code` (`WORKER_LOST`/`QUARANTINED`/`FENCING_TIMEOUT_ESCALATED`), `subsystem: 'runner'`, `failureKind`, `message` explicite, `retryable: true` ;
- entrée dans `agent_journals` pour l'agent/nœud concerné (agentInstanceId) : cause, état du verrou, opération fencée ;
- événements runtime versionnés (`run.quarantined`, `run.fenced`, `run.recovery_relaunched`) → WebSocket → `useRuntimeStore` → UI (carte workflow + panneau de supervision, US-J7-03) ;
- `gateway_fence_audit` : piste d'audit immuable (qui, quand, quelle opération, quelle preuve).

## 6. Fichiers impactés (prévision)

- Gateway : `DockerGatewayServer.ts` (injection label, routes `/v1/operations/*`), `DockerGatewayAdmission.ts` + `MongoDockerGatewayAdmission.ts` (`fencedOperations`, état `fenced`, activation avec fencing auto), `DockerGatewayOperationReconciler.ts` (nouveau `verifyFenced`), `DockerGatewayDaemon.ts` (ouverture avec opérations fencées), `DockerGatewayControlClient.ts` (méthodes fence/verify), `dockerGatewayMain.ts` (vérifieur au démarrage).
- Backend : `domain/execution/userToolRun.contract.ts` (statuts), `models/UserToolRun.model.ts` (`recoveryAttemptCount`), `models/AgentPrototype.model.ts` (`recoveryPolicy`), `services/userToolRun.service.ts` (`markExpiredRunWorkerLost` → `worker_lost`, `markRunQuarantined`, `fenceAndRetry` orchestration), `services/runtime/MongoExpiredRunReconciler.ts` (quarantined si preuve absente), `services/runtime/MongoWorkspaceLockService.ts` (inchangé, déjà conditionnel), nouveau `routes/workspaceRuns.routes.ts`, `server.ts` (montage), nouveau service `fenceAndRetry.service.ts` + `gatewayFenceAudit` + `runtimeAlerts`.
- Tests : `mongo-docker-gateway-admission.test.ts`, `docker-gateway-daemon.test.ts`, `docker-gateway-recovery.integration.test.ts`, `mongo-expired-run-reconciler.test.ts`, `runs-command.routes.test.ts` + nouveau `workspace-runs.fence-and-retry.routes.test.ts`, `durable-worker-restart.integration.test.ts`, `queued-run-quarantine.integration.test.ts`.
- Déploiement : `backend/deploy/systemd/*` (unités à jour sur l'hôte cible), `backend/deploy/recovery-validation/*` (scénarios fencing label/ID).

## 7. Plan de tests

1. **Unitaires** : admission Mongo avec `fencedOperations` (rotation d'epoch auto-fence, réouverture, epoch périmée rejetée) ; `verifyFenced` (label présent → kill par ID → terminal ; réservation absente → false ; inspect en erreur → false) ; endpoint (202/409/504/400, idempotency replay, ownership 404) ; contrat de statuts (transitions interdites).
2. **Intégration labo isolé** (`backend/deploy/recovery-validation/compose.yaml`) : restart gateway avec opération `run` unknown → admission rouvre, opération fencée, réservation de nom posée ; création Docker différée après fencing → échoue (nom réservé) ; kill différé par nom → ne touche pas la réservation (opérations par ID/label) ; deux workers concurrents ; `fence-and-retry` complet avec preuve label/ID sous 30 s ; timeout 30 s → 504 + alerte + verrou tenu.
3. **E2E** : bouton « Reset & Relance » sur run `quarantined` (scénarios J6-01 n°16 et 11 rejoués) ; auto-recovery avec `recoveryPolicy` ; affichage de l'état du verrou sur la carte et le panneau de supervision.
4. **Non-régression** : suites existantes vertes (root, backend, `ci:node25:runtime`, audit strict) ; `test:j6:backend` étendu.

## 8. Déploiement sur l'hôte cible

1. Build backend (`npm --prefix backend run build`) → vérifier `dist/src/server.js` et `dist/src/services/runtime/dockerGatewayMain.js` ;
2. installer les unités systemd corrigées (`airdd2-docker-gateway.service`, `airdd2-backend.service`) + env files root-owned 0640, `systemctl daemon-reload`, enable/start gateway puis backend ;
3. vérifier `/api/health/ready` = 200 (Mongo + epoch gateway + worker) ;
4. rejouer le scénario SIGKILL backend sous systemd sur l'hôte réel + restart gateway avec opération incertaine réelle → admission rouvre, opération fencée, run `quarantined`, verrou tenu, puis `fence-and-retry` via API avec preuve label/ID → 202 + nouveau run `queued`.

## 9. Critères d'acceptation US-J7-02 (mise à jour)

- [ ] Le démon rouvre l'admission à chaque nouvelle epoch même avec des opérations `unknown` fencées ; aucune opération fencée ne bloque les autres workspaces.
- [ ] Toute opération `run`/`kill` incertaine est confinée par label + réservation de nom ; la sortie de quarantaine exige `verifyFenced` (label/ID + réservation + fenêtre de grâce), jamais une simple inspection.
- [ ] `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry` : 202/409/504 conformes, Idempotency-Key obligatoire, ownership strict, parent immutable, `recoveryAttemptCount` incrémenté.
- [ ] Le verrou workspace n'est libéré que si `owner === runId` et après quiescence prouvée ; sinon il reste tenu et une alerte est persistée.
- [ ] Journal et audit jamais effacés (`docker_gateway_state`, `dockerJournal`, `gateway_fence_audit`).
- [ ] `recoveryPolicy` par agent, défaut off, auto-recovery sous le seuil avec audit `AGENT_AUTO_RECOVERY`.
- [ ] Déploiement validé sur l'hôte Linux cible (health/ready, SIGKILL, restart gateway, fence-and-retry réel).
- [ ] E2E complet (scénarios 6/10/11/12/16 + matrice J6-02) puis US-J7-04 prononce le gate.

## 10. Résidus / questions suivies

- Transaction Mongo pour la séquence 2-4 : disponible si déploiement en replica set (le test opt-in `mongo-docker-journal-replica.integration.test.ts` couvre la topologie) ; sinon CAS + idempotency. À confirmer avec l'agent 04 (topologie cible de l'hôte).
- La fenêtre de grâce (2× poll) dans `verifyFenced` est une borne pragmatique ; à valider en labo avec une vraie requête différée.
