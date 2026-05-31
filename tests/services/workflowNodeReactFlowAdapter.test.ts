import {
  LLMProvider,
  RobotId,
  type Agent,
  type AgentInstance,
  type WorkflowNode,
  type V2WorkflowNode,
} from '../../types';
import {
  projectWorkflowNodeToReactFlowNode,
  projectWorkflowNodesToReactFlowNodes,
} from '../../services/workflowNodeReactFlowAdapter';

const buildAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 'prototype-1',
  name: 'Prototype Agent',
  role: 'assistant',
  systemPrompt: 'Stay deterministic',
  llmProvider: LLMProvider.Gemini,
  model: 'gemini-2.0-flash',
  capabilities: [],
  creator_id: RobotId.Archi,
  created_at: '2026-05-31T00:00:00.000Z',
  updated_at: '2026-05-31T00:00:00.000Z',
  ...overrides,
});

const buildInstance = (overrides: Partial<AgentInstance> = {}): AgentInstance => ({
  id: 'instance-1',
  prototypeId: 'prototype-1',
  name: 'Projected Instance',
  workflowId: undefined,
  position: { x: 20, y: 40 },
  isMinimized: false,
  isMaximized: false,
  configuration_json: null,
  ...overrides,
});

describe('workflowNodeReactFlowAdapter', () => {
  it('projects a V2 workflow node and backfills missing prototype and workflowId on the instance', () => {
    const prototype = buildAgent();
    const instance = buildInstance();
    const workflowNode: V2WorkflowNode = {
      id: 'node-instance-1',
      type: 'agent',
      position: { x: 20, y: 40 },
      data: {
        robotId: 'archi' as any,
        label: 'stale-label',
        agentInstance: instance,
        workflowId: 'wf-v2',
      },
    };

    const projected = projectWorkflowNodeToReactFlowNode({
      workflowNode,
      index: 0,
      workflowId: 'fallback-workflow',
      agents: [prototype],
    });

    expect(projected).toEqual(expect.objectContaining({
      id: 'node-instance-1',
      type: 'customAgent',
      position: { x: 20, y: 40 },
      data: expect.objectContaining({
        robotId: 'archi',
        label: 'Projected Instance',
        workflowId: 'wf-v2',
        agent: prototype,
        agentInstance: expect.objectContaining({
          id: 'instance-1',
          workflowId: 'wf-v2',
        }),
      }),
    }));
  });

  it('projects a legacy workflow node from the resolved instance/prototype lookup', () => {
    const prototype = buildAgent({ id: 'prototype-resolved', name: 'Resolved Prototype' });
    const instance = buildInstance({
      id: 'instance-resolved',
      prototypeId: 'prototype-resolved',
      name: 'Resolved Instance',
      workflowId: 'wf-resolved',
    });
    const resolveInstance = jest.fn(() => ({
      instance,
      prototype,
    }));
    const workflowNode = {
      id: 'legacy-node',
      agent: null,
      position: { x: 10, y: 15 },
      messages: [],
      isMinimized: false,
      instanceId: 'instance-resolved',
    } as unknown as WorkflowNode;

    const projected = projectWorkflowNodeToReactFlowNode({
      workflowNode,
      index: 0,
      workflowId: 'wf-fallback',
      resolveInstance,
    });

    expect(resolveInstance).toHaveBeenCalledWith('instance-resolved');
    expect(projected.data).toEqual(expect.objectContaining({
      label: 'Resolved Instance',
      workflowId: 'wf-resolved',
      agent: prototype,
      agentInstance: expect.objectContaining({
        id: 'instance-resolved',
        workflowId: 'wf-resolved',
      }),
    }));
  });

  it('falls back to direct agent instance and prototype catalogs when the resolver misses', () => {
    const prototype = buildAgent({ id: 'prototype-direct', name: 'Direct Prototype' });
    const instance = buildInstance({
      id: 'instance-direct',
      prototypeId: 'prototype-direct',
      name: 'Direct Instance',
    });
    const workflowNode = {
      id: 'legacy-direct-node',
      agent: null,
      position: { x: 70, y: 90 },
      messages: [],
      isMinimized: false,
      instanceId: 'instance-direct',
    } as unknown as WorkflowNode;

    const [projected] = projectWorkflowNodesToReactFlowNodes({
      workflowNodes: [workflowNode],
      workflowId: 'wf-direct',
      agents: [prototype],
      agentInstances: [instance],
      resolveInstance: jest.fn(() => null),
    });

    expect(projected.data).toEqual(expect.objectContaining({
      label: 'Direct Instance',
      workflowId: 'wf-direct',
      agent: prototype,
      agentInstance: expect.objectContaining({
        id: 'instance-direct',
        workflowId: 'wf-direct',
      }),
    }));
  });
});