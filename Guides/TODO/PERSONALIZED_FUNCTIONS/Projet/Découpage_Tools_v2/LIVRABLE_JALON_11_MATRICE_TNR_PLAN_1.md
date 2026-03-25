# LIVRABLE JALON 11 - MATRICE TNR PLAN 1 TOOLS

> Date: 23 mars 2026
> Auteur logique: `testeur`
> Source directrice unique: `PLAN_1_ARCHITECTURE_BDD_SANDBOX_INSTALLATION.md`
> Sources d'alignement: `ORDRES_DE_MISSION_OPERATIONNELS_12_JALONS.md` et `ORDRES_DE_MISSION_PLAN_1_TOOLS_V2_PAR_AGENT.md`

---

## 1. Objet du livrable

Ce document formalise la **matrice TNR du Plan 1** demandee au Jalon 11.

Son objectif est de transformer les preuves de tests existantes et les trous de couverture restants en un support de decision exploitable pour le futur **verdict go/no-go**.

Cette matrice ne prononce pas encore le verdict final. Elle prepare ce verdict en cadrant:

1. les surfaces a valider
2. les preuves deja disponibles
3. les zones partiellement couvertes ou manquantes
4. la priorisation des prochains TNR a produire
5. les criteres minimaux pour rendre le basculement MVP defendable

---

## 2. Invariants de validation J11

Les invariants suivants viennent directement du Plan 1 et servent de base de lecture de la matrice:

1. le workspace persistant n'est pas l'environnement d'execution
2. le build reste separe du run
3. chaque run est ephemere, gouverne, observable et persistable
4. Docker Desktop doit etre borne comme `dev-only`
5. le comportement Linux rootless doit etre verifie quand il est disponible
6. Firecracker doit etre prouve comme **preparatoire et branchable**, pas seulement mentionne
7. Phil, Archi, Bos, les workflows, l'hydration et `AgentLoop` ne doivent pas regresser pendant la migration
8. la validation J11 ne peut pas se limiter a des tests unitaires isoles

---

## 3. Convention de statut

La matrice utilise trois statuts:

1. `COUVERT`
   - des preuves de tests existent deja et couvrent le comportement attendu de facon suffisante pour alimenter le go/no-go

2. `PARTIEL`
   - une partie significative du comportement est couverte, mais il manque encore une preuve importante ou une validation transverse

3. `MANQUANT`
   - aucune preuve exploitable n'existe encore pour soutenir la decision go/no-go

---

## 4. Matrice TNR Plan 1

| Surface | Exigence J11 | Preuves actuelles | Statut | Ecart restant | Priorite |
|---|---|---|---|---|---|
| Workflows backend | valider le socle CRUD et le routage applicatif | `backend/__tests__/workflows.unit.test.ts`, `backend/__tests__/workflows.integration.test.ts`, `backend/src/__tests__/workflow-crud-flow.test.ts`, `backend/src/__tests__/transition-routes.test.ts`, `backend/src/__tests__/auth-workflows.routes.test.ts` | COUVERT | consolider dans la matrice go/no-go finale | P2 |
| Auth backend | verifier les preconditions d'acces et l'isolation des donnees | `backend/src/__tests__/auth-workflows.routes.test.ts`, `backend/src/__tests__/robot-governance.routes.test.ts`, `backend/src/__tests__/workspace-snapshot.test.ts`, `tests/unitaires/AuthContext.test.tsx`, `tests/J4.4-AuthGuestIsolation.TNR.test.tsx` | COUVERT | rattacher cette preuve au verdict go/no-go final sans nouvelle lacune critique immediate | P1 |
| `user_tools` | prouver la nouvelle source de verite registry | `backend/src/__tests__/user-tool-startup-sync.service.test.ts`, `tests/stores/useFunctionStore.test.ts`, `tests/components/FunctionSelector.test.tsx`, `tests/components/ArchiToolSelectionModals.test.tsx` | COUVERT | aucune lacune critique immediate sur le pont registry -> selection Archi -> persistence canonique | P1 |
| `user_tool_runs` persistence | prouver creation, transitions, audit et relecture | `backend/src/__tests__/user-tool-run.service.test.ts`, `backend/src/__tests__/function-runs.routes.test.ts`, `backend/src/__tests__/workspace-snapshot.test.ts` | COUVERT | aucune lacune critique immediate | P0 |
| Concurrence sur runs | eviter les transitions terminales ambiguës | `backend/src/__tests__/user-tool-run.service.test.ts` avec tests de burst et de transition concurrente | COUVERT | etendre plus tard a la charge de base multi-runs si necessaire | P0 |
| Runs ephemeres orchestres | prouver que l'orchestrateur produit logs, outputs et artefacts persistables | `backend/src/__tests__/execution-orchestrator.test.ts`, `tests/components/V2AgentNode.agentloop-persisted-run.test.tsx` | COUVERT | aucune lacune critique immediate sur le pont transverse `AgentLoop -> run persiste -> relecture frontend` | P0 |
| Isolation des artefacts | garantir qu'un run ne republie pas les outputs d'un autre | `backend/src/__tests__/execution-orchestrator.test.ts` | COUVERT | aucune lacune critique immediate apres preuve sequentielle + concurrence meme-workspace serializee | P0 |
| Escape attempts output/runtime | bloquer les chemins d'artefacts hors `output/` et persister proprement les tentatives d'evasion runtime | `backend/src/__tests__/function-runs.routes.test.ts`, `backend/src/__tests__/mediaStorage.service.test.ts`, `backend/src/__tests__/execution-orchestrator.test.ts` | COUVERT | aucune lacune critique immediate sur les tentatives d'evasion runtime deja normalisees | P1 |
| Runtime Docker durci | prouver flags de securite et execution gouvernee | `backend/src/__tests__/docker-sandbox.runner.test.ts` | COUVERT | rattacher explicitement cette preuve au verdict J11 | P0 |
| Docker Desktop `dev-only` | prouver que l'environnement est borne et non presente comme prod-ready | `backend/src/__tests__/runtime-health.service.test.ts`, `tests/components/PhilFunctionsPage.test.tsx`, `tests/components/FunctionEditorTab.test.tsx`, `tests/stores/useFunctionStore.test.ts` | COUVERT | aucune lacune critique immediate | P0 |
| Linux rootless | verifier le comportement rootless quand l'hote le permet | `backend/src/__tests__/runtime-health.service.test.ts`, `backend/src/__tests__/sandbox-runner.port.test.ts`, `tests/stores/useFunctionStore.test.ts` | COUVERT | aucune lacune critique immediate sur la detection et l'acceptation rootless | P1 |
| Firecracker preparatoire | prouver que le chemin Firecracker est reellement branchable | `backend/src/__tests__/runtime-health.service.test.ts`, `backend/src/__tests__/sandbox-runner.port.test.ts`, `backend/src/__tests__/firecracker.runner.test.ts` | COUVERT | aucune lacune critique immediate sur la preparation/selection du prototype Firecracker | P0 |
| Phil frontend | prouver edition, creation workflow-aware, affichage runtime et artefacts | `tests/components/PhilFunctionsPage.test.tsx`, `tests/components/FunctionEditorTab.test.tsx`, `tests/components/FunctionRunArtifactsPanel.test.tsx`, `tests/stores/useFunctionStore.test.ts` | COUVERT | aucune lacune critique immediate | P0 |
| Archi frontend | prouver la selection des tools depuis la nouvelle persistence | `tests/services/toolSelectionResolver.test.ts`, `tests/components/FunctionSelector.test.tsx`, `tests/components/ArchiToolSelectionModals.test.tsx` | COUVERT | aucune lacune critique immediate sur la persistence canonique des tools cote Archi | P0 |
| Bos frontend | prouver lecture des tool calls et rehydratation des runs persistes | `tests/components/BosWorkflowManagement.test.tsx`, `tests/components/ToolCallBlock.test.tsx`, `tests/services/bosRunProjectionService.test.ts`, `tests/components/V2AgentNode.bos-hydration.test.tsx` | COUVERT | aucune lacune critique immediate sur la rehydratation Bos apres refresh | P0 |
| Hydration workspace | prouver la reprise de session et la compatibilite snapshot | `backend/src/__tests__/workspace-snapshot.test.ts`, `hooks/__tests__/useWorkspaceHydration.test.tsx`, `tests/fonctionnels/J4.4-HydrationWipe.test.tsx`, `tests/fonctionnels/WorkflowPersistence.TNR.test.tsx` | COUVERT | rattacher explicitement cette couverture a J11 dans le verdict final | P1 |
| Stores frontend | prouver la compatibilite des stores avec la nouvelle persistence | `hooks/__tests__/useWorkspaceHydration.test.tsx`, `tests/stores/useFunctionStore.test.ts`, `tests/J4.4-AuthGuestIsolation.TNR.test.tsx`, `tests/J4.4-PrototypesWipe.TNR.test.tsx`, `tests/J4.4-WorkflowNodesWipe.TNR.test.tsx` | COUVERT | la validation UI composee reste a fermer dans le bloc Phil/Archi/Bos, mais la continuite snapshot/store est maintenant prouvee | P1 |
| `AgentLoop` | prouver la compatibilite de la boucle locale avec les tools et runs persistants | `tests/services/AgentLoop.test.ts`, `tests/components/V2AgentNode.agentloop.test.tsx`, `tests/components/V2AgentNode.agentloop-persisted-run.test.tsx` | COUVERT | aucune lacune critique immediate sur le pont UI `V2AgentNode -> AgentLoop -> run persiste -> relecture frontend` | P0 |
| Charge de base | prouver que plusieurs executions proches restent defendables | `backend/src/__tests__/user-tool-run.service.test.ts`, `backend/src/__tests__/execution-orchestrator.test.ts` | COUVERT | aucune lacune critique immediate apres burst multi-workspaces et serialization defensive du meme-workspace | P0 |
| Go/no-go documente | produire une decision defendable basee sur des preuves | `VERDICT_GO_NO_GO_J11_PLAN_1_TOOLS_V2.md` | COUVERT | aucune lacune critique immediate pour la cloture du jalon J11 | P0 |

---

## 5. Synthese de couverture actuelle

### 5.1 Zones deja assez solides pour un futur go/no-go

Les zones suivantes disposent deja d'une base de preuves credible:

1. persistence `user_tool_runs`
2. transitions de runs et robustesse concurrente immediate
3. isolation des artefacts entre runs successifs
4. pont transverse `AgentLoop -> run persiste -> relecture frontend`
4. blocage des chemins d'artefacts hors `output/`
5. runtime Docker durci au niveau runner
6. signal `Docker Desktop => dev-only`
7. parcours principaux Phil
8. hydration workspace et reprise de session

### 5.2 Zones encore critiques avant verdict final

Aucune zone critique P0 ne reste ouverte pour la cloture du jalon 11.

Les points de vigilance residuels concernent la trajectoire produit, pas la fermeture du jalon:

1. Docker Desktop reste `dev-only`
2. Firecracker reste preparatoire et non promue comme runtime de production

---

## 6. Todo J11 derivee de la matrice

L'ordre suivant a ete suivi pour terminer J11 sans deriver:

1. **Valider workflows, auth et routes**
   - consolider les preuves backend deja existantes dans le scope J11

2. **Valider Phil, Archi et Bos**
   - ajouter les TNR Archi/Bos manquants au niveau UI compose

3. **Tester hydration et stores**
   - confirmer la lecture snapshot + projection runs + stores frontend dans les parcours recharges

4. **Tester `AgentLoop` integre**
   - relier la boucle locale, les tools persistants et la rehydratation des executions

5. **Tester la charge de base**
   - produire un test controle d'executions multiples ou proches au niveau orchestrateur / runner

6. **Prouver Docker `dev-only` et Linux rootless**
   - transformer les preuves existantes en criteres explicites du verdict

7. **Prouver la preparation Firecracker**
   - confirmer par test et lecture de contrat que la factory et le runner restent branchables

8. **Documenter le verdict go/no-go**
   - cloturee apres fermeture des items P0 restants

---

## 7. Criteres minimaux de sortie J11

Le verdict final J11 ne pourra etre considere comme `GO` que si les conditions suivantes sont remplies:

1. `user_tools` et `user_tool_runs` sont verifies par des tests backend et frontend exploitables
2. les parcours Phil critiques ne regressent pas
3. Archi et Bos disposent d'une preuve minimale credible sur la nouvelle persistence
4. l'hydration workspace et la rehydratation des runs apres refresh sont defendables
5. `AgentLoop` reste compatible avec la nouvelle architecture tools/runs
6. Docker Desktop est explicitement borne comme `dev-only`
7. Linux rootless est verifie quand disponible dans l'environnement de test
8. Firecracker est prouve comme preparatoire et branchable
9. des tentatives d'escape de base sont couvertes
10. une charge de base minimale a ete validee ou bloquee sur preuve technique explicite

Si une de ces conditions critiques manque, le verdict final devra etre `NO-GO` ou `GO AVEC RESERVES`, avec justification technique documentee.

Toutes ces conditions sont maintenant couvertes pour la cloture du J11.

---

## 8. Etat actuel du jalon 11

Au moment de la redaction de cette matrice:

1. J10 est suffisamment avance pour avoir fourni les preuves initiales de persistence cible cote Phil, Archi et Bos
2. J11 a deja commence sur le backend avec:
   - durcissement des transitions concurrentes `user_tool_runs`
   - TNR de burst runs
   - TNR d'isolation des artefacts entre runs successifs
3. le verdict go/no-go final est maintenant documente dans une piece separee
4. la derniere reserve technique J11 sur le scenario transverse `AgentLoop -> run persiste -> relecture` est fermee

---

## 9. Conclusion operative

La matrice TNR du Plan 1 est maintenant structuree.

Elle permet de piloter J11 sans ambiguite:

1. en separant les zones deja defendables des zones encore ouvertes
2. en ordonnant les TNR restants par criticite architecturale
3. en preparant un verdict go/no-go qui ne repose pas sur des impressions, mais sur des preuves techniques explicites

Le prochain livrable logique apres cette matrice etait le **verdict go/no-go documente**, maintenant produit et aligne sur cette matrice consolidee.