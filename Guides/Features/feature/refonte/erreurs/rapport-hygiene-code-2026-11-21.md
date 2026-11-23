# Rapport d'hygiène du code — constats, correctifs appliqués et recommandations (2026-11-21)

**Rédigé par :** agent `06-frontend`, session du 2026-11-21, branche `main`.
**Destinataire :** l'architecte, pour création d'une suite d'US de corrections ciblées (voir §5).
**État git :** aucun commit effectué par l'agent — toutes les corrections sont dans le working tree
(32 suppressions indexées + 79 fichiers modifiés + 6 nouveaux fichiers), en attente du commit externe.

---

## 1. Constats identifiés (chiffrés)

| # | Constat | Détail mesuré |
|---|---|---|
| C1 | 13 erreurs `tsc --noEmit` « pré-existantes » | `App.tsx` ×3, `components/WorkflowCanvas.tsx` ×2, `tests/components/WorkflowCanvas.render.test.tsx` ×2, `tests/services/workflowRunService.test.ts` ×4, `tests/unitaires/useAppWorkflowController.test.tsx` ×2 |
| C2 | `any` explicites | 454 frontend / 433 backend `src` (compteur ratchet : `: any`, `as any`, `<any>`, `any[]`, `Promise<any>`) |
| C3 | `console.log` | 221 frontend / 102 backend `src` (149 hors tests côté front) |
| C4 | `if` imbriqué redondant + indentation cassée | `services/llm/AgentLoop.ts` ~lignes 543-552 : le `if` interne reprenait la condition externe (toujours vraie) — signe qu'aucun lint/prettier ne bloquait |
| C5 | 30 fichiers `.pyc` versionnés | `backend/python/**/__pycache__/*.cpython-313.pyc` |
| C6 | Doublons `.js`/`.ts` | `backend/src/websocket/WebSocketManager.{js,ts}` (147 vs 388 lignes — le `.js` était un artefact compilé périmé) ; idem `backend/src/server.{js,ts}` |
| C7 | `bcrypt` et `bcryptjs` ensemble | `backend/package.json` : les deux en deps ; `User.model.ts` → `bcrypt`, `databaseInit.ts` + `docker/init-collections.js` + `scripts/fix-test-user.js` → `bcryptjs` |
| C8 | Aucun lint/prettier installé ni câblé | pas d'eslint/prettier dans les devDeps, aucune config, aucun script |

## 2. Correctifs appliqués et vérifiés

### 2.1 Socle « zéro erreur de type » (C1)
- `services/webSocketService.ts` : `RuntimeEventEnvelope` exporté ; `App.tsx` l'utilise (le type inline avait `version: number` au lieu du littéral `1`).
- `App.tsx` : les setters du store (`setCurrentImage/VideoAgentInstance`) prennent une **valeur**, pas un updater React → appels corrigés avec l'état courant.
- `WorkflowCanvas.tsx` : `getNodesBounds` (présent au runtime, absent du type RF 11.11.4) déclaré dans le `ReactFlowNodeLookup` local ; le `as any` supprimé.
- Tests : mock `getNode` typé (`(_id?: string): unknown`), helper `okResponse({data})` retournant une `AxiosResponse` complète dans `workflowRunService.test.ts` (×4) et `useAppWorkflowController.test.tsx` (×1), `sessionStatus: 'active'` → `'ready'` (type `AuthSessionStatus` = `loading | restoring-session | degraded | ready`).
- **Résultat : `tsc` frontend 0 erreur (était 13), backend 0 erreur ; 24/24 tests sur les suites touchées.**

### 2.2 Qualité de code ciblée (C4)
- `services/llm/AgentLoop.ts` : `if` imbriqué redondant supprimé, retour aplati, indentation réparée — comportement identique (12/12 tests AgentLoop OK).

### 2.3 Artefacts et doublons (C5, C6, C7)
- 30 `.pyc` désindexés (`git rm --cached`, fichiers conservés sur disque) + `.gitignore` : `__pycache__/`, `*.pyc`.
- `backend/src/websocket/WebSocketManager.js` et `backend/src/server.js` supprimés (`git rm`) : artefacts compilés, aucun script ne lance `src/server.js` (main = `dist/src/server.js`, dev = `tsx src/server.ts`) → 0 `.js` restant dans `backend/src`.
- bcrypt standardisé sur **`bcrypt`** (natif, `@types/bcrypt` déjà présents, hashs `$2b$` compatibles) : 3 fichiers migrés, `npm uninstall bcryptjs` (package.json + lockfile nettoyés, 0 occurrence restante).

### 2.4 Garde-fous lint/prettier/ratchet (C8) — nouveaux fichiers
- `eslint.config.mjs` (ESLint 9 flat + typescript-eslint + react/react-hooks) : règles dette en `warn`, vraies règles structurelles en `error`. `npm run lint` → **0 erreur** (2383 warnings de dette).
- `.prettierrc.json` + `.prettierignore` + scripts `format`, `format:check`, `format:changed` (prettier 3.10.1 installé).
- `scripts/ci/hygiene-ratchet.mjs` + `scripts/ci/hygiene-baseline.json` : bloque toute **augmentation** des `any` et `console.log` ; `--update` ne recale la baseline que quand la dette diminue. Scripts `hygiene`, `hygiene:update-baseline`.
- `package.json` : scripts `lint`, `lint:fix`, `format`, `format:check`, `format:changed`, `hygiene`, `hygiene:update-baseline`.

### 2.5 Balayages délégués à 3 agents enfants (périmètres disjoints, vérifiés par eux)
| Agent | Travail | Résultat |
|---|---|---|
| `hygiene-console-frontend` | `console.log(` → `console.debug(` dans components/hooks/stores/utils/contexts/services/App.tsx (21 fichiers) | 95 remplacements, tsc 0, 161 tests OK |
| `hygiene-console-backend` | idem dans `backend/src/**/*.ts` (30 fichiers, hors `__tests__`) | 100 remplacements, backend tsc 0, 23 tests OK |
| `hygiene-any-top-frontend` | typage précis des 5 plus gros fichiers `any` (workflowService, llmService, geminiService, AgentConfigurationModal, useWorkflowData) | **72 `any` supprimés (5 fichiers à 0)**, tsc 0, 102 tests OK |

### 2.6 Compteurs après correctifs (ratchet recalé et verrouillé)

| Compteur | Avant | Après |
|---|---|---|
| `any` frontend | 454 | **376** |
| `any` backend | 433 | 433 |
| `console.log` frontend | 221 | **126** |
| `console.log` backend | 102 | **2** |

### 2.7 Vérifications globales finales
- `tsc --noEmit` front **0** / back **0** ; `npm run build` OK ; `npx eslint .` **0 erreur** ; `node scripts/ci/hygiene-ratchet.mjs` **OK** ; smoke jest 11 suites / 93 tests OK (+ 286 tests cumulés côté agents enfants).

## 3. Dette restante

- `any` : 376 frontend / 433 backend. Top front restant : `components/com/*`, `services/*` divers, `hooks/*`.
- `console.log` : 126 frontend (essentiellement des tests) / 2 backend.
- 2383 warnings eslint (dont ~405 `no-unused-vars`, faux positifs `react-hooks/rules-of-hooks` v6 avec React 19).
- Prettier non appliqué à l'historique (diff massif volontairement non lancé).

## 4. Recommandations → US proposées pour l'architecte

| US suggérée | Périmètre | Priorité | Critères d'acceptation |
|---|---|---|---|
| **US-HYG-01** Câblage CI du gate | `.github/workflows/*` : ajouter `npm run lint` (exit 1 si erreur) + `npm run hygiene` (ratchet) en preflight des PR | **P0** | PR qui augmente `any`/`console.log` ou ajoute une erreur lint est bloquée ; job vert sur main |
| **US-HYG-02** Campagne `any` frontend par lots | fichiers triés par compte `any` décroissant, 5-10 fichiers/US | P1 | tsc 0, tests des modules OK, `hygiene:update-baseline` après chaque lot, compteur en baisse stricte |
| **US-HYG-03** Campagne `any` backend par lots | idem sur `backend/src` | P1 | idem + `cd backend && npx tsc --noEmit` 0 |
| **US-HYG-04** `console.log` restants | 126 front (tests) + 2 back → `console.debug` ou logger ; puis règle `no-console` en `error` pour les nouveaux fichiers | P2 | ratchet à 0 côté back, baisse front ; règle error sans régression |
| **US-HYG-05** Prettier sur fichiers modifiés | `format:changed` en CI (diff vs main) ; campagne de formatage de l'historique en US séparée et optionnelle (gros diff) | P2 | `format:changed` vert ; aucun reformat implicite dans les PR |
| **US-HYG-06** Logger structuré backend | remplacer `console.debug/warn/error` par un logger à niveaux (env `LOG_LEVEL`) dans `backend/src` | P3 | plus de `console.*` dans `backend/src`, logs inchangés en dev |
| **US-HYG-07** Nettoyage des warnings eslint | `no-unused-vars` (~405), `prefer-const`, etc. en lots | P3 | `npx eslint . --quiet` (errors only) reste 0, warnings en baisse ratchetée |
| **US-HYG-08** `rules-of-hooks` en error | corriger le faux positif plugin v6 / React 19 (pin de version ou config) puis repasser la règle en `error` | P3 | 0 faux positif sur `V2AgentNode.tsx`, règle error active |
| **US-HYG-09** Nettoyage historique git des `.pyc` | `git filter-repo` (ou BFG) pour retirer les 30 `.pyc` de l'historique — **avec revue** (réécriture d'historique) | P3 optionnel | historique sans `.pyc`, clone sain vérifié |

## 5. Garde-fous déjà en place (ne pas régresser)

- `npm run lint` (0 erreur actuellement), `npm run hygiene` (ratchet, baseline verrouillée à 376/433/126/2), `npm run format:changed`.
- Conventions : ne jamais recaler la baseline à la hausse ; `console.log` → `console.debug` ; un `any` nouveau doit être justifié en commentaire.

## 6. Risques et non-fait (à valider)

- **Workflows CI non modifiés** (décision architecte, voir US-HYG-01).
- `backend/src/server.js` supprimé avec le doublon WebSocketManager : si un déploiement externe exécutait `node backend/src/server.js` (hors `main`/`dev`/Docker vérifiés), le signaler — le point d'entrée canonique reste `dist/src/server.js`.
- Formatage prettier repo-wide **non** exécuté (diff massif) : ne pas lancer sans US dédiée.
- La dette `any` restante (376/433) n'est pas dangereuse individuellement mais bloque l'activation de `@typescript-eslint/no-explicit-any` en `error` — d'où la campagne US-HYG-02/03.
