# MEDIAS - README

Statut: reference technique media et persistance workflow  
Public: agents codeurs, architectes, QA technique

---

## 1. Objet du dossier

Ce dossier documente le fonctionnement actuel des medias dans A-IR-DD2.

Il sert de point d'entree rapide pour comprendre:

1. comment un agent decide si un media doit etre persiste
2. ou les medias sont physiquement stockes selon le mode choisi
3. comment le journal, le catalogue media et le BOS explorer se completent
4. comment les artefacts de sandbox et les imports utilisateur rejoignent le meme catalogue workflow

---

## 2. Resume executif

Les invariants a retenir sont les suivants:

1. `PersistenceConfig` pilote la persistance media via `saveMedia`, `mediaStorage`, `allowWorkspaceWrite` et `cloudConnectionProfileId`.
2. Le journal reste la porte d'entree d'ecriture principale pour les medias rattaches a une conversation ou a un agent.
3. `MediaReference` est le catalogue canonique workflow-scoped utilise pour l'exploration, le preview, le download, les suppressions et la gestion des orphelins.
4. Le mode produit `db` correspond aujourd'hui a un stockage media porte par le journal MongoDB, pas a un depot documentaire separe.
5. Le mode `workspace` publie les medias et artefacts dans `Workspace.runtimeRoots.outputRoot`.
6. Le mode `cloud` s'appuie sur des profils cloud securises crees dans Parametres > Cloud; les agents ne doivent referencer qu'un `cloudConnectionProfileId`.
7. Les imports media d'un agent passent d'abord par un draft runtime, puis sont persistes via `POST /api/workflows/:workflowId/instances/:agentInstanceId/imported-media`.
8. Les sorties de sandbox Python/TypeScript sont auto-cataloguees par `ExecutionOrchestrator` et `MediaCatalogService` quand elles produisent des artefacts sous `output/`.
9. BOS lit le catalogue via un read model dedie; il ne doit pas reparcourir le journal brut a chaque affichage nominal.

---

## 3. Documentation a lire

- `ARCHITECTURE_MEDIA_ET_PERSISTANCE.md`

Ce document detaille:

1. les couches d'architecture
2. les contrats de donnees
3. les flux d'ecriture et de lecture
4. les points d'entree code les plus utiles
5. les limites produit a ne pas oublier lors des prochains refactors

---

## 4. Carte rapide du code

### Frontend

- `components/modals/AgentPersistenceForm.tsx`
- `components/modals/SettingsModal.tsx`
- `components/modals/BosMediaModal.tsx`
- `components/SavePrototypeButton.tsx`
- `components/V2AgentNode.tsx`
- `stores/useRuntimeStore.ts`

### Backend

- `backend/src/types/persistence.ts`
- `backend/src/routes/agent-instances.routes.ts`
- `backend/src/services/journal.service.ts`
- `backend/src/services/mediaCatalog.service.ts`
- `backend/src/services/workflowMediaExplorer.service.ts`
- `backend/src/repositories/MediaReferenceRepository.ts`
- `backend/src/models/MediaReference.model.ts`
- `backend/src/services/runtime/ExecutionOrchestrator.ts`

---

## 5. Regles d'implementation a conserver

1. Ne pas reintroduire de secrets cloud inline dans `persistenceConfig` cote frontend.
2. Ne pas contourner `normalizePersistenceConfigForPersistence()` / `normalizePersistenceConfigForProduct()` lors des writes prototype ou instance.
3. Ne pas traiter le journal brut comme read model BOS principal quand `MediaReference` peut faire autorite.
4. Ne pas supposer que tout media est un fichier workspace: les modes `db`, `workspace` et `cloud` doivent rester distincts.
5. Ne pas oublier qu'un media peut survivre a la suppression d'un agent sous forme d'orphelin catalogue.
