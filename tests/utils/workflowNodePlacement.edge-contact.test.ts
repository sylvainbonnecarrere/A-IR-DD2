import { findCollisionFreeWorkflowNodePosition } from '../../utils/workflowNodePlacement';
import { buildNode, buildAgentInstance } from './builders/WorkflowNodeBuilder';

describe('workflowNodePlacement edge contact', () => {
  it('treats edge-to-edge contact as collision and resolves position', () => {
    const nodes = [
      buildNode('node-1', 'workflow-1', { x: 20, y: 20 }),
    ];

    const agentInstances = [
      buildAgentInstance('instance-1', 'workflow-1', { x: 20, y: 20 }),
    ];

    // desiredPosition placed exactly at the right edge of node-1 (20 + 360)
    const desiredPosition = { x: 380, y: 20 };

    const resolved = findCollisionFreeWorkflowNodePosition({
      workflowId: 'workflow-1',
      nodeId: 'node-2',
      instanceId: 'instance-2',
      currentPosition: { x: 440, y: 20 },
      desiredPosition,
      subjectSize: { width: 360, height: 460 },
      nodes,
      agentInstances,
      maxSearchRadius: 4,
    });

    expect(resolved).not.toBeNull();
    // Since edge contact counts as collision, resolved.x should not equal desiredPosition.x
    expect(resolved!.x).not.toEqual(desiredPosition.x);
    // Resolved should be either to the right or left of node-1
    expect(resolved!.x).not.toBeLessThan(0);
  });
});
