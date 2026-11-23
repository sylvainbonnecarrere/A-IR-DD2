import { describe, expect, it } from '@jest/globals';

import { resolveRuntimeActionPolicy } from '../../services/runtimeActionPolicy';


describe('resolveRuntimeActionPolicy', () => {

  it('allows launch when the workflow is idle and the server is healthy', () => {

    const policy = resolveRuntimeActionPolicy({
      status: null,
      hasWorkflow: true,
      hasNodes: true,
      isLoading: false,
      isOffline: false,
      isPartial: false,
    });

    expect(policy.canLaunch).toBe(true);
    expect(policy.canCancel).toBe(false);
    expect(policy.canRelaunch).toBe(false);
    expect(policy.canResetAndRelaunch).toBe(false);

  });

  it('blocks launch while a run is queued or running and allows cancellation', () => {

    expect(resolveRuntimeActionPolicy({ status: 'queued', hasWorkflow: true, hasNodes: true }).canLaunch).toBe(false);
    expect(resolveRuntimeActionPolicy({ status: 'queued', hasWorkflow: true, hasNodes: true }).canCancel).toBe(true);

    expect(resolveRuntimeActionPolicy({ status: 'running', hasWorkflow: true, hasNodes: true }).canLaunch).toBe(false);
    expect(resolveRuntimeActionPolicy({ status: 'running', hasWorkflow: true, hasNodes: true }).canCancel).toBe(true);
  });

  it('allows relaunch (new run via retry) after a terminal run and blocks all actions while the runtime is degraded', () => {

    const policy = resolveRuntimeActionPolicy({
      status: 'stopped',
      hasWorkflow: true,
      hasNodes: true,
    });

    // `Relancer` remplace `Reprendre` : nouveau run via retry, jamais de resume.
    // Un run terminal n'empêche pas de Lancer un nouveau run.
    expect(policy.canRelaunch).toBe(true);
    expect(policy.canLaunch).toBe(true);

    const degraded = resolveRuntimeActionPolicy({
      status: null,
      hasWorkflow: true,
      hasNodes: true,
      isOffline: true,
    });

    expect(degraded.canLaunch).toBe(false);
    expect(degraded.canCancel).toBe(false);
    expect(degraded.canRelaunch).toBe(false);
    expect(degraded.canResetAndRelaunch).toBe(false);
  });

  it('exposes Reset & Relance only for quarantined runs or a held lock, and blocks launch under lock', () => {

    const quarantined = resolveRuntimeActionPolicy({
      status: 'quarantined',
      hasWorkflow: true,
      hasNodes: true,
      lockHeld: true,
    });

    expect(quarantined.canResetAndRelaunch).toBe(true);
    expect(quarantined.canLaunch).toBe(false);
    expect(quarantined.canCancel).toBe(false);
    expect(quarantined.canRelaunch).toBe(false);

    const workerLost = resolveRuntimeActionPolicy({
      status: 'worker_lost',
      hasWorkflow: true,
      hasNodes: true,
    });
    expect(workerLost.canResetAndRelaunch).toBe(true);

    const lockOnly = resolveRuntimeActionPolicy({
      status: 'failed',
      hasWorkflow: true,
      hasNodes: true,
      lockHeld: true,
    });
    expect(lockOnly.canResetAndRelaunch).toBe(true);
    expect(lockOnly.canLaunch).toBe(false);
    // un run terminal non-quarantaine se relance normalement sans verrou
    const terminal = resolveRuntimeActionPolicy({
      status: 'failed',
      hasWorkflow: true,
      hasNodes: true,
    });
    expect(terminal.canRelaunch).toBe(true);
    expect(terminal.canResetAndRelaunch).toBe(false);
  });

  it('requires a real workflow and nodes before allowing execution', () => {

    const emptyWorkflow = resolveRuntimeActionPolicy({
      status: null,
      hasWorkflow: false,
      hasNodes: true,
    });

    const emptyNodes = resolveRuntimeActionPolicy({
      status: null,
      hasWorkflow: true,
      hasNodes: false,
    });

    expect(emptyWorkflow.canLaunch).toBe(false);
    expect(emptyNodes.canLaunch).toBe(false);

  });
});
