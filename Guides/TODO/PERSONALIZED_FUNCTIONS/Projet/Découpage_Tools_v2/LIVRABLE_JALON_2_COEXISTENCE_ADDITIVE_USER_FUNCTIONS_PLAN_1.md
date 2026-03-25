# LIVRABLE JALON 2 - COEXISTENCE ADDITIVE AVEC USER_FUNCTIONS PLAN 1

> Date: 17 mars 2026
> Auteur logique: `mongo-persistance`
> Source directrice unique: `PLAN_1_ARCHITECTURE_BDD_SANDBOX_INSTALLATION.md`

---

## 1. Objet du livrable

Ce document fige la strategie de **coexistence additive** entre le legacy `user_functions` et la cible `user_tools`, sans cutover big bang.

Le but est de garantir simultanement:

1. l'absence de regression sur les routes et services legacy encore branches sur `UserFunction`
2. l'introduction additive de `user_tools` comme cible metier du Plan 1
3. l'idempotence des migrations et des reprises partielles
4. l'absence de double autorite fonctionnelle non controlee

---

## 2. Constat de depart

Aujourd'hui, les points critiques encore relies a `user_functions` sont:

1. `functions.routes.ts` et `FunctionService`
2. `sandbox.service.ts`
3. `pythonExecutor.ts`
4. `AgentPrototype.tools` avec `ref: 'UserFunction'`
5. `AgentInstance.tools` avec `ref: 'UserFunction'`
6. les seeds et l'initialisation de base dans `databaseInit.ts`
7. la migration `004_tools_v2_function_registry.ts`

Conclusion:

1. `user_functions` ne peut pas disparaitre au jalon 2
2. mais `user_functions` ne doit deja plus etre considere comme le modele final

---

## 3. Decision structurante de coexistence

## 3.1 Regle de base

Pendant la coexistence additive, **un tool logique peut exister dans deux collections**:

1. `user_functions` pour la compatibilite legacy
2. `user_tools` pour la cible Plan 1

Mais ces deux documents doivent representer **la meme identite logique**.

## 3.2 Regle d'identite obligatoire

La regle obligatoire de coexistence est:

```ts
user_functions._id === user_tools._id
```

pour tout tool miroir present dans les deux collections.

Cette regle est retenue car elle permet:

1. de conserver la stabilite des `functionIds` et des references d'agents pendant la migration
2. d'eviter tout espace d'identifiants mixte dans `prototype.tools`, `instance.tools`, `overrideFunctionIds` et `toolCallRecord.functionId`
3. de rendre les backfills et repairs idempotents sans collection de mapping supplementaire

Cette regle est critique. Sans elle, la coexistence additive deviendrait ambigue et fragile.

---

## 4. Autorite d'ecriture pendant la coexistence

## 4.1 Phase retenue pour le Plan 1 initial

Tant que les routes legacy `api/functions` et l'execution legacy `sandbox.service` / `pythonExecutor` ne sont pas remplaces, l'autorite d'ecriture temporaire reste:

```text
user_functions = autorite de compatibilite operationnelle
user_tools = miroir cible synchronise
```

Cela signifie:

1. create, update, toggle et delete passent encore par les services legacy existants
2. chaque mutation legacy doit etre reproduite vers `user_tools`
3. `user_tools` ne devient source principale qu'apres introduction des nouvelles facades backend du jalon 8

## 4.2 Interdiction pendant cette phase

Il est interdit de laisser:

1. `user_functions` et `user_tools` diverger fonctionnellement sur un meme `_id`
2. une creation uniquement dans `user_tools` si l'execution repose encore sur `UserFunction`
3. deux routes publiques distinctes faire autorite en parallele sur des contrats contradictoires

---

## 5. Strategie de migration additive idempotente

## 5.1 Backfill initial `user_functions` -> `user_tools`

Le backfill initial doit parcourir tous les `user_functions` et faire un **upsert idempotent** dans `user_tools`.

Regle d'upsert:

```ts
filter: { _id: legacyFunction._id }
update: { $set: mappedUserToolFields, $setOnInsert: { createdAt: legacyCreatedAt } }
```

Pourquoi `_id` et pas seulement le nom:

1. l'id est la cle de stabilite des references agents
2. le nom seul ne suffit pas a resoudre les collisions historiques ou les renommages
3. l'operation devient relancable sans recreer de doublons

## 5.2 Reparation idempotente

Un job de reparation doit pouvoir etre relance sans effet secondaire destructif.

Principe:

1. si `user_functions` existe et pas `user_tools`, creer le miroir avec le meme `_id`
2. si `user_tools` existe et pas `user_functions` alors que la route legacy l'exige encore, recreer le miroir legacy avec le meme `_id`
3. si les deux existent, la normalisation remplace les champs derives sans recreer le document

## 5.3 Delete idempotent

La suppression doit etre consideree comme reussie si, apres operation:

1. le document n'existe plus dans `user_functions`
2. le document n'existe plus dans `user_tools`

Autrement dit:

```text
delete dual = idempotent if both collections converge to absence
```

---

## 6. Mapping de projection legacy -> cible

## 6.1 Projection minimale

Chaque `user_functions` doit se projeter vers `user_tools` selon les regles suivantes:

| Legacy `user_functions` | Cible `user_tools` |
| --- | --- |
| `_id` | `_id` identique |
| `userId` | `ownerUserId` |
| `workflowId` | `workflowId` |
| `origin=native` | `scopeType='native'` |
| `origin=custom` | `scopeType='user'` |
| `language` | `runtime` |
| `version` | `currentVersion.versionTag` derive |
| `codeInline` / `codePath` | `currentVersion.sourceInline` / `sourcePath` |
| `isEnabled` | `isEnabled` |
| `isReadonly` | `isReadonly` |
| `tags` | `tags` |

## 6.2 Regles derivees importantes

1. `scopeType='native'` implique `ownerUserId = null` et `workspaceId = null`
2. `scopeType='user'` implique `ownerUserId != null`
3. `workspaceId` peut rester `null` tant que le `WorkspaceManager` n'est pas en place
4. `currentVersion.contentHash` doit etre derive du contenu ou du path pour rendre la projection deterministe

## 6.3 Cas des dependances

Le legacy seed natif utilise `dependencies: string[]`, tandis que `user_tools` attend:

```ts
dependencies: {
  npm: string[];
  python: string[];
}
```

Regle de projection temporaire:

1. si `language = 'python'`, `dependencies[]` legacy mappe vers `dependencies.python`
2. si `language = 'typescript'`, `dependencies[]` legacy mappe vers `dependencies.npm`
3. aucune logique inverse implicite ne doit perdre l'information lors des repairs

---

## 7. Regles de coexistence par surface applicative

## 7.1 Routes `/api/functions`

Pendant la coexistence:

1. les routes conservent leur contrat legacy actuel
2. les DTO retournes restent au format `UserFunction`
3. chaque mutation doit synchroniser le miroir `user_tools`

Conclusion:

1. le frontend Phil continue a fonctionner sans rebranchement immediat
2. `user_tools` se remplit deja comme cible reelle du Plan 1

## 7.2 Routes prototypes et instances

Pendant la coexistence, `functionIds` garde le meme nom de champ cote frontend.

Regle:

1. comme les miroirs partagent le meme `_id`, les ids deja stockes restent valides au moment du basculement
2. il est interdit d'avoir dans un meme tableau des ids legacy et des ids cibles differents pour un meme tool logique
3. les champs `tools[]` et `overrideFunctionIds[]` restent des tableaux d'identites stables, jamais des objets complets

## 7.3 Execution legacy

Tant que `sandbox.service.ts` et `pythonExecutor.ts` chargent `UserFunction`, un outil executable par l'application doit avoir un miroir `user_functions`.

Regle:

1. aucun tool `user_tools` utilise par l'execution ne peut etre orphelin cote legacy tant que l'orchestrateur cible n'est pas en production
2. le miroir legacy peut etre vu comme une projection transitoire d'execution

## 7.4 Hydratation workspace

Les snapshots et transformations frontend peuvent continuer a fournir:

1. `tools[]`
2. `functionIds[]`

mais ces champs doivent desormais pointer vers des ids stables partageables entre legacy et cible.

---

## 8. Phasage de coexistence retenu

## Phase A - Introduction additive

1. creer `user_tools` et ses index
2. backfiller depuis `user_functions` avec conservation du meme `_id`
3. garder `user_functions` comme autorite operationnelle

## Phase B - Dual write legacy -> cible

1. toute mutation via `FunctionService` ecrit sur `user_functions`
2. la meme mutation synchronise `user_tools`
3. tout echec de synchronisation declenche une erreur visible ou une reparation planifiee, mais pas une divergence silencieuse

## Phase C - Facade de lecture cible

1. introduire des facades backend capables de lire depuis `user_tools`
2. conserver les DTO legacy tant que le frontend n'est pas rebranche
3. verifier que les ids exposes restent identiques

## Phase D - Inversion d'autorite

1. les nouvelles routes `workspaces/tools/runs` deviennent source principale
2. `user_functions` devient projection de compatibilite seulement
3. les surfaces legacy restantes lisent ou se synchronisent depuis la cible

## Phase E - Extinction legacy

1. retirer la dependance runtime a `UserFunction`
2. supprimer les projections et seeds legacy
3. decommissionner `user_functions`

---

## 9. Garanties d'idempotence requises

Le systeme de schema et de coexistence sera considere idempotent si les conditions suivantes sont vraies:

1. rejouer le backfill ne cree jamais de doublon dans `user_tools`
2. rejouer le seed natif ne cree jamais de doublon ni d'ids distincts pour un meme tool natif
3. rejouer une reparation de synchro converge vers le meme etat final
4. supprimer un tool deja supprime ne produit pas d'erreur logique de divergence
5. une reference agent stockee avant migration reste resolvable apres migration grace au meme `_id`

---

## 10. Risques majeurs et garde-fous

## 10.1 Risque: double autorite cachee

Si une route ecrit dans `user_functions` et une autre dans `user_tools` sans coordination, la migration devient non deterministe.

Garde-fou:

1. une seule autorite d'ecriture publique par phase
2. l'autre collection n'est qu'un miroir synchrone ou une projection

## 10.2 Risque: espaces d'identifiants mixtes

Si des agents stockent parfois des ids `user_functions` et parfois des ids `user_tools` differents, aucune migration additive fiable n'est possible.

Garde-fou:

1. miroir avec meme `_id`
2. interdiction des remaps d'id non deterministes

## 10.3 Risque: divergence silencieuse des seeds natifs

Les seeds natifs existent deja dans `databaseInit.ts` et dans la migration 004.

Garde-fou:

1. toute projection native vers `user_tools` doit etre idempotente
2. la normalisation doit corriger les ecarts de forme connus comme `version` ou `dependencies`

## 10.4 Risque: delete partiel

Un document supprime dans une seule collection cree des references zombies.

Garde-fou:

1. dual delete
2. verification post-operation sur les deux collections

---

## 11. Decisions explicites

1. `user_functions` reste vivant temporairement, mais uniquement comme couche legacy de compatibilite
2. `user_tools` est la cible metier du Plan 1 des le debut de la coexistence
3. le miroir doit reutiliser le meme `_id` entre les deux collections
4. aucune collection de mapping supplementaire n'est necessaire au Plan 1 si cette regle est respectee
5. le basculement se fait par phases et facades, jamais par coupure big bang

---

## 12. Sortie attendue de l'etape 5

L'etape 5 est consideree validee quand les conditions suivantes sont toutes vraies:

1. la relation entre `user_functions` et `user_tools` est explicite et non ambigue
2. la strategie additive ne casse ni l'execution legacy ni les references agents existantes
3. les operations create, update, toggle, delete et seed sont definies de maniere idempotente
4. la suite peut implementer les modeles Mongoose sans risque de double espace d'identifiants