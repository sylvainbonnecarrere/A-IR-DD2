# VERDICT GO/NO-GO J11 - PLAN 1 TOOLS V2

> Date: 23 mars 2026
> Auteur logique: `ARC-1`
> Base de decision: `LIVRABLE_JALON_11_MATRICE_TNR_PLAN_1.md`

---

## 1. Verdict

**Verdict J11: GO**

Ce verdict vaut pour la **cloture du Jalon 11 et le passage au jalon suivant du Plan 1**.

Il ne vaut **pas** comme validation de mise en production generale.

---

## 2. Decision executive

Le socle critique demande au J11 est maintenant **defendable** pour poursuivre:

1. la persistence `user_tool_runs` est prouvee
2. l'orchestrateur produit et persiste outputs, logs et artefacts detectables
3. les tentatives d'escape runtime sont normalisees proprement
4. Docker Desktop est borne comme `dev-only`
5. Linux rootless est couvert quand disponible
6. Firecracker est prouve comme preparatoire et branchable
7. Phil, Archi, Bos, hydration et `AgentLoop` disposent maintenant de preuves de non-regression ciblées
8. le risque residuel le plus important sur la concurrence meme-workspace a ete objectivé puis reduit par **serialization defensive par workspace** au niveau de l'orchestrateur

En consequence, le jalon peut etre passe en **GO**.

---

## 3. Faits etablis

### 3.1 Backend runtime

Les preuves backend couvrent maintenant:

1. transitions et persistence des runs
2. burst minimal multi-workspaces
3. isolation des artefacts entre runs successifs
4. concurrence meme-workspace avec serialization defensive
5. runtime escape attempts persistés en erreur de sandbox sans artefacts inventés
6. flags de durcissement Docker
7. Docker Desktop `dev-only`
8. rootless Linux
9. branche preparatoire Firecracker

### 3.2 Frontend et orchestration locale

Les preuves frontend couvrent maintenant:

1. selection canonique des tools cote Archi
2. persistence canonique dans `AgentFormModal`
3. persistence canonique dans `AgentConfigurationModal`
4. rehydratation Bos sur `V2AgentNode`
5. pont UI `V2AgentNode -> AgentLoop -> projection runtime`
6. continuite hydration/stores sur les parcours critiques deja valides
7. scenario transverse unique `AgentLoop -> run persiste -> relecture frontend`

---

## 4. Analyse de risque et non-regression

### 4.1 Risque traite a la racine

Le dernier risque structurel important avant verdict etait le suivant:

1. deux executions orchestrees en parallele dans **le meme workspace** pouvaient partager le meme `outputRoot`
2. la detection d'artefacts fonctionnait par diff du contenu du repertoire partage
3. sans garde-fou, un run pouvait attribuer a tort des fichiers produits par un autre run concurrent

La mitigation retenue est volontairement conservative:

1. creation du run en `queued`
2. passage en `running` uniquement au moment reel de l'execution
3. **serialization par workspace** au niveau de l'orchestrateur
4. conservation du parallellisme entre workspaces distincts

Cette approche reduit fortement le risque de regression fonctionnelle, car elle:

1. ne change pas le contrat public des routes
2. n'introduit pas de nouveau format d'artefact
3. preserve l'isolation inter-workspaces deja validee
4. durcit la coherence de persistence pour le cas residuel le plus dangereux

### 4.2 Bornes de decision

Le dernier manque de preuve structurel du J11 etait l'absence d'un **scenario transverse unique** couvrant dans une meme preuve:

1. emission depuis `AgentLoop`
2. creation d'un run backend persiste
3. relecture frontend du run persiste
4. projection finale unifiee dans le store/runtime

Cette reserve est maintenant fermee par le TNR `tests/components/V2AgentNode.agentloop-persisted-run.test.tsx`.

Les bornes qui restent sont des **bornes de portee**, pas des reserves de validation J11:

1. Docker Desktop reste explicitement `dev-only`
2. Firecracker reste preparatoire et non activee comme cible de production
3. le verdict `GO` vaut pour la cloture du jalon, pas pour une homologation production globale

---

## 5. Justification du "GO"

Le verdict n'est pas `NO-GO` car:

1. aucun blocker P0 de surete runtime n'est encore ouvert
2. les surfaces critiques du J11 sont maintenant couvertes par des tests explicites
3. le risque meme-workspace, qui etait le plus important residuellement, est maintenant a la fois mesure et mitige
4. la preuve transverse complete `AgentLoop -> run persiste -> relecture frontend` existe maintenant comme artefact unique de demonstration

Le verdict reste strictement borne au jalon J11, car:

1. Docker Desktop reste explicitement `dev-only`
2. Firecracker reste preparatoire, non activee comme cible de production
3. une decision de production necessiterait d'autres preuves hors perimetre J11

---

## 6. Decision projet

### 6.1 Autorise

Le projet peut:

1. cloturer J11
2. poursuivre vers le jalon suivant du Plan 1
3. utiliser le socle actuel comme base de travail pour les integrations suivantes

### 6.2 Non autorise

Le projet ne doit pas:

1. presenter Docker Desktop comme cible de production
2. presenter Firecracker comme runtime operationnel complet
3. supprimer les garde-fous de serialization meme-workspace sans remplacement structurel equivalant

---

## 7. Actions recommandees immediates

1. conserver le TNR transverse `AgentLoop -> run persiste -> relecture frontend` dans la batterie P0 de non-regression
2. conserver le test de concurrence meme-workspace dans la batterie P0 de non-regression
3. preparer le jalon suivant en gardant la separation stricte `design domain` / `runtime domain`

---

## 8. Conclusion

Sur la base de la matrice consolidee et des preuves ajoutees, **J11 est prononce GO**.

Ce `GO` signifie que le jalon est complet et techniquement defendable dans son perimetre. Il ne doit pas etre confondu avec un feu vert production global, qui reste borne par les contraintes `dev-only` et preparatoires deja documentees.