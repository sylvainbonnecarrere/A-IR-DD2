import React from 'react';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WorkflowToolbar } from '../../components/workflow/WorkflowToolbar';

import WorkflowRunService, { RunCommandError } from '../../services/workflowRunService';

import { useRuntimeStore } from '../../stores/useRuntimeStore';

import { NotificationProvider } from '../../contexts/NotificationContext';

import { NotificationDisplay } from '../../components/NotificationDisplay';

/**
 * ⭐ US-J7-13 — Tests d'intégration de la toolbar V2 : vrais hooks
 * (useWorkflowRuntimeState, useRunCommandModals) + vrai store runtime zustand,
 * seul le service HTTP est mocké. Le store workflow/design et la localisation
 * sont mockés (source unique du graphe = design store, testée séparément).
 */

let mockStoreState = {
  currentWorkflow: { id: 'wf-1', name: 'Demo workflow', description: '' },
  execution: null as null | { id: string; workflowId: string; status: string; startedAt: string; results: Record<string, unknown>; errors: Record<string, unknown> },
  executeWorkflow: jest.fn(async () => 'run-new'),
  toggleConfigPanel: jest.fn(),
  isConfigPanelOpen: false,
};

const mockDesignState = {
  nodes: [{ id: 'n-1', type: 'agent', position: { x: 0, y: 0 }, data: { label: 'Node 1' } }],
  edges: [],
  currentWorkflowId: 'wf-1' as string | null,
  workflows: [{ _id: 'wf-1', name: 'Demo workflow' }],
};

jest.mock('../../stores/useDesignStore', () => ({
  useDesignStore: (selector?: (state: typeof mockDesignState) => unknown) => (
    selector ? selector(mockDesignState) : mockDesignState
  ),
}));

jest.mock('../../stores/useWorkflowStore', () => ({
  useWorkflowStore: (selector?: (state: typeof mockStoreState) => unknown) => (
    selector ? selector(mockStoreState) : mockStoreState
  ),
}));

jest.mock('../../hooks/useLocalization', () => ({
  useLocalization: () => ({
    t: (key: string, fallback?: string | Record<string, string | number>) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

jest.mock('../../services/workflowRunService', () => {
  class MockRunCommandError extends Error {
    status?: number;
    code?: string;
    constructor(message: string, status?: number, code?: string) {
      super(message);
      this.name = 'RunCommandError';
      this.status = status;
      this.code = code;
    }
  }
  return {
    __esModule: true,
    default: {
      listWorkflowRuns: jest.fn(),
      launchRun: jest.fn(),
      cancelRun: jest.fn(),
      retryRun: jest.fn(),
      fenceAndRetry: jest.fn(),
    },
    newIdempotencyKey: jest.fn(() => 'idem-test-uuid'),
    RunCommandError: MockRunCommandError,
    toRunCommandError: (error: unknown, fallback: string) =>
      error instanceof MockRunCommandError ? error : new MockRunCommandError(fallback),
  };
});

/** Render avec le vrai provider de notifications : les toasts flottants sont visibles dans le DOM. */
const renderToolbar = () => render(
  <NotificationProvider>
    <WorkflowToolbar />
    <NotificationDisplay />
  </NotificationProvider>,
);

const mockedService = WorkflowRunService as unknown as {
  listWorkflowRuns: jest.Mock;
  launchRun: jest.Mock;
  cancelRun: jest.Mock;
  retryRun: jest.Mock;
  fenceAndRetry: jest.Mock;
};

const runRecord = (executionId: string, status: string, extra: Record<string, unknown> = {}) => ({
  executionId,
  status,
  runtime: 'python',
  runner: 'docker_sandbox',
  launchContext: 'workflow_run',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:10.000Z',
  timing: {},
  workflowId: 'wf-1',
  ...extra,
});

const listResponse = (items: unknown[]) => ({
  items,
  pagination: { page: 1, limit: 50, total: items.length, totalPages: 1, sortBy: 'createdAt', sortOrder: 'desc' },
});

describe('WorkflowToolbar US-J7-13 (intégration commandes V2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreState = {
      currentWorkflow: { id: 'wf-1', name: 'Demo workflow', description: '' },
      execution: null,
      executeWorkflow: jest.fn(async () => 'run-new'),
      toggleConfigPanel: jest.fn(),
      isConfigPanelOpen: false,
    };
    useRuntimeStore.getState().resetAll();
    useRuntimeStore.getState().setRuntimeConnectionState('connected');
    mockedService.listWorkflowRuns.mockResolvedValue(listResponse([]));
    mockedService.cancelRun.mockResolvedValue({ success: true, executionId: 'run-1', status: 'stopped' });
    mockedService.retryRun.mockResolvedValue({ executionId: 'run-new', retryOfExecutionId: 'run-7', status: 'queued' });
    mockedService.fenceAndRetry.mockResolvedValue({ fencedRunId: 'run-9', newExecutionId: 'run-10', status: 'queued', recoveryAttemptCount: 2 });
  });

  it('Lancer appelle le contrat execute avec le workflowId du design store puis rafraîchit', async () => {
    mockedService.launchRun.mockResolvedValue({ executionId: 'run-new', status: 'queued' });
    renderToolbar();

    fireEvent.click(await screen.findByRole('button', { name: 'workflow.execute' }));

    await waitFor(() => expect(mockStoreState.executeWorkflow).toHaveBeenCalled());
    // le sync REST a été relancé après la commande
    await waitFor(() => expect(mockedService.listWorkflowRuns.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('Annuler exige une confirmation : aucun appel serveur si la modale est refusée', async () => {
    mockedService.listWorkflowRuns.mockResolvedValue(listResponse([runRecord('run-1', 'running')]));
    renderToolbar();

    const cancelButton = await screen.findByRole('button', { name: 'workflow.cancel' });
    fireEvent.click(cancelButton);

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(mockedService.cancelRun).not.toHaveBeenCalled();

    // Refus : la modale se ferme, aucune commande n'est envoyée.
    // (le bouton footer partage le libellé avec la croix de fermeture : on cible le dernier)
    const cancelButtons = screen.getAllByRole('button', { name: 'workflow.cancelRun.cancel' });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mockedService.cancelRun).not.toHaveBeenCalled();
  });

  it('Annuler confirmé appelle cancelRun puis rafraîchit le statut (état serveur)', async () => {
    mockedService.listWorkflowRuns.mockResolvedValue(listResponse([runRecord('run-1', 'running')]));
    renderToolbar();

    fireEvent.click(await screen.findByRole('button', { name: 'workflow.cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'workflow.cancelRun.confirm' }));

    await waitFor(() => expect(mockedService.cancelRun).toHaveBeenCalledWith('run-1'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('Échap ferme la modale de confirmation sans commande', async () => {
    mockedService.listWorkflowRuns.mockResolvedValue(listResponse([runRecord('run-1', 'running')]));
    renderToolbar();

    fireEvent.click(await screen.findByRole('button', { name: 'workflow.cancel' }));
    await screen.findByRole('alertdialog');
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mockedService.cancelRun).not.toHaveBeenCalled();
  });

  it('Reset & Relance appelle fence-and-retry avec Idempotency-Key (202) puis affiche le succès', async () => {
    mockedService.listWorkflowRuns.mockResolvedValue(listResponse([
      runRecord('run-9', 'quarantined', { lockHeld: true, agentInstanceId: 'inst-1' }),
    ]));
    renderToolbar();

    fireEvent.click(await screen.findByTestId('reset-and-relaunch-button'));
    fireEvent.click(await screen.findByTestId('confirm-reset-relaunch'));

    await waitFor(() => expect(mockedService.fenceAndRetry).toHaveBeenCalledWith('wf-1', 'run-9', 'idem-test-uuid'));
    // ⭐ retour graphique : le résultat passe par un toast flottant haut-droite (vert), pas un bandeau inline
    const toast = await screen.findByTestId('notification-toast');
    expect(toast).toHaveAttribute('data-type', 'success');
    expect(toast).toHaveAttribute('role', 'alert');
    expect(toast).toHaveTextContent('workflow.resetAndRelaunch.success');
    expect(screen.queryByTestId('workflow-action-success')).toBeNull();
  });

  it('Reset & Relance : un 409 RUN_NOT_QUARANTINED affiche l’erreur contrat sans fermer l’état serveur', async () => {
    mockedService.listWorkflowRuns.mockResolvedValue(listResponse([
      runRecord('run-9', 'quarantined', { lockHeld: true }),
    ]));
    mockedService.fenceAndRetry.mockRejectedValue(new RunCommandError('refusé', 409, 'RUN_NOT_QUARANTINED'));
    renderToolbar();

    fireEvent.click(await screen.findByTestId('reset-and-relaunch-button'));
    fireEvent.click(await screen.findByTestId('confirm-reset-relaunch'));

    await waitFor(() => expect(screen.getByTestId('reset-relaunch-error')).toBeInTheDocument());
    // le badge/toolbar conserve le statut serveur
    expect(screen.getByTestId('workflow-run-status')).toHaveAttribute('data-status', 'quarantined');
  });

  it('Relancer (run terminal) appelle retry avec une clé d’idempotence', async () => {
    mockedService.listWorkflowRuns.mockResolvedValue(listResponse([runRecord('run-7', 'failed')]));
    renderToolbar();

    fireEvent.click(await screen.findByRole('button', { name: 'workflow.relaunch' }));

    await waitFor(() => expect(mockedService.retryRun).toHaveBeenCalledWith('run-7', 'idem-test-uuid'));
  });

  it('hors ligne : commandes désactivées + diode LED rouge avec bulle explicative (plus de ligne/bandeau)', async () => {
    useRuntimeStore.getState().setRuntimeConnectionState('offline');
    renderToolbar();

    expect(await screen.findByRole('button', { name: 'workflow.execute' })).toBeDisabled();
    const led = screen.getByTestId('workflow-connection-led');
    expect(led).toHaveAttribute('role', 'status');
    expect(led).toHaveAttribute('data-connection', 'offline');
    // la bulle explique que la diode = canal temps réel, pas le serveur API
    expect(screen.getByTestId('workflow-connection-bubble')).toHaveTextContent('workflow.connectionLed.hint');
    expect(screen.queryByTestId('workflow-connection-banner')).toBeNull();
  });

  it('connecté : diode verte placée avant le nom du workflow affiché en jaune doré BOS', async () => {
    renderToolbar();
    const led = await screen.findByTestId('workflow-connection-led');
    expect(led).toHaveAttribute('data-connection', 'connected');
    const name = screen.getByTestId('workflow-current-name');
    expect(name).toHaveTextContent('Demo workflow');
    expect(name).toHaveClass('text-yellow-400');
    // la diode est bien DEVANT le libellé « workflow actuel » dans la zone gauche
    const toolbar = screen.getByTestId('workflow-toolbar');
    expect(toolbar.innerHTML.indexOf('workflow-connection-led')).toBeLessThan(toolbar.innerHTML.indexOf('workflow-current-name'));
  });

  it('un événement run:quarantined du même workspace met à jour le badge sans rechargement', async () => {
    // 1er chargement REST : run running ; après l'événement, le re-poll REST renvoie quarantined (REST autoritaire).
    mockedService.listWorkflowRuns
      .mockResolvedValueOnce(listResponse([runRecord('run-1', 'running')]))
      .mockResolvedValue(listResponse([runRecord('run-1', 'quarantined', { lockHeld: true })]));
    renderToolbar();
    await screen.findByRole('button', { name: 'workflow.cancel' });

    act(() => {

      useRuntimeStore.getState().recordRuntimeEvent({
      id: 'evt-q',
      type: 'run:quarantined',
      version: 1,
      aggregateType: 'run',
      aggregateId: 'run-1',
      workspaceId: 'wf-1',
      occurredAt: '2026-01-01T01:00:00.000Z',
      payload: { status: 'quarantined', lockHeld: true, agentId: 'inst-1' },
      });
    });

    await waitFor(() => expect(screen.getByTestId('workflow-run-status')).toHaveAttribute('data-status', 'quarantined'));
    expect(await screen.findByTestId('reset-and-relaunch-button')).toBeInTheDocument();
  });

  it('un événement d’un autre workflow est ignoré (filtrage strict par workflowId)', async () => {
    mockedService.listWorkflowRuns.mockResolvedValue(listResponse([runRecord('run-1', 'running')]));
    renderToolbar();
    await screen.findByRole('button', { name: 'workflow.cancel' });

    act(() => {

      useRuntimeStore.getState().recordRuntimeEvent({
      id: 'evt-other',
      type: 'run:failed',
      version: 1,
      aggregateType: 'run',
      aggregateId: 'run-other',
      workspaceId: 'wf-AUTRE',
      occurredAt: '2026-01-01T01:00:00.000Z',
      payload: { status: 'failed' },
      });
    });

    expect(screen.getByTestId('workflow-run-status')).toHaveAttribute('data-status', 'running');
  });

  it('Lancer avec graphe invalide : avertissements en toast warning éphémère, aucun lancement, aucun panneau inline', async () => {
    const originalNodes = mockDesignState.nodes;
    mockDesignState.nodes = [
      ...originalNodes,
      { id: 'n-2', type: 'agent', position: { x: 100, y: 100 }, data: { label: 'Node 2' } },
    ];
    try {
      renderToolbar();
      fireEvent.click(await screen.findByRole('button', { name: 'workflow.execute' }));
      // ⭐ retour graphique : toast warning flottant haut-droite (style page Connexions API)
      const toast = await screen.findByTestId('notification-toast');
      expect(toast).toHaveAttribute('data-type', 'warning');
      expect(toast).toHaveTextContent('workflow.validation.warnings');
      expect(toast).toHaveTextContent('workflow.validation.disconnectedNodes');
      // aucun lancement tant que le graphe est invalide
      expect(mockStoreState.executeWorkflow).not.toHaveBeenCalled();
      expect(mockedService.launchRun).not.toHaveBeenCalled();
      // plus de panneau inline dans la toolbar : la carte n'est pas déplacée
      expect(screen.getByTestId('workflow-toolbar').querySelector('ul')).toBeNull();
    } finally {
      mockDesignState.nodes = originalNodes;
    }
  });
});
