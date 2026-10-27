# Inventaire code V1/V2 - jalon J0

**Statut :** versionne pour gel architectural J0
**Date :** 2026-09-30
**Source backlog :** `Guides/Features/feature/refonte/backlog/v1-v2-refonte-backlog.md`
**Commande d'audit :** `npm run audit:workflow-architecture`

## 1. Objet

Ce document fige l'inventaire des points d'entree backend et frontend qui lisent, ecrivent ou reconstruisent des donnees workflow a partir des representations V1 et V2.

La cible canonique reste V2. Les surfaces V1 encore presentes sont tolerees uniquement pour compatibilite transitoire, guest mode local, migration ou chemins legacy explicitement deprecies.

## 2. Taxonomie de classification

- `V1_READ` : lecture directe d'une representation V1 comme source de verite active.
- `V1_WRITE` : ecriture directe d'une representation V1 ou d'un endpoint qui la manipule.
- `V2_READ` : lecture d'une representation V2 canonique.
- `V2_WRITE` : ecriture d'une representation V2 canonique.
- `COMPATIBILITY` : pont de compatibilite, reconstruction locale, dual-mode guest/auth, ou aggregation qui ne doit pas devenir une nouvelle autorite metier.
- `MIGRATION` : bootstrap, schema, adaptation ou conversion necessaire a la convergence V1 -> V2.
- `TEST_ONLY` : test, fixture ou support QA sans autorite de production.

## 3. Constats structurants J0

- L'autorite d'hydratation authentifiee est backend via `GET /api/user/workspace` et `buildWorkspaceSnapshot`.
- `App.tsx` et `hooks/useWorkspaceHydrationOrchestrator.ts` restent le point d'entree frontend principal de rehydratation et de reconstitution de l'etat interactif.
- `backend/src/routes/workflows.routes.ts` porte encore un melange de routes V2 actives et de routes V1 explicitement legacy.
- `backend/src/services/databaseInit.ts` conserve les champs `nodes` et `edges` dans le schema permissif MongoDB du document `workflows`, ce qui est une dette de migration et non une cible metier.
- Deux zones frontend supplementaires, non mises en avant dans la liste initiale du backlog J0, restent des surfaces de derive a surveiller : `stores/useWorkflowStore.ts` et `services/workspacePersistenceService.ts`.

## 4. Occurrences critiques classees

| Surface | Fichier | Classification | Pourquoi c'est critique | Remplacement ou suite cible |
|---|---|---|---|---|
| Workspace snapshot autoritatif | `backend/src/routes/user-workspace.routes.ts` | `V2_READ` | Charge le workspace utilisateur complet et alimente l'hydratation frontend | Conserver comme autorite de lecture jusqu'aux contrats J1 |
| Projection d'hydratation backend | `backend/src/utils/workspaceSnapshot.ts` | `COMPATIBILITY` | Agrege workflow, instances, edges, journaux et prototypes pour livrer un snapshot unique | Stabiliser les DTO canoniques en J1 |
| CRUD workflows principal | `backend/src/routes/workflows.routes.ts` | `COMPATIBILITY` | Fichier mixte : routes V2 utiles, compatibilite historique et endpoints legacy co-localises | Extraire la logique metier en J2, pas en J0 |
| Route legacy position node | `backend/src/routes/workflows.routes.ts` | `V1_WRITE` | `PATCH /:id/nodes/:nodeId/position` ecrit sur `Workflow.nodes[]` | Deprecie, instrumente, puis suppression ulterieure |
| Route legacy creation edge | `backend/src/routes/workflows.routes.ts` | `V1_WRITE` | `POST /:id/edges` utilise `$push` sur `Workflow.edges[]` | Deprecie, instrumente, puis suppression ulterieure |
| Route legacy suppression edge | `backend/src/routes/workflows.routes.ts` | `V1_WRITE` | `DELETE /:id/edges/:edgeId` utilise `$pull` sur `Workflow.edges[]` | Deprecie, instrumente, puis suppression ulterieure |
| CRUD instances | `backend/src/routes/agent-instances.routes.ts` | `V2_READ` et `V2_WRITE` | Autorite de persistance des instances d'agent et de leur configuration de runtime design | Garder comme write path canonique en attendant J2 |
| Lecture runs | `backend/src/routes/runs.routes.ts` | `V2_READ` | Expose les runs et artefacts via contrats deja separes du document workflow | Stabiliser les erreurs metier en J1 |
| Bootstrap et validateurs Mongo | `backend/src/services/databaseInit.ts` | `MIGRATION` | Maintient `canvasState`, `nodes`, `edges` et d'autres surfaces hybrides dans le schema permissif | Decoupage bootstrap/migrations/seed en J3 |
| Hydratation interactive frontend | `App.tsx` | `COMPATIBILITY` | Orchestration de switch de workflow et rehydratation, avec reconstruction d'etat canvas | Sortir cette orchestration de `App.tsx` en J5 |
| Orchestrateur d'hydratation | `hooks/useWorkspaceHydrationOrchestrator.ts` | `COMPATIBILITY` | Recompose prototypes, instances et noeuds V2 a partir du snapshot backend | Figer comme pont de compatibilite jusqu'aux contrats J1 |
| Adaptateurs de contrat | `services/agentContractAdapters.ts` | `MIGRATION` | Convertit les structures persistantes vers les types frontaux V2 | Remplacer progressivement par DTO stabilises J1 |
| Persistance workflow auth/guest | `services/persistenceService.ts` | `COMPATIBILITY` | Continue d'envoyer un payload workflow incluant `canvasState`, `nodes` et `edges` selon le mode | Recentrer sur des commandes V2 explicites en J5 |
| Persistance workspace legacy cachee | `services/workspacePersistenceService.ts` | `V1_WRITE` et `COMPATIBILITY` | `saveEdges()` pointe encore sur `/api/workflows/:id/edges`, surface legacy non documentee dans la liste prioritaire initiale | Documenter maintenant, neutraliser ou remplacer en J5/J2 selon usage reel |
| Store workflow legacy frontend | `stores/useWorkflowStore.ts` | `COMPATIBILITY` | Conserve un aggregate local `Workflow` avec `nodes`, `edges` et `saveWorkflow()` | Decoupler en J5 pour eviter une seconde verite concurrente |
| Hook de persistance workflow | `hooks/useWorkflowPersistence.ts` | `COMPATIBILITY` | Reconstruit un payload complet workflow avant appel de persistance | Garder sous audit strict jusqu'au cutover frontend |
| Canvas et sauvegarde zoom/pan | `components/WorkflowCanvas.tsx` | `V2_WRITE` | Persiste `canvasState` pour le workflow actif | Conserver, mais sans reintroduire de write path V1 |
| Types frontaux globaux | `types.ts` | `COMPATIBILITY` | Heberge encore des types de transition utilises par plusieurs surfaces d'hydratation et persistance | Rationaliser apres stabilisation des contrats J1 |

## 5. Occurrences complementaires a surveiller

Les occurrences suivantes ne doivent pas etre traitees comme autorite metier mais doivent rester sous audit :

- `tests/fixtures/workspaceHydration.fixtures.ts` : `TEST_ONLY`, fixture contractuelle d'hydratation V2.
- `backend/src/__tests__/workspace-snapshot.test.ts` : `TEST_ONLY`, preuve de non-regression du snapshot unifie.
- `backend/src/services/workflowSelfHealing.service.ts` : `COMPATIBILITY`, reparation defensive autour du workflow par defaut.
- `utils/guestDataUtils.ts` : `COMPATIBILITY`, cles legacy du guest mode local.
- `services/workflowService.ts` : `COMPATIBILITY`, service historique workflow/front a maintenir sous surveillance meme hors liste prioritaire J0.

## 6. Matrice QA/BDD et fixtures

| Surface | Fichier | Nature si adaptation future | Decision J0 |
|---|---|---|---|
| Hydratation frontend | `tests/fixtures/workspaceHydration.fixtures.ts` | `fonctionnel` | Aucune modification en J0. La forme actuelle sert de reference V2 cote frontend. |
| Snapshot backend | `backend/src/__tests__/workspace-snapshot.test.ts` | `fonctionnel` | Aucune modification en J0. Ce test doit rester vert pour prouver l'autorite du snapshot. |
| Seeds et bootstrap | `backend/src/services/databaseInit.ts` et `backend/src/seeds/**` | `donnees` | Aucun changement de fixture ou seed en J0. Risque documente pour J3 uniquement. |

## 7. Risques majeurs identifies

- Les trois routes legacy V1 de `backend/src/routes/workflows.routes.ts` sont encore accessibles et peuvent masquer un appel survivant cote frontend ou un usage externe.
- `services/workspacePersistenceService.ts` conserve un write path `PUT /api/workflows/:id/edges` qui n'apparait pas dans la liste de priorite initiale du backlog J0. C'est une zone oubliee a traiter avant J5.
- `stores/useWorkflowStore.ts` maintient un aggregate frontend `Workflow` avec `nodes` et `edges`, utile pour la compatibilite UI mais dangereux s'il redevient une source de verite persistante.
- Le schema permissif de `backend/src/services/databaseInit.ts` continue d'accepter `nodes` et `edges` sur `workflows`, ce qui rend la dette visible mais ne doit plus legitimiser de nouvelles ecritures metier.

## 8. Garde-fous J0 poses

- Script d'audit reproductible : `scripts/audit-workflow-architecture.ts`.
- Commandes npm exposees : `audit:workflow-architecture` et `audit:workflow-architecture:strict`.
- Routes V1 legacy de `backend/src/routes/workflows.routes.ts` instrumentees avec headers de depreciation, compteur en memoire et logs explicites.

## 9. Handoff vers J1

- Stabiliser des DTO canoniques separes pour workflow, node, edge, run et task.
- Convertir les ponts de compatibilite identifies ici en contrats explicites, sans reintroduire de write path V1.
- Traiter en priorite la matrice de permissions et la dette WebSocket deja signalee par le backlog.