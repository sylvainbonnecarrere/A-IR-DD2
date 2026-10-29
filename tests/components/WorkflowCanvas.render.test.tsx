import React from 'react';
import { act, render, screen } from '@testing-library/react';
import WorkflowCanvas from '../../components/WorkflowCanvas';
import { createDesignStoreTestState, createWorkflowStoreTestState } from '../builders/storeStateBuilders';
import { resetWorkflowCanvasHarness } from '../harnesses/workflowCanvasHarness';

let workflowCanvasHarness = resetWorkflowCanvasHarness();
const reactFlowMock = {
    getZoom: jest.fn(() => 1),
    getViewport: jest.fn(() => ({ x: 0, y: 0, zoom: 1 })),
    getNode: jest.fn(() => null),
    getNodes: jest.fn(() => []),
    getNodesBounds: jest.fn(() => ({ x: 0, y: 0, width: 0, height: 0 })),
    setCenter: jest.fn(),
    setViewport: jest.fn(),
    fitView: jest.fn(),
};

jest.mock('reactflow', () => {
    const React = require('react');

    const Controls = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
        <div data-testid="workflow-controls" className={className} style={style} />
    );

    const MiniMap = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
        <div data-testid="workflow-minimap" className={className} style={style} />
    );

    return {
        __esModule: true,
        default: ({ children }: { children?: React.ReactNode }) => <div data-testid="workflow-canvas-root">{children}</div>,
        Background: () => null,
        Controls,
        MiniMap,
        ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
        ConnectionMode: { Strict: 'strict' },
        Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
        addEdge: jest.fn((connection: unknown, edges: unknown[]) => edges),
        useNodesState: jest.fn((initialNodes: unknown[]) => React.useState(initialNodes)),
        useEdgesState: jest.fn((initialEdges: unknown[]) => React.useState(initialEdges)),
        useReactFlow: jest.fn(() => reactFlowMock),
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
        reactFlowMock.getNode.mockReset();
        reactFlowMock.getZoom.mockClear();
        reactFlowMock.getViewport.mockReset();
        reactFlowMock.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.7 });
        reactFlowMock.getNodes.mockReset();
        reactFlowMock.getNodes.mockReturnValue([]);
        reactFlowMock.getNodesBounds.mockReset();
        reactFlowMock.getNodesBounds.mockReturnValue({ x: 0, y: 0, width: 0, height: 0 });
        reactFlowMock.setCenter.mockClear();
        reactFlowMock.setViewport.mockClear();
        reactFlowMock.fitView.mockClear();
        workflowCanvasHarness.designStore = createDesignStoreTestState({
            nodes: [],
            agentInstances: [],
            getResolvedInstance: jest.fn(() => null),
        });

        workflowCanvasHarness.workflowStore = createWorkflowStoreTestState({
            getCurrentWorkflowId: jest.fn(() => null),
        });
    });

    it('fits the viewport once on the first real load of an existing workflow', () => {
        jest.useFakeTimers();

        try {
            const nodes = [
                { id: 'node-1', position: { x: 120, y: 240 }, data: { label: 'Alpha', robotId: 'archi' } },
                { id: 'node-2', position: { x: 320, y: 470 }, data: { label: 'Beta', robotId: 'bos' } },
            ];

            workflowCanvasHarness.designStore = createDesignStoreTestState({
                nodes,
                agentInstances: [],
                getResolvedInstance: jest.fn(() => null),
            });

            reactFlowMock.getNode.mockImplementation((id: string) => ({
                id,
                position: { x: 120, y: 240 },
                width: 300,
                height: 420,
                measured: { width: 300, height: 420 },
            }));

            render(<WorkflowCanvas workflowName="QA Workflow" />);
            const visibleRoot = document.querySelector('[data-testid="workflow-canvas-root"]');
            if (visibleRoot) {
                Object.defineProperty(visibleRoot, 'clientWidth', { value: 960, configurable: true });
                Object.defineProperty(visibleRoot, 'clientHeight', { value: 640, configurable: true });
            }

            act(() => {
                jest.advanceTimersByTime(200);
            });

            expect(reactFlowMock.setCenter).toHaveBeenCalledTimes(1);
            expect(reactFlowMock.setCenter.mock.calls[0][0]).toEqual(expect.any(Number));
            expect(reactFlowMock.setCenter.mock.calls[0][1]).toEqual(expect.any(Number));
            expect(reactFlowMock.setCenter.mock.calls[0][2]).toMatchObject({ duration: 0, zoom: 0.7 });
            expect(reactFlowMock.setViewport).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 0.7 }, { duration: 0 });
            expect(reactFlowMock.fitView).not.toHaveBeenCalled();
        } finally {
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        }
    });

    it('does not auto-center the viewport when a workflow is rehydrated with additional nodes after screen switch', () => {
        jest.useFakeTimers();

        try {
            const initialNodes = [
                { id: 'node-1', position: { x: 20, y: 20 }, data: { label: 'Alpha', robotId: 'archi' } },
            ];

            workflowCanvasHarness.designStore = createDesignStoreTestState({
                nodes: initialNodes,
                agentInstances: [],
                getResolvedInstance: jest.fn(() => null),
            });

            reactFlowMock.getNode.mockImplementation((id: string) => ({
                id,
                position: { x: 20, y: 20 },
                width: 320,
                height: 420,
                measured: { width: 320, height: 420 },
            }));

            const { rerender } = render(<WorkflowCanvas workflowName="QA Workflow" />);
            const visibleRoot = document.querySelector('[data-testid="workflow-canvas-root"]');
            if (visibleRoot) {
                Object.defineProperty(visibleRoot, 'clientWidth', { value: 960, configurable: true });
                Object.defineProperty(visibleRoot, 'clientHeight', { value: 640, configurable: true });
            }

            workflowCanvasHarness.designStore = createDesignStoreTestState({
                nodes: [
                    ...initialNodes,
                    { id: 'node-2', position: { x: 320, y: 220 }, data: { label: 'Beta', robotId: 'bos' } },
                ],
                agentInstances: [],
                getResolvedInstance: jest.fn(() => null),
            });

            rerender(<WorkflowCanvas workflowName="QA Workflow" />);
            act(() => {
                jest.advanceTimersByTime(300);
            });

            expect(reactFlowMock.setCenter).toHaveBeenCalledTimes(1);
            expect(reactFlowMock.setViewport).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 0.7 }, { duration: 0 });
            expect(reactFlowMock.fitView).not.toHaveBeenCalled();
        } finally {
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        }
    });

    it('resets to the default 0.7 viewport before centering the workflow on real bounds', () => {
        jest.useFakeTimers();

        try {
            const nodes = [
                { id: 'node-1', position: { x: 120, y: 240 }, data: { label: 'Alpha', robotId: 'archi' } },
                { id: 'node-2', position: { x: 620, y: 510 }, data: { label: 'Beta', robotId: 'bos' } },
            ];

            workflowCanvasHarness.designStore = createDesignStoreTestState({
                nodes,
                agentInstances: [],
                getResolvedInstance: jest.fn(() => null),
            });

            reactFlowMock.getNodes.mockReturnValue([
                { id: 'node-1', position: { x: 120, y: 240 }, measured: { width: 220, height: 120 }, width: 220, height: 120 },
                { id: 'node-2', position: { x: 620, y: 510 }, measured: { width: 220, height: 120 }, width: 220, height: 120 },
            ]);
            reactFlowMock.getNodesBounds.mockReturnValue({ x: 110, y: 210, width: 740, height: 420 });

            render(<WorkflowCanvas workflowName="QA Workflow" />);
            const visibleRoot = document.querySelector('[data-testid="workflow-canvas-root"]');
            if (visibleRoot) {
                Object.defineProperty(visibleRoot, 'clientWidth', { value: 960, configurable: true });
                Object.defineProperty(visibleRoot, 'clientHeight', { value: 640, configurable: true });
            }

            act(() => {
                jest.advanceTimersByTime(200);
            });

            expect(reactFlowMock.getNodesBounds).toHaveBeenCalled();
            expect(reactFlowMock.setViewport).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 0.7 }, { duration: 0 });
            expect(reactFlowMock.setCenter).toHaveBeenCalledWith(480, 420, expect.objectContaining({ duration: 0, zoom: expect.any(Number) }));
            expect(reactFlowMock.setCenter.mock.calls[0][2].zoom).toBeGreaterThanOrEqual(0.7);
        } finally {
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        }
    });

    it('waits for the canvas to become visible before applying the initial fit', () => {
        jest.useFakeTimers();

        try {
            const nodes = [
                { id: 'node-1', position: { x: 40, y: 60 }, data: { label: 'Alpha', robotId: 'archi' } },
            ];

            workflowCanvasHarness.designStore = createDesignStoreTestState({
                nodes,
                agentInstances: [],
                getResolvedInstance: jest.fn(() => null),
            });

            const root = document.querySelector('[data-testid="workflow-canvas-root"]');
            if (root) {
                Object.defineProperty(root, 'clientWidth', { value: 0, configurable: true });
                Object.defineProperty(root, 'clientHeight', { value: 0, configurable: true });
            }

            render(<WorkflowCanvas workflowName="QA Workflow" />);
            act(() => {
                jest.advanceTimersByTime(300);
            });

            expect(reactFlowMock.fitView).not.toHaveBeenCalled();

            const visibleRoot = document.querySelector('[data-testid="workflow-canvas-root"]');
            if (visibleRoot) {
                Object.defineProperty(visibleRoot, 'clientWidth', { value: 800, configurable: true });
                Object.defineProperty(visibleRoot, 'clientHeight', { value: 500, configurable: true });
            }

            act(() => {
                jest.advanceTimersByTime(600);
            });

            expect(reactFlowMock.fitView).not.toHaveBeenCalled();
            expect(reactFlowMock.setCenter).toHaveBeenCalledTimes(1);
            expect(reactFlowMock.setViewport).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 0.7 }, { duration: 0 });
        } finally {
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        }
    });

    it('ignores stale viewport-fit timers after the canvas unmounts during a route switch', () => {
        jest.useFakeTimers();

        try {
            const nodes = [
                { id: 'node-1', position: { x: 120, y: 240 }, data: { label: 'Alpha', robotId: 'archi' } },
                { id: 'node-2', position: { x: 620, y: 510 }, data: { label: 'Beta', robotId: 'bos' } },
            ];

            workflowCanvasHarness.designStore = createDesignStoreTestState({
                nodes,
                agentInstances: [],
                getResolvedInstance: jest.fn(() => null),
            });

            reactFlowMock.getNodes.mockReturnValue([
                { id: 'node-1', position: { x: 120, y: 240 }, measured: { width: 220, height: 120 }, width: 220, height: 120 },
                { id: 'node-2', position: { x: 620, y: 510 }, measured: { width: 220, height: 120 }, width: 220, height: 120 },
            ]);
            reactFlowMock.getNodesBounds.mockReturnValue({ x: 110, y: 210, width: 740, height: 420 });

            const visibleRoot = document.createElement('div');
            visibleRoot.setAttribute('data-testid', 'workflow-canvas-root');
            Object.defineProperty(visibleRoot, 'clientWidth', { value: 960, configurable: true });
            Object.defineProperty(visibleRoot, 'clientHeight', { value: 640, configurable: true });
            document.body.appendChild(visibleRoot);

            const { unmount } = render(<WorkflowCanvas workflowName="QA Workflow" />);
            unmount();

            act(() => {
                jest.advanceTimersByTime(500);
            });

            expect(reactFlowMock.setCenter).not.toHaveBeenCalled();
            expect(reactFlowMock.setViewport).not.toHaveBeenCalled();
        } finally {
            document.body.innerHTML = '';
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        }
    });

    it('does not reapply the initial viewport fit when the same workflow is revisited on route re-entry', () => {
        jest.useFakeTimers();

        try {
            const nodes = [
                { id: 'node-1', position: { x: 120, y: 240 }, data: { label: 'Alpha', robotId: 'archi', workflowId: 'wf-1' } },
                { id: 'node-2', position: { x: 620, y: 510 }, data: { label: 'Beta', robotId: 'bos', workflowId: 'wf-1' } },
            ];

            workflowCanvasHarness.designStore = createDesignStoreTestState({
                nodes,
                agentInstances: [],
                getResolvedInstance: jest.fn(() => null),
            });

            reactFlowMock.getNodes.mockReturnValue([
                { id: 'node-1', position: { x: 120, y: 240 }, measured: { width: 220, height: 120 }, width: 220, height: 120 },
                { id: 'node-2', position: { x: 620, y: 510 }, measured: { width: 220, height: 120 }, width: 220, height: 120 },
            ]);
            reactFlowMock.getNodesBounds.mockReturnValue({ x: 110, y: 210, width: 740, height: 420 });

            const root = document.createElement('div');
            root.setAttribute('data-testid', 'workflow-canvas-root');
            Object.defineProperty(root, 'clientWidth', { value: 960, configurable: true });
            Object.defineProperty(root, 'clientHeight', { value: 640, configurable: true });
            document.body.appendChild(root);

            const first = render(<WorkflowCanvas workflowId="wf-1" workflowName="QA Workflow" />);
            act(() => {
                jest.advanceTimersByTime(300);
            });

            expect(reactFlowMock.setCenter).toHaveBeenCalledTimes(1);

            first.unmount();
            render(<WorkflowCanvas workflowId="wf-1" workflowName="QA Workflow" />);

            act(() => {
                jest.advanceTimersByTime(300);
            });

            expect(reactFlowMock.setCenter).toHaveBeenCalledTimes(1);
            expect(reactFlowMock.setViewport).toHaveBeenCalledTimes(1);
        } finally {
            document.body.innerHTML = '';
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        }
    });

    it('renders without crashing when diagnostics are enabled in development', () => {
        render(<WorkflowCanvas workflowName="QA Workflow" />);

        expect(screen.getByTestId('workflow-canvas-root')).toBeInTheDocument();
    });

    it('keeps the workflow controls visually offset from the minimap in the bottom-right corner', () => {
        render(<WorkflowCanvas workflowName="QA Workflow" />);

        expect(screen.getByTestId('workflow-controls')).toHaveClass('workflow-controls-fixed');
        expect(screen.getByTestId('workflow-minimap')).toHaveClass('workflow-minimap-fixed');
    });
});