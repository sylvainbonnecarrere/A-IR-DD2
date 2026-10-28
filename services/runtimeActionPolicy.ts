import type { FunctionRunRecord } from '../types/function.types';

export type RuntimeActionStatus = FunctionRunRecord['status'] | 'idle' | 'loading' | 'offline' | 'partial' | 'error';

export interface RuntimeActionPolicyInput {
  status?: RuntimeActionStatus | null;
  hasWorkflow?: boolean;
  hasNodes?: boolean;
  isLoading?: boolean;
  isOffline?: boolean;
  isPartial?: boolean;
  isError?: boolean;
}

export interface RuntimeActionPolicy {
  status: RuntimeActionStatus;
  canLaunch: boolean;
  canCancel: boolean;
  canResume: boolean;
  canStop: boolean;
}

export function resolveRuntimeActionPolicy({
  status = 'idle',
  hasWorkflow = false,
  hasNodes = false,
  isLoading = false,
  isOffline = false,
  isPartial = false,
  isError = false,
}: RuntimeActionPolicyInput = {}): RuntimeActionPolicy {
  const effectiveStatus = status ?? 'idle';
  const runtimeBlocked = isLoading || isOffline || isPartial || isError || !hasWorkflow || !hasNodes;
  const activeStatus = effectiveStatus as FunctionRunRecord['status'] | 'idle';

  const canLaunch = !runtimeBlocked && !['queued', 'running', 'stopped'].includes(activeStatus);
  const canCancel = !runtimeBlocked && ['queued', 'running'].includes(activeStatus);
  const canResume = !runtimeBlocked && activeStatus === 'stopped';
  const canStop = canCancel;

  return {
    status: effectiveStatus,
    canLaunch,
    canCancel,
    canResume,
    canStop,
  };
}
