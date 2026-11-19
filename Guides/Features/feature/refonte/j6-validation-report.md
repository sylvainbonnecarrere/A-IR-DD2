# J6 - Rapport de validation initial (2026-11-03)

**Pilote :** `08-testeur-e2e.agent.md`  
**État :** campagne commencée, J6 non clos.  
**Décision provisoire : NO-GO.** Les parcours de l'interface dépendant des écarts J5 1 à 3 seront traités au cutover final, conformément à la décision projet. Ils restent bloquants pour le verdict de livraison, mais ne bloquent pas la préparation et l'exécution des autres validations J6.

## Actualisation J7-02 au 17/11/2026

Les éléments datés ci-dessous décrivent la campagne J6 initiale et ne sont pas un état courant de l'implémentation. Depuis, un worker Mongo durable et un gateway Docker ont été raccordés. Une campagne Linux locale isolée avec systemd, Node 24.22.1, MongoDB et Docker-in-Docker a réussi : **10 suites et 61 tests**, sans test ignoré. Elle couvre notamment la reprise des workers, le fencing, la création Docker différée et la réconciliation d'un conteneur réel. La commande `npm run ci:node25:runtime` a également réussi sous Node 24.22.1 : 3 suites et 20 tests.

En complément, deux `SIGKILL` du backend sous systemd ont confirmé respectivement l'arrêt d'un conteneur actif, la persistance de `WORKER_LOST` et la libération de son verrou, puis le maintien en quarantaine d'un conteneur suspendu et de son workspace. Un redémarrage du gateway avec opération `run` synthétique injectée dans le journal confirme le maintien de l'incertitude et l'absence d'ouverture du socket ; ce scénario ne simule pas une vraie requête en transit. Les permissions entre comptes backend, gateway et Docker ont été vérifiées dans cet environnement.

La campagne a également démontré qu'une création Docker différée peut survenir après une inspection indiquant l'absence du conteneur. Le gateway conserve désormais une opération `run` incertaine en quarantaine, sans rouvrir l'admission sur cette seule inspection. La sortie sûre de cette quarantaine, le redéploiement et la validation sur l'hôte Linux cible restent ouverts. Le verdict J6 demeure **NO-GO** ; ces tests ciblés ne remplacent pas la campagne E2E.

Un test complémentaire sur le moteur Docker-in-Docker isolé maintient une requête de démarrage en attente après déconnexion du client : un conteneur observé `created` démarre ensuite réellement. Si le conteneur initial est d'abord supprimé et remplacé par une réservation inerte, le démarrage différé par ancien ID échoue et la réservation reste valide. Ces essais ciblés (2 suites, 16 tests réussis) ne prouvent pas la sécurité de toutes les courses : une suppression tardive par nom peut notamment détruire la réservation, et les effets déjà exécutés doivent aussi être neutralisés. Aucune sortie de quarantaine de production n'est revendiquée.

Les admissions Mongo et en mémoire transmettent désormais au vérificateur de `reconcileUnknown` les métadonnées d'effet de l'opération, conservées après redémarrage. Le vérificateur utilisé au redémarrage refuse toujours les `run` et `kill` incertains : le raccordement des métadonnées ne constitue pas une preuve de quiescence. Un test réel montre qu'une suppression différée par nom détruit une réservation inerte ; un autre montre qu'un `kill` différé par nom peut atteindre un conteneur de remplacement.

Nouvelle validation locale : build backend et **11 suites, 72 tests** ciblés réussis sous Linux/Docker-in-Docker isolé ; la suite de quarantaine queued passe aussi (8 tests), ainsi que les sept tests de requêtes Docker retardées après ajout de la suppression différée. Le script systemd valide à nouveau les deux pannes backend et la quarantaine d'une opération synthétique. Le runtime CI passe sous Node 24.22.1 (3 suites, 20 tests).

La campagne Playwright semi-E2E complète en série a produit **10 succès et 1 échec** : le scénario `minimize-restore` ne trouve pas le canvas attendu ; avec sa configuration par défaut, il ciblait initialement le port 4000 au lieu du serveur de test 4173. Les dix scénarios de la campagne J6 sont passés lors de cette exécution séquentielle. Les tests navigateur avec réponses mockées ne démontrent pas un parcours E2E complet du worker réel.

La campagne live navigateur a été rejouée avec le backend et MongoDB éphémères du laboratoire, exposés temporairement sur loopback et avec l'origine CORS du frontend configurée : **6 succès, 1 échec, 1 test ignoré**. Le scénario d'attachement workspace ne retrouve pas le fichier dans l'interface, y compris lors d'une seconde exécution isolée. Le scénario d'artefact runtime a été ignoré parce que le sandbox Python n'était pas prêt. Ces résultats ne constituent pas une validation complète du runtime réel. Le test d'élection MongoDB en replica set n'a pas été exécuté dans ce laboratoire : il exige une topologie et des ports de test adaptés.

La procédure de démarrage et d'arrêt du laboratoire local privilégié est détaillée dans le README racine. Elle utilise des données temporaires et ne doit pas être exécutée sur une infrastructure de production.

Pour rejouer les tests Docker ciblés sur un environnement de test isolé, avec MongoDB accessible en loopback et l'image locale `ubuntu:noble` :

```bash
AIRDD2_TEST_DOCKER_RESERVATION=1 npm --prefix backend test -- --runInBand \
  src/__tests__/docker-gateway-recovery.integration.test.ts \
  src/__tests__/docker-inflight-reservation.integration.test.ts \
  src/__tests__/docker-name-reservation.integration.test.ts
```

Les tests créent puis suppriment uniquement leurs conteneurs identifiés par des labels de test uniques. Ils nécessitent un accès Docker et ne remplacent pas les essais contrôlés du service systemd en production.

## Actualisation reprise J7 (2026-11-18)

La feature `US-J7-02` est reprise sur la branche `feat/j7-02-quarantine-exit-fencing` (base commitée `e05f977`, baseline verte : root 90 suites/542 tests, backend 114 suites/715 tests, `ci:node25:runtime` 3 suites/20 tests, audit strict OK). La conception de la sortie sûre de quarantaine est validée dans `j7-02-quarantine-exit-fencing-design.md` et le backlog découpe le travail en `US-J7-05` à `US-J7-12` : fencing label/ID côté gateway, statuts terminaux `worker_lost`/`quarantined`, endpoint `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry`, `recoveryPolicy` par agent, visibilité (journaux + événements runtime + alertes), déploiement sur l'hôte Linux cible, stabilisation de `minimize-restore` et de l'attachement workspace live, dette WebSocket. Le verdict J6 reste **NO-GO** tant que le chapeau J7 n'est pas fermé et rejoué via `US-J7-15`.

**Note 2026-11-19 (09-architecte-applicatif)** : `US-J7-05` à `US-J7-12` sont implementées et validées (baseline re-vérifiée : backend 121 suites/821 tests, root 90 suites/544 tests, audit strict OK, `ci:node25:runtime` PASS). La suite du jalon J7 est réordonnée : `US-J7-13` (cutover UI, plan `j7-13-ui-runtime-plan.md`), `US-J7-14` (validation du déploiement via rapports CI GitHub — aucun hôte de production accessible aux agents), puis `US-J7-15` (rejeu J6 + verdict). Ex-`US-J7-03`/`US-J7-04` renommées `US-J7-13`/`US-J7-15`.

### Validation opérationnelle US-J7-10 (2026-11-18, labo Linux isolé, agent `04-cicd-installation`)

Déploiement systemd corrigé (`backend/deploy/systemd/*` : `ConditionPathExists` env files, `RequiresMountsFor` du stockage, `ExecStartPre` sur les sorties `dist/`) + env examples documentés (root-owned 0640, secrets, `RUNTIME_*_IMAGE` identiques des deux côtés) + README mis à jour (sémantique fencing auto à la rotation d'epoch, runbook fence-and-retry). Labo réel exécuté from scratch sur Docker Desktop (systemd + Mongo éphémère + Docker-in-Docker), procédure exacte du README :

```powershell
docker compose -p airdd2-j7-validation -f backend\deploy\recovery-validation\compose.yaml up -d --build --wait --wait-timeout 300   # UP_EXIT=0, linux Healthy (health/ready 200)
docker compose -p airdd2-j7-validation -f backend\deploy\recovery-validation\compose.yaml exec -T linux docker pull ubuntu:noble        # PULL_EXIT=0
docker compose -p airdd2-j7-validation -f backend\deploy\recovery-validation\compose.yaml exec -T -e AIRDD2_RECOVERY_VALIDATION=1 linux node deploy/recovery-validation/validate-systemd.cjs
docker compose -p airdd2-j7-validation -f backend\deploy\recovery-validation\compose.yaml down -v                                    # FINAL_DOWN_EXIT=0
```

Résultat `validate-systemd.cjs` : **VALIDATE_EXIT=0, 5/5 PASS** — (1) SIGKILL réel du backend sous systemd → run sans preuve gateway `quarantined`, verrou tenu, conteneur intact ; (2) restart du gateway avec opération `run` incertaine réelle (pending injecté + conteneur labelisé `airdd2.gateway.op`/`airdd2.execution.attempt`) → fencing auto `auto_epoch_rotation`, epoch+1, socket rouvert immédiatement, réservation de nom (création différée sur le nom refusée), quiescence prouvée, conteneur tué par ID immuable ; (3) restart du backend → run `worker_lost`, verrou libéré (`owner === runId`) ; (4) `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry` réel (JWT + `Idempotency-Key`) → **202 + run fils `queued`** (`retryOfExecutionId`, `recoveryAttemptCount` 1) + entrée `gateway_fence_audit` immuable + verrou libéré, rejeu même clé → 200 `replayed` sans effet ; (5) cas négatif sans opération fencée → **504 `FENCING_TIMEOUT_ESCALATED`** + alerte `critical` persistée + verrou tenu + aucun audit. Journaux jamais effacés ; cleanup limité aux fixtures du script. Non-régression même jour : `npm --prefix backend run build` exit 0 ; backend 121 suites passées/5 skippées, 808 tests, EXIT=0 ; root 90 suites/542 tests EXIT=0 ; `audit:workflow-architecture:strict` OK ; `ci:node25:runtime` 3 suites/20 tests PASS (Node 24.22.1) ; `npm run audit:all` exit 0 ; live Docker gateway 4 suites/23 tests PASS.

### Validation du déploiement via rapports CI GitHub — US-J7-14 (2026-11-19, agent `04-cicd-installation`)

Aucun hôte de production n'est accessible aux agents : la **preuve de déploiement** est le retour CI de GitHub, push et relevés effectués par le responsable projet. Trois niveaux de preuve sont distingués explicitement :

| Niveau | Preuve | Où |
|---|---|---|
| Labo Linux isolé (systemd + dind) | preuve **opérationnelle locale** : US-J7-10, 5/5 PASS (SIGKILL, restart gateway op incertaine, fence-and-retry réel 202) | `backend/deploy/recovery-validation/`, section ci-dessus |
| CI GitHub sur la branche de release | preuve de **déploiement tracée** : runs/jobs/artefacts de `ci.yml`, `runtime.yml`, `security.yml` + rapports consolidés | rapports ci-dessous, artefacts `ci-report-<sha>` |
| Production | déploiements GitHub (environnements `staging`/`production`, `deploy.yml` workflow_dispatch + preflight + gates + `confirm_production`, bundle `deploy-bundle-<sha>.tgz` + sha256, `deploy-metadata.json`) | environnements GitHub + artefact `deploy-report-<sha>` |

Renforcements CI livrés pour cette US : job `report` dans `ci.yml` (artefact `ci-report-<sha>.json` : jobs/conclusions/artefacts du run + step summary) ; step « Publish deployment report artifact » dans `deploy.yml` (artefact `deploy-report-<sha>.json` : environment, sha, run, état/URL du GitHub Deployment) ; job opt-in `mongo-replica-journal` dans `runtime.yml` (input `run_replica_tests=true` en workflow_dispatch, exécute `mongo-docker-journal-replica.integration.test.ts` contre un replica set jetable — dépendance US-J7-15) ; collecteur `scripts/ci/collect-ci-report.mjs` (`npm run ci:report`, `--self-test` OK) qui relève runs/jobs/artefacts via `gh api` et rend un rapport markdown/JSON consignable ici.

Procédure exacte après chaque push de la branche de release (responsable) :

```powershell
gh auth login                                      # une fois
git push origin main                                # push de la branche de release
npm run ci:report -- --branch main --sha <sha> --out ci-report-<sha>.md --require-green
# copier le rapport dans cette section avec le sha exact
# déploiement staging/production : Actions > Deploy > Run workflow (ref main / tag v*.*.*),
# input confirm_production=DEPLOY_PRODUCTION obligatoire en production
```

Rapport par push (à remplir par le responsable à chaque push ; état au 2026-11-19 : **en attente du premier push de release**, aucun rapport CI réel relevé côté agent) :

| Push (date) | SHA | ci.yml | runtime.yml | security.yml | deploy.yml (env) | Artefacts | Verdict |
|---|---|---|---|---|---|---|---|
| 2026-11-19 | `3481b75` | KO job `report` (checkout manquant -> MODULE_NOT_FOUND build-run-report.cjs, artefact ci-report-<sha>.json absent) ; autres jobs verts | — | — | — | — | corrigé (checkout ajouté au job `report`), voir commit suivant |
| — | — | — | — | — | — | — | en attente push responsable |

Aucune opération destructive sur des données réelles ; environnements CI isolés uniquement. **Reste ouvert** : déploiement sur l'hôte Linux de production (hors accès agent) — la procédure README § déploiement systemd s'applique telle quelle ; le labo ne s'y substitue pas.

## Périmètre et isolation

Les tests semi-E2E utilisent des utilisateurs, tokens et réponses API synthétiques. Aucun compte réel, fournisseur LLM ni clé API n'est utilisé. Les smoke tests live qui enregistrent un utilisateur dans la base configurée ne sont pas exécutés dans cette campagne isolée.

## Baseline exécutée

| Commande / suite | Résultat au 2026-11-03 | Remarque |
|---|---|---|
| `npm test -- --runInBand` | PASS, 90 suites / 542 tests | Baseline frontend complète |
| `npm run test:coverage` | FLAKY, 89 suites / 541 tests, un échec | `RobotPageRouter.workflow-delete.integration.test.tsx` n'a pas trouvé son node en couverture ; relance ciblée PASS. À surveiller, aucune assertion n'a été affaiblie. |
| `cd backend && npm test -- --runInBand` | PASS, 90 suites / 542 tests | Baseline backend complète |
| `npm run ci:node25:runtime` | PASS, Node 24.22.1 ; 3 suites / 13 tests runtime | Tranche backend / sandbox réussie |
| `npm run test:j7:editor:semi-e2e` | PASS, 5 tests | APIs mockées ; aucun compte réel |
| A2.4 auth semi-E2E | PASS, 4 tests | Login, hydratation, refresh, rechargement et reprise focus, session/API mockées |
| Route-reentry canvas semi-E2E | PASS, 1 test | 3 nodes; 2 navigations; position, minimap, contrôles et scroll comparés. Attentes fixes remplacées par polling géométrique. |
| `npm run test:j6:semi-e2e` | PASS, 10 tests | Combine A2.4 (4), J7 (5) et route-reentry (1) ; session synthétique, APIs mockées |
| `npm run test:j6:backend` (ownership, legacy, migration, snapshot, runs, worker, sandbox, runtime health) | PASS, 10 suites / 71 tests | Les trois routes legacy et le patch générique refusent les mutations V1 sans toucher aux collections V2 |
| `npm run audit:workflow-architecture:strict` | PASS | Résultat `OK` |
| `npm audit --audit-level=high` | PASS au seuil high | 20 vulnérabilités faibles/modérées (4 low, 16 moderate) ; correctif proposé par npm implique une mise à niveau majeure de Jest, non appliquée |
| `npm --prefix backend audit --audit-level=high` | PASS au seuil high | 24 vulnérabilités faibles/modérées (4 low, 20 moderate), notamment `qs` ; non corrigées dans le périmètre QA |
| `npm run test:smoke:live` | NON EXÉCUTÉ | Démarre le backend local connecté à sa configuration Mongo ; certains scénarios créent des comptes/données, donc non isolés |

Le mock d'auth A2.4 et le mock de l'éditeur J7 répondent désormais au contrat réel `GET/PUT /api/user-settings`, supprimant les faux 404 de localisation des traces.

## Point d'avancement US-J7-01 (backend)

Le lancement API persiste maintenant l'intention `queued` avant l'accusé de réception, avec rejeu idempotent et conflit explicite si une même clé est réutilisée pour une autre requête. Le dispatch de préparation/exécution est asynchrone, mais son ordonnanceur reste en mémoire : la reprise après redémarrage n'est pas livrée et reste dans US-J7-02.

L'annulation d'un run queued le termine immédiatement. Pour un run running, la demande est persistée, propagée par `AbortSignal` au runner et confirmée par Docker avant le statut terminal; si la terminaison ne peut pas être vérifiée, le run reste `running`. Un timeout non confirmé suit la même règle de vérité et n'est pas persisté comme échec terminal.

Le retry explicite est réservé aux runs `failed`/`timed_out` retryables et appartenant à l'appelant. Il crée un nouvel executionId enfant avec une clé d'idempotence neuve, préserve le parent terminal et chiffre le contexte privé au repos. Les événements runtime sont publiés via le proxy configuré sur le WebSocket manager.

Validation backend après implémentation : `npm --prefix backend run build` PASS; `npm --prefix backend test -- --runInBand` PASS (83 suites / 417 tests); `npm test -- --runInBand` PASS (90 suites / 542 tests); `npm run ci:node25:runtime` PASS (20 tests runtime; le script indique « Node 24 runtime verification succeeded »). La tranche J7-01 ciblée passe également (6 suites / 67 tests). Ces résultats ne remplacent pas la campagne J6 complète ni les validations UI/live isolées.

## US-J6-01 - Campagne E2E V2

| # | Scénario | Preuve existante | Statut |
|---:|---|---|---|
| 1 | Installation et démarrage local | `ci:node25:runtime`, serveur Vite lancé par Playwright semi-E2E | Partiel : installation locale reproductible et backend live isolé à compléter |
| 2 | Authentification | A2.4 semi-E2E + tests routes auth | PASS en mode isolé/mock |
| 3 | Création ou chargement workflow | création du workflow par auth backend; workspace hydrates par A2.4 | PASS contrat/backend et chargement browser; création UI non couverte |
| 4 | Ajout d'un agent | tests store/isolation, fixture agents de canvas | Partiel : pas de création d'agent de bout en bout via UI |
| 5 | Activation workflow | tests routes auth-workflows, graphe invalide/cycles | Partiel : aucune UI d'activation couverte |
| 6 | Lancement d'un run | `runs-command.routes.test.ts`, `execution-orchestrator.test.ts` | PASS API/backend : le run est persisté `queued` avant réponse 202 ; idempotence et dispatch unique couverts. Le dispatch reste en mémoire et la reprise après redémarrage relève de J7-02. |
| 7 | Suivi d'exécution | contrat événements et `useRuntimeStore` | Partiel : réception stockée; affichage UI et progression de bout en bout non couverts |
| 8 | Tâche en succès | UserToolRun et ExecutionOrchestrator | PASS au niveau service/backend; UI E2E en attente J5 |
| 9 | Tâche en échec | UserToolRun, timeout et sandbox runtime | PASS au niveau service/backend; UI E2E en attente J5 |
| 10 | Annulation | `runs-command.routes.test.ts`, `execution-orchestrator.test.ts`, `docker-sandbox.runner.test.ts` | PASS backend : queued devient `stopped`; running transmet un signal au runner et ne devient terminal qu'après confirmation Docker. Un arrêt non confirmé reste `running` pour réconciliation. |
| 11 | Reprise/retry | `runs-command.routes.test.ts`, `user-tool-run.service.test.ts` | PASS retry explicite : seuls les parents failed/timed_out retryables du propriétaire sont éligibles ; création d'un nouvel enfant avec lineage et nouvelle clé, parent terminal intact. Le contexte privé est chiffré puis restauré. Aucun resume/checkpoint n'est exposé. |
| 12 | Rechargement pendant run | A2.4 teste rechargement d'un workspace, pas d'un run actif | À ajouter après intégration du statut/run UI |
| 13 | Reconnexion canal temps réel | tests ownership WebSocket + store reconnecting/offline | Partiel : reconnexion navigateur/socket non couverte |
| 14 | Refus ressource d'un autre utilisateur | workflow ownership + WebSocket ownership | PASS backend |
| 15 | Migration historique | migration V1→V2 nominale, idempotente et reprise checkpoint | PASS backend |
| 16 | Redémarrage backend/worker | `TaskRuntimeInfraService`, `TaskWorkerService`, dispatch J7-01 | BLOQUANT J7-02 : l'intention queued est dans Mongo, mais le dispatch reste en mémoire et aucun worker durable ne rescane/reclame les runs après redémarrage. Un run `running` n'a pas encore de reconciliation après perte du processus. |
| 17 | Dépendance externe indisponible | `docker-sandbox.runner.test.ts` (dependency-missing simulé), `runtime-health.service.test.ts` | PASS au niveau sandbox/runtime avec dépendance absente simulée; aucun appel réseau/fournisseur réel |
| 18 | Non-régression existante | suites front/backend, J7, A2.4, route-reentry, audit strict | Partiel : coverage complète intermittente, smoke live non isolé |

**Todolist US-J6-01**

- [x] Établir baseline frontend/backend, runtime et sécurité.
- [x] Exécuter semi-E2E authentifié et éditeur avec données synthétiques (`npm run test:j6:semi-e2e`, 10 tests).
- [x] Ajouter des assertions d'état/geometry au parcours route-reentry, sans attente temporisée fixe.
- [x] Aligner les mocks semi-E2E sur le contrat user-settings.
- [ ] Stabiliser `npm run test:coverage` sans assouplir les assertions.
- [ ] Compléter le démarrage backend sur base dédiée et isolée.
- [ ] Compléter création UI agent/workflow, activation et commandes de run après cutover J5.
- [ ] Ajouter reload pendant run, reconnexion navigateur, indisponibilité externe et redémarrage processus.
- [ ] Vérifier accessibilité clavier/ARIA, erreurs visibles et traces d'échec sur parcours critiques.
- [ ] Réexécuter la campagne sur les navigateurs déclarés; étendre à Firefox/WebKit si approuvé par le gate multi-navigateurs.
- [ ] Publier la commande de validation finale après gel de la matrice.
- [ ] Bloquer le GO jusqu'à livraison du worker durable (J7-02), du cutover UI (J7-03) et de la reprise des scénarios 6, 10, 11, 12 et 16 en campagne isolée. L'annulation effective et le retry comme nouveau run sont couverts au niveau backend par J7-01; aucun resume/checkpoint n'est revendiqué.

## US-J6-02 - Non-régression legacy

| Surface | Preuve / constat | Résultat |
|---|---|---|
| Mutation V1 workflow | `auth-workflows.routes.test.ts`: position node, création edge et suppression edge refusées avec `410`; `PATCH /:id/patch` refuse nodes/edges et chemins imbriqués avec `400` | PASS après extension J6, 18 tests dans la suite; la régression patch reproduisait un `200` avant correction |
| PATCH metadata | `PATCH /:id/patch` n'accepte plus les clés `nodes`, `edges`, `nodes.*` ou `edges.*`; refus avant le use case/repository | PASS, aucune node/edge V2 créée ni modifiée |
| GET workflow compatibility | la projection GET supprime `nodes`/`edges` legacy; snapshot unifié annonce le mode V2-only | PASS via `workspace-snapshot.test.ts` |
| V2 instance routes | création/lecture d'instances valide l'ownership du workflow et utilise les modèles V2 | PASS par revue de route et suites workflow/agent-instance backend |
| Lecture snapshot | `workspace-snapshot.test.ts`: neutralise nodes/edges legacy, avertissement V2-only | PASS |
| Migration graphe V1→V2 | migration nominale, relance idempotente, reprise partielle | PASS |
| Ownership HTTP | accès à workflow d'un autre propriétaire refusé avec code stable | PASS |
| Ownership WebSocket | invité et autre propriétaire refusés au join | PASS |
| Mode invité | suites isolation auth/guest existantes | PASS en Jest; parcours live non exécuté sur base locale |
| PersistEdges V1 frontend | `workspacePersistenceService.test.ts` prouve refus authentifié et lecture graphe V2 | PASS ; le mode invité reste à conserver/évaluer dans le backlog dédié |
| Workflows historiques après migration | migration et snapshot testés sur fixtures | PASS au niveau backend; rendu UI en E2E historique à compléter |

**Todolist US-J6-02**

- [x] Inventorier et exécuter les tests de refus des trois mutations V1, d'ownership, de migration et de snapshot V2-only.
- [x] Vérifier qu'aucune fixture n'a été affaiblie dans les suites ciblées.
- [x] Auditer les routes workflow/instance/snapshot liées au graphe : GET V2-only, mutations graph legacy refusées, patch metadata filtré, ownership instance vérifiée.
- [x] Confirmer `WorkspacePersistenceService.saveEdges` : écriture authentifiée refusée et testée ; conserver l'évaluation du chemin invité dans le backlog dédié convenu.
- [ ] Ajouter un parcours UI de lecture d'un workflow migré sans reconstruire une source V1.
- [ ] Exécuter la matrice de non-régression complète après le cutover J5.
- [ ] Classer les anomalies finales et décider GO/NO-GO avec l'équipe domaine/backend.

## Anomalies et décision provisoire

**Bloquantes pour la livraison**
- L'UI J5 ne monte pas la toolbar et n'affiche pas l'observation runtime; le lancement, la reprise et le suivi de run de bout en bout ne peuvent pas encore être validés depuis l'interface. Cela ne bloque pas la préparation J6 selon la décision projet, mais interdit de prononcer GO avant le cutover final.
- Le worker/runtime de reprise n'est pas encore relié comme consommateur durable : `/api/runs/execute` persiste le run, puis l'ordonnanceur de dispatch est en mémoire. Un redémarrage n'a donc pas de reprise/reconciliation démontrée; c'est le périmètre J7-02.
- Le cutover UI J5 et l'observation runtime restent absents; les commandes backend ne sont donc pas validées de bout en bout depuis l'interface (J7-03).

**Écarts runtime backend traités par US-J7-01**
- La route cancel ne marque plus un run running `stopped` avant confirmation de la terminaison runner/container; les arrêts non confirmés restent `running`.
- L'API retry crée un nouveau run enfant avec ownership, idempotence, lineage et contexte privé restauré; aucun état terminal parent n'est réécrit.

**Majeures de validation**
- Reconnexion navigateur, rechargement pendant run et redémarrage de processus ne sont pas E2E.
- Les smoke live ne sont pas isolés d'une base Mongo locale et restent non exécutés.

**Mineures**
- Les sessions E2E simulées déclenchent encore des avertissements d'authentification WebSocket faute de serveur socket mocké.
- Les warnings React Flow de nodeTypes/edgeTypes sont visibles dans les traces Playwright et méritent triage, mais ne font pas échouer les suites.

**Verdict provisoire : NO-GO.** Les tests domaine et les parcours browser isolés ciblés sont verts, mais J6 a découvert des lacunes de contrat/runtime (worker durable, annulation effective, retry/reprise) en plus des scénarios UI différés au cutover J5. Ces écarts doivent être arbitrés avec les responsables J3/J5 avant de prétendre à une validation finale. Le flake coverage reste aussi à résoudre.

## Commandes de validation exécutées

```powershell
npm test -- --runInBand
npm run test:coverage
npm run ci:node25:runtime
npm run test:j7:editor:semi-e2e
npm run test:j6:semi-e2e
npm run test:j6:backend
npm --prefix backend test -- --runInBand
npm --prefix backend test -- --runInBand src/__tests__/auth-workflows.routes.test.ts src/__tests__/workflow-v1-v2-migration.test.ts src/__tests__/workspace-snapshot.test.ts src/__tests__/runs-command.routes.test.ts src/__tests__/websocket-auth.test.ts src/__tests__/worker-lease.service.test.ts
npm run audit:workflow-architecture:strict
npm audit --audit-level=high
npm --prefix backend audit --audit-level=high
```
