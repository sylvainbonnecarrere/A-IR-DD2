# Insight — Recommandations et idées de perfectionnement à étudier (09-architecte-applicatif)

Ce dossier recueille les recommandations non bloquantes émises par l'architecte applicatif.
Chaque point est une piste à étudier, pas une US engageante : à faire voter/classer en revue de jalon.

**Dernière mise à jour :** 2026-11-19

## Runtime / gateway (suite US-J7-02)

1. **Fenêtre de grâce paramétrable** : la borne `2× POLL_INTERVAL_MS` de `verifyFenced` est en dur ; l'exposer en env (`FENCE_GRACE_POLLS`) permettrait d'ajuster selon la latence du moteur Docker sans rebuild.
2. **Métriques de quarantaine** : compteurs `fenced`/`quarantined`/`FENCING_TIMEOUT_ESCALATED` exposés via `/api/health/ready` (ou endpoint metrics dédié) et reportés dans le panneau de supervision, pour voir la dérive sans fouiller Mongo.
3. **File courte multi-opérations côté gateway** : `pendingOperation` unique sérialise strictement ; une file bornée (ex. 4 opérations) avec la même exclusion mutuelle par lease resterait sûre et réduirait la latence de bout en bout sous charge.
4. **Transaction Mongo pour `fence-and-retry`** : si la topologie cible passe en replica set, remplacer la séquence CAS + idempotency par une transaction pour les étapes 2–4 de la conception §4.3 (le test opt-in `mongo-docker-journal-replica.integration.test.ts` couvre déjà la topologie).
5. **Runbook opérateur (fallback CLI admin)** : documenter la procédure de maintenance d'infrastructure (hors UI utilisateur) : quand utiliser le CLI admin, quelles preuves exigées, comment consigner dans `gateway_fence_audit` avec `reason: 'ADMIN_MAINTENANCE'`.
6. **Tests de chaos** : coupure réseau gateway ↔ daemon Docker en plein `run`, coupure Mongo pendant le fencing, redémarrage simultané gateway+backend — à intégrer au labo `backend/deploy/recovery-validation/`.

## UI / UX (suite US-J7-13)

7. **Historique des runs groupé par nœud** dans le panneau de supervision (badge + liste des derniers runs de l'`agentInstanceId`), au lieu d'une liste plate par workflow.
8. **Nom du workflow dans le header** de la page carte (à droite) — confort demandé par le responsable, intégré à US-J7-13.
9. **Revue i18n des 8 langues** par le traducteur (`traducteur.agent.md`) pour les nouveaux libellés de quarantaine/relance.

## Dettes connues à planifier

10. **`saveEdges`** (écart 5 de `Guides/Features/WORKFLOWLINKS/README.md`) : write path legacy frontend encore ouvert en mode invité — à traiter dans un backlog dédié.
11. **Overlay d'hydratation > 60 s à froid** sur backend dev partagé (note US-J7-11) : non reproductible en stack isolée ; à confirmer au labo US-J7-15, puis investiguer le cold start Vite si confirmé.
12. **Artefacts `.provisioned`** : désormais gitignorés ; vérifier qu'aucun workflow CI ne les ré-embarque (check `git ls-files backend/python/.provisioned` à chaque release).
