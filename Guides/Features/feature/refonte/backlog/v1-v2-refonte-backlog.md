# Backlog de refonte V1 -> V2

**Statut :** backlog de mise en oeuvre
**Date :** 2026-09-30
**Source principale :** `Guides/Features/feature/refonte/v1-v2-implementation-plan.md`

## 1. Objectif du backlog

Ce backlog transforme le plan de refonte V1 -> V2 en jalons executables et en user stories attribuees a des agents specialises presents dans `.github/agents`.

Chaque user story precise :

- l'agent responsable ;
- son niveau de criticite ;
- l'objectif metier et technique ;
- les dependances ;
- les risques et consequences applicatives ;
- les impacts potentiels sur fichiers, dossiers, tests et fixtures ;
- les criteres d'acceptation.

## 2. Regles d'execution

- L'ordre des jalons est chronologique et ne doit pas etre inverse sans justification architecturale.
- Aucun jalon ne doit reintroduire une ecriture metier sur `Workflow.nodes` ou `Workflow.edges`.
- Toute user story impactant les contrats, la securite ou la persistance doit etre validee par tests cibles avant passage au jalon suivant.
- Les user stories frontend ne doivent pas inventer de contrat local si le backend n'est pas stabilise.
- Les user stories de migration doivent etre idempotentes et rejouables.
- Toute creation, suppression ou modification de fichier ou dossier doit rester motivee par la responsabilite architecturale visee.

## 3. Niveaux de criticite

- `Critique` : bloque la refonte, menace l'integrite des donnees, la securite ou la capacite a livrer sans regression.
- `Haute` : impact direct sur les parcours principaux, les contrats inter-couches ou la stabilite runtime.
- `Moyenne` : necessaire a la clarte, a la maintenabilite ou a la couverture, avec risque fonctionnel indirect.
- `Basse` : optimisation non bloquante pour le cutover initial.

## 4. Ancrage codebase a respecter

### 4.1 Garde-fous securite deja presents

Le backlog doit s'aligner sur les mecanismes deja presents dans la codebase et les renforcer sans les contourner :

- authentification JWT et Passport dans `backend/src/middleware/auth.middleware.ts` ;
- filtrage d'ownership dans `backend/src/middleware/ownership.middleware.ts` ;
- validation Zod dans `backend/src/middleware/validation.middleware.ts` et les routes backend ;
- protections `express-mongo-sanitize`, `helmet` et `express-rate-limit` dans le backend ;
- chiffrement et gestion JWT dans `backend/src/utils/encryption.ts` et `backend/src/utils/jwt.ts`.

Point de vigilance immediat : `backend/src/websocket/WebSocketManager.ts` genere encore un `userId` temporaire cote socket au lieu de s'appuyer sur une authentification forte. Toute user story touchant le runtime temps reel doit traiter cette dette explicitement.

### 4.2 Exigence de clarte vis-a-vis de la codebase

Le backlog doit conduire a une implementation lisible et coherente avec la structure existante :

- aucune logique metier complexe ne reste dans `backend/src/routes/**` ;
- `App.tsx` ne doit plus etre le point d'orchestration de la persistance metier ;
- les nouveaux fichiers doivent suivre la separation domaine/application/infrastructure decrite par le plan ;
- les deplacements de code doivent reduire la derive V1/V2, pas la masquer.

### 4.3 Exigence de stabilite des tests

La base de reference est que les tests actuels sont attendus a 100 % de reussite avant et apres les travaux.

Toute user story qui modifie du code, des fichiers ou des dossiers doit donc definir :

- les suites minimales a rejouer ;
- les fixtures a adapter ;
- les tests de non-regression a ajouter ;
- les criteres de retour a l'etat vert avant fusion.

Commandes de reference deja presentes dans la codebase :

- `npm test`
- `npm run test:coverage`
- `npm run test:integration:hydration`
- `npm run test:components:ci`
- `npm run test:canvas:non-regression`
- `npm run test:j7:editor:semi-e2e`
- `cd backend && npm test`
- `cd backend && npm run test:coverage`
- `npm run ci:node25:runtime`

### 4.4 Fixtures et donnees QA deja presentes

Les testeurs QA et les tests automatiques s'appuient deja sur des fixtures qu'il faut preserver ou faire evoluer explicitement :

- `tests/fixtures/workspaceHydration.fixtures.ts` pour l'hydratation frontend ;
- `backend/src/__tests__/workspace-snapshot.test.ts` pour le snapshot unifie backend ;
- les fixtures d'authentification, runs, sandbox et routes backend dans `backend/src/__tests__/**` ;
- les seeds et jeux de donnees techniques dans `backend/src/seeds/**` et `backend/src/services/databaseInit.ts`.

Toute evolution de contrat ou de comportement touchant workflow, hydratation, runtime, runs, tasks ou snapshots doit identifier l'adaptation fonctionnelle attendue sur ces fixtures.

## 5. Vue d'ensemble des jalons

### Mise a jour d'etat (2026-10-27)

Le projet a ete stabilise sur la ligne runtime supportee Node 24.22.1 LTS, avec les garde-fous de securite et de qualite valides sur les zones critiques. Le backlog doit donc etre lu comme suit :

- `J0` : valide, avec inventaire et garde-fous anti-derive en place.
- `J1` : valide sur le plan des contrats metier, des permissions, de la validation d'entree et de la journalisation.
- `J2` : en cours, priorite backend, avec extraction des repositories et use cases poursuivie par l'agent `03-backend.agent.md`.
- `J3` a `J6` : non demarres ou a lancer uniquement apres la stabilisation backend et les validations de migration associees.

| Jalon | Intitule | Criticite | Agent pilote | Resultat attendu |
|---|---|---|---|---|
| J0 | Gel architectural et inventaire | Critique | `01-architecte-bdd.agent.md` | Carte exacte de la derive V1/V2 et garde-fous anti-regression |
| J1 | Contrats metier et securite | Critique | `02-securite.agent.md` | Contrats V2 stabilises, regles d'acces et erreurs metier cadrees |
| J2 | Refactoring backend coeur | Critique | `03-backend.agent.md` | Repositories, use cases et routes minces sur base V2 |
| J3 | Migrations et runtime infra | Critique | `04-cicd-installation.agent.md` | Migrations rejouables, worker, queue et scheduler fiables |
| J4 | Validation domaine et resilience | Haute | `05-testeur-domaine.agent.md` | Invariants, transitions et scenarios de panne couverts |
| J5 | Cutover frontend V2 | Critique | `06-frontend.agent.md` | Frontend decouple de V1 et pilote par contrats V2 |
| J6 | Validation finale de livraison | Critique | `08-testeur-e2e.agent.md` | Non-regression bout en bout et recommandation Go/No-Go |

## 6. Backlog detaille par jalon

## J0 - Gel architectural et inventaire

**Agent pilote :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite du jalon :** Critique
**But :** figer le perimetre de derive, empecher toute aggravation et etablir la base factuelle de la refonte.

**Fichiers a toucher en priorite :**
- `Guides/Features/feature/refonte/v1-v2-implementation-plan.md`
- `Guides/Features/feature/refonte/v1-v2-drift-analysis.md`
- `Guides/Features/feature/refonte/backlog/v1-v2-refonte-backlog.md`
- `backend/src/routes/workflows.routes.ts`
- `backend/src/routes/agent-instances.routes.ts`
- `backend/src/routes/runs.routes.ts`
- `backend/src/services/databaseInit.ts`
- `App.tsx`
- `types.ts`
- `package.json`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** hydratation frontend, snapshot backend, seeds de bootstrap.
**Changements fonctionnels a anticiper :** aucun changement utilisateur volontaire a ce jalon, mais toute zone legacy identifiee doit etre signalee comme impact potentiel de refactor ou de suppression.

### US-J0-01 - Cartographier les points d'entree V1 et V2

**Agent responsable :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite :** Critique
**Description :** identifier tous les flux backend et frontend qui lisent, ecrivent ou reconstruisent des donnees de workflow a partir des representations V1 et V2.
**Dependances :** aucune.
**Risques et consequences :**
- si une zone V1 reste non detectee, une future migration peut laisser une double source de verite ;
- si la cartographie est incomplete, des suppressions de code legacy risquent de casser des parcours encore actifs ;
- un oubli dans l'hydratation frontend peut produire des workflows partiellement affiches ou incorrectement restaures.
**Impacts codebase et tests :**
- peut conduire a creer ou mettre a jour des fichiers d'inventaire dans `Guides/Features/feature/refonte/` ;
- doit pointer les surfaces a risque dans `App.tsx`, `backend/src/routes/**` et `backend/src/services/databaseInit.ts` ;
- doit aussi signaler les surfaces de derive non prioritaires mais actives comme `stores/useWorkflowStore.ts` et `services/workspacePersistenceService.ts` lorsqu'elles reconstruisent ou reroutent des writes workflow ;
- ne doit modifier aucun contrat applicatif a ce stade.
**Criteres d'acceptation :**
- chaque point d'entree est classe en lecture, ecriture ou compatibilite ;
- les zones backend, frontend et migration sont traitees ;
- le resultat est documente de facon exploitable par les jalons suivants.

### US-J0-02 - Etablir l'inventaire automatise V1/V2

**Agent responsable :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite :** Critique
**Description :** produire un audit reproductible des references V1/V2 avec une classification exploitable en revue et en CI.
**Dependances :** US-J0-01.
**Risques et consequences :**
- sans audit automatise, la dette peut revenir silencieusement dans de nouveaux fichiers ;
- un script trop permissif laissera passer des ecritures V1 en production ;
- un script trop strict bloquera la migration en signalant des cas de compatibilite legitimes.
**Impacts codebase et tests :**
- peut ajouter `scripts/audit-workflow-architecture.ts` et des scripts npm associes ;
- doit pouvoir s'integrer a la CI sans casser les suites existantes ;
- doit rester compatible avec les zones legacy tolerees pendant la transition.
**Criteres d'acceptation :**
- presence d'un rapport d'inventaire versionne ;
- presence d'une commande d'audit reutilisable ;
- absence de references classees `UNKNOWN`.

### US-J0-03 - Poser les garde-fous anti-derive

**Agent responsable :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite :** Critique
**Description :** marquer les routes legacy, formaliser l'interdiction des nouvelles ecritures V1 et preparer le terrain pour le cutover.
**Dependances :** US-J0-01, US-J0-02.
**Risques et consequences :**
- sans garde-fous, les correctifs opportunistes continueront de s'ajouter au mauvais modele ;
- une depreciation non instrumentee rendra le retrait legacy aveugle ;
- un gel mal cible peut freiner des correctifs legitimes sur des parcours critiques existants.
**Impacts codebase et tests :**
- peut modifier de la documentation, des annotations de routes et des scripts de revue ;
- ne doit pas changer le comportement fonctionnel sans test de non-regression ;
- doit conserver toutes les suites existantes au vert.
**Criteres d'acceptation :**
- les points legacy sont marques de maniere explicite ;
- les nouvelles contributions ont une regle claire anti-V1 ;
- des logs ou compteurs permettent de mesurer l'usage restant.

## J1 - Contrats metier et securite

**Agent pilote :** `02-securite.agent.md` - Securite
**Criticite du jalon :** Critique
**But :** stabiliser les contrats V2 et encadrer la refonte par des regles d'acces, de validation et de protection des donnees.

**Fichiers a toucher en priorite :**
- `backend/src/domain/**`
- `backend/src/types/workflow-ir.ts`
- `backend/src/types/workflow-status.ts`
- `backend/src/types/execution-policy.ts`
- `backend/src/middleware/auth.middleware.ts`
- `backend/src/middleware/ownership.middleware.ts`
- `backend/src/middleware/validation.middleware.ts`
- `backend/src/utils/jwt.ts`
- `backend/src/utils/encryption.ts`
- `backend/src/websocket/WebSocketManager.ts`
- `backend/src/routes/workflows.routes.ts`
- `backend/src/routes/runs.routes.ts`
- `backend/src/routes/agent-instances.routes.ts`
- `backend/src/__tests__/schemas.test.ts`
- `backend/src/__tests__/auth-workflows.routes.test.ts`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** `tests/fixtures/workspaceHydration.fixtures.ts`, `backend/src/__tests__/workspace-snapshot.test.ts`, fixtures d'auth et de permissions.
**Changements fonctionnels a anticiper :** validation plus stricte, refus explicites sur transitions invalides, restrictions d'acces plus fermes, eventuels workflows legacy desormais rejetes a la publication.

### US-J1-01 - Definir les contrats canoniques du domaine V2

**Agent responsable :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite :** Critique
**Description :** definir les entites et DTO cibles pour `WorkflowDefinition`, `WorkflowNode`, `WorkflowEdge`, `WorkflowRun`, `TaskInstance` et les erreurs metier stables.
**Dependances :** J0 termine.
**Risques et consequences :**
- un contrat ambigu creera des divergences entre backend, frontend et migrations ;
- un melange entre entites domaine et schemas MongoDB figera une dette de conception ;
- des erreurs metier non stabilisees rendront les clients difficiles a maintenir.
**Impacts codebase et tests :**
- peut creer ou deplacer des types backend dans `backend/src/domain/**` et `backend/src/types/**` ;
- doit identifier avant modification les impacts sur `tests/fixtures/workspaceHydration.fixtures.ts` et `backend/src/__tests__/workspace-snapshot.test.ts` ;
- toute evolution de contrat doit entrainer des mises a jour coordonnees des DTO, schemas et tests.
**Criteres d'acceptation :**
- les contrats V2 sont documentes et distincts des structures V1 ;
- les statuts et revisions sont definis ;
- les proprietes legacy ne sont pas reintroduites dans le domaine canonique.

### US-J1-02 - Definir les state machines de run et de task

**Agent responsable :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite :** Critique
**Description :** centraliser toutes les transitions valides et interdire explicitement les transitions illegales.
**Dependances :** US-J1-01.
**Risques et consequences :**
- des transitions diffuses dans plusieurs services creent des courses et des etats impossibles ;
- une annulation mal definie peut laisser des runs visibles comme actifs alors que les workers ont cesse ;
- une reprise mal bornee peut dupliquer des executions ou des artefacts.
**Impacts codebase et tests :**
- peut creer des modules de domaine et des tests unitaires dedies ;
- doit rester independant d'Express, React et Mongoose ;
- doit augmenter la couverture sans casser les parcours existants.
**Criteres d'acceptation :**
- toutes les transitions valides et invalides sont testees ;
- les etats terminaux sont irreversibles ;
- les state machines sont independantes du transport et de la persistance.

### US-J1-03 - Construire le threat model et la matrice de permissions

**Agent responsable :** `02-securite.agent.md` - Securite
**Criticite :** Critique
**Description :** analyser la surface d'attaque de la refonte et definir les regles d'autorisation sur workflows, nodes, runs, tasks et artefacts.
**Dependances :** US-J1-01.
**Risques et consequences :**
- une faille d'IDOR sur les runs ou artefacts exposerait des donnees d'un autre utilisateur ;
- des permissions floues sur activation et annulation peuvent laisser un utilisateur piloter des executions hors de son perimetre ;
- l'absence de modelisation des frontieres de confiance fragilise les integrations async et temps reel.
**Impacts codebase et tests :**
- peut modifier middlewares, filtres d'ownership ou schemas de route ;
- doit traiter explicitement la situation actuelle de `backend/src/websocket/WebSocketManager.ts` ;
- doit ajouter ou renforcer des tests d'acces autorise/refuse.
**Criteres d'acceptation :**
- threat model documente ;
- matrice de permissions ressource/action disponible ;
- regles deny-by-default definies sur les ressources critiques.

### US-J1-04 - Verrouiller validation d'entree et politiques de journalisation

**Agent responsable :** `02-securite.agent.md` - Securite
**Criticite :** Critique
**Description :** imposer validation Zod, protection contre les injections, hygiene des logs et non-exposition des secrets dans API et Socket.IO.
**Dependances :** US-J1-03.
**Risques et consequences :**
- une validation insuffisante peut corrompre le graphe ou provoquer des executions invalides ;
- des logs trop verbeux peuvent exposer des tokens, prompts ou secrets d'integration ;
- un durcissement tardif obligera a reprendre plusieurs routes et evenements deja livres.
**Impacts codebase et tests :**
- peut modifier routes, middleware de validation, middleware de logs et payloads temps reel ;
- doit conserver la compatibilite avec les schemas Zod deja testes ;
- doit s'accompagner de tests sur refus d'entrees invalides et masquage des secrets.
**Criteres d'acceptation :**
- politique de validation et de journalisation documentee ;
- tests sur refus d'entrees invalides et masquage des secrets ;
- aucune route ciblee n'accepte d'identifiant client non filtre par proprietaire.

## J2 - Refactoring backend coeur

**Agent pilote :** `03-backend.agent.md` - Backend
**Criticite du jalon :** Critique
**But :** deplacer la logique metier hors des routes et faire de V2 l'unique chemin d'ecriture metier.

**Fichiers a toucher en priorite :**
- `backend/src/routes/workflows.routes.ts`
- `backend/src/routes/runs.routes.ts`
- `backend/src/routes/agent-instances.routes.ts`
- `backend/src/controllers/workflow.controller.ts`
- `backend/src/application/**`
- `backend/src/infrastructure/repositories/**`
- `backend/src/validators/workflow-validator.ts`
- `backend/src/domain/run-state-machine.ts`
- `backend/src/domain/task-state-machine.ts`
- `backend/src/services/**`
- `backend/src/__tests__/workflow-crud-flow.test.ts`
- `backend/src/__tests__/transition-routes.test.ts`
- `backend/src/__tests__/workspace-snapshot.test.ts`
- `backend/src/__tests__/function-runs.routes.test.ts`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** fixtures runs, snapshots backend, transitions workflow, routes legacy encore supportees.
**Changements fonctionnels a anticiper :** nouvelles erreurs metier homogenes, publication bloquee sur IR invalide, annulation et reprise plus strictes, payloads de runs susceptibles d'evoluer.

**Etat d'avancement au 2026-10-27 :**
- `J0` et `J1` sont stabilises sur la ligne runtime supportee Node 24.22.1 LTS et sur les garde-fous de securite / validation documentes dans le backlog.
- `J2` est la phase active de refactor backend. Les extractions de repository/use case sont poursuivies sur les routes critiques, avec concentration sur les endpoints de workflow, runs et activations.
- Les endpoints legacy restent a surveiller comme surfaces de derive, mais ils sont maintenant encadres par des validations et une politique de non-regression.
- **Point de securite J2 impose :** toute validation d'activation de workflow doit rejeter les nœuds agent dont `instanceId` ne correspond pas a une instance existante dans le workflow. Ce garde-fou doit rester documente dans le backlog et couvert par test de non-regression avant tout nouveau jalon backend.

### US-J2-01 - Extraire les repositories canoniques

**Agent responsable :** `03-backend.agent.md` - Backend
**Criticite :** Critique
**Description :** definir et implementer les repositories V2 pour workflows, nodes, edges, agent instances, runs, tasks et artifacts.
**Dependances :** J1 termine.
**Risques et consequences :**
- sans couche repository, la logique Mongoose restera dupliquee et difficile a fiabiliser ;
- une extraction incomplete laissera des contournements directs depuis les controllers ;
- un mauvais traitement de revision peut provoquer des conflits silencieux et des pertes de mise a jour.
**Impacts codebase et tests :**
- peut creer `backend/src/infrastructure/repositories/**` et deplacer du code hors des routes ;
- doit maintenir la compatibilite comportementale des routes existantes ;
- doit s'accompagner de tests de repositories et de conflits de revision.
**Criteres d'acceptation :**
- les controllers ne font plus d'acces directs critiques a Mongoose ;
- les repositories encapsulent la gestion des revisions et des erreurs de persistance ;
- des tests ciblent les chemins nominaux et les conflits.

### US-J2-02 - Extraire les use cases workflow et agent instance

**Agent responsable :** `03-backend.agent.md` - Backend
**Criticite :** Critique
**Description :** deplacer les commandes de creation, edition, publication, activation et suppression dans des use cases testables.
**Dependances :** US-J2-01.
**Risques et consequences :**
- tant que la logique reste dans les routes, toute evolution multiplie le risque de regression transversale ;
- une extraction partielle peut laisser deux comportements differents pour une meme commande ;
- des use cases mal delimites peuvent reintroduire un couplage route/persistance.
**Impacts codebase et tests :**
- peut creer `backend/src/application/**` et alleger `backend/src/routes/**` ;
- doit conserver les contrats HTTP existants tant que le cutover n'est pas annonce ;
- doit etre couvert par tests unitaires et integration API.
**Criteres d'acceptation :**
- les routes deviennent des adaptateurs minces ;
- chaque commande critique possede un use case dedie ;
- les erreurs metier sont homogenes.

### US-J2-03 - Implementer le validateur d'IR dans le flux de publication

**Agent responsable :** `03-backend.agent.md` - Backend
**Criticite :** Critique
**Description :** imposer la validation du graphe et des references avant qu'une version de workflow soit publiee ou activee.
**Dependances :** US-J1-01, US-J1-02, US-J2-02.
**Risques et consequences :**
- sans verrou a la publication, des workflows invalides atteindront le runtime ;
- une activation d'IR incoherente peut produire des runs bloques, des tasks orphelines ou des erreurs de reprise ;
- une validation trop tardive cote worker augmentera le cout de diagnostic.
**Impacts codebase et tests :**
- peut creer `backend/src/validators/workflow-validator.ts` ;
- doit faire evoluer les tests de publication et de transition sans casser les fixtures d'hydratation ;
- doit expliciter tout changement fonctionnel sur les workflows actuellement valides.
**Criteres d'acceptation :**
- la publication echoue sur IR invalide ;
- les erreurs de validation sont explicites et stables ;
- des tests couvrent ports, cycles, references et permissions ;
- un test de non-regression confirme que les nœuds agent ne peuvent plus pointer vers une `instanceId` absente du workflow courant.

### US-J2-04 - Introduire l'API de run et d'annulation idempotente

**Agent responsable :** `03-backend.agent.md` - Backend
**Criticite :** Critique
**Description :** exposer les commandes de lancement, annulation, reprise et suivi de run avec idempotence et erreurs previsibles.
**Dependances :** US-J2-02, US-J1-03, US-J1-04.
**Risques et consequences :**
- une commande non idempotente peut lancer plusieurs executions pour une meme intention utilisateur ;
- une annulation sans semantique stable peut laisser des tasks encore actives ;
- un contrat de run instable casserait rapidement le frontend de pilotage.
**Impacts codebase et tests :**
- peut modifier ou etendre `backend/src/routes/runs.routes.ts` et les services runtime associes ;
- doit garder verts `cd backend && npm test` et `npm run ci:node25:runtime` si le runtime d'execution est touche ;
- doit identifier les fixtures backend impactees sur runs, annulations et snapshots.
**Criteres d'acceptation :**
- un idempotency key est pris en compte sur les commandes critiques ;
- les codes d'erreur sont stables ;
- les tests couvrent doublons, annulation et reprise.

## J3 - Migrations et runtime infra

**Agent pilote :** `04-cicd-installation.agent.md` - CI/CD et installation
**Criticite du jalon :** Critique
**But :** rendre la migration de donnees, les workers et le runtime operables, redemarrables et deployables de facon fiable.

**Fichiers a toucher en priorite :**
- `backend/src/services/databaseInit.ts`
- `backend/src/migrations/**`
- `backend/src/seeds/**`
- `backend/src/scripts/**`
- `backend/src/services/runtimeHealth.service.ts`
- `backend/src/services/nativePythonProvisioning.service.ts`
- `backend/docker/**`
- `backend/package.json`
- `package.json`
- `.github/workflows/**`
- `backend/src/__tests__/database-init.seeding.test.ts`
- `backend/src/__tests__/workflow-self-healing.test.ts`
- `backend/src/__tests__/runtime-health.service.test.ts`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** seeds backend, base Mongo locale d'entrainement QA, snapshots backend dependants des migrations, scripts de bootstrap.
**Changements fonctionnels a anticiper :** nouvelles etapes d'initialisation locale, re-seed ou reprise de migration possiblement necessaires, comportements runtime differents apres redemarrage ou panne worker.

### US-J3-01 - Decouper le bootstrap base, migrations et seed

**Agent responsable :** `04-cicd-installation.agent.md` - CI/CD et installation
**Criticite :** Critique
**Description :** separer l'initialisation technique, les migrations de schema, les migrations de donnees et le seed de developpement.
**Dependances :** J2 termine.
**Risques et consequences :**
- un bootstrap monolithique rend les incidents de demarrage difficiles a diagnostiquer ;
- des migrations melangees aux seeders peuvent polluer des environnements de test ou de production ;
- un couplage fort au demarrage complique le rollback et les reprises partielles.
**Impacts codebase et tests :**
- peut scinder `backend/src/services/databaseInit.ts` et ajouter des scripts de demarrage ;
- doit preserver le comportement des seeds QA et techniques existants ;
- doit rester compatible avec `backend/src/__tests__/database-init.seeding.test.ts` et les suites runtime associees.
**Criteres d'acceptation :**
- les responsabilites sont separees ;
- le projet dispose d'un chemin de demarrage explicite par environnement ;
- les scripts sont rejouables sans effet destructif inattendu.

### US-J3-02 - Implementer les migrations V1 vers V2 idempotentes

**Agent responsable :** `01-architecte-bdd.agent.md` - Architecte BDD
**Criticite :** Critique
**Description :** concevoir et produire les migrations de donnees pour extraire nodes, edges et instances depuis V1 vers V2 avec reprise sur echec.
**Dependances :** US-J3-01, J1 termine.
**Risques et consequences :**
- une migration non idempotente peut dupliquer nodes, edges, runs ou artefacts ;
- un echec sans mecanisme de reprise peut laisser des workflows dans un etat hybride ;
- une perte de correspondance d'identifiants peut casser les edges ou les references d'instance.
**Impacts codebase et tests :**
- peut creer de nouvelles migrations dans `backend/src/migrations/**` ;
- doit inventorier avant changement les impacts sur les fixtures backend de snapshot, auth workflow et runs ;
- doit etre valide par tests de migration verte, rerun et reprise sur echec.
**Criteres d'acceptation :**
- les migrations peuvent etre relancees sans doublon ;
- une execution interrompue peut reprendre ;
- des tests couvrent une base historique et une base deja partiellement migree.

### US-J3-03 - Industrialiser worker, queue et scheduler

**Agent responsable :** `04-cicd-installation.agent.md` - CI/CD et installation
**Criticite :** Critique
**Description :** definir et mettre en place l'execution asynchrone, les leases de task, les health checks et les comportements de reprise.
**Dependances :** US-J2-04, US-J3-01.
**Risques et consequences :**
- un worker sans lease robuste peut executer une meme task deux fois ;
- Redis utilise comme source de verite provoquerait une perte d'etat au redemarrage ;
- un scheduler mal borne peut declencher des runs en double ou hors fenetre attendue.
**Impacts codebase et tests :**
- peut ajouter des fichiers runtime, docker, health checks ou variables d'environnement ;
- doit documenter tout nouveau dossier ou service auxiliaire ;
- doit rester compatible avec `npm run ci:node25:runtime` et les tests de reprise.
**Criteres d'acceptation :**
- les roles de MongoDB et Redis sont documentes ;
- health checks et scripts de demarrage existent ;
- les tests couvrent panne worker, tache abandonnee et redemarrage.

### US-J3-04 - Publier les evenements runtime versionnes

**Agent responsable :** `03-backend.agent.md` - Backend
**Criticite :** Haute
**Description :** exposer les evenements temps reel necessaires au suivi des runs et tasks sans divulgation de donnees sensibles.
**Dependances :** US-J2-04, US-J1-04, US-J3-03.
**Risques et consequences :**
- un schema d'evenement instable forcera des adaptations frontend frequentes ;
- une emission trop verbeuse peut degrader les performances ou exposer des informations sensibles ;
- l'absence de versionnage rendra les clients fragiles lors des evolutions futures.
**Impacts codebase et tests :**
- peut modifier `backend/src/websocket/**` et les services runtime ;
- doit documenter l'impact sur les parcours de reconnexion et de suivi frontend ;
- doit ajouter des tests de payload et de filtrage utilisateur.
**Criteres d'acceptation :**
- les evenements runtime utiles sont identifies et versionnes ;
- les donnees sensibles sont exclues ;
- des tests couvrent le payload et le filtrage utilisateur.

## J4 - Validation domaine et resilience

**Agent pilote :** `05-testeur-domaine.agent.md` - Testeur domaine
**Criticite du jalon :** Haute
**But :** prouver que les invariants V2 tiennent face aux transitions, erreurs de reseau, reprises et donnees legacy.

**Fichiers a toucher en priorite :**
- `backend/src/__tests__/**`
- `tests/**`
- `backend/src/domain/**`
- `backend/src/migrations/**`
- `backend/src/routes/runs.routes.ts`
- `backend/src/routes/workflows.routes.ts`
- `backend/src/websocket/WebSocketManager.ts`
- `backend/src/__tests__/workspace-snapshot.test.ts`
- `backend/src/__tests__/workflow-self-healing.test.ts`
- `backend/src/__tests__/auth-workflows.routes.test.ts`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** toutes les fixtures backend liees aux runs, migrations, auth, snapshots et runtime.
**Changements fonctionnels a anticiper :** aucun changement produit par les tests eux-memes, mais toute regression decouverte doit etre reclassifiee en impact fonctionnel, securite ou donnees avant correction.

### US-J4-01 - Couvrir les invariants et transitions critiques

**Agent responsable :** `05-testeur-domaine.agent.md` - Testeur domaine
**Criticite :** Haute
**Description :** mettre en place les tests unitaires et integration couvrant statuts, transitions, refus et erreurs de contrat.
**Dependances :** J2 termine.
**Risques et consequences :**
- sans matrice de couverture claire, des regressions de domaine passeront jusqu'en E2E ;
- des transitions invalides non testees peuvent reintroduire des etats impossibles ;
- une couverture insuffisante sur les erreurs laissera des comportements differents selon les routes.
**Impacts codebase et tests :**
- peut creer de nouveaux tests unitaires et integration backend ;
- doit preciser quelles suites existantes doivent rester vertes sans baisse de couverture utile ;
- ne doit pas masquer une regression par simple assouplissement d'assertions.
**Criteres d'acceptation :**
- chaque etat majeur de run et task est teste ;
- les transitions interdites sont explicitement verifiees ;
- les erreurs de contrat sont couvertes.

### US-J4-02 - Tester migrations, idempotence et compatibilite legacy

**Agent responsable :** `05-testeur-domaine.agent.md` - Testeur domaine
**Criticite :** Critique
**Description :** valider la migration V1 -> V2, sa reexecution et la lisibilite des donnees historiques apres bascule.
**Dependances :** US-J3-02.
**Risques et consequences :**
- une migration apparemment correcte peut casser des cas historiques rares ;
- un rerun non teste peut produire des doublons une fois en CI/CD ou en reprise reelle ;
- une compatibilite surestimee peut faire perdre des workflows existants a l'ouverture.
**Impacts codebase et tests :**
- s'appuie sur fixtures backend ou jeux de donnees representatifs ;
- doit verifier que les snapshots, runs et hydrations restaurent les memes informations utiles ;
- doit produire un rapport des ecarts residuels si des cas legacy restent differes.
**Criteres d'acceptation :**
- tests de migration verte, relance et reprise apres echec ;
- verification des donnees V1 converties ;
- rapport des ecarts residuels documente.

### US-J4-03 - Tester resilience runtime, retries et annulations

**Agent responsable :** `05-testeur-domaine.agent.md` - Testeur domaine
**Criticite :** Haute
**Description :** reproduire les scenarios de panne sur worker, queue, dependance externe et annulation en cours d'execution.
**Dependances :** US-J3-03, US-J3-04.
**Risques et consequences :**
- sans test de panne, la premiere reprise reelle se fera en production ;
- une annulation non fiable peut laisser des effets de bord ou des artefacts incomplets ;
- des retries mal bornes peuvent creer des surcouts ou des blocages en cascade.
**Impacts codebase et tests :**
- peut ajouter des tests de panne et de redemarrage ;
- doit couvrir timeout, retry, tache dupliquee et abandonnee ;
- doit verifier que les evenements temps reel ne masquent pas l'etat metier reel.
**Criteres d'acceptation :**
- panne worker et reprise validees ;
- tache dupliquee et abandonnee testees ;
- timeout, retry et annulation couverts avec assertions precises.

## J5 - Cutover frontend V2

**Agent pilote :** `06-frontend.agent.md` - Front-end
**Criticite du jalon :** Critique
**But :** retirer la logique de persistance hybride du frontend et consommer les contrats serveur comme source de verite unique.

**Fichiers a toucher en priorite :**
- `App.tsx`
- `types.ts`
- `stores/**`
- `services/**`
- `contexts/**`
- `components/workflow/**`
- `components/V2AgentNode.tsx`
- `components/WorkflowCanvas.tsx`
- `components/RobotPageRouter.tsx`
- `tests/fixtures/workspaceHydration.fixtures.ts`
- `tests/fonctionnels/App.workspaceHydration.integration.test.tsx`
- `tests/unitaires/App.workspaceHydration.test.tsx`
- `tests/components/WorkflowCanvas.render.test.tsx`
- `tests/components/WorkflowCanvas.drag-collision.test.tsx`
- `tests/components/WorkflowCanvas.minimize-restore.test.tsx`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** `tests/fixtures/workspaceHydration.fixtures.ts`, tests d'hydratation, tests canvas, parcours live utilisant des payloads de workspace.
**Changements fonctionnels a anticiper :** changement de forme ou de timing de l'hydratation, actions runtime desactivees selon l'etat reel serveur, messages d'erreur et etats partiels plus explicites.

### US-J5-01 - Decouper `App.tsx` et isoler les domaines frontend

**Agent responsable :** `06-frontend.agent.md` - Front-end
**Criticite :** Critique
**Description :** sortir de `App.tsx` les responsabilites d'hydratation, persistance et orchestration au profit de services ou stores par domaine.
**Dependances :** J2 termine.
**Risques et consequences :**
- tant que `App.tsx` centralise tout, chaque changement runtime menace les parcours design ;
- un decoupage mal sequence peut casser l'initialisation globale de l'application ;
- une migration front trop rapide peut rendre le canvas inutilisable si les stores ne sont pas synchronises.
**Impacts codebase et tests :**
- peut creer ou deplacer des fichiers dans `stores/**`, `services/**` et `components/**` ;
- doit adapter `tests/fixtures/workspaceHydration.fixtures.ts` uniquement si les contrats evoluent reellement ;
- doit conserver au vert `npm run test:integration:hydration`.
**Criteres d'acceptation :**
- `App.tsx` n'orchestre plus directement la persistance workflow ;
- les domaines workflow, nodes, edges, instances et runs sont separes ;
- les tests d'hydratation restent verts.

### US-J5-02 - Brancher l'UI sur les contrats V2 de workflow et run

**Agent responsable :** `06-frontend.agent.md` - Front-end
**Criticite :** Critique
**Description :** consommer les DTO backend pour publication, activation, lancement, annulation et suivi des runs sans reconstruire de verite locale V1.
**Dependances :** US-J5-01, US-J2-04, US-J3-04.
**Risques et consequences :**
- une UI qui reconstruit encore des objets legacy peut afficher un etat faux par rapport au serveur ;
- un mauvais mappage des statuts peut activer des actions interdites ;
- un suivi temps reel mal filtre peut melanger les runs de plusieurs workflows.
**Impacts codebase et tests :**
- peut modifier services API, stores runtime et composants de pilotage ;
- doit laisser verts `npm run test:integration:hydration`, `npm run test:components:ci` et `npm run test:canvas:non-regression` ;
- doit tracer explicitement toute adaptation de fixtures comme evolution fonctionnelle et non comme simple correction de test.
**Criteres d'acceptation :**
- les commandes runtime sont basees sur les API V2 ;
- les etats loading, error, empty, offline et partial sont traites ;
- les actions impossibles sont desactivees.

### US-J5-03 - Finaliser l'observation runtime et la non-regression d'usage

**Agent responsable :** `06-frontend.agent.md` - Front-end
**Criticite :** Haute
**Description :** afficher les runs et tasks en temps reel, gerer la reconnexion et maintenir la stabilite du canvas pendant les executions.
**Dependances :** US-J5-02.
**Risques et consequences :**
- une mise a jour temps reel mal integree peut perturber le canvas ou reinitialiser des selections utilisateur ;
- l'absence de mode degrade rendra l'application opaque en cas de perte de canal ;
- une mauvaise gestion des erreurs runtime peut donner l'impression que le workflow est bloque alors que seul le suivi l'est.
**Impacts codebase et tests :**
- peut modifier les composants runtime et le branchement socket ;
- doit rester coherent avec le durcissement securite du temps reel ;
- doit ajouter des tests d'interaction et de reconnexion si le comportement change.
**Criteres d'acceptation :**
- suivi des runs et tasks visible et coherent ;
- comportement de reconnexion defini ;
- tests d'interaction et de non-regression sur les parcours critiques.

## J6 - Validation finale de livraison

**Agent pilote :** `08-testeur-e2e.agent.md` - Testeur E2E final
**Criticite du jalon :** Critique
**But :** valider que la refonte est livrable, que les parcours critiques fonctionnent et que la suppression progressive du legacy est soutenable.

**Fichiers a toucher en priorite :**
- `tests/fonctionnels/**`
- `playwright.config.ts`
- `playwright.live.config.ts`
- `tests/fonctionnels/J7.Editor.RealBrowser.semi-e2e.spec.ts`
- `tests/fonctionnels/AuthenticatedWorkspaceMedia.live.smoke.spec.ts`
- `backend/src/__tests__/workspace-snapshot.test.ts`
- `tests/fixtures/workspaceHydration.fixtures.ts`
- `Guides/Features/feature/refonte/backlog/v1-v2-refonte-backlog.md`

**Matrice d'adaptation fixtures QA/BDD :** requise.
**Surfaces de fixtures a verifier :** scenarios Playwright, fixtures d'hydratation, snapshots backend, donnees Mongo d'entrainement QA, smoke tests live.
**Changements fonctionnels a anticiper :** differences visibles de parcours de chargement, de suivi runtime, de reprise apres redemarrage et de refus d'acces sur ressources non possedees.

### US-J6-01 - Executer la campagne E2E complete V2

**Agent responsable :** `08-testeur-e2e.agent.md` - Testeur E2E final
**Criticite :** Critique
**Description :** couvrir installation, authentification, creation ou chargement workflow, activation, lancement de run, suivi runtime, annulation, retry et reprise.
**Dependances :** J3, J4 et J5 termines.
**Risques et consequences :**
- sans campagne complete, des ruptures inter-couches resteront invisibles jusqu'a la livraison ;
- les scenarios temps reel ou reprise apres redemarrage sont des zones ou les regressions sont souvent tardives ;
- une validation partielle donnera une confiance artificielle sur un chantier fortement transverse.
**Impacts codebase et tests :**
- s'appuie sur Playwright et sur les fixtures applicatives existantes ;
- doit verifier que les donnees de test QA restent exploitables apres migration ;
- doit produire des traces et rapports utilisables pour arbitrer la livraison.
**Criteres d'acceptation :**
- les scenarios nominaux et d'echec majeurs sont automatises ;
- les traces utiles sont capturees ;
- un rapport de validation est produit.

### US-J6-02 - Valider l'absence de regression legacy bloquante

**Agent responsable :** `08-testeur-e2e.agent.md` - Testeur E2E final
**Criticite :** Critique
**Description :** verifier que les parcours existants encore supportes restent operationnels pendant la phase de cutover et que la desactivation legacy n'introduit pas de panne cachee.
**Dependances :** US-J6-01.
**Risques et consequences :**
- une coupure legacy prematuree peut bloquer des utilisateurs sur des workflows historiques ;
- un parcours encore utilise mais non documente peut tomber sans alerte ;
- l'absence de verification multi-navigateurs ou de rechargement en cours de run peut masquer des regressions visibles chez les utilisateurs.
**Impacts codebase et tests :**
- s'appuie sur la matrice de non-regression et sur les fixtures BDD d'entrainement QA ;
- doit identifier les adaptations fonctionnelles necessaires sur snapshots, hydrations et donnees seedees ;
- doit classer clairement ce qui releve d'une correction, d'un changement de contrat ou d'une dette reportee.
**Criteres d'acceptation :**
- la matrice de non-regression est executee ;
- les anomalies sont classees en bloquantes, majeures et mineures ;
- une recommandation Go ou No-Go est formulee.

## 7. Adaptations fonctionnelles et structurelles a anticiper

Les modifications du backlog impliquent potentiellement :

- creation de nouveaux modules sous `backend/src/domain/**`, `backend/src/application/**` et `backend/src/infrastructure/repositories/**` ;
- refactor de `backend/src/routes/**` pour alleger les controllers ;
- decoupage de `backend/src/services/databaseInit.ts` ;
- ajout ou mise a jour de migrations dans `backend/src/migrations/**` ;
- creation ou adaptation de stores et services frontend hors de `App.tsx` ;
- adaptation des fixtures d'hydratation, de snapshot et de runs si les contrats changent reellement.

Toute suppression de fichier ou dossier legacy doit etre precedee d'un inventaire d'usage, d'une verification de compatibilite et d'une strategie de repli.

## 8. Matrice d'adaptation des fixtures QA et BDD

| Surface | Fichiers ou sources | Jalon principal | Adaptation attendue | Nature du changement |
|---|---|---|---|---|
| Hydratation frontend | `tests/fixtures/workspaceHydration.fixtures.ts` | J1, J5 | aligner le payload de workflow, nodes, edges, agentInstances et etats runtime sur les contrats V2 reellement retenus | fonctionnel |
| Snapshot backend unifie | `backend/src/__tests__/workspace-snapshot.test.ts` | J1, J2, J3, J4 | mettre a jour le snapshot si la source de verite, les runs, les edges ou les journaux changent | fonctionnel |
| Fixtures auth workflow | `backend/src/__tests__/auth-workflows.routes.test.ts` | J1, J4 | adapter si les droits, claims JWT ou filtres d'ownership evoluent | securite |
| Fixtures runs et artifacts | `backend/src/__tests__/function-runs.routes.test.ts` | J2, J4 | adapter aux nouvelles transitions, a l'idempotence et aux payloads d'artefacts | fonctionnel |
| Fixtures runtime sandbox | `backend/src/__tests__/sandbox.routes.test.ts` | J2, J3, J4 | adapter si les statuts de run/task, policies d'execution ou erreurs changent | runtime |
| Seeds techniques backend | `backend/src/seeds/**` | J3 | maintenir la compatibilite des jeux de donnees et documenter tout nouveau seed | donnees |
| Bootstrap et seed central | `backend/src/services/databaseInit.ts` | J0, J3 | isoler bootstrap, migrations et seed sans casser les donnees d'entrainement QA | donnees |
| Smoke tests live QA | `tests/fonctionnels/AuthenticatedWorkspaceMedia.live.smoke.spec.ts` | J5, J6 | verifier si les parcours rehydrates, medias ou journaux changent de forme ou de source | fonctionnel |
| Parcours hydratation | `tests/fonctionnels/App.workspaceHydration.integration.test.tsx` | J5 | adapter a la nouvelle autorite V2 sans reintroduire de reconstruction V1 cote client | fonctionnel |
| Fixtures BDD d'entrainement QA | base Mongo locale, seeds et scripts de demarrage | J3, J6 | verifier que les donnees de formation restent exploitables apres migration et cutover | donnees |

### Regles pour les agents

- toute modification de fixture doit etre rattachee a une evolution fonctionnelle identifiee ;
- une fixture ne doit jamais etre assouplie pour masquer une regression ;
- si une fixture change de forme, documenter quel contrat a change, quel jalon l'impose et quels tests doivent etre rejoues ;
- si les QA utilisent des donnees seedees en BDD, toute migration doit inclure un mode de reprise ou de re-seed documente.

## 9. Changements fonctionnels a anticiper

| Theme | Changement probable | Jalons concernes | Impact utilisateur ou QA |
|---|---|---|---|
| Workflow comme source de verite | fin progressive de la dependance a `Workflow.nodes` et `Workflow.edges` | J0 a J3 | differences possibles de contenu hydrate ou de restauration si la compatibilite n'est pas preservee |
| Publication et activation | validation plus stricte avant activation d'un workflow | J1, J2 | certains workflows historiquement acceptes peuvent devenir invalides tant qu'ils ne sont pas corriges |
| Runs et tasks | apparition d'etats explicites et comportements d'annulation ou retry plus stricts | J1 a J4 | les QA devront tester davantage de transitions et de cas d'echec |
| Temps reel | filtrage utilisateur et payloads versionnes | J1, J3, J5 | comportements de reconnexion et d'observation potentiellement modifies |
| Hydratation frontend | source V2 prioritaire et reduction de la reconstruction locale | J5 | le chargement initial peut changer de forme, de timing ou de messages d'etat |
| Migrations de donnees | backfill V1 -> V2 et suppression progressive du legacy | J3, J4, J6 | besoin de verifier la conservation des workflows historiques et des jeux de donnees QA |
| Seeds et bootstrap | separation bootstrap / migrations / seed | J3 | les environnements de formation QA peuvent requerir un nouveau mode d'initialisation |

### Consigne explicite aux agents

- avant tout changement de code, verifier si le jalon implique une matrice d'adaptation de fixtures QA/BDD ;
- si oui, mettre a jour a la fois la liste des fichiers touches et l'impact fonctionnel attendu ;
- ne jamais supposer qu'une adaptation de fixture est neutre fonctionnellement ;
- si un changement met en danger le 100 % vert des tests existants, traiter cela comme un bloqueur de jalon.

## 10. Sequence d'execution imposee

1. Terminer J0 avant toute extraction lourde.
2. Terminer J1 avant les repositories et use cases backend.
3. Terminer J2 avant les migrations de donnees et le runtime distribue.
4. Terminer J3 avant la campagne de resilience et avant le cutover frontend complet.
5. Terminer J4 avant la validation finale.
6. Terminer J5 avant J6.

## 11. Points de vigilance transverses

- `App.tsx` est une zone a haut risque de regression car il centralise encore hydratation, persistance et navigation.
- `backend/src/routes/**` est une zone a haut risque de derive car elle melange historiquement plusieurs generations de contrats.
- `backend/src/services/databaseInit.ts` est une zone a haut risque car elle concentre bootstrap, migration et seed.
- `stores/useWorkflowStore.ts` reste une surface de derive frontend car il maintient encore un aggregate local `Workflow` avec `nodes` et `edges`.
- `services/workspacePersistenceService.ts` reste une surface de derive frontend car `saveEdges()` pointe encore vers un write path legacy `/api/workflows/:id/edges`.
- `backend/src/websocket/WebSocketManager.ts` doit etre traite comme surface de securite et de coherence runtime, pas comme simple detail technique.
- Toute user story touchant les statuts de run ou task doit verifier l'impact sur le temps reel, les retries et les annulations.
- Toute user story touchant les migrations doit verifier l'impact sur les workflows existants, les fixtures QA et la reprise apres incident.

## 12. Definition of Done du backlog

Le backlog est considere execute quand :

1. toutes les user stories critiques sont implementees et testees ;
2. V2 est la seule source d'ecriture metier ;
3. les migrations sont rejouables sans doublon ;
4. les runs et tasks sont pilotables sans navigateur ouvert ;
5. le frontend ne reconstruit plus de verite concurrente depuis V1 ;
6. les fixtures QA et automatiques ont ete adaptees explicitement quand les contrats ont change ;
7. les suites de tests impactees restent au vert ;
8. la validation domaine et E2E produit un resultat exploitable pour la livraison.