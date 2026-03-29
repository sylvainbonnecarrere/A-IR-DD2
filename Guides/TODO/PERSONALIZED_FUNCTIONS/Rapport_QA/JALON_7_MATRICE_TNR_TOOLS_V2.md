# JALON 7 - MATRICE TNR TOOLS V2 POST-QA

> Date: 29 mars 2026
> Source directrice: `Guides/TODO/PERSONALIZED_FUNCTIONS/Rapport_QA/PLAN_CORRECTION_INTENSIF_TOOLS_V2_POST_QA.md`
> Perimetre: flux QA critiques `editeur -> preparation -> run -> runs -> agent`

---

## 1. Objet du livrable

Ce livrable transforme les cas QA du rapport catastrophe en une **matrice TNR explicite**.

Objectif:

1. relier chaque symptome QA a un invariant testable
2. pointer les preuves automatisees deja en place
3. distinguer les cas `COUVERT`, `PARTIEL` et `MANQUANT`
4. donner une commande de verification concrete pour chaque bloc J7

Cette matrice ne traite pas le durcissement des images sandbox: ce point reste dans le **Jalon 8**.

---

## 2. Convention de statut

1. `COUVERT`
   preuve automatisee exploitable cote frontend et/ou backend, suffisante pour casser une regression du flux cible

2. `PARTIEL`
   preuve utile existante mais incomplete pour le flux QA complet

3. `MANQUANT`
   aucune preuve exploitable a ce stade

---

## 3. Analyse de design et anti-regression

### Proposition de design

Le J7 est structure comme une **matrice de traçabilite** entre:

1. scenario QA narratif
2. invariant metier ou technique
3. preuves TNR backend/frontend
4. commande de validation
5. decision de couverture

Le pattern retenu est un `traceability matrix` simple plutot qu'une checklist libre. Cela evite de perdre le lien entre symptome QA, contrat systeme et test executable.

### Analyse de risque / regression

Cette approche limite trois regressions frequentes:

1. declarer un scenario comme couvert alors qu'il n'existe qu'un mock UI sans preuve backend
2. multiplier des tests redondants sans relier clairement la couverture au symptome QA d'origine
3. melanger les sujets J7 et J8, ce qui ferait croire qu'une matrice TNR suffit a traiter la dette securite runtime

---

## 4. Matrice TNR explicite J7

| ID | Scenario QA a verrouiller | Invariant attendu | Preuves automatisees actuelles | Commande de validation ciblee | Statut | Ecart restant |
|---|---|---|---|---|---|---|
| J7-01 | Fonction TypeScript simple depuis l'editeur | un auteur peut saisir un JSON valide, executer et obtenir un resultat sans erreur de wrapper | `tests/components/FunctionEditorTab.test.tsx` (save + run + aide QA), `backend/src/__tests__/sandbox.routes.test.ts` (POST `/api/sandbox/run`), `backend/src/__tests__/execution-orchestrator.test.ts` (transpilation TS inline), `backend/src/__tests__/runtime-wrappers.test.ts` (wrapper syntax safe), `tests/fonctionnels/J7.Editor.RealBrowser.semi-e2e.spec.ts` (navigateur reel + Monaco + execution) | `npm test -- tests/components/FunctionEditorTab.test.tsx backend/src/__tests__/sandbox.routes.test.ts backend/src/__tests__/execution-orchestrator.test.ts backend/src/__tests__/runtime-wrappers.test.ts` puis `npm run test:j7:editor:semi-e2e` | COUVERT | aucune lacune critique immediate sur le parcours editeur TS |
| J7-02 | Fonction Python simple depuis l'editeur | un auteur peut executer une fonction Python custom simple avec des args JSON stricts | `tests/components/FunctionEditorTab.test.tsx` (aide QA Python + blocage JSON invalide + run), `backend/src/__tests__/sandbox.routes.test.ts` (run route sur fonction Python custom), `backend/src/__tests__/pythonExecutor.test.ts` (delegation orchestrateur pour runtime Python), `tests/fonctionnels/J7.Editor.RealBrowser.semi-e2e.spec.ts` (navigateur reel + Monaco + execution) | `npm test -- tests/components/FunctionEditorTab.test.tsx backend/src/__tests__/sandbox.routes.test.ts backend/src/__tests__/pythonExecutor.test.ts` puis `npm run test:j7:editor:semi-e2e` | COUVERT | aucune lacune critique immediate sur le parcours editeur Python |
| J7-03 | `web_search_py` avec readiness positive | une native readonly provisionnee est visible comme runnable avant execution | `backend/src/__tests__/transition-routes.test.ts` (GET `/api/tools/:id` et `/api/tools` readiness ready), `tests/components/FunctionEditorTab.test.tsx` (projection runtime/editor), `tests/components/PhilFunctionsPage.test.tsx` (library/detail readiness) | `npm test -- backend/src/__tests__/transition-routes.test.ts tests/components/FunctionEditorTab.test.tsx tests/components/PhilFunctionsPage.test.tsx` | COUVERT | aucune lacune critique immediate |
| J7-04 | `web_search_py` avec readiness negative explicite | une native readonly non provisionnee est marquee non prete avant run, sans surprise runtime silencieuse | `backend/src/__tests__/transition-routes.test.ts` (waiting_for_provisioning), `backend/src/__tests__/runtime-health.service.test.ts` (imports critiques manquants), `tests/components/SandboxHealthLoader.test.tsx` (badge runtime), `tests/components/FunctionEditorTab.test.tsx` (banniere native Python degradee) | `npm test -- backend/src/__tests__/transition-routes.test.ts backend/src/__tests__/runtime-health.service.test.ts tests/components/SandboxHealthLoader.test.tsx tests/components/FunctionEditorTab.test.tsx` | COUVERT | aucune lacune critique immediate |
| J7-05 | Statut de preparation explicite sur native readonly | l'UI explique la categorie native readonly et l'action attendue cote plateforme | `tests/components/FunctionEditorTab.test.tsx` (provisionnement plateforme en attente), `tests/components/PhilFunctionsPage.test.tsx` (readiness dans liste + detail), `backend/src/__tests__/transition-routes.test.ts` (actionLabel/readiness status), `tests/fonctionnels/J7.Editor.RealBrowser.semi-e2e.spec.ts` (projection browser de la native non prete) | `npm test -- tests/components/FunctionEditorTab.test.tsx tests/components/PhilFunctionsPage.test.tsx backend/src/__tests__/transition-routes.test.ts` puis `npm run test:j7:editor:semi-e2e` | COUVERT | aucune lacune critique immediate |
| J7-06 | Build auteur disponible sur custom workflow-scoped | le bouton build n'est actif que pour une custom eligible et son indisponibilite est expliquee autrement | `tests/components/FunctionEditorTab.test.tsx` (save before build, build indisponible hors workflow, raison UX), `backend/src/__tests__/build.service.test.ts` (contrat build custom vs native) | `npm test -- tests/components/FunctionEditorTab.test.tsx backend/src/__tests__/build.service.test.ts` | COUVERT | aucune lacune critique immediate |
| J7-07 | Appel agentique unique sur tool call simple | la boucle agentique ne duplique pas un tool call identique dans une meme iteration | `tests/services/AgentLoop.test.ts` (dedup identical tool calls emitted in the same iteration), `tests/components/V2AgentNode.agentloop.test.tsx`, `tests/components/V2AgentNode.agentloop-persisted-run.test.tsx` | `npm test -- tests/services/AgentLoop.test.ts tests/components/V2AgentNode.agentloop.test.tsx tests/components/V2AgentNode.agentloop-persisted-run.test.tsx` | COUVERT | un scenario multi-LLM reel reste hors scope unitaire, mais le garde-fou logiciel est present |
| J7-08 | Absence de re-invocation en boucle sur echec deterministe | une erreur de preparation/readiness deterministe stoppe la tempete de retries | `tests/services/AgentLoop.test.ts` (qa-style fourfold retry storm on `web_search_py`), `backend/src/__tests__/sandbox.routes.test.ts` (409 provisioning / 503 runtime not ready) | `npm test -- tests/services/AgentLoop.test.ts backend/src/__tests__/sandbox.routes.test.ts` | COUVERT | aucune lacune critique immediate |
| J7-09 | Remontee claire d'une erreur wrapper TS | une erreur `Unexpected token ';'` est classee dans le bon sous-systeme et projetee de facon lisible pour QA | `backend/src/__tests__/docker-sandbox.runner.test.ts` (classifies eval syntax failures as wrapper syntax errors), `backend/src/__tests__/runtime-wrappers.test.ts` (wrapper syntactically valid), `tests/components/FunctionRunArtifactsPanel.test.tsx` (diagnostic QA + action recommandee), `tests/components/FunctionEditorTab.test.tsx` (notifications QA) | `npm test -- backend/src/__tests__/docker-sandbox.runner.test.ts backend/src/__tests__/runtime-wrappers.test.ts tests/components/FunctionRunArtifactsPanel.test.tsx tests/components/FunctionEditorTab.test.tsx` | COUVERT | conserver ce cas dans la batterie P0 car il correspond a un symptome QA historique majeur |

---

## 5. Lecture operative de la matrice

### 5.1 Cas J7 maintenant verrouilles

Les neuf scenarios minimaux imposes par le plan sont maintenant relies a des preuves automatisees explicites.

Cela signifie que la prochaine regression sur:

1. le parcours editeur TS/Python
2. la readiness native `web_search_py`
3. la pedagogie build/readiness
4. l'idempotence `AgentLoop`
5. la taxonomie d'erreur wrapper/runtime

doit casser une ou plusieurs suites de test avant de repasser en QA manuelle.

### 5.2 Limites connues de J7

Les limites residuelles ne sont pas des trous critiques J7, mais des approfondissements possibles:

1. scenario navigateur reel bout en bout pour Monaco + store + API + sandbox
2. campagne semi-automatique multi-LLM local sur machine QA de reference
3. extension de la matrice vers J8 pour les rotations d'images et les CVE runtime

---

## 6. Batterie minimale recommandee avant nouvelle campagne QA Tools

### P0 - a lancer en premier

```powershell
npm test -- tests/components/FunctionEditorTab.test.tsx tests/components/FunctionRunArtifactsPanel.test.tsx tests/components/SandboxHealthLoader.test.tsx tests/services/AgentLoop.test.ts backend/src/__tests__/sandbox.routes.test.ts backend/src/__tests__/transition-routes.test.ts backend/src/__tests__/runtime-health.service.test.ts backend/src/__tests__/docker-sandbox.runner.test.ts backend/src/__tests__/runtime-wrappers.test.ts
```

### P0 bis - semi-E2E navigateur reel sur l'editeur

```powershell
npm run test:j7:editor:semi-e2e
```

### P1 - renfort de validation

```powershell
npm test -- tests/components/PhilFunctionsPage.test.tsx tests/components/V2AgentNode.agentloop.test.tsx tests/components/V2AgentNode.agentloop-persisted-run.test.tsx backend/src/__tests__/pythonExecutor.test.ts backend/src/__tests__/build.service.test.ts backend/src/__tests__/execution-orchestrator.test.ts
```

---

## 7. Verdict J7 a ce stade

Verdict propose: `J7 COUVERT`.

Justification:

1. la matrice TNR demandee par le plan existe maintenant sous forme explicite
2. chaque scenario QA minimal J7 est rattache a des tests nommes
3. le cas le plus fragile du lot, la fonction Python simple depuis l'editeur, dispose desormais d'une preuve backend explicite sur la route sandbox

Le prochain jalon logique reste **Jalon 8**, centre sur l'hygiene des images sandbox et la politique de scan/remediation.