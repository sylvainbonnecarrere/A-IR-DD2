import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Agent, LLMConfig, LLMProvider, WorkflowNode, LLMCapability, ChatMessage, HistoryConfig, RobotId, V2WorkflowNode, AgentInstance } from './types';
import { NavigationLayout } from './components/NavigationLayout';
import { RobotPageRouter } from './components/RobotPageRouter';
import { AgentFormModal } from './components/modals/AgentFormModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { Header } from './components/Header';
import { GUEST_STORAGE_KEYS, getAllGuestKeys } from './utils/guestDataUtils';
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
// ⭐ V2: Import WorkflowSwitchOverlay for workflow switch (Bos amber)
import { WorkflowSwitchOverlay } from './components/WorkflowSwitchOverlay';
// ⭐ UX Polish: Import HyperspaceReveal for guest entry animation
import { HyperspaceReveal } from './components/HyperspaceReveal';
// ⭐ AUTO-SAVE: Import PersistenceService for immediate instance creation
import { PersistenceService } from './services/persistenceService';
// ⭐ V2: Import apiClient for workflow switch orchestration
import apiClient from './utils/apiClient';
// ⭐ FIX QA: Import useJournalQueue for image persistence
import { useJournalQueue } from './hooks/useJournalQueue';

// ⭐ J4.4: Use the key from guestDataUtils to ensure consistency with wipeGuestData()
const LLM_CONFIGS_KEY = GUEST_STORAGE_KEYS.LLM_CONFIGS;

interface EditingImageInfo {
  nodeId: string;
  sourceImage: string;
  mimeType: string;
  agent?: Agent;
  agentInstance?: AgentInstance;
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

// ⭐ ÉTAPE 5: API URL — source de vérité unique
import { API_BASE_URL } from './config/api.config';

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

  // ⭐ FIX: Store current agent for media panels - receives fresh data directly from V2AgentNode
  const [currentImageNodeId, setCurrentImageNodeId] = useState<string | null>(null);
  const [currentImageAgent, setCurrentImageAgent] = useState<Agent | null>(null);
  const [currentImageAgentInstance, setCurrentImageAgentInstance] = useState<AgentInstance | null>(null);
  const [currentVideoNodeId, setCurrentVideoNodeId] = useState<string | null>(null);
  const [currentVideoAgent, setCurrentVideoAgent] = useState<Agent | null>(null);
  const [currentVideoAgentInstance, setCurrentVideoAgentInstance] = useState<AgentInstance | null>(null);
  const [currentMapsNodeId, setCurrentMapsNodeId] = useState<string | null>(null);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflowNodes, setWorkflowNodes] = useState<WorkflowNode[]>([]);
  // ⭐ J4.4: Start with defaults - will be reloaded on first auth change
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>(initialLLMConfigs);
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
  const [hydrationMessage, setHydrationMessage] = useState('Chargement de votre workspace...');
  
  // ⭐ V2: Flag to distinguish initial login hydration from user-initiated workflow switch
  // isInitialHydrationRef removed (was dead code — never read)

  // ⭐ V2: State dédié au switch overlay (séparé de l'hydratation login)
  const [isSwitchingWorkflow, setIsSwitchingWorkflow] = useState(false);
  const [switchWorkflowName, setSwitchWorkflowName] = useState('');
  const [switchProgress, setSwitchProgress] = useState(0);
  const isSwitchingRef = useRef(false);  // Guard anti-re-entrance (pas de useState pour éviter re-render)

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
  
  // ⭐ FIX QA: Journal queue for persisting generated images
  const { enqueueEntry: enqueueJournalEntry } = useJournalQueue();

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
        // CRITICAL: Hard reset on authenticated user login to prevent stale data
        useDesignStore.getState().resetAll();
        
        // ⭐ SECURITY FIX: Wipe sélectif — préserver auth_data_v1 (JWT token)
        // localStorage.clear() détruisait le token JWT juste après le login,
        // causant des 401 sur toutes les requêtes suivantes via apiClient.
        const allGuestKeys = getAllGuestKeys();
        allGuestKeys.forEach(key => localStorage.removeItem(key));
        
        sessionStorage.clear();
        sessionStorage.setItem('_arc_hydrating', 'true');
        
        setHydrationProgress(30);

        // Parallel load: workspace and instances from API (via apiClient — Facade)
        setHydrationProgress(60);

        const { data: workspace } = await apiClient.get('/api/user/workspace');

        let instancesData: any[] | null = null;

        if (workspace.workflow?.id) {
          console.log('[App] Loading instances for workflowId:', workspace.workflow.id);
          try {
            const instRes = await apiClient.get(`/api/workflows/${workspace.workflow.id}/instances`);
            instancesData = instRes.data;
          } catch (err) {
            console.error('[App] Error loading instances:', err);
          }
        }
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

        // ⭐ DECLARE EARLY: Declare these variables BEFORE the if blocks so they're accessible later
        let hydratedPrototypes: Agent[] = [];
        
        // ⭐ FIX: Hydrater les prototypes d'agents dans le state React et le store Zustand
        if (workspace.agentPrototypes && workspace.agentPrototypes.length > 0) {
          const now = new Date().toISOString();
          hydratedPrototypes = workspace.agentPrototypes.map((proto: any) => ({
            id: proto.id,
            name: proto.name,
            role: proto.description || proto.role || 'assistant',
            systemPrompt: proto.description || proto.systemPrompt || '',
            llmProvider: (proto.provider as LLMProvider) || LLMProvider.Gemini,
            model: proto.model || 'gemini-2.0-flash',
            // ⭐ BUG FIX: Copy capabilities + tools from backend prototype (was always empty!)
            capabilities: Array.isArray(proto.capabilities) ? proto.capabilities : [],
            tools: Array.isArray(proto.tools) ? proto.tools : [],
            outputConfig: proto.outputConfig || {},
            historyConfig: proto.historyConfig || {},
            creator_id: proto.robotId || RobotId.Archi,
            created_at: proto.created_at || now,
            updated_at: proto.updated_at || now
          }));
          
          // Hydrater le state React (legacy)
          setAgents(hydratedPrototypes);
          
          // ⭐ NOTE: hydrateFromServer call moved to AFTER instances are ready
          // This ensures ATOMIC hydration (agents + instances together)
          console.log('[App] ✅ Agent prototypes loaded:', hydratedPrototypes.length);
        }

        // Load external instances from API (if fetched separately)
        const externalInstances = Array.isArray(instancesData)
          ? instancesData
          : [];
        
        // Merge instances from both sources, deduplicating by ID
        const allInstancesMap = new Map();
        
        if (workspace.agentInstances && workspace.agentInstances.length > 0) {
          workspace.agentInstances.forEach((inst: any) => {
            allInstancesMap.set(inst.id, inst);
          });
        }
        
        if (externalInstances.length > 0) {
          externalInstances.forEach((inst: any) => {
            if (!allInstancesMap.has(inst.id)) {
              allInstancesMap.set(inst.id, inst);
            }
          });
        }
        
        const mergedInstances = Array.from(allInstancesMap.values());
        
        // Filter out any undefined/null instances
        const validMergedInstances = mergedInstances.filter((inst: any) => inst && inst.id);
        
        // Prepare hydration for Zustand store
        let hydratedInstancesForStore: AgentInstance[] = [];
        
        // Hydrate instances to store before building nodes
        if (validMergedInstances.length > 0) {
          hydratedInstancesForStore = validMergedInstances.map((instance: any) => {
            const agentProto = workspace.agentPrototypes?.find((proto: any) => proto.id === instance.prototypeId);
            
            // ⭐ CRITICAL: Use configuration_json ALREADY reconstructed by backend
            // Backend returns it via transformAgentInstanceForFrontend()
            // No reconstruction needed - trust the backend data
            const configurationJson = instance.configuration_json || {
              role: instance.role || agentProto?.description || 'assistant',
              model: instance.llmModel || agentProto?.model || 'gemini-2.0-flash',
              llmProvider: instance.llmProvider || agentProto?.provider || LLMProvider.Gemini,
              systemPrompt: instance.systemPrompt || agentProto?.description || '',
              capabilities: Array.isArray(instance.capabilities) ? instance.capabilities : (agentProto?.capabilities || []),
              tools: Array.isArray(instance.tools) ? instance.tools : (agentProto?.tools || []),
              outputConfig: instance.outputConfig || agentProto?.outputConfig || {},
              historyConfig: instance.historyConfig || agentProto?.historyConfig || {},
              position: instance.position || { x: 0, y: 0 }
            };
            
            return {
              id: instance.id,
              prototypeId: instance.prototypeId || instance.id,
              name: instance.name,
              position: instance.position || { x: 0, y: 0 },
              isMinimized: instance.isMinimized || false,
              isMaximized: instance.isMaximized || false,
              workflowId: instance.workflowId || workspace.workflow?.id,
              configuration_json: configurationJson
            } as AgentInstance;
          });
          
          // Atomic hydration: single call with agents and instances together
          // Prevents race conditions from partial state updates
          hydrateFromServer({
            agents: hydratedPrototypes,
            agentInstances: hydratedInstancesForStore
          });
          
          console.log('[App] ✅ ÉTAPE 1 - ATOMIC HYDRATION COMPLETE:', {
            agents: hydratedPrototypes.length,
            instances: hydratedInstancesForStore.length,
            workflowId: workspace.workflow?.id,
            message: 'Single atomic call - no partial states',
            sampleInstance: hydratedInstancesForStore[0]?.configuration_json
          });
        }

        // ⭐ CRITICAL: Build V2WorkflowNodes from instances and hydrate to store
        // This ensures nodes are properly linked to instances for WorkflowCanvas resolution
        if (validMergedInstances.length > 0) {
          const v2Nodes: V2WorkflowNode[] = validMergedInstances.map((instance: any) => {
            // Find the agent prototype for this instance
            const agentProto = workspace.agentPrototypes?.find((proto: any) => proto.id === instance.prototypeId);
            
            // ⭐ FIX: Build Agent from prototype or instance, using capabilities from configuration_json
            const agent: Agent = agentProto ? {
              id: agentProto.id,
              name: agentProto.name,
              role: agentProto.description || 'assistant',
              systemPrompt: instance.systemInstruction || agentProto.description || '',
              llmProvider: (agentProto.provider as LLMProvider) || LLMProvider.Gemini,
              model: agentProto.model || 'gemini-2.0-flash',
              // Use instance capabilities if available (from configuration_json), else prototype
              capabilities: instance.configuration_json?.capabilities || agentProto.capabilities || [],
              tools: instance.configuration_json?.tools || agentProto.tools || [],
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
              // Use configuration_json for capabilities
              capabilities: instance.configuration_json?.capabilities || [],
              tools: instance.configuration_json?.tools || [],
              creator_id: RobotId.Archi,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            
            // ⭐ FIX: Use instance data (with configuration_json that includes capabilities)
            const hydratedInstance: AgentInstance = {
              id: instance.id,
              prototypeId: instance.prototypeId || agent.id,
              name: instance.name,
              position: instance.position || { x: 0, y: 0 },
              isMinimized: false,
              isMaximized: false,
              workflowId: instance.workflowId || workspace.workflow?.id,
              // ⭐ CRITICAL: Use configuration_json from instance (includes capabilities)
              configuration_json: instance.configuration_json || {
                role: agent.role,
                model: agent.model,
                llmProvider: agent.llmProvider,
                systemPrompt: agent.systemPrompt,
                capabilities: agent.capabilities || [],
                tools: agent.tools || [],
                position: instance.position || { x: 0, y: 0 }
              }
            };
            
            return {
              id: `node-${instance.id}`,
              type: 'agent',
              position: instance.position || { x: 0, y: 0 },
              data: {
                robotId: RobotId.Archi,
                label: instance.name,
                agent,
                agentInstance: hydratedInstance,
                workflowId: workspace.workflow?.id,
                isMinimized: false,
                isMaximized: false
              }
            };
          });
          
          // Build and store visual nodes
          setNodes(v2Nodes);
          console.log('[App] ✅ V2WorkflowNodes built from instances:', v2Nodes.length);
        } else {
          // Fall back to storing backend nodes if available (legacy nodes without instances)
          console.log('[App] ℹ️ No merged instances found, checking for legacy workspace.nodes');
          if (workspace.nodes && workspace.nodes.length > 0) {
            setNodes(workspace.nodes);
            console.log('[App] ✅ Using legacy workspace.nodes:', workspace.nodes.length);
          } else {
            console.warn('[App] ⚠️ No nodes or instances available');
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
              role: instance.role || instance.systemPrompt || 'assistant',
              systemPrompt: instance.systemPrompt || instance.systemInstruction || '',
              llmProvider: (instance.llmProvider || instance.provider as LLMProvider) || LLMProvider.Gemini,
              model: instance.model || instance.llmModel || 'gemini-2.0-flash',
              // ⭐ CRITICAL FIX #1: Use capabilities from configuration_json (not hardcoded [])
              capabilities: instance.configuration_json?.capabilities || instance.capabilities || [],
              tools: instance.configuration_json?.tools || instance.tools || [],
              // ⭐ CRITICAL FIX #2: Use historyConfig from configuration_json
              historyConfig: instance.configuration_json?.historyConfig || instance.historyConfig || { enabled: false, llmProvider: LLMProvider.Gemini, model: '', role: '', systemPrompt: '', limits: { char: 0, word: 0, token: 0, sentence: 0, message: 50 } },
              creator_id: RobotId.Archi,
              created_at: instance.createdAt || now,
              updated_at: now
            } as Agent,
            position: instance.position || { x: 0, y: 0 },
            messages: instance.content?.filter((c: any) => c.type === 'chat').map((c: any) => ({
              id: c.id || `msg-${Date.now()}`,
              sender: c.role || 'agent',
              text: c.message || '',
              timestamp: new Date(c.timestamp || Date.now())
            })) || [],
            isMinimized: false,
            isMaximized: false,
            instanceId: instance.id
          }));
          setWorkflowNodes(hydrationNodes);
        }

        // ⭐ ÉTAPE 4: Diagnostic logging - verify hydration success
        
        console.log('[App] Workspace hydration complete:', {
          workflowId: workspace.workflow?.id,
          nodes: workspace.nodes?.length || 0,
          instances: workspace.agentInstances?.length || 0
        });

        // Load persisted journals for each agent instance
        if (workspace.agentInstances && workspace.agentInstances.length > 0 && workspace.workflow?.id) {
          for (const instance of workspace.agentInstances) {
            try {
              const journalRes = await apiClient.get(
                `/api/workflows/${workspace.workflow.id}/instances/${instance.id}/journals`
              );
              const journalsData = journalRes.data;
              // ⭐ FIX: Le contrôleur retourne { data: [...], meta: {...} }, pas { journals: [...] }
              const journals = Array.isArray(journalsData)
                ? journalsData
                : (journalsData.data || journalsData.journals || []);

              if (journals.length > 0) {
                // Convert journals to ChatMessages
                // ⭐ FIX QA: Include imageBase64, mimeType, fileName for image persistence
                const chatMessages: ChatMessage[] = journals
                  .filter((j: any) => j.type === 'chat')
                  .map((j: any) => {
                    const payload = j.payload || {};
                    const role = payload.role || 'agent';
                    const content = payload.content || '';
                    
                    // ⭐ FIX QA: Reconstruct image data from journal payload
                    const chatMessage: ChatMessage = {
                      id: j._id || `journal-${j.timestamp}`,
                      sender: role === 'user' ? 'user' :
                             role === 'agent' ? 'agent' :
                             role === 'tool' ? 'tool' :
                             role === 'tool_result' ? 'tool_result' : 'agent',
                      text: content,
                      timestamp: new Date(j.createdAt || j.timestamp)
                    };
                    
                    // ⭐ FIX QA: Restore image data if present in journal
                    if (payload.imageBase64) {
                      chatMessage.image = payload.imageBase64;
                    }
                    if (payload.mimeType) {
                      chatMessage.mimeType = payload.mimeType;
                    }
                    if (payload.fileName) {
                      chatMessage.filename = payload.fileName;
                    }
                    
                    return chatMessage;
                  });

                const nodeId = `node-${instance.id}`;
                const { setNodeMessages } = useRuntimeStore.getState();
                setNodeMessages(nodeId, chatMessages);
                console.log(`[App] Loaded ${chatMessages.length} messages for instance ${nodeId}`);
              }
            } catch (error) {
              // Non-blocking: skip this instance's journals
              console.warn(`[App] Failed to load journals for instance ${instance.id}:`, error);
            }
          }
        }

      } catch (err) {
        console.error('[App] Workspace hydration error:', err);
      } finally {
        // Small delay to show 100% before hiding
        setTimeout(() => {
          setIsHydrating(false);
          setHydrationProgress(0);
          // ⭐ J4: Signal fin d'hydratation — débloque BosWorkflowManagementPage
          sessionStorage.removeItem('_arc_hydrating');
        }, 500);
      }
    };

    hydrateWorkspace();
  }, [isAuthenticated, accessToken, hydrateFromServer, setNodes, setEdges, hydrateWorkflowFromServer]);

  /**
   * ⭐ V2 SWITCH WORKFLOW: Fonction unifiée de réhydratation complète
   * Orchestre le switch de workflow avec feedback UX (WorkflowSwitchOverlay jaune Bos)
   * 
   * ⭐ V2 RÉÉCRITURE COMPLÈTE — Corrige P0-1, P0-2, P0-3, P2-1
   * 
   * SÉQUENCE:
   * 0. Guard clauses (anti-re-entrance, auth, hydration)
   * 1. Reset runtime store → nettoyer chat/execution du workflow précédent
   * 2. Fetch les données du workflow via POST /select (avec agentPrototypes)
   * 3. Mapper les prototypes (copie exacte de l'hydratation initiale L310-329)
   * 4. Hydratation atomique → hydrateFromServer + setAgents + hydrateWorkflowFromServer
   * 5. Recharger les journals → restaurer l'historique chat
   * 6. Reconstruire le React state legacy → workflowNodes pour le canvas
   * 7. Refresh liste workflows
   * 8. Succès → événement + notification
   */
  const switchToWorkflow = useCallback(async (workflowId: string, workflowName?: string) => {
    // ═══ ÉTAPE 0 : GUARD CLAUSES ═══
    if (isSwitchingRef.current) {
      console.warn('[SwitchWorkflow] ⚠️ Switch already in progress, ignoring');
      return;
    }
    if (isHydrating) {
      console.warn('[SwitchWorkflow] ⚠️ Initial hydration in progress, ignoring');
      return;
    }
    if (!accessToken) {
      console.warn('[SwitchWorkflow] ⚠️ No accessToken — aborting switch');
      window.dispatchEvent(new CustomEvent('workflow:switch:error', {
        detail: { message: t('workflow_switch_error_message').replace('{name}', workflowName || '') }
      }));
      return;
    }

    isSwitchingRef.current = true;
    setIsSwitchingWorkflow(true);
    setSwitchWorkflowName(workflowName || 'Workflow');
    setSwitchProgress(0);
    
    console.log('[SwitchWorkflow] ⭐ Starting full workflow switch to:', workflowId, workflowName);
    
    try {
      // ═══ ÉTAPE 1 : RESET RUNTIME (progress 10%) ═══
      // ⭐ V2 FIX: Use resetForWorkflowSwitch() to PRESERVE llmConfigs (user-level, not workflow-scoped)
      setSwitchProgress(10);
      useRuntimeStore.getState().resetForWorkflowSwitch();
      
      // ═══ ÉTAPE 2 : APPEL API (progress 30%) ═══
      setSwitchProgress(30);
      const { data } = await apiClient.post(`/api/workflows/${workflowId}/select`);
      const reloadedData = data.reloadedData;
      const workflowMeta = data.workflow;

      if (!data.success) {
        throw new Error(data.message || 'Switch failed');
      }
      
      // ═══ ÉTAPE 3 : MAPPER LES PROTOTYPES (progress 50%) ═══
      // ⭐ COPIE EXACTE du mapping de l'hydratation initiale (App.tsx L310-329)
      setSwitchProgress(50);
      const now = new Date().toISOString();
      const rawPrototypes = reloadedData?.agentPrototypes || [];
      const hydratedPrototypes: Agent[] = rawPrototypes.map((proto: any) => ({
        id: proto.id || proto._id,
        name: proto.name,
        role: proto.description || proto.role || 'assistant',
        systemPrompt: proto.description || proto.systemPrompt || '',
        llmProvider: (proto.provider as LLMProvider) || LLMProvider.Gemini,
        model: proto.model || 'gemini-2.0-flash',
        capabilities: Array.isArray(proto.capabilities) ? proto.capabilities : [],
        tools: Array.isArray(proto.tools) ? proto.tools : [],
        outputConfig: proto.outputConfig || {},
        historyConfig: proto.historyConfig || {},
        creator_id: proto.robotId || RobotId.Archi,
        created_at: proto.created_at || now,
        updated_at: proto.updated_at || now
      }));

      // ═══ ÉTAPE 4 : HYDRATATION ATOMIQUE (progress 70%) ═══
      setSwitchProgress(70);
      
      // 4a. React state prototypes (legacy) — OBLIGATOIRE (corrige P0-2)
      setAgents(hydratedPrototypes);

      // 4b. Zustand store — APPEL UNIQUE, TOUTES LES DONNÉES (corrige P0-1)
      // ⭐ FIX: Hydrater correctement les instances (structure AgentInstance attendue par le store)
      const rawInstances = reloadedData?.agents || [];
      const hydratedInstances: AgentInstance[] = rawInstances.map((inst: any) => ({
        id: inst._id || inst.id,
        prototypeId: inst.prototypeId || inst._id || inst.id,
        name: inst.name,
        position: inst.configuration_json?.position || inst.position || { x: 0, y: 0 },
        isMinimized: inst.isMinimized || false,
        isMaximized: inst.isMaximized || false,
        workflowId: inst.workflowId || workflowId,
        configuration_json: inst.configuration_json || {
          role: inst.role || 'assistant',
          model: inst.llmModel || 'gemini-2.0-flash',
          llmProvider: inst.llmProvider || LLMProvider.Gemini,
          systemPrompt: inst.systemPrompt || '',
          capabilities: Array.isArray(inst.capabilities) ? inst.capabilities : [],
          tools: Array.isArray(inst.tools) ? inst.tools : [],
          position: inst.position || { x: 0, y: 0 }
        }
      }));
      
      useDesignStore.getState().hydrateFromServer({
        agents: hydratedPrototypes,
        agentInstances: hydratedInstances,
        nodes: reloadedData?.nodes || [],
        edges: reloadedData?.edges || []
      });

      // 4c. Workflow store (canvas state, metadata)
      if (workflowMeta) {
        hydrateWorkflowFromServer({
          id: workflowMeta._id || workflowId,
          name: workflowMeta.name,
          description: workflowMeta.description,
          isDefault: workflowMeta.isDefault,
          isActive: workflowMeta.isActive,
          canvasState: reloadedData?.canvasState || workflowMeta.canvasState
        });
      }

      // 4d. Set currentWorkflowId dans le design store
      useDesignStore.getState().setCurrentWorkflowId(workflowId);
      
      // ═══ ÉTAPE 5 : JOURNAUX (progress 85%) ═══
      setSwitchProgress(85);
      const instances = reloadedData?.agents || [];
      for (const instance of instances) {
        const instanceId = instance._id || instance.id;
        if (!instanceId) continue;
        try {
          const journalRes = await apiClient.get(
            `/api/workflows/${workflowId}/instances/${instanceId}/journals`
          );
          const journals = journalRes.data?.data || journalRes.data?.journals || [];
          
          if (journals.length > 0) {
            // ⭐ FIX QA: Include imageBase64, mimeType, fileName for image persistence during workflow switch
            const chatMessages: ChatMessage[] = journals
              .filter((j: any) => j.type === 'chat')
              .map((j: any) => {
                const payload = j.payload || {};
                const role = payload.role || 'agent';
                const content = payload.content || '';
                
                // ⭐ FIX QA: Reconstruct chat message with image data
                const chatMessage: ChatMessage = {
                  id: j._id || `journal-${j.timestamp}`,
                  sender: role === 'user' ? 'user' :
                         role === 'agent' ? 'agent' :
                         role === 'tool' ? 'tool' :
                         role === 'tool_result' ? 'tool_result' : 'agent',
                  text: content,
                  timestamp: new Date(j.createdAt || j.timestamp)
                };
                
                // ⭐ FIX QA: Restore image data if present in journal
                if (payload.imageBase64) {
                  chatMessage.image = payload.imageBase64;
                }
                if (payload.mimeType) {
                  chatMessage.mimeType = payload.mimeType;
                }
                if (payload.fileName) {
                  chatMessage.filename = payload.fileName;
                }
                
                return chatMessage;
              });
            
            const nodeId = `node-${instanceId}`;
            useRuntimeStore.getState().setNodeMessages(nodeId, chatMessages);
            console.log(`[SwitchWorkflow] Loaded ${chatMessages.length} messages for ${nodeId}`);
          }
        } catch {
          console.warn(`[SwitchWorkflow] Journals load failed for instance ${instanceId}`);
        }
      }
      
      // ═══ ÉTAPE 6 : RECONSTRUIRE LES NODES LEGACY + V2 (progress 90%) ═══
      setSwitchProgress(90);
      if (instances.length > 0) {
        const hydrationNodes: WorkflowNode[] = instances.map((inst: any) => ({
          id: inst._id || inst.id,
          agent: {
            id: inst._id || inst.id,
            name: inst.name,
            role: inst.configuration_json?.role || inst.role || 'assistant',
            systemPrompt: inst.configuration_json?.systemPrompt || inst.systemPrompt || '',
            llmProvider: (inst.configuration_json?.llmProvider || inst.llmProvider || LLMProvider.Gemini) as LLMProvider,
            model: inst.configuration_json?.model || inst.llmModel || 'gemini-2.0-flash',
            capabilities: inst.configuration_json?.capabilities || inst.capabilities || [],
            tools: inst.configuration_json?.tools || inst.tools || [],
            historyConfig: inst.configuration_json?.historyConfig || inst.historyConfig || {},
            creator_id: RobotId.Archi,
            created_at: inst.createdAt || now,
            updated_at: now
          } as Agent,
          position: inst.configuration_json?.position || inst.position || { x: 0, y: 0 },
          messages: [],
          isMinimized: false,
          isMaximized: false,
          instanceId: inst._id || inst.id
        }));
        setWorkflowNodes(hydrationNodes);
        
        // Also rebuild V2 nodes for the design store
        // ⭐ FIX Bug 2: Build data.agent + structured agentInstance (matches initial hydration)
        const v2Nodes: V2WorkflowNode[] = instances.map((inst: any) => {
          const instanceId = inst._id || inst.id;
          
          // Build Agent from instance data (same fields as hydrationNodes above)
          const agent: Agent = {
            id: instanceId,
            name: inst.name,
            role: inst.configuration_json?.role || inst.role || 'assistant',
            systemPrompt: inst.configuration_json?.systemPrompt || inst.systemPrompt || '',
            llmProvider: (inst.configuration_json?.llmProvider || inst.llmProvider || LLMProvider.Gemini) as LLMProvider,
            model: inst.configuration_json?.model || inst.llmModel || 'gemini-2.0-flash',
            capabilities: inst.configuration_json?.capabilities || inst.capabilities || [],
            tools: inst.configuration_json?.tools || inst.tools || [],
            historyConfig: inst.configuration_json?.historyConfig || inst.historyConfig || {},
            outputConfig: inst.configuration_json?.outputConfig || inst.outputConfig || {},
            creator_id: RobotId.Archi,
            created_at: inst.createdAt || now,
            updated_at: now
          };
          
          // Build properly structured AgentInstance
          const hydratedInstance: AgentInstance = {
            id: instanceId,
            prototypeId: inst.prototypeId || instanceId,
            name: inst.name,
            position: inst.configuration_json?.position || inst.position || { x: 0, y: 0 },
            isMinimized: false,
            isMaximized: false,
            workflowId: inst.workflowId || workflowId,
            configuration_json: inst.configuration_json || {
              role: agent.role,
              model: agent.model,
              llmProvider: agent.llmProvider,
              systemPrompt: agent.systemPrompt,
              capabilities: agent.capabilities || [],
              tools: agent.tools || [],
              position: inst.position || { x: 0, y: 0 }
            }
          };
          
          return {
            id: `node-${instanceId}`,
            type: 'agent' as const,
            position: inst.configuration_json?.position || inst.position || { x: 0, y: 0 },
            data: {
              robotId: RobotId.Archi,
              label: inst.name,
              agent,
              agentInstance: hydratedInstance,
              workflowId,
              isMinimized: false,
              isMaximized: false
            }
          };
        });
        setNodes(v2Nodes);
      } else {
        setWorkflowNodes([]);
        setNodes([]);
      }

      // ═══ ÉTAPE 7 : REFRESH LISTE WORKFLOWS (progress 95%) ═══
      setSwitchProgress(95);
      try {
        await useDesignStore.getState().loadUserWorkflows();
      } catch (refreshErr) {
        console.warn('[SwitchWorkflow] Workflows list refresh failed (non-blocking):', refreshErr);
      }

      // ═══ ÉTAPE 8 : SUCCÈS (progress 100%) ═══
      setSwitchProgress(100);
      
      console.log('[SwitchWorkflow] ✅ Workflow switch complete:', {
        workflowId,
        workflowName,
        prototypesCount: hydratedPrototypes.length,
        instancesCount: instances.length
      });
      
      // ⭐ V2: Notify observers of successful switch
      window.dispatchEvent(new CustomEvent('workflow:switch:success', {
        detail: { workflowId, workflowName }
      }));
      
    } catch (error: any) {
      console.error('[SwitchWorkflow] ❌ Error:', error);
      window.dispatchEvent(new CustomEvent('workflow:switch:error', {
        detail: { message: error.message || 'Unknown error', workflowId }
      }));
    } finally {
      // ═══ CLEANUP ═══
      setTimeout(() => {
        setIsSwitchingWorkflow(false);
        setSwitchProgress(0);
        setSwitchWorkflowName('');
      }, 300);
      isSwitchingRef.current = false;
    }
  }, [accessToken, hydrateWorkflowFromServer, setNodes, t, isHydrating]);

  /**
   * ⭐ V2: Listen for workflow:switch custom events from BosWorkflowManagementPage
   * Pattern Observer — découplage entre la page BOS et l'orchestration App.tsx
   */
  useEffect(() => {
    const handleWorkflowSwitch = (event: Event) => {
      const { workflowId, workflowName } = (event as CustomEvent).detail;
      if (workflowId) {
        switchToWorkflow(workflowId, workflowName || 'Workflow');
      }
    };
    
    window.addEventListener('workflow:switch', handleWorkflowSwitch);
    return () => window.removeEventListener('workflow:switch', handleWorkflowSwitch);
  }, [switchToWorkflow]);

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
    
    // ⭐ FIX J4.5: Close all open panels on auth change to prevent stale nodeId references
    // Problem: panel states (isImagePanelOpen, etc) kept old nodeIds after reconnect
    // Solution: Reset all panel states when authentication changes
    setImagePanelOpen(false);
    setCurrentImageNodeId(null);
    setCurrentImageAgent(null);
    setCurrentImageAgentInstance(null);
    setImageModificationPanelOpen(false);
    setEditingImageInfo(null);
    setVideoPanelOpen(false);
    setCurrentVideoNodeId(null);
    setCurrentVideoAgent(null);
    setCurrentVideoAgentInstance(null);
    setMapsPanelOpen(false);
    setCurrentMapsNodeId(null);
    setMapsPreloadedResults(null);
    
    // ⭐ FIX: Reset prevApiKeysRef on auth change to allow fresh hydration
    // Bug: After logout/login, same configs would be skipped due to hash match
    prevApiKeysRef.current = '';
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

    // ⭐ FIX: Prevent infinite loop by checking content equality
    // Must be done BEFORE any state updates
    const keysHash = JSON.stringify(llmApiKeys);
    if (keysHash === prevApiKeysRef.current) {
      return;
    }
    prevApiKeysRef.current = keysHash;

    // ⭐ FIX: If llmApiKeys is empty array, user has no configs in DB
    // Set all providers to disabled (initialLLMConfigs with enabled:false)
    if (llmApiKeys.length === 0) {
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
    
    // Merge with initial configs to keep capabilities defaults for providers not in API
    const mergedConfigs = initialLLMConfigs.map(initial => {
      const apiConfig = apiConfigs.find(c => c.provider === initial.provider);
      if (apiConfig) {
        return {
          ...initial,
          ...apiConfig,
          // ⭐ PHASE 0 FIX: Conservative merge - preserve initial defaults unless explicitly overridden
          // Only apply API capability values if they're explicitly present in the response
          // This prevents losing capabilities (like OutputFormatting) when backend doesn't return them
          capabilities: apiConfig.capabilities
            ? Object.keys(initial.capabilities).reduce((acc, capKey) => {
                const cap = capKey as LLMCapability;
                // If API explicitly specifies this capability, use its value
                if (cap in apiConfig.capabilities) {
                  acc[cap] = apiConfig.capabilities[cap];
                } else {
                  // Otherwise preserve the initial default
                  acc[cap] = initial.capabilities[cap];
                }
                return acc;
              }, {} as { [k in LLMCapability]?: boolean })
            : initial.capabilities
        };
      }
      return initial;
    });
    
    setLlmConfigs(mergedConfigs);
    updateLLMConfigs(mergedConfigs);
  }, [isAuthenticated, llmApiKeys, updateLLMConfigs]);

  // ⭐ PHASE 2: Load workflows on authentication
  // ⭐ V4 FIX: Wait for hydration to complete before loading workflows
  // The hydration useEffect sets _arc_hydrating flag; we wait until it's cleared.
  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;

    const loadWorkflows = async (retryCount = 0) => {
      try {
        // Wait for hydration to finish before loading workflows
        const isHydrating = sessionStorage.getItem('_arc_hydrating') === 'true';
        if (isHydrating && retryCount < 5) {
          // Hydration still in progress — retry after 300ms
          setTimeout(() => loadWorkflows(retryCount + 1), 300);
          return;
        }
        
        const designStore = useDesignStore.getState();
        await designStore.loadUserWorkflows();
        console.log('[App] ✅ Workflows loaded successfully');
      } catch (error) {
        console.error('[App] ❌ Failed to load workflows:', error);
        // Error is already in store.workflowLoadError
      }
    };

    // Load after initial hydration settles
    const timer = setTimeout(() => {
      loadWorkflows();
    }, 200);

    return () => clearTimeout(timer);
  }, [isAuthenticated, accessToken]);

  // ⭐ V2: L'ancien watcher PHASE 2 (resetAll sur currentWorkflowId change) est supprimé.
  // switchToWorkflow() orchestre désormais le reset + rechargement complet.
  // Garder le watcher causerait un double reset du runtimeStore.

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
      let backendId: string;
      let savedAgent: any;

      if (agentId) {
        // ⭐ ÉTAPE 3: Update existing agent prototype
        console.log('[App] 📤 Updating agent prototype:', agentId);
        const { data: updatedAgent } = await apiClient.put(`/api/agent-prototypes/${agentId}`, agentData);

        savedAgent = updatedAgent;
        backendId = savedAgent._id || agentId;
        console.log('[App] ✅ Agent prototype updated:', backendId);
      } else {
        // ⭐ ÉTAPE 3: Create new agent prototype
        console.log('[App] 📤 Creating new agent prototype:', agentData.name);
        const { data: createdAgent } = await apiClient.post('/api/agent-prototypes', agentData);

        savedAgent = createdAgent;
        backendId = savedAgent._id;
        console.log('[App] ✅ Agent prototype created with backendId:', backendId);

        // ⭐ ÉTAPE 3 CRITICAL: Convert tempId → backendId for NEW agents
        // Find which agent in the store has the same name/role and convert its ID
        if (!agentId && backendId) {
          const storeState = useDesignStore.getState();
          // Look for agent with matching name and role (since we just created it with tempId)
          const tempAgent = storeState.agents.find(
            a => a.name === agentData.name && a.role === agentData.role
          );

          if (tempAgent && tempAgent.id !== backendId) {
            console.log('[App] ⭐ Converting tempId → backendId:', {
              tempId: tempAgent.id,
              backendId: backendId
            });
            // This also updates all instances referencing this prototype
            useDesignStore.getState().updateAgentId(tempAgent.id, backendId);
          }
        }
      }

      // Close the modal
      setAgentModalOpen(false);
      setEditingAgent(null);

      // Show success notification
      console.log('[App] ✅ Agent saved successfully:', backendId);
    } catch (error) {
      console.error('[App] ❌ Error saving agent:', error);
      // TODO: Show error notification to user
    }
  };

  const handleSaveSettings = async (newLLMConfigs: LLMConfig[]) => {
    try {
      const lmStudioConfig = newLLMConfigs.find(c => c.provider === LLMProvider.LMStudio);

      // Get appropriate storage based on auth state
      const storage = getSettingsStorage({
        isAuthenticated,
        accessToken,
        refreshToken: null,
        user: null,
        login: async () => { },
        register: async () => { },
        logout: () => { },
        refreshAccessToken: async () => { },
        clearError: () => { },
        refreshLLMApiKeys: async () => { },
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
    // ⭐ BUG FIX: Calculate position based on STORE instances (not legacy workflowNodes)
    // This prevents collision when reconnecting (workflowNodes is empty on load)
    // Use getState() to get current count of instances in Zustand store
    const storeInstances = useDesignStore.getState().agentInstances;
    const instanceCount = storeInstances.length;
    
    const position = {
      x: (instanceCount % 4) * 420 + 20,
      y: Math.floor(instanceCount / 4) * 540 + 20,
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
            outputConfig: agent.outputConfig,
            // ⭐ PHASE 2: Include capabilities + historyConfig for complete persistence
            // Ensures reconnection loads same capabilities as template
            // Chat is ALWAYS included as the minimum capability
            capabilities: agent.capabilities && agent.capabilities.length > 0 
              ? agent.capabilities 
              : [LLMCapability.Chat],  // Fallback: minimum Chat capability
            // Include history config if template defined it
            historyConfig: agent.historyConfig || undefined
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
        console.log('[App] ✅ Agent instance persisted to DB with backendId:', result.backendId);
        
        // ✅ ÉTAPE 2: Synchroniser l'instance complète du backend avec Zustand
        // Le backend retourne l'instance avec configuration_json enrichie
        if (result.backendId && result.instance) {
          
          // ✅ Remplacer l'instance temporaire par l'instance backend complète
          // Incluant la configuration_json qui sera utilisée dans AgentConfigurationModal
          const backendInstance: AgentInstance = {
            id: result.backendId,
            prototypeId: agent.id,
            name: instanceName,
            position,
            workflowId,
            isMinimized: false,
            isMaximized: false,
            // ⭐ FIX QA: Récupérer persistenceConfig du backend ou du prototype
            persistenceConfig: result.instance.persistenceConfig || agent.persistenceConfig || {
              saveChat: true,
              saveErrors: true,
              saveHistorySummary: false,
              saveLinks: false,
              saveTasks: false,
              saveMedia: false,
              mediaStorage: 'db'
            },
            // ✅ configuration_json contient TOUS les détails de config (role, model, llmProvider, etc.)
            configuration_json: result.instance.configuration_json || {
              role: agent.role,
              model: agent.model,
              llmProvider: agent.llmProvider,
              systemPrompt: agent.systemPrompt,
              tools: agent.tools || [],
              outputConfig: agent.outputConfig,
              capabilities: agent.capabilities || [],
              historyConfig: agent.historyConfig,
              position
            }
          };
          
          // ✅ CRITICAL: Update instance ID AND content in Zustand store
          if (result.backendId !== instanceId) {
            updateInstanceId(instanceId, result.backendId);
          }
          // ✅ Ensuite mettre à jour la configuration complète
          // Use getState() for stable reference (avoid dependency on updateAgentInstance)
          useDesignStore.getState().updateAgentInstance(result.backendId, backendInstance);
          finalInstanceId = result.backendId;
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
      if (isAuthenticated) {
        const workflowId = getCurrentWorkflowId();
        if (workflowId) {
          try {
            await apiClient.delete(`/api/workflows/${workflowId}/instances/${finalInstanceId}`);
            console.log('[App] ✅ Agent instance deleted from backend:', finalInstanceId);
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
      if (isAuthenticated) {
        const workflowId = getCurrentWorkflowId();
        if (workflowId) {
          try {
            await apiClient.delete(`/api/workflows/${workflowId}/instances/${instanceId}`);
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

  const handleOpenImagePanel = (nodeId: string, agent: Agent, agentInstance: AgentInstance) => {
    setCurrentImageNodeId(nodeId);
    setCurrentImageAgent(agent);
    setCurrentImageAgentInstance(agentInstance);
    setImagePanelOpen(true);
  };

  const handleImageGenerated = (nodeId: string, imageBase64: string) => {
    const imageMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'agent',
      text: t('app_generatedImageText'),
      image: imageBase64,
      mimeType: 'image/png',
      timestamp: new Date()
    };
    handleUpdateNodeMessages(nodeId, prev => [...prev, imageMessage]);
    addNodeMessage(nodeId, imageMessage);
    
    // ⭐ FIX QA: Persist generated image to journal
    const instanceId = nodeId.replace('node-', '');
    const workflowId = getCurrentWorkflowId();
    if (instanceId && workflowId) {
      enqueueJournalEntry(workflowId, instanceId, 'chat', {
        role: 'agent',
        content: t('app_generatedImageText'),
        imageBase64: imageBase64,
        mimeType: 'image/png'
      });
    }
  };

  const handleOpenImageModificationPanel = (nodeId: string, sourceImage: string, agent?: Agent, agentInstance?: AgentInstance, mimeType: string = 'image/png') => {
    setEditingImageInfo({ nodeId, sourceImage, mimeType, agent, agentInstance });
    setImageModificationPanelOpen(true);
  };

  const handleOpenVideoPanel = (nodeId: string, agent: Agent, agentInstance: AgentInstance) => {
    setCurrentVideoNodeId(nodeId);
    setCurrentVideoAgent(agent);
    setCurrentVideoAgentInstance(agentInstance);
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
      timestamp: new Date()
    };
    handleUpdateNodeMessages(nodeId, prev => [...prev, message]);
    addNodeMessage(nodeId, message);
    
    // ⭐ FIX QA: Persist modified image to journal
    const instanceId = nodeId.replace('node-', '');
    const workflowId = getCurrentWorkflowId();
    if (instanceId && workflowId) {
      enqueueJournalEntry(workflowId, instanceId, 'chat', {
        role: 'agent',
        content: text,
        imageBase64: newImage,
        mimeType: 'image/png'
      });
    }
  };

  const handleToggleNodeMinimize = (nodeId: string) => {
    // ⭐ ARCHITECTURE FIX: Store minimize state in useRuntimeStore (transient UI state, not persisted)
    // This approach separates concerns: coordinates in Design Store, UI state in Runtime Store
    const { toggleNodeMinimized } = useRuntimeStore.getState();
    toggleNodeMinimized(nodeId);
    console.log('[App] Toggled minimize for node:', nodeId);
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

        {/* ⭐ V2: Overlay dédié au switch workflow (jaune Bos) */}
        <WorkflowSwitchOverlay
          isLoading={isSwitchingWorkflow}
          workflowName={switchWorkflowName}
          progress={switchProgress}
        />

        {/* ⭐ ÉTAPE 5: Hydration Overlay - Blur Racing Style (login only) */}
        <HydrationOverlay 
          isLoading={isHydrating} 
          progress={hydrationProgress}
          message={hydrationMessage}
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
            <>
              <ImageGenerationPanel
                isOpen={isImagePanelOpen}
                nodeId={currentImageNodeId}
                agent={currentImageAgent}
                agentInstance={currentImageAgentInstance}
                llmConfigs={llmConfigs}
                workflowNodes={workflowNodes}
                onClose={() => setImagePanelOpen(false)}
                onImageGenerated={handleImageGenerated}
                onOpenImageModificationPanel={handleOpenImageModificationPanel}
              />
            </>
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
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm"
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
            onOpenFullscreen={handleOpenFullscreen}
            onOpenImageModificationPanel={handleOpenImageModificationPanel}
            onImageGenerated={handleImageGenerated}
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
