import React, { useState, useCallback, useEffect } from 'react';
import { Agent, LLMConfig, LLMProvider, WorkflowNode, LLMCapability, ChatMessage, HistoryConfig, RobotId, V2WorkflowNode, AgentInstance } from './types';
import { NavigationLayout } from './components/NavigationLayout';
import { RobotPageRouter } from './components/RobotPageRouter';
import { AgentFormModal } from './components/modals/AgentFormModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { Header } from './components/Header';
import { GUEST_STORAGE_KEYS } from './utils/guestDataUtils';
import { LoginModal } from './components/modals/LoginModal';
import { RegisterModal } from './components/modals/RegisterModal';
import { ImageGenerationPanel } from './components/panels/ImageGenerationPanel';
import { ImageModificationPanel } from './components/panels/ImageModificationPanel';
import { VideoGenerationConfigPanel } from './components/panels/VideoGenerationConfigPanel';
import { MapsGroundingConfigPanel } from './components/panels/MapsGroundingConfigPanel';
import { useLocalization } from './hooks/useLocalization';
import { Button } from './components/UI';
import { ConfirmationModal } from './components/modals/ConfirmationModal';
import { FullscreenChatModal } from './components/modals/FullscreenChatModal';
import { AgentConfigurationModal } from './components/modals/AgentConfigurationModal';
import { useRuntimeStore } from './stores/useRuntimeStore';
import { useDesignStore } from './stores/useDesignStore';
import { useWorkflowStore } from './stores/useWorkflowStore';
import { NotificationProvider } from './contexts';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotificationDisplay } from './components/NotificationDisplay';
import { QueryProvider } from './providers';
import { getSettingsStorage } from './utils/SettingsStorage';
// ⭐ ÉTAPE 5: Import HydrationOverlay for loading state
import { HydrationOverlay } from './components/HydrationOverlay';
// ⭐ UX Polish: Import HyperspaceReveal for guest entry animation
import { HyperspaceReveal } from './components/HyperspaceReveal';
// ⭐ AUTO-SAVE: Import PersistenceService for immediate instance creation
import { PersistenceService } from './services/persistenceService';

// ⭐ J4.4: Use the key from guestDataUtils to ensure consistency with wipeGuestData()
const LLM_CONFIGS_KEY = GUEST_STORAGE_KEYS.LLM_CONFIGS;

interface EditingImageInfo {
  nodeId: string;
  sourceImage: string;
  mimeType: string;
}

// ⭐ CRITICAL FIX: ALL providers start disabled by default
// Only providers saved in the database (with API keys) will be enabled
// This prevents Gemini from always appearing when user hasn't configured it
const initialLLMConfigs: LLMConfig[] = [
  { provider: LLMProvider.Gemini, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.ImageGeneration]: true, [LLMCapability.ImageModification]: true, [LLMCapability.WebSearch]: true, [LLMCapability.URLAnalysis]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.VideoGeneration]: true, [LLMCapability.MapsGrounding]: true, [LLMCapability.WebSearchGrounding]: true } },
  { provider: LLMProvider.OpenAI, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.ImageGeneration]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
  { provider: LLMProvider.Mistral, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.Embedding]: true, [LLMCapability.OCR]: true } },
  { provider: LLMProvider.Anthropic, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
  { provider: LLMProvider.Grok, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
  { provider: LLMProvider.Perplexity, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.WebSearch]: true } },
  { provider: LLMProvider.Qwen, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
  { provider: LLMProvider.Kimi, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
  { provider: LLMProvider.DeepSeek, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.Reasoning]: true, [LLMCapability.CacheOptimization]: true } },
  { provider: LLMProvider.LMStudio, enabled: false, apiKey: 'http://localhost:3928', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.Embedding]: false, [LLMCapability.CodeSpecialization]: false } },
];

const loadLLMConfigs = (isAuthenticated: boolean = false, accessToken: string | null = null): LLMConfig[] => {
  try {
    // ⭐ J4.4 CRITICAL: Guest-only fallback
    // Authenticated users get configs from AuthContext.llmApiKeys (fetched at login)
    // This localStorage ONLY for guest mode
    
    if (isAuthenticated && accessToken) {
      // Authenticated mode: IGNORE localStorage, use llmApiKeys from AuthContext
      // Return defaults here, real configs merged via useEffect when llmApiKeys loads
      return initialLLMConfigs;
    }
    
    // Guest mode: Load from localStorage
    // ⭐ J4.5: Try new key first, then legacy key for backward compatibility
    let storedConfigsJSON = localStorage.getItem(LLM_CONFIGS_KEY);
    if (!storedConfigsJSON) {
      // Try legacy key
      storedConfigsJSON = localStorage.getItem(GUEST_STORAGE_KEYS.LLM_CONFIGS_LEGACY);
      if (storedConfigsJSON) {
        localStorage.setItem(LLM_CONFIGS_KEY, storedConfigsJSON);
      }
    }
    if (!storedConfigsJSON) {
      return initialLLMConfigs;
    }

    const storedConfigs = JSON.parse(storedConfigsJSON) as any[];
    const storedProviders = new Map(storedConfigs.map(c => [c.provider, c]));

    const syncedConfigs = initialLLMConfigs.map(initialConfig => {
      const storedConfig = storedProviders.get(initialConfig.provider);

      if (!storedConfig) {
        return initialConfig; // No user settings for this provider, use default.
      }

      // Sync capabilities
      const syncedCapabilities: { [key in LLMCapability]?: boolean } = {};
      for (const capKey in initialConfig.capabilities) {
        const cap = capKey as LLMCapability;
        if (storedConfig.capabilities && storedConfig.capabilities[cap] !== undefined) {
          syncedCapabilities[cap] = storedConfig.capabilities[cap];
        } else {
          syncedCapabilities[cap] = initialConfig.capabilities[cap];
        }
      }

      // ⭐ J4.4.3 FIX: Support both LLMConfig format (apiKey) and ILLMConfigUI format (apiKeyPlaintext)
      // llmConfigService stores as ILLMConfigUI with apiKeyPlaintext for guest mode
      // Legacy code stored as LLMConfig with apiKey
      const apiKey = storedConfig.apiKey || storedConfig.apiKeyPlaintext || '';

      // Merge
      return {
        ...initialConfig,
        enabled: storedConfig.enabled,
        apiKey: apiKey,
        capabilities: syncedCapabilities,
      };
    });

    return syncedConfigs;

  } catch (error) {
    console.error("Failed to load LLM configs from localStorage", error);
    return initialLLMConfigs;
  }
};


interface DeleteConfirmationState {
  agentId: string;
  agentName: string;
}

interface UpdateConfirmationState {
  agentData: Omit<Agent, 'id'>;
  agentId: string;
  count: number;
}

// ⭐ ÉTAPE 5: API URL for workspace hydration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Inner App component that uses Auth context
 * Must be wrapped by AuthProvider to access useAuth()
 */
function AppContent() {
  const { isAuthenticated, accessToken, llmApiKeys, user, logout } = useAuth();
  const [isSettingsModalOpen, setSettingsModalOpen] = useState(false);
  const [isAgentModalOpen, setAgentModalOpen] = useState(false);
  const [isLoginModalOpen, setLoginModalOpen] = useState(false);
  const [isRegisterModalOpen, setRegisterModalOpen] = useState(false);
  const [isImagePanelOpen, setImagePanelOpen] = useState(false);
  const [isImageModificationPanelOpen, setImageModificationPanelOpen] = useState(false);
  const [isVideoPanelOpen, setVideoPanelOpen] = useState(false);
  const [isMapsPanelOpen, setMapsPanelOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflowNodes, setWorkflowNodes] = useState<WorkflowNode[]>([]);
  // ⭐ J4.4: Start with defaults - will be reloaded on first auth change
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>(initialLLMConfigs);
  const [currentImageNodeId, setCurrentImageNodeId] = useState<string | null>(null);
  const [currentVideoNodeId, setCurrentVideoNodeId] = useState<string | null>(null);
  const [currentMapsNodeId, setCurrentMapsNodeId] = useState<string | null>(null);
  const [editingImageInfo, setEditingImageInfo] = useState<EditingImageInfo | null>(null);
  const [mapsPreloadedResults, setMapsPreloadedResults] = useState<{
    text: string;
    mapSources: any[];
    query?: string;
  } | null>(null);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<{ src: string; mimeType: string } | null>(null);
  const { t } = useLocalization();

  // ⭐ ÉTAPE 5: Hydration state for authenticated users
  const [isHydrating, setIsHydrating] = useState(false);
  const [hydrationProgress, setHydrationProgress] = useState(0);

  // ⭐ UX Polish: Hyperspace animation state for guests
  // Shows when: first load as guest OR after logout
  const [showHyperspace, setShowHyperspace] = useState(!isAuthenticated);
  const [hyperspaceActive, setHyperspaceActive] = useState(false);
  const wasAuthenticatedRef = React.useRef(isAuthenticated);
  
  // ⭐ J4.4.3: Ref to track previous llmApiKeys to prevent infinite loops
  const prevApiKeysRef = React.useRef<string>('');

  // ⭐ UX: Trigger hyperspace on logout (auth → guest transition)
  useEffect(() => {
    const wasAuth = wasAuthenticatedRef.current;
    wasAuthenticatedRef.current = isAuthenticated;

    // Transition: authenticated → guest (logout)
    if (wasAuth && !isAuthenticated) {
      setShowHyperspace(true);
      setHyperspaceActive(false); // Reset to idle
    }
  }, [isAuthenticated]);

  // ⭐ UX: Auto-trigger warp after short delay when hyperspace is shown
  useEffect(() => {
    if (showHyperspace && !hyperspaceActive) {
      const timer = setTimeout(() => {
        setHyperspaceActive(true);
      }, 1500); // 1.5s idle phase before warp
      return () => clearTimeout(timer);
    }
  }, [showHyperspace, hyperspaceActive]);

  // ⭐ UX: Handle hyperspace animation complete
  const handleHyperspaceComplete = useCallback(() => {
    // Small delay to ensure smooth transition
    setTimeout(() => {
      setShowHyperspace(false);
      setHyperspaceActive(false);
    }, 100);
  }, []);

  // Runtime Store access
  const { updateLLMConfigs, setNavigationHandler, addNodeMessage } = useRuntimeStore();

  // Design Store access for integrity validation  
  const { validateWorkflowIntegrity, cleanupOrphanedInstances, addAgentInstance, deleteNode, deleteAgentInstance, hydrateFromServer, setNodes, setEdges, updateInstanceId, addNode, agentInstances, nodes: storeNodes } = useDesignStore();
  
  // ⭐ SELF-HEALING: Workflow Store for hydrating workflow ID
  const { hydrateWorkflowFromServer, getCurrentWorkflowId } = useWorkflowStore();

  /**
   * ⭐ ÉTAPE 5: Hydration for authenticated users
   * Fetches workspace data from GET /api/user/workspace and populates stores
   */
  useEffect(() => {
    const hydrateWorkspace = async () => {
      if (!isAuthenticated || !accessToken) {
        setIsHydrating(false);
        return;
      }

      setIsHydrating(true);
      setHydrationProgress(10);

      try {
        console.log('[App] Starting workspace hydration...');
        setHydrationProgress(30);

        const response = await fetch(`${API_BASE_URL}/api/user/workspace`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        setHydrationProgress(60);

        if (!response.ok) {
          throw new Error(`Hydration failed: ${response.status}`);
        }

        const workspace = await response.json();
        setHydrationProgress(80);

        // ⭐ SELF-HEALING: Hydrate workflow with REAL MongoDB ID from server
        // This is CRITICAL for persistence to work correctly
        if (workspace.workflow) {
          hydrateWorkflowFromServer({
            id: workspace.workflow.id,  // ⭐ Real MongoDB ObjectId
            name: workspace.workflow.name,
            description: workspace.workflow.description,
            isDefault: workspace.workflow.isDefault,
            isActive: workspace.workflow.isActive,
            canvasState: workspace.workflow.canvasState
          });
          
          console.log('[App] ⭐ Workflow hydrated with ID:', workspace.workflow.id, {
            wasCreated: workspace.metadata?.workflowWasCreated,
            isDefault: workspace.workflow.isDefault
          });
        } else {
          console.warn('[App] ⚠️ No workflow in server response - Self-Healing may have failed');
        }

        // ⭐ FIX: Hydrater les prototypes d'agents dans le state React et le store Zustand
        if (workspace.agentPrototypes && workspace.agentPrototypes.length > 0) {
          const now = new Date().toISOString();
          const hydratedPrototypes: Agent[] = workspace.agentPrototypes.map((proto: any) => ({
            id: proto.id,
            name: proto.name,
            role: proto.description || 'assistant',
            systemPrompt: proto.description || '',
            llmProvider: (proto.provider as LLMProvider) || LLMProvider.Gemini,
            model: proto.model || 'gemini-2.0-flash',
            capabilities: [],
            tools: [],
            creator_id: RobotId.Archi,
            created_at: now,
            updated_at: now
          }));
          
          // Hydrater le state React (legacy)
          setAgents(hydratedPrototypes);
          
          // Hydrater le store Zustand
          hydrateFromServer({
            agents: hydratedPrototypes
          });
          
          console.log('[App] ✅ Agent prototypes hydrated:', hydratedPrototypes.length);
        }

        // ⭐ CRITICAL: Build V2WorkflowNodes from instances and hydrate to store
        // This ensures nodes are properly linked to instances for WorkflowCanvas resolution
        if (workspace.agentInstances && workspace.agentInstances.length > 0) {
          // First pass: transform all instances to frontend format
          const hydratedInstances: AgentInstance[] = [];
          
          const v2Nodes: V2WorkflowNode[] = workspace.agentInstances.map((instance: any) => {
            // Find the agent prototype for this instance
            const agentProto = workspace.agentPrototypes?.find((proto: any) => proto.id === instance.prototypeId);
            
            // ⭐ FIX: Build Agent object from instance data if prototype not found
            // This ensures V2AgentNode always has an agent prop
            const agent: Agent = agentProto ? {
              id: agentProto.id,
              name: agentProto.name,
              role: agentProto.description || 'assistant',
              systemPrompt: instance.systemInstruction || agentProto.description || '',
              llmProvider: (agentProto.provider as LLMProvider) || LLMProvider.Gemini,
              model: agentProto.model || 'gemini-2.0-flash',
              capabilities: [],
              tools: [],
              creator_id: RobotId.Archi,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            } : {
              // Fallback: build agent from instance data
              id: instance.prototypeId || instance.id,
              name: instance.name,
              role: 'assistant',
              systemPrompt: instance.systemInstruction || '',
              llmProvider: (instance.provider as LLMProvider) || LLMProvider.Gemini,
              model: instance.model || 'gemini-2.0-flash',
              capabilities: [],
              tools: [],
              creator_id: RobotId.Archi,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            
            // ⭐ FIX: Ensure instance has all required properties with correct structure
            const hydratedInstance: AgentInstance = {
              id: instance.id, // Real MongoDB ObjectId from backend
              prototypeId: instance.prototypeId || agent.id,
              name: instance.name,
              position: instance.position || { x: 0, y: 0 },
              isMinimized: false,
              isMaximized: false,
              workflowId: instance.workflowId || workspace.workflow?.id, // ⭐ CRITICAL: Pass workflowId for journal persistence
              configuration_json: {
                role: agent.role,
                model: agent.model,
                llmProvider: agent.llmProvider,
                systemPrompt: agent.systemPrompt,
                tools: agent.tools || [],
                position: instance.position || { x: 0, y: 0 }
              }
            };
            
            // Collect hydrated instances for store
            hydratedInstances.push(hydratedInstance);
            
            return {
              id: `node-${instance.id}`, // Generate consistent V2 node ID
              type: 'agent',
              position: instance.position || { x: 0, y: 0 },
              data: {
                robotId: RobotId.Archi, // Agents are created by Archi
                label: instance.name,
                agent, // ⭐ FIX: Now includes the agent prototype
                agentInstance: hydratedInstance, // ⭐ FIX: Properly structured instance
                workflowId: workspace.workflow?.id, // ⭐ FIX: Pass workflowId for journal
                isMinimized: false,
                isMaximized: false
              }
            };
          });
          
          // ⭐ FIX: Hydrate store with properly formatted instances AFTER transformation
          hydrateFromServer({
            agentInstances: hydratedInstances
          });
          
          setNodes(v2Nodes);
          console.log('[App] ✅ V2WorkflowNodes hydrated from instances:', v2Nodes.length, 
            'with workflowId:', workspace.workflow?.id,
            'instances:', hydratedInstances.map(i => ({ id: i.id, workflowId: i.workflowId })));
        } else {
          // Fall back to storing backend nodes if available
          if (workspace.nodes) {
            setNodes(workspace.nodes);
          }
        }

        if (workspace.edges) {
          setEdges(workspace.edges);
        }

        // Convert instances to WorkflowNode format for legacy React state
        if (workspace.agentInstances && workspace.agentInstances.length > 0) {
          const now = new Date().toISOString();
          const hydrationNodes: WorkflowNode[] = workspace.agentInstances.map((instance: any) => ({
            id: instance.id,
            agent: {
              id: instance.id,
              name: instance.name,
              role: instance.systemInstruction || 'assistant',
              systemPrompt: instance.systemInstruction || '',
              llmProvider: (instance.provider as LLMProvider) || LLMProvider.Gemini,
              model: instance.model || 'gemini-2.0-flash',
              capabilities: [],
              tools: [],
              historyConfig: { enabled: false, llmProvider: LLMProvider.Gemini, model: '', role: '', systemPrompt: '', limits: { char: 0, word: 0, token: 0, sentence: 0, message: 50 } },
              creator_id: RobotId.Archi,
              created_at: instance.createdAt || now,
              updated_at: now
            } as Agent,
            position: instance.position || { x: 0, y: 0 },
            messages: instance.content?.filter((c: any) => c.type === 'chat').map((c: any) => ({
              id: c.id || `msg-${Date.now()}`,
              sender: c.role || 'agent',
              text: c.message || ''
            })) || [],
            isMinimized: false,
            isMaximized: false,
            instanceId: instance.id
          }));
          setWorkflowNodes(hydrationNodes);
        }

        setHydrationProgress(100);
        console.log('[App] Workspace hydration complete:', {
          workflowId: workspace.workflow?.id,
          nodes: workspace.nodes?.length || 0,
          instances: workspace.agentInstances?.length || 0
        });

        // ⭐ NEW: Load persisted journals for each agent instance (lazy-load)
        if (workspace.agentInstances && workspace.agentInstances.length > 0 && workspace.workflow?.id) {
          console.log('[App] Loading persisted journals for instances...');
          try {
            for (const instance of workspace.agentInstances) {
              const journalsResponse = await fetch(
                `${API_BASE_URL}/api/workflows/${workspace.workflow.id}/instances/${instance.id}/journals`,
                {
                  headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                  }
                }
              );

              if (!journalsResponse.ok) {
                console.warn(`[App] Failed to load journals for instance ${instance.id}`);
                continue;
              }

              const journalsData = await journalsResponse.json();
              // ⭐ FIX: Le contrôleur retourne { data: [...], meta: {...} }, pas { journals: [...] }
              const journals = journalsData.data || journalsData.journals || [];

              if (journals.length > 0) {
                // Convert journals to ChatMessages
                const chatMessages: ChatMessage[] = journals
                  .filter((j: any) => j.type === 'chat') // Only chat type for now
                  .map((j: any) => {
                    const payload = j.payload || {}; // ⭐ FIX: Read from 'payload' not 'content'
                    const role = payload.role || 'agent';
                    const content = payload.content || '';
                    
                    return {
                      id: j._id || `journal-${j.timestamp}`,
                      sender: role === 'user' ? 'user' :
                             role === 'agent' ? 'agent' :
                             role === 'tool' ? 'tool' :
                             role === 'tool_result' ? 'tool_result' : 'agent',
                      text: content,
                      timestamp: new Date(j.createdAt || j.timestamp).getTime()
                    } as ChatMessage;
                  });

                console.log(`[App] Raw journals:`, journals.slice(0, 2)); // Log first 2 for debugging
                console.log(`[App] Converted messages:`, chatMessages.slice(0, 2));

                // Load messages into runtime store using the node ID
                const nodeId = `node-${instance.id}`; // Use same format as V2WorkflowNode
                const { setNodeMessages } = useRuntimeStore.getState();
                setNodeMessages(nodeId, chatMessages);

                console.log(`[App] Loaded ${chatMessages.length} messages for instance ${nodeId}`);
              }
            }
          } catch (error) {
            console.error('[App] Error loading journals:', error);
            // Don't fail hydration if journal loading fails
          }
        }

      } catch (err) {
        console.error('[App] Workspace hydration error:', err);
      } finally {
        // Small delay to show 100% before hiding
        setTimeout(() => {
          setIsHydrating(false);
          setHydrationProgress(0);
        }, 500);
      }
    };

    hydrateWorkspace();
  }, [isAuthenticated, accessToken, hydrateFromServer, setNodes, setEdges, hydrateWorkflowFromServer]);

  /**
   * ⭐ CRITICAL J4.4: Reload LLM configs + WIPE STATE when auth state changes
   * Prevents guest and authenticated sessions from contaminating each other
   * 
   * When user logs in/out or changes auth status:
   * 1. Guest → Auth: configs cleared, defaults set, then real configs via llmApiKeys
   * 2. Auth → Guest: configs cleared, guest configs from localStorage
   * 3. Guest → Guest (new session): configs cleared
   * 
   * ⚠️ SECURITY: ALWAYS reload from scratch on auth change
   * ⚠️ CRITICAL FIX: workflowNodes is React state NOT in Zustand stores
   *    Must be explicitly cleared here to prevent agent leaks on canvas
   * ⚠️ CRITICAL FIX J4.4.2: agents is ALSO React state NOT in Zustand
   *    Must be cleared to prevent prototype leaks in sidebar/navigation
   */
  useEffect(() => {
    // Reload LLM configs respecting new auth state
    const freshConfigs = loadLLMConfigs(isAuthenticated, accessToken);
    setLlmConfigs(freshConfigs);
    updateLLMConfigs(freshConfigs);
    
    // ⭐ CRITICAL J4.4: Clear React state on auth change to prevent data leaks
    setWorkflowNodes([]);
    setAgents([]);
    
    // ⭐ FIX: Reset prevApiKeysRef on auth change to allow fresh hydration
    // Bug: After logout/login, same configs would be skipped due to hash match
    prevApiKeysRef.current = '';
    console.log('[App] 🔄 Auth state changed - reset prevApiKeysRef for fresh hydration');
  }, [isAuthenticated, accessToken, updateLLMConfigs]);

  /**
   * ⭐ J4.4.3 FIX: Sync LLM configs from AuthContext's llmApiKeys for authenticated users
   * 
   * Root Cause: The previous fix used useLLMConfigs() which returns ILLMConfigUI[]
   * without the actual apiKey. AuthContext.llmApiKeys contains the decrypted keys
   * from the backend endpoint /api/llm/get-all-api-keys.
   * 
   * Architecture:
   * - Guest mode: loadLLMConfigs() reads from localStorage (LLMConfig[] format)
   * - Auth mode: llmApiKeys from AuthContext (fetched at login with decrypted keys)
   * 
   * This effect runs AFTER auth change effect, merging real API keys with defaults.
   */
  useEffect(() => {
    // ⭐ CRITICAL: Wait for llmApiKeys to be loaded (not null/undefined)
    // When isAuthenticated but llmApiKeys is null, it means AuthContext is still fetching
    if (!isAuthenticated) {
      return; // Not authenticated, nothing to do
    }
    
    if (llmApiKeys === null || llmApiKeys === undefined) {
      return; // Still loading, wait for next trigger
    }

    console.log('[App] 🔍 useEffect triggered with llmApiKeys:', llmApiKeys.length, 'keys:', llmApiKeys.map(k => k.provider));

    // ⭐ FIX: Prevent infinite loop by checking content equality
    // Must be done BEFORE any state updates
    const keysHash = JSON.stringify(llmApiKeys);
    if (keysHash === prevApiKeysRef.current) {
      console.log('[App] 🔍 Hash unchanged, skipping');
      return;
    }
    prevApiKeysRef.current = keysHash;

    // ⭐ FIX: If llmApiKeys is empty array, user has no configs in DB
    // Set all providers to disabled (initialLLMConfigs with enabled:false)
    if (llmApiKeys.length === 0) {
      console.log('[App] 🔍 No API keys in database - setting all providers to disabled');
      setLlmConfigs(initialLLMConfigs); // All disabled by default now
      updateLLMConfigs(initialLLMConfigs);
      return;
    }
    
    // Convert LLMApiKey[] to LLMConfig[]
    const apiConfigs: LLMConfig[] = llmApiKeys.map(key => ({
      provider: key.provider as LLMProvider,
      apiKey: key.apiKey,
      enabled: key.enabled,
      capabilities: (key.capabilities || {}) as { [k in LLMCapability]?: boolean }
    }));
    
    console.log('[App] 🔍 Converted to apiConfigs:', apiConfigs.length);
    
    // Merge with initial configs to keep capabilities defaults for providers not in API
    const mergedConfigs = initialLLMConfigs.map(initial => {
      const apiConfig = apiConfigs.find(c => c.provider === initial.provider);
      if (apiConfig) {
        return {
          ...initial,
          ...apiConfig,
          capabilities: { ...initial.capabilities, ...apiConfig.capabilities }
        };
      }
      return initial;
    });
    
    console.log('[App] 🔍 After merge, llmConfigs will have:', mergedConfigs.filter(c => c.enabled).length, 'enabled providers');
    
    const enabledProviders = mergedConfigs.filter(c => c.enabled).map(c => c.provider);
    console.log('[App] 🔍 enabledProviders:', enabledProviders);
    
    setLlmConfigs(mergedConfigs);
    console.log('[App] 🔍 setLlmConfigs called, should be in state now');
    updateLLMConfigs(mergedConfigs);
    console.log('[App] 🔍 updateLLMConfigs called for Zustand store');
  }, [isAuthenticated, llmApiKeys, updateLLMConfigs]);

  // Configure navigation handler for agent nodes
  useEffect(() => {
    setNavigationHandler(handleRobotNavigation);
  }, [setNavigationHandler]);

  // PHASE 1B: Integrity validation on app startup + Migration legacy nodes
  useEffect(() => {
    // Clean up any orphaned instances first
    const cleanedCount = cleanupOrphanedInstances();

    // Then validate workflow integrity
    const { fixedCount } = validateWorkflowIntegrity();

    // 🆕 Migration: Créer des instances pour les nodes legacy sans instanceId
    let migratedCount = 0;
    const currentWorkflowId = getCurrentWorkflowId(); // ⭐ Get current workflow ID for migration
    const updatedNodes = workflowNodes.map(node => {
      if (!node.instanceId && node.agent) {
        // Créer une instance pour ce node legacy - pass workflowId
        const instanceId = addAgentInstance(node.agent.id, node.position, node.agent.name, currentWorkflowId || undefined);
        migratedCount++;
        return { ...node, instanceId };
      }
      return node;
    });

    if (migratedCount > 0) {
      setWorkflowNodes(updatedNodes);
      console.log(`🔄 Migrated ${migratedCount} legacy nodes to instance architecture`);
    }

    if (cleanedCount > 0 || fixedCount > 0) {
      console.log(`🚀 App startup integrity check completed: cleaned ${cleanedCount} instances, fixed ${fixedCount} nodes`);
    }
  }, []); // Run only once on mount

  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmationState | null>(null);
  const [updateConfirmation, setUpdateConfirmation] = useState<UpdateConfirmationState | null>(null);

  // Robot Navigation State
  const [currentPath, setCurrentPath] = useState('/bos/dashboard');

  const handleRobotNavigation = (robotId: RobotId, path: string) => {
    setCurrentPath(path);
    // TODO: Implement proper routing logic
    console.log(`Navigating to robot ${robotId} at path ${path}`);
  };

  const handleSaveAgent = async (agentData: Omit<Agent, 'id'>, agentId?: string) => {
    try {
      if (agentId) {
        // Update existing agent
        // TODO: Implement API call to update agent
        console.log('Updating agent:', agentId, agentData);
      } else {
        // Create new agent
        // TODO: Implement API call to create agent
        console.log('Creating new agent:', agentData);
      }
      // Close the modal
      setAgentModalOpen(false);
      setEditingAgent(null);
    } catch (error) {
      console.error('Error saving agent:', error);
    }
  };

  const handleSaveSettings = async (newLLMConfigs: LLMConfig[]) => {
    try {
      const lmStudioConfig = newLLMConfigs.find(c => c.provider === LLMProvider.LMStudio);

      // Get appropriate storage based on auth state
      const storage = getSettingsStorage({
        isAuthenticated,
        accessToken,
        user: null,
        login: async () => { },
        register: async () => { },
        logout: () => { },
        refreshToken: async () => { },
        llmApiKeys: null,
        isLoading: false,
        error: null
      });

      // NOTE J4.4: LLMConfigs are now managed separately via useLLMConfigs hook
      // We only save PREFERENCES here (language, theme)
      // LLMConfigs should be saved via LLMConfigModal -> useLLMConfigs -> updateConfig()
      
      // Save preferences only
      await storage.saveSettings({
        preferences: { language: 'fr' }
      });
      
      if (!isAuthenticated) {
        // ⭐ Guest mode: reload from localStorage
        const freshConfigs = loadLLMConfigs(false, null);
        setLlmConfigs(freshConfigs);
        updateLLMConfigs(freshConfigs);
      } else {
        // ⭐ FIX: For authenticated users, use the configs directly from modal
        // refreshLLMApiKeys() was already called in SettingsModal before onSave()
        // The newLLMConfigs reflect what was just saved to the database
        // We also reset the hash so the useEffect will sync on next llmApiKeys update
        console.log('[App] handleSaveSettings - applying', newLLMConfigs.filter(c => c.enabled).length, 'enabled configs');
        setLlmConfigs(newLLMConfigs);
        updateLLMConfigs(newLLMConfigs);
        prevApiKeysRef.current = ''; // Reset for next llmApiKeys sync
      }
    } catch (error) {
      console.error('[App] handleSaveSettings error:', error);
    }
  };

  const handleUpdateConfirmation = (updateInstances: boolean) => {
    if (updateConfirmation) {
      const { agentData, agentId } = updateConfirmation;
      const updatedAgent = { ...agentData, id: agentId };

      // Update the prototype agent
      setAgents(prev => prev.map(a => a.id === agentId ? updatedAgent : a));

      if (updateInstances) {
        setWorkflowNodes(prev => prev.map(node =>
          node.agent.id === agentId
            ? { ...node, agent: updatedAgent }
            : node
        ));
      }
    }
    setUpdateConfirmation(null);
  };

  const handleDeleteAgent = (agentId: string) => {
    const agentToDelete = agents.find(agent => agent.id === agentId);
    if (agentToDelete) {
      setDeleteConfirmation({ agentId, agentName: agentToDelete.name });
    }
  };

  const confirmDeleteAgent = () => {
    if (deleteConfirmation) {
      const { agentId } = deleteConfirmation;
      // ⭐ FIX: Close modal IMMEDIATELY before performing deletion to prevent double-click
      // This prevents event bubbling from re-triggering the delete button
      setDeleteConfirmation(null);
      
      // Then perform the actual deletion
      setAgents(prev => prev.filter(agent => agent.id !== agentId));
      setWorkflowNodes(prev => prev.filter(node => node.agent.id !== agentId));
    }
  };

  const handleOpenEditAgentModal = (agent: Agent) => {
    setEditingAgent(agent);
    setAgentModalOpen(true);
  };

  /**
   * ⭐ AUTO-SAVE: Add agent to workflow with immediate API persistence
   * 
   * Per Dev_rules.md: Agent instances are ALWAYS auto-saved (independent of workflow save mode)
   * This ensures the agent_instances collection is populated immediately on creation.
   */
  const addAgentToWorkflow = useCallback(async (agent: Agent) => {
    // Calculate position based on existing instances
    const position = {
      x: (workflowNodes.length % 4) * 420 + 20,
      y: Math.floor(workflowNodes.length / 4) * 540 + 20,
    };

    // Use instanceName if provided, otherwise use agent name
    const instanceName = agent.instanceName || agent.name;

    // ⭐ Get workflowId BEFORE creating instance
    const workflowId = getCurrentWorkflowId();

    // Add agent instance to DesignStore with custom instance name and workflowId
    const instanceId = addAgentInstance(agent.id, position, instanceName, workflowId || undefined);

    // ⭐ AUTO-SAVE: Immediately persist to backend (if authenticated)
    if (isAuthenticated && accessToken && workflowId) {
      console.log('[App] 📤 Auto-saving new agent instance to backend:', {
        instanceId,
        prototypeId: agent.id,
        workflowId
      });
      
      const result = await PersistenceService.createAgentInstance(
        {
          id: instanceId,
          prototypeId: agent.id,
          name: instanceName,
          position,
          configuration_json: {
            role: agent.role,
            model: agent.model,
            llmProvider: agent.llmProvider,
            systemPrompt: agent.systemPrompt,
            tools: agent.tools || [],
            outputConfig: agent.outputConfig
          },
          // ⭐ Pass persistenceConfig override if provided from WorkflowValidationModal
          persistenceConfig: agent.persistenceConfig
        },
        workflowId,
        { isAuthenticated, accessToken }
      );
      
      // ⭐ FIX: Utiliser le backendId comme ID final, sinon le tempId
      let finalInstanceId = instanceId;
      
      if (result.success) {
        console.log('[App] ✅ Agent instance persisted to DB:', result.backendId);
        // ⭐ CRITICAL FIX: Update instance ID in store with backend-generated ID
        if (result.backendId && result.backendId !== instanceId) {
          console.log('[App] Updating instance ID:', {
            tempId: instanceId,
            backendId: result.backendId
          });
          updateInstanceId(instanceId, result.backendId);
          finalInstanceId = result.backendId; // ⭐ Utiliser le vrai ID backend
        }
      } else {
        console.error('[App] ❌ Failed to persist agent instance:', result.error);
        // Don't block UI - instance exists locally, will sync later
      }
      
      // ⭐ CRITICAL: Create V2WorkflowNode in Zustand store AFTER ID resolution
      // ⭐ FIX: Utiliser getState() pour obtenir la valeur actuelle du store (pas la closure stale)
      const currentAgentInstances = useDesignStore.getState().agentInstances;
      const updatedInstance = currentAgentInstances.find(inst => 
        inst.id === finalInstanceId || inst.id === instanceId
      );
      
      if (updatedInstance) {
        // ⭐ FIX: Ensure workflowId is set on the instance
        const instanceWithWorkflowId: AgentInstance = {
          ...updatedInstance,
          id: finalInstanceId, // ⭐ Forcer l'utilisation de l'ID final
          workflowId: updatedInstance.workflowId || workflowId
        };
        
        addNode({
          type: 'agent',
          position,
          data: {
            robotId: RobotId.Archi,
            label: instanceName,
            agent,
            agentInstance: instanceWithWorkflowId,
            workflowId,
            isMinimized: false,
            isMaximized: false
          }
        });
        console.log('[App] ✅ V2WorkflowNode added with final instance ID:', finalInstanceId);
      } else {
        console.warn('[App] ⚠️ Instance not found after creation, creating node anyway');
        // Créer le node avec les données disponibles
        addNode({
          type: 'agent',
          position,
          data: {
            robotId: RobotId.Archi,
            label: instanceName,
            agent,
            agentInstance: {
              id: finalInstanceId,
              prototypeId: agent.id,
              name: instanceName,
              position,
              isMinimized: false,
              isMaximized: false,
              workflowId,
              configuration_json: null
            },
            workflowId,
            isMinimized: false,
            isMaximized: false
          }
        });
      }
      
      // Legacy: Also add to local state with the final ID
      const newNode: WorkflowNode = {
        id: `node-${Date.now()}`,
        agent,
        position,
        messages: [],
        isMinimized: false,
        isMaximized: false,
        instanceId: finalInstanceId // ⭐ Utiliser l'ID final
      };
      setWorkflowNodes(prev => [...prev, newNode]);
    } else {
      console.log('[App] Guest mode - agent instance saved to localStorage via store');
      
      // Guest mode: créer le node avec l'ID local
      // ⭐ FIX: Utiliser getState() pour obtenir la valeur actuelle du store
      const guestAgentInstances = useDesignStore.getState().agentInstances;
      const localInstance = guestAgentInstances.find(inst => inst.id === instanceId);
      if (localInstance) {
        addNode({
          type: 'agent',
          position,
          data: {
            robotId: RobotId.Archi,
            label: instanceName,
            agent,
            agentInstance: { ...localInstance, workflowId: localInstance.workflowId || 'guest-workflow' },
            workflowId: 'guest-workflow',
            isMinimized: false,
            isMaximized: false
          }
        });
      }
      
      // Legacy state
      const newNode: WorkflowNode = {
        id: `node-${Date.now()}`,
        agent,
        position,
        messages: [],
        isMinimized: false,
        isMaximized: false,
        instanceId
      };
      setWorkflowNodes(prev => [...prev, newNode]);
    }
  }, [workflowNodes, addAgentInstance, isAuthenticated, accessToken, getCurrentWorkflowId, updateInstanceId, addNode, agentInstances]);

  /**
   * ⭐ FIX: Suppression robuste d'un node avec persistance backend
   * Gère les deux formats d'ID (legacy et V2)
   */
  const handleDeleteNode = useCallback(async (nodeId: string) => {
    console.log('[App] handleDeleteNode called with:', nodeId);
    
    // 1. Trouver le node dans le state legacy pour obtenir l'instanceId
    const legacyNode = workflowNodes.find(node => node.id === nodeId);
    const instanceId = legacyNode?.instanceId;
    
    // 2. Trouver le node V2 dans le store (format: node-{instanceId})
    const v2NodeId = instanceId ? `node-${instanceId}` : nodeId;
    const v2Node = storeNodes.find(node => node.id === v2NodeId || node.id === nodeId);
    const v2InstanceId = v2Node?.data?.agentInstance?.id;
    
    // Déterminer l'ID d'instance final
    const finalInstanceId = instanceId || v2InstanceId;
    
    console.log('[App] Delete node resolution:', { 
      nodeId, 
      legacyInstanceId: instanceId, 
      v2NodeId, 
      v2InstanceId,
      finalInstanceId 
    });
    
    // 3. Supprimer du state legacy
    setWorkflowNodes(prev => prev.filter(node => node.id !== nodeId));
    
    // 4. Supprimer du store Zustand (essayer les deux formats d'ID)
    deleteNode(nodeId);
    deleteNode(v2NodeId);
    
    // 5. Supprimer l'instance du store si trouvée
    if (finalInstanceId) {
      deleteAgentInstance(finalInstanceId);
      
      // 6. ⭐ CRITICAL: Persister la suppression au backend
      if (isAuthenticated && accessToken) {
        const workflowId = getCurrentWorkflowId();
        if (workflowId) {
          try {
            const backendUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
            const response = await fetch(`${backendUrl}/api/workflows/${workflowId}/instances/${finalInstanceId}`, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              }
            });
            
            if (response.ok) {
              console.log('[App] ✅ Agent instance deleted from backend:', finalInstanceId);
            } else {
              console.warn('[App] ⚠️ Backend delete failed:', response.status);
            }
          } catch (error) {
            console.error('[App] ❌ Error deleting instance from backend:', error);
          }
        }
      }
    }
  }, [workflowNodes, storeNodes, deleteNode, deleteAgentInstance, isAuthenticated, accessToken, getCurrentWorkflowId]);

  const handleDeleteNodes = useCallback(async (instanceIds: string[]) => {
    // Batch delete multiple nodes by instanceId (used when deleting prototype with instances)
    console.log('[App] handleDeleteNodes called with:', instanceIds);
    
    // 1. Supprimer du state legacy
    setWorkflowNodes(prev => prev.filter(node => !node.instanceId || !instanceIds.includes(node.instanceId)));
    
    // 2. Supprimer du store et backend pour chaque instance
    for (const instanceId of instanceIds) {
      // Supprimer du store
      deleteNode(`node-${instanceId}`);
      deleteAgentInstance(instanceId);
      
      // Persister au backend
      if (isAuthenticated && accessToken) {
        const workflowId = getCurrentWorkflowId();
        if (workflowId) {
          try {
            const backendUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
            await fetch(`${backendUrl}/api/workflows/${workflowId}/instances/${instanceId}`, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              }
            });
          } catch (error) {
            console.error('[App] Error deleting instance:', instanceId, error);
          }
        }
      }
    }
  }, [deleteNode, deleteAgentInstance, isAuthenticated, accessToken, getCurrentWorkflowId]);

  const handleUpdateNodePosition = (nodeId: string, position: { x: number; y: number }) => {
    setWorkflowNodes(prev =>
      prev.map(node => (node.id === nodeId ? { ...node, position } : node))
    );
  };

  const handleToggleNodeMaximize = (nodeId: string) => {
    setWorkflowNodes(prev =>
      prev.map(node => {
        // Si c'est le node ciblé, inverser son état isMaximized
        if (node.id === nodeId) {
          return { ...node, isMaximized: !node.isMaximized };
        }
        // Forcer tous les autres nodes à isMaximized: false (un seul à la fois)
        return { ...node, isMaximized: false };
      })
    );
  };

  const handleOpenImagePanel = (nodeId: string) => {
    setCurrentImageNodeId(nodeId);
    setImagePanelOpen(true);
  };

  const handleImageGenerated = (nodeId: string, imageBase64: string) => {
    const imageMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'agent',
      text: t('app_generatedImageText'),
      image: imageBase64,
      mimeType: 'image/png',
    };
    handleUpdateNodeMessages(nodeId, prev => [...prev, imageMessage]);
    addNodeMessage(nodeId, imageMessage);
  };

  const handleOpenImageModificationPanel = (nodeId: string, sourceImage: string, mimeType: string = 'image/png') => {
    setEditingImageInfo({ nodeId, sourceImage, mimeType });
    setImageModificationPanelOpen(true);
  };

  const handleOpenVideoPanel = (nodeId: string) => {
    setCurrentVideoNodeId(nodeId);
    setVideoPanelOpen(true);
  };

  const handleOpenMapsPanel = (nodeId: string, preloadedResults?: { text: string; mapSources: any[]; query?: string }) => {
    setCurrentMapsNodeId(nodeId);
    setMapsPreloadedResults(preloadedResults || null);
    setMapsPanelOpen(true);
  };

  const handleImageModified = (nodeId: string, newImage: string, text: string) => {
    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'agent',
      text: text,
      image: newImage,
      mimeType: 'image/png',
    };
    handleUpdateNodeMessages(nodeId, prev => [...prev, message]);
    addNodeMessage(nodeId, message);
  };

  const handleToggleNodeMinimize = (nodeId: string) => {
    setWorkflowNodes(prev => prev.map(node =>
      node.id === nodeId ? { ...node, isMinimized: !node.isMinimized } : node
    ));
    // Note: Le centrage sera géré par WorkflowCanvas via centerNodeRef
  };

  const handleUpdateNodeMessages = (nodeId: string, messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setWorkflowNodes(prev => prev.map(node =>
      node.id === nodeId
        ? { ...node, messages: typeof messages === 'function' ? messages(node.messages) : messages }
        : node
    ));
  };

  const handleOpenFullscreen = (src: string, mimeType: string) => {
    setFullscreenImage({ src, mimeType });
  };

  const handleOpenAgentFullscreen = (nodeId: string) => {
    // Utiliser le store runtime pour ouvrir le FullscreenChatModal existant
    const { setFullscreenChatNodeId } = useRuntimeStore.getState();
    setFullscreenChatNodeId(nodeId);
  };

  const handleAddToWorkflow = (agent: Agent) => {
    addAgentToWorkflow(agent);
  };

  return (
    <QueryProvider>
      <NotificationProvider>
        {/* ⭐ UX Polish: Hyperspace Entry Animation for Guests */}
        {showHyperspace && !isAuthenticated && (
          <HyperspaceReveal
            isActive={hyperspaceActive}
            onComplete={handleHyperspaceComplete}
            className="fixed inset-0 z-[100]"
          >
            {/* Empty children - the app will be revealed underneath */}
            <div className="w-full h-full" />
          </HyperspaceReveal>
        )}

        {/* ⭐ ÉTAPE 5: Hydration Overlay - Blur Racing Style (for authenticated users) */}
        <HydrationOverlay 
          isLoading={isHydrating} 
          progress={hydrationProgress}
          message="Chargement de votre workspace..."
        />
        
        <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans">
          <Header
            onOpenSettings={() => setSettingsModalOpen(true)}
          />
          <div className="flex flex-1 overflow-hidden">
            <NavigationLayout
              agents={agents}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!isSidebarCollapsed)}
              onAddAgent={() => { setEditingAgent(null); setAgentModalOpen(true); }}
              onAddToWorkflow={addAgentToWorkflow}
              onDeleteAgent={handleDeleteAgent}
              onEditAgent={handleOpenEditAgentModal}
              currentPath={currentPath}
              onNavigate={handleRobotNavigation}
            />
            <main className="flex-1 bg-gray-800/50 overflow-hidden">
              <RobotPageRouter
                currentPath={currentPath}
                llmConfigs={llmConfigs}
                onNavigate={handleRobotNavigation}
                agents={agents}
                workflowNodes={workflowNodes}
                onDeleteNode={handleDeleteNode}
                onDeleteNodes={handleDeleteNodes}
                onUpdateNodeMessages={handleUpdateNodeMessages}
                onUpdateNodePosition={handleUpdateNodePosition}
                onToggleNodeMinimize={handleToggleNodeMinimize}
                onToggleNodeMaximize={handleToggleNodeMaximize}
                onOpenImagePanel={handleOpenImagePanel}
                onOpenImageModificationPanel={handleOpenImageModificationPanel}
                onOpenVideoPanel={handleOpenVideoPanel}
                onOpenMapsPanel={handleOpenMapsPanel}
                onOpenFullscreen={handleOpenFullscreen}
                onOpenAgentFullscreen={handleOpenAgentFullscreen}
                onAddToWorkflow={handleAddToWorkflow}
                isImagePanelOpen={isImagePanelOpen}
                isImageModificationPanelOpen={isImageModificationPanelOpen}
                isVideoPanelOpen={isVideoPanelOpen}
                isMapsPanelOpen={isMapsPanelOpen}
              />
            </main>
          </div>

          {isSettingsModalOpen && (
            <SettingsModal
              llmConfigs={llmConfigs}
              onClose={() => setSettingsModalOpen(false)}
              onSave={handleSaveSettings}
            />
          )}

          {isLoginModalOpen && (
            <LoginModal
              isOpen={isLoginModalOpen}
              onClose={() => setLoginModalOpen(false)}
            />
          )}

          {isRegisterModalOpen && (
            <RegisterModal
              isOpen={isRegisterModalOpen}
              onClose={() => setRegisterModalOpen(false)}
            />
          )}

          {isAgentModalOpen && (
            <AgentFormModal
              onClose={() => { setAgentModalOpen(false); setEditingAgent(null); }}
              onSave={handleSaveAgent}
              llmConfigs={llmConfigs}
              existingAgent={editingAgent}
            />
          )}

          {updateConfirmation && (
            <ConfirmationModal
              isOpen={true}
              title={t('dialog_update_title')}
              message={t('dialog_update_message', { count: updateConfirmation.count })}
              confirmText={t('dialog_update_confirmButton')}
              cancelText={t('dialog_update_cancelButton')}
              onConfirm={() => handleUpdateConfirmation(true)}
              onCancel={() => handleUpdateConfirmation(false)}
            />
          )}

          {deleteConfirmation && (
            <ConfirmationModal
              isOpen={true}
              title={t('dialog_delete_title')}
              message={t('dialog_delete_message', { agentName: deleteConfirmation.agentName })}
              confirmText={t('dialog_delete_confirmButton')}
              onConfirm={confirmDeleteAgent}
              onCancel={() => setDeleteConfirmation(null)}
              variant="danger"
            />
          )}

          {isImagePanelOpen && (
            <ImageGenerationPanel
              isOpen={isImagePanelOpen}
              nodeId={currentImageNodeId}
              llmConfigs={llmConfigs}
              workflowNodes={workflowNodes}
              onClose={() => setImagePanelOpen(false)}
              onImageGenerated={handleImageGenerated}
              onOpenImageModificationPanel={handleOpenImageModificationPanel}
            />
          )}

          {isImageModificationPanelOpen && (
            <ImageModificationPanel
              isOpen={isImageModificationPanelOpen}
              editingImageInfo={editingImageInfo}
              llmConfigs={llmConfigs}
              workflowNodes={workflowNodes}
              onClose={() => setImageModificationPanelOpen(false)}
              onImageModified={handleImageModified}
            />
          )}

          {isVideoPanelOpen && (
            <VideoGenerationConfigPanel
              isOpen={isVideoPanelOpen}
              nodeId={currentVideoNodeId}
              llmConfigs={llmConfigs}
              workflowNodes={workflowNodes}
              onClose={() => setVideoPanelOpen(false)}
            />
          )}

          {isMapsPanelOpen && (
            <MapsGroundingConfigPanel
              isOpen={isMapsPanelOpen}
              nodeId={currentMapsNodeId}
              llmConfigs={llmConfigs}
              workflowNodes={workflowNodes}
              onClose={() => {
                setMapsPanelOpen(false);
                setMapsPreloadedResults(null);
              }}
              preloadedResults={mapsPreloadedResults || undefined}
            />
          )}

          {fullscreenImage && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm"
              onClick={() => setFullscreenImage(null)}
            >
              <img
                src={`data:${fullscreenImage.mimeType};base64,${fullscreenImage.src}`}
                alt={t('fullscreenModal_alt')}
                className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
              <Button
                variant="ghost"
                onClick={() => setFullscreenImage(null)}
                className="absolute top-4 right-4 text-white text-2xl px-2 py-2"
                aria-label={t('fullscreenModal_close_aria')}
              >
                &times;
              </Button>
            </div>
          )}

          {/* Fullscreen Chat Modal */}
          <FullscreenChatModal
            onDeleteNode={handleDeleteNode}
            onOpenImagePanel={handleOpenImagePanel}
            onOpenVideoPanel={handleOpenVideoPanel}
            onOpenMapsPanel={handleOpenMapsPanel}
          />

          {/* Configuration Modal */}
          <AgentConfigurationModal llmConfigs={llmConfigs} />

          <NotificationDisplay />
        </div>
      </NotificationProvider>
    </QueryProvider>
  );
}

/**
 * Root App component with all providers
 * AuthProvider wraps AppContent to enable useAuth() hook
 */
function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
