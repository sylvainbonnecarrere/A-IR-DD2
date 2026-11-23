# Revue de code post-clôture — feature refonte V1 → V2 (`v1-v2-revue-code`)

**Auteur :** `01-architecte` (revue architecturale)
**Date :** 2026-11-21
**Branche :** `main` @ `f2499f6` + working tree non commité de l'agent `06-frontend` (32 suppressions indexées, 79 fichiers modifiés, 6 nouveaux fichiers — rapport `Guides/Features/feature/refonte/erreurs/rapport-hygiene-code-2026-11-21.md`)
**Backlog source clôturé :** `Guides/Features/feature/refonte/backlog/v1-v2-refonte-backlog.md` (gate de cutover V2 §13 : **GO signé 2026-11-19**, toutes US J0–J7 closes)
**Objectif :** valider la première vague de corrections d'hygiène non commitées, corriger les réserves architecturales avant commit, puis planifier la suite (dette `any`, `console.log`, lint/prettier, CI) en US exécutables.

---

## 1. Conformité du backlog source — vérifiée

Le backlog `v1-v2-refonte-backlog.md` est **conforme et clos** :

- §10 séquence d'exécution : J0→J6 puis J7 (`US-J7-05` → … → `US-J7-15`) exécutée dans l'ordre imposé ; chapeau `US-J7-02` fermé.
- §12 Definition of Done : toutes les US critiques implémentées/testées, V2 seule source d'écriture, migrations rejouables, runs pilotables sans navigateur, front sans reconstruction V1, fixtures adaptées explicitement, suites au vert, validation E2E exploitable (verdict GO signé `08-testeur-e2e`, US-J7-15).
- §13 gate de cutover V2 : évaluation de clôture 2026-11-19 — **tous les points VALIDE, décision GO** (audit strict OK, migrations sans doublon, non-régression `test:j6:backend` 126/126, J7-05..J7-09 quarantaine/fencing prouvés). Réserve tracée non bloquante : dette `saveEdges` → feature « liens entre nodes » (voir §7 hors périmètre).

Aucun reliquat fonctionnel du backlog n'est ouvert. La revue qui suit porte **uniquement sur la qualité du code** (hygiène, typage, dette), pas sur des fonctionnalités.

---

## 2. Verdict sur la première vague de corrections `06-frontend` (non commitées)

### 2.1 VALIDÉE — preuves re-exécutées par l'architecte (2026-11-21)

| Contrôle | Résultat constaté | Verdict |
|---|---|---|
| `tsc --noEmit` frontend racine | 0 erreur (exit 0) — était 13 | ✅ |
| `cd backend && npx tsc --noEmit` | 0 erreur (exit 0) | ✅ |
| `npx eslint . --quiet` (erreurs seules) | 0 erreur (exit 0) | ✅ |
| `node scripts/ci/hygiene-ratchet.mjs` | OK, baseline 376/433/126/2 stable (exit 0) | ✅ |
| Suites jest modifiées (workflowRunService, useAppWorkflowController, WorkflowCanvas.render, V2AgentNode.handles) | 4 suites / 25 tests PASS | ✅ |
| Typage des 5 gros fichiers `any` (workflowService, llmService, geminiService, AgentConfigurationModal, useWorkflowData) | 72 `any` supprimés, **0 ajoutés** ; génériques (`_loadFromStorage<T>`, `_fetchFromAPI<T>`, `okResponse<T>`), interfaces nommées (`StoredWorkflowNode/Edge`), type guards (`errorMessageOf(err: unknown)`) — pas de `any` déguisé | ✅ qualité SOLID |
| `AgentLoop.ts` ~l.543 | `if` imbriqué redondant supprimé, retour aplati, comportement identique | ✅ |
| Suppression `backend/src/server.js` + `websocket/WebSocketManager.js` | aucune référence trouvée (main = `dist/src/server.js`, dev = `tsx src/server.ts`) ; 0 `.js` restant dans `backend/src` | ✅ |
| 30 `.pyc` désindexés + `.gitignore` (`__pycache__/`, `*.pyc`) | conforme | ✅ |
| `bcryptjs` → `bcrypt` natif (hashs `$2b$` compatibles) | `User.model.ts`, `databaseInit.ts`, `init-collections.js`, `fix-test-user.js` cohérents ; 0 occurrence `bcryptjs` | ✅ |
| Garde-fous : `eslint.config.mjs` (flat, dette en `warn`, structurel en `error`), `.prettierrc.json`, `scripts/ci/hygiene-ratchet.mjs` + baseline | bien calibrés, dette ratchetée en augmentation | ✅ |

### 2.2 RÉSERVES — 3 points à corriger **avant commit** (US-RC-00, P0)

| # | Réserve | Détail | Correction attendue |
|---|---|---|---|
| R1 | **Stale closure dans `App.tsx`** | `addAgentToWorkflow` (useCallback l.393) appelle `setCurrentImageAgentInstance(remapAgentInstanceReference(currentImageAgentInstance, …))` (l.496) et idem vidéo (l.498), mais `currentImageAgentInstance`/`currentVideoAgentInstance` **ne sont pas dans les dépendances** du useCallback (l.594). La correction "setter prend une valeur" (juste au demeurant — le setter `useAppShellStore` prend une valeur, pas un updater) échange l'ancien bug de type contre un risque de closure périmée. | Utiliser le pattern déjà présent dans le même fichier : `useAppShellStore.getState().currentImageAgentInstance` (cf. l.277/281) — pas de dépendance ajoutée, état toujours courant. |
| R2 | **Ratchet aveugle aux fichiers non suivis** | `hygiene-ratchet.mjs` compte via `git ls-files` : un **nouveau fichier non commité** contenant des `any`/`console.log` échappe au comptage en local (il ne sera vu qu'au commit, donc en CI seulement). | Ajouter `git ls-files --others --exclude-standard` au périmètre de comptage (fichiers nouveaux non suivis). |
| R3 | **`init-collections.js` : commentaire manquant** | Le fichier est monté dans `/docker-entrypoint-initdb.d/` du conteneur `mongo:6.0` (docker-compose.yml l.17) où `require('bcrypt')` (natif) n'est pas disponible ; SETUP_NOTES le marque « reference only / deprecated ». Le passage à `bcrypt` y est cohérent mais un lecteur pourrait croire le script exécutable tel quel. | Ajouter un commentaire d'en-tête : « reference only — en conteneur mongo, remplacer par un hash `$2b$` précalculé, `require` indisponible ». |

### 2.3 Améliorations architecturales proposées (planifiées en §3)

- **Contrats partagés aux frontières** (pattern *ports/adapters*) : le front duplique encore des formes de contrats backend (`RuntimeEventEnvelope` exporté de `webSocketService.ts` est une bonne amorce) — étendre à un package de contrats communs (run/task/événements) plutôt que de typer fichier par fichier.
- **Logger structuré backend** (pattern *strategy*) : remplacer `console.debug/warn/error` par une interface `ILogger` à niveaux (`LOG_LEVEL`), implémentation console en dev / JSON structuré en prod — ne pas se contenter de renommer.
- **Dette `any` par boundaries, pas par fichier** : la campagne `any` doit cibler d'abord les frontières (API axios, localStorage, socket, payloads LLM) où un contrat fort élimine des dizaines de `any` d'un coup (ex. `useWorkflowData.ts` l'a montré : `catch (err: unknown)` + guard = pattern reproductible).
- **`App.tsx` reste la zone à haut risque** (§11 du backlog source) : planifier une extraction progressive de sa logique métier vers hooks/services dédiés, en US séparées — hors périmètre de l'hygiène pure.

---

## 3. User stories de la revue de code

### US-RC-00 — Corrections architecturales avant commit (réserves R1–R3)

**Agent responsable :** `06-frontend.agent.md`
**Co-responsable :** `01-architecte` (revue)
**Criticité :** Haute (bloquant pour le commit de la vague 1)
**Description :** corriger R1 (stale closure `App.tsx` via `useAppShellStore.getState()`), R2 (ratchet + fichiers non suivis), R3 (commentaire `init-collections.js`). Aucun changement de comportement.
**Dépendances :** aucune (working tree courant).
**Risques et consequences :** R1 non corrigé = régression potentielle silencieuse (référence d'instance périmée lors du remap d'ID) ; R2 non corrigé = le ratchet peut être contourné en local.
**Impacts codebase et tests :** `App.tsx`, `scripts/ci/hygiene-ratchet.mjs`, `backend/docker/init-collections.js`, test de ratchet (fixture avec fichier non suivi) ; rejouer les suites `App`/workflow.
**Criteres d'acceptation :**
- `App.tsx` : plus aucun usage de `currentImageAgentInstance`/`currentVideoAgentInstance` hors deps dans `addAgentToWorkflow` (utiliser `getState()`) ;
- ratchet : un fichier nouveau non suivi avec `any`/`console.log` fait échouer le script en local ;
- `init-collections.js` porte le commentaire d'en-tête ;
- `tsc` 0/0, eslint 0 erreur, suites concernées vertes, ratchet OK.

### US-RC-01 — Câblage CI du gate hygiène (depuis US-HYG-01)

**Agent responsable :** `04-cicd-installation.agent.md`
**Criticité :** Haute (P0)
**Description :** ajouter `npm run lint` (exit 1 si erreur) + `npm run hygiene` (ratchet) + `npm run format:check` en preflight de chaque PR dans `.github/workflows/*`, sans casser les jobs existants.
**Dépendances :** US-RC-00 (le ratchet doit être fiable avant d'être bloquant en CI).
**Risques :** un gate CI mal calibré bloque des PR légitimes → le calibrer d'abord sur main (job vert), puis bloquant.
**Impacts codebase et tests :** `.github/workflows/*`, `package.json` scripts ; vérifier le job sur une PR test.
**Criteres d'acceptation :** PR qui augmente `any`/`console.log` ou ajoute une erreur lint est bloquée ; job vert sur `main`.

### US-RC-02 — Campagne `any` frontend par boundaries (depuis US-HYG-02)

**Agent responsable :** `06-frontend.agent.md`
**Criticité :** Moyenne (P1)
**Description :** campagne sur les 376 `any` frontend restants, **par frontières** (axios/apiClient, localStorage, socket, payloads LLM, composants `components/com/*`) et non par fichier isolé : introduire des contrats/typages aux frontières, 5–10 fichiers/US, lots décroissants.
**Dépendances :** US-RC-00.
**Risques :** un typage trop étroit casse des flux legacy silencieusement → tests des modules + `tsc` 0 à chaque lot ; ne jamais affaiblir un test pour passer.
**Impacts codebase et tests :** `services/*`, `hooks/*`, `components/com/*`, `stores/*` ; `hygiene:update-baseline` après chaque lot.
**Criteres d'acceptation :** `tsc` 0, tests des modules OK, compteur `anyFrontend` en baisse stricte à chaque lot, ratchet OK.

### US-RC-03 — Campagne `any` backend par boundaries (depuis US-HYG-03)

**Agent responsable :** `03-backend.agent.md`
**Co-responsable :** `01-architecte` (contrat domaine)
**Criticité :** Moyenne (P1)
**Description :** idem sur les 433 `any` de `backend/src`, en priorisant les frontières (routes → Zod déjà présent, repositories, gateway/socket, stores Mongo) ; réutiliser les contrats `domain/execution/*.contract.ts` existants comme source de vérité.
**Dépendances :** US-RC-00.
**Risques :** toucher aux repositories/stores sanscontrat peut casser la persistance → suites `test:j6:backend` + contrats en garde-fou.
**Impacts codebase et tests :** `backend/src/routes|repositories|services|websocket|models` ; `cd backend && npx tsc --noEmit` 0.
**Criteres d'acceptation :** idem US-RC-02 côté backend + `ci:node25:runtime` PASS.

### US-RC-04 — `console.log` restants → `console.debug` / logger (depuis US-HYG-04)

**Agent responsable :** `06-frontend` (front) + `03-backend` (back)
**Criticité :** Faible (P2)
**Description :** 126 `console.log` front (essentiellement tests) + 2 back restants → `console.debug` ; puis règle `no-console` en `error` pour les **nouveaux** fichiers uniquement.
**Dépendances :** US-RC-02/03 (en parallèle possible, périmètres disjoints).
**Criteres d'acceptation :** ratchet `consoleLogBackend` à 0, baisse front, règle error sans régression, eslint 0 erreur.

### US-RC-05 — Prettier sur fichiers modifiés en CI (depuis US-HYG-05)

**Agent responsable :** `04-cicd-installation.agent.md`
**Criticité :** Faible (P2)
**Description :** `format:changed` (diff vs main) en CI ; la campagne de formatage repo-wide reste une US séparée et optionnelle (gros diff, ne jamais lancer sans US dédiée).
**Dépendances :** aucune.
**Criteres d'acceptation :** `format:changed` vert en CI ; aucun reformat implicite dans les PR.

### US-RC-06 — Logger structuré backend (depuis US-HYG-06)

**Agent responsable :** `03-backend.agent.md`
**Co-responsable :** `01-architecte` (contrat `ILogger`)
**Criticité :** Faible (P3)
**Description :** pattern *strategy* — interface `ILogger` (`debug/info/warn/error` + contexte structuré), implémentation `ConsoleLogger` (dev) et `JsonLogger` (prod, `LOG_LEVEL` env) ; remplacer tous les `console.*` de `backend/src` par le logger injecté. Ne pas se contenter de renommer `console.debug`.
**Dépendances :** US-RC-03 (typage des services d'abord).
**Risques :** perdre des logs en prod si le niveau par défaut est trop haut → défaut `info` en prod, `debug` en dev ; smoke sur `dist`.
**Impacts codebase et tests :** `backend/src/services/logger/*`, wiring `server.ts` (injection), tests de niveau.
**Criteres d'acceptation :** plus aucun `console.*` dans `backend/src`, logs identiques en dev, `LOG_LEVEL` respecté, suites backend vertes.

### US-RC-07 — Nettoyage des warnings eslint en lots (depuis US-HYG-07)

**Agent responsable :** `06-frontend` + `03-backend`
**Criticité :** Faible (P3)
**Description :** traiter les ~2383 warnings par lots (`no-unused-vars` ~405, `prefer-const`, etc.) ; ratchet des warnings comme pour `any`.
**Dépendances :** US-RC-02/03.
**Criteres d'acceptation :** `eslint . --quiet` reste 0 erreur, warnings en baisse ratchetée, aucune régression de tests.

### US-RC-08 — `rules-of-hooks` en error (depuis US-HYG-08)

**Agent responsable :** `06-frontend`
**Criticité :** Faible (P3)
**Description :** corriger le faux positif `react-hooks/rules-of-hooks` v6 + React 19 (pin de version du plugin ou config) sur `V2AgentNode.tsx` et consorts, puis repasser la règle en `error`.
**Dépendances :** US-RC-02.
**Criteres d'acceptation :** 0 faux positif, règle `error` active, eslint 0 erreur.

### US-RC-09 — Nettoyage historique git des `.pyc` (depuis US-HYG-09)

**Agent responsable :** `04-cicd-installation.agent.md`
**Co-responsable :** responsable projet (revue obligatoire)
**Criticité :** Optionnel (P3)
**Description :** `git filter-repo` (ou BFG) pour retirer les 30 `.pyc` de l'historique — **réécriture d'historique soumise à revue** ; clone sain vérifié après.
**Dépendances :** US-RC-00 commitée (le `.gitignore` doit exister avant).
**Criteres d'acceptation :** historique sans `.pyc`, clone sain vérifié, revue signée.

### US-RC-10 — Contrat partagé front/back des événements runtime

**Agent responsable :** `06-frontend.agent.md`
**Co-responsable :** `03-backend.agent.md` (contrat domaine)
**Criticité :** Moyenne
**Description :** `RuntimeEventEnvelope` est exporté de `services/webSocketService.ts` (bonne amorce) mais reste une copie du contrat backend `backend/src/domain/execution/runtimeEvent.contract.ts`. Établir un **contrat partagé** (types + schémas Zod) consommé par les deux côtés, avec les 3 nouveaux types de quarantaine (`run:quarantined`, `run:fenced`, `run:recovery_relaunched`, US-J7-09) — pattern *contrat versionné partagé*, évite la divergence (le bug `version: number` vs littéral `1` en est la preuve).
**Dépendances :** US-RC-00 ; US-J7-09 livrée.
**Impacts codebase et tests :** `services/webSocketService.ts`, `stores/useRuntimeStore.ts`, contrat partagé (ex. `packages/contracts` ou `backend/src/domain` servi au front), tests de sérialisation.
**Criteres d'acceptation :** un seul contrat source, front et back le consomment, `tsc` 0/0, tests runtime_event PASS des deux côtés, aucun type inline dupliqué.

---

## 4. Principes retenus pour toute la revue (SOLID & patterns)

1. **Contrats aux frontières, pas de `any` au milieu** : typage par *ports/adapters* — Zod aux entrées HTTP/socket, génériques aux accès storage, contrats partagés front/back (US-RC-10). Un contrat fort élimine plus de dette que dix typages locaux.
2. **Open/closed sur la dette** : le ratchet bloque la régression, la baseline ne recale qu'à la baisse — jamais d'assouplissement pour masquer une régression (règle du backlog source §8 reprise ici).
3. **Single responsibility sur App.tsx** : zone à haut risque (§11 backlog source) — toute correction future extrait de la logique vers hooks/services dédiés plutôt que d'alourdir le composant.
4. **Strategy pour le logging** (US-RC-06) : `ILogger` injecté, niveaux par env, pas de `console.*` dispersés.
5. **Fail-closed conservé** : aucune correction d'hygiène ne doit affaiblir les garde-fous J7 (fencing fail-closed, audit append-only, filtrage `workspaceId` strict) — rejouer `ci:node25:runtime` et les suites J7 à chaque lot backend.

## 5. Ordre d'exécution imposé

1. `US-RC-00` (réserves R1–R3) → **commit de la vague 1** par le responsable projet ;
2. `US-RC-01` (gate CI) dès que la vague 1 est commitée ;
3. `US-RC-02` / `US-RC-03` en parallèle (périmètres front/back disjoints), lots de 5–10 fichiers, baseline recalée à la baisse après chaque lot ;
4. `US-RC-10` (contrat partagé) peut démarrer dès US-RC-00, à livrer avec US-RC-02 ;
5. `US-RC-04` / `US-RC-05` en parallèle ;
6. `US-RC-06` → `US-RC-07` → `US-RC-08` ;
7. `US-RC-09` (historique git) en dernier, optionnel, avec revue signée.

## 6. Definition of Done de cette revue

1. Vague 1 commitée après correction des réserves R1–R3 (US-RC-00) ;
2. Gate CI actif : lint + ratchet + format:changed bloquants sur les PR (US-RC-01) ;
3. Dette `any` en baisse ratchetée des deux côtés, `tsc` 0/0, eslint 0 erreur, prettier `format:changed` vert ;
4. Logger structuré backend en place, plus de `console.*` dans `backend/src` ;
5. Contrat partagé front/back des événements runtime en place (US-RC-10) ;
6. Toutes les suites impactées restent au vert (racine, backend, `ci:node25:runtime`, audit strict) — **aucune régression du GO signé 2026-11-19**.

## 7. Hors périmètre (ne pas traiter ici)

- Dette fonctionnelle `saveEdges` → write path legacy `/api/workflows/:id/edges` : à rattacher à la prochaine feature « liens entre nodes » (réserve tracée au gate §13), pas à l'hygiène.
- Formatage prettier repo-wide (gros diff) : US dédiée optionnelle, jamais lancée sans autorisation.
- Réécriture d'historique git (US-RC-09) : soumise à revue signée du responsable projet.
- Toute modification des workflows CI de release au-delà du preflight PR (US-RC-01).
