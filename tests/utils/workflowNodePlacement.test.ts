import type { AgentInstance, V2WorkflowNode } from '../../types';
import {
    WORKFLOW_NODE_PLACEMENT_COLUMNS,
    WORKFLOW_NODE_PLACEMENT_ORIGIN,
    WORKFLOW_NODE_PLACEMENT_SPACING,
    findAvailableWorkflowNodePosition,
    findCollisionFreeWorkflowNodePosition,
} from '../../utils/workflowNodePlacement';
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

        expect(position).toEqual({ x: 448, y: 20 });
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

        // subjectSize undefined => gap = round(360/8)=45 and padding=20 -> x = 20 + 360 + 20 + 45 = 445
        expect(position).toEqual({ x: 445, y: 20 });
    });

    it('treats a small visual proximity gap as collision when padded bounds still overlap', () => {
        const desired = { x: 390, y: 20 }; // 10px visual gap from occupiedRight=380, but padded bounds still overlap

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

        expect(position).toEqual({ x: 445, y: 20 });
    });

    it('ignores occupied rects belonging to the same node and instance during move validation', () => {
        const desiredPosition = { x: 20, y: 20 };

        const position = findCollisionFreeWorkflowNodePosition({
            workflowId: 'workflow-1',
            nodeId: 'node-1',
            instanceId: 'instance-1',
            currentPosition: desiredPosition,
            desiredPosition,
            nodes: [],
            agentInstances: [],
            occupiedNodeRects: [
                {
                    nodeId: 'node-1',
                    instanceId: 'instance-1',
                    workflowId: 'workflow-1',
                    position: desiredPosition,
                    width: 360,
                    height: 460,
                },
            ],
        });

        expect(position).toEqual(desiredPosition);
    });

    it('searches around the desired position when directional resolution cannot run', () => {
        const desiredPosition = { x: 2000, y: 2000 };

        const position = findCollisionFreeWorkflowNodePosition({
            workflowId: 'workflow-1',
            desiredPosition,
            maxSearchRadius: 9,
            subjectSize: { width: 1, height: 1 },
            nodes: [],
            agentInstances: [],
            occupiedNodeRects: [
                {
                    nodeId: 'occupied-node',
                    workflowId: 'workflow-1',
                    position: desiredPosition,
                    width: 1,
                    height: 1,
                },
            ],
        });

        expect(position).not.toEqual(desiredPosition);
        expect(position.x).toBeGreaterThanOrEqual(1955);
        expect(position.x).toBeLessThanOrEqual(2045);
        expect(position.y).toBeGreaterThanOrEqual(1955);
        expect(position.y).toBeLessThanOrEqual(2045);
    });

    it('falls back to the overflow slot when override collisions block the desired slot and catalog fallback matches it', () => {
        const desiredPosition = { x: WORKFLOW_NODE_PLACEMENT_ORIGIN.x, y: WORKFLOW_NODE_PLACEMENT_ORIGIN.y };
        const overflowRow = Math.floor(48 / WORKFLOW_NODE_PLACEMENT_COLUMNS);

        const position = findCollisionFreeWorkflowNodePosition({
            workflowId: 'workflow-1',
            desiredPosition,
            maxSearchRadius: 0,
            nodes: [],
            agentInstances: [],
            occupiedNodeRects: [
                {
                    nodeId: 'occupied-node',
                    workflowId: 'workflow-1',
                    position: desiredPosition,
                    width: 360,
                    height: 460,
                },
            ],
        });

        expect(position).toEqual({
            x: WORKFLOW_NODE_PLACEMENT_ORIGIN.x,
            y: WORKFLOW_NODE_PLACEMENT_ORIGIN.y + overflowRow * WORKFLOW_NODE_PLACEMENT_SPACING.y,
        });
    });
});