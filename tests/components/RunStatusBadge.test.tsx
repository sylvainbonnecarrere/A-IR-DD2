import React from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';

import { RunStatusBadge } from '../../components/workflow/RunStatusBadge';

import { useRuntimeStore } from '../../stores/useRuntimeStore';

import type { FunctionRunStatus } from '../../types/function.types';

jest.mock('../../hooks/useLocalization', () => ({
  useLocalization: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

const seedInstanceRun = (instanceId: string, runId: string, status: FunctionRunStatus, lockHeld = false) => {
  useRuntimeStore.getState().setRunSnapshot('wf-1', [
    {
      executionId: runId,
      status,
      lockHeld,
      workflowId: 'wf-1',
      agentInstanceId: instanceId,
      runtime: 'python',
      runner: 'docker_sandbox',
      launchContext: 'workflow_run',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:10.000Z',
      timing: {},
    },
  ]);
};

describe('RunStatusBadge (US-J7-13)', () => {
  beforeEach(() => {
    useRuntimeStore.getState().resetAll();
    useRuntimeStore.getState().setRuntimeConnectionState('connected');
  });

  it('ne rend rien sans run connu pour l’instance (représentation vide)', () => {
    const { container } = render(<RunStatusBadge instanceId="inst-x" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('node-run-status-badge')).toBeNull();
  });

  it('affiche le statut du run de l’instance avec data-status fidèle', () => {
    seedInstanceRun('inst-1', 'run-1', 'running');
    render(<RunStatusBadge instanceId="inst-1" />);
    const badge = screen.getByTestId('node-run-status-badge');
    expect(badge).toHaveAttribute('data-status', 'running');
    expect(badge).toHaveAttribute('data-run-id', 'run-1');
    expect(badge).toHaveTextContent('running');
  });

  it('représentation compacte (nœud minimisé) : pastille seule, sans libellé', () => {
    seedInstanceRun('inst-1', 'run-1', 'completed');
    render(<RunStatusBadge instanceId="inst-1" compact />);
    const badge = screen.getByTestId('node-run-status-badge');
    expect(badge).toHaveAttribute('data-status', 'completed');
    expect(badge).not.toHaveTextContent('completed');
  });

  it('quarantaine : data-status + clic routé vers onOpenResetAndRelaunch (jamais le détail)', () => {
    seedInstanceRun('inst-1', 'run-9', 'quarantined', true);
    const onOpenRunDetail = jest.fn();
    const onOpenResetAndRelaunch = jest.fn();
    render(
      <RunStatusBadge
        instanceId="inst-1"
        onOpenRunDetail={onOpenRunDetail}
        onOpenResetAndRelaunch={onOpenResetAndRelaunch}
      />,
    );
    const badge = screen.getByTestId('node-run-status-badge');
    expect(badge).toHaveAttribute('data-status', 'quarantined');
    fireEvent.click(badge);
    expect(onOpenResetAndRelaunch).toHaveBeenCalledWith('run-9');
    expect(onOpenRunDetail).not.toHaveBeenCalled();
  });

  it('verrou tenu sans statut quarantined ouvre aussi le Reset & Relance', () => {
    seedInstanceRun('inst-1', 'run-7', 'worker_lost', true);
    const onOpenResetAndRelaunch = jest.fn();
    render(<RunStatusBadge instanceId="inst-1" onOpenResetAndRelaunch={onOpenResetAndRelaunch} />);
    fireEvent.click(screen.getByTestId('node-run-status-badge'));
    expect(onOpenResetAndRelaunch).toHaveBeenCalledWith('run-7');
  });

  it('clic sur un run non-quarantined ouvre le détail du run', () => {
    seedInstanceRun('inst-1', 'run-3', 'failed');
    const onOpenRunDetail = jest.fn();
    const onOpenResetAndRelaunch = jest.fn();
    render(
      <RunStatusBadge
        instanceId="inst-1"
        onOpenRunDetail={onOpenRunDetail}
        onOpenResetAndRelaunch={onOpenResetAndRelaunch}
      />,
    );
    fireEvent.click(screen.getByTestId('node-run-status-badge'));
    expect(onOpenRunDetail).toHaveBeenCalledWith('run-3');
    expect(onOpenResetAndRelaunch).not.toHaveBeenCalled();
  });

  it('suit les événements temps réel de l’instance (run:quarantined après running)', () => {
    seedInstanceRun('inst-1', 'run-1', 'running');
    render(<RunStatusBadge instanceId="inst-1" />);
    expect(screen.getByTestId('node-run-status-badge')).toHaveAttribute('data-status', 'running');

    act(() => {
      useRuntimeStore.getState().recordRuntimeEvent({
      id: 'evt-1',
      type: 'run:quarantined',
      version: 1,
      aggregateType: 'run',
      aggregateId: 'run-1',
      workspaceId: 'wf-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: { status: 'quarantined', lockHeld: true, agentId: 'inst-1' },
      });
    });

    expect(screen.getByTestId('node-run-status-badge')).toHaveAttribute('data-status', 'quarantined');
  });
});
