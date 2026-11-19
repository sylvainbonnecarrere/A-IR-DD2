# WORKFLOWLINKS - Commandes de run, confirmations et suivi runtime (ecarts J5)

**Date :** 2026-10-29
**Origine :** relecture de validation J5 (`Guides/Features/feature/refonte/backlog/v1-v2-refonte-backlog.md`, section "Etat de contexte J5").
**Agent responsable :** `06-frontend.agent.md`
**Statut :** ecarts 1 a 3 **FERMES** le 2026-11-19 (US-J7-13, agent `06-frontend`, branche `main`). Ecart 4 corrige le 2026-10-29. Ecarts 5 et 6 : autre backlog.

## 1. Etat de depart verifie

| Element | Fichier | Etat |
|---|---|---|
| Barre de commandes (executer, pause, arreter, reprendre) | `components/workflow/WorkflowToolbar.tsx` | Complete mais **montee nulle part** : seuls ses tests la rendent |
| Politique d'actions | `services/runtimeActionPolicy.ts` | Gere `loading`, `offline`, `partial` ; la toolbar passe `isLoading/isOffline/isPartial = false` en dur |
| Service de run V2 | `services/workflowRunService.ts` | `listWorkflowRuns`, `launchRun`, `getRun`, `cancelRun` (pas de reprise dediee) |
| Etat de run local | `stores/useWorkflowStore.ts` | `execution`, `executeWorkflow`, `pauseExecution`, `stopExecution` ; `pauseExecution` appelle aussi `cancelRun` |
| Observation temps reel | `stores/useRuntimeStore.ts` | `runStatuses`, `taskStatuses`, `runtimeConnectionState`, `latestRuntimeEvent` alimentes par `App.tsx` ; **aucun composant ne les lit** |
| Canal temps reel | `services/webSocketService.ts` | emet `runtimeEvent` et `connectionStateChanged` |

## 2. Ecart 1 - Monter la barre de commandes

**Objectif :** rendre les commandes de run accessibles a l'utilisateur sur la carte du workflow.

**Decision UX technique**
- Monter `WorkflowToolbar` dans `WorkflowPage` de `components/RobotPageRouter.tsx`, entre l'en-tete de page et le canvas, uniquement pour les routes qui utilisent le canvas (`bosDashboard`, `bosSupervision`).
- Ne pas la superposer au canvas : la hauteur de la barre est retiree du conteneur `flex-1` du canvas, pour ne pas decaler le viewport React Flow (regression deja corrigee, voir `tests/fonctionnels/WorkflowCanvas.route-reentry.semi-e2e.spec.ts`).
- La toolbar ne porte aucune logique metier serveur : elle lit `useWorkflowStore` (run) et `useDesignStore` (graphe V2, source unique des nodes/edges).

**Criteres d'acceptation**
- La barre est visible sur la carte du workflow pour un utilisateur authentifie ayant un workflow courant.
- Elle est absente sur les ecrans Archi, Com, Phil, Tim et en gestion des workflows.
- Les actions sont desactivees selon `resolveRuntimeActionPolicy` (pas de workflow, pas de node, run actif, etat terminal).
- Le positionnement du canvas et des nodes est identique avec et sans la barre apres aller-retour entre ecrans.

**Tests a ajouter**
- Composant : `RobotPageRouter` rend la toolbar sur `/bos/dashboard` et pas sur `/archi/prototyping`.
- Interaction : executer appelle `WorkflowRunService.launchRun` avec le `workflowId` du store de design.
- Non-regression : etendre `WorkflowCanvas.route-reentry.semi-e2e.spec.ts` pour verifier que les positions des nodes sont inchangees avec la barre montee.

## 3. Ecart 2 - Reprendre et confirmer l'annulation

**Constat**
- `Reprendre` est affiche quand la politique l'autorise, mais il rappelle `handleExecute` (nouveau lancement), pas une reprise serveur.
- `Pause` et `Arreter` appellent tous deux `cancelRun` : la pause n'existe pas cote contrat V2.
- Aucune confirmation avant l'annulation, action destructive.

**Decisions**
- Ne pas inventer de contrat local. Si le backend n'expose pas de route de reprise, `Reprendre` doit etre documente comme "relance d'un nouveau run" et libelle en consequence ; si une route existe ou est ajoutee (a faire valider par `03-backend.agent.md`), ajouter `resumeRun(executionId)` dans `workflowRunService`.
- Retirer ou renommer `Pause` tant qu'aucune semantique de pause serveur n'existe, pour ne pas presenter une annulation comme une pause.
- Confirmation obligatoire avant `Arreter` : dialogue modal accessible (role `alertdialog`, focus initial sur "Annuler l'action", echappement ferme, libelles localises dans `i18n/*.ts`).

**Criteres d'acceptation**
- Cliquer sur `Arreter` ouvre une confirmation ; `cancelRun` n'est appele qu'apres validation.
- Refuser la confirmation ne change ni `execution` ni le statut affiche.
- Une erreur serveur sur l'annulation est affichee et le statut reste celui du serveur.
- `Reprendre` n'est actif que depuis un etat autorise par `resolveRuntimeActionPolicy`.

**Tests a ajouter**
- Interaction : confirmer / refuser l'arret ; clavier (Tab, Echap).
- Service : `resumeRun` si le contrat existe ; sinon test documentant la relance.

## 4. Ecart 3 - Statuts temps reel et etats hors ligne

**Objectif :** afficher l'etat serveur reel des runs et tasks et l'etat du canal temps reel.

**Decisions**
- La toolbar derive le statut courant de `useRuntimeStore.runStatuses[executionId]`, puis de la derniere lecture `listWorkflowRuns`, et non plus d'un `useState` local alimente une seule fois.
- `isOffline` = `runtimeConnectionState` vaut `offline` ; `isPartial` = `degraded` ou `reconnecting`. Ces valeurs remplacent les `false` codes en dur dans `resolveRuntimeActionPolicy`.
- Un bandeau d'etat accessible (`role="status"`, `aria-live="polite"`) indique : connecte, reconnexion, degrade, hors ligne. Hors ligne : les commandes de lancement sont desactivees, la lecture du dernier statut serveur reste visible.
- Les evenements sont filtres par `workflowId` courant pour ne pas melanger les runs de plusieurs workflows.
- Etats a couvrir : `loading` (premiere lecture), `empty` (aucun run), `error` (lecture impossible), `offline`, `partial`.

**Criteres d'acceptation**
- Un evenement `run:started` puis `run:completed` met a jour l'etat affiche sans rechargement.
- Une coupure du socket affiche l'etat hors ligne et desactive le lancement ; le retour du socket le reactive.
- Un evenement d'un autre workflow ne modifie pas l'affichage.
- Aucun secret ni payload sensible n'est affiche ou conserve dans le stockage local.

**Tests a ajouter**
- Composant : rendu des cinq etats (`loading`, `empty`, `error`, `offline`, `partial`).
- Interaction : evenements `runtimeEvent` simules via le store ; transitions de connexion.
- Integration : parcours deconnexion / reconnexion du socket.

## 5. Ecart 4 - Verite concurrente de la V2 (corrige)

Fait le 2026-10-29 :
- `stores/useWorkflowStore.ts` ne porte plus de graphe : plus de `nodes`, `edges`, `variables`, liste `workflows`, ni de persistance locale `workflow-editor-data`. Il ne garde que les metadonnees du workflow courant, l'etat de run, l'etat de synchronisation et le panneau de configuration.
- `WorkflowToolbar` lit les nodes et edges dans `useDesignStore` ; la sauvegarde locale et l'import (stub `TODO`) ont ete retires, l'export serialise le graphe V2.
- Fichiers supprimes car sans importeur : `components/workflow/NodeConfigPanel.tsx` (ecrivait dans l'agregat local) et `hooks/useWorkflowIntegration.ts`.
- Tests adaptes : `WorkflowToolbar.runtime-gating`, `J4.4-AuthGuestIsolation` (x2), `WorkflowPersistence.TNR`.

## 6. Hors perimetre de ce dossier

- Ecart 5 (`WorkspacePersistenceService.saveEdges`) et ecart 6 (tests de reconnexion, statuts et parcours complet) : traites dans un autre backlog.
- Ordre recommande pour les ecarts 1 a 3 : 3 (statut et connexion), puis 1 (montage), puis 2 (confirmation / reprise), pour que la toolbar affiche un etat fiable des son premier montage.
- Handoff vers `08-testeur-e2e.agent.md` : uniquement apres fermeture des ecarts 1 a 3 et du backlog des ecarts 5 et 6.

## 7. Cloture des ecarts 1 a 3 (US-J7-13, 2026-11-19, agent `06-frontend`)

- **Ecart 1 (montage) — FERME.** `WorkflowToolbar` montee dans `WorkflowPage` (`components/RobotPageRouter.tsx`) entre le header et le canvas, uniquement sur `/bos/dashboard` et `/bos/supervision`, **en flux layout** (`shrink-0`, hauteur retiree du conteneur `flex-1 min-h-0` du canvas) : le viewport React Flow n'est pas deplace. Preuve non-regression : `WorkflowCanvas.route-reentry.semi-e2e.spec.ts` (positions nodes/minimap/controls + transform inchanges, toolbar visible, nom du workflow en header). Tests router : `tests/components/RobotPageRouter.toolbar.test.tsx` (4/4).
- **Ecart 2 (confirmation / reprise) — FERME.** `Pause` retire (aucune semantique serveur) ; commandes `Lancer`, `Annuler` (modale `alertdialog` accessible : focus initial, Echap, restauration du focus — `components/modals/AccessibleModal.tsx`), `Relancer` = nouveau run via `POST /api/runs/executions/:id/retry` avec `Idempotency-Key` uuid v4 (jamais de `resume`), et **Reset & Relance** = `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry` (202/200 OK ; 409 `RUN_NOT_QUARANTINED` / `WORKSPACE_LOCKED_BY_OTHER_RUN` et 504 `FENCING_TIMEOUT_ESCALATED` affiches via `RunCommandError` sans fermer l'etat serveur). Refus de confirmation = aucun appel serveur.
- **Ecart 3 (statuts temps reel / hors ligne) — FERME.** `useWorkflowRunSync(workflowId)` (`hooks/useWorkflowRuntimeState.ts`) : lecture REST autoritaire `GET /api/runs?workflowId=…` au montage, apres reconnexion, sur evenement du meme workspace (filtrage strict `workspaceId`) et poll 30 s ; ecrit dans `useRuntimeStore` (`setRunSnapshot`) — aucun graphe local concurrent. `useWorkflowRunStatus` / `useInstanceRunStatus` lisent des primitives stables (zustand v5). Zone `role="status"` + bandeau de connexion (`data-testid="workflow-connection-banner"`) ; commandes desactivees hors ligne/partiel/en erreur/sans graphe.
- **Confort US-J7-13 + retours graphiques 2026-11-19 :** badge de statut fidele dans les **3 representations** du noeud (minimise `compact`, normal, `FullscreenChatModal`) via `RunStatusBadge` (`data-testid="node-run-status-badge"`, clic quarantaine -> Reset & Relance, sinon detail du run). Dans la toolbar : **diode LED de connexion** (`workflow-connection-led`, vert/rouge/ambre) avec **bulle au survol** (`workflow-connection-bubble`) placée DEVANT le nom du workflow, affiche en **jaune doré BOS** `text-yellow-400` (`workflow-current-name`, tronqué + tooltip) — le header de page ne porte plus le nom (doublon retiré). Résultats de commandes **et avertissements de validation** (clic Lancer sur graphe invalide) en **toast flottant haut-droite** via `NotificationDisplay` (`notification-toast`, vert/rouge/orange), aucun panneau inline sous la toolbar. i18n : 6 locales (`fr,en,ua,de,es,pt`).
- **Tests :** `WorkflowToolbar.j7-13.test.tsx` 10/10 (vrais store/hooks, service mocke), `WorkflowToolbar.runtime-gating.test.tsx`, `runtimeActionPolicy.test.ts` 11/11, `useRuntimeStore.runtime-events.test.ts` 8/8, `workflowRunService.test.ts` 13/13, `RunStatusBadge.test.tsx` 7/7, `RobotPageRouter.toolbar.test.tsx` 4/4, semi-e2e route-reentry (assertions toolbar + `workflow-current-name` dans la toolbar + positions viewport inchangees) ; j7-13 : toast `notification-toast` data-type=success/warning (succès commande + warnings validation, aucun lancement si graphe invalide), LED `workflow-connection-led` offline/connected, nom en `text-yellow-400`.
- **Validations (2026-11-19) :** `test:components:ci` 34 suites / 136 tests PASS ; `test:canvas:non-regression` 14/14 PASS ; `tests/stores` + `tests/services` 21 suites / 114 tests PASS ; `test:j6:semi-e2e` 11/11 PASS (Playwright chromium) ; `audit:workflow-architecture:strict` OK ; `tsc --noEmit` racine : 13 erreurs, toutes pre-existantes au baseline HEAD (aucune nouvelle).
- Handoff `08-testeur-e2e` : ecarts 1 a 3 de ce dossier sont fermes ; ecarts 5 et 6 restent dans leur backlog.
