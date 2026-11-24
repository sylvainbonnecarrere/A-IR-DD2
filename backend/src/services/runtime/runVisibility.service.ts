import { logger } from '../logger';
import mongoose from 'mongoose';

import { AgentJournal } from '../../models/AgentJournal.model';
import type { JournalSeverity, SystemJournalPayload } from '../../types/persistence';
import type { RuntimeEventType } from '../../domain/execution/runtimeEvent.contract';
import { createRuntimeEventPublisher, RuntimeEventPublisher } from '../runtimeEventPublisher.service';

/**
 * Visibilité J7-09 (conception §5) : rend la quarantaine traçable.
 *
 * Pour chaque événement (`run_quarantined`, `run_fenced`, `run_recovery_relaunched`) :
 * - entrée `agent_journals` (type `system`) pour l'agent concerné : cause, état du
 *   verrou, opération fencée — payload whitelisté, aucun secret ;
 * - événement runtime versionné émis vers le workspace (room `workspaceId`, contrôle
 *   d'isolation côté WebSocketManager, inchangé).
 *
 * Fail-safe : la visibilité ne doit jamais casser la réconciliation ni le
 * fence-and-retry (erreur journalisée, jamais propagée).
 */

export type RunVisibilityEvent = 'run_quarantined' | 'run_fenced' | 'run_recovery_relaunched';

export interface RunVisibilityEntry {
  workspaceId: string;
  runId: string;
  agentInstanceId?: string | null;
  event: RunVisibilityEvent;
  /** Code d'erreur ou reason métier (ex. `QUARANTINED`, `FENCING_TIMEOUT_ESCALATED`, `AGENT_AUTO_RECOVERY`). */
  cause: string;
  /** true = verrou workspace tenu ; false = libéré. */
  lockHeld: boolean;
  fencedOperationId?: string | null;
  recoveryAttemptCount?: number;
  newRunId?: string;
  message?: string;
}

export interface RunVisibilityPort {
  record(entry: RunVisibilityEntry): Promise<void>;
}

const EVENT_TO_RUNTIME_TYPE: Record<RunVisibilityEvent, RuntimeEventType> = {
  run_quarantined: 'run:quarantined',
  run_fenced: 'run:fenced',
  run_recovery_relaunched: 'run:recovery_relaunched',
};

const EVENT_TO_SEVERITY: Record<RunVisibilityEvent, JournalSeverity> = {
  run_quarantined: 'error',
  run_fenced: 'warn',
  run_recovery_relaunched: 'info',
};

const EVENT_TO_STATUS: Record<RunVisibilityEvent, string> = {
  run_quarantined: 'quarantined',
  run_fenced: 'fenced',
  run_recovery_relaunched: 'relaunched',
};

/** Clés autorisées dans le payload journal (aucun secret, aucune donnée perso). */
function buildJournalDetails(entry: RunVisibilityEntry): Record<string, unknown> {
  const details: Record<string, unknown> = {
    runId: entry.runId,
    cause: entry.cause,
    lockHeld: entry.lockHeld,
  };
  if (entry.fencedOperationId) details.fencedOperationId = entry.fencedOperationId;
  if (typeof entry.recoveryAttemptCount === 'number') details.recoveryAttemptCount = entry.recoveryAttemptCount;
  if (entry.newRunId) details.newRunId = entry.newRunId;
  return details;
}

export class MongoRunVisibilityService implements RunVisibilityPort {
  constructor(
    private readonly publisher: RuntimeEventPublisher = createRuntimeEventPublisher(),
    private readonly journal: Pick<typeof AgentJournal, 'create'> = AgentJournal,
  ) {}

  async record(entry: RunVisibilityEntry): Promise<void> {
    const eventType = EVENT_TO_RUNTIME_TYPE[entry.event];

    try {
      publishQuarantineVisibilityEvent(this.publisher, entry, eventType);
    } catch (error) {
      logger.error('[RunVisibility] Event emission failed (non-blocking)', {
        runId: entry.runId,
        event: entry.event,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const agentInstanceId = entry.agentInstanceId ?? null;
    if (!agentInstanceId || !mongoose.isValidObjectId(agentInstanceId) || !mongoose.isValidObjectId(entry.workspaceId)) {
      // Pas d'agent/noeud concerné : l'événement runtime suffit, pas d'entrée journal.
      return;
    }

    try {
      const payload: SystemJournalPayload = {
        event: entry.event,
        details: buildJournalDetails(entry),
        triggeredBy: 'system',
      };
      await this.journal.create({
        agentInstanceId: new mongoose.Types.ObjectId(agentInstanceId),
        workflowId: new mongoose.Types.ObjectId(entry.workspaceId),
        type: 'system',
        severity: EVENT_TO_SEVERITY[entry.event],
        payload,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('[RunVisibility] Journal entry failed (non-blocking)', {
        runId: entry.runId,
        event: entry.event,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Helper de publication vers le bus runtime (méthodes dédiées du publisher). */
export function publishQuarantineVisibilityEvent(
  publisher: RuntimeEventPublisher,
  entry: RunVisibilityEntry,
  eventType: RuntimeEventType,
): boolean {
  if (EVENT_TO_RUNTIME_TYPE[entry.event] !== eventType) {
    return false;
  }
  const base = {
    workspaceId: entry.workspaceId,
    roomWorkspaceId: entry.workspaceId,
    runId: entry.runId,
    agentId: entry.agentInstanceId ?? undefined,
    workflowId: entry.workspaceId,
    message: entry.message,
    errorCode: entry.cause,
    status: EVENT_TO_STATUS[entry.event],
    correlationId: `run:${entry.runId}:${entry.event}`,
  };
  switch (entry.event) {
    case 'run_quarantined':
      return publisher.publishRunQuarantined({
        ...base,
        lockHeld: entry.lockHeld,
        reason: entry.cause,
        operationId: entry.fencedOperationId ?? undefined,
      });
    case 'run_fenced':
      return publisher.publishRunFenced({
        ...base,
        operationId: entry.fencedOperationId ?? undefined,
        reason: entry.cause,
        lockHeld: entry.lockHeld,
      });
    case 'run_recovery_relaunched':
      return publisher.publishRunRecoveryRelaunched({
        ...base,
        newRunId: entry.newRunId,
        recoveryAttemptCount: entry.recoveryAttemptCount,
        reason: entry.cause,
      });
  }
}
