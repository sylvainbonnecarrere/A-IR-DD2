import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import WorkflowCanvas from '../../components/WorkflowCanvas';

let designStoreState: Record<string, any>;
let workflowStoreState: Record<string, unknown>;
let capturedOnNodesChange: ((changes: unknown[]) => void) | null = null;
let capturedOnNodeDragStop: ((event: unknown, node: Record<string, unknown>) => void) | null = null;
let capturedWorkflowCanvasContextValue: Record<string, any> | null = null;
let renderedNodes: Record<string, any>[] = [];

jest.mock('reactflow', () => {
    const React = require('react');

    return {
        __esModule: true,
        default: ({ children, nodes, onNodesChange, onNodeDragStop }: { children?: React.ReactNode; nodes?: Record<string, unknown>[]; onNodesChange?: (changes: unknown[]) => void; onNodeDragStop?: (event: unknown, node: Record<string, unknown>) => void }) => {
            renderedNodes = Array.isArray(nodes) ? (nodes as any[]) : [];
            capturedOnNodesChange = onNodesChange ?? null;
            capturedOnNodeDragStop = onNodeDragStop ?? null;
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
            getNodes: jest.fn(() => renderedNodes),
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
    useDesignStore: Object.assign((selector?: (state: Record<string, unknown>) => unknown) => (
        selector ? selector(designStoreState) : designStoreState
    ), {
        getState: () => designStoreState,
    }),
}));

jest.mock('../../stores/useWorkflowStore', () => ({
    useWorkflowStore: Object.assign((selector?: (state: Record<string, unknown>) => unknown) => (
        selector ? selector(workflowStoreState) : workflowStoreState
    ), {
        getState: () => workflowStoreState,
    }),
}));

jest.mock('../../contexts/WorkflowCanvasContext', () => ({
    WorkflowCanvasProvider: ({ children, value }: { children?: React.ReactNode; value: Record<string, any> }) => {
        capturedWorkflowCanvasContextValue = value;
        return <>{children}</>;
    },
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

describe('WorkflowCanvas minimize->move->restore', () => {
    beforeEach(() => {
        capturedOnNodesChange = null;
        capturedOnNodeDragStop = null;
        capturedWorkflowCanvasContextValue = null;
        renderedNodes = [];
        designStoreState = {
            nodes: [
                {
                    id: 'node-1',
                    type: 'agent',
                    position: { x: 20, y: 20 },
                    data: {
                        robotId: 'archi',
                        label: 'One',
                        workflowId: 'wf-1',
                        agent: null,
                        agentInstance: {
                            id: 'instance-1',
                            prototypeId: 'prototype-1',
                            name: 'One',
                            workflowId: 'wf-1',
                            position: { x: 20, y: 20 },
                            isMinimized: false,
                            isMaximized: false,
                            configuration_json: null,
                        },
                    },
                },
                {
                    id: 'node-2',
                    type: 'agent',
                    position: { x: 440, y: 20 },
                    data: {
                        robotId: 'archi',
                        label: 'Two',
                        workflowId: 'wf-1',
                        agent: null,
                        agentInstance: {
                            id: 'instance-2',
                            prototypeId: 'prototype-1',
                            name: 'Two',
                            workflowId: 'wf-1',
                            position: { x: 440, y: 20 },
                            isMinimized: false,
                            isMaximized: false,
                            configuration_json: null,
                        },
                    },
                },
            ],
            agentInstances: [
                {
                    id: 'instance-1',
                    prototypeId: 'prototype-1',
                    name: 'One',
                    workflowId: 'wf-1',
                    position: { x: 20, y: 20 },
                    isMinimized: false,
                    isMaximized: false,
                    configuration_json: null,
                },
                {
                    id: 'instance-2',
                    prototypeId: 'prototype-1',
                    name: 'Two',
                    workflowId: 'wf-1',
                    position: { x: 440, y: 20 },
                    isMinimized: false,
                    isMaximized: false,
                    configuration_json: null,
                },
            ],
            getResolvedInstance: jest.fn(() => null),
        };

        workflowStoreState = {
            getCurrentWorkflowId: jest.fn(() => 'wf-1'),
        };

        // Default renderedNodes reflect initial positions
        renderedNodes = [
            {
                id: 'node-1',
                position: { x: 20, y: 20 },
                width: 360,
                height: 460,
                data: { agentInstance: { id: 'instance-1', workflowId: 'wf-1' } },
            },
            {
                id: 'node-2',
                position: { x: 440, y: 20 },
                width: 360,
                height: 460,
                data: { agentInstance: { id: 'instance-2', workflowId: 'wf-1' } },
            },
        ];
    });

    it('moves restored node out of overlap when it was moved while minimized and does not persist', async () => {
        const onUpdateNodePosition = jest.fn();
        const onToggleNodeMinimize = jest.fn((nodeId: string) => {
            // Simulate the app toggling minimized state and the user moving the minimized node to x=100 while minimized
            designStoreState = {
                ...designStoreState,
                nodes: designStoreState.nodes.map((n: any) => n.id === nodeId ? { ...n, position: { x: 100, y: 20 } } : n),
                agentInstances: designStoreState.agentInstances.map((i: any) => i.id === 'instance-2' ? { ...i, position: { x: 100, y: 20 }, isMinimized: true } : i),
            };
            // Update renderedNodes as if the minimized node was dragged visually
            renderedNodes = renderedNodes.map(r => r.id === nodeId ? { ...r, position: { x: 100, y: 20 }, width: 120, height: 80 } : r);
        });

        render(<WorkflowCanvas workflowName="QA Workflow" onUpdateNodePosition={onUpdateNodePosition} onToggleNodeMinimize={onToggleNodeMinimize} />);

        expect(capturedWorkflowCanvasContextValue?.onToggleNodeMinimize).toBeDefined();

        await act(async () => {
            capturedWorkflowCanvasContextValue?.onToggleNodeMinimize?.('node-2');
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        // The wrapper should call onUpdateNodePosition with persist: false when correcting restore
        await waitFor(() => {
            expect(onUpdateNodePosition).toHaveBeenCalled();
        });

        const call = onUpdateNodePosition.mock.calls.find((c: any) => c[0] === 'node-2');
        expect(call).toBeDefined();
        // options third arg should have persist false
        expect(call[2] && call[2].persist).toBe(false);
        // The resolved x should not equal the undesired minimized x (100)
        expect(call[1].x).not.toEqual(100);
    });
});
