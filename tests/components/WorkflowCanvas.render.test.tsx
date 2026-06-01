import React from 'react';
import { render, screen } from '@testing-library/react';
import WorkflowCanvas from '../../components/WorkflowCanvas';
import { createDesignStoreTestState, createWorkflowStoreTestState } from '../builders/storeStateBuilders';
import { resetWorkflowCanvasHarness } from '../harnesses/workflowCanvasHarness';

let workflowCanvasHarness = resetWorkflowCanvasHarness();

jest.mock('reactflow', () => {
    const React = require('react');

    return {
        __esModule: true,
        default: ({ children }: { children?: React.ReactNode }) => <div data-testid="workflow-canvas-root">{children}</div>,
        Background: () => null,
        Controls: () => null,
        MiniMap: () => null,
        ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
        ConnectionMode: { Strict: 'strict' },
        Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
        addEdge: jest.fn((connection: unknown, edges: unknown[]) => edges),
        useNodesState: jest.fn((initialNodes: unknown[]) => React.useState(initialNodes)),
        useEdgesState: jest.fn((initialEdges: unknown[]) => React.useState(initialEdges)),
        useReactFlow: jest.fn(() => ({
            getZoom: jest.fn(() => 1),
            getViewport: jest.fn(() => ({ x: 0, y: 0, zoom: 1 })),
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

describe('WorkflowCanvas render smoke test', () => {
    beforeEach(() => {
        workflowCanvasHarness = resetWorkflowCanvasHarness();
        workflowCanvasHarness.designStore = createDesignStoreTestState({
            nodes: [],
            agentInstances: [],
            getResolvedInstance: jest.fn(() => null),
        });

        workflowCanvasHarness.workflowStore = createWorkflowStoreTestState({
            getCurrentWorkflowId: jest.fn(() => null),
        });
    });

    it('renders without crashing when diagnostics are enabled in development', () => {
        render(<WorkflowCanvas workflowName="QA Workflow" />);

        expect(screen.getByTestId('workflow-canvas-root')).toBeInTheDocument();
    });
});