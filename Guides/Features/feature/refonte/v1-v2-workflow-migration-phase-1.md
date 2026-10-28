# Phase 1 - Migration V1 vers V2 des graphes de workflow

## Objectif

Mettre en place une migration idempotente qui transforme les workflows historiques stockes dans la structure V1 vers les collections V2 canoniques : `workflow_nodes_v2`, `workflow_edges` et `workflow_migrations`.

## Principes

- La source de verite reste le document `workflows` au moment de la migration.
- La cible canonique est V2, sans ecriture supplementaire dans les champs legacy `nodes` et `edges` du workflow.
- La migration doit etre rejouable sans duplication de donnees.
- Une migration complete pour un workflow doit produire un rappel d'execution stable dans `workflow_migrations`.

## Contrat de migration

Pour chaque workflow ayant un graphe historique :

1. Relever les nœuds legacy contenus dans `workflow.nodes`.
2. Reconstituer un document V2 `WorkflowNodeV2` avec `workflowId`, `ownerId`, `nodeType`, `instanceId`, `position`, `uiConfig` et `metadata.legacyNodeId`.
3. Relever les edges legacy contenus dans `workflow.edges`.
4. Reconstituer un document V2 `WorkflowEdge` avec les relations `sourceInstanceId` et `targetInstanceId`.
5. Enregistrer un checkpoint dans `workflow_migrations` avec le couple `sourceVersion: 'v1'` et `targetVersion: 'v2'`.
6. En cas de re-execution, conserver les documents existants et ne pas re-inserer les doublons.

## Invariants de securite

- Aucun workflow ne doit etre modifie en double source de verite.
- Un edge ne doit pas relier des instances qui n'appartiennent pas au workflow.
- Les checkpoints de migration doivent rester idempotents et ne doivent pas masquer des situations de conflit.
- Une migration deja complete ne doit pas provoquer de `nodesCreated` ou `edgesCreated` a nouveau.

## Criteres de validation

- Les tests de migration passent en green sur le scenario nominal.
- Le rerun idempotent ne cree pas de doublons.
- Les checkpoints de migration peuvent etre relus pour prouver l'execution precedente.

## Statut d'execution au 2026-10-28

L'US-J3-02 est consideree comme livree et validee :

- la migration V1 -> V2 est idempotente et peut etre relancee sans doublon ;
- la reprise sur echec est compatible avec la logique de checkpoint de migration ;
- la source de verite du graphe workflow est désormais orientee vers V2 ;
- le test de migration `backend/src/__tests__/workflow-v1-v2-migration.test.ts` est vert.

## Etat du cutover V2 après validation J3-02

L'US-J3-02 est validée et la phase 2 de cutover opérationnel a été clôturée par la neutralisation explicite des lectures legacy dans les routes et snapshots de compatibilité. Le système reste compatible avec les anciennes requêtes sur les points de compatibilité, mais ces réponses sont désormais marquées comme V2-only et ne renvoient plus les champs legacy `nodes` / `edges`.

## Ce qui a été fait pour aller jusqu'au cutover complet

- neutralisation des points de lecture legacy actifs dans les routes et snapshots de compatibilité ;
- remplacement effectif des chemins de lecture V1 par V2 pour les workflows, nœuds, arêtes et snapshot d'hydratation ;
- validation fonctionnelle sur les jeux de fixtures workflow/snapshot et sur le contrat de sortie expose au frontend ;
- clôture de la phase 2 de cutover avant J5 avec V2 comme source de vérité opérationnelle explicite.

## Impact sur le code existant

- Le runner est expose via `backend/src/migrations/008_workflow_v1_to_v2_migration.ts`.
- Le script npm associe est `migrate:workflow-v1-v2`.
- Les nouvelles donnees V2 sont distinctes des modeles legacy et peuvent coexister pendant la phase de migration.
- Le travail restant concerne le remplacement progressif des lectures legacy et la validation de cutover operationnel, pas la migration elle-meme qui est desormais stabilisee.
