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
    expect(policy.canResume).toBe(false);
    expect(policy.canStop).toBe(false);
  });

  it('blocks launch while a run is queued or running and allows cancellation', () => {
    expect(resolveRuntimeActionPolicy({ status: 'queued', hasWorkflow: true, hasNodes: true }).canLaunch).toBe(false);
    expect(resolveRuntimeActionPolicy({ status: 'queued', hasWorkflow: true, hasNodes: true }).canCancel).toBe(true);
    expect(resolveRuntimeActionPolicy({ status: 'running', hasWorkflow: true, hasNodes: true }).canLaunch).toBe(false);
    expect(resolveRuntimeActionPolicy({ status: 'running', hasWorkflow: true, hasNodes: true }).canCancel).toBe(true);
  });

  it('allows resume after a stopped run and blocks all actions while the runtime is degraded', () => {
    const policy = resolveRuntimeActionPolicy({
      status: 'stopped',
      hasWorkflow: true,
      hasNodes: true,
    });

    expect(policy.canResume).toBe(true);
    expect(policy.canLaunch).toBe(false);

    const degraded = resolveRuntimeActionPolicy({
      status: null,
      hasWorkflow: true,
      hasNodes: true,
      isOffline: true,
    });

    expect(degraded.canLaunch).toBe(false);
    expect(degraded.canCancel).toBe(false);
    expect(degraded.canResume).toBe(false);
    expect(degraded.canStop).toBe(false);
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
