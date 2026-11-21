# Insight post-feature v2 — agent `04-cicd-installation` (CI/CD et installation)

**Date :** 2026-11-21
**Périmètre :** jalon J7 (US-J7-05, US-J7-10, US-J7-14 + correctifs CI) sur `feat/j7-02-quarantine-exit-fencing` / `main`.

## Ce qui a bien fonctionné

- **Gate d'audit `scripts/ci/audit-gate.mjs`** : face à un advisory retiré par l'éditeur (GHSA-fc5q-39xc-vjpf) mais encore servi par npm, un gate documenté (allowlist d'advisories retirés, strict sur tout le reste, `--self-test`) évite les `npm audit fix --force` cassants. Leçon : un advisory « high » peut être un artefact de registre — vérifier le statut upstream avant toute mise à niveau majeure.
- **Labo Linux isolé compose** (`backend/deploy/recovery-validation/`) : preuve opérationnelle réelle (systemd + dind + Mongo éphémère) des scénarios SIGKILL / restart gateway / fence-and-retry API — 5/5 PASS en run from scratch. Leçon : une US de déploiement se valide en labo reproductible avant toute revendication sur l'hôte cible.
- **Rapports CI tracés** : artefacts `ci-report-<sha>.json` / `deploy-report-<sha>.json` + collecteur `npm run ci:report` + table par push dans `j6-validation-report.md` — la preuve de déploiement sans accès hôte aux agents passe par là.

## Pièges rencontrés (à ne pas reproduire)

1. **Job CI sans `actions/checkout`** → `MODULE_NOT_FOUND` sur `scripts/ci/*.cjs` puis artefact absent (push `3481b75`). Tout job qui exécute un script du repo doit checker out.
2. **`gh api --paginate --slurp` sur un runner `ubuntu-latest`** : sortie vide avec exit 0 selon la version de gh du runner (push `b2f937a`, run #44899771800, « unexpected end of JSON input »). Correctif : appel `gh api` simple 1 page (`per_page=100` suffisant) + garde `[ ! -s file ]` qui échoue lisiblement. Ne pas dépendre de `--slurp` dans les workflows.
3. **Job de test avec service manquant** : le `beforeAll` global de `setup.ts` exige un Mongo loopback (`MONGODB_URI` ou `localhost:27017`) ; le job opt-in `mongo-replica-journal` sans service Mongo a timeout à 30 s (dispatch #44593799575). Correctif : service `mongo:6.0` + `MONGODB_URI=mongodb://127.0.0.1:27018/...` (loopback exigé par `buildTestMongoUri`).
4. **Collecte de rapports** : `ci-report-7329931….md` collecté localement en échec partiel ne doit pas servir de preuve — toujours sourcer le rapport consigné sur un fichier de collecte complet (`ci-report-ef19500….md`).

## Règles qui ont tenu bon (à garder)

- Journaux jamais effacés (`docker_gateway_state`, `dockerJournal`, `gateway_fence_audit`, `runtime_alerts`) ; verrou workspace libéré uniquement avec preuve `verifyFenced` (label/ID + réservation de nom + fenêtre de grâce, fail-closed 30 s) et `owner === runId`.
- Backend prod : socket gateway uniquement (`DOCKER_GATEWAY_REQUIRED=true`), jamais d'accès Docker direct.
- Pas de smoke destructif sur base partagée ; tests live sur base de test disposable ; environnements CI isolés.
- Unités systemd : `ConditionPathExists` env files, `ExecStartPre` sur les sorties `dist/`, `RequiresMountsFor` du stockage, env files root-owned 0640.

## Ouvert / reporté

- Déploiement sur l'hôte Linux de production : procédure README § déploiement systemd, exécuté et tracé par le responsable (rapports CI consignés à chaque push). Aucun déploiement production revendiqué à ce jour.
- Prochaine feature (« liens entre nodes » selon l'architecte) : surveiller la régression du job `report` (doit rester vert 7/7) et le relevé `ci:report` à chaque push de release.
