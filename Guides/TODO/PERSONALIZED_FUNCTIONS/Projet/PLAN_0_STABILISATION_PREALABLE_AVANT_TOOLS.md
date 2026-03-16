# PLAN 0 — Stabilisation Prealable de l'Application avant la Refonte Tools

> Date: 16 mars 2026
> Statut: Plan de pre-stabilisation obligatoire
> Objet: Corriger les defauts recurrents de l'application avant tout travail d'implementation du plan Tools
> Public cible: equipe de developpeurs qui decouvre le contexte et doit remettre la base applicative dans un etat sain, SOLID et testable

---

## 1. Decision de pilotage

Avant d'implementer le plan structurel Tools, l'application doit d'abord revenir a un etat:
- sain,
- coherent,
- predictible,
- testable,
- sans dette critique accumulee sur les couches deja existantes.

Ce plan 0 est donc un **prerequis d'execution** du plan 1.

Le principe retenu est simple:

> On ne construit pas une architecture complexe de Tools sur une base applicative qui presente encore des ruptures recurrentes de contrats, de persistance, de configuration, de validation ou de tests.

---

## 2. Sources utilisees pour ce plan

Ce plan s'appuie sur:
- [PLAN_CORRECTIONS_QA_J1-J7.md](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/Guides/TODO/PERSONALIZED_FUNCTIONS/Plan_corrections_todos/PLAN_CORRECTIONS_QA_J1-J7.md)
- [CORRECTIONS_TECHNIQUES.md](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/documentation/guides/corrections/CORRECTIONS_TECHNIQUES.md)
- [CORRECTIONS_POINTS_5-6.md](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/backend/documentation/guides/corrections/CORRECTIONS_POINTS_5-6.md)
- [TESTS_SUMMARY.md](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/tests/TESTS_SUMMARY.md)
- [REFERENCE_ERREURS_ET_LECONS_TOOLS_V2.md](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/REFERENCE_ERREURS_ET_LECONS_TOOLS_V2.md)

---

## 3. Diagnostic general

Les defauts recurrents observes ne relevent pas d'une seule fonctionnalite. Ils se regroupent dans des familles de defauts structurels:

1. **Derive des contrats Frontend ↔ Backend**
2. **Persistance et hydration non deterministes**
3. **Configuration runtime insuffisamment scopee**
4. **Validation et gouvernance metier inegales selon les flux**
5. **Tests incomplets, obsoletes ou non alignes avec les schemas reels**
6. **Dette legacy maintenue trop pres du coeur applicatif**

Les retours QA recents et l'audit de code confirment en plus quatre mecanismes racines transverses:

1. **Multiples sources de verite pour une meme donnee critique**
2. **Hydration orchestree depuis App.tsx avec reconstruction ad hoc des etats**
3. **Resolution de configuration par lookup global au lieu d'un resolver scope**
4. **Coexistence de couches legacy et V2 sur les memes flux de persistance**

Tant que ces familles de problemes ne sont pas traitees, toute implementation Tools restera exposee a:
- des regressions croisées,
- des faux positifs QA,
- des corruptions silencieuses de donnees,
- des comportements non reproductibles.

---

## 4. Familles de defauts a corriger en priorite

## 4.1 Famille A — Derive des contrats DTO/API

### Symptomes deja observes
- payload frontend qui n'envoie pas les bons champs
- route backend qui n'extrait pas les bons champs
- mismatch entre types frontend et types backend
- reponses API qui ne rehydratent pas la structure attendue par l'UI

### Exemples documentes
- `functionIds` omis dans les payloads prototypes
- `model` vs `llmModel`
- differents noms de champs ou schemas entre frontend, Zod et Mongoose

### Risque
Le systeme semble fonctionner dans l'UI, mais la BDD n'enregistre pas le bon etat reel.

### Correctif structurel attendu
Instaurer une regle stricte:

1. chaque aggregate important dispose de DTOs explicites
2. chaque mapping frontend -> API et API -> frontend est centralise
3. aucun composant React n'improvise la forme finale des donnees backend
4. toute route backend valide et transforme explicitement son payload

### Lots assignables

#### Lot A1 — Audit DTO global
- inventorier tous les DTO critiques de l'application
- identifier les mismatches `types.ts` / services API / routes / modeles
- produire la table de mapping officielle par domaine

#### Lot A2 — Normalisation mappings
- centraliser les mappers frontend/backend
- eliminer les transformations inline dispersees
- ajouter tests unitaires sur chaque mapper critique

#### Lot A3 — Verrouillage de schema
- aligner Zod, DTO, Mongoose et projections de reponse
- ajouter tests de contrat pour les routes critiques

---

## 4.2 Famille B — Persistance, hydration et heritage

### Symptomes deja observes
- donnees bien affichees puis perdues apres refresh
- heritage prototype -> instance non visible ou incomplet
- objets sauvegardes mais non rehydrates correctement
- etat persistant different de l'etat visible
- navigateur laisse ouvert longtemps puis retour/refresh avec disparition des agents du canvas
- etat workflow visible reconstruit a partir de plusieurs sources contradictoires

### Exemples confirmes par audit
- `App.tsx` concentre une hydration tres lourde avec fetch multiple, merge, deduplication et reconstruction de `configuration_json`
- coexistence d'un flux legacy de noeuds et d'un flux V2 `agentInstances + V2WorkflowNode`
- lecture du workspace via `/api/user/workspace` puis recharge separee d'instances de workflow avant re-merge frontend
- persistance locale legacy encore presente via `workflow-editor-data`, `persistenceService` et `workspacePersistenceService`

### Risque
L'utilisateur perd confiance dans l'application. Le futur systeme Tools serait expose a des pertes silencieuses d'activation de fonctions, d'heritage ou de configuration d'instance.

### Correctif structurel attendu
Definir clairement, pour chaque ecran metier:
- la source de verite,
- la projection UI,
- la strategie de sauvegarde,
- la strategie de rehydratation.

Le pattern cible doit etre explicite:

1. un **WorkspaceHydrationOrchestrator** unique cote frontend
2. des **DTOs de lecture backend** deja complets, sans reconstruction approximative cote UI
3. une seule source de verite pour les noeuds affiches
4. une politique de rechargement capable de distinguer `loading`, `stale`, `restoring-session`, `ready`

### Lots assignables

#### Lot B1 — Audit des flux de persistance
- prototypes
- instances
- workflows
- settings
- journaux/messages si applicables
- session/auth et restauration apres expiration ou retour d'onglet
- inventaire des persistances legacy encore actives en localStorage

#### Lot B2 — Rehydratation deterministe
- verifier que l'etat rehydrate provient bien de la source de verite
- interdire les reconstructions approximatives cote frontend
- supprimer les merges opportunistes frontend quand le backend peut fournir une projection complete
- isoler un contrat unique `WorkspaceSnapshotDTO`

#### Lot B3 — Tests TNR de persistance
- creation -> sauvegarde -> refresh -> rehydratation
- heritage prototype -> instance -> override
- logout/login -> rechargement complet
- onglet laisse ouvert longtemps -> expiration session -> refresh -> restauration ou echec explicite sans perte silencieuse

---

## 4.3 Famille C — Isolation et resolution de configuration

### Symptomes deja observes
- confusion entre endpoints de LLMs locaux
- resolution par provider au lieu de resolution par instance/profil
- comportement correct au premier appel puis incorrect au second
- modification d'un port ou d'une cle LLM non appliquee immediatement aux agents actifs
- templates ou agents sur workflow utilisant une configuration stale apres sauvegarde des settings

### Exemples confirmes par audit
- pattern `find(provider)` encore present sur plusieurs zones UI/runtime
- `SettingsModal` et `App.tsx` consomment chacun leur propre hook `useLocalLLMProfiles`, sans source reactive partagee
- trois sources de verite pour les configs LLM: `AuthContext`, state React de `App.tsx`, `useRuntimeStore`

### Risque
Erreur majeure de logique, d'isolation et de securite. Le systeme Tools serait catastrophiquement expose si les outils ou secrets utilisaient les memes raccourcis.

### Correctif structurel attendu
Instaurer une regle applicative globale:

> toute ressource de configuration doit etre resolue par identite forte et contexte d'execution, jamais par lookup global opportuniste.

Le pattern cible doit etre explicite:

1. un **ConfigResolver** unique pour resoudre la configuration effective d'un agent
2. un **ConfigRepository** unique pour exposer les LLM configs et les profils locaux
3. des bindings explicites `agentInstanceId -> localLLMProfileId -> endpoint`
4. une propagation evenementielle ou store-first apres sauvegarde des settings

### Lots assignables

#### Lot C1 — Audit des resolutions singleton
- configs LLM
- settings agent
- permissions robot
- toute ressource resolue par `find(provider)` ou equivalent

#### Lot C2 — Remplacement par resolution scopee
- userId
- workflowId
- prototypeId
- agentInstanceId
- localLLMProfileId
- interdiction des dependances runtime sur des tableaux recherches par provider uniquement

#### Lot C3 — TNR d'isolation
- 2 agents, 2 configurations, 2 providers/2 endpoints
- verification multi-requetes et multi-tours
- verification apres modification a chaud d'une cle API ou d'un endpoint local

---

## 4.4 Famille D — Validation metier et gouvernance

### Symptomes deja observes
- gouvernance appliquee a certains flux mais pas a d'autres
- validation schema presente sans validation metier complete
- protections de securite UX absentes ou inconsistantes

### Exemples documentes
- consentement `bash_py`
- validation `RobotId`
- auth manquante dans certains appels

### Risque
L'application accumule des regles metier implicites dans les composants, ce qui rend les evolutions fragiles.

### Correctif structurel attendu
- centraliser les regles de gouvernance
- separer validation de format et validation metier
- imposer des middlewares/services de policy reutilisables

### Lots assignables

#### Lot D1 — Inventaire des regles metier critiques
- gouvernance robots
- auth requise / guest mode
- politiques d'activation de capabilities
- consentements explicites

#### Lot D2 — Centralisation
- middlewares backend
- utilitaires de validation metier
- suppression des regles dispersees dans l'UI quand elles doivent etre backend-first

#### Lot D3 — Tests de gouvernance
- 400/403/401 explicites
- cas autorises / refuses documentes

---

## 4.5 Famille E — Sante runtime et readiness applicative

### Symptomes deja observes
- dependance declaree mais pas disponible au runtime reel
- executable detecte a chaud trop tard
- fonctionnalite visible alors que son runtime n'est pas sain
- session expiree sans mecanisme de refresh effectivement branche a l'hydratation API
- page qui se recharge dans un etat vide au lieu d'un etat degrade explicite

### Risque
Le futur systeme Tools echouerait encore avant meme le sandbox, exactement comme lors des QA precedents.

### Correctif structurel attendu
- health checks au boot
- readiness explicite des composants critiques
- scripts d'installation et de verification idempotents
- health/session checks explicites pour l'auth et la restauration de workspace

### Lots assignables

#### Lot E1 — Health inventory
- runtimes Node/Python
- Docker
- MongoDB
- routes backend critiques

#### Lot E2 — Boot readiness
- service de health central
- etats `healthy`, `degraded`, `unhealthy`
- journalisation claire des verifications
- etat `restoring-session` si le token doit etre rafraichi avant hydration

#### Lot E3 — CI/verification locale
- scripts de check
- blocage des builds si runtime critique non valide
- verification d'un refresh token flow reellement branche ou suppression explicite de la promesse de refresh si non supportee

---

## 4.7 Defauts concrets confirmes par audit de code

Les exemples QA sont maintenant relies a des zones de code concretes. Ils ne doivent plus etre traites comme des anomalies isolees, mais comme des symptomes d'architecture.

### Defaut confirme 1 — Propagation incomplete des profils LLM locaux
- `SettingsModal` sauvegarde les profils locaux via son propre hook, tandis que `App.tsx` alimente le runtime via un autre hook distinct
- consequence: un changement d'endpoint local peut etre sauve mais ne pas etre repropage immediatement aux agents existants
- famille impactee: C, puis B

### Defaut confirme 2 — Hydration racine trop lourde et trop imperative
- `App.tsx` realise fetch, merge, deduplication, mapping DTO, reconstruction d'instances, generation de noeuds et hydration multi-store
- consequence: rechargement fragile, etats transitoires incoherents, disparition temporaire ou durable d'agents sur le canvas
- famille impactee: B, puis A

### Defaut confirme 3 — Session resiliente promise mais branchement incomplet
- un flow de refresh token existe dans `AuthContext`, mais il n'est pas branche au client API ni a la sequence de rehydratation
- consequence: navigateur laisse ouvert trop longtemps puis retour sur application avec 401, hydration partielle ou etat vide sans restauration fiable
- famille impactee: E, puis B

### Defaut confirme 4 — Double persistance legacy/V2 encore active
- presence simultanee de persistance locale legacy, stores Zustand V2, state React legacy et endpoints backend composites
- consequence: divergence entre noeuds visibles, instances persistees et etat rehydrate
- famille impactee: B, F et dette legacy

---

## 4.6 Famille F — Dette de tests et tests faux positifs/faux negatifs

### Symptomes deja observes
- tests en echec pour de mauvaises raisons mineures
- tests obsoletes par rapport aux schemas reels
- trous de couverture sur les contrats critiques

### Risque
Equipe croyant partir sur une base saine alors que les tests n'encadrent pas les vrais invariants.

### Correctif structurel attendu
- remettre la pyramide de tests en coherence avec les vrais risques
- prioriser TNR, persistance, isolation et contrats API

### Lots assignables

#### Lot F1 — Nettoyage des tests cassants
- corriger les tests faux-negatifs simples
- supprimer ou marquer legacy les tests devenus hors sujet

#### Lot F2 — Couverture des invariants critiques
- auth
- DTO/API
- persistance/hydration
- isolation par agent
- gouvernance

#### Lot F3 — Matrice de test pre-Tools
- liste minimale des suites devant etre vertes avant lancement du plan Tools

---

## 5. Ordre d'execution recommande

L'equipe ne doit pas traiter ces familles au hasard.

Ordre impose:

1. **Famille A — DTO/API contracts**
2. **Famille B — Persistance et hydration**
3. **Famille C — Isolation des configurations**
4. **Famille D — Validation metier et gouvernance**
5. **Famille E — Runtime health et readiness**
6. **Famille F — Dette de tests**

Raison:
- sans contrats fiables, on ne peut pas stabiliser la persistance
- sans persistance saine, impossible de juger les regressions d'isolation ou de gouvernance
- sans readiness, toute verification Tools serait bruitee par des faux incidents d'environnement

---

## 6. Jalons prescriptifs assignables

## Jalon S0.1 — Audit de stabilite globale

### Objectif
Produire la cartographie definitive des ruptures de contrats, de persistance et de configuration.

Ce jalon absorbe explicitement le **point 3 demande par le CdP et les QA**:

> auditer les erreurs, incoherences et dettes residuelles issues de developpements precedents non corriges, puis les reinjecter dans le backlog principal de stabilisation.

### Livrables
- matrice des domaines defectueux
- mapping fichiers impactes
- tableau causes racines / gravite / regressions possibles
- cartographie des sources de verite concurrentes par domaine
- inventaire des patterns a supprimer (`find(provider)`, hydration root imperative, dual persistence)

### Equipe cible
- 1 agent architecture
- 1 agent exploration codebase

### Definition of Done
- tous les defauts classes dans les 6 familles
- backlog de correction priorise

### Todo list prioritaire — Audit du point 3

1. **Inventorier les correctifs historiques incomplets**
- relire les plans de correction QA, les guides backend de correction et les resumes de tests
- isoler les anomalies marquees comme corrigees mais encore suspectes
- lister les TODO techniques encore proches des zones critiques runtime/persistance/config

2. **Cartographier les incoherences encore presentes dans le code**
- identifier les doubles sources de verite
- identifier les hydrations ou reconstructions ad hoc
- identifier les lookups globaux non scopes
- identifier les couches legacy qui coexistent avec les flux V2

3. **Classer les anomalies par impact reel**
- impact securite
- impact perte de donnees
- impact divergence UI/BDD
- impact QA non deterministe
- impact dette de maintenance

4. **Rattacher chaque anomalie a une famille de Plan 0**
- famille A si derive de contrat
- famille B si persistance/hydration
- famille C si resolution de configuration
- famille D si validation/gouvernance
- famille E si readiness/session/runtime
- famille F si dette de test ou signal absent

5. **Transformer l'audit en backlog actionnable pour agents developpeurs**
- une entree de backlog par cause racine, pas par symptome
- fichiers cibles explicites
- invariants a proteger
- tests/TNR attendus
- risques de regression a surveiller

---

## 6.1 Backlog complet — S0.1 Audit de stabilite globale

### Epic S0.1.A — Audit dette residuelle et correctifs historiques incomplets

#### Stories
- verifier les correctifs des anciens jalons QA critiques
- verifier les zones historiquement cassees autour de l'hydratation, des instances, du routing LLM et de la persistence
- identifier les correctifs partiels, contournements temporaires et patchs non industrialises

#### Taches assignables
- constituer la liste des documents de reference a revalider
- faire la correspondance document -> fichiers reels impactes
- marquer chaque point comme `corrige`, `partiellement corrige`, `non corrige`, `obsolete`
- remonter tous les points `partiellement corrige` et `non corrige` dans le backlog principal

#### Livrables
- registre de dette residuelle
- tableau de tracabilite doc -> code -> statut reel

### Epic S0.1.B — Cartographie des sources de verite concurrentes

#### Stories
- localiser les donnees critiques stockees a plusieurs endroits
- qualifier la source de verite legitime par domaine

#### Taches assignables
- cartographier `AuthContext`, stores Zustand, state React local, localStorage, backend snapshot
- pour chaque donnee critique, indiquer la source autoritaire et les projections derivees
- identifier les synchronisations manuelles fragiles

#### Livrables
- matrice `donnee critique -> source autoritaire -> projections -> points de drift`

### Epic S0.1.C — Audit des patterns interdits

#### Stories
- detecter tous les patterns qui violent le cadre SOLID retenu

#### Taches assignables
- recenser `find(provider)` et equivalents sur les ressources critiques
- recenser les reconstructions frontend d'un objet que le backend peut projeter completement
- recenser les flux legacy et V2 qui coexistent sur la meme fonctionnalite
- recenser les promesses de readiness/session non branchees reellement

#### Livrables
- catalogue des patterns a supprimer
- liste des patterns de remplacement attendus

### Epic S0.1.D — Priorisation finale du backlog de stabilisation

#### Stories
- convertir l'audit en lotissement executable pour les agents developpeurs

#### Taches assignables
- creer les tickets backlog par cause racine
- lier chaque ticket aux familles A a F
- lier chaque ticket a un critere de non-regression
- definir ordre strict d'attaque

#### Livrables
- backlog priorise P0/P1/P2
- ordre d'execution confirme pour S0.2 a S0.7

---

## Jalon S0.2 — Normalisation des contrats Front/Back

### Objectif
Rendre fiables tous les echanges de donnees critiques.

### Livrables
- DTOs centralises
- mappers officiels
- validation backend alignee
- tests de contrat

### Fichiers principalement impactes
- services API frontend
- routes backend
- schemas Zod
- modeles Mongoose

### Definition of Done
- aucun aggregate critique sans mapper explicite
- aucun payload critique sans test de contrat

## 6.2 Backlog complet — S0.2 Normalisation des contrats Front/Back

### Epic S0.2.A — Inventaire des aggregates et DTO critiques
- prototypes
- instances
- workflows
- settings LLM
- profils LLM locaux
- journaux/messages si exposes au frontend

### Epic S0.2.B — Alignement des schemas et noms de champs
- verifier `model` vs `llmModel`
- verifier `functionIds`, `tools`, `legacyTools`, `functionInheritance`
- verifier tous les champs LLM et persistence exposes dans `configuration_json`
- supprimer les mappings implicites disperses

### Epic S0.2.C — Centralisation des mappers
- creer ou consolider un mapper backend -> frontend par aggregate critique
- creer ou consolider un mapper frontend -> backend par commande critique
- interdire les transformations inline dans les composants React critiques

### Epic S0.2.D — Contrats de tests
- tests de contrat pour routes workspace, instances, prototypes, settings
- tests de non-regression sur les reponses composites de hydration

---

## Jalon S0.3 — Stabilisation persistance/hydration

### Objectif
Garantir qu'un etat sauvegarde est rehydrate identiquement.

### Livrables
- flux prototypes/instances/workflows stabilises
- rehydratation deterministe documentee
- TNR complets sur refresh/login/logout
- strategie explicite de restauration de session et de reprise apres longue inactivite

### Definition of Done
- les flux de persistance critiques passent les TNR sans divergence d'etat
- un refresh de page ne depend plus de reconstructions opportunistes cote frontend

## 6.3 Backlog complet — S0.3 Stabilisation persistance/hydration

### Epic S0.3.A — Unification de la lecture workspace
- choisir un contrat unique de snapshot workspace
- eliminer les re-fetchs ou merges redondants quand la projection composite suffit
- definir l'orchestrateur de hydration frontend unique

### Epic S0.3.B — Elimination des doubles persistances
- inventorier persistance legacy locale encore active
- inventorier persistance V2 store/backend
- decider quelles couches restent temporaires et lesquelles doivent etre retirees du flux critique

### Epic S0.3.C — Stabilisation du cycle sauvegarde -> refresh -> rehydratation
- prototype modifie puis instance relue
- instance modifiee puis canvas relu
- workflow relu apres fermeture/reouverture d'onglet
- retour apres longue inactivite avec session expiree ou restauree

### Epic S0.3.D — Durcissement de la restauration de session
- expliciter les etats `loading`, `restoring-session`, `degraded`, `ready`
- definir le comportement sur 401 durant hydration
- interdire les etats vides silencieux quand le vrai probleme est l'auth/session

---

## Jalon S0.4 — Isolation stricte des configurations

### Objectif
Supprimer toute resolution ambigue ou singleton dangereuse.

### Livrables
- audit des lookups globaux
- remplacements par resolution scopee
- TNR multi-agents / multi-configs
- design d'un resolver unique de config agent/runtime

### Definition of Done
- aucune ressource critique n'est resolue par `find(provider)` ou pattern equivalent si elle doit etre scopee par identite
- un changement de config LLM est visible par les agents concernes sans reload complet

## 6.4 Backlog complet — S0.4 Isolation stricte des configurations

### Epic S0.4.A — Audit complet des resolutions de configuration
- LLM configs cloud
- profils LLM locaux
- resolution agent instance -> config effective
- summarization/history providers
- panels annexes image/maps/video si dependants des settings LLM

### Epic S0.4.B — Definition du resolver unique
- definir l'entree: user, workflow, prototype, instance
- definir la precedence: override instance -> prototype -> defaults scopes
- definir les erreurs explicites si binding manquant ou obsolete

### Epic S0.4.C — Propagation reactive post-settings
- supprimer les hooks concurrents non coordonnes sur les memes donnees
- definir un seul repository/store de lecture pour les configurations runtime
- garantir qu'une modification d'endpoint ou de cle est visible sans reload complet

### Epic S0.4.D — TNR d'isolation
- 2 agents meme provider local, endpoints differents
- 1 agent cloud + 1 agent local
- changement a chaud d'endpoint local
- changement a chaud de cle cloud

---

## Jalon S0.5 — Gouvernance et validation metier

### Objectif
Rendre explicites et centralisees les regles metier et securitaires.

### Livrables
- middlewares / policy services centralises
- inventaire des regles metier critiques
- tests 400/401/403 stabilises

### Definition of Done
- plus aucune regle metier critique implicite ou uniquement UI

## 6.5 Backlog complet — S0.5 Gouvernance et validation metier

### Epic S0.5.A — Inventaire des regles backend-first
- auth obligatoire
- ownership
- consentements explicites
- gouvernance robots/createurs
- policies d'activation de capabilities et fonctions sensibles

### Epic S0.5.B — Separation validation de forme / validation metier
- Zod et schemas DTO pour la forme
- services ou middlewares de policy pour les regles metier
- suppression des validations metier critiques uniquement cote UI

### Epic S0.5.C — Cas de refus explicites
- harmoniser 400/401/403
- documenter les cas refuses
- couvrir les regressions majeures par tests

---

## Jalon S0.6 — Readiness runtime et hygiene d'installation

### Objectif
Faire de la sante technique une condition d'exposition des features.

### Livrables
- health checks centralises
- scripts idempotents de setup/check
- readiness visible pour les composants critiques

### Definition of Done
- aucun composant critique expose sans health check positif

## 6.6 Backlog complet — S0.6 Readiness runtime et hygiene d'installation

### Epic S0.6.A — Inventaire de sante des dependances critiques
- MongoDB
- backend API critique
- runtimes Python/Node
- Docker si concerne par les futures phases
- auth/refresh/session

### Epic S0.6.B — Contrat d'exposition des features
- une feature critique ne doit pas apparaitre comme disponible si son runtime est non sain
- les etats `healthy`, `degraded`, `unhealthy`, `restoring-session` doivent etre explicites

### Epic S0.6.C — Verification locale et CI
- scripts idempotents de verification
- checks minimaux obligatoires avant QA
- verification qu'un flow promis dans le code est reellement branche

---

## Jalon S0.7 — Durcissement des tests pre-Tools

### Objectif
Faire passer l'application dans un etat testable, avec une matrice de suites obligatoires avant lancement du plan Tools.

### Livrables
- nettoyage des tests obsoletes
- nouvelles suites sur contrats, isolation, persistance, gouvernance
- matrice de validation pre-Tools

### Definition of Done
- les suites critiques sont vertes
- les faux-negatifs connus sont supprimes ou corriges

## 6.7 Backlog complet — S0.7 Durcissement des tests pre-Tools

### Epic S0.7.A — Nettoyage du bruit de tests
- identifier les tests obsoletes
- corriger les faux-negatifs simples
- sortir du chemin critique les tests legacy sans valeur immediate

### Epic S0.7.B — Couverture des invariants du plan 0
- contrats DTO/API
- sauvegarde -> refresh -> rehydratation
- isolation des configurations LLM
- comportement session longue duree
- gouvernance et refus backend

### Epic S0.7.C — Matrice de validation obligatoire avant Plan 1
- suites unitaires minimales
- suites integration minimales
- scenarios QA manuels imposes
- criteres bloquants avant demarrage de Plan 1

---

## 7. Matrice d'impact sur l'application actuelle

### Impact faible
- layout global des pages
- UX validee de Phil
- presentation generale Bos/Archi

### Impact moyen
- services API frontend
- stores et hydration
- modales prototype/configuration

### Impact fort
- routes backend critiques
- schemas Mongoose
- contrats DTO
- logique de resolution de configuration
- readiness/runtime checks

---

## 8. Tickets operationnels assignables par role d'agent

Objectif: fournir au Chef de Projet un lotissement directement assignable aux agents d'implementation, sans re-traduction supplementaire.

Convention de priorite:
- `P0` = bloque la stabilisation globale ou expose a une regression majeure
- `P1` = necessaire pour fiabiliser durablement la base avant Plan 1
- `P2` = hygiene indispensable avant feu vert final, mais peut suivre apres les P0/P1

Convention de roles recommandes:
- `planificateur` = cadrage, decomposition, arbitrage, sequencing
- `Explore` = audit codebase, cartographie, verification des zones impactees
- `codeur-specialiste` = implementation frontend/backend generale
- `mongo-persistance` = modeles, DTO persistes, hydration, MongoDB, projections
- `testeur` = TNR, suites d'integration, matrice de validation

### Ticket S0-001 — Audit residuel des corrections historiques
- Priorite: `P0`
- Proprietaire recommande: `Explore`
- Support: `planificateur`
- Dependances: aucune
- Objectif: verifier les corrections historiques pretendument closes et isoler les points encore partiellement corriges
- Entrees: docs QA, guides de correction backend, resumes de tests, zones deja identifiees en audit
- Sorties attendues:
	- tableau `corrige / partiellement corrige / non corrige / obsolete`
	- mapping doc -> fichiers reels
	- liste des points a reinjecter dans S0.2 a S0.7
- Definition of Done:
	- aucun point historique critique ne reste sans statut reel
	- toutes les anomalies residuelles sont rattachees a une famille du Plan 0

### Ticket S0-002 — Cartographie des sources de verite concurrentes
- Priorite: `P0`
- Proprietaire recommande: `Explore`
- Support: `planificateur`
- Dependances: `S0-001`
- Objectif: etablir pour chaque donnee critique une source autoritaire unique et lister les projections derivees
- Perimetre minimum:
	- auth/session
	- llmConfigs
	- localLLMProfiles
	- workflows
	- agentInstances
	- nodes/edges
- Sorties attendues:
	- matrice `donnee -> source autoritaire -> projection -> point de drift`
	- liste des synchronisations manuelles fragiles
- Definition of Done:
	- les cas de multi-source sont tous documentes avec gravite et impact

### Ticket S0-003 — Audit des patterns interdits
- Priorite: `P0`
- Proprietaire recommande: `Explore`
- Support: `planificateur`
- Dependances: `S0-002`
- Objectif: recenser les patterns incompatibles avec la stabilisation SOLID cible
- Patterns obligatoires a auditer:
	- `find(provider)` et lookups globaux equivalents
	- reconstruction frontend d'objets que le backend peut fournir complets
	- coexistence legacy/V2 sur un meme flux
	- promesse de refresh/session/readiness non branchee
- Sorties attendues:
	- catalogue des patterns a supprimer
	- recommandation du pattern cible de remplacement
- Definition of Done:
	- tous les patterns interdits critiques sont localises et priorises

### Ticket S0-004 — Backlog consolide P0/P1/P2 de stabilisation
- Priorite: `P0`
- Proprietaire recommande: `planificateur`
- Support: `Explore`
- Dependances: `S0-001`, `S0-002`, `S0-003`
- Objectif: transformer l'audit en backlog exploitable par les agents developpeurs
- Sorties attendues:
	- tickets causes racines
	- ordre strict d'execution
	- dependances inter-lots
	- criteres de non-regression par ticket
- Definition of Done:
	- le backlog peut etre assigne sans reinterpretation architecturale supplementaire

### Ticket S0-005 — Normalisation DTO/API critiques
- Priorite: `P0`
- Proprietaire recommande: `codeur-specialiste`
- Support: `mongo-persistance`
- Dependances: `S0-004`
- Objectif: aligner les contrats critiques frontend/backend et supprimer les derives de schema
- Perimetre minimum:
	- workspace snapshot
	- agent instances
	- prototypes
	- llm settings
	- local llm profiles
- Sorties attendues:
	- DTOs explicites
	- mappers centralises
	- tests de contrat sur routes critiques
- Definition of Done:
	- plus aucun aggregate critique ne repose sur du mapping implicite dispersé

### Ticket S0-006 — Stabilisation persistance/hydration workspace
- Priorite: `P0`
- Proprietaire recommande: `mongo-persistance`
- Support: `codeur-specialiste`
- Dependances: `S0-005`
- Objectif: garantir une hydratation deterministe et une lecture workspace unifiee
- Perimetre minimum:
	- workflow snapshot
	- instances et noeuds du canvas
	- restauration apres refresh
	- restauration apres longue inactivite
- Sorties attendues:
	- orchestration de hydration clarifiee
	- elimination des merges opportunistes critiques
	- TNR creation -> save -> refresh -> reload
- Definition of Done:
	- plus aucune disparition silencieuse d'agents apres refresh sur les flux critiques

### Ticket S0-007 — Isolation stricte des configurations LLM
- Priorite: `P0`
- Proprietaire recommande: `codeur-specialiste`
- Support: `mongo-persistance`
- Dependances: `S0-005`, `S0-006`
- Objectif: remplacer toute resolution globale par une resolution scopee par identite
- Perimetre minimum:
	- llmConfigs runtime
	- localLLMProfiles
	- bindings instance -> profil local
	- follow-up LLM et panels secondaires
- Sorties attendues:
	- resolver unique de configuration
	- propagation reactive post-settings
	- TNR multi-agents, multi-endpoints, multi-tours
- Definition of Done:
	- un changement de cle ou d'endpoint est visible pour l'agent concerne sans contamination croisee

### Ticket S0-008 — Gouvernance et validations metier backend-first
- Priorite: `P1`
- Proprietaire recommande: `codeur-specialiste`
- Support: `planificateur`
- Dependances: `S0-005`
- Objectif: centraliser les regles metier et supprimer les validations critiques uniquement UI
- Sorties attendues:
	- inventaire des policies
	- middlewares/services de policy
	- couverture 400/401/403
- Definition of Done:
	- les regles metier critiques sont enforcees cote backend sur les flux sensibles

### Ticket S0-009 — Readiness runtime et restauration de session
- Priorite: `P1`
- Proprietaire recommande: `codeur-specialiste`
- Support: `testeur`
- Dependances: `S0-006`, `S0-007`
- Objectif: rendre explicites les etats de sante et brancher reellement les mecanismes de session promis
- Sorties attendues:
	- health inventory
	- etats `healthy`, `degraded`, `unhealthy`, `restoring-session`
	- verification du refresh token flow reellement branche
- Definition of Done:
	- l'application ne tombe plus dans un etat vide silencieux lors d'un retour apres expiration de session

### Ticket S0-010 — Durcissement des tests et matrice pre-Plan 1
- Priorite: `P1`
- Proprietaire recommande: `testeur`
- Support: `codeur-specialiste`
- Dependances: `S0-005`, `S0-006`, `S0-007`, `S0-008`, `S0-009`
- Objectif: obtenir un filet de securite realiste avant lancement de Plan 1
- Sorties attendues:
	- nettoyage des faux-negatifs
	- nouvelles suites critiques
	- matrice de validation pre-Plan 1
- Definition of Done:
	- toutes les suites bloquantes identifiees sont vertes ou explicitement sorties du chemin critique avec accord CdP

### Ticket S0-011 — Validation finale de fermeture du Plan 0
- Priorite: `P2`
- Proprietaire recommande: `planificateur`
- Support: `testeur`
- Dependances: `S0-010`
- Objectif: confirmer que Plan 0 est effectivement clos avant autorisation de lancement du Plan 1
- Sorties attendues:
	- rapport de cloture
	- ecarts restants documentes
	- recommandation Go/No-Go pour Plan 1
- Definition of Done:
	- le Chef de Projet dispose d'un dossier de decision exploitable sans ambiguite

---

## 9. Matrice de priorisation P0 / P1 / P2

### P0 — Bloquants de stabilisation
- `S0-001` Audit residuel des corrections historiques
- `S0-002` Cartographie des sources de verite concurrentes
- `S0-003` Audit des patterns interdits
- `S0-004` Backlog consolide P0/P1/P2 de stabilisation
- `S0-005` Normalisation DTO/API critiques
- `S0-006` Stabilisation persistance/hydration workspace
- `S0-007` Isolation stricte des configurations LLM

### P1 — Fiabilisation indispensable avant Plan 1
- `S0-008` Gouvernance et validations metier backend-first
- `S0-009` Readiness runtime et restauration de session
- `S0-010` Durcissement des tests et matrice pre-Plan 1

### P2 — Cloture et validation de pilotage
- `S0-011` Validation finale de fermeture du Plan 0

### Regles de pilotage de la priorisation
- aucun ticket `P1` ne doit etre declare termine si un `P0` prealable de sa chaine de dependance reste ouvert
- un ticket `P0` peut etre parallellise avec un autre `P0` uniquement si leurs sources de verite et perimetres de regression sont distincts
- aucun feu vert Plan 1 ne peut etre emis tant que `S0-010` et `S0-011` ne sont pas clotures

---

## 10. Checklist QA de feu vert avant lancement du Plan 1

Cette checklist doit etre utilisee par les QA et le Chef de Projet comme barriere d'entree vers le Plan 1.

### 10.1 Contrats et DTO
- tous les endpoints critiques utilises par l'application ont un contrat documente et stable
- aucun champ critique n'est encore converti implicitement dans les composants UI
- les payloads et reponses des flux workspace, prototypes, instances, settings et profils locaux sont couverts par au moins un test de contrat

### 10.2 Persistance et hydration
- un agent cree, configure, sauvegarde puis recharge reapparait avec la meme configuration effective
- les agents du canvas ne disparaissent plus apres refresh simple
- les workflows, instances, noeuds et edges lisibles au chargement proviennent d'une source de verite explicite
- aucun flux critique ne depend encore d'une reconstruction opportuniste cote frontend sans justification architecturale documentee

### 10.3 Isolation de configuration
- deux agents utilisant le meme provider local avec deux endpoints distincts ne se contaminent pas
- un changement de cle API ou de port local est visible sans reload complet sur l'agent concerne
- aucun lookup global de type `find(provider)` ne subsiste sur les zones runtime critiques

### 10.4 Session et readiness
- le retour sur application apres longue inactivite produit soit une restauration de session propre, soit un etat degrade explicite
- aucun 401 durant hydration ne laisse l'application dans un etat vide silencieux
- les etats de sante critiques sont observables et comprehensibles par QA

### 10.5 Gouvernance et validation
- les refus 400/401/403 critiques sont couverts et coherents
- les regles metier sensibles ne reposent plus uniquement sur l'UI
- les flows critiques associes a auth, ownership, capabilities et consentements sont verifies

### 10.6 Tests et non-regression
- la matrice minimale de tests pre-Plan 1 est verte
- les faux-negatifs connus ont ete corriges ou sortis explicitement du chemin critique
- les scenarios QA manuels suivants ont ete repasses:
	- creation d'agent -> configuration -> save -> refresh
	- deux agents locaux avec endpoints differents
	- logout/login -> recharge workspace
	- navigateur laisse ouvert longtemps -> retour -> etat correct ou degrade explicite

### 10.7 Decision Go / No-Go
- `Go` uniquement si toutes les sections 10.1 a 10.6 sont validees
- `No-Go` si une anomalie `P0` ou `P1` non couverte peut encore provoquer perte de donnees, contamination de configuration ou etat vide silencieux

---

## 11. Ordres de mission prets a transmettre — Point 1

Objectif: fournir au Chef de Projet des ordres de mission directement transmissibles pour le **point 1**, soit le lot d'audit initial `S0-001` a `S0-003`.

Regle de transmission:
- transmettre chaque ordre de mission separement
- exiger une reponse structuree par findings, causes racines, fichiers impactes et risques de regression
- interdire toute modification de code a ce stade
- exiger que les livrables puissent alimenter directement `S0-004`

### 11.1 Ordre de mission — Agent `Explore` — S0-001

#### Objet
Audit residuel des corrections historiques et verification des dettes encore actives.

#### Ordre a transmettre
```text
Mission: Executer le ticket S0-001 du Plan 0 de stabilisation.

Contexte:
- Repository: application React/TypeScript + backend Node/Express + MongoDB.
- Document maitre: Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_0_STABILISATION_PREALABLE_AVANT_TOOLS.md.
- Tu interviens en lecture seule. Tu ne modifies aucun fichier.
- Ta mission concerne uniquement l'audit residuel des corrections historiques incompletes.

Objectif:
- Verifier les correctifs historiques pretendument closes et isoler les points encore partiellement corriges, non corriges ou obsoletes.

Sources minimales a relire:
- Guides/TODO/PERSONALIZED_FUNCTIONS/Plan_corrections_todos/PLAN_CORRECTIONS_QA_J1-J7.md
- backend/documentation/guides/corrections/CORRECTIONS_TECHNIQUES.md
- backend/documentation/guides/corrections/CORRECTIONS_POINTS_5-6.md
- tests/TESTS_SUMMARY.md
- Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_0_STABILISATION_PREALABLE_AVANT_TOOLS.md

Travail attendu:
1. Relever les anciens correctifs QA critiques mentionnes dans la documentation.
2. Verifier dans le code si ces correctifs sont reels, partiels, regressifs ou obsoletes.
3. Identifier les contournements temporaires, TODO techniques et patchs non industrialises encore proches des zones critiques.
4. Classer chaque point selon: corrige, partiellement corrige, non corrige, obsolete.
5. Rattacher chaque point non sain a une famille du Plan 0.

Livrables obligatoires:
1. Un tableau de tracabilite doc -> code -> statut reel.
2. Une liste des anomalies residuelles a reinjecter dans S0-002 a S0-007.
3. Les 5 a 10 points les plus critiques classes par severite.

Format de sortie obligatoire:
- Section 1: Resume executif.
- Section 2: Tableau des correctifs historiques verifies.
- Section 3: Findings critiques avec fichiers precis et cause probable.
- Section 4: Points a reinjecter dans le backlog principal.
- Section 5: Risques de regression si non traites avant Plan 1.

Contraintes:
- Lecture seule uniquement.
- Pas de solution codee.
- Pas de proposition generique sans ancrage sur des fichiers ou flux reels.
```

### 11.2 Ordre de mission — Agent `Explore` — S0-002

#### Objet
Cartographie des sources de verite concurrentes sur les donnees critiques.

#### Ordre a transmettre
```text
Mission: Executer le ticket S0-002 du Plan 0 de stabilisation.

Contexte:
- Repository: application React/TypeScript + backend Node/Express + MongoDB.
- Document maitre: Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_0_STABILISATION_PREALABLE_AVANT_TOOLS.md.
- Tu interviens en lecture seule. Tu ne modifies aucun fichier.
- Ta mission concerne uniquement la cartographie des sources de verite concurrentes.

Objectif:
- Etablir pour chaque donnee critique une source autoritaire unique et lister les projections derivees ainsi que les points de drift.

Perimetre minimum obligatoire:
- auth/session
- llmConfigs
- localLLMProfiles
- workflows
- agentInstances
- nodes/edges
- hydration workspace

Travail attendu:
1. Identifier ou chaque donnee critique est stockee, hydratee, mise a jour et lue.
2. Distinguer source autoritaire, caches, projections UI, duplications legacy et synchronisations manuelles.
3. Mettre en evidence les endroits ou plusieurs couches peuvent diverger.
4. Qualifier le niveau de risque: perte de donnees, contamination de configuration, etat stale, regression QA.

Livrables obligatoires:
1. Une matrice `donnee critique -> source autoritaire -> projections -> points de drift`.
2. Une liste des synchronisations manuelles fragiles.
3. Une proposition de priorisation des zones les plus dangereuses pour S0-004.

Format de sortie obligatoire:
- Section 1: Resume executif.
- Section 2: Matrice par domaine critique.
- Section 3: Findings prioritaires avec fichiers precis.
- Section 4: Zones a traiter en P0 avant toute implementation Tools.

Contraintes:
- Lecture seule uniquement.
- Pas de refactoring propose en code.
- Toute affirmation doit etre rattachee a des fichiers, stores, services, routes ou flux reels.
```

### 11.3 Ordre de mission — Agent `Explore` — S0-003

#### Objet
Audit des patterns interdits et incompatibles avec la stabilisation SOLID cible.

#### Ordre a transmettre
```text
Mission: Executer le ticket S0-003 du Plan 0 de stabilisation.

Contexte:
- Repository: application React/TypeScript + backend Node/Express + MongoDB.
- Document maitre: Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_0_STABILISATION_PREALABLE_AVANT_TOOLS.md.
- Tu interviens en lecture seule. Tu ne modifies aucun fichier.
- Ta mission concerne uniquement l'audit des patterns interdits avant stabilisation.

Objectif:
- Recenser les patterns incompatibles avec la stabilisation SOLID cible et les classer par impact reel.

Patterns obligatoires a auditer:
- lookup global de type `find(provider)` ou equivalent sur les ressources critiques
- reconstruction frontend d'objets que le backend peut fournir completement
- coexistence legacy/V2 sur un meme flux critique
- promesse de refresh/session/readiness non branchee reellement
- orchestration racine trop imperative concentree dans un composant ou service central

Travail attendu:
1. Localiser chaque pattern interdit dans le code.
2. Expliquer pourquoi ce pattern produit des symptomes QA ou rend les regressions probables.
3. Regrouper les occurrences par famille de probleme plutot que livrer une simple liste brute.
4. Identifier pour chaque pattern sa zone de remplacement cible au niveau architectural.

Livrables obligatoires:
1. Un catalogue des patterns a supprimer.
2. Une liste des occurrences critiques avec fichiers precis.
3. Une recommandation du pattern cible de remplacement, sans implementer le code.
4. Une priorisation P0/P1 des patterns a traiter avant Plan 1.

Format de sortie obligatoire:
- Section 1: Resume executif.
- Section 2: Catalogue des patterns interdits detectes.
- Section 3: Occurrences critiques et impact QA/regression.
- Section 4: Patterns de remplacement cibles.
- Section 5: Priorisation avant S0-004.

Contraintes:
- Lecture seule uniquement.
- Pas de patch, pas de pseudo-implementation exhaustive.
- Analyse ancree dans le code et les flux reels.
```

### 11.4 Ordre de mission — Agent `planificateur` — Consolidation apres point 1

#### Objet
Consolider les trois audits `S0-001` a `S0-003` en backlog unifie pret pour S0-004.

#### Ordre a transmettre
```text
Mission: Consolider les resultats des audits S0-001, S0-002 et S0-003 pour preparer S0-004.

Contexte:
- Les audits ont ete realises en lecture seule par l'agent Explore.
- Tu n'implements rien. Tu structures le backlog d'execution pour les agents developpeurs.
- Document maitre: Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_0_STABILISATION_PREALABLE_AVANT_TOOLS.md.

Objectif:
- Fusionner les findings des trois audits en un backlog causes racines, ordonne et exploitable sans ambiguite.

Travail attendu:
1. Dedoublonner les findings redondants.
2. Reorganiser les anomalies par cause racine et non par symptome.
3. Rattacher chaque point a S0.2, S0.3, S0.4, S0.5, S0.6 ou S0.7.
4. Proposer un ordre d'execution P0/P1/P2 avec dependances strictes.
5. Identifier les lots parallellisables sans risque de collision architecturale.

Livrables obligatoires:
1. Backlog consolide causes racines.
2. Ordre d'execution recommande.
3. Tableau dependances / prerequis / risques de regression.
4. Liste des lots a confier a codeur-specialiste, mongo-persistance et testeur.

Format de sortie obligatoire:
- Section 1: Resume executif.
- Section 2: Backlog consolide.
- Section 3: Priorisation et dependances.
- Section 4: Lots assignables par agent developpeur.

Contraintes:
- Pas de modification de code.
- Pas de reformulation generique: la consolidation doit rester exploitable directement par l'equipe.
```

### 11.5 Regle de validation du point 1 avant lancement du point 2

Le point 1 ne peut etre considere termine que si:
- les trois audits `S0-001` a `S0-003` ont ete rendus et valides
- leurs findings ont ete consolides sans doublons par `planificateur`
- le backlog issu de cette consolidation peut alimenter directement `S0-004`
- aucun angle mort critique n'est encore present sur auth/session, hydration, persistance, llmConfigs ou localLLMProfiles

---

## 8. Regles de conduite pour l'equipe d'implementation

1. ne jamais corriger un symptome UI sans remonter a la cause racine backend ou contrat si elle existe
2. ne jamais modifier Mongoose sans aligner Zod, DTOs et mappings
3. ne jamais valider une persistance sans test de rehydratation
4. ne jamais conserver un lookup global quand une identite forte existe
5. ne jamais exposer une fonctionnalite runtime sans readiness check
6. ne jamais lancer la phase Tools tant que la matrice pre-Tools n'est pas verte

---

## 9. Definition of Done du plan 0

Le plan 0 est considere comme termine uniquement si:

1. les familles de defauts A a F ont ete traitees ou explicitement closes
2. les flux critiques de l'application ne presentent plus de derive de contrat
3. la persistance et la rehydratation sont deterministes sur les domaines critiques
4. l'isolation des configurations agent/LLM est testee et fiable
5. les regles metier et securitaires sont centralisees
6. la readiness runtime est visible et testee
7. une matrice de tests pre-Tools est validee par QA

---

## 10. Suite logique apres ce plan 0

Une fois ce plan 0 execute et valide, l'equipe peut lancer l'implementation du plan 1:

- [PLAN_1_ARCHITECTURE_BDD_SANDBOX_INSTALLATION.md](c:/AITest/A-IR-DD2/PersistAIRDD2/A-IR-DD2/Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_1_ARCHITECTURE_BDD_SANDBOX_INSTALLATION.md)

Ordre de lancement impose:
1. Plan 0 valide
2. Plan 1 implemente
3. Puis seulement plan 2 sur les fonctions natives

Cela evite de reconstruire la feature Tools sur une base encore instable.