import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import WorkflowCanvas from '../../components/WorkflowCanvas';
import { RobotId } from '../../types';
import { createTestAgentInstance, createTestCanvasNode } from '../builders/domainBuilders';
import { createDesignStoreTestState, createWorkflowStoreTestState } from '../builders/storeStateBuilders';
import { getWorkflowCanvasHarness, resetWorkflowCanvasHarness } from '../harnesses/workflowCanvasHarness';

let workflowCanvasHarness = resetWorkflowCanvasHarness();

jest.mock('reactflow', () => {
    const React = require('react');

    return {
        __esModule: true,
        default: ({ children, nodes, onNodesChange, onNodeDragStop }: { children?: React.ReactNode; nodes?: Record<string, unknown>[]; onNodesChange?: (changes: unknown[]) => void; onNodeDragStop?: (event: unknown, node: Record<string, unknown>) => void }) => {
            const harness = require('../harnesses/workflowCanvasHarness').getWorkflowCanvasHarness();
            harness.renderedNodes = Array.isArray(nodes) ? nodes : [];
            harness.capturedOnNodesChange = onNodesChange ?? null;
            harness.capturedOnNodeDragStop = onNodeDragStop ?? null;
            return <div data-testid="workflow-canvas-root">{children}</div>;
        },
        Background: () => null,
        Controls: () => null,
        MiniMap: () => null,
        ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
        ConnectionMode: { Strict: 'strict' },
        Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
        addEdge: jest.fn((connection: unknown, edges: unknown[]) => edges),
        useNodesState: jest.fn((initialNodes: unknown[]) => {
            const [nodes, setNodes] = React.useState(initialNodes);
            return [nodes, setNodes, jest.fn()];
        }),
        useEdgesState: jest.fn((initialEdges: unknown[]) => {
            const [edges, setEdges] = React.useState(initialEdges);
            return [edges, setEdges, jest.fn()];
        }),
        useReactFlow: jest.fn(() => ({
            getZoom: jest.fn(() => 1),
            getViewport: jest.fn(() => ({ x: 0, y: 0, zoom: 1 })),
            getNodes: jest.fn(() => require('../harnesses/workflowCanvasHarness').getWorkflowCanvasHarness().renderedNodes),
            getNode: jest.fn(() => null),
            setCenter: jest.fn(),
        })),
    };
});

jest.mock('../../hooks/useDayNightTheme', () => ({
    useDayNightTheme: () => ({
        backgroundGradient: 'linear-gradient(#000, #111)',
        particleColors: ['#00ffff'],
        primaryColor: '#00ffff',
        timeOfDay: 'night',
    }),
}));

jest.mock('../../hooks/useAutoSave', () => ({
    useAutoSave: () => ({
        status: 'idle',
        lastSavedAt: null,
        error: null,
        isEnabled: false,
    }),
}));

jest.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: false }),
}));

jest.mock('../../stores/useDesignStore', () => ({
    useDesignStore: Object.assign((selector?: (state: Record<string, unknown>) => unknown) => {
        const state = require('../harnesses/workflowCanvasHarness').getWorkflowCanvasHarness().designStore;
        return selector ? selector(state) : state;
    }, {
        getState: () => require('../harnesses/workflowCanvasHarness').getWorkflowCanvasHarness().designStore,
    }),
}));

jest.mock('../../stores/useWorkflowStore', () => ({
    useWorkflowStore: Object.assign((selector?: (state: Record<string, unknown>) => unknown) => {
        const state = require('../harnesses/workflowCanvasHarness').getWorkflowCanvasHarness().workflowStore;
        return selector ? selector(state) : state;
    }, {
        getState: () => require('../harnesses/workflowCanvasHarness').getWorkflowCanvasHarness().workflowStore,
    }),
}));

jest.mock('../../components/OptimizedWorkflowBackground', () => ({
    OptimizedWorkflowBackground: () => null,
}));

jest.mock('../../components/modals/PrototypeEditConfirmationModal', () => ({
    PrototypeEditConfirmationModal: () => null,
}));

jest.mock('../../components/modals/AgentFormModal', () => ({
    AgentFormModal: () => null,
}));

jest.mock('../../components/SavePrototypeButton', () => ({
    SavePrototypeButton: () => null,
}));

jest.mock('../../components/AutoSaveIndicator', () => ({
    AutoSaveIndicator: () => null,
}));

jest.mock('../../components/V2AgentNode', () => ({
    V2AgentNode: () => null,
}));

describe('WorkflowCanvas drag anti-collision', () => {
    beforeEach(() => {
        workflowCanvasHarness = resetWorkflowCanvasHarness();
        const firstInstance = createTestAgentInstance({
            id: 'instance-1',
            prototypeId: 'prototype-1',
            name: 'One',
            workflowId: 'wf-1',
            position: { x: 20, y: 20 },
            configuration_json: null,
        });
        const secondInstance = createTestAgentInstance({
            id: 'instance-2',
            prototypeId: 'prototype-1',
            name: 'Two',
            workflowId: 'wf-1',
            position: { x: 440, y: 20 },
            configuration_json: null,
        });

        workflowCanvasHarness.designStore = createDesignStoreTestState({
            nodes: [
                createTestCanvasNode({
                    id: 'node-1',
                    type: 'agent',
                    position: { x: 20, y: 20 },
                    data: {
                        robotId: RobotId.Archi,
                        label: 'One',
                        workflowId: 'wf-1',
                        agent: null,
                        agentInstance: firstInstance,
                    },
                }),
                createTestCanvasNode({
                    id: 'node-2',
                    type: 'agent',
                    position: { x: 440, y: 20 },
                    data: {
                        robotId: RobotId.Archi,
                        label: 'Two',
                        workflowId: 'wf-1',
                        agent: null,
                        agentInstance: secondInstance,
                    },
                }),
            ],
            agentInstances: [firstInstance, secondInstance],
            getResolvedInstance: jest.fn(() => null),
        });

        workflowCanvasHarness.workflowStore = createWorkflowStoreTestState({
            getCurrentWorkflowId: jest.fn(() => 'wf-1'),
        });
    });

    it('resolves a dropped node to a non-overlapping position before notifying App', () => {
        const onUpdateNodePosition = jest.fn();

        render(<WorkflowCanvas workflowName="QA Workflow" onUpdateNodePosition={onUpdateNodePosition} />);

        act(() => {
            workflowCanvasHarness.capturedOnNodesChange?.([
                {
                    id: 'node-2',
                    type: 'position',
                    position: { x: 20, y: 20 },
                    dragging: true,
                },
            ]);
            workflowCanvasHarness.capturedOnNodeDragStop?.({}, {
                id: 'node-2',
                position: { x: 20, y: 20 },
                data: {
                    workflowId: 'wf-1',
                    agentInstance: {
                        id: 'instance-2',
                        workflowId: 'wf-1',
                    },
                },
                width: 384,
                height: 460,
            });
        });

        const call = onUpdateNodePosition.mock.calls.find((c: any) => c[0] === 'node-2');
        expect(call).toBeDefined();
        expect(call[1].x).toBeGreaterThanOrEqual(380);
        expect(call[1].x).not.toEqual(20);
    });

    it('does not request any position update during a passive node projection rerender', async () => {
        const onUpdateNodePosition = jest.fn();
        const passiveNodes = [
            {
                id: 'node-passive-1',
                type: 'agent',
                position: { x: 20, y: 20 },
                data: {
                    robotId: 'archi',
                    label: 'Passive One',
                    workflowId: 'wf-1',
                    agent: null,
                    agentInstance: {
                        id: 'instance-passive-1',
                        prototypeId: 'prototype-1',
                        name: 'Passive One',
                        workflowId: 'wf-1',
                        position: { x: 20, y: 20 },
                        isMinimized: false,
                        isMaximized: false,
                        configuration_json: null,
                    },
                },
            },
        ];

        workflowCanvasHarness.designStore = {
            ...workflowCanvasHarness.designStore,
            nodes: [],
            agentInstances: [],
        };

        const { rerender } = render(
            <WorkflowCanvas
                workflowName="QA Workflow"
                nodes={passiveNodes as any}
                onUpdateNodePosition={onUpdateNodePosition}
            />
        );

        act(() => {
            rerender(
                <WorkflowCanvas
                    workflowName="QA Workflow"
                    nodes={[
                        {
                            ...passiveNodes[0],
                            position: { x: 120, y: 220 },
                            data: {
                                ...passiveNodes[0].data,
                                agentInstance: {
                                    ...passiveNodes[0].data.agentInstance,
                                    position: { x: 120, y: 220 },
                                },
                            },
                        },
                    ] as any}
                    onUpdateNodePosition={onUpdateNodePosition}
                />
            );
        });

        await waitFor(() => {
            expect(getWorkflowCanvasHarness().renderedNodes[0].position).toEqual({ x: 120, y: 220 });
        });
        expect(onUpdateNodePosition).not.toHaveBeenCalled();
    });
});