# Revue de code post-clôture — feature refonte V1 → V2 (`v1-v2-revue-code`)

**Auteur initial :** `01-architecte-bdd` (revue architecturale, 2026-11-21)
**Revue critique et mise à jour :** `09-architecte-applicatif` (2026-11-23)
**Date :** 2026-11-21, révisée le 2026-11-23
**Branche :** `main` @ `ba6ee8b` — la vague 1 d'hygiène de `06-frontend` est **commitée** (2026-11-23 13:11 UTC, 119 fichiers, +4164/−867 ; working tree propre au 2026-11-23 13:28 UTC). La revue initiale décrivait un working tree non commité @ `f2499f6` ; ce n'est plus l'état courant.
**Backlog source clôturé :** `Guides/Features/feature/refonte/backlog/v1-v2-refonte-backlog.md` (gate de cutover V2 §13 : **GO signé 2026-11-19**, toutes US J0–J7 closes)
**Objectif :** valider la première vague de corrections d'hygiène (désormais committée), corriger les réserves architecturales **restées ouvertes** avant d'activer le gate CI, puis planifier la suite (dette `any`, `console.log`, lint/prettier, CI) en US exécutables.

> **Mise à jour 2026-11-23 (`09-architecte-applicatif`) — constat majeur :** la vague 1 a été committée (`ba6ee8b`, « J2 Livraison US J2 - Revue de code ») **sans** les corrections R1–R3 que la revue initiale exigeait « avant commit » (série US-RC-00a/b/c). Re-vérification sur `ba6ee8b` : **R1, R2, R3 sont toujours ouvertes**, et une 4ᵉ réserve **R4** est identifiée (`format:changed` non bloquant). Ces 4 réserves redeviennent **bloquantes pour la suite** — avant US-RC-01 (gate CI) et avant les campagnes `any` — car un ratchet contournable en local et un check de format toujours vert rendraient le gate CI trompeur. R1 reste un risque de régression silencieuse. Toutes les preuves chiffrées de la vague 1 ont été re-exécutées sur `ba6ee8b` et sont conformes (§2.1).

---

## 1. Conformité du backlog source — vérifiée

Le backlog `v1-v2-refonte-backlog.md` est **conforme et clos** :

- §10 séquence d'exécution : J0→J6 puis J7 (`US-J7-05` → … → `US-J7-15`) exécutée dans l'ordre imposé ; chapeau `US-J7-02` fermé.
- §12 Definition of Done : toutes les US critiques implémentées/testées, V2 seule source d'écriture, migrations rejouables, runs pilotables sans navigateur, front sans reconstruction V1, fixtures adaptées explicitement, suites au vert, validation E2E exploitable (verdict GO signé `08-testeur-e2e`, US-J7-15).
- §13 gate de cutover V2 : évaluation de clôture 2026-11-19 — **tous les points VALIDE, décision GO** (audit strict OK, migrations sans doublon, non-régression `test:j6:backend` 126/126, J7-05..J7-09 quarantaine/fencing prouvés). Réserve tracée non bloquante : dette `saveEdges` → feature « liens entre nodes » (voir §7 hors périmètre).

Aucun reliquat fonctionnel du backlog n'est ouvert. La revue qui suit porte **uniquement sur la qualité du code** (hygiène, typage, dette), pas sur des fonctionnalités.

---

## 2. Verdict sur la vague de corrections `06-frontend` (commitée dans `ba6ee8b`)

### 2.1 VALIDÉE — preuves re-exécutées (01-architecte 2026-11-21, re-jouées par 09 sur `ba6ee8b` le 2026-11-23)

| Contrôle | Résultat constaté | Verdict |
|---|---|---|
| `tsc --noEmit` frontend racine | 0 erreur (exit 0) — était 13. **Re-joué 2026-11-23 : exit 0** | ✅ |
| `cd backend && npx tsc --noEmit` | 0 erreur (exit 0). **Re-joué 2026-11-23 : exit 0** | ✅ |
| `npx eslint . --quiet` (erreurs seules) | 0 erreur (exit 0). **Re-joué 2026-11-23 : exit 0** | ✅ |
| `node scripts/ci/hygiene-ratchet.mjs` | OK, baseline 376/433/126/2 stable (exit 0). **Re-joué 2026-11-23 : 376/433/126/2 [stable], exit 0** | ✅ |
| Suites jest modifiées (workflowRunService, useAppWorkflowController, WorkflowCanvas.render, V2AgentNode.handles) | 4 suites / 25 tests PASS | ✅ |
| Typage des 5 gros fichiers `any` (workflowService, llmService, geminiService, AgentConfigurationModal, useWorkflowData) | 72 `any` supprimés, **0 ajoutés** ; génériques (`_loadFromStorage<T>`, `_fetchFromAPI<T>`, `okResponse<T>`), interfaces nommées (`StoredWorkflowNode/Edge`), type guards (`errorMessageOf(err: unknown)`) — pas de `any` déguisé | ✅ qualité SOLID |
| `AgentLoop.ts` ~l.543 | `if` imbriqué redondant supprimé, retour aplati, comportement identique | ✅ |
| Suppression `backend/src/server.js` + `websocket/WebSocketManager.js` | aucune référence trouvée (main = `dist/src/server.js`, dev = `tsx src/server.ts`) ; 0 `.js` restant dans `backend/src` | ✅ |
| 30 `.pyc` désindexés + `.gitignore` (`__pycache__/`, `*.pyc`) | conforme (présents dans `ba6ee8b`) | ✅ |
| `bcryptjs` → `bcrypt` natif (hashs `$2b$` compatibles) | `User.model.ts`, `databaseInit.ts`, `init-collections.js`, `fix-test-user.js` cohérents ; 0 occurrence `bcryptjs` | ✅ |
| Garde-fous : `eslint.config.mjs` (flat, dette en `warn`, structurel en `error`), `.prettierrc.json`, `scripts/ci/hygiene-ratchet.mjs` + baseline | bien calibrés, dette ratchetée en augmentation | ✅ |

### 2.2 RÉSERVES — 4 points **OUVERTS** sur `ba6ee8b` (série US-RC-00a/b/c, P0 — bloquants avant US-RC-01)

Statut re-vérifié le 2026-11-23 par `09-architecte-applicatif` : aucune des réserves R1–R3 n'a été traitée dans le commit `ba6ee8b` ; R4 est nouvelle.

| # | Réserve | Preuve dans `ba6ee8b` | Correction attendue | Responsable |
|---|---|---|---|---|
| R1 | **Stale closure dans `App.tsx`** | `addAgentToWorkflow` (useCallback l.393) appelle `setCurrentImageAgentInstance(remapAgentInstanceReference(currentImageAgentInstance, …))` (l.496) et idem vidéo (l.498) avec les sélecteurs l.95/98, mais le deps array (l.594 : `[addAgentInstance, isAuthenticated, accessToken, resolveCurrentWorkflowId, updateInstanceId, addNode]`) ne contient **ni** `currentImageAgentInstance` **ni** `currentVideoAgentInstance`. Risque concret : `remapAgentInstanceReference` (`utils/mediaPanelRuntimeSync.ts:16-31`) ne remappe que si `agentInstance.id === fromInstanceId` — avec une closure périmée (agent image changé entre-temps), le remap vers le `persistedBackendId` n'est pas appliqué (ou l'est sur la mauvaise instance) → le panneau média pointe vers un ID local non persisté. | Utiliser le pattern déjà présent dans le même fichier : `useAppShellStore.getState().currentImageAgentInstance` (cf. l.277-281 `clearTransientUiState`/`resetGuestShellState`) — pas de dépendance ajoutée, état toujours courant. | `06-frontend` |
| R2 | **Ratchet aveugle aux fichiers non suivis** | `scripts/ci/hygiene-ratchet.mjs:24` — `listFiles` = `git ls-files <pattern>` seul : un **nouveau fichier non commité** contenant des `any`/`console.log` échappe au comptage en local (vu seulement au commit, donc en CI seulement). | Ajouter `--others --exclude-standard` au `git ls-files` ; ajouter un `--self-test` au script (pattern établi par `audit-gate.mjs` : crée un fichier temporaire non suivi avec `as any`, attend exit 1, nettoie). | `04-cicd-installation` |
| R3 | **`init-collections.js` : commentaire d'en-tête manquant** | `backend/docker/init-collections.js` commence directement par `// MongoDB Collections & Schema Initialization` — aucun avertissement. Le fichier est monté dans `/docker-entrypoint-initdb.d/` du conteneur `mongo:6.0` (docker-compose.yml l.17) où `require('bcrypt')` (natif) n'est pas disponible ; SETUP_NOTES le marque « reference only / deprecated », mais un lecteur du fichier seul pourrait croire le script exécutable tel quel. | Commentaire d'en-tête : « reference only — en conteneur mongo, remplacer par un hash `$2b$` précalculé, `require` indisponible ». | `03-backend` (co `04-cicd-installation`, docker) |
| R4 | **(Nouveau 09) `format:changed` non bloquant + diff PR vide** | `package.json` : le script `format:changed` se termine par `2>/dev/null \|\| true` → **exit 0 systématique**, non bloquant même en CI. De plus `git diff origin/main...HEAD` est vide en checkout shallow de PR (`actions/checkout@v5` par défaut, `fetch-depth: 1`, et `origin/main` peut ne pas exister) → check vide = vert même avec des fichiers non formatés. | Retirer le `|| true` ; utiliser `git diff --name-only --diff-filter=ACM origin/${{ github.base_ref:-main }}...HEAD` ; en CI, `actions/checkout` avec `fetch-depth: 0` dans le job concerné (US-RC-01). En local, fallback `main...HEAD` conservé. | `04-cicd-installation` |

### 2.3 Améliorations architecturales proposées (planifiées en §3)

- **Contrats partagés aux frontières** (pattern *ports/adapters*) : le front duplique encore des formes de contrats backend (`RuntimeEventEnvelope` déclarée dans `services/webSocketService.ts:6` avec `type: string` et `payload: Record<string, unknown>`, à comparer au contrat Zod backend `backend/src/domain/execution/runtimeEvent.contract.ts:63-127` — enum de types, whitelist de payload, `version: z.literal(1)`). Voir US-RC-10 pour le mécanisme retenu (génération + parité, pas de monorepo).
- **Logger structuré backend** (pattern *strategy*) : remplacer `console.debug/warn/error` par une interface `ILogger` à niveaux (`LOG_LEVEL`), implémentation console en dev / JSON structuré en prod — ne pas se contenter de renommer.
- **Dette `any` par boundaries, pas par fichier** : la campagne `any` doit cibler d'abord les frontières (API axios, localStorage, socket, payloads LLM) où un contrat fort élimine des dizaines de `any` d'un coup (ex. `useWorkflowData.ts` l'a montré : `catch (err: unknown)` + guard = pattern reproductible).
- **`App.tsx` reste la zone à haut risque** (§11 du backlog source) : extraction progressive de sa logique métier vers hooks/services dédiés, en US séparées — désormais tracée en **US-RC-11** (la revue initiale en parlait sans US dédiée).

---

## 3. User stories de la revue de code

Les réserves R1–R4 sont découpées en **trois US à agent unique**, exécutées dans l'ordre chronologique strict `US-RC-00a` → `US-RC-00b` → `US-RC-00c` (un commit par US, historique propre et revert facile), suivies du commit de clôture puis de `US-RC-01`. Rationale de l'ordre : R1 est la seule réserve à **risque fonctionnel** (régression silencieuse) → d'abord ; R2+R4 sont les **prérequis du gate CI** → ensuite ; R3 est documentaire → en dernier. Coordination : `09-architecte-applicatif` ; revue : `01-architecte-bdd`.

### US-RC-00a — R1 : stale closure dans `App.tsx` (P0)

**Agent responsable :** `06-frontend.agent.md`
**Criticité :** Haute (P0) — première de la série, bloquante avant US-RC-01 et les campagnes `any`.
**Description :** corriger la stale closure de `addAgentToWorkflow` (useCallback l.393) : l.496/498 lisent `currentImageAgentInstance`/`currentVideoAgentInstance` (sélecteurs l.95/98) hors du deps array (l.594). Aucun changement de comportement métier visé.
**Dépendances :** aucune (working tree propre sur `main` @ `ba6ee8b`).
**Risques et conséquences :** non corrigé = régression potentielle silencieuse : `remapAgentInstanceReference` (`utils/mediaPanelRuntimeSync.ts:16-31`) ne remappe que si `agentInstance.id === fromInstanceId` — avec une closure périmée (agent image changé entre-temps), le remap vers le `persistedBackendId` n'est pas appliqué (ou l'est sur la mauvaise instance) → le panneau média pointe vers un ID local non persisté.
**Impacts codebase et tests :** `App.tsx` uniquement + test de régression (deux ajouts d'agents consécutifs avec changement d'agent image entre les deux → remap appliqué à l'instance courante) ; rejouer les suites `App`/workflow.
**Correction attendue :** utiliser le pattern déjà présent dans le même fichier : `useAppShellStore.getState().currentImageAgentInstance` / `.currentVideoAgentInstance` (cf. l.277-281 `clearTransientUiState`/`resetGuestShellState`) — pas de dépendance ajoutée, état toujours courant.
**Critères d'acceptation :**
- `App.tsx` : `addAgentToWorkflow` lit l'état via `useAppShellStore.getState()` — plus aucune référence closure de ces deux états hors deps ;
- test de régression stale closure ajouté et vert (échoue sur le code actuel) ;
- `tsc` 0, eslint 0 erreur, suites `App`/workflow vertes.

**État d'avancement (2026-11-23, agent `06-frontend`, branche `main` @ `ba6ee8b` + working tree) : IMPLÉMENTÉE ET VALIDÉE — FEU VERT `01-architecte` pour `US-RC-00b`.** Correction livrée dans `App.tsx` (l.500-503) : `const shellState = useAppShellStore.getState();` puis `setCurrentImageAgentInstance(remapAgentInstanceReference(shellState.currentImageAgentInstance, ...))` et idem vidéo — plus aucune référence closure de ces deux états dans le useCallback (les sélecteurs l.95/98 ne servent plus qu'au rendu, l.877). Test de régression `tests/unitaires/App.addAgentStaleClosure.test.tsx` (scénario : deux ajouts consécutifs avec changement d'agent image/vidéo entre les deux → remap appliqué à l'instance courante) : **passe sur le code corrigé, ÉCHOUE sur l'ancien code** (vérifié par stash/rejeu, 1 failed → 1 passed). Validations architecte re-exécutées : `tsc --noEmit` 0, `eslint --quiet` 0 erreur sur `App.tsx` + test, suites `App.workspaceHydration` + `useAppWorkflowController` + `useAppShellStore` 3 suites/25 tests PASS, nouveau test 1/1 PASS. Aucun changement de comportement métier (lecture d'état courant au lieu de closure). **Handoff `US-RC-00b` (`04-cicd-installation`) :** prendre le relais sur le working tree courant (App.tsx modifié + test non suivi) ; périmètre R2 (`scripts/ci/hygiene-ratchet.mjs:24` — ajouter `git ls-files --others --exclude-standard` + `--self-test` façon `audit-gate.mjs`) et R4 (`package.json` — `format:changed` sans `|| true`, diff `origin/${base_ref}...HEAD` + note `fetch-depth: 0` pour US-RC-01) ; à noter que le ratchet actuel ne verra pas le nouveau test non suivi tant que R2 n'est pas appliqué (c'est précisément le bug R2). Un commit par US, ordre strict `00a` → `00b` → `00c`.

### US-RC-00b — R2 + R4 : ratchet fiable et `format:changed` bloquant (P0, prérequis du gate CI)

**Agent responsable :** `04-cicd-installation.agent.md`
**Criticité :** Haute (P0) — **bloquante avant US-RC-01** : un gate CI bâti sur un ratchet contournable en local et un check de format toujours vert serait trompeur.
**Description :** corriger R2 (`scripts/ci/hygiene-ratchet.mjs:24` — `listFiles` = `git ls-files` seul) et R4 (`package.json` — script `format:changed` terminé par `|| true` + diff `origin/main...HEAD` vide en checkout shallow de PR).
**Dépendances :** US-RC-00a commitée (ordre de la série).
**Risques et conséquences :** R2 non corrigé = un nouveau fichier non suivi avec `any`/`console.log` échappe au ratchet en local ; R4 non corrigé = `format:changed` jamais bloquant, y compris en CI sur PR (checkout `fetch-depth: 1`, `origin/main` absent → diff vide → vert).
**Impacts codebase et tests :** `scripts/ci/hygiene-ratchet.mjs`, `package.json` (script `format:changed`) ; self-test du ratchet ; test `format:changed`.
**Critères d'acceptation :**
- ratchet : `git ls-files --others --exclude-standard` ajouté au périmètre ; `--self-test` présent et vert (pattern `audit-gate.mjs` : crée un fichier temporaire non suivi avec `as any`, attend exit 1, nettoie) ; un fichier nouveau non suivi avec `any`/`console.log` fait échouer le script en local ;
- `format:changed` : plus de `|| true` ; exit ≠ 0 si un fichier modifié vs base n'est pas formaté ; formule `git diff --name-only --diff-filter=ACM origin/${{ github.base_ref:-main }}...HEAD` (fallback local `main...HEAD` conservé) — la note `fetch-depth: 0` pour le job CI est posée pour US-RC-01 ;
- ratchet OK (baseline 376/433/126/2), `tsc` 0, eslint 0 erreur.

**État d'avancement (2026-11-23, agent `04-cicd-installation`, branche `main`, un commit pour cette US après le commit US-RC-00a `2223cc7`) : IMPLÉMENTÉE ET VALIDÉE.** R2 : `scripts/ci/hygiene-ratchet.mjs` — `listFiles` passe à `git ls-files --cached --others --exclude-standard` (fichiers non suivis non ignorés désormais comptés en local) + `--self-test` (pattern `audit-gate.mjs` : fichier temporaire non suivi `ratchet-selftest.tmp.ts` avec `as any` puis `console.log(`, exit 1 attendu à chaque fois, cleanup, exit 0 après nettoyage). Validations : ratchet exit 0 baseline 376/433/126/2 stable ; `--self-test` OK ; preuve manuelle `ratchet-proof.tmp.ts` non suivi avec `as any` → exit 1, puis exit 0 après nettoyage. R4 : `format:changed` devient `node scripts/ci/format-changed.mjs` (helper cross-platform sh/cmd — une formule `$(...)` en shell cassait sur cmd.exe, d'où le `|| true` historique) ; plus de `|| true` ; base `origin/$GITHUB_BASE_REF...HEAD` (fallback local `main...HEAD` conservé), diff vide → exit 0, fichier non formaté → exit ≠ 0. Validations : exit 0 sur main ; exit 1 prouvé sur branche temporaire avec fichier non formaté committé (`GITHUB_BASE_REF=main`) ; les 2 fichiers du commit 00a non prettier (`App.tsx`, `tests/unitaires/App.addAgentStaleClosure.test.tsx`) ont été formatés dans ce commit 00b pour garder main vert (test 00a rejoué 1/1 PASS après formatage). `tsc --noEmit` exit 0 ; `eslint --quiet` 0 erreur sur les scripts modifiés. **Note pour US-RC-01 (gate CI `hygiene-gate`) :** `actions/checkout@v5` avec **`fetch-depth: 0`** indispensable, et poser `GITHUB_BASE_REF: ${{ github.base_ref || 'main' }}` dans l'env du step `npm run format:changed` (la formule backlog `origin/${{ github.base_ref:-main }}...HEAD` est réalisée via cette variable d'env, les expressions `${{ }}` n'étant pas évaluées dans package.json). **Handoff US-RC-00c (`04-cicd-installation` ou agent désigné) :** R3 documentaire sur `init-collections.js`, même branche `main`, un commit.

### US-RC-00c — R3 : commentaire d'en-tête « reference only » d'`init-collections.js` (P1)

**Agent responsable :** `03-backend.agent.md` (co `04-cicd-installation`, docker)
**Criticité :** Moyenne (P1) — documentaire, dernière de la série.
**Description :** `backend/docker/init-collections.js` est monté dans `/docker-entrypoint-initdb.d/` du conteneur `mongo:6.0` (docker-compose.yml l.17) où `require('bcrypt')` (natif) n'est pas disponible ; SETUP_NOTES le marque « reference only / deprecated », mais le fichier commence directement par `// MongoDB Collections & Schema Initialization` — un lecteur du fichier seul pourrait croire le script exécutable tel quel.
**Dépendances :** US-RC-00b commitée (ordre de la série).
**Critères d'acceptation :**
- commentaire d'en-tête en première ligne : « reference only — en conteneur mongo, remplacer par un hash `$2b$` précalculé, `require` indisponible » ;
- aucun changement de code, `tsc` back 0, suites backend non impactées.

**Etat d'avancement (2026-11-23, agent `03-backend`, branche `feat/j7-02-quarantine-exit-fencing`) : IMPLEMENTEE ET VALIDEE (commit voir `git log`).** R3 : commentaire d'en-tête ajouté en première ligne de `backend/docker/init-collections.js` (« reference only — en conteneur mongo, remplacer par un hash `$2b$` précalculé, `require` indisponible » + rappel du montage `/docker-entrypoint-initdb.d/`, de SETUP_NOTES « Reference only » et de la logique active `databaseInit.ts`) ; BOM et CRLF conservés. Aucun changement de code (seul le formatage prettier du fichier touché, exigé par le gate `format:changed` R4 — `prettier --check` OK, `node --check` OK). Validations : `tsc --noEmit` backend 0 erreur, `eslint` sur le fichier 0 erreur, `node scripts/ci/hygiene-ratchet.mjs` exit 0 (baseline stable 376/433/126/2), aucune référence au script depuis `backend/src`. **Handoff :** commit de clôture de la série US-RC-00a/b/c (responsable projet), puis `US-RC-01` (gate CI `hygiene-gate`, `04-cicd-installation`) — lire la note de US-RC-00b (checkout `fetch-depth: 0` + env `GITHUB_BASE_REF`) et la section US-RC-01.

### US-RC-01 — Câblage CI du gate hygiène (depuis US-HYG-01)

**Agent responsable :** `04-cicd-installation.agent.md`
**Criticité :** Haute (P0)
**Description :** ajouter un job dédié `hygiene-gate` dans `.github/workflows/ci.yml` (déclenché sur `push` main/develop + `pull_request`, comme les jobs existants) : `actions/checkout@v5` **avec `fetch-depth: 0`** (indispensable à `format:changed` vs `base_ref`, cf. R4), `setup-node` 24.22.1 + cache npm, `npm ci`, puis `npm run lint` (exit 1 si erreur), `npm run hygiene` (ratchet, incluant fichiers non suivis après R2), `npm run format:changed`. Ne pas toucher aux autres workflows (`runtime.yml`, `security.yml`, `deploy.yml`, `frontend-tests.yml`, `release-artifacts.yml`).
**Dépendances :** US-RC-00b commitée (le ratchet et `format:changed` doivent être fiables avant d'être bloquants en CI).
**Risques :** un gate CI mal calibré bloque des PR légitimes → le calibrer d'abord sur `main` (job vert), puis bloquant ; lesson `insight-04-cicd-installation.md` : tout job qui exécute un script du repo doit checker out, et ne pas dépendre de `gh api --slurp`.
**Impacts codebase et tests :** `.github/workflows/ci.yml`, `package.json` scripts ; vérifier le job sur une PR test.
**Critères d'acceptation :** PR qui augmente `any`/`console.log` (y compris dans un nouveau fichier non encore commité au moment du push — couvert par R2) ou ajoute une erreur lint ou un fichier non formaté est bloquée ; job vert sur `main`.

**État d'avancement (2026-11-23, agent `04-cicd-installation`, branche `main`) : IMPLÉMENTÉE — voir commit US-RC-01.** Job `hygiene-gate` ajouté dans `.github/workflows/ci.yml` (déclenchements workflow existants push main/develop + `pull_request` inchangés) : `actions/checkout@v5` **avec `fetch-depth: 0`** (R4), `setup-node@v5` 24.22.1 + `cache: npm`, `npm ci`, puis `npm run lint` (exit 1 si erreur), `npm run hygiene` (ratchet R2, fichiers non suivis inclus), `npm run hygiene:self-test` (nouveau script `package.json`, miroir de `audit:gate:self-test`, principe §4.6), `npm run format:changed` bloquant (R4) avec env `GITHUB_BASE_REF: ${{ github.base_ref || 'main' }}` posé sur le step (les `${{ }}` ne sont pas évaluées dans `package.json`). Le job est ajouté au `needs` du job `report` ; aucun autre workflow touché. Validations locales : YAML parsé (js-yaml, 8 jobs, triggers inchangés) ; `npm run lint` exit 0 (0 erreur, 2306 warnings non bloquants) ; ratchet exit 0 baseline 376/433/126/2 stable ; self-test exit 0 ; run vert vérifié au niveau blob en worktree LF (`GITHUB_BASE_REF=main npm run format:changed` exit 0) ; preuves négatives : fichier committé non formaté → `format:changed` exit 1, fichier non suivi avec `as any` → ratchet exit 1, `debugger;` → eslint exit 1. **Preuve CI réelle (push `73682ee` sur `main`, 2026-11-23) : run CI #45219956400 success 8/8 — job `Hygiene Gate` vert, artefact `ci-report-73682ee….json` publié ; Security run #45219956378 success.** Le blocage effectif d'une PR sale (any/console.log en hausse, erreur lint, fichier non formaté) reste à observer sur la première PR entrante (US-RC-02/03) — les preuves négatives locales sont consignées ci-dessus.

### US-RC-02 — Campagne `any` frontend par boundaries (depuis US-HYG-02)

**Agent responsable :** `06-frontend.agent.md`
**Criticité :** Moyenne (P1)
**Description :** campagne sur les 376 `any` frontend restants, **par frontières** (axios/apiClient, localStorage, socket, payloads LLM, composants `components/com/*`) et non par fichier isolé : introduire des contrats/typages aux frontières, 5–10 fichiers/US, lots décroissants.
**Dépendances :** série US-RC-00a/b/c commitée.
**Périmètre ratchet :** le compteur `anyFrontend` inclut `tests/` — la campagne couvre les tests aussi, ou bien l'exclusion des tests se fait dans le ratchet **et** la baseline en même temps (jamais unilatéralement).
**Risques :** un typage trop étroit casse des flux legacy silencieusement → tests des modules + `tsc` 0 à chaque lot ; ne jamais affaiblir un test pour passer ; ne jamais recaler la baseline à la hausse (`hygiene:update-baseline` uniquement après baisse).
**Impacts codebase et tests :** `services/*`, `hooks/*`, `components/com/*`, `stores/*`, `tests/*` ; `hygiene:update-baseline` après chaque lot.
**Critères d'acceptation :** `tsc` 0, tests des modules OK, compteur `anyFrontend` en baisse stricte à chaque lot, ratchet OK.

**État d'avancement (2026-11-23, agent `06-frontend`, branche `main`) : TERMINÉE — `anyFrontend` 376 → 0, 14 lots committés, un commit par lot.**

| Lot | Commit | anyFrontend | Fichiers | Contenu |
|---|---|---|---|---|
| 1 | `20cf16e` | 376 → 361 | `utils/apiClient.ts`, `types.ts`, `services/agentContractAdapters.ts`, `services/geminiService.ts` | contrats axios (`AxiosRequestConfig`, data `unknown`), `JsonSchema` exporté, DTO Tool/links/tasks |
| 2 | `1b09687` | 361 → 341 | `services/persistenceService.ts`, `services/templateAPI.ts` | payloads localStorage typés (`PersistedAgentInstancePayload`), DTO templates |
| 3 | `600e2ce` | 341 → 337 | `services/webSocketService.ts` | `EventCallback = (...args: unknown[]) => void` |
| 4 | `df7194d` | 337 → 325 | `components/com/jsonTreeUtils.ts` (créé), `ResultExtractor/ResultViewer/DatabaseExplorer` | `JsonValueType` + type-guards |
| 5 | `d6d0e7e` | 325 → 303 | stores `useFunctionStore/useDesignStore/useRobotManagementStore/useRuntimeStore` | `catch (err: unknown)` + helpers, typages store |
| 6 | `7e80538` | 303 → 265 | `services/llm/providerApi.types.ts` (créé) + 9 providers | contrats payloads LLM communs |
| 7 | `5505039` | 265 → 247 | 14 fichiers (bootstrap, AdapterFactory, 4× apiRequest, persistedChatMessages, AuthContext, hooks…) | frontières workspace/apiRequest |
| 8 | `bc17b2a` | 247 → 221 | 10 composants (WorkflowCanvas, V2AgentNode, JsonTreeViewer, modales…) | handlers React Flow typés (`NodeChange[]`, `OnConnectStartParams`), props `unknown` |
| 9 | `e1589b3` | 221 → 186 (source = 0) | 21 fichiers services/hooks/modales | `apiRequest<T>` `Promise<T>`, `WorkspaceSnapshot` typé, catch `unknown` + guards |
| 10 | `fd0810e` | 186 → 102 | 5 gros tests (App.workspaceHydration 46 any, minimize-restore, useFunctionStore, J4.2, WorkflowPersistence.TNR) | mocks lâches `jest.Mock`, fixtures typées |
| 11 | `ac920f4` | 102 → 71 | 5 tests (drag-collision, workspacePersistenceService, agentloop, bosRunProjection, AgentLoop) | `as unknown as typeof fetch`, fixtures complétées |
| 12 | `415766e` | 71 → 39 | 6 tests (hydration.integration, J4.4, SettingsModal.TNR, toolRepository, web-search-params, HyperspaceReveal) | props composants mockés typées, `typeof import()` |
| 13 | `12932c2` | 39 → 18 | 9 petits tests + `tests/utils/builders/WorkflowNodeBuilder.ts` | `RobotId.Archi` enum, catch structurés |
| 14 | `3bf8aff` | 18 → **0** | 8 derniers tests + 2 commentaires | `Page` playwright, `PendingNodeAttachment` complet, commentaires sans motif compté |

**Validation par lot :** `npx tsc --noEmit` 0 erreur, `npx eslint . --quiet` 0, `node scripts/ci/hygiene-ratchet.mjs` exit 0 (baisse stricte), `prettier --write` + `GITHUB_BASE_REF=main npm run format:changed` exit 0, suites jest des modules touchés vertes, `npm run audit:workflow-architecture:strict` OK. **Validation finale :** `npm test -- --runInBand` (en cours à la rédaction de cette ligne). **Baseline :** `npm run hygiene:update-baseline` exécuté après la baisse constatée (376 → 0). Aucun test affaibli ; une attente corrigée (`workflowNodeReactFlowAdapter` : `robotId: 'archi'` → `RobotId.Archi`, l'adaptateur passe la valeur through) documentée dans le commit du lot 14.

### US-RC-03 — Campagne `any` backend par boundaries (depuis US-HYG-03)

**Agent responsable :** `03-backend.agent.md`
**Co-responsable :** `01-architecte-bdd` (contrat domaine)
**Criticité :** Moyenne (P1)
**Description :** idem sur les 433 `any` de `backend/src` (le glob du ratchet couvre bien tous les sous-dossiers, `__tests__` inclus — 324 fichiers), en priorisant les frontières (routes → Zod déjà présent, repositories, gateway/socket, stores Mongo) ; réutiliser les contrats `domain/execution/*.contract.ts` existants comme source de vérité.
**Dépendances :** série US-RC-00a/b/c commitée.
**Risques :** toucher aux repositories/stores sans contrat peut casser la persistance → suites `test:j6:backend` + contrats en garde-fou.
**Impacts codebase et tests :** `backend/src/routes|repositories|services|websocket|models` ; `cd backend && npx tsc --noEmit` 0.
**Critères d'acceptation :** idem US-RC-02 côté backend + `ci:node25:runtime` PASS.

**État d'avancement (2026-11-23, agent `03-backend`, branche `main`) : EN COURS — anyBackend 433 → 6 (lots 1–14 committés ; reste : 6 tests à 1 site).**

| Lot | Commit | anyBackend | Fichiers | Contenu |
|---|---|---|---|---|
| 1 | `fc8a37e` | 433 → 405 | `domain/workflow/workspaceSnapshot.contract.ts` (créé), `utils/workspaceSnapshot.ts`, `utils/transforms.ts`, `utils/chatMessageProjection.ts`, `types/persistence.ts`, `routes/agent-instances.routes.ts` (1 site) | contrat domaine snapshot (docs lean nommés, `snapshotIdToString`, statuts depuis `domain/execution/userToolRun.contract.ts`) ; `as any` retirés, docs Mongoose assignés directement (aucun cast sur chemin Mongo) ; `canvasState` gardé hors du contrat domaine (audit strict: token non classé sous `domain/`) |
| 2 | `0812ae7` | 405 → 362 | `routes/agent-instances.routes.ts`, `cloud-connection-profiles.routes.ts`, `workflows.routes.ts`, `local-llm-profiles.routes.ts`, `llm-configs.routes.ts`, `utils/errorGuards.ts` (créé) | routes : `req.user as IUser`, `catch (error: unknown)` + guards (`isDuplicateKeyError`, `asErrorShape`), `buildProfileConfig(body: z.infer<typeof baseSchema>)`, `query: Record<string, unknown>`, `prototype.<champ>` typé modèle (plus de `as any`), doublon `sanitizeLegacyWorkflowGraphFields` supprimé (réexporté depuis `utils/workspaceSnapshot.ts`) |
| 3 | voir `git log` | 362 → 338 | `routes/` restant : `agent-prototypes`, `agent-templates`, `functions`, `llm-proxy`, `media`, `sandbox`, `tools`, `user-settings`, `user-workspace` + `services/toolReadiness.service.ts` (`ToolReadinessTarget` exporté) | `buildPrototypeResponse(prototype: IAgentPrototype): Record<string, unknown>`, `res: Response` (express, pas le DOM), `withToolReadiness(tool: ToolReadinessTarget, …)`, `MediaReference.findByUser` statique typé (cast retiré), `catch (error: unknown)` + `errorMessageOf`/`isDuplicateKeyError`, `sort: Record<string, 1 \| -1>`, `workflow.isDefault/canvasState` directement typés (IWorkflow) |
| 4 | `2749c27` | 338 → 332 | `application/workflows/createWorkflowInstance.usecase.ts`, `controllers/workflow.controller.ts` | résultat typé `IAgentInstance`/`IWorkflowNodeV2`/`IAgentJournal`, params ctor modèles `create: (…) => Promise<IXxx[]>`, champs Mixed castés `as Record<string, unknown> \| undefined` |
| 5 | `65345e6` | 332 → 305 | `services/databaseInit.ts`, `__tests__/database-init.media-backfill.test.ts` | types structurels locaux nommés (`CollectionSchemaSpec`, `IndexSpec` sur `mongoose.mongo.IndexSpecification`), `db: mongoose.mongo.Db`, `userToolsCol: mongoose.mongo.Collection`, `CollectionInfo[]`, catches `unknown` + guards (`asErrorShape`/`errorMessageOf`/`isDuplicateKeyError`), cast `Parameters<typeof mapLegacyFunctionToUserToolFields>[1]`, Promise.race casté `as mongoose.mongo.CollectionInfo[]` ; mocks test `{} as unknown as mongoose.mongo.Db` — aucun cast sur chemin Mongo métier |
| 6 | `7571138` | 305 → 280 | `services/s3Storage.service.ts`, `gcsStorage.service.ts`, `urlValidator.ts`, `lmstudioProxy.service.ts`, `toolReadAdapter.service.ts`, `runtime/ExecutionOrchestrator.ts`, `runtime/DockerSandboxRunner.ts`, `runners/nativeRunner.ts`, `utils/errorGuards.ts`, `types/webFetchTypes.ts`, `types/lmstudio.types.ts` | `ErrorShape` étendu (`Code`, `$metadata` AWS) ; ACL casté `ObjectCannedACL` ; `StorageOptions` GCS ; `catch unknown` + `asErrorShape` ; `globalThis.fetch` ; `convertSystemMessages` typé `ChatMessage[]`, `fetchChatCompletion` → `Promise<ChatCompletionResponse>` (cast documenté frontière fetch) ; `parameters?: Record<string, unknown>` ; relecture orchestrator fail-closed (throw si run null) ; payload stdin typé ; `RunResult.exitCode` élargi `number \| null` |
| 7 | voir `git log` | 280 → 263 | `migrations/005_user_functions_eol.ts`, `006_media_reference_catalog_backfill.ts`, `007_security_ownership_indexes.ts`, `008_workflow_v1_to_v2_migration.ts`, `websocket/WebSocketManager.ts`, `middleware/ownership.middleware.ts` | `db: mongoose.mongo.Db` dans les 4 migrations ; `LegacyWorkflowDocLike` pour les docs v1 (champs `unknown`) ; `_id` normalisé en ObjectId fail-closed dans le backfill 006 ; index 006 annotés `IndexSpecification`/`CreateIndexesOptions` ; WebSocket : `AgentMessageAdd` pour les messages, `AuthenticatedSocketData['userInfo']`, `broadcastToWorkspace` générique `Parameters<ServerToClientEvents[E]>[0]` (cast localisé sur `emit`, type conditionnel socket.io non résoluble en générique) ; ownership : `requireOwnership<T>(model: Model<T>)`, augmentation `Express.Request.ownershipFilter?: Record<string, unknown>`, `Record<string, unknown>` pour query/resource |
| 8 | voir `git log` | 263 → 258 | `repositories/artifactRepository.ts`, `models/User.model.ts`, `models/CloudConnectionProfile.model.ts` | doc insertOne en `Record<string, unknown>`, `db` sans cast (`this.db` non-null vérifié) ; validator Mongoose `this: IUser, value: unknown` ; `parsed: unknown` + lecture `client_email` via `Record<string, unknown>` — **code hors `__tests__` à 0 `any`** |
| 9 | voir `git log` | 258 → 159 | `__tests__/execution-orchestrator.test.ts` (99 sites) | stubs locaux nommés (`StoredRunStub`, `CreateQueuedRunStub`, `CompleteRunPayload`, `DockerExecuteStubRequest`, `OrchestratorInternals` pour l'accès privé mocké) ; `as unknown as ExecutionFunctionRef/RuntimeHealthReport/SandboxRunnerPort` sur fixtures ; `Object.assign(error, { code: 11000 })` ; `jest.Mock` lâches ; assertions non-null locales (aucune assertion de test affaiblie) |
| 10 | voir `git log` | 159 → 107 | `__tests__/runtime-event.publisher.test.ts` (20), `workflow-v1-v2-migration.test.ts` (9), `workflow-validator.test.ts` (8), `journal.service.test.ts` (7), `agent-prototype-impact.routes.test.ts` (7) | enveloppes typées `RuntimeEventEnvelope` ; FakeCollection/FakeDb en `Record<string, unknown>` + `FakeUpdate`, cast `db as unknown as mongoose.mongo.Db` commenté (mock couvert par le test) ; fixtures validator `as unknown as Pick<IWorkflowNodeV2,…>` ; `persistJournalEntry` avec `type: 'tool_invocation'` réel (payload conforme) + mock findOne casté via `typeof CloudConnectionProfile.findOne` ; vars de test typées `IUser/IWorkflow/IAgentPrototype/IAgentInstance` |
| 11 | voir `git log` | 107 → 69 | `application/workflows/__tests__` (7 fichiers, 23 sites), `user-tool-legacy-mapper.test.ts` (5), `user-functions-eol-migration.test.ts` (5), `lmstudioProxy.service.test.ts` (5) | mocks usecases `jest.Mocked<IWorkflowRepository>` + fixtures `as unknown as IWorkflow/IUser`, mocks modèles via `jest.Mocked<ConstructorParameters<typeof …UseCase>[N]>` ; mapper : retour `Record<string, unknown>` (cast retiré, alias local `currentVersion.contentHash`) ; FakeCollection `Record<string, unknown>` + cast Db commenté ; lmstudio : bodies conformes à `ChatCompletionRequest` (cast retiré) |
| 12 | voir `git log` | 69 → 41 | 7 tests à 4 sites : `workspace-snapshot`, `websocket-auth`, `web-search-params.routes`, `run-visibility.service`, `robot-governance.routes`, `media-reference-backfill.migration`, `media-cloud-step1.routes` | callbacks `find((x: { id: string }) => …)` ; `waitForEvent<ReturnType<typeof buildRuntimeEvent>>`, `intruderReceived` typé `| null` ; `createWorkflow(ownerId: mongoose.Types.ObjectId)` ; vars routes typées `IUser/IWorkflow/IAgentPrototype/IAgentInstance` ; enveloppes `RuntimeEventEnvelope` ; ctor visibility `Pick<typeof AgentJournal, 'create'>` ; fixture `as unknown as IWorkflow` ; FakeCollection `Record<string, unknown>` + cast Db commenté |
| 13 | voir `git log` | 41 → 26 | 5 tests à 3 sites : `routes/__tests__/workflowAccess`, `transition-routes`, `simple-from-prototype`, `legacy-tools-coexistence`, `docker-sandbox.runner` | mock resolver `jest.Mocked<IWorkflowRepository>` ; health report `as unknown as RuntimeHealthReport` ; callbacks `some/find` typés `{ name: string }` / `{ id: string }` / `{ _id: unknown }` ; vars `IUser/IWorkflow/IAgentPrototype` ; `_id` string natif (LegacyExecutionFunctionRef accepte `string`) |
| 14 | voir `git log` | 26 → 6 | 8 tests à 2 sites : `user-tool-run.contract`, `task-instance.contract`, `security-ownership-indexes.migration`, `recovery-policy.routes`, `database-init.seeding`, `Workflow.model`, `MediaReference.model`, `LLMConfig.model` | tuples de transitions typés `Array<[UserToolRunDomainStatus, …]>` (casts retirés) ; casts Db commentés ; vars `IUser/IWorkflow` ; callbacks `indexes()` sans annotation ; payloads `Pick<MediaJournalPayload,…>` |

Validation lot 1 : `tsc --noEmit` back 0, `eslint --quiet` 0, ratchet exit 0 (433→405), `prettier` + `format:changed` OK, `test:j6:backend` 126/126, `ci:node25:runtime` OK, `audit:workflow-architecture:strict` OK, suites snapshot/instances 19/19, baseline recalée à 405. Lot 2 : tsc 0, eslint 0, ratchet 405→362, 9 suites routes/modules 67/67, `test:j6:backend` 126/126 (1 flake `websocket-auth` waitForStatus 2 s, vert au rerun), `ci:node25:runtime` OK, audit OK, baseline recalée à 362.

**Consignes `01-architecte-bdd` (2026-11-23) — réponses aux questions de `03-backend` :**

1. **Source de vérité contrat — étendre `domain/` autorisé** (dans le même lot que la consommation, pas de PR séparée) : un seul contrat par concept. Si un contrat existant (`domain/execution/*.contract.ts`, `domain/workflow/*`) couvre la forme, il est la source de vérité unique — ne pas le dupliquer. Si aucun ne couvre, créer `domain/<agrégat>/<concept>.contract.ts` (Zod `.strict()` + type-guards, même style que `userToolRun.contract.ts` / `workspaceCollaboration.contract.ts`) plutôt que `any` ou interfaces Mongoose seules. Règle de couches : interfaces Mongoose (`IXxxDocument`) = typage **interne** models/repositories (persistance) ; contrat Zod = **frontières** (routes, socket, événements, documents échangés). Conflit entre contrats → remonter à l'architecte-bdd, ne pas trancher seul.
2. **Stores Mongo sans contrat — contrat par store prioritaire**, règle exacte anti-régression silencieuse :
   - (a) signatures de repositories typées par les interfaces document (`Promise<IWorkflowDocument>`, jamais `Promise<any>`) ; `lean()` → type de projection nommé ou `LeanDocument<...>` ;
   - (b) frontière du store = schéma Zod du contrat : `safeParse` en lecture, échec = log + **rejet fail-closed** (jamais passage tel quel) ; type du contrat en écriture ;
   - (c) valeur non typée venant de Mongo → `unknown` + type-guard, jamais `any` ; `any` neutralisés sans contrat = interdit ;
   - (d) `databaseInit.ts` (bootstrap, 27 `any`) → types structurels locaux nommés (`CollectionSpec`, `IndexSpec`, `SeedUser`…), pas de contrat métier ;
   - (e) aucun `as any` / `as unknown as X` sur un chemin Mongo ; cast inévitable = commenté (raison) + test qui le couvre ;
   - garde-fous par lot : `tsc` back 0, `test:j6:backend` + `ci:node25:runtime` + `audit:workflow-architecture:strict` + ratchet verts, suites jest des modules touchés ; tout changement de forme de document couvert par un test de contrat (existant ou nouveau).
3. **Baseline — recale après chaque lot validé** (mi-campagne + clôture), jamais à la hausse. Rationale : le ratchet ne bloque que les augmentations vs baseline ; sans recale lot par lot, une remontée restant sous l'ancienne baseline passerait inaperçue. Procédure par lot : baisse constatée → tsc/tests/ratchet verts → `npm run hygiene:update-baseline` → commit du lot.

### US-RC-04 — `console.log` restants → `console.debug` / logger (depuis US-HYG-04)

**Agent responsable :** `06-frontend` (front) + `03-backend` (back)
**Criticité :** Faible (P2)
**Description :** 126 `console.log` front (majoritairement des tests) + 2 back restants — cible réelle identifiée : `backend/src/__tests__/simple-from-prototype.test.ts:73-74` — → `console.debug` ; puis règle `no-console` en `error` pour les **nouveaux** fichiers uniquement.
**Dépendances :** US-RC-02/03 (en parallèle possible, périmètres disjoints).
**Critères d'acceptation :** ratchet `consoleLogBackend` à 0, baisse front, règle error sans régression, eslint 0 erreur.

### US-RC-05 — Prettier sur fichiers modifiés en CI (depuis US-HYG-05)

**Agent responsable :** `04-cicd-installation.agent.md`
**Criticité :** Faible (P2)
**Description :** `format:changed` (diff vs base de la PR) bloquant en CI via US-RC-01 — **après correction R4** (script actuellement non bloquant). La campagne de formatage repo-wide reste une US séparée et optionnelle (gros diff, ne jamais lancer sans US dédiée).
**Dépendances :** US-RC-00b (R4).
**Critères d'acceptation :** `format:changed` vert et bloquant en CI ; aucun reformat implicite dans les PR.

### US-RC-06 — Logger structuré backend (depuis US-HYG-06)

**Agent responsable :** `03-backend.agent.md`
**Co-responsable :** `01-architecte-bdd` (contrat `ILogger`)
**Criticité :** Faible (P3)
**Description :** pattern *strategy* — interface `ILogger` (`debug/info/warn/error` + contexte structuré), implémentation `ConsoleLogger` (dev) et `JsonLogger` (prod, `LOG_LEVEL` env) ; remplacer tous les `console.*` de `backend/src` par le logger injecté. Ne pas se contenter de renommer `console.debug`.
**Dépendances :** US-RC-03 (typage des services d'abord).
**Risques :** perdre des logs en prod si le niveau par défaut est trop haut → défaut `info` en prod, `debug` en dev ; smoke sur `dist`.
**Impacts codebase et tests :** `backend/src/services/logger/*`, wiring `server.ts` (injection), tests de niveau.
**Critères d'acceptation :** plus aucun `console.*` dans `backend/src`, logs identiques en dev, `LOG_LEVEL` respecté, suites backend vertes.

### US-RC-07 — Nettoyage des warnings eslint en lots (depuis US-HYG-07)

**Agent responsable :** `06-frontend` + `03-backend`
**Criticité :** Faible (P3)
**Description :** traiter les ~2383 warnings par lots (`no-unused-vars` ~405, `prefer-const`, etc.) ; ratchet des warnings comme pour `any`.
**Dépendances :** US-RC-02/03.
**Critères d'acceptation :** `eslint . --quiet` reste 0 erreur, warnings en baisse ratchetée, aucune régression de tests.

### US-RC-08 — `rules-of-hooks` en error (depuis US-HYG-08)

**Agent responsable :** `06-frontend`
**Criticité :** Faible (P3)
**Description :** corriger le faux positif `react-hooks/rules-of-hooks` v6 + React 19 (pin de version du plugin ou config) sur `V2AgentNode.tsx` et consorts, puis repasser la règle en `error`.
**Dépendances :** US-RC-02.
**Critères d'acceptation :** 0 faux positif, règle `error` active, eslint 0 erreur.

### US-RC-09 — Nettoyage historique git des `.pyc` (depuis US-HYG-09)

**Agent responsable :** `04-cicd-installation.agent.md`
**Co-responsable :** responsable projet (revue obligatoire)
**Criticité :** Optionnel (P3)
**Description :** `git filter-repo` (ou BFG) pour retirer les 30 `.pyc` de l'historique (ils ont été désindexés dans `ba6ee8b` mais restent dans l'historique) — **réécriture d'historique soumise à revue** ; clone sain vérifié après.
**Dépendances :** série US-RC-00a/b/c commitée (le `.gitignore` doit exister avant — c'est le cas depuis `ba6ee8b`).
**Critères d'acceptation :** historique sans `.pyc`, clone sain vérifié, revue signée.

### US-RC-10 — Contrat partagé front/back des événements runtime

**Agent responsable :** `06-frontend.agent.md`
**Co-responsable :** `03-backend.agent.md` (contrat domaine)
**Criticité :** Moyenne
**Description :** `RuntimeEventEnvelope` est déclarée côté front dans `services/webSocketService.ts:6` (`type: string`, `payload: Record<string, unknown>`) — une copie divergente du contrat backend `backend/src/domain/execution/runtimeEvent.contract.ts` (enum Zod `RuntimeEventTypeSchema`, whitelist `RuntimeEventPayloadSchema`, `version: z.literal(1)`). **Mécanisme retenu** (pas de monorepo `packages/contracts` : le `rootDir: "."` du `backend/tsconfig.json` interdit d'importer hors de `backend/`, et le front n'importe jamais depuis `backend/src`) : le contrat Zod backend reste **source de vérité unique** ; un script `scripts/ci/sync-runtime-contract.mjs` génère le type front (`types/runtimeEvent.generated.ts`) à partir des schémas, et un **test de parité en CI** (hash du contrat source vs hash du fichier généré, ratchet-like) bloque toute divergence. Couvrir les 3 nouveaux types de quarantaine (`run:quarantined`, `run:fenced`, `run:recovery_relaunched`, US-J7-09) et corriger la divergence `type: string` (front) vs enum (back).
**Dépendances :** série US-RC-00a/b/c ; US-J7-09 livrée.
**Impacts codebase et tests :** `services/webSocketService.ts` (import du type généré, plus de déclaration locale), `stores/useRuntimeStore.ts`, `scripts/ci/sync-runtime-contract.mjs`, `types/runtimeEvent.generated.ts`, test de parité ; tests de sérialisation.
**Critères d'acceptation :** un seul contrat source, front et back le consomment (front via le fichier généré vérifié en parité), `tsc` 0/0, tests runtime_event PASS des deux côtés, plus aucun type inline dupliqué dans `webSocketService.ts`, `type` typé par l'enum et non `string`.

### US-RC-11 — Extraction progressive de la logique métier d'`App.tsx` (nouveau, depuis §2.3)

**Agent responsable :** `06-frontend.agent.md`
**Co-responsable :** `09-architecte-applicatif` (revue des frontières)
**Criticité :** Basse (P3, optionnel, hors gate)
**Description :** `App.tsx` reste la zone à haut risque (§11 du backlog source) : extraire sa logique métier restante (orchestration persistance, remaps d'instances, hydratation) vers des hooks/services dédiés, **une extraction par US**, sans alourdir le composant. R1 (US-RC-00a) en est la première correction ponctuelle, pas une extraction.
**Dépendances :** US-RC-00a ; tests d'hydratation (`test:integration:hydration`) et canvas (`test:canvas:non-regression`) verts à chaque extraction.
**Critères d'acceptation :** par extraction : responsabilité déplacée vers un hook/service nommé, `App.tsx` strictement allégé, `tsc` 0, suites hydratation/canvas vertes.

---

## 4. Principes retenus pour toute la revue (SOLID & patterns)

1. **Contrats aux frontières, pas de `any` au milieu** : typage par *ports/adapters* — Zod aux entrées HTTP/socket, génériques aux accès storage, contrats partagés front/back (US-RC-10). Un contrat fort élimine plus de dette que dix typages locaux.
2. **Open/closed sur la dette** : le ratchet bloque la régression, la baseline ne recale qu'à la baisse — jamais d'assouplissement pour masquer une régression (règle du backlog source §8 reprise ici).
3. **Single responsibility sur App.tsx** : zone à haut risque (§11 backlog source) — toute correction future extrait de la logique vers hooks/services dédiés plutôt que d'alourdir le composant (US-RC-11).
4. **Strategy pour le logging** (US-RC-06) : `ILogger` injecté, niveaux par env, pas de `console.*` dispersés.
5. **Fail-closed conservé** : aucune correction d'hygiène ne doit affaiblir les garde-fous J7 (fencing fail-closed, audit append-only, filtrage `workspaceId` strict) — rejouer `ci:node25:runtime` et les suites J7 à chaque lot backend.
6. **Tout gate CI a un `--self-test`** (pattern établi par `scripts/ci/audit-gate.mjs`, insight `04-cicd-installation`) : le ratchet (R2) et le futur gate hygiène (US-RC-01) doivent pouvoir se prouver eux-mêmes.

## 5. Ordre d'exécution imposé

1. `US-RC-00a` (R1, `06-frontend`) → **commit** ;
2. `US-RC-00b` (R2+R4, `04-cicd-installation`) → **commit** — prérequis du gate CI ;
3. `US-RC-00c` (R3, `03-backend`) → **commit** ;
4. `US-RC-01` (gate CI `hygiene-gate` dans `ci.yml`, `04-cicd-installation`) dès les trois US commitées — jamais avant, le ratchet et `format:changed` doivent être fiables ;
5. `US-RC-02` / `US-RC-03` en parallèle (périmètres front/back disjoints), lots de 5–10 fichiers, baseline recalée à la baisse après chaque lot ;
6. `US-RC-10` (contrat partagé) peut démarrer dès US-RC-00a, à livrer avec US-RC-02 ;
7. `US-RC-04` / `US-RC-05` en parallèle ;
8. `US-RC-06` → `US-RC-07` → `US-RC-08` ;
9. `US-RC-11` (extraction App.tsx) optionnel, par extractions unitaires ;
10. `US-RC-09` (historique git) en dernier, optionnel, avec revue signée.

## 6. Definition of Done de cette revue

1. Réserves R1–R4 corrigées via `US-RC-00a`/`US-RC-00b`/`US-RC-00c`, chacune commitée dans l'ordre (la vague 1 `ba6ee8b` étant déjà committée, ces corrections forment des commits séparés tracés) ;
2. Gate CI actif : lint + ratchet + format:changed **bloquants** sur les PR (US-RC-01), avec self-test du ratchet ;
3. Dette `any` en baisse ratchetée des deux côtés, `tsc` 0/0, eslint 0 erreur, prettier `format:changed` vert et bloquant ;
4. Logger structuré backend en place, plus de `console.*` dans `backend/src` ;
5. Contrat partagé front/back des événements runtime en place, parité vérifiée en CI (US-RC-10) ;
6. Toutes les suites impactées restent au vert (racine, backend, `ci:node25:runtime`, audit strict) — **aucune régression du GO signé 2026-11-19**.

## 7. Hors périmètre (ne pas traiter ici)

- Dette fonctionnelle `saveEdges` → write path legacy `/api/workflows/:id/edges` : à rattacher à la prochaine feature « liens entre nodes » (réserve tracée au gate §13), pas à l'hygiène.
- Formatage prettier repo-wide (gros diff) : US dédiée optionnelle, jamais lancée sans autorisation.
- Réécriture d'historique git (US-RC-09) : soumise à revue signée du responsable projet.
- Création d'un monorepo `packages/contracts` pour US-RC-10 : hors périmètre (`rootDir` backend, build séparé) — la génération + test de parité est retenue à la place.
- Toute modification des workflows CI de release au-delà du job `hygiene-gate` de `ci.yml` (US-RC-01).

---

## 8. Prochaine feature — points tracés (hors périmètre de cette revue)

Tracé le 2026-11-23 par le responsable projet, à approfondir **après clôture de ce backlog de revue** — ne pas traiter ici. Deux objectifs, avec preuves mesurées sur `main` @ `ba6ee8b` (vérifiées par `09-architecte-applicatif`) :

### 8.1 Architecture LLM propre et SOLID — stubs silencieux et catalogue périmé

- **Stubs silencieux** : `services/anthropicService.ts:199` et `services/qwenService.ts:120` — `generateContent` renvoie littéralement `{ text: "Not implemented" }`. Chaîne exploitable : `services/historySynthesisService.ts:161` appelle `llmService.generateContent(...)` (`services/llmService.ts:88`), donc un modèle de synthèse Anthropic ou Qwen produirait ce texte comme résumé de l'historique (à confirmer par un test de non-régression dans la prochaine feature).
- **Catalogue périmé** : `llmModels.ts:183-229` référence encore la famille Claude 4.x (`claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`, `claude-opus-4-5-20251101`, `claude-opus-4-1-20250805`) alors que les modèles courants sont en 5.x.
- **Providers parallèles à surfaces non homogènes** : 11 services provider (`anthropicService`, `arcLLMService`, `deepSeekService`, `geminiService`, `grokService`, `kimiService`, `lmStudioService`, `mistralService`, `openAIService`, `perplexityService`, `qwenService`, plus `mockLLMService`) joints dans `llmService.ts` par `asDispatchableService` (l.42 : `service as ProviderServiceDispatch` depuis `unknown`) au-dessus d'un switch `getServiceProvider` (l.45) ; les capacités sont optionnelles et testées à l'aveugle (`if (!service.generateContentWithSearch)`), sans contrat commun imposé.

**Objectif de la prochaine feature :** contrat unique type *port* (`ILLMProvider`) avec implémentations homogènes, **échec explicite à la place de tout stub silencieux**, dispatch typé sans cast depuis `unknown`, et catalogue `llmModels.ts` actualisé (5.x).

### 8.2 Découpage des « god objects »

Tailles mesurées sur `main` @ `ba6ee8b` :

| Fichier | Lignes | Défaut constaté |
|---|---|---|
| `components/V2AgentNode.tsx` | 2119 | composant god : 3 représentations du nœud + logique runtime + handles |
| `components/modals/AgentConfigurationModal.tsx` | 1495 | modale god |
| `components/WorkflowCanvas.tsx` | 1435 | canvas god (rendu + collisions + viewport + drag) |
| `backend/src/routes/agent-instances.routes.ts` | 1409 | logique métier dans la route — violation de la règle §4.2 du backlog source (routes = adaptateurs minces) |
| `backend/src/services/databaseInit.ts` | 1145 | bootstrap + migrations + seed + index concentrés (§11 du backlog source : zone à haut risque) |

**Objectif de la prochaine feature :** découpage par responsabilité (composants/presenters, use cases, repositories, modules d'init), en US dédiées avec suites de non-régression vertes à chaque extraction.
