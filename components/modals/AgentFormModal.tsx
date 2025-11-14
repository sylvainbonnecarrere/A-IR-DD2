import React, { useState, useMemo, useEffect } from 'react';
import { Agent, LLMConfig, LLMProvider, LLMCapability, HistoryConfig, Tool, OutputConfig, OutputFormat, RobotId } from '../../types';
import { Button, Modal, ToggleSwitch } from '../UI';
import { LLM_MODELS, LLM_MODELS_DETAILED, getModelCapabilities } from '../../llmModels';
import { CloseIcon, PlusIcon } from '../Icons';
import { useLocalization } from '../../hooks/useLocalization';
import { validateAgentCapabilities, type CapabilityValidationResult } from '../../utils/lmStudioCapabilityValidator';

interface AgentFormModalProps {
  onClose: () => void;
  onSave: (agent: Omit<Agent, 'id'>, agentId?: string) => void;
  llmConfigs: LLMConfig[];
  existingAgent: Agent | null;
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

export const AgentFormModal = ({ onClose, onSave, llmConfigs, existingAgent }: AgentFormModalProps) => {
  const { t } = useLocalization();
  const enabledLLMProvider = llmConfigs.find(c => c.enabled)?.provider || LLMProvider.Gemini;

  // Helper function to get available models for a provider (only if configured)
  const getAvailableModels = (provider: LLMProvider): string[] => {
    const config = llmConfigs.find(c => c.provider === provider && c.enabled && c.apiKey);

    if (!config) {
      return []; // Return empty array if provider not configured
    }
    const models = LLM_MODELS[provider] || [];
    return models;
  };

  // Helper function to get available capabilities for a provider (only if configured)  
  const getAvailableCapabilities = (provider: LLMProvider, selectedModel?: string): LLMCapability[] => {
    const config = llmConfigs.find(c => c.provider === provider && c.enabled && c.apiKey);
    if (!config) {
      return []; // Return empty array if provider not configured
    }

    // If a specific model is selected, use its capabilities from LLM_MODELS_DETAILED
    if (selectedModel) {
      const modelCapabilities = getModelCapabilities(provider, selectedModel);
      if (modelCapabilities.length > 0) {
        return modelCapabilities;
      }
    }

    // Fallback: Return only capabilities that are enabled in the config
    const caps = Object.keys(config.capabilities)
      .filter(cap => config.capabilities[cap as LLMCapability])
      .map(cap => cap as LLMCapability);
    return caps;
  };

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [llmProvider, setLlmProvider] = useState<LLMProvider>(enabledLLMProvider);
  const [model, setModel] = useState<string>(() => {
    const availableModels = getAvailableModels(enabledLLMProvider);
    return availableModels.length > 0 ? availableModels[0] : '';
  });
  const [selectedCapabilities, setSelectedCapabilities] = useState<LLMCapability[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [outputConfig, setOutputConfig] = useState<OutputConfig>(defaultOutputConfig);
  const [historyConfig, setHistoryConfig] = useState<HistoryConfig>(() => {
    const availableModels = getAvailableModels(enabledLLMProvider);
    return {
      ...defaultHistoryConfig,
      llmProvider: enabledLLMProvider,
      model: availableModels.length > 0 ? availableModels[0] : '',
    };
  }); const [activeTab, setActiveTab] = useState<'description' | 'historique' | 'fonctions' | 'formatage'>('description');
  const [schemaErrors, setSchemaErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [lmStudioValidation, setLmStudioValidation] = useState<CapabilityValidationResult | null>(null);
  const [capabilitiesExpanded, setCapabilitiesExpanded] = useState(false);
  const isEditing = !!existingAgent;

  useEffect(() => {
    if (isEditing && existingAgent) {
      setName(existingAgent.name);
      setRole(existingAgent.role);
      setSystemPrompt(existingAgent.systemPrompt);
      setLlmProvider(existingAgent.llmProvider);
      setModel(existingAgent.model);
      setSelectedCapabilities(existingAgent.capabilities);
      setHistoryConfig(prev => ({ ...defaultHistoryConfig, ...prev, ...(existingAgent.historyConfig || {}) }));
      setTools(existingAgent.tools || []);
      setOutputConfig(existingAgent.outputConfig || defaultOutputConfig);
    }
  }, [isEditing, existingAgent]);

  // LMStudio capability validation effect
  useEffect(() => {
    if (llmProvider === LLMProvider.LMStudio) {
      const validateLMStudio = async () => {
        try {
          // Get endpoint from llmConfigs (stored in apiKey field for LMStudio)
          const lmStudioConfig = llmConfigs.find(c => c.provider === LLMProvider.LMStudio);
          const endpoint = lmStudioConfig?.apiKey || undefined;

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
        } catch (error) {
          console.warn('LMStudio validation failed:', error);
          setLmStudioValidation(null);
        }
      };

      validateLMStudio();
    } else {
      setLmStudioValidation(null);
    }
  }, [llmProvider, model, selectedCapabilities, tools, outputConfig, name, role, systemPrompt, historyConfig, llmConfigs]);


  const availableCapabilities = useMemo(() => {
    return getAvailableCapabilities(llmProvider, model);
  }, [llmProvider, model, llmConfigs]);

  const handleProviderChange = (provider: LLMProvider) => {
    setLlmProvider(provider);
    const availableModels = getAvailableModels(provider);
    const firstModel = availableModels.length > 0 ? availableModels[0] : '';
    setModel(firstModel);
    setSelectedCapabilities(prev => prev.filter(cap => getAvailableCapabilities(provider, firstModel).includes(cap)));
    setCapabilitiesExpanded(false); // Reset accordion when changing provider
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
    const isCurrentlySelected = selectedCapabilities.includes(capability);

    if (capability === LLMCapability.FunctionCalling) {
      if (!isCurrentlySelected) { // Turning it ON
        // If no tools are defined yet, add the default weather tool as an example.
        if (tools.length === 0) {
          setTools([defaultWeatherTool]);
        }
      } else { // Turning it OFF
        // Clear all tools when function calling is disabled
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

    onSave({
      name,
      role,
      systemPrompt,
      llmProvider,
      model,
      capabilities: selectedCapabilities,
      historyConfig,
      tools,
      outputConfig,
      creator_id: existingAgent?.creator_id || RobotId.Archi, // Default to Archi for new agents
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
          <nav className="-mb-px flex space-x-6" aria-label="Tabs">
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="llm-provider" className="block text-sm font-medium text-gray-300 mb-1">{t('agentForm_llmLabel')}</label>
                  <select id="llm-provider" value={llmProvider} onChange={(e) => handleProviderChange(e.target.value as LLMProvider)} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    {llmConfigs.filter(c => c.enabled && c.apiKey).map(({ provider }) => <option key={provider} value={provider}>{provider}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="llm-model" className="block text-sm font-medium text-gray-300 mb-1">{t('agentForm_modelLabel')}</label>
                  <select id="llm-model" value={model} onChange={(e) => setModel(e.target.value)} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    {getAvailableModels(llmProvider).map((modelName) => <option key={modelName} value={modelName}>{modelName}</option>)}
                  </select>
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
                            {cap}
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
                    {availableCapabilities.map(cap => (
                      <label key={cap} className="flex items-center">
                        <input
                          type="checkbox"
                          checked={selectedCapabilities.includes(cap)}
                          onChange={() => handleCapabilityToggle(cap)}
                          className="h-4 w-4 rounded border-gray-500 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="ml-3 text-sm text-gray-300">
                          {cap}
                        </span>
                      </label>
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
                          {llmConfigs.filter(c => c.enabled && c.apiKey).map(({ provider }) => <option key={provider} value={provider}>{provider}</option>)}
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