# TOOLS PLAN 1 - Synthese Des 12 Livrables Et Glossaire

**Statut**: Reference de cadrage technique et fonctionnel  
**Perimetre**: Plan 1 Tools  
**Public cible**: Architectes, developpeurs, agents IA chargés d'implementer, relire ou prolonger le chantier Tools

---

## 1. Objet Du Document

Ce document fournit une vue compacte et exploitable des **12 livrables du Plan 1 Tools**.

Il a deux objectifs:

1. permettre a un architecte ou codeur de comprendre rapidement la sequence reelle du chantier
2. stabiliser le vocabulaire du plan autour du modele cible: `workspace + build + run + runtime + registry + runs persistants`

Ce document ne remplace pas les ordres de mission operationnels. Il sert de **point d'entree rapide** vers le chantier Tools.

Sources directrices:

1. `Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_1_ARCHITECTURE_BDD_SANDBOX_INSTALLATION.md`
2. `Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/Découpage_Tools_v2/ORDRES_DE_MISSION_OPERATIONNELS_12_JALONS.md`
3. `Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/Découpage_Tools_v2/ORDRES_DE_MISSION_PLAN_1_TOOLS_V2_PAR_AGENT.md`

---

## 2. Vue D'Ensemble Du Plan 1 Tools

Le Plan 1 Tools remplace progressivement un modele legacy centre sur `user_functions` et des flux d'execution heterogenes par une architecture cible fondee sur:

1. un **workspace persistant** rattache a l'utilisateur et au workflow
2. un **build separe** du run
3. un **run ephemere** orchestre et persisté
4. un **runtime** verifiable et borne, avec Docker durci comme socle dev/test
5. un **registry** de tools/version cible
6. une trajectoire **Firecracker** preparee, mais distincte du fallback Docker MVP

---

## 3. Synthese Des 12 Livrables

### Jalon 1 - Cadrage Du Plan 1

**Agent**: `planificateur`

**Livrable principal**:

1. matrice `legacy -> cible`
2. sequenceur des phases 0 a 5
3. risques de regression
4. impacts backend/frontend
5. dependances inter-jalons

**Decision cle**:

Le chantier doit etre relu uniquement a travers le prisme `workspace persistant + build separe + sandbox ephemere`, sans retour a `TOOLS_V2.md` comme source principale.

### Jalon 2 - BDD Cible Minimale

**Agent**: `mongo-persistance`

**Livrable principal**:

1. schemas minimaux `workspaces`, `user_tools`, `user_tool_runs`, `secrets_metadata`
2. index critiques
3. references workspace/projet/workflow
4. conventions tool/version exploitables par les agents

**Decision cle**:

`user_functions` reste une source legacy a migrer, pas la cible finale du plan.

### Jalon 3 - Persistence Des Runs Et Migration Additive

**Agent**: `mongo-persistance`

**Livrable principal**:

1. schema final `user_tool_runs`
2. machine d'etat des runs
3. migration additive `user_functions -> user_tools`
4. conventions de references tool/version pour agents et workflows
5. garde-fous dual-write et synchronisation de demarrage

**Decision cle**:

Un run doit etre persistable, relisible et auditable sans dependre d'un cache frontend.

### Jalon 4 - WorkspaceManager Et Structure Filesystem

**Agent**: `codeur-specialiste`

**Livrable principal**:

1. `WorkspaceManager`
2. `WorkspacePathResolver`
3. conventions `code / manifests / build / output`
4. creation idempotente des workspaces
5. bornage phase-aware de la synchronisation de demarrage
6. compatibilite explicite avec `workspaceSnapshot` et `useWorkspaceHydration`
7. TNR minimaux sur snapshot et `toolRuns`

**Decision cle**:

Le workspace persistant devient le contrat central des chemins, sans jamais devenir l'environnement d'execution.

### Jalon 5 - BuildService Separe Du Run

**Agent**: `codeur-specialiste`

**Livrable principal**:

1. `BuildService`
2. workflow de build isole Node.js/Python
3. stockage des outputs de build
4. garde-fous contre les installs a chaud dans le run normal

**Decision cle**:

Le run normal ne doit jamais servir d'environnement de build.

### Jalon 6 - Runtime MVP Et Installation

**Agent**: `codeur-specialiste`

**Livrable principal**:

1. `RuntimeHealthService`
2. scripts `setup`, `check`, `rebuild`
3. images sandbox Debian slim Node.js et Python
4. diagnostic runtime expose avec `mode`, `securityLevel`, `executionReady`, `warning`
5. `SandboxRunner` et `SandboxRunnerFactory`
6. `DockerSandboxRunner` durci

**Decision cle**:

Docker Desktop reste `dev-only`; la distinction dev/test vs securite de production doit etre explicite.

### Jalon 7 - Orchestrateur D'Execution Ephemere

**Agent**: `codeur-specialiste`

**Livrable principal**:

1. `ExecutionOrchestrator`
2. port `SandboxRunner`
3. `SandboxRunnerFactory`
4. `DockerSandboxRunner` avec quotas, timeouts, `network=none`, `tmpfs`, `cap-drop`, `no-new-privileges`
5. `FirecrackerRunner` preparatoire avec detection Linux/KVM
6. collecte des logs, outputs et persistence des runs

**Decision cle**:

Chaque run doit passer par une sandbox ephemere gouvernee, observable et persistante.

### Jalon 8 - Compatibilite Backend Pendant Migration

**Agent**: `codeur-specialiste`

**Livrable principal**:

1. facades de compatibilite legacy
2. routes `workspaces`, `tools`, `runs`
3. cartographie de deprecation progressive
4. exposition explicite des warnings runtime `dev-only`

**Decision cle**:

Le basculement doit etre progressif: aucun cutover big bang et aucune double autorite contradictoire.

### Jalon 9 - Rebranchement De Phil

**Agent**: `designer_ux`

**Livrable principal**:

1. edition branchee sur `user_tools`
2. test branche sur `user_tool_runs`
3. affichage des logs, statuts et outputs

**Decision cle**:

Le parcours critique `editer -> tester` doit rester intact pendant le changement d'architecture.

### Jalon 10 - Rebranchement D'Archi Et Bos

**Agent**: `designer_ux`

**Livrable principal**:

1. selection `tool/version` depuis le nouveau registry
2. Bos alimente par `user_tool_runs`
3. rehydratation des runs apres refresh

**Decision cle**:

Archi et Bos doivent lire la nouvelle source de verite backend, sans reconstruire l'historique uniquement depuis le frontend.

### Jalon 11 - Go/No-Go Du Plan 1

**Agent**: `testeur`

**Livrable principal**:

1. matrice TNR du Plan 1
2. tests sur `user_tools` et `user_tool_runs`
3. tests de charge de base et tentatives d'escape
4. verdict go/no-go documente
5. preuve que Docker Desktop est borne comme `dev-only`
6. preuve que Firecracker est reellement preparatoire

**Decision cle**:

Le basculement MVP ne se valide que sur preuves backend, frontend, runtime et non-regression transverse.

### Jalon 12 - Stabilisation Terminologique

**Agent**: `traducteur`

**Livrable principal**:

1. glossaire stable
2. harmonisation des libelles critiques
3. suppression des termes ambigus ou faux

**Decision cle**:

La documentation et l'implementation doivent parler le meme langage technique, sans cohabitation durable de termes contradictoires.

---

## 4. Glossaire Stable Du Plan 1 Tools

### Workspace

Zone persistante rattachee a un utilisateur et a un workflow. Elle contient les racines `source`, `manifests`, `build` et `output`.

**A retenir**:

1. le workspace est persistant
2. le workspace n'est pas le runtime
3. le workspace n'est pas la sandbox d'execution

### Build

Phase de preparation technique d'un tool avant execution normale.

**A retenir**:

1. le build prepare les dependances et artefacts
2. le build est separe du run
3. le build ne doit pas etre detourne dans le parcours normal utilisateur

### Run

Execution ephemere et gouvernee d'un tool, avec quotas, traces et persistence associee.

**A retenir**:

1. chaque run est isole
2. chaque run est persiste comme `user_tool_run`
3. chaque run produit eventuellement logs, outputs et artefacts

### Runtime

Capacite d'execution disponible sur l'hote et exposee comme contrat technique: sante, mode, niveau de securite, readiness et runner prefere.

**A retenir**:

1. le runtime n'est pas le workspace
2. le runtime n'est pas un simple label Docker
3. le runtime doit etre verifie avant run

### Registry

Source cible de verite des definitions et versions des tools.

**A retenir**:

1. la cible est `user_tools`
2. `user_functions` reste un heritage de migration
3. les references agents doivent converger vers `toolSelections` versionnes

### Output

Zone gouvernee du workspace dans laquelle les artefacts de run sont projetes et relus.

**A retenir**:

1. les outputs ne doivent pas vivre dans un conteneur persistant utilisateur
2. les outputs doivent etre rattaches a des runs persistés
3. la relecture frontend doit passer par les read models backend appropries

### Health

Diagnostic de disponibilite et de securite du runtime.

**A retenir**:

1. `executionReady` indique si le runtime peut lancer un run
2. `securityLevel` distingue notamment `dev-only` et trajectoire production
3. `preferredRunner` indique le runner cible pour l'environnement courant

### Firecracker Cible

Trajectoire de securite de production preparee des le chantier runtime, mais distincte du fallback Docker MVP.

**A retenir**:

1. Firecracker doit etre preparatoire et branchable
2. Firecracker n'est pas annonce comme runtime actif si l'environnement ne le permet pas
3. Firecracker n'est pas une promesse documentaire abstraite

---

## 5. Termes Ambigus Ou Faux A Purger

Les formulations suivantes ne doivent plus etre utilisees comme terminologie cible du chantier:

1. `workspace sandbox` quand on parle en fait du workspace persistant
2. `conteneur persistant utilisateur` comme architecture cible
3. `user_functions` comme source finale de verite
4. `gVisor retenu` comme choix de plan
5. `build dans le run` ou `install a chaud` comme comportement normal
6. `Docker Desktop production-ready`

---

## 6. Fichiers Pivot A Relire Pour Assimiler Rapidement Le Chantier

### Documentation source

1. `Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_1_ARCHITECTURE_BDD_SANDBOX_INSTALLATION.md`
2. `Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/Découpage_Tools_v2/ORDRES_DE_MISSION_OPERATIONNELS_12_JALONS.md`
3. `Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/Découpage_Tools_v2/ORDRES_DE_MISSION_PLAN_1_TOOLS_V2_PAR_AGENT.md`

### Code pivot

1. `types/function.types.ts`
2. `types.ts`
3. `services/llm/AgentLoop.ts`
4. `backend/src/services/runtime/ExecutionOrchestrator.ts`
5. `backend/src/services/runtime/DockerSandboxRunner.ts`
6. `backend/src/services/runtimeHealth.service.ts`
7. `backend/src/utils/workspaceSnapshot.ts`

---

## 7. Usage Recommande Pour Le Jalon 12

Pour le premier sous-chantier du Jalon 12, ce document doit servir de base pour:

1. harmoniser les commentaires et docstrings critiques
2. aligner les labels exposes cote frontend
3. purger les termes faux dans la documentation normative et technique active
4. maintenir la compatibilite des contrats publics pendant la stabilisation terminologique

---

## 8. Conclusion

Le Plan 1 Tools se lit comme une progression controlee:

1. cadrage
2. BDD cible
3. migration additive des runs
4. contrat workspace
5. separation build/run
6. runtime verifiable
7. orchestration ephemere
8. compatibilite backend
9. rebranchement Phil
10. rebranchement Archi/Bos
11. validation go/no-go
12. stabilisation terminologique

Pour les architectes et codeurs, cette synthese doit permettre une assimilation rapide du chantier sans repasser par toute l'historique documentaire.