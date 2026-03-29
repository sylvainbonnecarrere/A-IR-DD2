# PLAN DE CORRECTION INTENSIF TOOLS V2 POST-QA

**Statut**: critique  
**Public cible**: codeur-specialiste, architectes, chef de projet, QA  
**Source declenchante**: `Guides/TODO/PERSONALIZED_FUNCTIONS/Rapport_QA/rapport_toolsv2_QA.md`  
**Perimetre**: page Fonctions personnalisees, page Carte du workflow, sandboxs Node/Python, BuildService, AgentLoop, dependances runtime, securite des images

---

## 1. Objet du document

Ce document remplace toute lecture superficielle du rapport QA par un **plan de correction operationnel et technique**, oriente livrables, non-regression et robustesse.

Le chantier Tools V2 est considere comme **central** pour l'application.
Il ne peut pas etre traite comme un lot UI ou un lot backend isole.
Il constitue la base de developpement futur pour:

1. les fonctions custom TypeScript et Python
2. les fonctions natives Python
3. les appels d'outils depuis les agents locaux et cloud
4. les journaux d'execution, l'audit et la persistance de runs
5. la securisation des futures sandboxes de production

En consequence, ce plan interdit:

1. les correctifs ponctuels sans relecture du flux complet
2. les contournements UI qui masquent un contrat backend incoherent
3. les corrections qui melangent build et run
4. les changements de schema ou de vocabulaire non maitrises
5. les faux positifs QA obtenus par des bypasss dev-only non explicites

Ce plan pose en outre un principe de securite central:

1. toute fonction executee en sandbox, qu'elle soit native ou custom, doit relever d'un **workflow de preparation securise, controle et tracable**
2. la difference entre native et custom ne justifie jamais une execution hors perimetre de preparation
3. seule la **modalite** de preparation peut differer:
   - build auteur pour une custom editable
   - provisionnement ou packaging gouverne par la plateforme pour une native readonly

---

## 2. Diagnostic executif

## 2.1 Constat principal

Le rapport QA ne remonte pas une serie de bugs independants.
Il remonte une **rupture de chaine fonctionnelle de bout en bout**.

Le systeme actuel ne garantit pas encore de facon fiable:

1. un parcours auteur clair: editer, valider, builder, tester
2. un contrat d'execution coherent entre custom et natif
3. une politique de dependances deterministic
4. un mode d'invocation agentique idempotent et explicable
5. une observabilite exploitable par QA et support
6. une posture securitaire acceptable sur les images sandbox

## 2.2 Pourquoi le plan precedent a laisse passer ces trous

Les pieces existantes du chantier Tools posent deja des briques importantes, mais le plan precedent n'a pas assez verrouille les **preuves de livrables fonctionnels** sur les flux critiques.

Lacunes probables du plan precedent:

1. le modele `workspace + build + run` a ete correctement formule, mais insuffisamment transforme en **criteres d'acceptation executables** pour chaque flux utilisateur
2. la frontiere entre `custom editable`, `workflow-scoped`, `native`, `readonly`, `tool version`, `function legacy` et `selection agent` reste trop implicite
3. les tests existants couvrent des contrats unitaires et des routes, mais pas encore assez les **scenarios QA narratifs complets**
4. le systeme ne produit pas assez de diagnostics actionnables pour des erreurs attendues de type JSON invalide, build indisponible, dependance manquante, runtime non pret
5. la politique dependances/build n'est pas encore industrialisee pour les fonctions natives et les fonctions selectionnees par les agents

Conclusion:

Le probleme n'est pas l'absence d'architecture cible.
Le probleme est l'absence de **verrous d'execution fonctionnelle** suffisamment forts entre l'architecture cible et les livrables attendus.

---

## 3. Livrables attendus, relus techniquement

Le codeur-specialiste devra considerer que les livrables ne sont pas seulement des composants ou des services, mais des **garanties fonctionnelles**.

## 3.1 Livrables fonctionnels obligatoires

1. un testeur QA peut creer une fonction TypeScript simple et l'executer avec un exemple JSON valide sans ambiguite
2. un testeur QA peut creer une fonction Python simple et l'executer avec un exemple JSON valide sans ambiguite
3. l'UI explique sans confusion quand le build est disponible, indisponible, inutile ou obligatoire
4. une fonction native avec dependances declarees ne peut jamais echouer silencieusement faute de preparation ou de diagnostic runtime
5. un agent ne doit jamais lancer plusieurs fois le meme appel de fonction sans justification metier explicite
6. une erreur d'execution doit remonter avec un message exploitable, structure, et rattache au bon sous-systeme
7. les images sandbox et les dependances runtime doivent avoir un plan de durcissement et de maintenance formel

## 3.2 Livrables architecturaux obligatoires

1. vocabulaire stabilise et code aligne sur `workspace / build / run / runtime / output / registry / run persistence`
2. separation stricte des responsabilites:
   - UI d'edition
   - validation d'entree
   - BuildService
   - service de preparation/provisionnement gouverne
   - orchestration sandbox
   - execution agentique
   - projection des runs
3. contrats de preparation distincts pour:
   - fonctions custom editables
   - fonctions natives readonly preparees par la plateforme
   - tool versions selectionnees par agents
4. dependances gerees dans un flux de preparation explicite et securise, jamais en execution normale
5. tests TNR et QA automatises branches sur les flux critiques reels

## 3.3 Livrables d'exploitation obligatoires

1. erreurs actionnables dans l'UI et les logs backend
2. health runtime lisible par le testeur et par le support
3. diagnostics build et run historises
4. base minimale de checklists go/no-go avant nouvelle campagne QA Tools

---

## 4. Cartographie technique des ecarts remontes

## 4.1 Ecart A1 - JSON invalide dans l'editeur

Symptome QA:

1. le testeur saisit `{ user_name: 'test' }` ou `{ 'user_name': 'test' }`
2. l'UI rejette avec `JSON invalide`
3. aucune aide suffisante n'explique le format attendu

Lecture technique actuelle:

1. `components/FunctionEditorTab.tsx` valide par `JSON.parse`
2. la validation est stricte JSON natif, sans aide de correction, sans exemple guide, sans detail de parsing
3. le placeholder est trop generique pour un testeur non developpeur

Cause racine probable:

1. comportement techniquement correct mais **UX contractuellement insuffisant**
2. absence d'un mode `JSON aide QA`
3. absence d'exemples par runtime et par fonction

Livrable attendu:

1. l'utilisateur comprend instantanement que seules les doubles quotes JSON sont acceptees
2. l'UI propose au minimum un exemple valide contextualise
3. l'erreur explique ce qui est faux et ou

## 4.2 Ecart A2 - absence de cas de test simple TS et Python

Symptome QA:

1. le testeur ne sait pas comment tester `hello_test`
2. le testeur demande un equivalent Python simple

Lecture technique actuelle:

1. la banniere TS aide sur la signature existe dans `FunctionEditorTab.tsx`
2. aucun `golden example` explicite n'est expose dans le flow QA
3. aucun preset de fonction de demonstration n'est fourni comme reference stable

Cause racine probable:

1. absence de **reference fonctionnelle officielle** pour QA
2. dependance implicite au savoir technique des testeurs

Livrable attendu:

1. un couple de fonctions de reference TS/Python simples, testables et documentees
2. un jeu d'arguments JSON d'exemple directement affichable ou injectable

## 4.3 Ecart A3 - bouton build grise sans comprehension metier

Symptome QA:

1. le bouton build est grise
2. le testeur ne comprend ni pourquoi, ni comment le debloquer

Lecture technique actuelle:

1. `FunctionEditorTab.tsx` desactive le build si la fonction n'est pas `workflow-scoped`
2. le titre indique que le build est reserve aux fonctions custom rattachees a un workflow
3. le backend `BuildService` refuse effectivement les fonctions non custom ou readonly

Cause racine probable:

1. regle metier valide mais **contrat UX insuffisant**
2. distinction `custom workflow-scoped` vs `native readonly preparee par la plateforme` non visible dans le parcours utilisateur

Livrable attendu:

1. un testeur doit savoir en 5 secondes si le build est requis, inutile ou impossible
2. l'UI doit expliquer la categorie de la fonction et le chemin d'action associe
3. pour une native readonly, l'UI doit exposer un **statut de preparation securisee** et non un simple blocage opaque

## 4.4 Ecart A4 - echec critique de `web_search_py`

Symptome QA:

1. execution manuelle de `web_search_py`
2. echec runtime pour dependance manquante `duckduckgo-search`

Lecture technique actuelle:

1. `backend/python/native/web_search_py.py` leve explicitement une `ImportError`
2. `backend/src/seeds/nativeFunctions.seed.ts` declare la dependance
3. le systeme n'assure pas encore la disponibilite effective de cette dependance au moment du run QA

Cause racine probable:

1. l'information de dependance existe dans le registre, mais n'est pas convertie en **precondition executable**
2. absence de strategie claire pour les dependances des fonctions natives readonly dans un workflow de preparation securise pilote par la plateforme

Livrable attendu:

1. une fonction native fournie par le produit doit etre runnable ou explicitement marquee non prete avant execution
2. il est interdit que QA decouvre la dependance manquante seulement au moment du run

## 4.5 Ecart B5 - invocation agentique multiple et erreur 409 sur fonction native

Symptome QA:

1. `web_search_py` est appelee 4 fois depuis un agent
2. chaque run retourne `Only custom editable tools can be prepared by the build workflow`

Lecture technique actuelle:

1. `services/llm/AgentLoop.ts` execute chaque tool call recu par le LLM via `/api/sandbox/run`
2. le chemin actuel de preparation ne couvre que le cas `custom editable` et refuse les tools natifs readonly
3. il existe donc une incoherence entre la strategie d'execution agentique et la politique de preparation securisee des natifs

Causes racines probables:

1. le moteur agentique ne distingue pas correctement les categories de tools avant execution
2. le chemin `ensure build ready` applique aujourd'hui un workflow reserve au custom editable alors que les natifs devraient passer par un workflow de preparation gouverne distinct mais tout aussi obligatoire
3. la boucle agentique manque de garde anti-repetition ou de deduplication sur echec recurrent

Livrable attendu:

1. une fonction native autorisee doit suivre un contrat clair de preparation securisee et de readiness, sans jamais contourner le perimetre build/provisionnement
2. un agent ne doit pas spammer le meme appel si l'echec est deterministe et immediate

## 4.6 Ecart B6 - syntax error dans l'execution TS custom

Symptome QA:

1. la fonction custom TS est appelee une fois
2. la sandbox renvoie un script `[eval]` invalide avec `Unexpected token ';'`

Cause racine probable:

1. la generation du script runtime TypeScript ou JavaScript encapsule mal certaines expressions
2. la chaine compilee/transpilee n'est pas suffisamment testee en execution reelle
3. l'erreur n'est visible ni dans l'UI frontend ni dans un diagnostic centré developpeur

Livrable attendu:

1. le wrapper runtime TS doit etre deterministic, testable et couvert par snapshots ou fixtures d'execution
2. les erreurs de compilation/runtime doivent etre diagnostiquables sans devoir deviner la source du script genere

## 4.7 Ecart C - vulnerabilites images sandbox

Symptome QA/SecOps:

1. image Node `22-bookworm-slim` avec vulnerabilites critique et haute
2. image Python `3.12-slim-bookworm` avec vulnerabilite critique

Cause racine probable:

1. absence de pipeline d'hygiene image et de politique de refresh securite formelle
2. MVP runtime deploye sans cadence de scan et remediation integree au chantier

Livrable attendu:

1. plan de rotation, pinning, scanning et mise a jour des images
2. justification documentee des risques acceptes temporairement en dev/test si necessaire

---

## 5. Invariants non negociables du chantier de correction

Le codeur-specialiste doit respecter les invariants suivants.

1. le run normal ne doit jamais servir d'environnement de build
2. les dependances natives ou custom doivent etre resolues par un chemin explicite de preparation, de provisionnement ou de packaging
3. l'UI ne doit pas seulement etre correcte, elle doit etre **pedagogique pour QA**
4. toute fonction executee en sandbox, native ou custom, doit passer par un workflow de preparation securise, controle et tracable
5. une fonction native readonly ne doit ni contourner ce perimetre, ni etre forcee dans le seul workflow auteur reserve aux customs editables
6. l'AgentLoop doit etre idempotent face aux erreurs deterministes et limiter les appels redondants
7. toute erreur critique doit etre observable cote frontend et cote backend
8. les sandboxes doivent etre securisees sans casser la debuggabilite necessaire en dev/test
9. tout jalon doit produire ses TNR avant passage au suivant

---

## 6. Plan de correction par jalon

Chaque jalon ci-dessous est destine au codeur-specialiste.
Ils doivent etre executes dans l'ordre.
Un jalon n'est pas considere termine si ses criteres de sortie fonctionnels et ses TNR ne sont pas atteints.

---

## Jalon 1 - Forensic des contrats Tools V2 et gel du vocabulaire

### Objectif

Stabiliser la taxonomie technique et fonctionnelle afin d'eviter toute correction dans un modele conceptuel flou.

### Analyses obligatoires

1. `backend/src/services/build.service.ts`
2. `backend/src/routes/functions.routes.ts`
3. `backend/src/routes/tools.routes.ts`
4. `backend/src/routes/sandbox.routes.ts`
5. `backend/src/services/sandbox.service.ts`
6. `components/FunctionEditorTab.tsx`
7. `services/llm/AgentLoop.ts`
8. `services/toolSelectionResolver.ts`
9. `types/function.types.ts`

### Livrables techniques

1. matrice de categories outillage:
   - function legacy
   - custom editable function
   - native readonly function preparee par la plateforme
   - user tool version
   - workflow-scoped tool
   - agent-selectable tool
2. matrice des workflows autorises par categorie:
   - edit
   - save
   - preparation
   - run manual
   - run agent
   - dependency provisioning
3. tableau de verite des erreurs attendues et statuts HTTP associes

### Patterns attendus

1. Single Source of Truth pour la classification des tools
2. Policy Object ou Resolver pour les permissions de build/run

### Risques a neutraliser

1. confusion entre `functionId` et `toolId`
2. confusion entre `origin`, `scopeType`, `workflowId`, `isReadonly`
3. logiques dupliquees frontend/backend

### Criteres de sortie

1. tout membre de l'equipe peut expliquer pourquoi une fonction est preparable, par quel acteur, et sous quel niveau de controle
2. les categories metier sont formalisees et branchees sur le code

---

## Jalon 2 - Parcours auteur et UX QA de l'editeur

### Objectif

Rendre le parcours `editer -> valider -> tester` compréhensible, guidé et non ambigu pour un testeur non developpeur expert.

### Analyses obligatoires

1. `components/FunctionEditorTab.tsx`
2. `components/PhilFunctionsPage.tsx`
3. `stores/useFunctionStore.ts`
4. `services/toolRepository.ts`
5. tests frontend existants autour de `FunctionEditorTab`

### Travaux attendus

1. remplacer `JSON invalide` par un diagnostic explicite avec exemple valide
2. afficher au minimum:
   - exemple JSON TS simple
   - exemple JSON Python simple
   - difference entre JSON et syntaxe objet JavaScript
3. clarifier l'etat du bouton build:
   - build requis
   - build inutile
   - build indisponible par categorie
4. exposer dans l'UI la categorie de la fonction:
   - native readonly preparee par la plateforme
   - custom editable
   - rattachee workflow ou non
5. exposer pour les natives un statut de preparation securisee:
   - prete
   - non prete
   - en attente de provisionnement
6. fournir des exemples QA officiels pour `hello_test` TS et son equivalent Python

### Livrables

1. parcours QA documente implicitement dans l'UI
2. deux fonctions de reference officiellement testables
3. TNR frontend sur:
   - erreur JSON detaillee
   - exemples affiches
   - raison d'etat du bouton build

### Risques a neutraliser

1. sur-ajouter de l'aide sans aligner le backend
2. accepter du pseudo-JSON sans contrat clair

### Criteres de sortie

1. QA peut executer un cas TS simple et un cas Python simple sans assistance orale

---

## Jalon 3 - Politique de build et de readiness des dependances

### Objectif

Corriger le coeur du probleme: une dependance declaree doit devenir une precondition systemique, pas une surprise runtime, et toute fonction sandboxee doit etre rattachable a un mode de preparation securise.

### Analyses obligatoires

1. `backend/src/services/build.service.ts`
2. `backend/src/services/runtimeHealth.service.ts`
3. `backend/src/services/sandbox.service.ts`
4. `backend/src/seeds/nativeFunctions.seed.ts`
5. `backend/python/requirements.txt`
6. `backend/python/native/web_search_py.py`
7. scripts runtime actuels dans `backend/scripts/runtime/`

### Decision architecturale a prendre explicitement

Pour chaque categorie de tool, formaliser le mode de preparation securisee et de disponibilite des dependances:

1. custom editable TypeScript
2. custom editable Python
3. native Python readonly livree par le produit
4. tool version selectionnee par agent

### Travaux attendus

1. definir un modele unifie `preparation status` et `dependency readiness`, distinct de l'execution
2. distinguer les modalites de preparation:
   - build auteur pour les customs
   - provisionnement ou packaging gouverne pour les natives produit
3. interdire que les fonctions natives readonly tombent dans le seul workflow `build custom editable`, tout en leur imposant un workflow de preparation securise equivalant
4. prevoir un provisionnement explicite pour les natives produites par le produit
5. faire remonter dans l'UI et l'API la readiness reelle de `web_search_py`
6. exposer un diagnostic avant run si la preparation securisee ou la dependance runtime n'est pas satisfaite

### Livrables

1. un contrat formel `preparable vs prepared vs runnable`, avec sous-cas `author-built` et `platform-provisioned`
2. `web_search_py` runnable ou proprement marquee non prete avant execution
3. TNR backend sur dependances natives et custom

### Risques a neutraliser

1. tenter de resoudre les natives via un build custom inapplicable
2. laisser croire qu'une native pourrait tourner sans preparation securisee
3. installer a chaud dans le run
4. laisser l'etat de readiness implicite

### Criteres de sortie

1. aucune dependance manquante critique ne doit etre decouverte seulement pendant l'execution QA

---

## Jalon 4 - Refonte du contrat d'execution sandbox

### Objectif

Rendre l'execution manuelle fiable et diagnostiquer proprement les erreurs TS/Python.

### Analyses obligatoires

1. `backend/src/services/sandbox.service.ts`
2. `backend/src/routes/sandbox.routes.ts`
3. `backend/src/services/runtime/DockerSandboxRunner.ts`
4. `backend/src/pythonExecutor.ts`
5. wrappers TypeScript/JavaScript et Python utilises a l'execution

### Travaux attendus

1. auditer la generation du script TS/JS qui provoque `Unexpected token ';'`
2. sortir cette generation dans un composant testable et snapshotable si elle est inline aujourd'hui
3. distinguer les erreurs:
   - syntaxe code utilisateur
   - syntaxe wrapper genere
   - runtime sandbox
   - dependance manquante
4. standardiser la structure de retour d'erreur sandbox pour l'UI et pour l'AgentLoop

### Livrables

1. wrapper runtime TS deterministic et teste
2. erreurs sandbox structurees
3. TNR backend sur cas TS simple, Python simple, dependance manquante, runtime not ready

### Risques a neutraliser

1. patch local sur le script genere sans traiter la cause de serialisation ou d'echappement
2. messages d'erreur opaques pour QA

### Criteres de sortie

1. `hello_test` et l'equivalent Python s'executent de facon stable depuis l'editeur

---

## Jalon 5 - AgentLoop et idempotence des appels de fonctions

### Objectif

Stopper les re-invocations aberrantes et aligner l'execution agentique sur la verite metier du registre de tools.

### Analyses obligatoires

1. `services/llm/AgentLoop.ts`
2. `components/V2AgentNode.tsx`
3. `services/adapters/LocalLLMAdapter.ts`
4. `services/llm/FunctionCallingPromptBuilder.ts`
5. `services/toolSelectionResolver.ts`
6. projection des `tool_result` et hydratation Bos si necessaire

### Travaux attendus

1. verifier pourquoi le LLM ou la boucle produit 4 appels de `web_search_py`
2. introduire des garde-fous contre les retries non justifies:
   - deduplication d'appel meme nom + memes args dans une fenetre courte
   - stop policy sur echec deterministe `409 preparation policy`, `403 disabled`, `404 unknown`, `runtime not ready`
3. distinguer en pre-execution les categories de tools et leur readiness de preparation
4. rendre l'erreur de fonction native comprehensible pour l'agent et pour l'utilisateur

### Livrables

1. AgentLoop idempotent sur erreurs deterministes
2. contrat d'execution agentique coherent avec les tools natifs
3. tests unitaires et integration sur non-repetition d'appels

### Risques a neutraliser

1. casser l'autonomie de l'agent en interdisant tout retry
2. laisser des retries aveugles sur erreurs structurantes

### Criteres de sortie

1. un prompt demandant `web_search_py` ne produit pas une rafale de runs incoherents

---

## Jalon 6 - Observabilite, logs QA et parcours de diagnostic

### Objectif

Rendre chaque echec diagnostiquable en moins de quelques minutes, sans lecture opportuniste du code source par les testeurs.

### Analyses obligatoires

1. notifications frontend
2. panneaux console/resultats de `FunctionEditorTab`
3. `user_tool_runs` et projections de logs existantes
4. eventuels journaux runtime/sandbox/build

### Travaux attendus

1. unifier les erreurs UI/backend avec codes metiers
2. enrichir la console editeur par sous-systeme:
   - validation
   - build
   - readiness runtime
   - run
3. rattacher chaque erreur a une action recommandeee
4. conserver les preuves d'execution utiles pour QA

### Livrables

1. taxonomie d'erreurs Tools V2
2. diagnostics exploitables par QA et support
3. scenarios QA automatises associes

### Criteres de sortie

1. un rapport QA futur peut pointer un code d'erreur et un sous-systeme, pas seulement un symptome

---

## Jalon 7 - TNR fonctionnels et campagne QA de non-regression

### Objectif

Transformer les lecons du rapport catastrophe en garde-fous automatiques permanents.

### Scenarios minimaux obligatoires

1. fonction TS simple depuis l'editeur
2. fonction Python simple depuis l'editeur
3. fonction native `web_search_py` avec readiness positive
4. fonction native `web_search_py` avec readiness negative explicite
5. statut de preparation explicite sur native readonly
6. build auteur disponible sur custom workflow-scoped
7. appel agentique unique sur tool call simple
8. absence de re-invocation en boucle sur echec deterministe
9. remontée claire d'une erreur wrapper TS

### Livrables

1. matrice TNR Tools V2
2. suites backend/frontend ciblees
3. base minimale de tests QA semi-automatiques si necessaire

### Criteres de sortie

1. une future regression des flux critiques doit casser les tests avant de casser une campagne QA humaine

---

## Jalon 8 - Durcissement securite des images et supply chain runtime

### Objectif

Traiter formellement la dette de securite des images sandbox sans detruire la capacite de debug dev/test.

### Analyses obligatoires

1. Dockerfiles runtime Node et Python
2. cadence de rebuild image
3. source des CVE signalees
4. politique de pinning de tags et de digests

### Travaux attendus

1. identifier si les CVE relevent d'un simple refresh base image ou d'un choix plus profond
2. definir une politique:
   - scan
   - rebuild
   - revue des CVE
   - derogations temporaires eventuelles
3. distinguer exigence dev/test de l'objectif production futur Firecracker

### Livrables

1. plan de remediation des images
2. images mises a jour ou derogation justifiee et temporellement bornee
3. TNR de runtime apres rotation d'image

### Criteres de sortie

1. aucune image runtime critique n'est laissee sans proprietaire, sans calendrier ni justification

---

## Jalon 9 - Go/No-Go fonctionnel avant reprise du chantier Tools

### Objectif

Valider par preuves que la base Tools V2 est de nouveau exploitable avant d'ouvrir de nouveaux developpements sur ce socle.

### Livrables obligatoires

1. checklist go/no-go
2. preuves d'execution manuelle et agentique
3. statut securite runtime
4. statut TNR
5. liste des dettes residuelles acceptees explicitement

### Condition de sortie

1. l'equipe peut redemarrer le chantier Tools avec un socle fiable
2. aucune dette critique invisible n'est reportee tacitement au prochain plan

---

## 7. Ordre de priorite operationnelle

Ordre impose:

1. Jalon 1 - Forensic et vocabulaire
2. Jalon 2 - UX QA de l'editeur
3. Jalon 3 - readiness dependances et build policy
4. Jalon 4 - execution sandbox fiable
5. Jalon 5 - AgentLoop idempotent
6. Jalon 6 - observabilite
7. Jalon 7 - TNR fonctionnels
8. Jalon 8 - securite images
9. Jalon 9 - go/no-go

Raison:

Sans jalons 1 a 5, toute tentative de campagne QA complementaire produira encore du bruit melangeant UX, contrat metier, runtime et orchestration.

---

## 8. Garde-fous specifiques pour le codeur-specialiste

Le codeur-specialiste devra explicitement respecter les garde-fous suivants:

1. ne jamais corriger uniquement l'UI quand le backend exprime une politique incoherente
2. ne jamais corriger uniquement le backend si l'UI reste incomprehensible pour QA
3. ne jamais reintroduire `build dans le run`
4. ne jamais laisser une native readonly hors du perimetre de preparation securisee
5. ne jamais traiter une native readonly comme une custom editable si cela brouille les responsabilites de preparation
6. ne jamais laisser une erreur sans contexte fonctionnel exploitable
7. ne jamais fusionner plusieurs corrections critiques dans un meme lot sans TNR intermediaires
8. ne jamais clore un jalon sans preuve par scenario QA cible

---

## 9. Definition de termine

Le chantier de correction Tools V2 ne sera considere termine que si les points suivants sont vrais simultanement:

1. le testeur peut tester un tool TS simple et un tool Python simple sans assistance orale
2. la fonction native `web_search_py` est soit runnable dans un perimetre de preparation securisee valide, soit explicitement marquee non prete avant run
3. le bouton build est compris fonctionnellement par QA
4. les erreurs d'execution TS/Python sont diagnostiquables et rattachees au bon sous-systeme
5. l'agent n'effectue pas de re-invocations aberrantes sur erreurs deterministes
6. les TNR critiques couvrent les flux editeur et agent
7. la posture securitaire des images sandbox est suivie par un plan explicite

---

## 10. Note finale d'execution

Ce plan n'est pas un plan de patch.
C'est un plan de **requalification du socle Tools V2**.

Il impose un perimetre de securite unique:

1. aucune fonction sandboxee ne doit s'executer hors workflow de preparation securisee
2. les fonctions natives ne sont pas des exceptions au controle de preparation
3. les customs et les natives peuvent emprunter des modalites differentes, mais jamais des niveaux d'exigence differents

Toute implementation qui ne produit pas:

1. des invariants explicites
2. des preuves fonctionnelles
3. des TNR adaptes
4. des diagnostics exploitables

sera consideree comme incomplete, meme si elle ferme un symptome visible.
