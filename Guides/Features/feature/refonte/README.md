# Refonte V1 → V2 — README de synthèse (architecture & fonctionnement)

**État :** jalons J0–J7 **clos**, verdict J6 final **GO** signé le 2026-11-19. Feature close côté backlog.
**Détail des US :** `backlog/v1-v2-refonte-backlog.md` · **Rapports & aide technique :** `../suivi/` · **Réserves & pistes :** `insight/`

> Ce dossier ne contient plus que des dossiers (`backlog/`, `erreurs/`, `insight/`) et ce README. Les rapports de
> validation/analyse ont été déplacés dans `Guides/Features/feature/suivi/` et synthétisés dans
> `../suivi/aide-technique-developpeurs.md`. Les anciennes notes de conception/plan (architecture sécurité J1,
> conception sortie de quarantaine J7-02, plan UI J7-13, contrat d'événements runtime, plan d'implémentation,
> gate de cutover) sont résumées ci-dessous ; leur contenu opérationnel vit dans le backlog et `insight/`.

## 1. Architecture V2 (état final)

- **Source de vérité unique** : MongoDB + collections V2 canoniques (`workflow_nodes_v2`, `workflow_edges`, `user_tool_runs`, …). V1 est en lecture-compatibilité contrôlée uniquement ; toute écriture legacy est refusée (HTTP 410/400) et surveillée par `npm run audit:workflow-architecture:strict`.
- **Migrations** : V1→V2 idempotentes et rejouables, checkpoints persistés (`workflow_migrations`), reprise après échec (voir `../suivi/v1-v2-workflow-migration-phase-1.md`).
- **Séparation des domaines** : Design (prototypes, graphe, ownership) vs Runtime (runs, tasks, journaux, médias). Le frontend lit le graphe dans `useDesignStore` (source unique) et l'état runtime dans `useRuntimeStore` (REST autoritaire + événements WebSocket versionnés) — aucune reconstruction V1 côté client.
- **Sécurité** : JWT (HTTP + WebSocket, deny-by-default, aucun identifiant temporaire), ownership strict HTTP/socket, validation Zod, AES-256-GCM au repos, helmet/sanitize/rate-limit. Le canal temps réel filtre strictement par `workspaceId` et la whitelist de payload exclut tout secret.

## 2. Runtime J7 : worker durable, gateway Docker, quarantaine (fonctionnement)

- **Worker durable** : démarre avec le backend après init Mongo ; claim atomique des runs `queued` par lease Mongo (60 s, renouvellement 10 s, CAS + writeConcern majority) ; poll 1 s. `/api/health/ready` = 200 seulement si Mongo + epoch gateway + worker OK.
- **Gateway Docker exclusif** (production) : socket Unix 0660, commandes allowlistées, autorité d'epoch persistée dans Mongo (`docker_gateway_state`), une seule opération en attente, tokens hashés. Le backend n'a **jamais** accès direct à Docker en production (`DOCKER_GATEWAY_REQUIRED=true`).
- **Fencing label/ID** : chaque `run` admis porte le label `airdd2.gateway.op=<operationId>` injecté par le serveur. À la rotation d'epoch, l'opération `unknown` de l'ancienne epoch est passée en `fenced` (`auto_epoch_rotation`) avec réservation de nom inerte (`airdd2.fence.op=<id>`) et **l'admission rouvre immédiatement** — plus aucun blocage global. `verifyFenced` (fail-closed, borne 30 s) prouve la quiescence par label/ID + réservation, jamais par simple inspection. Control plane : `POST /v1/operations/:id/fence|verify`.
- **Statuts de run** : `queued`, `running`, `completed`, `failed`, `stopped`, `timed_out`, plus terminaux réconciliables **`worker_lost`** (preuve de quiescence présente, verrou libéré si `owner === runId`) et **`quarantined`** (preuve absente, verrou tenu). Terminaux irréversibles ; retry = nouveau `executionId` (`retryOfExecutionId`, `recoveryAttemptCount`), parent immutable.
- **Sortie de quarantaine** : `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry` (JWT + ownership + `Idempotency-Key` obligatoire) → 202 `{ fencedRunId, newExecutionId, status:'queued', recoveryAttemptCount }` / 409 `RUN_NOT_QUARANTINED` ou `WORKSPACE_LOCKED_BY_OTHER_RUN` / 504 `FENCING_TIMEOUT_ESCALATED` (+ alerte critique persistée, verrou tenu). Audit append-only dans `gateway_fence_audit` ; journaux jamais effacés. `recoveryPolicy: { autoFenceAndRetry, maxAttempts }` par agent (défaut off) pour l'auto-recovery `AGENT_AUTO_RECOVERY`.
- **Événements runtime versionnés** : `run:queued/started/progressed/completed/failed/stopped` + `run:quarantined`, `run:fenced`, `run:recovery_relaunched` (whitelist de payload, version 1).
- **UI (J7-13)** : `WorkflowToolbar` montée en flux layout sur `bosDashboard`/`bosSupervision` uniquement (Lancer / Annuler avec modale de confirmation / Relancer ; pas de Pause), `RunStatusBadge` fidèle dans les 3 représentations du nœud (minimisée, normale, fenêtre agrandie), nom du workflow dans la toolbar, toasts `NotificationDisplay`, états `loading/empty/error/offline/partial`, bouton **Reset & Relance** sur run `worker_lost`/`quarantined` consommant `fence-and-retry`, i18n 8 langues, non-régression positions canvas/minimap/controls (Playwright).

## 3. Fonctionnement opérationnel

- **Dev** : Node 24.22.1 (`>=24.22.1 <25`), `cd backend && npm run dev`, racine `npm run dev` (Vite 4000), Mongo via `backend/docker`.
- **Production Linux** : unités systemd `backend/deploy/systemd/` (`airdd2-docker-gateway.service` + `airdd2-backend.service`, env files root-owned 0640), entrées `dist/src/server.js` et `dist/src/services/runtime/dockerGatewayMain.js`.
- **Déploiement tracé** : `deploy.yml` (workflow_dispatch, staging/production, preflight + gates + `confirm_production`) ; rapports CI par push via `npm run ci:report` consignés dans `../suivi/j6-validation-report.md`.
- **Validation** : commandes exactes et environnements isolés dans `../suivi/aide-technique-developpeurs.md`.

## 4. Arborescence

```
Guides/Features/feature/
├── refonte/
│   ├── README.md                  ← ce fichier (synthèse architecture & fonctionnement)
│   ├── backlog/v1-v2-refonte-backlog.md   ← US détaillées J0–J7, ordre imposé, DoD, gate
│   ├── erreurs/                   ← incidents CI et leur résolution (resolution-audit-gate.md)
│   └── insight/                   ← rapport-feature.md (réserves R1–R6), recommandations-architecte.md
└── suivi/                         ← rapports déplacés + synthèse
    ├── j6-validation-report.md    ← campagne J6 + J7-15 (verdict GO) + rapports CI des push
    ├── v1-v2-code-inventory.md    ← inventaire/classification V1/V2 (J0)
    ├── v1-v2-drift-analysis.md    ← analyse de dérive et décisions d'architecture
    ├── v1-v2-workflow-migration-phase-1.md ← procédure de migration V1→V2
    └── aide-technique-developpeurs.md      ← synthèse pratique (commandes, environnements, preuves)
```

## 5. Règles non négociables (rappel)

MongoDB + `UserToolRun` = source de vérité ; statuts terminaux irréversibles ; retry = nouveau run, jamais de `resume` ; **journal jamais effacé, verrou jamais libéré sur simple inspection** (preuve label/ID + `owner === runId`) ; backend prod sans accès Docker direct ; tests live uniquement sur base de test isolée et disposable.

## 6. Dette reportée

`saveEdges` (mode invité, `services/workspacePersistenceService.ts`) → prochaine feature « liens entre nodes » (tracé dans `insight/recommandations-architecte.md`).
