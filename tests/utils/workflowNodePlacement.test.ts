import type { AgentInstance, V2WorkflowNode } from '../../types';
import { findAvailableWorkflowNodePosition, findCollisionFreeWorkflowNodePosition } from '../../utils/workflowNodePlacement';
import { buildNode, buildAgentInstance } from './builders/WorkflowNodeBuilder';

describe('workflowNodePlacement', () => {
    it('ignores nodes from other workflows when choosing the next slot', () => {
        const position = findAvailableWorkflowNodePosition({
            workflowId: 'workflow-1',
            nodes: [
                buildNode('node-1', 'workflow-1', { x: 20, y: 20 }),
                buildNode('node-2', 'workflow-1', { x: 440, y: 20 }),
                buildNode('node-3', 'workflow-2', { x: 860, y: 20 }),
            ],
            agentInstances: [],
        });

        expect(position).toEqual({ x: 860, y: 20 });
    });

    it('fills the first free slot in the current workflow instead of using a global count', () => {
        const position = findAvailableWorkflowNodePosition({
            workflowId: 'workflow-1',
            nodes: [
                buildNode('node-1', 'workflow-1', { x: 20, y: 20 }),
                buildNode('node-3', 'workflow-1', { x: 860, y: 20 }),
            ],
            agentInstances: [
                {
                    id: 'instance-other-workflow',
                    prototypeId: 'prototype-1',
                    name: 'Elsewhere',
                    workflowId: 'workflow-2',
                    position: { x: 1280, y: 20 },
                    isMinimized: false,
                    isMaximized: false,
                    configuration_json: null,
                } as AgentInstance,
            ],
        });

        expect(position).toEqual({ x: 440, y: 20 });
    });

    it('rejects a manual drop that would overlap another node in the current workflow', () => {
        const position = findCollisionFreeWorkflowNodePosition({
            workflowId: 'workflow-1',
            nodeId: 'node-2',
            instanceId: 'instance-2',
            currentPosition: { x: 440, y: 20 },
            desiredPosition: { x: 20, y: 20 },
            subjectSize: { width: 384, height: 460 },
            nodes: [
                buildNode('node-1', 'workflow-1', { x: 20, y: 20 }),
                buildNode('node-2', 'workflow-1', { x: 440, y: 20 }),
            ],
            agentInstances: [
                {
                    id: 'instance-1',
                    prototypeId: 'prototype-1',
                    name: 'One',
                    workflowId: 'workflow-1',
                    position: { x: 20, y: 20 },
                    isMinimized: false,
                    isMaximized: false,
                    configuration_json: null,
                } as AgentInstance,
                {
                    id: 'instance-2',
                    prototypeId: 'prototype-1',
                    name: 'Two',
                    workflowId: 'workflow-1',
                    position: { x: 440, y: 20 },
                    isMinimized: false,
                    isMaximized: false,
                    configuration_json: null,
                } as AgentInstance,
            ],
        });

        expect(position).toEqual({ x: 428, y: 20 });
    });

    it('treats edge-to-edge contact as a collision and resolves with directional gap', () => {
        const position = findCollisionFreeWorkflowNodePosition({
            workflowId: 'workflow-1',
            nodeId: 'node-2',
            instanceId: 'instance-2',
            currentPosition: { x: 440, y: 20 },
            desiredPosition: { x: 380, y: 20 }, // edge-to-edge against node at x=20 (width=360)
            nodes: [
                buildNode('node-1', 'workflow-1', { x: 20, y: 20 }),
                buildNode('node-2', 'workflow-1', { x: 440, y: 20 }),
            ],
            agentInstances: [
                buildAgentInstance('instance-1', 'workflow-1', { x: 20, y: 20 }),
                buildAgentInstance('instance-2', 'workflow-1', { x: 440, y: 20 }),
            ],
        });

        // subjectSize undefined => gap = round(360/8)=45 -> expected x = 20 + 360 + 45 = 425
        expect(position).toEqual({ x: 425, y: 20 });
    });

    it('allows a small proximity gap that does not overlap edge-to-edge', () => {
        const desired = { x: 390, y: 20 }; // 10px gap from occupiedRight=380

        const position = findCollisionFreeWorkflowNodePosition({
            workflowId: 'workflow-1',
            nodeId: 'node-2',
            instanceId: 'instance-2',
            currentPosition: { x: 440, y: 20 },
            desiredPosition: desired,
            nodes: [
                buildNode('node-1', 'workflow-1', { x: 20, y: 20 }),
                buildNode('node-2', 'workflow-1', { x: 440, y: 20 }),
            ],
            agentInstances: [
                buildAgentInstance('instance-1', 'workflow-1', { x: 20, y: 20 }),
                buildAgentInstance('instance-2', 'workflow-1', { x: 440, y: 20 }),
            ],
        });

        expect(position).toEqual(desired);
    });
});