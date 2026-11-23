import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import WorkflowCanvas from '../../components/WorkflowCanvas';
import { RobotId } from '../../types';
import { createTestAgentInstance, createTestCanvasNode } from '../builders/domainBuilders';
import { createDesignStoreTestState, createWorkflowStoreTestState } from '../builders/storeStateBuilders';
import { resetWorkflowCanvasHarness } from '../harnesses/workflowCanvasHarness';

import { findCollisionFreeWorkflowNodePosition } from '../../utils/workflowNodePlacement';

let workflowCanvasHarness = resetWorkflowCanvasHarness();

jest.mock('../../utils/workflowNodePlacement', () => {
  const actual = jest.requireActual('../../utils/workflowNodePlacement');
  return {
    ...actual,
    findCollisionFreeWorkflowNodePosition: jest.fn(actual.findCollisionFreeWorkflowNodePosition),
  };
});

jest.mock('reactflow', () => {
  const React = require('react');

  return {
    __esModule: true,
    default: ({
      children,
      nodes,
      onNodesChange,
      onNodeDragStop,
    }: {
      children?: React.ReactNode;
      nodes?: Record<string, unknown>[];
      onNodesChange?: (changes: unknown[]) => void;
      onNodeDragStop?: (event: unknown, node: Record<string, unknown>) => void;
    }) => {
      const harness = require('../harnesses/workflowCanvasHarness').getWorkflowCanvasHarness();
      harness.renderedNodes = Array.isArray(nodes) ? (nodes as unknown[]) : [];
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
  useDesignStore: Object.assign(
    (selector?: (state: Record<string, unknown>) => unknown) => {
      const state = require('../harnesses/workflowCanvasHarness').getWorkflowCanvasHarness().designStore;
      return selector ? selector(state) : state;
    },
    {
      getState: () => require('../harnesses/workflowCanvasHarness').getWorkflowCanvasHarness().designStore,
    },
  ),
}));

jest.mock('../../stores/useWorkflowStore', () => ({
  useWorkflowStore: Object.assign(
    (selector?: (state: Record<string, unknown>) => unknown) => {
      const state = require('../harnesses/workflowCanvasHarness').getWorkflowCanvasHarness().workflowStore;
      return selector ? selector(state) : state;
    },
    {
      getState: () => require('../harnesses/workflowCanvasHarness').getWorkflowCanvasHarness().workflowStore,
    },
  ),
}));

jest.mock('../../contexts/WorkflowCanvasContext', () => ({
  WorkflowCanvasProvider: ({ children, value }: { children?: React.ReactNode; value: Record<string, any> }) => {
    require('../harnesses/workflowCanvasHarness').getWorkflowCanvasHarness().capturedWorkflowCanvasContextValue = value;
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
    workflowCanvasHarness = resetWorkflowCanvasHarness();
    (findCollisionFreeWorkflowNodePosition as jest.Mock).mockClear();
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
      currentWorkflowId: 'wf-1',
      nodes: [
        createTestCanvasNode({
          id: 'node-1',
          position: { x: 20, y: 20 },
          data: {
            robotId: RobotId.Archi,
            label: 'One',
            workflowId: 'wf-1',
            agentInstance: firstInstance,
          },
        }),
        createTestCanvasNode({
          id: 'node-2',
          position: { x: 440, y: 20 },
          data: {
            robotId: RobotId.Archi,
            label: 'Two',
            workflowId: 'wf-1',
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

    // Default renderedNodes reflect initial positions
    workflowCanvasHarness.renderedNodes = [
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
      workflowCanvasHarness.designStore = {
        ...workflowCanvasHarness.designStore,
        nodes: workflowCanvasHarness.designStore.nodes.map((n) => (n.id === nodeId ? { ...n, position: { x: 100, y: 20 } } : n)),
        agentInstances: workflowCanvasHarness.designStore.agentInstances.map((i) =>
          i.id === 'instance-2' ? { ...i, position: { x: 100, y: 20 }, isMinimized: true } : i,
        ),
      };
      // Update renderedNodes as if the minimized node was dragged visually
      workflowCanvasHarness.renderedNodes = workflowCanvasHarness.renderedNodes.map((r) =>
        r.id === nodeId ? { ...r, position: { x: 100, y: 20 }, width: 120, height: 80 } : r,
      );
    });

    render(
      <WorkflowCanvas workflowName="QA Workflow" onUpdateNodePosition={onUpdateNodePosition} onToggleNodeMinimize={onToggleNodeMinimize} />,
    );

    expect(workflowCanvasHarness.capturedWorkflowCanvasContextValue?.onToggleNodeMinimize).toBeDefined();

    await act(async () => {
      workflowCanvasHarness.capturedWorkflowCanvasContextValue?.onToggleNodeMinimize?.('node-2');
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The wrapper should call onUpdateNodePosition with persist: false when correcting restore
    await waitFor(() => {
      expect(onUpdateNodePosition).toHaveBeenCalled();
    });

    const call = onUpdateNodePosition.mock.calls.find((c) => c[0] === 'node-2');
    expect(call).toBeDefined();
    // options third arg should have persist false
    expect(call[2] && call[2].persist).toBe(false);
    // The resolved x should not equal the undesired minimized x (100)
    expect(call[1].x).not.toEqual(100);
  });

  it('never writes a stale `measured` from a mid-transition offsetWidth when toggling minimize', async () => {
    const onUpdateNodePosition = jest.fn();
    const onToggleNodeMinimize = jest.fn((nodeId: string) => {
      workflowCanvasHarness.designStore = {
        ...workflowCanvasHarness.designStore,
        nodes: workflowCanvasHarness.designStore.nodes.map((n) => (n.id === nodeId ? { ...n, position: { x: 100, y: 20 } } : n)),
        agentInstances: workflowCanvasHarness.designStore.agentInstances.map((i) =>
          i.id === 'instance-2' ? { ...i, position: { x: 100, y: 20 }, isMinimized: true } : i,
        ),
      };
      workflowCanvasHarness.renderedNodes = workflowCanvasHarness.renderedNodes.map((r) =>
        r.id === nodeId ? { ...r, position: { x: 100, y: 20 }, width: 120, height: 80 } : r,
      );
    });

    // Élément DOM factice : le nœud existe pendant la transition CSS (largeur transitoire 256).
    const nodeEl = document.createElement('div');
    nodeEl.setAttribute('data-id', 'node-2');
    Object.defineProperty(nodeEl, 'offsetWidth', { value: 256, configurable: true });
    Object.defineProperty(nodeEl, 'offsetHeight', { value: 120, configurable: true });
    document.body.appendChild(nodeEl);

    try {
      render(
        <WorkflowCanvas
          workflowName="QA Workflow"
          onUpdateNodePosition={onUpdateNodePosition}
          onToggleNodeMinimize={onToggleNodeMinimize}
        />,
      );

      await act(async () => {
        workflowCanvasHarness.capturedWorkflowCanvasContextValue?.onToggleNodeMinimize?.('node-2');
        // Laisser le timer de secours (600 ms) se déclencher : jsdom n'a pas de
        // ResizeObserver et transitionend ne fired jamais.
        await new Promise((resolve) => setTimeout(resolve, 800));
      });

      // Cause racine : aucun `measured` ne doit être écrit sur le nœud rendu depuis un
      // offsetWidth lu pendant la transition (React Flow maintient width/height).
      const renderedNode2 = workflowCanvasHarness.renderedNodes.find((n) => n.id === 'node-2');
      expect(renderedNode2).toBeDefined();
      expect(renderedNode2.measured).toBeUndefined();

      // La correction de collision a bien eu lieu, sans persist.
      await waitFor(() => {
        expect(onUpdateNodePosition).toHaveBeenCalled();
      });
      const call = onUpdateNodePosition.mock.calls.find((c) => c[0] === 'node-2');
      expect(call).toBeDefined();
      expect(call[2] && call[2].persist).toBe(false);
      expect(call[1].x).not.toEqual(100);

      // La correction doit utiliser la taille stabilisée observée (256x120), jamais
      // l'heuristique "> 300 -> 384" qui was evaluated mid-transition.
      const placementCalls = (findCollisionFreeWorkflowNodePosition as jest.Mock).mock.calls
        .map((c) => c[0])
        .filter((params) => params?.nodeId === 'node-2');
      expect(placementCalls.length).toBeGreaterThan(0);
      const lastPlacement = placementCalls[placementCalls.length - 1];
      expect(lastPlacement.subjectSize).toEqual({ width: 256, height: 120 });
    } finally {
      document.body.removeChild(nodeEl);
    }
  });
});
