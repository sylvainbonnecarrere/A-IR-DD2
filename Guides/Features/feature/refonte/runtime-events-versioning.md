# Runtime events versionnés — note d’architecture

## Objectif

Assurer un flux temps réel minimal, stable et sûr pour les runs et les tasks sans exposer de données sensibles ni casser les clients lors des évolutions.

## Contrat retenu

Les événements runtime sont des messages de type `DomainEvent` avec un identifiant, un type, une version, une agrégation, un workspace, un horodatage et un payload filtré.

Structure cible :

```ts
type RuntimeEventEnvelope = {
  id: string;
  type: 'run:queued' | 'run:started' | 'run:progressed' | 'run:completed' | 'run:failed' | 'run:stopped' | 'task:queued' | 'task:started' | 'task:progressed' | 'task:completed' | 'task:failed' | 'task:cancelled' | 'task:blocked';
  version: 1;
  aggregateType: 'run' | 'task';
  aggregateId: string;
  workspaceId: string;
  correlationId?: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};
```

## Règles de sécurité

- Le payload est validé par Zod.
- Les clés sensibles sont interdites ou nettoyées (`token`, `password`, `apiKey`, `authorization`, `cookie`, `jwt`, `secret`, etc.).
- Seules les clés autorisées sont acceptées : `status`, `stage`, `progress`, `message`, `attempt`, `retryAfterMs`, `errorCode`, `durationMs`, `resultCount`, `agentId`, `workflowId`, `runId`, `taskId`.
- Les événements ne sont émis que vers le workspace autorisé par la couche WebSocket.
- L’émission est refusée si le workspace n’est pas validé ou si le payload n’est pas conforme.

## États et transitions

| Aggregate | État | Événement émis |
| --- | --- | --- |
| Run | queued | `run:queued` |
| Run | started | `run:started` |
| Run | in_progress | `run:progressed` |
| Run | completed | `run:completed` |
| Run | failed | `run:failed` |
| Run | stopped | `run:stopped` |
| Task | queued | `task:queued` |
| Task | started | `task:started` |
| Task | in_progress | `task:progressed` |
| Task | completed | `task:completed` |
| Task | failed | `task:failed` |
| Task | cancelled | `task:cancelled` |
| Task | blocked | `task:blocked` |

### Évolutions prévues (US-J7-09) — événements de quarantaine et de fencing

Trois nouveaux types seront ajoutés au contrat (version 1 conservée, whitelist de payload inchangée) :

| Aggregate | Événement | Émis quand |
| --- | --- | --- |
| Run | `run:quarantined` | run passé en `quarantined` (worker perdu, preuve de quiescence absente, verrou tenu) |
| Run | `run:fenced` | opération gateway passée en `fenced` avec audit signé |
| Run | `run:recovery_relaunched` | nouveau run créé par `fence-and-retry` / auto-recovery (`retryOfExecutionId` renseigné) |

Règles inchangées : payload validé par Zod, aucune clé sensible, émission uniquement vers le workspace autorisé (filtrage renforcé par US-J7-12).

## Invariants métier

- Le `version` est strictement `1` pour les événements courants.
- Les événements sont immuables après émission.
- L’`aggregateId` et le `workspaceId` doivent rester cohérents.
- La payload ne contient pas d’informations sensibles ni de références utilisateur non autorisées.
- La couche WebSocket reste la frontière de sécurité ; le backend ne publie pas dans des espaces non validés.

## Compatibilité et évolution

- La versionnage garantit la compatibilité future avec les évolutions de contrat.
- Les clients ignorent les versions non prises en charge.
- Les nouveaux champs s’ajoutent avec prudence et restent dans la whitelist autorisée.

## Tests de non-régression

- Validation du schéma Zod pour un paquet valide/invalide.
- Nettoyage des champs sensibles.
- Vérification du filtrage utilisateur/workspace côté WebSocket.

## Fichiers principaux

- [backend/src/domain/execution/runtimeEvent.contract.ts](../../../backend/src/domain/execution/runtimeEvent.contract.ts)
- [backend/src/websocket/WebSocketManager.ts](../../../backend/src/websocket/WebSocketManager.ts)
- [backend/src/__tests__/runtime-event.contract.test.ts](../../../backend/src/__tests__/runtime-event.contract.test.ts)
