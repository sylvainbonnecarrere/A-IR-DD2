import React from 'react';
import { render, screen } from '@testing-library/react';
import WorkflowCanvas from '../../components/WorkflowCanvas';

let designStoreState: Record<string, unknown>;
let workflowStoreState: Record<string, unknown>;

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
        designStoreState = {
            nodes: [],
            agentInstances: [],
            getResolvedInstance: jest.fn(() => null),
        };

        workflowStoreState = {
            getCurrentWorkflowId: jest.fn(() => null),
        };
    });

    it('renders without crashing when diagnostics are enabled in development', () => {
        render(<WorkflowCanvas workflowName="QA Workflow" />);

        expect(screen.getByTestId('workflow-canvas-root')).toBeInTheDocument();
    });
});