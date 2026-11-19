# US-J7-13 — Plan UI détaillé : cutover J5 (toolbar, commandes, statuts runtime) + quarantaine (Reset & Relance)

**Auteur :** `09-architecte-applicatif`
**Date :** 2026-11-19
**Pour :** agent `06-frontend.agent.md` (responsable US-J7-13), co-responsable `08-testeur-e2e.agent.md` pour la campagne semi-E2E
**Références :** backlog US-J7-13 ; `Guides/Features/WORKFLOWLINKS/README.md` (écarts J5 1–3) ; `Guides/UX/APP_DESIGN.md` (charte graphique) ; conception `j7-02-quarantine-exit-fencing-design.md` §4–5 (endpoint `fence-and-retry`, événements `run:quarantined`/`run:fenced`/`run:recovery_relaunched`)

---

## 1. Périmètre impacté (constaté au 2026-11-19)

| Élément | Fichier | État actuel |
|---|---|---|
| Barre de commandes | `components/workflow/WorkflowToolbar.tsx` (335 l) | Complète mais **montée nulle part** ; `Pause` appelle `cancelRun` ; pas de confirmation ; `isOffline/isPartial` en dur `false` ; statuts `worker_lost`/`quarantined` absents |
| Routeur / pages carte | `components/RobotPageRouter.tsx` | `WorkflowPage` existe pour `bosDashboard` et `bosSupervision` ; la toolbar n'y est pas montée |
| Store runtime | `stores/useRuntimeStore.ts` | `runStatuses`, `taskStatuses`, `runtimeConnectionState`, `latestRuntimeEvent` existent mais **aucun composant ne les lit** |
| Service run | `services/workflowRunService.ts` | `listWorkflowRuns`, `launchRun`, `getRun`, `cancelRun` ; **pas de `retryRun` ni `fenceAndRetry`** |
| Politique d'actions | `services/runtimeActionPolicy.ts` | Gère `loading/offline/partial` ; à étendre aux nouveaux statuts |
| Types statuts | `types/function.types.ts` | `worker_lost`/`quarantined` à ajouter |
| i18n | `i18n/{de,en,es,fr,pt,ua,ru}.ts` + `locales.ts` | 8 langues à garnir pour tous les nouveaux libellés |
| Nœud agent | `components/V2AgentNode.tsx` (2095 l) | Badge de statut à ajouter (pastille coin supérieur droit) |
| Supervision | `components/BosWorkflowManagementPage.tsx` / page `bosSupervision` | Liste des runs + alertes `runtime_alerts` à afficher |

## 2. Réponses aux questions de cadrage

### 2.1 Où placer les boutons ?

- **Une seule barre de commandes, centralisée**, montée dans `WorkflowPage` (`RobotPageRouter.tsx`) **entre l'en-tête de page et le canvas**, uniquement sur `bosDashboard` et `bosSupervision` — jamais sur Archi/Com/Phil/Tim ni en gestion des workflows.
- **En flux layout, pas en overlay** : la hauteur de la barre (h-12) est retirée du conteneur `flex-1` du canvas pour ne **pas déplacer le viewport React Flow** (non-régression positions nodes/minimap/controls, déjà couverte par `WorkflowCanvas.route-reentry.semi-e2e.spec.ts` à étendre).
- **Sur le nœud agent : pas de boutons de commande**, seulement un **badge de statut** (pastille néon en coin supérieur droit du nœud). Le clic sur le badge ouvre le panneau de détail du run ; le clic sur le badge **quarantaine** ouvre directement la modale Reset & Relance.

### 2.2 Est-ce que ce sont les blocs d'agents qui déclenchent les process ?

Non. Le déclenchement reste **au niveau workflow** via la toolbar (`Lancer` → `POST /api/runs/execute` avec le `workflowId` courant du `useDesignStore`, `agentInstanceId` optionnel). Le nœud agent n'est **pas** un déclencheur : il affiche l'état du run de son `agentInstanceId` (filtré par `workflowId` courant). Cela évite la dispersion des commandes et garde une source unique de vérité d'affichage. (Le contrat serveur accepte un run ciblé par `agentInstanceId` ; l'UI ne l'expose pas comme bouton séparé dans cette US.)

### 2.3 Représentation graphique (charte `APP_DESIGN.md`)

Palette et règles issues de la charte (fond cosmique `#000814`, néons maîtrisés, sobriété, accessibilité WCAG + clavier complet, desktop uniquement) :

| État | Couleur / icône | Rendu |
|---|---|---|
| `queued` / `running` | Bleu néon `#00BFFF`, pastille pulse | Toolbar + badge nœud |
| `completed` | Halo laser succès (vert/bleu) | Toolbar + badge |
| `failed` | Rouge néon `#FF4500` + `ExclamationTriangleIcon` | Toolbar + badge + entrée supervision |
| `worker_lost` / `quarantined` | Rouge `#FF4500` + `ShieldAlertIcon` (à ajouter dans `Icons.tsx`) + indicateur **verrou tenu** (`lockHeld`) | Toolbar + badge nœud clignotant doucement + bandeau d'alerte + modale Reset & Relance |
| `stopped` / `timed_out` | Gris métallique `#A9A9A9` | Toolbar + badge |
| `reconnecting` / `degraded` (partial) | Jaune glow `#FFD700` | Bandeau `role="status"` `aria-live="polite"` |
| `offline` | Gris `#A9A9A9`, commandes de lancement désactivées | Bandeau + toolbar |
| `loading` / `empty` / `error` | Neutre, message localisé | Zone statut toolbar |

- Icônes vectorielles avec glow laser au hover (style `Icons.tsx` existant) : `PlayIcon` (Lancer), `StopIcon` (Annuler), `RefreshCwIcon` (Relancer = nouveau run), `ShieldAlertIcon` (Reset & Relance), `DownloadIcon`, `CogIcon`.
- **Retirer `Pause`** (pas de sémantique serveur) ; renommer `Reprendre` en **`Relancer`** (crée un nouveau run via retry, jamais de `resume`).
- Modales : `role="alertdialog"`, focus initial sur « Annuler l'action », Échap ferme, libellés localisés (8 langues), contraste WCAG.

### 2.4 Bouton Reset & Relance (consomme US-J7-07)

- Visible quand le run courant du workflow est `worker_lost` ou `quarantined` (ou `lockHeld` vrai).
- Modale explicative : run incertain, workspace verrouillé, fencing possible (borne 30 s), la relance crée un **nouveau run** (`retryOfExecutionId`, `recoveryAttemptCount` incrémenté) ; le parent reste immutable.
- Appel : `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry` avec header `Idempotency-Key: <uuid v4 généré côté client>`.
- Réponses : **202** → toast succès + mise à jour `runStatuses` + nouveau run `queued` ; **200 replay** → idem sans effet ; **409** `RUN_NOT_QUARANTINED` / `WORKSPACE_LOCKED_BY_OTHER_RUN` → message d'erreur localisé, état serveur conservé ; **504** `FENCING_TIMEOUT_ESCALATED` → alerte critique affichée (persistée dans `runtime_alerts`), verrou reste tenu.
- Événements reçus : `run:quarantined`, `run:fenced`, `run:recovery_relaunched` → mise à jour du badge/toolbar sans rechargement (via `useRuntimeStore`, filtrés par `workflowId`).

## 3. Todolist d'implémentation pour `06-frontend` (ordre recommandé)

1. **Types + i18n** : statuts `worker_lost`/`quarantined` (+ `lockHeld`) dans `types/function.types.ts` ; libellés dans les 8 langues (`workflow.status.*`, `workflow.quarantine.*`, `workflow.resetAndRelaunch.*`, modales, erreurs 409/504).
2. **Services** : `workflowRunService.ts` gagne `retryRun(executionId, idempotencyKey)` et `fenceAndRetry(workspaceId, runId, idempotencyKey)` ; `runtimeActionPolicy.ts` étendu (nouveaux statuts, `canResetAndRelaunch`, `lockHeld`).
3. **Store runtime** : consommer `useRuntimeStore` (runStatuses, runtimeConnectionState, latestRuntimeEvent), filtrage strict par `workflowId` courant ; aucun secret affiché/stocké.
4. **Toolbar** : monter `WorkflowToolbar` dans `WorkflowPage` (bosDashboard/bosSupervision uniquement, flux layout) ; brancher `isOffline`/`isPartial` sur le store ; retirer `Pause` ; renommer `Reprendre`→`Relancer` ; confirmation modale avant `Annuler` ; bandeau de connexion (`role="status"`).
5. **Badge nœud** : pastille de statut sur `V2AgentNode` (coin supérieur droit), clic → panneau détail ; badge quarantaine → modale Reset & Relance.
6. **Modale Reset & Relance** + mapping des réponses 202/200/409/504 + toasts/alertes.
7. **Supervision** : liste des runs du workflow avec statuts complets + `lockHeld` + alertes `runtime_alerts`.
8. **Tests** : composants (toolbar montée/absente selon route, 5 états + quarantaine, modales clavier), store (filtrage workflowId, événements), service (retry/fence-and-retry, idempotency), semi-E2E `WorkflowCanvas.route-reentry` étendu (positions identiques avec toolbar), `J7.Editor.RealBrowser.semi-e2e` à rejouer.
9. **Non-régression + validation** : `npm test`, `npm run test:components:ci`, `npm run test:canvas:non-regression`, `npm run test:j6:semi-e2e`, `npm run audit:workflow-architecture:strict`, `tsc --noEmit` (aucune erreur nouvelle vs baseline).

## 4. Critères d'acceptation (US-J7-13)

- Toolbar visible sur `/bos/dashboard` et `/bos/supervision`, absente ailleurs ; graphe lu dans `useDesignStore` uniquement.
- `Lancer`/`Annuler` (avec confirmation) / `Relancer` ; pas de `Pause`/`Reprendre` ; confirmation refusée = aucune commande ; erreur serveur = état autoritaire conservé.
- Statuts serveur + temps réel affichés (`queued/running/completed/failed/stopped/timed_out/worker_lost/quarantined`) + états `loading/empty/error/offline/partial` ; événements filtrés par `workflowId` ; refresh REST après reconnexion.
- Bouton **Reset & Relance** sur run `worker_lost`/`quarantined` : modale, appel `fence-and-retry` idempotent, réponses 202/409/504 gérées et affichées ; badge nœud + alerte en cas de verrou tenu.
- Commandes indisponibles quand run actif/terminal ou canal hors ligne/partiel ; accessibilité (clavier, focus, `role="status"`/`alertdialog`, WCAG).
- Playwright : positions nodes/minimap/controls identiques avec la toolbar, pendant un run et après retour/reload.
- Aucune régression des suites existantes ; audit strict OK.

## 5. Hors périmètre

- Écarts 5 (`saveEdges`) et 6 (tests reconnexion/parcours) de WORKFLOWLINKS : autre backlog, inchangé.
- Toute modification du contrat serveur (statuts, endpoint) relève de `03-backend` — ici on consomme le contrat livré par US-J7-05..J7-09.
