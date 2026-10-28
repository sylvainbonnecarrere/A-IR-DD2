import WorkspacePersistenceService from '../../services/workspacePersistenceService';
import { WorkflowEdgeService } from '../../services/workflowService';
import { API_BASE_URL } from '../../config/api.config';

describe('WorkspacePersistenceService V2 cutover', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  it('blocks legacy edge writes and never calls the deprecated workflow edges route in authenticated mode', async () => {
    (global as any).fetch = jest.fn();
    const fetchSpy = jest.spyOn(global as any, 'fetch');

    await expect(
      WorkspacePersistenceService.saveEdges(
        'workflow-123',
        [{ id: 'edge-1', sourceId: 'node-a', targetId: 'node-b' }],
        { isAuthenticated: true, accessToken: 'token-123' }
      )
    ).rejects.toThrow(/deprecated workflow V1 edge/i);

    expect(fetchSpy).not.toHaveBeenCalledWith(
      `${API_BASE_URL}/api/workflows/workflow-123/edges`,
      expect.anything()
    );
  });

  it('updates node positions through the canonical V2 node route', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    });
    const fetchSpy = jest.spyOn(global as any, 'fetch');

    await WorkspacePersistenceService.saveNodes(
      'workflow-123',
      [{ id: 'node-1', agentId: 'agent-1', position: { x: 12, y: 34 } }],
      { isAuthenticated: true, accessToken: 'token-123' }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/workflows/workflow-123/v2/nodes/node-1`,
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123'
        }),
      })
    );
  });

  it('reads edge data from the canonical V2 graph endpoint instead of the legacy workflow edges route', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ edges: [{ id: 'edge-1', source: 'node-a', target: 'node-b' }] })
    });
    const fetchSpy = jest.spyOn(global as any, 'fetch');

    const edges = await WorkflowEdgeService.getEdgesByWorkflow('workflow-123', {
      isAuthenticated: true,
      token: 'token-123'
    });

    expect(edges).toEqual([{ id: 'edge-1', source: 'node-a', target: 'node-b' }]);
    expect(fetchSpy).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/workflows/workflow-123/v2/graph`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123'
        })
      })
    );
    expect(fetchSpy).not.toHaveBeenCalledWith(
      `${API_BASE_URL}/api/workflows/workflow-123/edges`,
      expect.anything()
    );
  });

  it('rejects legacy edge creation in authenticated mode', async () => {
    (global as any).fetch = jest.fn();

    await expect(
      WorkflowEdgeService.createEdge(
        { source: 'node-a', target: 'node-b' },
        { isAuthenticated: true, token: 'token-123' }
      )
    ).rejects.toThrow(/deprecated workflow V1 edge/i);
  });
});
