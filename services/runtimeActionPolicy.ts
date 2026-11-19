import {
  FUNCTION_RUN_ACTIVE_STATUSES,
  FUNCTION_RUN_QUARANTINE_STATUSES,
  FUNCTION_RUN_TERMINAL_STATUSES,
  type FunctionRunRecord,
  type FunctionRunStatus,
} from '../types/function.types';

export type RuntimeActionStatus = FunctionRunStatus | 'idle' | 'loading' | 'offline' | 'partial' | 'error';

export interface RuntimeActionPolicyInput {
  status?: RuntimeActionStatus | null;
  hasWorkflow?: boolean;
  hasNodes?: boolean;
  isLoading?: boolean;
  isOffline?: boolean;
  isPartial?: boolean;
  isError?: boolean;
  /** Verrou workspace tenu (run `quarantined` / événement `lockHeld`). */
  lockHeld?: boolean;
}

export interface RuntimeActionPolicy {
  status: RuntimeActionStatus;
  /** Lancer un nouveau run (jamais pendant un run actif ni sous verrou). */
  canLaunch: boolean;
  /** Annuler (avec confirmation) un run `queued`/`running`. */
  canCancel: boolean;
  /** Relancer = nouveau run via `retry` (run terminal non-quarantaine). */
  canRelaunch: boolean;
  /** Reset & Relance = `fence-and-retry` (run `worker_lost`/`quarantined` ou verrou tenu). */
  canResetAndRelaunch: boolean;
}

const includes = (list: readonly string[], value: string): boolean => list.includes(value);

/**
 * Politique d'actions runtime — pure, sans effet de bord.
 * Le statut REST/realtime reste autoritaire ; cette fonction ne fait que dériver
 * les commandes disponibles. Aucun `pause`/`resume` : le contrat V2 n'expose pas
 * de pause serveur (`Reprendre` est remplacé par `Relancer` = nouveau run).
 */
export function resolveRuntimeActionPolicy({
  status = 'idle',
  hasWorkflow = false,
  hasNodes = false,
  isLoading = false,
  isOffline = false,
  isPartial = false,
  isError = false,
  lockHeld = false,
}: RuntimeActionPolicyInput = {}): RuntimeActionPolicy {
  const effectiveStatus: RuntimeActionStatus = status ?? 'idle';
  const runtimeBlocked = isLoading || isOffline || isPartial || isError || !hasWorkflow || !hasNodes;

  const isActive = includes(FUNCTION_RUN_ACTIVE_STATUSES, effectiveStatus);
  const isTerminal = includes(FUNCTION_RUN_TERMINAL_STATUSES, effectiveStatus);
  const isQuarantine = includes(FUNCTION_RUN_QUARANTINE_STATUSES, effectiveStatus);

  return {
    status: effectiveStatus,
    // Lancement désactivé hors ligne/en erreur, sans graphe, pendant un run actif,
    // et tant qu'un verrou workspace est tenu (le serveur refuserait de toute façon).
    canLaunch: !runtimeBlocked && !isActive && !isQuarantine && !lockHeld,
    canCancel: !runtimeBlocked && isActive,
    canRelaunch: !runtimeBlocked && isTerminal,
    canResetAndRelaunch: !runtimeBlocked && (isQuarantine || lockHeld),
  };
}

export type { FunctionRunRecord };
