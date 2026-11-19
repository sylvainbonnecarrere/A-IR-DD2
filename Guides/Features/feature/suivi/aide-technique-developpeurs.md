# Aide technique développeurs — synthèse des rapports de la refonte V1→V2

**Date :** 2026-11-19 · **Source :** synthèse de `j6-validation-report.md`, `v1-v2-code-inventory.md`, `v1-v2-drift-analysis.md`, `v1-v2-workflow-migration-phase-1.md` (ce dossier `suivi/`).
**État :** jalons J0–J7 clos, verdict J6 final **GO** signé le 2026-11-19 (voir `j6-validation-report.md` § US-J7-15).

## 1. Commandes de validation (dans l'ordre recommandé)

```bash
npm run audit:workflow-architecture:strict   # garde-fou anti-dérive V1/V2, doit finir "Audit result: OK"
npm run ci:node25:runtime                     # tranche runtime Node 24.22.1 (sandbox, workspace)
npm test -- --runInBand                       # racine : 93 suites / 585 tests (2026-11-19)
cd backend && npm test -- --runInBand         # backend : 121 suites / 821 tests (2026-11-19)
npm run test:j6:backend                       # 10 suites ciblées (ownership, legacy, migration, runs, worker, sandbox)
npm run test:j6:semi-e2e                      # Playwright semi-E2E, serveur 4173 froid (--strictPort), 11/11
npm run audit:all                             # npm audit root + backend au seuil high
```

Baseline vérifiée le 2026-11-19 : root 93/585 PASS, backend 121 pass/5 skip (821 tests) PASS, audit strict OK, `ci:node25:runtime` PASS (Node 24.22.1 exigé : `>=24.22.1 <25`).

## 2. Environnements de test (règles d'isolation)

| Environnement | Comment | Usage |
|---|---|---|
| Unitaire/Jest | Mongo de test par suite (base temporaire unique, supprimée après) | par défaut |
| Live isolé | Mongo éphémère (ex. port 27018) + backend dédié (port 3101) + frontend froid | smoke live `playwright.live.config.ts` |
| Docker réel gateway | `AIRDD2_TEST_DOCKER_RESERVATION=1 npm --prefix backend test -- --runInBand src/__tests__/docker-gateway-*.integration.test.ts ...` | fencing/réservation/quarantaine réels (conteneurs labelisés, nettoyés) |
| Replica set Mongo (opt-in) | `AIRDD2_TEST_MONGO_REPLICA=1 npm --prefix backend test -- --runInBand src/__tests__/mongo-docker-journal-replica.integration.test.ts` (ou CI `runtime.yml` input `run_replica_tests=true`) | élection/quorum, exécuté et PASS le 2026-11-19 |
| Labo systemd Linux isolé | `docker compose -p airdd2-j7-validation -f backend/deploy/recovery-validation/compose.yaml up -d --build --wait` → `exec -T linux docker pull ubuntu:noble` → `exec -T -e AIRDD2_RECOVERY_VALIDATION=1 linux node deploy/recovery-validation/validate-systemd.cjs` → `down -v` | 5/5 PASS : SIGKILL backend, restart gateway op incertaine, fence-and-retry réel 202, cas négatif 504 |
| CI GitHub | push de release + `npm run ci:report -- --branch main --sha <sha> --require-green` (par le responsable) | preuve de déploiement tracée ; rapports consignés dans `j6-validation-report.md` |

**Interdit :** aucun smoke destructif sur une base partagée/dev ; aucune donnée réelle ; le labo `recovery-validation` est privileged et local uniquement.

## 3. Preuves clés du jalon J7 (où les trouver)

- Worker durable + reprise : `durable-worker-restart.integration.test.ts`, labo #14 (SIGKILL → `quarantined`/`worker_lost`).
- Fencing label/ID : `docker-gateway-fencing(.integration).test.ts`, labo (création différée refusée sur nom réservé, kill par ID uniquement).
- Sortie de quarantaine : `workspace-runs.fence-and-retry.routes.test.ts` (202/409/504, idempotence) + labo (202 réel + audit `gateway_fence_audit` + run fils `queued`).
- WebSocket sécurisé : `websocket-auth.test.ts` (16/16, deny-by-default, aucun `userId` temporaire).
- Verdict + matrices 18/18 et J6-02 : `j6-validation-report.md` § US-J7-15.

## 4. Anomalies connues (classées, non bloquantes)

- **A1** : 1 flake isolé dans `test:j6:backend` (non reproduit sur 3 relances) — à surveiller.
- **A2** : skip déclaratif « artefact runtime sandbox » en live isolé (sandbox Python non prêt) — provisioning validé par ailleurs.
- **A4** : campagne live flaky à froid sur backend dev **partagé** (port 3001) ; 7/7 verts en stack isolée — confirmé comme artefact du dev partagé.
- **A5** : warnings React Flow `nodeTypes/edgeTypes` dans les traces Playwright — cosmétique.

## 5. Migration V1→V2 (rappel opérationnel)

Migration idempotente et rejouable des graphes vers `workflow_nodes_v2` / `workflow_edges` / `workflow_migrations` (détail : `v1-v2-workflow-migration-phase-1.md`). Les écritures legacy sont refusées (HTTP 410/400) et l'audit strict bloque toute réapparition non classée. Classifications V1/V2 : `v1-v2-code-inventory.md` ; décisions d'architecture et divergences : `v1-v2-drift-analysis.md`.

## 6. Dette reportée

`saveEdges` (`services/workspacePersistenceService.ts`, mode invité) → prochaine feature « liens entre nodes » (décision responsable 2026-11-19, tracé dans `../refonte/insight/recommandations-architecte.md` point 10).
