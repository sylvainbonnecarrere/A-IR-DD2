import type { AgentInstance, V2WorkflowNode } from '../../types';
import { findAvailableWorkflowNodePosition, findCollisionFreeWorkflowNodePosition } from '../../utils/workflowNodePlacement';

const buildNode = (id: string, workflowId: string, position: { x: number; y: number }): V2WorkflowNode => ({
    id,
    type: 'agent',
    position,
    data: {
        robotId: 'archi' as any,
        label: id,
        workflowId,
        isMinimized: false,
        isMaximized: false,
        agentInstance: {
            id: id.replace('node-', 'instance-'),
            prototypeId: 'prototype-1',
            name: id,
            workflowId,
            position,
            isMinimized: false,
            isMaximized: false,
            configuration_json: null,
        } as AgentInstance,
        agent: null,
    },
});

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
});