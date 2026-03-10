import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Agent, LLMConfig, LLMProvider, LLMCapability, HistoryConfig, Tool, OutputConfig, OutputFormat, RobotId, LocalLLMProfile } from '../../types';
import { Button, Modal, ToggleSwitch } from '../UI';
import { LLM_MODELS, getModelCapabilities, getLMStudioMergedModels } from '../../llmModels';
import { CloseIcon, PlusIcon } from '../Icons';
import { useLocalization } from '../../hooks/useLocalization';
import { useAuth } from '../../hooks/useAuth';
import { validateAgentCapabilities, type CapabilityValidationResult } from '../../utils/lmStudioCapabilityValidator';
import { useLMStudioDetection } from '../../hooks/useLMStudioDetection';
import { useRuntimeStore } from '../../stores/useRuntimeStore';
import { isLocalProvider, isLMStudio } from '../../utils/llmProviderUtils';
import * as localLLMProfileService from '../../services/localLLMProfileService';
import { API_BASE_URL } from '../../config/api.config';

interface AgentFormModalProps {
  onClose: () => void;
  onSave: (agent: Omit<Agent, 'id'>, agentId?: string) => void;
  llmConfigs: LLMConfig[];
  existingAgent: Agent | null;
  localLLMProfiles?: LocalLLMProfile[];
}

const defaultHistoryConfig: Omit<HistoryConfig, 'llmProvider' | 'model'> = {
  enabled: false,
  role: 'Archiviste Concis',
  systemPrompt: 'Résume la conversation suivante de manière factuelle et concise, en conservant les points clés et les décisions prises. Le résumé servira de mémoire pour un autre agent IA.',
  limits: { char: 5000, word: 1000, token: 800, sentence: 50, message: 20 }
};

const newToolTemplate: Tool = {
  name: 'new_tool_name',
  description: 'A brief description of what this tool does.',
  parameters: {
    type: 'object',
    properties: {
      param1: {
        type: 'string',
        description: 'Description for parameter 1.'
      }
    },
    required: ['param1']
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: {
        type: 'string',
        description: 'The result of the tool execution.'
      }
    },
    required: ['result']
  }
};

const defaultWeatherTool: Tool = {
  name: 'get_weather',
  description: 'Obtient la météo actuelle pour un lieu donné.',
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "La ville pour laquelle obtenir la météo, par exemple, Paris."
      }
    },
    required: ["location"]
  },
  outputSchema: {
    type: 'object',
    properties: {
      location: { type: 'string' },
      temperature: { type: 'string' },
      condition: { type: 'string' }
    },
    required: ['location', 'temperature', 'condition']
  }
};


const defaultOutputConfig: OutputConfig = {
  enabled: false,
  format: 'json',
  useCodestralCompletion: false,
};

const outputFormats: OutputFormat[] = ['json', 'xml', 'yaml', 'shell', 'powershell', 'python', 'html', 'css', 'javascript', 'typescript', 'php', 'sql', 'mysql', 'mongodb'];

export const AgentFormModal = ({ onClose, onSave, llmConfigs: propLlmConfigs, existingAgent, localLLMProfiles: propLocalLLMProfiles = [] }: AgentFormModalProps) => {
  const { t } = useLocalization();
  const { user, accessToken } = useAuth();
  const isAuthenticated = user !== null;

  // Use store as canonical source, fallback to props
  // This prevents T0 blank dropdown: if store already has data (previous navigation), use it immediately
  const storeLlmConfigs = useRuntimeStore(state => state.llmConfigs);
  const llmConfigs = storeLlmConfigs?.length > 0 ? storeLlmConfigs : propLlmConfigs;

  // Store-first: reads from Zustand so profiles are available at modal mount
  // even before props are hydrated from the async fetch in useLocalLLMProfiles.
  const storeLocalProfiles = useRuntimeStore(state => state.localLLMProfiles);
  const localLLMProfiles = storeLocalProfiles?.length > 0 ? storeLocalProfiles : propLocalLLMProfiles;

  // Detect reconfiguration issues and usable providers
  const hasReconfigNeeded = llmConfigs.some(c => c.enabled && c.needsReconfig);
  const enabledAndUsable = llmConfigs.filter(c => c.enabled && !c.needsReconfig && c.apiKey);
  // Local providers have no apiKey — check enabled profiles separately
  const noUsableLLM = enabledAndUsable.length === 0 && !localLLMProfiles.some(p => p.enabled);

  const enabledLLMProvider = enabledAndUsable[0]?.provider || llmConfigs.find(c => c.enabled)?.provider || LLMProvider.Gemini;

  // Get available models for a provider
  const getAvailableModels = useCallback((provider: LLMProvider): string[] => {
    const config = llmConfigs.find(c => c.provider === provider && c.enabled);
    if (!config) {
      return [];
    }
    const models = LLM_MODELS[provider] || [];
    return models;
  }, [llmConfigs]);

  // For new agents with only local LLMs configured, pre-select first enabled profile.
  // Ensures the select has a matching option instead of a blank value.
  const initialLocalProfile = !existingAgent && isLMStudio(enabledLLMProvider)
    ? localLLMProfiles.find(p => p.enabled) ?? null
    : null;

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [llmProvider, setLlmProvider] = useState<LLMProvider>(enabledLLMProvider);
  const [model, setModel] = useState<string>(() => {
    if (existingAgent?.model) return existingAgent.model;
    // Auto-hydrate model from pre-selected local profile's detectedModel
    if (!existingAgent && isLMStudio(enabledLLMProvider)) {
      const firstProfile = localLLMProfiles.find(p => p.enabled);
      if (firstProfile?.detectedModel) return firstProfile.detectedModel;
    }
    const availableModels = getAvailableModels(enabledLLMProvider);
    return availableModels.length > 0 ? availableModels[0] : '';
  });

  // Initialize capabilities: from template or model defaults
  // Chat is always included
  const [selectedCapabilities, setSelectedCapabilities] = useState<LLMCapability[]>(() => {
    if (existingAgent?.capabilities && existingAgent.capabilities.length > 0) {
      const caps = new Set<LLMCapability>([LLMCapability.Chat, ...existingAgent.capabilities]);
      return Array.from(caps);
    }
    
    // PRIORITÉ 2: For new agents, load capabilities from the selected model
    const availableModels = getAvailableModels(enabledLLMProvider);
    const firstModel = availableModels.length > 0 ? availableModels[0] : '';
    const modelCaps = getModelCapabilities(enabledLLMProvider, firstModel);
    
    // Always include Chat as the primary capability, plus model-specific capabilities
    const defaultCaps = [LLMCapability.Chat, ...modelCaps];
    return [...new Set(defaultCaps)];
  });
  const [tools, setTools] = useState<Tool[]>([]);
  const [outputConfig, setOutputConfig] = useState<OutputConfig>(defaultOutputConfig);
  const [historyConfig, setHistoryConfig] = useState<HistoryConfig>(() => {
    const availableModels = getAvailableModels(enabledLLMProvider);
    return {
      ...defaultHistoryConfig,
      llmProvider: enabledLLMProvider,
      model: availableModels.length > 0 ? availableModels[0] : '',
    };
  }); 
  const [activeTab, setActiveTab] = useState<'description' | 'historique' | 'fonctions' | 'formatage'>('description');
  const [schemaErrors, setSchemaErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [lmStudioValidation, setLmStudioValidation] = useState<CapabilityValidationResult | null>(null);
  const [capabilitiesExpanded, setCapabilitiesExpanded] = useState(false);
  const [lmStudioDynamicModels, setLmStudioDynamicModels] = useState<any[]>([]);
  const [isLoadingLMStudioModels, setIsLoadingLMStudioModels] = useState(false);
  // Selected local LLM profile; pre-selected to first enabled profile for new agents
  const [localLLMProfileId, setLocalLLMProfileId] = useState<string>(
    existingAgent?.localLLMProfileId || initialLocalProfile?.id || ''
  );
  const [isDetectingLocalModel, setIsDetectingLocalModel] = useState(false);
  const [inlineDetectionError, setInlineDetectionError] = useState<string | null>(null);
  const isEditing = !!existingAgent;

  // LMStudio uses localEndpoint (plaintext URL); apiKey is kept as a fallback for legacy records
  const lmStudioConfig = llmConfigs.find(c => isLMStudio(c.provider));
  const lmStudioEndpoint = lmStudioConfig?.localEndpoint || lmStudioConfig?.apiKey;
  // Stable boolean memo — avoids new array reference from .some() polluting effect deps
  const hasEnabledLocalProfiles = useMemo(() => localLLMProfiles.some(p => p.enabled), [localLLMProfiles]);
  const { detection: lmStudioDetection, isDetecting: isDetectingLMStudio, redetect: redetectLMStudio } = useLMStudioDetection({
    // Legacy endpoint only in pure legacy mode (no local profiles configured at all)
    endpoint: isLMStudio(llmProvider) && !localLLMProfileId && !hasEnabledLocalProfiles ? lmStudioEndpoint : undefined,
    autoDetect: false, // Detection is always user-triggered (inline button for profiles, redetect for legacy)
    onSuccess: (detection) => {
      // Auto-update capabilities when detection succeeds
      setSelectedCapabilities(prev => {
        const newCaps = [...prev];
        detection.capabilities.forEach(cap => {
          if (!newCaps.includes(cap)) {
            newCaps.push(cap);
          }
        });
        return newCaps;
      });
    }
  });

  // Fetch dynamic models for legacy LMStudio mode (no local profiles configured)
  useEffect(() => {
    if (llmProvider === LLMProvider.LMStudio && lmStudioEndpoint && !localLLMProfileId && !hasEnabledLocalProfiles) {
      setIsLoadingLMStudioModels(true);
      getLMStudioMergedModels(lmStudioEndpoint)
        .then(models => {
          setLmStudioDynamicModels(models);

          // Auto-select the detected model when available
          if (lmStudioDetection?.modelId) {
            const detectedModel = models.find(m => m.id === lmStudioDetection.modelId);
            if (detectedModel) {
              setModel(detectedModel.id);

              // Auto-activer les capacités détectées
              setSelectedCapabilities(lmStudioDetection.capabilities);
              return;
            }
          }

          // Fallback: auto-select first available model if none is currently selected
          if (models.length > 0) {
            setModel(currentModel => currentModel || models[0].id);
          }
        })
        .catch(error => {
          setLmStudioDynamicModels([]);
        })
        .finally(() => setIsLoadingLMStudioModels(false));
    } else {
      setLmStudioDynamicModels([]);
    }
  }, [llmProvider, localLLMProfileId, hasEnabledLocalProfiles, lmStudioEndpoint, lmStudioDetection]);

  // Helper function to get label from capability string
  const getCapabilityLabel = (str: string): string => {
    const capMap: Record<string, string> = {
      'Chat': 'Chat',
      'Function Calling': 'Appel de Fonction',
      'Embedding': 'Embedding',
      'Output Formatting': 'Output Formatting',
      'Vision': 'Vision',
      'Thinking': 'Thinking (Réflexion)'
    };
    return capMap[str] || str;
  };

  // Helper function to get available capabilities for a provider (must be after lmStudioDetection)
  // Wrapped in useCallback to prevent infinite loops in useEffect dependencies
  const getAvailableCapabilities = React.useCallback((provider: LLMProvider, selectedModel?: string): LLMCapability[] => {
    const config = llmConfigs.find(c => c.provider === provider && c.enabled);
    if (!config) {
      return []; // Return empty array if provider not configured
    }

    // PRIORITÉ 1: Pour LMStudio, utiliser les capacités détectées dynamiquement si disponibles
    if (isLMStudio(provider) && lmStudioDetection?.capabilities) {
      const detectedCaps = lmStudioDetection.capabilities.filter((cap): cap is LLMCapability => cap !== undefined && cap !== null);
      return detectedCaps;
    }

    // PRIORITÉ 2: If a specific model is selected, use its capabilities from LLM_MODELS_DETAILED
    if (selectedModel) {
      const modelCapabilities = getModelCapabilities(provider, selectedModel);
      if (modelCapabilities.length > 0) {
        return modelCapabilities;
      }
    }

    // PRIORITÉ 3: Fallback: Return only capabilities that are enabled in the config
    const caps = Object.keys(config.capabilities)
      .filter(cap => config.capabilities[cap as LLMCapability])
      .map(cap => cap as LLMCapability);
    return caps;
  }, [llmConfigs, lmStudioDetection]);

  useEffect(() => {
    if (isEditing && existingAgent) {
      setName(existingAgent.name);
      setRole(existingAgent.role);
      setSystemPrompt(existingAgent.systemPrompt);
      setLlmProvider(existingAgent.llmProvider);
      setLocalLLMProfileId(existingAgent.localLLMProfileId || '');
      // Fall back to profile.detectedModel when the saved agent has no model stored
      if (isLMStudio(existingAgent.llmProvider) && existingAgent.localLLMProfileId && !existingAgent.model) {
        const profile = localLLMProfiles.find(p => p.id === existingAgent.localLLMProfileId);
        setModel(profile?.detectedModel || '');
      } else {
        setModel(existingAgent.model);
      }
      setSelectedCapabilities(existingAgent.capabilities);
      setHistoryConfig(prev => ({ ...defaultHistoryConfig, ...prev, ...(existingAgent.historyConfig || {}) }));
      setTools(existingAgent.tools || []);
      setOutputConfig(existingAgent.outputConfig || defaultOutputConfig);
    }
  }, [isEditing, existingAgent, localLLMProfiles]);

  // Reactive auto-assignment for new agents when localLLMProfiles loads asynchronously.
  // useState only runs once at mount; if profiles aren't loaded yet, localLLMProfileId stays ''
  // and the select has no matching option → blank field. This effect fixes that by assigning
  // the first enabled profile once profiles become available.
  useEffect(() => {
    if (isEditing) return;                          // Edit mode: governed by isEditing useEffect
    if (!isLMStudio(llmProvider)) return;           // Not LMStudio: no profile needed
    if (localLLMProfileId) return;                  // Profile already assigned: nothing to do
    const firstEnabled = localLLMProfiles.find(p => p.enabled);
    if (!firstEnabled) return;                      // No profiles available yet
    setLocalLLMProfileId(firstEnabled.id);
    setModel(prev => prev || firstEnabled.detectedModel || ''); // Don't overwrite if already set
    const profileCaps = (Object.entries(firstEnabled.capabilities) as [string, boolean][])
      .filter(([, v]) => v === true)
      .map(([k]) => k as LLMCapability)
      .filter(cap => Object.values(LLMCapability).includes(cap as LLMCapability));
    setSelectedCapabilities([...new Set([LLMCapability.Chat, ...profileCaps])]);
  }, [hasEnabledLocalProfiles]); // Stable boolean memo — fires only when profiles go from 0→N or N→0, not on each array reference change
  // Synchronize llmProvider with available providers
  // If current provider becomes disabled, switch to first enabled provider
  useEffect(() => {
    if (isEditing) return;

    const enabledProviders = llmConfigs.filter(c => c.enabled).map(c => c.provider);

    // Current provider still enabled
    if (enabledProviders.includes(llmProvider)) {
      return; // Stay on current provider
    }

    // CASE 2: Current provider is NO LONGER enabled → switch to first enabled provider
    if (enabledProviders.length > 0) {
      const newProvider = enabledProviders[0];

      setLlmProvider(newProvider);

      // Auto-select first model for new provider
      const availableModels = getAvailableModels(newProvider);
      if (availableModels.length > 0) {
        setModel(availableModels[0]);
      } else {
        setModel('');
      }

      // Reset capabilities to match new provider
      const newCapabilities = getAvailableCapabilities(newProvider, availableModels[0] || '');
      setSelectedCapabilities(prev => prev.filter(cap => newCapabilities.includes(cap)));

      return;
    }

    // CASE 3: NO providers are enabled at all → don't change, let parent component fix this
  }, [llmConfigs, isEditing, llmProvider, getAvailableModels, getAvailableCapabilities]);

  // Validate LMStudio capability — legacy mode only (no local profiles configured).
  // Debounced 500ms: this effect has 12 deps including all form fields (name, role, model…).
  // Without debounce, every keystroke + React Strict Mode double-mount = rapid uncached API calls.
  // The cleanup cancels the pending setTimeout on dep change, so only one call fires after 500ms of inactivity.
  useEffect(() => {
    if (isLMStudio(llmProvider) && !localLLMProfileId && !hasEnabledLocalProfiles) {
      const timeoutId = setTimeout(async () => {
        try {
          const lmStudioConfig = llmConfigs.find(c => isLMStudio(c.provider));
          const endpoint = lmStudioConfig?.localEndpoint || lmStudioConfig?.apiKey || undefined;

          const mockAgent: Agent = {
            id: 'temp',
            name,
            role,
            systemPrompt,
            llmProvider,
            model,
            capabilities: selectedCapabilities,
            tools,
            outputConfig,
            historyConfig,
            creator_id: 'archi' as RobotId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          const validation = await validateAgentCapabilities(mockAgent, endpoint);
          setLmStudioValidation(validation);
        } catch (_error) {
          setLmStudioValidation(null);
        }
      }, 500);
      return () => clearTimeout(timeoutId); // Cancel on dep change or cleanup (Strict Mode, unmount)
    } else {
      setLmStudioValidation(null);
    }
  }, [llmProvider, localLLMProfileId, hasEnabledLocalProfiles, model, selectedCapabilities, tools, outputConfig, name, role, systemPrompt, historyConfig, llmConfigs]);


  const availableCapabilities = useMemo(() => {
    return getAvailableCapabilities(llmProvider, model);
  }, [llmProvider, model, llmConfigs, lmStudioDetection, getAvailableCapabilities]);

  // Composite select value: 'local:<id>' for local profiles, provider enum for cloud
  const providerSelectValue = isLMStudio(llmProvider) && localLLMProfileId
    ? `local:${localLLMProfileId}`
    : llmProvider;

  const handleProviderChange = (value: string) => {
    if (value.startsWith('local:')) {
      const profileId = value.replace('local:', '');
      const profile = localLLMProfiles.find(p => p.id === profileId);
      if (profile) {
        setLlmProvider(LLMProvider.LMStudio);
        setLocalLLMProfileId(profileId);
        setModel(profile.detectedModel ?? '');
        setInlineDetectionError(null);
        // Populate capabilities from the profile
        const profileCaps = (Object.entries(profile.capabilities) as [string, boolean][])
          .filter(([, v]) => v === true)
          .map(([k]) => k as LLMCapability)
          .filter(cap => Object.values(LLMCapability).includes(cap as LLMCapability));
        setSelectedCapabilities([...new Set([LLMCapability.Chat, ...profileCaps])]);
        setCapabilitiesExpanded(false);
      }
      return;
    }
    // Cloud provider path
    const provider = value as LLMProvider;
    setLlmProvider(provider);
    setLocalLLMProfileId('');
    setInlineDetectionError(null);
    const availableModels = getAvailableModels(provider);
    const firstModel = availableModels.length > 0 ? availableModels[0] : '';
    setModel(firstModel);
    const newCapabilities = getAvailableCapabilities(provider, firstModel);
    setSelectedCapabilities(prev => prev.filter(cap => newCapabilities.includes(cap)));
    setCapabilitiesExpanded(false);
  };

  // Inline model detection for local profiles
  const handleInlineDetect = async () => {
    const profile = localLLMProfiles.find(p => p.id === localLLMProfileId);
    if (!profile) return;
    setIsDetectingLocalModel(true);
    setInlineDetectionError(null);
    try {
      const apiUrl = `${API_BASE_URL}/api/local-llm/detect-capabilities?endpoint=${encodeURIComponent(profile.endpoint)}`;
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
      const result = await response.json();
      if (!result.healthy || !result.modelId) {
        setInlineDetectionError(result.error || t('agentForm_localModel_notDetected'));
        return;
      }
      setModel(result.modelId);
      // Persist detectedModel to the profile (fire-and-forget)
      if (accessToken) {
        void localLLMProfileService.updateProfile(
          localLLMProfileId,
          {
            name: profile.name,
            endpoint: profile.endpoint,
            capabilities: profile.capabilities as Record<string, boolean>,
            enabled: profile.enabled,
            detectedModel: result.modelId
          },
          { useApi: true, token: accessToken }
        );
      }
    } catch (err: any) {
      setInlineDetectionError(err.message || t('agentForm_localModel_notDetected'));
    } finally {
      setIsDetectingLocalModel(false);
    }
  };

  const handleHistoryProviderChange = (provider: LLMProvider) => {
    const availableModels = getAvailableModels(provider);
    setHistoryConfig(prev => ({
      ...prev,
      llmProvider: provider,
      model: availableModels.length > 0 ? availableModels[0] : ''
    }));
  };

  const handleCapabilityToggle = (capability: LLMCapability) => {
    // Chat capability cannot be toggled
    if (capability === LLMCapability.Chat) return;
    
    const isCurrentlySelected = selectedCapabilities.includes(capability);

    if (capability === LLMCapability.FunctionCalling) {
      if (!isCurrentlySelected) { // Turning it ON
        if (tools.length === 0) {
          setTools([defaultWeatherTool]);
        }
      } else { // Turning it OFF
        setTools([]);
      }
    }

    setSelectedCapabilities(prev =>
      isCurrentlySelected
        ? prev.filter(c => c !== capability)
        : [...prev, capability]
    );
  };

  const handleToolChange = (index: number, field: keyof Tool, value: any) => {
    const newTools = [...tools];
    if (field === 'parameters' || field === 'outputSchema') {
      const key = `${field}-${index}`;
      try {
        if (value.trim() === '') {
          newTools[index] = { ...newTools[index], [field]: {} };
          setSchemaErrors(prev => ({ ...prev, [key]: null }));
          return;
        }
        const parsedSchema = JSON.parse(value);
        if (typeof parsedSchema !== 'object' || Array.isArray(parsedSchema) || parsedSchema === null) {
          throw new Error(t('agentForm_error_jsonNotObject'));
        }
        newTools[index] = { ...newTools[index], [field]: parsedSchema };
        setSchemaErrors(prev => ({ ...prev, [key]: null }));
      } catch (e) {
        newTools[index] = { ...newTools[index], [field]: value };
        const errorMessage = e instanceof Error ? e.message : 'JSON invalide';
        setSchemaErrors(prev => ({ ...prev, [key]: errorMessage }));
      }
    } else {
      newTools[index] = { ...newTools[index], [field]: value };
    }
    setTools(newTools);
  };


  const addTool = () => setTools([...tools, { ...newToolTemplate, name: `new_tool_${tools.length}` }]);
  const removeTool = (index: number) => {
    setTools(tools.filter((_, i) => i !== index));
    // Also clear any errors associated with the removed tool
    setSchemaErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[`parameters-${index}`];
      delete newErrors[`outputSchema-${index}`];
      return newErrors;
    });
  };

  const hasSchemaErrors = Object.values(schemaErrors).some(err => err !== null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setFormError(t('agentForm_alert_nameMissing'));
      return;
    }
    if (hasSchemaErrors) {
      setFormError(t('agentForm_alert_invalidJson'));
      return;
    }
    // Guard: local profile selected but no model detected yet
    if (isLMStudio(llmProvider) && localLLMProfileId && !model) {
      setFormError(t('agentForm_alert_localModelNotDetected'));
      return;
    }

    // Ensure Chat is always included
    const capabilitiesForSave = selectedCapabilities.includes(LLMCapability.Chat)
      ? selectedCapabilities
      : [LLMCapability.Chat, ...selectedCapabilities];

    onSave({
      name,
      role,
      systemPrompt,
      llmProvider,
      model,
      capabilities: capabilitiesForSave,
      historyConfig,
      tools,
      outputConfig,
      localLLMProfileId: isLMStudio(llmProvider) ? (localLLMProfileId || undefined) : undefined,
      creator_id: existingAgent?.creator_id || RobotId.Archi,
      created_at: existingAgent?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, existingAgent?.id);
  };

  const showCodestralOption = llmProvider === LLMProvider.Mistral && model === 'codestral-latest' && outputConfig.enabled;

  return (
    <Modal title={isEditing ? t('agentForm_editTitle') : t('agentForm_createTitle')} isOpen={true} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="agent-name" className="block text-sm font-medium text-gray-300 mb-1">{t('agentForm_nameLabel')}</label>
          <input id="agent-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder={t('agentForm_namePlaceholder')} />
        </div>

        <div className="border-b border-gray-700">
          <nav className="-mb-px flex space-x-6 overflow-x-auto" aria-label="Tabs">
            <button type="button" onClick={() => setActiveTab('description')} className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'description' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}>{t('agentForm_tab_description')}</button>
            <button type="button" onClick={() => setActiveTab('historique')} className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'historique' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}>{t('agentForm_tab_history')}</button>
            {selectedCapabilities.includes(LLMCapability.FunctionCalling) && <button type="button" onClick={() => setActiveTab('fonctions')} className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'fonctions' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}>{t('agentForm_tab_functions')}</button>}
            {selectedCapabilities.includes(LLMCapability.OutputFormatting) && <button type="button" onClick={() => setActiveTab('formatage')} className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'formatage' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}>{t('agentForm_tab_formatting')}</button>}
          </nav>
        </div>

        <div className="pt-2 max-h-[50vh] overflow-y-auto pr-2 space-y-4">
          {activeTab === 'description' && (
            <>
              <div>
                <label htmlFor="agent-role" className="block text-sm font-medium text-gray-300 mb-1">{t('agentForm_roleLabel')}</label>
                <input id="agent-role" type="text" value={role} onChange={(e) => setRole(e.target.value)} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder={t('agentForm_rolePlaceholder')} />
              </div>

              {/* Reconfig warning displayed above the LLM/Model row */}
              {hasReconfigNeeded && (
                <div className="p-2 bg-amber-900/40 border border-amber-500/50 rounded-md text-amber-200 text-xs leading-relaxed">
                  ⚠️ Vos clés API doivent être reconfigurées (problème de chiffrement). Rendez-vous dans les paramètres LLM pour les re-saisir.
                </div>
              )}
              {!hasReconfigNeeded && noUsableLLM && (
                <div className="p-2 bg-yellow-900/40 border border-yellow-600/50 rounded-md text-yellow-300 text-xs leading-relaxed">
                  ⚠️ Aucun LLM configuré. Veuillez configurer vos clés API dans les paramètres.
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="llm-provider" className="block text-sm font-medium text-gray-300 mb-1">{t('agentForm_llmLabel')}</label>
                  <select
                    id="llm-provider"
                    value={providerSelectValue}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {/* Cloud providers (skip LMStudio single entry) */}
                    {llmConfigs.filter(c => c.enabled && !isLocalProvider(c.provider)).map(({ provider }) => (
                      <option key={provider} value={provider}>{provider}</option>
                    ))}
                    {/* Local LLM profiles: one option per enabled profile */}
                    {localLLMProfiles.filter(p => p.enabled).map(profile => (
                      <option key={profile.id} value={`local:${profile.id}`}>{profile.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="llm-model" className="block text-sm font-medium text-gray-300 mb-1">
                    {t('agentForm_modelLabel')}
                    {isLMStudio(llmProvider) && isLoadingLMStudioModels && (
                      <span className="ml-2 text-xs text-cyan-400">⌛ Chargement modèles...</span>
                    )}
                  </label>
                  {/* Local profile selected: show detectedModel or inline detection button */}
                  {isLMStudio(llmProvider) && localLLMProfileId ? (
                    <div className="space-y-2">
                      {model ? (
                        <div className="w-full p-2 bg-gray-700 border border-green-600/50 rounded-md text-green-400 text-sm flex items-center gap-2">
                          ✅ <span className="font-mono truncate">{model}</span>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="w-full p-2 bg-gray-900/50 border border-red-500/50 rounded-md text-red-400 text-xs">
                            {t('agentForm_localModel_notDetected')}
                          </div>
                          <button
                            type="button"
                            onClick={handleInlineDetect}
                            disabled={isDetectingLocalModel}
                            className="w-full px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
                            style={{
                              background: isDetectingLocalModel
                                ? 'linear-gradient(90deg, rgba(6,182,212,0.3), rgba(59,130,246,0.3))'
                                : 'linear-gradient(90deg, #06b6d4, #3b82f6)'
                            }}
                          >
                            {isDetectingLocalModel ? `🔍 ${t('agentForm_localModel_detecting')}` : `🔍 ${t('agentForm_localModel_detect')}`}
                          </button>
                        </div>
                      )}
                      {/* Re-detect button when model exists */}
                      {model && (
                        <button
                          type="button"
                          onClick={handleInlineDetect}
                          disabled={isDetectingLocalModel}
                          className="text-xs text-cyan-400 hover:text-cyan-300 underline disabled:opacity-60"
                        >
                          {isDetectingLocalModel ? t('agentForm_localModel_detecting') : t('agentForm_localModel_redetect')}
                        </button>
                      )}
                      {inlineDetectionError && (
                        <p className="text-xs text-red-400">{inlineDetectionError}</p>
                      )}
                    </div>
                  ) : (
                    /* Cloud / legacy LMStudio path */
                    <select
                      id="llm-model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      disabled={isLoadingLMStudioModels}
                    >
                      {isLMStudio(llmProvider) && lmStudioDynamicModels.length > 0 ? (
                        lmStudioDynamicModels.map((modelDef) => (
                          <option key={modelDef.id} value={modelDef.id}>
                            {modelDef.name} {modelDef.isDynamic ? '' : '(Statique)'}
                          </option>
                        ))
                      ) : (
                        getAvailableModels(llmProvider).map((modelName) => <option key={modelName} value={modelName}>{modelName}</option>)
                      )}
                    </select>
                  )}
                </div>
              </div>

              {/* Model Capabilities Info (Universal Collapsible) */}
              {availableCapabilities.length > 0 && (
                <div className={`border rounded-lg ${llmProvider === LLMProvider.Gemini ? 'bg-gradient-to-r from-blue-900/30 to-indigo-900/30 border-blue-500/30' :
                  llmProvider === LLMProvider.ArcLLM ? 'bg-gradient-to-r from-purple-900/30 to-cyan-900/30 border-purple-500/30' :
                    llmProvider === LLMProvider.OpenAI ? 'bg-gradient-to-r from-green-900/30 to-emerald-900/30 border-green-500/30' :
                      llmProvider === LLMProvider.Anthropic ? 'bg-gradient-to-r from-orange-900/30 to-amber-900/30 border-orange-500/30' :
                        'bg-gradient-to-r from-gray-900/30 to-slate-900/30 border-gray-500/30'
                  }`}>
                  <button
                    type="button"
                    onClick={() => setCapabilitiesExpanded(!capabilitiesExpanded)}
                    className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-white/5 transition-colors rounded-lg"
                  >
                    <h4 className={`text-xs font-semibold flex items-center gap-2 ${llmProvider === LLMProvider.Gemini ? 'text-blue-300' :
                      llmProvider === LLMProvider.ArcLLM ? 'text-purple-300' :
                        llmProvider === LLMProvider.OpenAI ? 'text-green-300' :
                          llmProvider === LLMProvider.Anthropic ? 'text-orange-300' :
                            'text-gray-300'
                      }`}>
                      <span className={`${llmProvider === LLMProvider.Gemini ? 'text-indigo-400' :
                        llmProvider === LLMProvider.ArcLLM ? 'text-cyan-400' :
                          llmProvider === LLMProvider.OpenAI ? 'text-emerald-400' :
                            llmProvider === LLMProvider.Anthropic ? 'text-amber-400' :
                              'text-gray-400'
                        }`}>✨</span>
                      Capacités multimodales {llmProvider}
                    </h4>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${capabilitiesExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {capabilitiesExpanded && (
                    <div className="px-3 pb-3 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {availableCapabilities.map(cap => (
                          <span key={cap} className={`px-2 py-1 text-xs rounded-md border ${llmProvider === LLMProvider.Gemini ? 'bg-blue-500/20 text-blue-200 border-blue-400/30' :
                            llmProvider === LLMProvider.ArcLLM ? 'bg-purple-500/20 text-purple-200 border-purple-400/30' :
                              llmProvider === LLMProvider.OpenAI ? 'bg-green-500/20 text-green-200 border-green-400/30' :
                                llmProvider === LLMProvider.Anthropic ? 'bg-orange-500/20 text-orange-200 border-orange-400/30' :
                                  'bg-gray-500/20 text-gray-200 border-gray-400/30'
                            }`}>
                            {typeof cap === 'string' ? getCapabilityLabel(cap) : LLMCapability[cap]}
                          </span>
                        ))}
                      </div>
                      {llmProvider === LLMProvider.Gemini && model === 'gemini-2.5-flash' && (
                        <p className="text-xs text-gray-400">
                          Génération vidéo + édition, recherche Maps/Web avec Google Search
                        </p>
                      )}
                      {llmProvider === LLMProvider.ArcLLM && model === 'arc-video-v1' && (
                        <p className="text-xs text-gray-400">
                          Génération de vidéos haute résolution avec images de référence
                        </p>
                      )}
                      {llmProvider === LLMProvider.ArcLLM && model === 'arc-grounding-v1' && (
                        <p className="text-xs text-gray-400">
                          Recherches temps réel avec Maps et Web Search
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* LMStudio Auto-Detection Panel (HUD Style) — legacy mode only */}
              {llmProvider === LLMProvider.LMStudio && lmStudioEndpoint && (
                <div className="relative p-4 rounded-lg overflow-hidden" style={{
                  background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%)',
                  border: '1px solid rgba(6, 182, 212, 0.4)'
                }}>
                  {/* Holographic scan overlay */}
                  {isDetectingLMStudio && (
                    <div className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{
                      background: 'linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.2), transparent)',
                      animation: 'scan-pass 3s ease-in-out infinite'
                    }} />
                  )}

                  <h4 className="text-cyan-400 flex items-center gap-2 mb-3">
                    🤖 Capacités Détectées
                    <span className="px-2 py-0.5 text-xs font-bold rounded-full" style={{
                      background: 'rgba(34, 197, 94, 0.2)',
                      border: '1px solid rgba(34, 197, 94, 0.5)',
                      color: '#4ade80',
                      boxShadow: '0 0 8px rgba(34, 197, 94, 0.4)'
                    }}>
                      ⚡ AUTO
                    </span>
                  </h4>

                  {/* Skeleton UI during detection */}
                  {isDetectingLMStudio && !lmStudioDetection && (
                    <div className="space-y-3">
                      <div className="h-4 rounded" style={{
                        background: 'linear-gradient(90deg, rgba(100, 100, 100, 0.3) 25%, rgba(150, 150, 150, 0.5) 50%, rgba(100, 100, 100, 0.3) 75%)',
                        backgroundSize: '200% 100%',
                        animation: 'skeleton-wave 1.5s ease-in-out infinite'
                      }} />
                      <div className="grid grid-cols-2 gap-3">
                        {[1, 2, 3, 4].map(i => (
                          <div key={i} className="h-10 rounded-lg" style={{
                            background: 'linear-gradient(90deg, rgba(100, 100, 100, 0.3) 25%, rgba(150, 150, 150, 0.5) 50%, rgba(100, 100, 100, 0.3) 75%)',
                            backgroundSize: '200% 100%',
                            animation: `skeleton-wave 1.5s ease-in-out infinite ${i * 0.2}s`
                          }} />
                        ))}
                      </div>
                      {/* Laser scan line */}
                      <div className="absolute top-0 left-0 w-full h-0.5" style={{
                        background: 'linear-gradient(90deg, transparent, #06b6d4, transparent)',
                        animation: 'scan-vertical 2s linear infinite'
                      }} />
                    </div>
                  )}

                  {/* Detected capabilities grid */}
                  {lmStudioDetection && !isDetectingLMStudio && (
                    <div className="grid grid-cols-2 gap-3">
                      {lmStudioDetection.capabilities.map((cap, index) => (
                        <div
                          key={cap}
                          className="flex items-center gap-2 p-2.5 rounded-lg"
                          style={{
                            background: 'rgba(6, 182, 212, 0.1)',
                            border: '1px solid rgba(6, 182, 212, 0.3)',
                            animation: `capability-check 0.6s ease-out ${index * 0.15}s both`,
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
                          }}
                        >
                          {/* Animated checkmark */}
                          <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center" style={{
                            background: 'rgba(34, 197, 94, 0.3)',
                            border: '2px solid #4ade80'
                          }}>
                            <span className="text-green-400 text-xs font-bold">✓</span>
                          </span>

                          {/* Capability label */}
                          <span className="text-cyan-300 text-sm font-medium">
                            {cap === LLMCapability.Chat && '💬 Chat'}
                            {cap === LLMCapability.FunctionCalling && '🛠️ Functions'}
                            {cap === LLMCapability.OutputFormatting && '📋 JSON Mode'}
                            {cap === LLMCapability.Embedding && '🧮 Embeddings'}
                            {cap === LLMCapability.ImageGeneration && '🎨 Images'}
                            {cap === LLMCapability.OCR && '🔍 OCR'}
                            {cap === LLMCapability.CodeSpecialization && '💻 Code'}
                            {cap === LLMCapability.ExtendedThinking && '💭 Extended Thinking'}
                            {cap === LLMCapability.PDFSupport && '📄 PDF Support'}
                            {cap === LLMCapability.StructuredOutputs && '🔖 Structured Outputs'}
                            {cap === LLMCapability.WebFetchTool && '🌐 Web Fetch'}
                            {cap === LLMCapability.WebSearchToolAnthropic && '🔍 Web Search'}
                            {!Object.values(LLMCapability).includes(cap) && cap}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Warning if limited capabilities */}
                  {lmStudioDetection && lmStudioDetection.capabilities.length < 3 && (
                    <div className="mt-3 px-3 py-2 rounded-md" style={{
                      background: 'rgba(251, 191, 36, 0.1)',
                      border: '1px solid rgba(251, 191, 36, 0.4)'
                    }}>
                      <span className="text-yellow-400 text-xs">⚠️ Certaines capacités avancées non disponibles</span>
                    </div>
                  )}

                  {/* Re-detect button */}
                  <button
                    onClick={redetectLMStudio}
                    disabled={isDetectingLMStudio}
                    className="mt-3 px-4 py-2 rounded-md text-sm font-medium transition-all duration-300"
                    style={{
                      background: 'linear-gradient(90deg, rgba(6, 182, 212, 0.2), rgba(59, 130, 246, 0.2))',
                      border: '1px solid rgba(6, 182, 212, 0.5)',
                      color: '#06b6d4',
                      cursor: isDetectingLMStudio ? 'not-allowed' : 'pointer',
                      opacity: isDetectingLMStudio ? 0.6 : 1
                    }}
                    onMouseEnter={(e) => {
                      if (!isDetectingLMStudio) {
                        e.currentTarget.style.boxShadow = '0 0 15px rgba(6, 182, 212, 0.6)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = 'none';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    🔄 Re-détecter les capacités
                  </button>
                </div>
              )}

              {/* Template adaptation notice */}
              {isEditing && existingAgent?.id === 'temp' && (
                <div className="p-3 bg-blue-900/30 border border-blue-500/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 text-blue-400">ℹ️</div>
                    <span className="text-blue-300 text-sm">
                      Template adapté automatiquement selon vos configurations LLM disponibles
                    </span>
                  </div>
                </div>
              )}

              {/* LMStudio validation warnings */}
              {llmProvider === LLMProvider.LMStudio && lmStudioValidation && (
                <div className="space-y-2">
                  {lmStudioValidation.warnings.length > 0 && (
                    <div className="p-3 bg-yellow-900/30 border border-yellow-700 rounded-md">
                      <h4 className="text-sm font-medium text-yellow-300 mb-2">⚠️ Avertissements de compatibilité</h4>
                      <ul className="text-xs text-yellow-200 space-y-1">
                        {lmStudioValidation.warnings.map((warning, i) => (
                          <li key={i}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {lmStudioValidation.suggestions.length > 0 && (
                    <div className="p-3 bg-blue-900/30 border border-blue-700 rounded-md">
                      <h4 className="text-sm font-medium text-blue-300 mb-2">💡 Suggestions</h4>
                      <ul className="text-xs text-blue-200 space-y-1">
                        {lmStudioValidation.suggestions.map((suggestion, i) => (
                          <li key={i}>• {suggestion}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {availableCapabilities.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('agentForm_capabilitiesLabel')}</label>
                  <div className="space-y-2 p-3 bg-gray-900/50 rounded-md max-h-32 overflow-y-auto">
                    {/* Chat is always enabled and required */}
                    <label className="flex items-center cursor-not-allowed bg-gray-800/30 p-2 rounded">
                      <input
                        type="checkbox"
                        checked={true}
                        disabled={true}
                        className="h-4 w-4 rounded border-green-600 bg-gray-700 text-green-600 focus:ring-green-500"
                      />
                      <span className="ml-3 text-sm text-green-400 font-semibold">
                        💬 Chat (obligatoire)
                      </span>
                    </label>
                    
                    {availableCapabilities.map(cap => (
                      cap !== LLMCapability.Chat && (
                        <label key={cap} className="flex items-center cursor-pointer hover:bg-gray-800 p-2 rounded">
                          <input
                            type="checkbox"
                            checked={selectedCapabilities.includes(cap)}
                            onChange={() => handleCapabilityToggle(cap)}
                            className="h-4 w-4 rounded border-gray-500 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="ml-3 text-sm text-gray-300">
                            {typeof cap === 'string' ? getCapabilityLabel(cap) : LLMCapability[cap]}
                          </span>
                        </label>
                      )
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label htmlFor="system-prompt" className="block text-sm font-medium text-gray-300 mb-1">{t('agentForm_systemPromptLabel')}</label>
                <textarea id="system-prompt" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={5} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder={t('agentForm_systemPromptPlaceholder')} />
              </div>
            </>
          )}
          {activeTab === 'historique' && (
            <div className="space-y-4">
              <ToggleSwitch label={t('agentForm_history_enableLabel')} checked={historyConfig.enabled} onChange={(c) => setHistoryConfig(p => ({ ...p, enabled: c }))} />
              {historyConfig.enabled && (
                <div className="p-3 bg-gray-900/50 rounded-lg space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">{t('agentForm_history_thresholdsLabel')}</label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {Object.keys(historyConfig.limits).map(key => (
                        <div key={key}>
                          <label htmlFor={`limit-${key}`} className="text-xs text-gray-400 capitalize">{key}</label>
                          <input
                            id={`limit-${key}`}
                            type="number"
                            value={historyConfig.limits[key as keyof typeof historyConfig.limits]}
                            onChange={e => setHistoryConfig(p => ({ ...p, limits: { ...p.limits, [key]: parseInt(e.target.value) || 0 } }))}
                            className="w-full p-1.5 mt-1 text-sm bg-gray-700 border border-gray-600 rounded-md"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">{t('agentForm_history_synthesisConfigLabel')}</label>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="hist-llm-provider" className="text-xs text-gray-400">{t('agentForm_history_synthesisLlmLabel')}</label>
                        <select id="hist-llm-provider" value={historyConfig.llmProvider} onChange={(e) => handleHistoryProviderChange(e.target.value as LLMProvider)} className="w-full p-1.5 mt-1 text-sm bg-gray-700 border border-gray-600 rounded-md">
                          {llmConfigs.filter(c => c.enabled).map(({ provider }) => <option key={provider} value={provider}>{provider}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="hist-llm-model" className="text-xs text-gray-400">{t('agentForm_history_synthesisModelLabel')}</label>
                        <select id="hist-llm-model" value={historyConfig.model} onChange={e => setHistoryConfig(p => ({ ...p, model: e.target.value }))} className="w-full p-1.5 mt-1 text-sm bg-gray-700 border border-gray-600 rounded-md">
                          {getAvailableModels(historyConfig.llmProvider).map((modelName) => <option key={modelName} value={modelName}>{modelName}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="mt-2">
                      <label htmlFor="hist-sys-prompt" className="text-xs text-gray-400">{t('agentForm_history_synthesisPromptLabel')}</label>
                      <textarea id="hist-sys-prompt" value={historyConfig.systemPrompt} onChange={e => setHistoryConfig(p => ({ ...p, systemPrompt: e.target.value }))} rows={4} className="w-full p-1.5 mt-1 text-sm bg-gray-700 border border-gray-600 rounded-md" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {activeTab === 'formatage' && (
            <div className="space-y-4">
              <ToggleSwitch label={t('agentForm_formatting_enableLabel')} checked={outputConfig.enabled} onChange={(c) => setOutputConfig(p => ({ ...p, enabled: c }))} />
              {outputConfig.enabled && (
                <div className="p-3 bg-gray-900/50 rounded-lg space-y-4">
                  <div>
                    <label htmlFor="output-format" className="block text-sm font-medium text-gray-300 mb-1">{t('agentForm_formatting_formatLabel')}</label>
                    <select id="output-format" value={outputConfig.format} onChange={(e) => setOutputConfig(p => ({ ...p, format: e.target.value as OutputFormat }))} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md">
                      {outputFormats.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  {showCodestralOption && (
                    <div className="pt-2">
                      <ToggleSwitch
                        label={t('agentForm_formatting_useCodestral')}
                        checked={outputConfig.useCodestralCompletion || false}
                        onChange={(c) => setOutputConfig(p => ({ ...p, useCodestralCompletion: c }))}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {activeTab === 'fonctions' && (
            <div className="space-y-4">
              {tools.map((tool, index) => (
                <div key={index} className="p-3 bg-gray-900/50 rounded-lg space-y-2 relative">
                  <Button variant="ghost" className="absolute top-1 right-1 p-1 h-6 w-6 text-red-400" onClick={() => removeTool(index)}><CloseIcon width={14} height={14} /></Button>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">{t('agentForm_functions_toolNameLabel')}</label>
                      <input type="text" value={tool.name} onChange={(e) => handleToolChange(index, 'name', e.target.value)} className="w-full p-1.5 text-sm bg-gray-700 border border-gray-600 rounded-md" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">{t('agentForm_functions_descriptionLabel')}</label>
                      <input type="text" value={tool.description} onChange={(e) => handleToolChange(index, 'description', e.target.value)} className="w-full p-1.5 text-sm bg-gray-700 border border-gray-600 rounded-md" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">{t('agentForm_functions_parametersLabel')}</label>
                      <textarea
                        value={typeof tool.parameters === 'string' ? tool.parameters : JSON.stringify(tool.parameters, null, 2)}
                        onChange={(e) => handleToolChange(index, 'parameters', e.target.value)}
                        rows={6}
                        className={`w-full p-1.5 font-mono text-xs bg-gray-800 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${schemaErrors[`parameters-${index}`] ? 'border-red-500' : 'border-gray-600'}`}
                      />
                      {schemaErrors[`parameters-${index}`] && <p className="text-xs text-red-400 mt-1">{schemaErrors[`parameters-${index}`]}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">{t('agentForm_functions_outputSchemaLabel')}</label>
                      <textarea
                        value={typeof tool.outputSchema === 'string' ? tool.outputSchema : JSON.stringify(tool.outputSchema, null, 2)}
                        onChange={(e) => handleToolChange(index, 'outputSchema', e.target.value)}
                        rows={6}
                        className={`w-full p-1.5 font-mono text-xs bg-gray-800 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${schemaErrors[`outputSchema-${index}`] ? 'border-red-500' : 'border-gray-600'}`}
                        placeholder={`{ "type": "object", "properties": { ... } }`}
                      />
                      {schemaErrors[`outputSchema-${index}`] && <p className="text-xs text-red-400 mt-1">{schemaErrors[`outputSchema-${index}`]}</p>}
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-xs text-gray-400 pt-2">{t('agentForm_functions_pythonNote')}</p>
              <Button type="button" variant="secondary" onClick={addTool} className="flex items-center gap-2"><PlusIcon /> {t('agentForm_functions_addTool')}</Button>
            </div>
          )}
        </div>

        {formError && <p className="text-sm text-red-400 text-center">{formError}</p>}

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-700 mt-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || hasSchemaErrors}>{isEditing ? t('agentForm_saveButton') : t('agentForm_createButton')}</Button>
        </div>
      </form>
    </Modal>
  );
};