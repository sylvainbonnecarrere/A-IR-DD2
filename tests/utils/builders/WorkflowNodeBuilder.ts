import type { AgentInstance, V2WorkflowNode } from '../../../types';

export const buildNode = (id: string, workflowId: string, position: { x: number; y: number }): V2WorkflowNode => ({
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

export const buildAgentInstance = (id: string, workflowId: string, position: { x: number; y: number }): AgentInstance => ({
    id,
    prototypeId: 'prototype-1',
    name: id,
    workflowId,
    position,
    isMinimized: false,
    isMaximized: false,
    configuration_json: null,
});
