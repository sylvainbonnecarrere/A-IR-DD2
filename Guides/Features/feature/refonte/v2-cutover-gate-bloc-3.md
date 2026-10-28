# Bloc 3 — Gate de cutover V2

## 1. Etat de la décision

Le bloc 3 valide que la refonte V1 -> V2 a atteint un état de cutover exploitable sans reliquat fonctionnel majeur de V1.

Les invariants suivants sont désormais de référence :

- V2 est la source de vérité opérationnelle pour les workflows, nœuds, arêtes, runs et tasks.
- V1 n’est plus une source d’écriture métier ; elle reste uniquement une couche de compatibilité explicite et contrôlée.
- Les routes legacy qui tentent d’écrire directement dans `Workflow.nodes` ou `Workflow.edges` retournent un refus explicite et traçable.
- Les migrations V1 -> V2 sont idempotentes et rejouables sans doublon.
- Les workflows ne peuvent pas s’activer ou être publiés si leur graphe V2 est invalide.

## 2. Principes de conception

### 2.1 Séparation design/runtime

La séparation des domaines reste obligatoire :

- Design domain : prototype, workflow definition, graph metadata, ownership, validation.
- Runtime domain : exécution, state machine des runs/tasks, journalisation, artefacts et événements.

Le design ne doit jamais être la source de vérité du runtime. Les données de runtime et les instances doivent provenir des chemins V2 et des migrations explicites, pas de reconstructions locales calculées à partir de structures V1.

### 2.2 Loi de fermeture du cutover

Avant tout cutover V2 complet :

1. les migrations V1 -> V2 doivent être idempotentes ;
2. les checkpoints de migration doivent être persistés ;
3. les chemins legacy restants doivent être marqués comme compatibilité ou dépréciation ;
4. les validations de workflow doivent bloquer les graphes invalides ;
5. les runs/tasks doivent passer par les state machines canoniques V2.

Si l’un de ces points n’est pas satisfait, le gate reste rouge.

## 3. Invariants de migration

### 3.1 Règles de sécurité

- Interdiction d’écrire directement sur `Workflow.nodes` et `Workflow.edges`.
- Interdiction de reconstruire des workflows en V1 pour alimenter le runtime.
- Validation des `instanceId` et des références de graphe avant activation.
- Trace des migrations dans une collection de checkpoints dédiée.

### 3.2 Règles de reprise

- Une migration exécutée plusieurs fois ne crée pas de doublons de nœuds / arêtes.
- Une migration interrompue peut être relancée : la séquence est reprise sans réécriture de données déjà migrées.
- Les checkpoints permettent d’unifier l’état de migration et le statut `completed` / `skipped` / `retryable`.

## 4. Modèle d’état du workflow V2

| Etat | Description | Transition autorisée | Blocage métier |
|---|---|---|---|
| draft | workflow en cours d’édition | draft -> published | aucune validation d’activation |
| published | version validée, prête pour exécution | published -> active | si graphe invalide |
| active | workflow actuellement exécuté | active -> completed / failed / cancelled | si dépendance de runtime absente |
| completed | exécution terminée avec succès | terminal | aucune transition en écriture |
| failed | exécution terminée en erreur | terminal | aucune reprise automatique sans validation |
| cancelled | exécution interrompue volontairement | terminal | aucune réactivation directe |

Les transitions hors de ce tableau restent rejetées par les state machines de domaine, notamment pour `run` et `task`.

## 5. Contrôle de compatibilité legacy

Les points de lecture V1 restent tolérés uniquement dans des zones explicites de compatibilité :

- récupération historique de données pour migration ;
- diagnostics de drift ;
- lecture de capture de compatibilité documentée ;
- réponse dépréciée sur routes mutatives legacy non autorisées.

Le comportement attendu est clair :

- lecture V1 : autorisée uniquement en mode diagnostic ou migration ;
- écriture V1 : interdite et rejetée
- lecture V2 : autorisée et obligatoire pour le runtime

## 6. Critères de validation du gate

Le gate de cutover est validé quand :

- J3 est vérifié sur bootstrap, migrations et reprise ;
- J4 est vérifié sur invariants, transitions, migration/replay et resilience ;
- les points de lecture legacy critiques sont neutralisés ou explicitement compatibilisés ;
- V2 est la source de vérité opérationnelle pour workflows, nœuds, arêtes, runs et tasks ;
- les tests de migration idempotence et les validations de workflow restent verts.

## 7. Exigences de livraison

Avant J5 (cutover frontend V2) :

- ne plus introduire de nouvelle écriture métier sur V1 ;
- maintenir le runtime sur les contracts V2 ;
- n’ouvrir aucun nouveau chemin de reconstruction locale V1 ;
- documenter tout écart legacy restant comme compatibilité autorisée uniquement.

## 8. Etat de validation au 2026-10-28

Le bloc 3 est validé au niveau du cutover opérationnel : la migration V1 -> V2 est validée, l'idempotence est confirmée sur les cas de test de migration, et les lectures legacy restantes ont été neutralisées par un garde-fou explicite V2-only sur les routes et snapshots de compatibilité. Le gate couvre désormais la phase 2 de remplacement des lectures legacy avant J5.

### 8.1 Ce qui est fait

- migration V1 -> V2 stabilisée et rejouable ;
- garde-fous anti-derive documentés et intégrés dans le plan de refonte ;
- source de vérité V2 explicitement établie pour le graphe workflow ;
- tests de migration verts sur le script de migration idempotent ;
- compatibilité legacy explicitement marquée comme V2-only, sans exposition des champs `nodes` / `edges` legacy.

### 8.2 Ce qui reste à faire avant la validation finale J5

- sécuriser l’industrialisation runtime via `US-J3-03` et `US-J3-04` ;
- confirmer la clôture de `US-J4-02` et `US-J4-03` sur invariants, migration et runtime resilience ;
- maintenir le contrôle de compatibilité explicite sur les routes historiques encore supportées ;
- poursuivre la validation de livraison finale sur les parcours frontend et E2E.

### 8.3 Handoff J4 -> J5

Le gate opérationnel est désormais prêt pour le frontend :

- les migrations V1 -> V2 sont idempotentes et robustes à la reprise ;
- les tâches peuvent être annulées de façon terminale sans relance automatique ;
- les retries sont bornées et ne réactivent pas des états terminaux ;
- le runtime versionné reste conforme au contrat V2 et ne publie pas de payloads sensibles.

La main est transmise à `06-frontend.agent.md` pour le `J5 - Cutover frontend V2`, avec l’objectif de remplacer la couche hybride de persistance locale par un consommateur strict du contrat V2 et des événements runtime validés.

## 9. Verdict de gate

Le bloc 3 est conforme au plan : il est possible de relancer les migrations sans doublon, de réexécuter les validations de workflow sans corruption du graphe, et de prouver que V2 est l’unique source de vérité opérationnelle pour le graphe workflow, avec compatibilité legacy explicitement réduite à une couche de signalement / non-exposition. La migration de fond J3-02 est validée et le cutover opérationnel associé est désormais verrouillé pour la suite du jalon J3.
