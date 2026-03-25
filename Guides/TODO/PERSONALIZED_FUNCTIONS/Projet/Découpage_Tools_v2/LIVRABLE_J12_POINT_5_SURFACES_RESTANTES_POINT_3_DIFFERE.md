# LIVRABLE J12 - POINT 5

> Date: 25 mars 2026
> Auteur logique: ARC-1
> Objet: liste precise des surfaces restantes pour le point n°3 differe, classees par risque architectural

---

## 1. Objet du livrable

Ce livrable prepare la suite du J12 en isolant les surfaces encore concernees par le **point n°3 differe**.

Le but n'est pas d'implementer ces changements maintenant. Le but est de fournir aux architectes et a la future phase QA une **cartographie actionnable**, avec:

1. les surfaces exactes encore legacy ou hybrides
2. leur niveau de risque architectural
3. la nature de la regression possible si on les renomme trop tot
4. l'ordre recommande pour les traiter plus tard

Ce document prolonge la passe sure deja effectuee sur les libelles visibles et les commentaires peu risqués.

---

## 2. Perimetre du point n°3 differe

Le point n°3 differe couvre les surfaces ou la terminologie n'est plus seulement textuelle, mais **porte un contrat actif**:

1. routes backend encore exposees sous le vocabulaire `functions`
2. DTO et payloads qui conservent `functionId` ou `functionIds`
3. persistence legacy `user_functions` encore branchee dans la compatibilite
4. facades de transition qui exposent un read model legacy au-dessus de `user_tools`
5. projections runtime/frontend ou `toolId` et `functionId` cohabitent dans les memes objets

Ces surfaces n'ont pas ete touchees dans la premiere passe car elles peuvent casser:

1. la compatibilite frontend/backend
2. les tests de coexistence legacy/cible
3. la relecture des runs persistés
4. la trajectoire additive `user_functions -> user_tools`

---

## 3. Methode de classement

### Risque eleve

Surface qui touche un contrat public, la persistence, une route backend, ou un mecanisme de transition actif.

### Risque moyen

Surface interne ou de facade qui ne casse pas directement le contrat public, mais dont la modification peut desaligner stores, projections, selecteurs ou tests transverses.

### Risque faible

Surface surtout cosmetique, documentaire ou interne, encore imparfaitement nommee, mais sans impact contractuel majeur si elle est traitee plus tard.

---

## 4. Surfaces restantes par risque

## 4.1 Risque eleve

### A. Routes backend legacy `functions` encore actives

**Fichiers pivots**:

1. `backend/src/routes/functions.routes.ts`
2. `services/toolRepository.ts`
3. `backend/src/__tests__/legacy-tools-coexistence.test.ts`
4. `backend/src/__tests__/function-runs.routes.test.ts`

**Surface precise**:

1. `/api/functions`
2. `/api/functions/:id`
3. `/api/functions/:id/build`
4. `/api/functions/:id/build-status`
5. `/api/functions/:id/runs/*`

**Pourquoi c'est risque**:

1. ces routes sont encore appelees pour la creation, l'edition, le toggle et une partie des runs
2. elles coexistent avec `/api/tools` et documentent explicitement une phase de transition
3. plusieurs tests verifient cette coexistence comme invariant de non-regression

**Regression probable si renommage premature**:

1. rupture Phil sur creation/edition custom
2. casse des TNR de coexistence legacy/cible
3. divergence entre build/runs selon le point d'entree appele

**Decision recommandee**:

Reporter tout renommage de route a une phase de cutover explicite, avec doubles routes ou facade de redirection testee.

### B. Payload sandbox encore centres sur `functionId`

**Fichiers pivots**:

1. `backend/src/routes/sandbox.routes.ts`
2. `services/llm/AgentLoop.ts`
3. `services/toolRepository.ts`
4. `backend/src/services/sandbox.service.ts`
5. `backend/src/__tests__/sandbox.routes.test.ts`
6. `tests/services/AgentLoop.test.ts`

**Surface precise**:

1. `POST /api/sandbox/run` attend `functionId`
2. `toolSelection.toolId` reste additif et non canonique seul
3. la validation Zod du run impose encore `functionId` en ObjectId

**Pourquoi c'est risque**:

1. le run editor, l'AgentLoop et les tests passent encore par ce contrat mixte
2. le backend resout toujours le contexte de run a partir du miroir legacy
3. le payload actuel est justement ce qui maintient la compatibilite pendant la convergence

**Regression probable si renommage premature**:

1. casse immediate des executions sandbox
2. perte de compatibilite entre `toolId` canonique et `_id` legacy miroir
3. faux positifs sur validation requete

**Decision recommandee**:

Ne toucher ce contrat qu'apres definition d'un payload cible unique `toolId-first`, plus plan de migration des clients et TNR complets.

### C. Persistence legacy `user_functions` encore autorite de transition

**Fichiers pivots**:

1. `backend/src/models/UserFunction.model.ts`
2. `backend/src/services/databaseInit.ts`
3. `backend/src/services/userToolStartupSync.service.ts`
4. `backend/src/migrations/004_tools_v2_function_registry.ts`
5. `backend/src/services/function.service.ts`
6. `backend/src/services/userToolMirror.service.ts`

**Surface precise**:

1. collection Mongo `user_functions`
2. seed natif encore injecte dans `user_functions`
3. sync de demarrage `user_functions -> user_tools`
4. mirror additif `_id` legacy vers `user_tools`

**Pourquoi c'est risque**:

1. la migration est additive et non terminee
2. la startup sync suppose encore l'existence du registre legacy
3. une suppression ou un renommage partiel casserait l'amorcage et la convergence a chaud

**Regression probable si renommage premature**:

1. perte du seed natif ou duplication d'entites
2. outillage incoherent entre base legacy et base cible
3. drift entre services de lecture et services de build/run

**Decision recommandee**:

Traiter cette surface uniquement avec un plan BDD dedie, sequence de migration reversible et validation sur base de donnees reelles de dev.

### D. Champs de prototype/instance encore hybrides `tools` / `functionIds` / `toolSelections`

**Fichiers pivots**:

1. `types.ts`
2. `services/agentPrototypeAPI.ts`
3. `backend/src/models/AgentInstance.model.ts`
4. `backend/src/utils/transforms.ts`
5. `components/modals/AgentFormModal.tsx`
6. `components/modals/AgentConfigurationModal.tsx`
7. `tests/components/ArchiToolSelectionModals.test.tsx`

**Surface precise**:

1. `Agent.functionIds`
2. `functionInheritance.overrideFunctionIds`
3. `AgentInstance.tools`
4. `legacyTools`
5. `toolSelections`

**Pourquoi c'est risque**:

1. ces champs assurent la compatibilite entre prototype frontend, instance backend et registry cible
2. le mapping actuel conserve plusieurs representations pour eviter un big bang
3. Archi et Bos relisent encore ces champs selon les etapes du flux

**Regression probable si renommage premature**:

1. selection d'outils perdue dans Archi
2. inheritance d'instance partiellement deserialisee
3. hydration incoherente entre prototype et instance

**Decision recommandee**:

Converger plus tard en deux temps: d'abord stabiliser la source canonique de persistence, ensuite supprimer les alias legacy un par un avec migration de lecture/ecriture.

### E. Projections de run et d'artefacts avec double identifiant `toolId` / `functionId`

**Fichiers pivots**:

1. `components/workflow/ToolCallBlock.tsx`
2. `services/bosRunProjectionService.ts`
3. `services/llm/AgentLoop.ts`
4. `types.ts`
5. `backend/src/services/userToolRunQuery.service.ts`
6. `tests/components/ToolCallBlock.test.tsx`
7. `tests/components/V2AgentNode.bos-hydration.test.tsx`
8. `tests/components/V2AgentNode.agentloop-persisted-run.test.tsx`

**Surface precise**:

1. `ToolCallRecord.toolId`
2. `ToolCallRecord.functionId`
3. fallback Bos et UI sur `toolId || functionId`
4. endpoints artefacts encore construits avec un identifiant de tool transmis sous nom de variable `functionId`

**Pourquoi c'est risque**:

1. cette double cle sert a rehydrater les runs persistés sans perdre l'historique legacy
2. Bos relit les executions via ce fallback
3. les artefacts et la projection de statut dependent encore de ce couplage

**Regression probable si renommage premature**:

1. Bos ne relit plus certains runs historiques
2. preview/download d'artefacts casse pour les messages legacy
3. tests transverses J10/J11 rouges

**Decision recommandee**:

Garder la dualite jusqu'a preuve que tous les producteurs et consommateurs emettent `toolId` de bout en bout.

---

## 4.2 Risque moyen

### F. Facades de lecture qui re-projettent un modele legacy au-dessus de `user_tools`

**Fichiers pivots**:

1. `backend/src/services/toolReadAdapter.service.ts`
2. `backend/src/services/userToolQuery.service.ts`
3. `types/function.types.ts`
4. `services/toolRepository.ts`

**Surface precise**:

1. `listLegacyFunctions()`
2. `getLegacyFunctionById()`
3. mapping `ToolTransitionReadModel -> FunctionReadModel/UserFunction`
4. `legacyFunctionId` et `compatibilityAliases.functionId`

**Pourquoi c'est risque moyen**:

1. ce n'est pas une route publique en soi, mais c'est la charniere entre backend cible et frontend legacy
2. toute simplification prematuree peut casser Phil sans casser immediatement les routes

**Decision recommandee**:

Traiter apres les contrats eleves, avec une campagne de simplification backend-first puis frontend.

### G. Repository frontend avec variables encore nommees `functionId` pour des ids canoniques

**Fichiers pivots**:

1. `services/toolRepository.ts`
2. `components/FunctionEditorTab.tsx`
3. `components/PhilFunctionsPage.tsx`

**Surface precise**:

1. parametres `functionId` qui contiennent deja parfois un `toolId`
2. appels build via `/api/tools/:id/*`
3. appels runs via `/api/runs?toolId=...`
4. appels sandbox encore via `functionId`

**Pourquoi c'est risque moyen**:

1. l'implementation fonctionne, mais la semantique est hybride
2. le renommage isolé peut creer un faux sentiment de convergence alors que les contrats backend ne suivent pas encore

**Decision recommandee**:

Reporter le renommage interne jusqu'a ce que la matrice des contrats backend soit stabilisee.

### H. Selection et resolution d'outils dans Archi encore adossees a des alias legacy

**Fichiers pivots**:

1. `services/toolSelectionResolver.ts`
2. `components/FunctionSelector.tsx`
3. `tests/services/toolSelectionResolver.test.ts`
4. `tests/components/FunctionSelector.test.tsx`

**Surface precise**:

1. fallback sur `_id`
2. resolution `toolId ?? _id`
3. `selectedIds` pouvant contenir legacy ou canonique

**Pourquoi c'est risque moyen**:

1. le selecteur sert d'amortisseur pendant la migration
2. le retirer trop tot peut invisibiliser des selections encore persistées en legacy

**Decision recommandee**:

Ne purger cette couche qu'apres migration effective de toutes les donnees de selection en base et dans les snapshots frontend.

---

## 4.3 Risque faible

### I. Nommage local des etats UI encore oriente `function`

**Fichiers pivots**:

1. `components/PhilFunctionsPage.tsx`
2. `tests/components/PhilFunctionsPage.test.tsx`

**Surface precise**:

1. `selectedFunctionId`
2. `FunctionLibraryTab`
3. quelques labels internes et noms de callbacks

**Pourquoi c'est faible**:

1. la semantique visible principale a deja ete securisee
2. ces noms locaux ne cassent pas les contrats exterieurs

**Decision recommandee**:

Traiter seulement en fin de convergence, quand les contrats backend et stores sont clarifies.

### J. Commentaires et docs techniques actives hors surfaces deja purgées

**Fichiers pivots**:

1. `backend/src/models/UserFunction.model.ts`
2. `backend/src/models/AgentInstance.model.ts`
3. `Guides/Features/TOOLS/README.md`

**Surface precise**:

1. commentaires rappelant `user_functions` comme registre actif
2. mentions historiques utiles mais encore hybrides

**Pourquoi c'est faible**:

1. ces formulations n'induisent pas directement une execution ou une persistence incorrecte
2. elles peuvent etre revues en toute fin, une fois la cible contractuelle decidee

**Decision recommandee**:

Les nettoyer dans la passe documentaire finale, pas avant.

---

## 5. Ordre recommande de traitement futur

### Vague 1 - Architecture/contrats

1. definir le contrat cible unique pour build, run, detail et artefacts
2. decider si `/api/functions` reste facade officielle ou devient simple compat layer
3. definir le payload cible de sandbox centré `toolId`

### Vague 2 - Persistence/migration

1. fermer le role exact de `user_functions`
2. choisir la strategie finale de sync ou de decommission
3. preparer les scripts et TNR de migration

### Vague 3 - Frontend convergence

1. simplifier `toolRepository`
2. converger les stores et selections Archi
3. purger les fallbacks `functionId` dans Bos/ToolCallBlock quand les producteurs sont tous cibles

### Vague 4 - Purge finale de vocabulaire

1. renommer variables locales et tests restants
2. nettoyer commentaires et docs actives
3. supprimer les alias inutiles apres preuve QA

---

## 6. Recommandations pour la future QA acceptance

La future phase QA devrait demander une liste d'acceptance particulierement sur les points suivants:

1. creation, edition, build et run Phil sans rupture entre `/api/functions`, `/api/tools` et `/api/sandbox/run`
2. selection d'outils Archi avec donnees legacy et canoniques coexistantes
3. relecture Bos d'anciens runs contenant seulement `functionId`
4. download et preview d'artefacts apres refresh
5. redemarrage backend avec startup sync legacy -> cible sans drift fonctionnel

Autrement dit, la QA devra verifier les **zones de frontiere**, pas seulement les parcours nominaux deja modernises.

---

## 7. Synthese executive

Les surfaces restantes du point n°3 differe ne sont pas surtout des libelles; ce sont des **surfaces de coexistence contractuelle**.

Le coeur du risque architectural est concentre dans cinq blocs:

1. routes `/api/functions`
2. payload sandbox `functionId`
3. persistence `user_functions`
4. champs hybrides `functionIds/tools/toolSelections`
5. projection runtime `toolId/functionId`

Tant que ces blocs ne sont pas traites dans un plan de convergence explicite, la bonne strategie reste celle appliquee jusqu'ici:

1. purger les termes faux uniquement sur les surfaces non contractuelles
2. documenter precisement les zones restantes
3. attendre le retour architectes + QA acceptance avant d'ouvrir la vague de refactor risquee
