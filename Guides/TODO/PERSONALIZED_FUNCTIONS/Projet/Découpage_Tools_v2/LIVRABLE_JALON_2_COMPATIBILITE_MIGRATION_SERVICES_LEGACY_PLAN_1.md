# LIVRABLE JALON 2 - COMPATIBILITE DE MIGRATION ET ADAPTATIONS MINIMALES DES SERVICES LEGACY

> Date: 17 mars 2026
> Auteur logique: `mongo-persistance`
> Source directrice unique: `PLAN_1_ARCHITECTURE_BDD_SANDBOX_INSTALLATION.md`

---

## 1. Objet du livrable

Ce document valide la compatibilite de migration entre:

1. le legacy encore branche sur `user_functions`
2. la cible Plan 1 basee sur `workspaces`, `user_tools`, `user_tool_runs` et `secrets_metadata`

Il fixe aussi les **adaptations minimales** a apporter dans les services legacy pour rendre la migration additive, idempotente et non regressante.

---

## 2. Verdict de review du jalon 2

## 2.1 Verdict global

Le jalon 2 est **coherent architecturalement**, mais **pas encore operationnellement migrable tel quel**.

En clair:

1. les livrables de schema, index, mapping et coexistence sont compatibles entre eux
2. les modeles Mongoose ajoutes respectent globalement ces decisions
3. mais la compatibilite de migration n'est pas encore effectivement assuree dans les services legacy et l'initialisation BDD

Conclusion:

1. le cadrage est bon
2. les modeles sont branchables
3. il manque encore une couche minimale d'adaptation legacy avant de pouvoir parler de migration executable fiable

---

## 3. Findings de review

## 3.1 Critique - L'initialisation BDD ne prend pas encore en charge la cible Plan 1

Constat:

1. `databaseInit.ts` declare encore `user_functions` dans les schemas et index initiaux, mais aucune definition equivalente pour `workspaces`, `user_tools`, `user_tool_runs` ou `secrets_metadata`
2. le seed systeme ne peuple que `user_functions`

Impact:

1. un demarrage serveur ne garantit pas la presence des nouvelles collections cibles
2. l'idempotence globale du schema Plan 1 n'est pas encore vraie au runtime
3. le backfill `user_functions -> user_tools` n'est pas branche

References:

1. [backend/src/services/databaseInit.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/services/databaseInit.ts#L241)
2. [backend/src/services/databaseInit.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/services/databaseInit.ts#L267)
3. [backend/src/services/databaseInit.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/services/databaseInit.ts#L398)
4. [backend/src/services/databaseInit.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/services/databaseInit.ts#L609)

## 3.2 Critique - La coexistence additive est documentee, mais pas encore implemente ecriture/lecture

Constat:

1. `FunctionService` cree, modifie, toggle et supprime seulement `UserFunction`
2. `sandbox.service.ts` et `pythonExecutor.ts` lisent uniquement `UserFunction`
3. aucune synchronisation vers `UserTool` n'est encore presente

Impact:

1. la regle de coexistence additive ne vaut encore que sur le papier
2. `user_tools` peut rester vide ou partiellement rempli pendant que le legacy continue a vivre
3. la promesse d'un meme `_id` dans les deux collections n'est pas encore garantie par code

References:

1. [backend/src/services/function.service.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/services/function.service.ts#L88)
2. [backend/src/services/function.service.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/services/function.service.ts#L143)
3. [backend/src/services/function.service.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/services/function.service.ts#L169)
4. [backend/src/services/sandbox.service.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/services/sandbox.service.ts#L112)
5. [backend/src/pythonExecutor.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/pythonExecutor.ts#L104)

## 3.3 Important - Le contrat de reference des prototypes parle encore explicitement de `UserFunction`

Constat:

1. la validation et les commentaires de `agent-prototypes.routes.ts` presentent toujours `functionIds` comme des ids `UserFunction`
2. le mapping cible du jalon 2 dit pourtant que `functionIds` doit devenir un alias frontend vers `user_tools._id`

Impact:

1. le backend peut reintroduire implicitement l'ancien referentiel dans les futures evolutions
2. la terminologie reste dangereuse pour le jalon 8 et le rebranchement frontend

References:

1. [backend/src/routes/agent-prototypes.routes.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/routes/agent-prototypes.routes.ts#L25)
2. [backend/src/routes/agent-prototypes.routes.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/routes/agent-prototypes.routes.ts#L112)
3. [backend/src/routes/agent-prototypes.routes.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/routes/agent-prototypes.routes.ts#L176)

## 3.4 Important - La contrainte d'unicite `user_functions` n'est pas definie de facon homogene

Constat:

1. `UserFunction.model.ts` declare l'index `{ name, userId }` en `sparse: false`
2. `databaseInit.ts` cree le meme index en `sparse: true`
3. la migration 004 cree encore ce meme index avec d'autres options

Impact:

1. les replays d'initialisation et de migration ne sont pas totalement deterministes
2. une correction de schema ou de migration peut declencher des etats differents selon le chemin d'initialisation
3. cela fragilise l'idempotence du legacy au moment ou l'on veut justement s'appuyer dessus pour la coexistence

References:

1. [backend/src/models/UserFunction.model.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/models/UserFunction.model.ts#L184)
2. [backend/src/services/databaseInit.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/services/databaseInit.ts#L311)
3. [backend/src/migrations/004_tools_v2_function_registry.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/migrations/004_tools_v2_function_registry.ts#L82)

## 3.5 Important - Le modele `UserTool` exige un `currentVersion` plus riche que le livrable schema ne l'expliquait explicitement

Constat:

1. `currentVersion` reutilise le meme sous-schema que `versions[]`
2. cela rend `buildStatus`, `validationStatus` et `createdAt` implicitement obligatoires dans `currentVersion`

Impact:

1. le backfill devra les calculer ou les initialiser explicitement
2. sans cela, la migration `user_functions -> user_tools` echouera ou produira des documents incomplets

Reference:

1. [backend/src/models/UserTool.model.ts](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/src/models/UserTool.model.ts#L159)

---

## 4. Validation de compatibilite de migration

## 4.1 Ce qui est deja compatible

1. les nouvelles collections cibles sont correctement separees par responsabilite
2. les index critiques des nouveaux modeles sont alignes avec les livrables du jalon 2
3. le choix de conserver des ids de tools stables reste compatible avec les routes prototypes et instances existantes
4. la coexistence additive reste viable a condition de faire converger les miroirs avec le meme `_id`

## 4.2 Ce qui n'est pas encore compatible en execution

1. le systeme de boot BDD ne provisionne pas la cible Plan 1
2. les services CRUD legacy n'ecrivent pas encore dans `user_tools`
3. les services d'execution n'ont aucun mecanisme de verification du miroir legacy/cible
4. les seeds natifs ne projettent pas encore vers `user_tools`

## 4.3 Verdict operationnel

La migration est donc:

1. **compatible conceptuellement**
2. **non compatible operationnellement sans adaptations minimales**

---

## 5. Adaptations minimales a faire dans les services legacy

## 5.1 `databaseInit.ts`

Adaptation minimale:

1. ajouter `workspaces`, `user_tools`, `user_tool_runs` et `secrets_metadata` a `COLLECTION_SCHEMAS`
2. ajouter leurs index a `INDEX_DEFINITIONS`
3. ajouter un bootstrap idempotent de projection native `user_functions -> user_tools`
4. declencher un backfill/repair idempotent a froid si `user_tools` est absent ou incomplet

But:

1. rendre le schema Plan 1 reellement present apres demarrage serveur
2. eviter qu'un environnement local ou QA oublie de creer les nouvelles collections

## 5.2 `FunctionService`

Adaptation minimale:

1. conserver la lecture legacy pour ne pas casser `api/functions`
2. ajouter un dual-write synchrone vers `UserTool` sur `createFunction`, `updateFunction`, `toggleFunction` et `deleteFunction`
3. lors du create, forcer la creation du `UserTool` avec le meme `_id` que le `UserFunction` cree
4. centraliser le mapping dans un mapper unique `UserFunction -> UserTool`

But:

1. rendre la coexistence documentaire enfin executable
2. conserver le contrat frontend legacy sans rebrancher Phil tout de suite

## 5.3 `functions.routes.ts`

Adaptation minimale:

1. ne pas changer le contrat HTTP pour l'instant
2. router les mutations vers un `FunctionService` dual-write
3. garder les DTO `UserFunction` jusqu'au jalon 8

But:

1. zero regression frontend
2. introduction progressive de la cible backend

## 5.4 `sandbox.service.ts` et `pythonExecutor.ts`

Adaptation minimale:

1. ne pas basculer encore l'execution sur `UserTool`
2. ajouter une verification defensive que tout tool execute possede bien son miroir cible si la coexistence est activee
3. journaliser les cas d'orphelin legacy/cible pour permettre un repair

But:

1. maintenir l'execution actuelle stable
2. preparer le passage futur vers `user_tool_runs` et l'orchestrateur cible

## 5.5 `agent-prototypes.routes.ts`

Adaptation minimale:

1. corriger la terminologie des commentaires et schemas: `functionIds` ne doit plus etre decrit comme un id `UserFunction`
2. conserver le stockage actuel des ids dans `prototype.tools` tant que l'egalite d'id legacy/cible est garantie
3. ne pas changer le contrat frontend retourne

But:

1. eviter de reintroduire l'ancien referentiel par la documentation interne du code
2. rester compatible sans migration de masse des prototypes

## 5.6 `agent-instances.routes.ts`

Adaptation minimale:

1. conserver `overrideFunctionIds` comme nom de champ
2. documenter et verifier que ces ids referencent le meme espace d'identifiants stabilise entre `user_functions` et `user_tools`
3. ne pas utiliser `configuration_json.tools` comme source canonique d'identite

But:

1. ne pas casser la configuration d'instance existante
2. garder une trajectoire claire vers `user_tools`

---

## 6. Sequence minimale recommandee pour la mise en compatibilite

1. unifier la definition d'index legacy `user_functions`
2. etendre `databaseInit.ts` aux 4 nouvelles collections et a leurs index
3. ajouter un mapper deterministe `UserFunction -> UserTool`
4. ajouter le backfill idempotent et le seed miroir natif vers `user_tools`
5. passer `FunctionService` en dual-write synchrone
6. ajouter des checks de coherence dans `sandbox.service.ts` et `pythonExecutor.ts`
7. corriger la terminologie et les commentaires des routes prototypes et instances

---

## 7. Criteres de validation de l'etape 7

L'etape 7 sera consideree validee quand les conditions suivantes seront toutes vraies:

1. les ecarts bloquants entre livrables et code legacy sont identifies explicitement
2. les adaptations minimales par fichier legacy sont connues
3. la migration additive peut etre mise en oeuvre sans cutover big bang ni double espace d'identifiants
4. la prochaine etape peut se concentrer sur les corrections et ecarts restants sans reouvrir le design de fond