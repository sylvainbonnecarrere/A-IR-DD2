import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentDeletionConfirmModal } from '../../components/modals/AgentDeletionConfirmModal';
import { useDesignStore } from '../../stores/useDesignStore';
import { useNotifications } from '../../contexts/NotificationContext';
import { useAuth } from '../../hooks/useAuth';

jest.mock('../../stores/useDesignStore');
jest.mock('../../contexts/NotificationContext');
jest.mock('../../hooks/useAuth');
jest.mock('../../services/agentPrototypeAPI', () => ({
  deleteAgentPrototype: jest.fn(),
}));

describe('AgentDeletionConfirmModal', () => {
  const mockDeleteAgent = jest.fn();
  const mockAddNotification = jest.fn();
  const baseImpact = {
    instanceCount: 2,
    nodeCount: 2,
    instances: [
      { id: 'instance-1', name: 'Instance One', position: { x: 10, y: 20 } },
      { id: 'instance-2', name: 'Instance Two', position: { x: 30, y: 40 } },
    ],
    nodeIds: ['node-1', 'node-2'],
  };
  const baseAgent = {
    id: 'agent-1',
    name: 'Agent Alpha',
    description: 'Prototype test',
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();

    (useDesignStore as unknown as jest.Mock).mockReturnValue({
      deleteAgent: mockDeleteAgent.mockReturnValue({ success: true }),
    });

    (useNotifications as unknown as jest.Mock).mockReturnValue({
      addNotification: mockAddNotification,
    });

    (useAuth as unknown as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      accessToken: null,
    });
  });

  it('passes the orphan media policy when deleting prototype instances', async () => {
    const onDeleteNodes = jest.fn().mockResolvedValue({ success: true });
    const onConfirm = jest.fn();

    render(
      <AgentDeletionConfirmModal
        isOpen={true}
        agent={baseAgent}
        impact={baseImpact}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
        onDeleteNodes={onDeleteNodes}
      />,
    );

    fireEvent.click(screen.getByLabelText('Conserver les medias comme orphelins'));
    fireEvent.click(screen.getByRole('button', { name: /Supprimer le prototype ET ses instances/i }));

    await waitFor(() => {
      expect(onDeleteNodes).toHaveBeenCalledWith(['instance-1', 'instance-2'], 'orphan_media');
    });
    expect(mockDeleteAgent).toHaveBeenCalledWith('agent-1', { deleteInstances: true });
    expect(onConfirm).toHaveBeenCalled();
    expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
    }));
  });

  it('falls back to prototype-only local deletion when instance deletion policy fails', async () => {
    const onDeleteNodes = jest.fn().mockResolvedValue({
      success: false,
      failedInstanceIds: ['instance-2'],
      error: '1 instance(s) n\'ont pas pu etre supprimees avec la politique media demandee.',
    });
    const onConfirm = jest.fn();

    render(
      <AgentDeletionConfirmModal
        isOpen={true}
        agent={baseAgent}
        impact={baseImpact}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
        onDeleteNodes={onDeleteNodes}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Supprimer le prototype ET ses instances/i }));

    await waitFor(() => {
      expect(onDeleteNodes).toHaveBeenCalledWith(['instance-1', 'instance-2'], 'delete_media');
    });
    expect(mockDeleteAgent).toHaveBeenCalledWith('agent-1', { deleteInstances: false });
    expect(onConfirm).toHaveBeenCalled();
    expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
    }));
  });
});