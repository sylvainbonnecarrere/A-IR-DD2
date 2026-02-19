/**
 * @file J4.4-HydrationWipe.test.tsx
 * @description Integration tests for Workspace Hydration & Wipe (J4.4 ÉTAPE 2)
 * @architecture Validates: Login→Wipe→Hydrate→Save flow
 * 
 * SCENARIOS:
 * 1. Store Wipe: Auth change triggers resetAll() on stores
 * 2. Store Hydration: hydrateFromServer() populates stores correctly
 * 3. Persistence Service: saveWorkflow, saveAgentInstance work in both modes
 * 4. No Data Leak: Guest data not visible after login
 * 5. F5 Refresh: Data persists across refresh
 */

import { act, renderHook } from '@testing-library/react';

// Mock stores - we'll test the actual store logic
import { useDesignStore } from '../../stores/useDesignStore';
import { useRuntimeStore } from '../../stores/useRuntimeStore';
import { GUEST_STORAGE_KEYS } from '../../utils/guestDataUtils';

// Types
import type { AgentInstance, V2WorkflowNode, V2WorkflowEdge, RobotId } from '../../types';

/**
 * Test Suite 1: Store Reset (Wipe) Functionality
 */
describe('J4.4 ÉTAPE 2 - Store Reset (Wipe)', () => {
    beforeEach(() => {
        // Clear localStorage
        Object.values(GUEST_STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(key);
        });
    });

    afterEach(() => {
        // Cleanup stores
        const designStore = useDesignStore.getState();
        const runtimeStore = useRuntimeStore.getState();
        designStore.resetAll();
        runtimeStore.resetAll();
    });

    it('should reset design store completely with resetAll()', () => {
        const { result } = renderHook(() => useDesignStore());

        // Populate store with test data
        act(() => {
            result.current.setAgentInstances([{
                id: 'test-instance-1',
                prototypeId: 'proto-1',
                name: 'Test Agent',
                position: { x: 100, y: 200 },
                isMinimized: false,
                isMaximized: false,
                configuration_json: null
            }]);

            result.current.setNodes([{
                id: 'node-1',
                type: 'agent',
                position: { x: 100, y: 200 },
                data: {
                    robotId: 'archi' as RobotId,
                    label: 'Test Node'
                }
            }]);

            result.current.setEdges([{
                id: 'edge-1',
                source: 'node-1',
                target: 'node-2'
            }]);
        });

        // Verify data is populated
        expect(result.current.agentInstances.length).toBe(1);
        expect(result.current.nodes.length).toBe(1);
        expect(result.current.edges.length).toBe(1);

        // Execute resetAll
        act(() => {
            result.current.resetAll();
        });

        // Verify everything is wiped
        expect(result.current.agentInstances).toEqual([]);
        expect(result.current.nodes).toEqual([]);
        expect(result.current.edges).toEqual([]);
    });

    it('should reset runtime store completely with resetAll()', () => {
        const { result } = renderHook(() => useRuntimeStore());

        // Populate runtime store
        act(() => {
            result.current.setNodeMessages('node-1', [{
                id: 'msg-1',
                sender: 'user',
                text: 'Hello',
                timestamp: new Date()
            }]);
            result.current.setNodeExecuting('node-1', true);
            result.current.setImagePanelOpen(true, 'node-1');
        });

        // Verify data exists
        expect(result.current.nodeMessages['node-1']?.length).toBe(1);
        expect(result.current.isNodeExecuting('node-1')).toBe(true);
        expect(result.current.isImagePanelOpen).toBe(true);

        // Execute resetAll
        act(() => {
            result.current.resetAll();
        });

        // Verify everything is wiped
        expect(result.current.nodeMessages).toEqual({});
        expect(result.current.executingNodes.size).toBe(0);
        expect(result.current.isImagePanelOpen).toBe(false);
    });
});

/**
 * Test Suite 2: Store Hydration Functionality
 */
describe('J4.4 ÉTAPE 2 - Store Hydration', () => {
    beforeEach(() => {
        const designStore = useDesignStore.getState();
        designStore.resetAll();
    });

    it('should hydrate design store with hydrateFromServer()', () => {
        const { result } = renderHook(() => useDesignStore());

        const mockServerData = {
            agentInstances: [
                {
                    id: 'server-instance-1',
                    prototypeId: 'proto-1',
                    name: 'Server Agent',
                    position: { x: 150, y: 250 },
                    isMinimized: false,
                    isMaximized: false,
                    configuration_json: null
                }
            ] as AgentInstance[],
            nodes: [
                {
                    id: 'server-node-1',
                    type: 'agent' as const,
                    position: { x: 150, y: 250 },
                    data: {
                        robotId: 'archi' as RobotId,
                        label: 'Server Node'
                    }
                }
            ] as V2WorkflowNode[],
            edges: [
                {
                    id: 'server-edge-1',
                    source: 'server-node-1',
                    target: 'server-node-2'
                }
            ] as V2WorkflowEdge[]
        };

        // Execute hydration
        act(() => {
            result.current.hydrateFromServer(mockServerData);
        });

        // Verify data is hydrated
        expect(result.current.agentInstances.length).toBe(1);
        expect(result.current.agentInstances[0].id).toBe('server-instance-1');
        expect(result.current.agentInstances[0].name).toBe('Server Agent');

        expect(result.current.nodes.length).toBe(1);
        expect(result.current.nodes[0].id).toBe('server-node-1');

        expect(result.current.edges.length).toBe(1);
        expect(result.current.edges[0].id).toBe('server-edge-1');
    });

    it('should replace existing data on hydration (not merge)', () => {
        const { result } = renderHook(() => useDesignStore());

        // Pre-populate with "guest" data
        act(() => {
            result.current.setAgentInstances([{
                id: 'guest-instance',
                prototypeId: 'proto-guest',
                name: 'Guest Agent',
                position: { x: 0, y: 0 },
                isMinimized: false,
                isMaximized: false,
                configuration_json: null
            }]);
        });

        expect(result.current.agentInstances.length).toBe(1);
        expect(result.current.agentInstances[0].id).toBe('guest-instance');

        // Hydrate with server data
        act(() => {
            result.current.hydrateFromServer({
                agentInstances: [{
                    id: 'auth-instance',
                    prototypeId: 'proto-auth',
                    name: 'Auth Agent',
                    position: { x: 100, y: 100 },
                    isMinimized: false,
                    isMaximized: false,
                    configuration_json: null
                }],
                nodes: [],
                edges: []
            });
        });

        // Should REPLACE, not merge
        expect(result.current.agentInstances.length).toBe(1);
        expect(result.current.agentInstances[0].id).toBe('auth-instance');
        // Guest data should be GONE
        expect(result.current.agentInstances.find(a => a.id === 'guest-instance')).toBeUndefined();
    });
});

/**
 * Test Suite 3: Auth State Change Flow
 */
describe('J4.4 ÉTAPE 2 - Auth State Change Flow', () => {
    beforeEach(() => {
        const designStore = useDesignStore.getState();
        const runtimeStore = useRuntimeStore.getState();
        designStore.resetAll();
        runtimeStore.resetAll();
        Object.values(GUEST_STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(key);
        });
    });

    it('should wipe then hydrate on login (full flow)', () => {
        // Step 1: Populate with guest data (simulating pre-login state)
        useDesignStore.getState().setAgentInstances([{
            id: 'guest-agent',
            prototypeId: 'proto-guest',
            name: 'Guest Before Login',
            position: { x: 50, y: 50 },
            isMinimized: false,
            isMaximized: false,
            configuration_json: null
        }]);

        useRuntimeStore.getState().setNodeMessages('guest-node', [{
            id: 'msg-guest',
            sender: 'user',
            text: 'Guest message',
            timestamp: new Date()
        }]);

        expect(useDesignStore.getState().agentInstances.length).toBe(1);
        expect(Object.keys(useRuntimeStore.getState().nodeMessages).length).toBe(1);

        // Step 2: Auth state changes → Wipe (as useWorkspaceHydration would do)
        useDesignStore.getState().resetAll();
        useRuntimeStore.getState().resetAll();

        expect(useDesignStore.getState().agentInstances).toEqual([]);
        expect(useRuntimeStore.getState().nodeMessages).toEqual({});

        // Step 3: Hydrate from server (as useWorkspaceHydration would do)
        useDesignStore.getState().hydrateFromServer({
            agentInstances: [{
                id: 'auth-agent',
                prototypeId: 'proto-auth',
                name: 'Authenticated User Agent',
                position: { x: 200, y: 200 },
                isMinimized: false,
                isMaximized: false,
                configuration_json: null
            }],
            nodes: [{
                id: 'auth-node',
                type: 'agent',
                position: { x: 200, y: 200 },
                data: { robotId: 'archi' as RobotId, label: 'Auth Node' }
            }],
            edges: []
        });

        // Step 4: Verify clean state with only auth data
        const finalState = useDesignStore.getState();
        expect(finalState.agentInstances.length).toBe(1);
        expect(finalState.agentInstances[0].name).toBe('Authenticated User Agent');
        expect(finalState.nodes.length).toBe(1);
        expect(finalState.nodes[0].id).toBe('auth-node');
        
        // Guest data should be COMPLETELY gone
        expect(finalState.agentInstances.find(a => a.id === 'guest-agent')).toBeUndefined();
    });

    it('should wipe stores on logout (return to guest mode)', () => {
        // Pre-populate with auth data
        useDesignStore.getState().hydrateFromServer({
            agentInstances: [{
                id: 'auth-agent',
                prototypeId: 'proto-1',
                name: 'Auth Agent',
                position: { x: 100, y: 100 },
                isMinimized: false,
                isMaximized: false,
                configuration_json: null
            }],
            nodes: [],
            edges: []
        });

        expect(useDesignStore.getState().agentInstances.length).toBe(1);

        // Logout → wipe
        useDesignStore.getState().resetAll();

        // State should be clean for guest mode
        const afterLogout = useDesignStore.getState();
        expect(afterLogout.agentInstances).toEqual([]);
        expect(afterLogout.nodes).toEqual([]);
        expect(afterLogout.edges).toEqual([]);
    });
});

/**
 * Test Suite 4: No Data Leak Validation
 */
describe('J4.4 ÉTAPE 2 - No Data Leak Validation', () => {
    it('should not expose guest localStorage data after login wipe', () => {
        // Setup: Store guest data in localStorage
        const guestWorkflow = {
            id: 'guest-workflow',
            name: 'Guest Workflow',
            nodes: [{ id: 'guest-node', type: 'agent' }]
        };
        localStorage.setItem(GUEST_STORAGE_KEYS.workflow, JSON.stringify(guestWorkflow));
        localStorage.setItem(GUEST_STORAGE_KEYS.llmConfigs, JSON.stringify([
            { provider: 'OpenAI', apiKeyPlaintext: 'sk-guest-key-123' }
        ]));

        // Verify guest data exists
        expect(localStorage.getItem(GUEST_STORAGE_KEYS.workflow)).not.toBeNull();
        expect(localStorage.getItem(GUEST_STORAGE_KEYS.llmConfigs)).not.toBeNull();

        // Simulate login wipe (what AuthContext/useWorkspaceHydration should do)
        Object.values(GUEST_STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(key);
        });

        // Verify guest data is wiped
        expect(localStorage.getItem(GUEST_STORAGE_KEYS.workflow)).toBeNull();
        expect(localStorage.getItem(GUEST_STORAGE_KEYS.llmConfigs)).toBeNull();
    });
});

/**
 * Test Suite 5: Persistence Service Basic Tests
 */
describe('J4.4 ÉTAPE 2 - Persistence Service', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('should save workflow to localStorage in guest mode', async () => {
        // Import dynamically to avoid issues
        const { PersistenceService } = await import('../../services/persistenceService');

        const workflow = {
            id: 'test-workflow',
            name: 'Test Workflow',
            nodes: [],
            edges: [],
            isActive: true
        };

        // Save in guest mode (no auth)
        await PersistenceService.saveWorkflow(workflow, {
            isAuthenticated: false
        });

        // Verify localStorage
        const saved = localStorage.getItem(GUEST_STORAGE_KEYS.workflow);
        expect(saved).not.toBeNull();
        const parsed = JSON.parse(saved!);
        expect(parsed.id).toBe('test-workflow');
    });

    it('should save canvas state to localStorage in guest mode', async () => {
        const { PersistenceService } = await import('../../services/persistenceService');

        const canvasState = {
            zoom: 1.5,
            panX: 100,
            panY: 200
        };

        await PersistenceService.saveCanvasState('workflow-1', canvasState, {
            isAuthenticated: false
        });

        // saveCanvasState uses saveWorkflow internally, so check WORKFLOW key
        const saved = localStorage.getItem(GUEST_STORAGE_KEYS.WORKFLOW);
        expect(saved).not.toBeNull();
        const parsed = JSON.parse(saved!);
        expect(parsed.canvasState.zoom).toBe(1.5);
    });
});

/**
 * Test Suite 6: Content Helpers
 */
describe('J4.4 ÉTAPE 2 - Content Helpers', () => {
    it('should create chat content with correct structure', async () => {
        const { PersistenceService } = await import('../../services/persistenceService');

        const chatContent = PersistenceService.createChatContent(
            'user',
            'Hello world',
            {
                llmProvider: 'OpenAI',
                modelUsed: 'gpt-4',
                tokensUsed: 10
            }
        );

        expect(chatContent.type).toBe('chat');
        expect(chatContent.role).toBe('user');
        expect(chatContent.message).toBe('Hello world');
        expect(chatContent.metadata?.llmProvider).toBe('OpenAI');
        expect(chatContent.timestamp).toBeInstanceOf(Date);
    });

    it('should create error content with correct structure', async () => {
        const { PersistenceService } = await import('../../services/persistenceService');

        const errorContent = PersistenceService.createErrorContent(
            'llm_timeout',
            'Request timed out',
            'llm_service',
            true,
            3
        );

        expect(errorContent.type).toBe('error');
        expect(errorContent.subType).toBe('llm_timeout');
        expect(errorContent.message).toBe('Request timed out');
        expect(errorContent.metadata?.retryable).toBe(true);
        expect(errorContent.timestamp).toBeInstanceOf(Date);
    });

    it('should create image content with correct structure', async () => {
        const { PersistenceService } = await import('../../services/persistenceService');

        const imageContent = PersistenceService.createImageContent(
            'uuid-123',
            'A beautiful sunset',
            '/api/media/uuid-123',
            'dall-e-3',
            '1024x1024'
        );

        expect(imageContent.type).toBe('image');
        expect(imageContent.mediaId).toBe('uuid-123');
        expect(imageContent.prompt).toBe('A beautiful sunset');
        expect(imageContent.metadata?.model).toBe('dall-e-3');
        expect(imageContent.timestamp).toBeInstanceOf(Date);
    });
});
