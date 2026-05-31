import { findCollisionFreeWorkflowNodePosition } from '../../utils/workflowNodePlacement';
import { buildNode, buildAgentInstance } from './builders/WorkflowNodeBuilder';

describe('workflowNodePlacement restore collision', () => {
  it('moves restored node out of overlap when it was moved while minimized', () => {
    // Node A at x=20 (occupied)
    // Node B originally at x=440, user minimized B, moved it near A to x=100
    // On restore, subjectSize should be expanded and collision resolution should move B to non-overlapping x

    const nodes = [
      buildNode('node-1', 'workflow-1', { x: 20, y: 20 }),
      buildNode('node-2', 'workflow-1', { x: 440, y: 20 }),
    ];

    const agentInstances = [
      buildAgentInstance('instance-1', 'workflow-1', { x: 20, y: 20 }),
      buildAgentInstance('instance-2', 'workflow-1', { x: 440, y: 20 }),
    ];

    const desiredPosition = { x: 100, y: 20 }; // position where user left minimized node

    const resolved = findCollisionFreeWorkflowNodePosition({
      workflowId: 'workflow-1',
      nodeId: 'node-2',
      instanceId: 'instance-2',
      currentPosition: { x: 440, y: 20 },
      desiredPosition,
      subjectSize: { width: 384, height: 460 }, // expanded size on restore
      nodes,
      agentInstances,
    });

    // Expect resolution to move node to the right of node-1 (node-1 right edge = 20 + 360 = 380), plus gap -> 425
    expect(resolved).not.toBeNull();
    expect(resolved!.x).toBeGreaterThanOrEqual(380);
    expect(resolved!.x).not.toEqual(desiredPosition.x);
  });
});
