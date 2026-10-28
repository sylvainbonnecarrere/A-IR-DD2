import apiClient from '../../utils/apiClient';
import { PersistenceService } from '../../services/persistenceService';
import { deleteWorkflowInstance, persistNodePosition } from '../../services/appWorkflowPersistenceService';

describe('appWorkflowPersistenceService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists node positions through the canonical instance save path without re-issuing local UI updates', async () => {
    const saveSpy = jest.spyOn(PersistenceService, 'saveAgentInstance').mockResolvedValue({
      success: true,
      error: null,
    } as any);
    const updateNode = jest.fn();
    const updateAgentInstance = jest.fn();

    const result = await persistNodePosition({
      nodeId: 'node-abc',
      position: { x: 12, y: 34 },
      instanceId: 'abc',
      isAuthenticated: true,
      accessToken: 'token-123',
      updateNode,
      updateAgentInstance,
    });

    expect(result).toBe(true);
    expect(updateNode).not.toHaveBeenCalled();
    expect(updateAgentInstance).not.toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalledWith(
      { id: 'abc', position: { x: 12, y: 34 } },
      { isAuthenticated: true, accessToken: 'token-123' },
    );
  });

  it('deletes a workflow instance through the workspace-scoped API route', async () => {
    const deleteSpy = jest.spyOn(apiClient, 'delete').mockResolvedValue({} as any);

    const result = await deleteWorkflowInstance({
      workflowId: 'workflow-123',
      instanceId: 'instance-456',
      isAuthenticated: true,
      accessToken: 'token-123',
    });

    expect(result).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith('/api/workflows/workflow-123/instances/instance-456');
  });
});
