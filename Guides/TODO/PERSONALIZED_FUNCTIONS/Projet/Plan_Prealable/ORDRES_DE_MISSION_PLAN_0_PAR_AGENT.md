# Ordres De Mission Par Agent — Plan 0

> Date: 16 mars 2026
> Objet: Lancement ordonne des lots d'implementation du Plan 0
> Reference maitre: `Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_0_STABILISATION_PREALABLE_AVANT_TOOLS.md`
> Prerequis: consolidation S0-004 validee

---

## 1. Regle de pilotage

Ces ordres de mission ne concernent que l'implementation du **Plan 0**.

Le **Plan 1** reste bloque tant que les 6 causes racines P0 suivantes ne sont pas closes et testees:

1. Contrat canonique `RobotId` et `creator_id`
2. Snapshot workspace, persistance et hydration deterministes
3. Source de verite unique pour `llmConfigs`, `llmApiKeys` et `localLLMProfiles`
4. Resolver scope par identite pour les credentials et endpoints runtime
5. Refresh session reellement branche au transport et a l'hydration
6. Gouvernance robot imposee cote backend

Regles strictes:
- aucun agent ne modifie un fichier deja pris par un lot concurrent sans arbitrage CdP
- `App.tsx` a un proprietaire unique pendant toute la sequence `BC-02`, `BC-04`, `BC-05`
- aucun lot P1 ne demarre tant que les P0 dont il depend ne sont pas clotures
- aucun lot n'est considere termine sans TNR associes

---

## 2. Ordre de lancement prescrit

### Vague 1 — Contrats et arbitrage racine
1. `codeur-specialiste` — Lot CS-01 / BC-01
2. `testeur` — Lot QA-01 en support de BC-01

### Vague 2 — Stabilisation du coeur applicatif
1. `mongo-persistance` — Lot MP-01 / BC-04
2. `codeur-specialiste` — Lot CS-02 / BC-02

### Vague 3 — Isolation runtime
1. `codeur-specialiste` — Lot CS-03 / BC-03
2. `testeur` — Lot QA-03 en support de BC-03

### Vague 4 — Session et gouvernance
1. `codeur-specialiste` — Lot CS-04 / BC-05
2. `codeur-specialiste` — Lot CS-05 / BC-06
3. `testeur` — Lot QA-04 et QA-05 en support

### Vague 5 — Verrouillage pre-Plan 1
1. `mongo-persistance` — Lot MP-02 puis MP-03
2. `testeur` — Lot QA-02
3. `testeur` — cloture TNR complete Plan 0

---

## 3. Ordre de mission — `codeur-specialiste` — CS-01 / BC-01

### Objet
Canonicaliser `RobotId` et `creator_id` sur tout le flux frontend/backend.

### Ordre a transmettre
```text
Mission: Executer le lot CS-01 / BC-01 du Plan 0.

Contexte:
- Tu implementes le premier lot P0 du Plan 0.
- Reference maitre: Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_0_STABILISATION_PREALABLE_AVANT_TOOLS.md.
- Tu dois corriger le contrat canonique RobotId / creator_id avant toute autre refonte structurelle.

Objectif:
- Definir et appliquer un seul alphabet RobotId sur frontend, stores, DTO, Zod, Mongoose, routes et projections backend.

Zones obligatoires a auditer et corriger:
- types.ts
- data/robotNavigation.ts
- backend/src/models/AgentPrototype.model.ts
- backend/src/models/AgentInstance.model.ts
- backend/src/routes/agent-prototypes.routes.ts
- backend/src/routes/agent-instances.routes.ts
- backend/src/schemas/agent.schema.ts
- backend/src/controllers/workflow.controller.ts
- tout autre fichier touchant robotId, creator_id, governance ou projections associees

Travail attendu:
1. Choisir et appliquer un contrat canonique unique RobotId.
2. Supprimer tous les litteraux divergents.
3. Aligner creator_id et robotId sur les flux prototypes, instances et workflows.
4. Mettre a jour les validations backend pour qu'elles suivent strictement ce contrat.
5. Verifier qu'aucun mapping legacy ne reintroduit l'ancien alphabet.

Livrables obligatoires:
1. Contrat canonique implemente.
2. Fichiers divergents alignes.
3. TNR minimaux passes sur creation prototype, creation instance et relecture workspace.

Invariants a proteger:
- un RobotId persiste est relu identiquement sur tout le flux
- creator_id ne diverge pas du contrat canonique
- aucun endpoint critique n'accepte encore un alphabet obsolete

Contraintes:
- correction minimale et structurelle
- pas de refactoring opportuniste hors perimetre
- si un autre P0 depend du meme fichier racine, signaler le point avant de poursuivre
```

---

## 4. Ordre de mission — `testeur` — QA-01

### Objet
Verifier le contrat `RobotId` et `creator_id` apres CS-01.

### Ordre a transmettre
```text
Mission: Executer le lot QA-01 en support du lot CS-01 / BC-01.

Contexte:
- Tu interviens apres ou pendant la finalisation du lot CS-01.
- Reference maitre: Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_0_STABILISATION_PREALABLE_AVANT_TOOLS.md.

Objectif:
- Verifier que le contrat RobotId / creator_id est stable, complet et non regressif.

Scenarios minimaux obligatoires:
1. Creation d'un prototype avec RobotId valide.
2. Creation d'une instance depuis prototype.
3. Relecture du workspace et verification du RobotId et creator_id.
4. Rejet explicite d'un RobotId invalide ou obsolete.

Livrables obligatoires:
1. Resultat des TNR du contrat.
2. Liste des regressions ou des routes encore divergentes.

Contraintes:
- ne pas ouvrir de chantier correctif
- remonter tout ecart par fichier et par route
```

---

## 5. Ordre de mission — `mongo-persistance` — MP-01 / BC-04

### Objet
Unifier snapshot workspace, persistance et hydration, en retirant les chemins critiques non deterministes.

### Ordre a transmettre
```text
Mission: Executer le lot MP-01 / BC-04 du Plan 0.

Contexte:
- Tu prends la responsabilite de la stabilisation du coeur de persistance/hydration.
- Reference maitre: Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_0_STABILISATION_PREALABLE_AVANT_TOOLS.md.
- Ce lot ne demarre qu'apres stabilisation du contrat RobotId.

Objectif:
- Figer un WorkspaceSnapshotDTO unique et rendre la persistance/hydration deterministes sur le flux authentifie.

Zones obligatoires a auditer et corriger:
- App.tsx
- backend/src/routes/user-workspace.routes.ts
- backend/src/utils/transforms.ts
- stores/useWorkflowStore.ts
- services/persistenceService.ts
- services/workspacePersistenceService.ts
- tout DTO backend ou projection frontend impliquant workflow, instances, nodes, edges et journals

Travail attendu:
1. Definir la projection backend autoritaire du workspace.
2. Eliminer les re-fetchs ou merges opportunistes critiques si le snapshot composite suffit.
3. Sortir `workflow-editor-data` et les doubles persistances du chemin critique authentifie.
4. Garantir une hydration deterministe apres save puis refresh.

Livrables obligatoires:
1. Snapshot workspace unifie.
2. Chaine save -> refresh -> reload stabilisee.
3. TNR minimaux documentes et passes.

Invariants a proteger:
- aucun node ou instance ne disparait silencieusement apres refresh
- la lecture workspace ne depend plus d'une reconstruction opportuniste cote UI
- la source autoritaire des noeuds, edges, instances et journals est explicite

Contraintes:
- ne pas ouvrir encore le chantier refresh/session
- coordonner tout changement impactant App.tsx avec le proprietaire BC-02
```

---

## 6. Ordre de mission — `codeur-specialiste` — CS-02 / BC-02

### Objet
Unifier la source de verite des configurations LLM et des profils locaux.

### Ordre a transmettre
```text
Mission: Executer le lot CS-02 / BC-02 du Plan 0.

Contexte:
- Tu prends la main sur la lecture et la propagation des configurations LLM runtime.
- Reference maitre: Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_0_STABILISATION_PREALABLE_AVANT_TOOLS.md.
- Ce lot s'execute en coordination stricte avec le proprietaire de App.tsx.

Objectif:
- Supprimer les multi-sources de verite sur llmConfigs, llmApiKeys et localLLMProfiles.

Zones obligatoires a auditer et corriger:
- App.tsx
- contexts/AuthContext.tsx
- components/modals/SettingsModal.tsx
- hooks/useLocalLLMProfiles.ts
- stores/useRuntimeStore.ts
- toute couche de repository ou service lisant ou propageant les settings LLM

Travail attendu:
1. Etablir une source autoritaire unique pour les configs runtime.
2. Retirer les synchronisations manuelles fragiles entre App, hook et store runtime.
3. Garantir qu'une sauvegarde dans SettingsModal est visible au runtime sans reload complet.
4. Clarifier le role exact du runtime store: source autoritaire ou projection derivee.

Livrables obligatoires:
1. Repository ou source autoritaire unique implementee.
2. Points de lecture concurrents supprimes ou encapsules.
3. TNR sur changement de cle ou d'endpoint local passes.

Invariants a proteger:
- une seule source de verite par type de config critique
- pas de bleed guest/auth
- pas de divergence App.tsx / SettingsModal / runtime store

Contraintes:
- ne pas corriger encore le resolver find(provider) tant que la source autoritaire n'est pas figee
- tout changement sur App.tsx doit etre coordonne avec MP-01
```

---

## 7. Ordre de mission — `codeur-specialiste` — CS-03 / BC-03

### Objet
Remplacer toute resolution globale par provider par un resolver scope par identite.

### Ordre a transmettre
```text
Mission: Executer le lot CS-03 / BC-03 du Plan 0.

Contexte:
- Ce lot ne demarre qu'apres fixation de la source autoritaire des configs LLM.
- Reference maitre: Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_0_STABILISATION_PREALABLE_AVANT_TOOLS.md.

Objectif:
- Bannir `find(provider)` et les lookups globaux sur tous les chemins runtime critiques.

Zones obligatoires a auditer et corriger:
- services/adapters/AdapterFactory.ts
- components/V2AgentNode.tsx
- hooks/useAgentChat.ts
- panels image/maps/video dependants des settings runtime
- tout autre chemin d'execution, follow-up, summarization ou tool call utilisant encore un provider global

Travail attendu:
1. Imposer un resolver prenant une identite d'instance ou de profil local.
2. Retirer les chemins encore scopes par provider uniquement.
3. Verifier le comportement sur follow-up et panels annexes.

Livrables obligatoires:
1. Resolver scope implemente.
2. Occurrences critiques `find(provider)` retirees du runtime.
3. TNR multi-agents, multi-endpoints et multi-tours passes.

Invariants a proteger:
- deux agents du meme provider local ne se contaminent jamais
- les follow-up utilisent la meme identite de config que le tour initial
- les panels annexes n'ouvrent pas de derive de credential

Contraintes:
- ne pas recreer de copie concurrente des configs
- tout nouveau resolver doit consommer la source autoritaire definie par CS-02
```

---

## 8. Ordre de mission — `testeur` — QA-03

### Objet
Verifier l'isolation runtime multi-agents et multi-endpoints apres CS-03.

### Ordre a transmettre
```text
Mission: Executer le lot QA-03 en support du lot CS-03 / BC-03.

Objectif:
- Verifier qu'aucune contamination de configuration n'existe encore sur les chemins runtime critiques.

Scenarios minimaux obligatoires:
1. Deux agents locaux du meme provider avec endpoints differents.
2. Plusieurs tours de conversation consecutifs.
3. Follow-up apres tool execution.
4. Verification des panels annexes dependants des settings runtime.

Livrables obligatoires:
1. Rapport TNR multi-agents.
2. Liste des chemins runtime encore scopes globalement s'il en reste.
```

---

## 9. Ordre de mission — `codeur-specialiste` — CS-04 / BC-05

### Objet
Brancher reellement le refresh session au transport et a l'hydration.

### Ordre a transmettre
```text
Mission: Executer le lot CS-04 / BC-05 du Plan 0.

Contexte:
- Ce lot ne demarre qu'apres clarification de l'orchestrateur d'hydration et des sources auth/config.
- Reference maitre: Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_0_STABILISATION_PREALABLE_AVANT_TOOLS.md.

Objectif:
- Rendre coherent le comportement session/auth sur 401, refresh et retour d'onglet apres longue inactivite.

Zones obligatoires a auditer et corriger:
- contexts/AuthContext.tsx
- utils/apiClient.ts
- App.tsx
- tout helper de settings ou d'hydration recreant un pseudo-contexte auth

Travail attendu:
1. Brancher le refresh token dans le transport ou dans une politique centrale equivalente.
2. Definir les etats `loading`, `restoring-session`, `degraded`, `ready`.
3. Interdire tout etat vide silencieux lors d'un 401 pendant hydration.

Livrables obligatoires:
1. Chaine refresh/session operationnelle.
2. Etats de readiness explicites.
3. TNR token expire / refresh valide / refresh invalide passes.

Invariants a proteger:
- 401 pendant hydration ne donne jamais un canvas vide silencieux
- refresh valide restaure la session sans divergence de workspace
- refresh invalide donne un etat degrade explicite
```

---

## 10. Ordre de mission — `codeur-specialiste` — CS-05 / BC-06

### Objet
Basculer la gouvernance robot en backend-first.

### Ordre a transmettre
```text
Mission: Executer le lot CS-05 / BC-06 du Plan 0.

Contexte:
- Reference maitre: Guides/TODO/PERSONALIZED_FUNCTIONS/Projet/PLAN_0_STABILISATION_PREALABLE_AVANT_TOOLS.md.
- Ce lot ne doit pas changer le contrat RobotId deja fixe par BC-01.

Objectif:
- Faire porter au backend la decision finale de gouvernance sur creation, modification et suppression des objets gouvernes.

Zones obligatoires a auditer et corriger:
- services/governanceService.ts
- stores/useDesignStore.ts
- backend/src/routes/agent-prototypes.routes.ts
- backend/src/routes/agent-instances.routes.ts
- backend/src/middleware
- tout policy service ou route de gouvernance associee

Travail attendu:
1. Separer validation de forme et validation metier.
2. Introduire un middleware ou service backend dedie a la policy robot.
3. Garantir que les refus critiques se font cote backend meme hors UI.

Livrables obligatoires:
1. Gouvernance backend-first implementee.
2. Refus 400/401/403 harmonises pour les cas critiques.
3. TNR sur cas autorises et refuses passes.

Invariants a proteger:
- aucune regle metier critique ne depend uniquement du frontend
- creator_id et type d'objet gouverne restent coherents
- tout appel backend direct non autorise est refuse explicitement
```

---

## 11. Ordre de mission — `testeur` — QA-02 / QA-04 / QA-05

### Objet
Verrouiller la non-regression finale du Plan 0.

### Ordre a transmettre
```text
Mission: Executer les lots QA-02, QA-04 et QA-05 de verrouillage du Plan 0.

Objectif:
- Verifier la non-regression sur persistance/hydration, session longue duree et gouvernance backend.

Perimetre minimal:
1. QA-02: create -> save -> refresh -> rehydrate sur workflow, prototype, instance, node et journal.
2. QA-04: access token expire, refresh valide, refresh invalide, retour d'onglet prolonge.
3. QA-05: cas autorises et refuses sur la gouvernance backend.

Livrables obligatoires:
1. Rapport TNR complet par lot.
2. Liste des regressions bloquantes restantes.
3. Avis Go / No-Go technique pour cloture du Plan 0.
```

---

## 12. Blocages explicites avant Plan 1

Restent bloques tant que les lots precedents ne sont pas clos:

1. tout lancement du Plan 1
2. toute refonte Tools, sandbox ou BDD cible Tools
3. tout ajout de nouveau provider local multi-endpoints
4. toute nouvelle UX d'autosave ou de persistance canvas
5. toute nouvelle regle de gouvernance non encore enforcee cote backend

---

## 13. Regle de passage au lot suivant

Un lot ne peut demarrer que si:

1. son prerequis P0 est clos
2. ses invariants ont ete valides par TNR minimaux
3. les fichiers racines partages ne sont pas deja pris par un autre lot concurrent
4. le Chef de Projet confirme la fin du lot precedent si celui-ci etait bloquant

---