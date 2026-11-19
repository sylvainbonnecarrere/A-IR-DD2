# Rapport général de la feature — Refonte V1→V2 et jalon J7 (quarantaine / worker durable / cutover)

**Rédacteur :** `09-architecte-applicatif`
**Date :** 2026-11-19
**Périmètre évalué :** backlog `Guides/Features/feature/refonte/backlog/v1-v2-refonte-backlog.md` (J0–J7), conception `Guides/Features/feature/refonte/README.md`, plan UI `Guides/Features/feature/refonte/README.md`, code `main` @ `ad294fb`.

---

## 1. Verdict d'architecte

**L'architecture implémentée est conforme à la conception et fiable sur les invariants de sûreté** (fail-closed, Mongo source de vérité, journal jamais effacé, verrou jamais libéré sans preuve label/ID + `owner === runId`, statuts terminaux irréversibles, WebSocket deny-by-default).

**Mise à jour 2026-11-19 : la feature est CLOSE au niveau backlog.** Le verdict GO de J7-15 est signé et les réserves de la section 4 sont levées ou reportées avec trace : R1 résolu (rapports CI du push `ef19500…` consignés), R2 reporté à la prochaine feature « liens entre nodes », R3/R4 corrigés (commit `7329931`), R5/R6 confirmés par le responsable. Le chapeau US-J7-02 est fermé (backlog §5, mise à jour 2026-11-19).

## 2. Conformité à la conception (vérifiée dans le code, pas seulement revendiquée)

| US | Élément de conception | Où c'est implémenté (vérifié) | Verdict |
|---|---|---|---|
| J7-05 | label `airdd2.gateway.op=<operationId>` injecté par le serveur sur tout `run` admis | `DockerGatewayServer.ts:169` (injection) + `:634` (allowlist label) | conforme |
| J7-05 | `fencedOperations[]` + fencing auto `auto_epoch_rotation` à la rotation d'epoch, admission rouverte | `MongoDockerGatewayAdmission.ts:102-115`, `:357` | conforme |
| J7-05 | `verifyFenced` fail-closed + réservation de nom `airdd2.fence.op` | `DockerGatewayOperationReconciler.ts:54,108,137,160,186-197` (`reserveName`, `verifyNameReservation`) | conforme |
| J7-05 | control plane `POST /v1/operations/:id/fence\|verify` | `DockerGatewayControlClient.ts:52,70` | conforme |
| J7-06 | statuts terminaux `worker_lost`/`quarantined`, `RECONCILABLE_TERMINAL`, transitions `running -> …` uniquement | `userToolRun.contract.ts:10-11,22-23,58` | conforme |
| J7-07 | route `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry`, `Idempotency-Key` requis, séquence fencing→audit append-only→`releaseForRun`→nouveau run, codes 202/409/504 | `workspaceRuns.routes.ts:74-77` ; `fenceAndRetry.service.ts:51-173` | conforme |
| J7-08 | `recoveryPolicy` Zod, défaut off, auto-recovery `AGENT_AUTO_RECOVERY` | `recoveryPolicy.contract.ts` | conforme |
| J7-09 | événements `run:quarantined`/`run:fenced`/`run:recovery_relaunched` | `runtimeEvent.contract.ts` (3 occurrences) | conforme |
| J7-12 | WebSocket JWT strict, deny-by-default, plus de `userId` temporaire | `socketAuth.middleware.ts` (`verifySocketAccessToken`) ; `WebSocketManager.ts` (plus de branche guest) | conforme |
| J7-13 | toolbar montée, badge de statut dans les 3 représentations du nœud, toasts | `RobotPageRouter.tsx:114` ; `V2AgentNode.tsx:395,1742-1743` (`RunStatusBadge`) | conforme (voir réserve R5) |
| J7-14 | outillage rapports CI (`ci:report`, job `report` ci.yml, artefact deploy report) | `scripts/ci/collect-ci-report.mjs`, workflows | conforme ; **rapports réels en attente du push** |
| J7-15 | rejoué J6 en isolé, verdict GO signé, test replica Mongo PASS | `Guides/Features/feature/suivi/j6-validation-report.md` § US-J7-15 | conforme |

## 3. Validation re-exécutée par l'architecte (2026-11-19)

- `npm run audit:workflow-architecture:strict` → **OK** (zéro `UNKNOWN` ; aucune allusion V1 non classée sur les surfaces connues).
- Suites ciblées J7 re-jouées : `workspace-runs.fence-and-retry.routes`, `websocket-auth`, `mongo-docker-gateway-admission`, `user-tool-run.contract`, `recovery-policy.contract` → **5 suites / 54 tests PASS**.
- Campagnes complètes documentées par les agents (non re-jouées ici) : root 93 suites/585 tests, backend 121 suites/821 tests, labo systemd 5/5, live Docker 9 suites/88 tests, replica Mongo 1/1.

## 4. Réserves et points non conformes — la feature n'est pas close

| # | Sévérité | Point | Détail / action |
|---|---|---|---|
| R1 | **RÉSOLU 2026-11-19** | Rapports CI du push de release consignés | Push `ef19500da572512b61f906b582b4871135cf1bbb` : CI 7/7, Runtime 4/4, Security 4/4, rapport complet dans `Guides/Features/feature/suivi/j6-validation-report.md` (section US-J7-14). Le relevé reste dû à chaque push de release (`npm run ci:report`). |
| R2 | **Reporté 2026-11-19** | Dette `saveEdges` | `services/workspacePersistenceService.ts:164` pointe encore vers le write path legacy `/api/workflows/:id/edges` (mode invité). Décision responsable : traité dans la **prochaine feature « liens entre nodes »** (écart 5 WORKFLOWLINKS), tracé dans `recommandations-architecte.md` point 10. |
| R3 | Majeur (hygiène) | 1114 artefacts `backend/python/.provisioned/**` **encore trackés** par git | Le `.gitignore` ne s'applique pas aux fichiers déjà suivis : `git rm -r --cached backend/python/.provisioned` est nécessaire (fait dans ce commit). Sans cela, chaque poste peut ré-embarquer 119k lignes d'artefacts. |
| R4 | Mineur | `refonte/erreurs/ci-report.txt` non commité | Dump d'erreur CI déjà résolue (`MODULE_NOT_FOUND build-run-report.cjs`, fix `ad294fb`) — même politique que `b01da04` : supprimer, la résolution est consignée dans `erreurs/resolution-audit-gate.md`. |
| R5 | **Confirmé 2026-11-19** | Nom du workflow dans la **toolbar** (jaune BOS) | Décision produit confirmée par le responsable : le nom du workflow reste dans la toolbar (évite la redondance avec le header). |
| R6 | **Confirmé 2026-11-19** | Flaky d'hydratation à froid sur backend dev partagé (port 3001) | Non reproductible en stack isolée (7/7 verts en isolé, US-J7-15) ; confirmé comme artefact du backend dev partagé, non bloquant. |

## 5. Évaluation des todos de fin de backlog (§12 DoD, §13 gate)

| Critère (§13 checklist gate) | État | Preuve |
|---|---|---|
| audit architecture zéro lecture legacy critique | **Validé** | audit strict OK (re-joué ici) |
| migrations V1→V2 rejouables sans doublon + reprise | **Validé** | J3/J4, suites migration vertes |
| tests non-régression workflows invalides / transitions / ownership | **Validé** | J6-02 revalidée sans fixture affaiblie |
| tests panne / retry / annulation / reprise sur runs | **Validé** | labo 5/5 + `durable-worker-restart`, `runs-command` |
| gestion des runs et erreurs : retention, réconciliation, libération, preuves, états incertains ; jamais de suppression de preuves ni libération sans sûreté | **Validé** | J7-05..J7-09 (journal append-only, `verifyFenced`, `releaseForRun owner===runId`) |
| fixtures QA et jeux de données historiques | **Validé** | §8 matrice, campagnes agents |
| DoD phase 2 | **Validé** | gate bloc 3 + J7 |
| validation fonctionnelle front + runtime avant cutover complet | **Validé avec réserve R5** | J7-13 + J7-15 (18/18) |
| rapports CI de déploiement consignés | **NON validé (R1)** | en attente du push responsable |
| aucune dette legacy ouverte non justifiée | **NON validé (R2)** | `saveEdges` encore vivant |

## 6. Conditions de clôture de la feature

1. R1 : au moins un push de release documenté avec son rapport CI (`npm run ci:report`) dans `Guides/Features/feature/suivi/j6-validation-report.md` → ferme US-J7-14.
2. R2 : `saveEdges` fermé (refus explicite côté serveur + test) ou US dédiée signée avec justification.
3. R3/R4 : hygiène dépôt (`.provisioned` désindexé, dump CI supprimé) — fait dans ce commit.
4. R5/R6 : confirmations écrites du responsable.
5. Puis clôture du chapeau **US-J7-02** et mise à jour §5.

## 7. Axes d'amélioration

Voir `insight/recommandations-architecte.md` (mises à jour 2026-11-19 : rapports CI, saveEdges, .provisioned, cold-start).
