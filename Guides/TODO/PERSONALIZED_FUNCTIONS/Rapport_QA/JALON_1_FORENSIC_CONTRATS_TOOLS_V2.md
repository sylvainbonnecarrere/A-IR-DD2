# JALON 1 - FORENSIC DES CONTRATS TOOLS V2

**Statut**: analyse technique initiale  
**Public cible**: codeur-specialiste, architectes, chef de projet  
**Source**: Jalon 1 du plan de correction intensif Tools V2 post-QA  
**Objet**: figer les contrats reels du systeme avant toute correction

---

## 1. Mission du jalon

Ce livrable ne propose pas encore de correctifs.
Il etablit la cartographie **reelle** du systeme Tools V2 a partir du code.

Objectifs atteints par ce document:

1. identifier les sources de verite effectives et concurrentes
2. classifier les categories de tools/fonctions actuellement manipulees
3. lister les workflows reellement autorises selon la categorie
4. figer les statuts d'erreur et leur signification metier
5. remonter les incoherences critiques qui expliquent les echec QA

---

## 2. Corpus analyse

Analyse effectuee sur les zones suivantes:

1. `backend/src/models/UserFunction.model.ts`
2. `backend/src/models/UserTool.model.ts`
3. `backend/src/services/build.service.ts`
4. `backend/src/services/sandbox.service.ts`
5. `backend/src/services/toolReadAdapter.service.ts`
6. `backend/src/services/userToolQuery.service.ts`
7. `backend/src/services/function.service.ts`
8. `backend/src/routes/functions.routes.ts`
9. `backend/src/routes/tools.routes.ts`
10. `backend/src/routes/sandbox.routes.ts`
11. `types/function.types.ts`
12. `services/toolRepository.ts`
13. `stores/useFunctionStore.ts`
14. `services/toolSelectionResolver.ts`
15. `services/llm/AgentLoop.ts`
16. `components/FunctionEditorTab.tsx`
17. `backend/src/__tests__/build.service.test.ts`
18. `backend/src/__tests__/sandbox.routes.test.ts`

---

## 3. Constat directeur

Le systeme n'a pas une seule source de verite uniforme.
Il repose aujourd'hui sur une convergence inachevee entre:

1. `user_functions` comme modele legacy editable et historique
2. `user_tools` comme registre cible versionne
3. un read-model frontend `UserFunction` qui est en realite une projection hybride du registre `user_tools`

Cette convergence fonctionne partiellement, mais produit plusieurs ambiguïtés structurelles:

1. l'editeur pense manipuler des `functions`
2. le build frontend passe par `/api/tools/:id/build`
3. le CRUD frontend passe encore par `/api/functions`
4. l'execution manuelle en sandbox peut ne pas porter la meme information de version/contexte que l'execution agentique
5. les natifs existent a la fois comme objets legacy readonly et comme tools natifs versionnes

Conclusion forensic:

Le systeme manipule deja un **registre cible** mais expose encore un **langage legacy** a plusieurs points de l'UI et du runtime.
Le Jalon 2 et les suivants ne doivent pas corriger les symptomes sans traiter cette asymetrie.

---

## 4. Matrice des categories reelles

## 4.1 Vue synthetique

| Categorie | Stockage principal | Identifiant utilise | Editable | Versionnee | Build/preparation actuel | Execution sandbox |
| --- | --- | --- | --- | --- | --- | --- |
| Fonction legacy custom | `user_functions` + miroir `user_tools` | `_id` fonction, souvent egal a `toolId` | Oui | Version simple | `BuildService.prepareFunction` | Oui |
| Fonction legacy native | `user_functions` readonly + projection `user_tools` native | `_id` fonction | Non | Version simple | pas de preparation securisee homogene | Oui |
| Tool cible user | `user_tools` scope `user` | `_id` tool | Selon version/source | Oui | `BuildService.prepareToolVersion` | Oui |
| Tool cible native | `user_tools` scope `native` | `_id` tool | Non | Oui | refuse aujourd'hui `prepareToolVersion` | Oui, mais de facon incoherente selon le chemin |
| Tool read-model frontend | projection `ToolTransitionReadModel -> UserFunction` | `toolId` + `legacyFunctionId` | Apparence legacy | Projection de version courante | frontend appelle `/api/tools/:id/build` | Oui |
| Tool agent-selectable | `ToolSelection` / `ToolRegistryReadModel` | `toolId` + `versionRef` | N/A | Oui | readiness attendue mais incomplete | Oui |

## 4.2 Detail des categories

### A. Fonction legacy custom

Definition reelle:

1. document `UserFunction`
2. `origin = custom`
3. `isReadonly = false`
4. `userId != null`
5. `workflowId` nullable

Caracteristiques:

1. editable via `/api/functions/:id`
2. supprimable
3. togglable
4. buildable via `BuildService.prepareFunction` seulement si `workflowId != null`
5. build readiness requise au run si dependances declarees et si origine custom avec workflow scope

### B. Fonction legacy native

Definition reelle:

1. document `UserFunction`
2. `origin = native`
3. `isReadonly = true`
4. `userId = null`

Caracteristiques:

1. non editable
2. non supprimable
3. togglable globalement
4. non buildable via `prepareFunction`
5. executee manuellement en sandbox via le chemin legacy si on ne passe pas par `toolSelection`

Point critique:

Le modele legacy native bypass aujourd'hui une partie de la logique versionnee de preparation.

### C. Tool cible user

Definition reelle:

1. document `UserTool`
2. `scopeType = user`
3. `ownerUserId != null`
4. `currentVersion` + `versions[]`
5. `isReadonly = false`

Caracteristiques:

1. versionne
2. buildable via `prepareToolVersion` si workflow scope et scope `user`
3. utilisable par les agents via `ToolSelection`

### D. Tool cible native

Definition reelle:

1. document `UserTool`
2. `scopeType = native`
3. `ownerUserId = null`
4. `isReadonly = true`
5. `trustLevel` attendu `internal`

Caracteristiques:

1. versionne dans le registre cible
2. lisible par le frontend via `/api/tools`
3. non buildable aujourd'hui par `prepareToolVersion` car `loadBuildableTool` refuse `scopeType !== user || isReadonly`

Point critique:

Le registre cible sait decrire un natif versionne, mais le service de preparation ne sait pas encore lui associer un workflow de preparation securisee gouverne.

### E. Tool read-model frontend

Definition reelle:

1. projection `ToolTransitionReadModel -> UserFunction` dans `services/toolRepository.ts`
2. l'editeur consomme un type `UserFunction` qui n'est plus strictement la forme legacy mongo

Point critique majeur:

Dans `services/toolRepository.ts`, le mapping vers `UserFunction` fixe aujourd'hui `userId` a `null` meme pour les customs.
Cette perte d'information montre que le read-model frontend n'est pas une representation fidele du modele metier.

### F. Tool agent-selectable

Definition reelle:

1. `ToolSelection` construit par `buildToolSelectionsFromFunctions`
2. contient `toolId` + `versionRef`
3. consomme par `AgentLoop` puis `/api/sandbox/run`

Caracteristiques:

1. plus proche du modele cible que l'editeur legacy
2. soumet explicitement `toolSelection`
3. declenche le chemin versionne dans `SandboxService.resolveVersionedExecutionTarget`

Point critique:

Ce chemin plus cible est aussi celui qui heurte le plus visiblement la faille de preparation des natifs.

---

## 5. Sources de verite et conflits d'autorite

## 5.1 Source de verite actuelle par responsabilite

| Responsabilite | Source dominante actuelle | Observation |
| --- | --- | --- |
| Creation/mise a jour fonction custom | `user_functions` via `FunctionService` | le registre `user_tools` est mis a jour par miroir |
| Lecture catalogue editeur | `user_tools` via `ToolReadAdapterService` | puis reprojete en `UserFunction` |
| Build editeur | `user_tools` via `/api/tools/:id/build` | pas via `/api/functions/:id/build` |
| Execution manuelle editeur | `/api/sandbox/run` avec `functionId` seul | chemin plus legacy |
| Execution agentique | `/api/sandbox/run` avec `functionId + toolSelection` | chemin plus cible |
| Selection de version | `user_tools.currentVersion` / `versionRef` | indisponible clairement dans l'editeur |

## 5.2 Conclusion

Le systeme a deja bascule la lecture et le build vers le registre cible, mais conserve:

1. un CRUD legacy
2. un runtime manuel partiellement legacy
3. une semantique UI encore centrée sur `function`

C'est une **coexistence non stabilisee**, pas une migration terminee.

---

## 6. Matrice des workflows autorises au moment de l'audit

## 6.1 Tableau de verite metier

| Operation | Legacy custom | Legacy native | Tool user versionne | Tool native versionne | Observation forensic |
| --- | --- | --- | --- | --- | --- |
| Lire dans l'editeur | Oui | Oui | Oui via projection | Oui via projection | tout passe par `/api/tools` cote frontend |
| Editer code | Oui | Non | Oui indirectement via legacy | Non | le write principal reste legacy |
| Sauvegarder | Oui | Non | Oui via miroir | Non | modele d'autorite encore ambigu |
| Build auteur | Oui si workflowId | Non | Oui si scope `user` et workflow scope | Non aujourd'hui | faille centrale pour les natifs |
| Preparation securisee plateforme | Non industrialisee | Non industrialisee | partielle | absente | chantier a ouvrir |
| Run manuel editeur | Oui | Oui | Oui via projection | Oui via projection | mais sans meme niveau de contexte versionne |
| Run agent | Oui | Oui | Oui | Oui | natifs cassent sur readiness versionnee |
| Dependency readiness explicite | Partielle | Non | Partielle | Non | aucune taxonomie stabilisee |

## 6.2 Conclusion

Le systeme autorise deja l'execution sandbox des natives et des customs, mais ne leur applique pas encore un **mode de preparation securisee homogène**.

Le risque central est donc le suivant:

1. l'autorisation d'executer existe
2. l'autorisation de preparer est partielle
3. la readiness dependances est incoherente selon le chemin d'appel

---

## 7. Table de verite des erreurs observables

## 7.1 Cote sandbox route

Depuis `backend/src/routes/sandbox.routes.ts`:

| Condition | Statut HTTP | Message attendu |
| --- | --- | --- |
| `functionId` invalide | 400 | validation echouee |
| fonction introuvable | 404 | fonction introuvable ou acces non autorise |
| fonction desactivee | 403 | fonction desactivee |
| preparation requise | 409 | `prepared via the build workflow` ou message `BuildPreparationError` |
| runtime non pret | 503 | `RuntimeNotReadyError` |
| timeout | 408 | timeout execution |
| autre erreur | 500 | erreur sandbox generique |

## 7.2 Cote build routes

Depuis `backend/src/routes/functions.routes.ts` et `backend/src/routes/tools.routes.ts`:

| Route | Condition | Statut |
| --- | --- | --- |
| `/api/functions/:id/build` | build impossible | 409 |
| `/api/tools/:id/build` | build impossible | 409 |
| `/api/*/:id/build-status` | aucun build | 404 |

## 7.3 Observation critique

Le message qui a choque le QA sur `web_search_py`:

1. `Only custom editable tools can be prepared by the build workflow`

est techniquement coherent avec le code actuel, mais architecturalement invalide pour le besoin produit.

Le probleme n'est donc pas un simple mauvais message.
Le probleme est un **contrat de preparation incomplet**.

---

## 8. Incoherences critiques relevees

## 8.1 Incoherence 1 - le frontend editeur affiche des fonctions mais build des tools

Constat:

1. `useFunctionStore.runBuild(functionId)` laisse penser qu'on build une fonction
2. `toolRepository.runBuild(functionId)` appelle en realite `/api/tools/${functionId}/build`

Impact:

1. langage UI faux
2. confusion pour le QA et pour les developpeurs
3. risque fort d'erreur de categorie si l'identifiant `_id` legacy et `toolId` divergent demain

## 8.2 Incoherence 2 - le read-model frontend perd de l'information metier

Constat:

1. `mapToolToUserFunction` reconstruit un `UserFunction`
2. `userId` y est force a `null` dans tous les cas

Impact:

1. le read-model frontend n'est pas fidele
2. les classifications basees sur le scope de l'utilisateur peuvent devenir fragiles

## 8.3 Incoherence 3 - l'editeur manuel et l'AgentLoop n'utilisent pas le meme niveau de contexte

Constat:

1. l'editeur manuel appelle `/api/sandbox/run` avec `functionId` seul
2. l'AgentLoop appelle `/api/sandbox/run` avec `functionId + toolSelection + versionRef`

Impact:

1. les chemins de resolution runtime ne sont pas identiques
2. la politique de preparation n'est pas testee de la meme facon entre manuel et agentique

## 8.4 Incoherence 4 - `BuildService` securise les customs mais pas encore les natifs versionnes

Constat:

1. `prepareFunction` ne prend que les customs legacy editables
2. `prepareToolVersion` ne prend que les tools `scopeType=user` non readonly
3. aucun chemin equivalent n'existe encore pour les tools natifs versionnes du produit

Impact:

1. les natifs sont executables mais sans workflow de preparation securisee complet
2. la voie agentique versionnee heurte immediatement cette lacune

## 8.5 Incoherence 5 - la readiness dependances n'est pas un contrat de premier niveau

Constat:

1. pour les customs, la readiness est derivee implicitement d'un build pret
2. pour les natifs, aucune readiness de provisionnement n'est exposee clairement
3. l'UI charge le `runtimeHealth`, mais pas un vrai statut unifie de preparation de la fonction selectionnee

Impact:

1. le QA decouvre les dependances manquantes au run
2. aucune vue metier simple ne repond a la question `cette fonction est-elle prete a tourner ?`

## 8.6 Incoherence 6 - le test coverage existant valide des pieces, pas la chaine complete

Constat:

1. `build.service.test.ts` valide bien des customs et tools user versionnes
2. `sandbox.routes.test.ts` couvre surtout le chemin custom / build required
3. aucun test ne verrouille aujourd'hui le parcours complet d'une native versionnee preparee et runnable

Impact:

1. la faille de preparation des natifs a pu subsister sans casser les suites existantes

---

## 9. Reponses aux questions centrales du jalon 1

## 9.1 Pourquoi une fonction est-elle preparable ou non aujourd'hui ?

Reponse technique actuelle:

1. une fonction legacy est preparable si elle est `custom`, `non readonly`, et `workflow-scoped`
2. un tool versionne est preparable si il est `scopeType=user`, `non readonly`, et `workflow-scoped`
3. un natif readonly n'est pas preparable aujourd'hui par les chemins exposes

Reponse architecturale cible a produire ensuite:

1. toute fonction sandboxee doit etre preparable au sens securitaire
2. mais la modalite de preparation doit differer entre:
   - author-built custom
   - platform-provisioned native

## 9.2 Pourquoi l'agent casse plus vite que l'editeur sur les natifs ?

1. parce que l'agent passe deja par la resolution versionnee `toolSelection`
2. ce chemin rencontre directement la faille de readiness des natifs versionnes

## 9.3 Le probleme principal est-il frontend ou backend ?

Reponse:

1. backend en premier sur le contrat de preparation/readiness
2. frontend en second sur la clarte du parcours et le langage metier
3. runtime en troisieme sur la disponibilite effective des dependances et wrappers

---

## 10. Decisions de cadrage pour le Jalon 2+

Decisions a considerer comme gelees apres ce forensic:

1. le terme `build` ne doit plus designer a lui seul toute preparation de tool
2. il faut distinguer:
   - `author build`
   - `platform provisioning`
   - `runtime readiness`
3. le frontend ne doit plus masquer qu'il travaille en fait sur des tools versionnes projetes en read-model legacy
4. l'editeur et l'AgentLoop doivent converger vers un meme contrat de preparation
5. la question produit correcte n'est pas `ce tool est-il buildé ?` mais `ce tool est-il prepare et runnable sous politique securisee ?`

---

## 11. Conditions de sortie du jalon 1

Ce jalon est considere comme rempli si les points suivants sont admis par l'equipe:

1. la taxonomie des categories est comprise
2. la coexistence `user_functions` / `user_tools` est reconnue comme source d'ambiguite
3. l'incoherence des natifs versionnes face au workflow de preparation est reconnue comme la faille centrale
4. le Jalon 2 peut maintenant corriger le parcours editeur sans travestir le probleme backend
5. le Jalon 3 peut maintenant formaliser un vrai contrat `preparation -> readiness -> run`

---

## 12. Synthese executive

Le Jalon 1 montre que le systeme actuel n'est pas en echec parce qu'il manque de composants.
Il est en echec parce qu'il fait coexister:

1. un vocabulaire legacy `function`
2. un registre cible `tool versionne`
3. une preparation securisee partielle reservee au cas custom
4. une execution sandbox deja ouverte a des cas plus larges

La premiere priorite du chantier n'est donc pas de corriger un bouton ou un message.
La premiere priorite est d'aligner **classification, preparation, readiness et execution** sur un contrat unique.
