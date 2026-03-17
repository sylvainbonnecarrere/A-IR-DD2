import React, { useState, useMemo, useEffect } from 'react';
import { Button, ToggleSwitch } from '../UI';
import { CloseIcon, PlusIcon } from '../Icons';
import { useDesignStore } from '../../stores/useDesignStore';
import { useRuntimeStore } from '../../stores/useRuntimeStore';
import { useLocalization } from '../../hooks/useLocalization';
import { useAuth } from '../../hooks/useAuth';
import { useNotifications } from '../../contexts/NotificationContext';
import { AgentInstance, LLMProvider, Tool, LLMCapability, LLMConfig, OutputFormat, HistoryConfig, PersistenceConfig, defaultPersistenceConfig, LocalLLMProfile } from '../../types';
import { LLM_MODELS, getModelCapabilities, getLMStudioMergedModels, getCapabilitiesForLLM } from '../../llmModels';
import { useLMStudioDetection } from '../../hooks/useLMStudioDetection';
import { initializeHistoryConfig, validateAndRepairHistoryConfig, prepareHistoryConfigForSave } from '../../utils/historyConfigDefaults';
import { API_BASE_URL } from '../../config/api.config';
import { buildGovernanceHeaders } from '../../utils/governanceHeaders';
import { isLocalProvider, isLMStudio } from '../../utils/llmProviderUtils';
import * as localLLMProfileService from '../../services/localLLMProfileService';
import { AgentPersistenceForm } from './AgentPersistenceForm';
import { FunctionSelector } from '../FunctionSelector';

type TabId = 'config' | 'historique' | 'fonctions' | 'formatage' | 'persistence' | 'links' | 'tasks' | 'logs' | 'errors';

/**
 * Modal de Configuration Enrichie par Instance
 * 
 * Principe SOLID :
 * - Chaque instance a sa propre configuration (clone du prototype)
 * - Modifications isolées : pas d'impact sur le prototype d'origine
 * - Structure extensible : onglets futurs (Liens, Tâches, Logs, Erreurs)
 * 
 * Rendu au niveau App.tsx pour affichage en vrai plein écran
 */
export const AgentConfigurationModal: React.FC<{ llmConfigs: LLMConfig[]; localLLMProfiles?: LocalLLMProfile[] }> = ({ llmConfigs, localLLMProfiles = [] }) => {
    const { t } = useLocalization();
    const { getResolvedInstance, updateInstanceConfig, updateAgentInstance } = useDesignStore();
    const { configModalInstanceId, setConfigModalInstanceId } = useRuntimeStore();
    const { user, accessToken } = useAuth();
    const { addNotification } = useNotifications();

    // Tous les hooks DOIVENT être appelés avant les early returns
    const [activeTab, setActiveTab] = useState<TabId>('config');
    const [hasChanges, setHasChanges] = useState(false);
    const [editedName, setEditedName] = useState('');
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);

    // J6: Function Inheritance
    const [inheritFromPrototype, setInheritFromPrototype] = useState(true);
    const [overrideFunctionIds, setOverrideFunctionIds] = useState<string[]>([]);

    // Récupérer l'instance et le prototype (peut être null)
    const resolved = configModalInstanceId ? getResolvedInstance(configModalInstanceId) : null;

    // Configuration initiale (utilisée uniquement pour l'initialisation du useState)
    const config = {
        role: '',
        model: '',
        llmProvider: LLMProvider.OpenAI,
        systemPrompt: '',
        tools: [],
        position: { x: 0, y: 0 },
        links: [],
        tasks: [],
        logs: [],
        errors: []
    };

    const [editedConfig, setEditedConfig] = useState(config);
    
    const [editedPersistenceConfig, setEditedPersistenceConfig] = useState<PersistenceConfig>(defaultPersistenceConfig);

    // Synchronise editedConfig and editedName when instance changes
    useEffect(() => {
        if (!configModalInstanceId) return;

        const currentResolved = getResolvedInstance(configModalInstanceId);
        if (!currentResolved) return;

        const instanceConfig = currentResolved.instance.configuration_json;
        const prototypeConfig = currentResolved.prototype;
        
        // Initialize historyConfig with smart defaults
        const enabledProviders = Array.from(new Set([
          instanceConfig?.llmProvider || prototypeConfig.llmProvider,
          prototypeConfig.llmProvider,
          LLMProvider.Gemini
        ])).filter(Boolean) as LLMProvider[];
        
        const historyConfigValue = instanceConfig?.historyConfig 
          ? validateAndRepairHistoryConfig(instanceConfig.historyConfig, enabledProviders)
          : (prototypeConfig.historyConfig 
            ? validateAndRepairHistoryConfig(prototypeConfig.historyConfig, enabledProviders)
            : initializeHistoryConfig(undefined, enabledProviders));
        
        // Resolve LMStudio provider + local profile ID, with auto-assignment for legacy agents
        const resolvedLLMProvider = (instanceConfig?.llmProvider || prototypeConfig.llmProvider || 'openai') as LLMProvider;
        let resolvedLocalLLMProfileId = instanceConfig?.localLLMProfileId ?? prototypeConfig.localLLMProfileId ?? '';
        // Legacy LMStudio agent (created before multi-profile feature) has no profileId → auto-assign first enabled profile
        if (isLMStudio(resolvedLLMProvider) && !resolvedLocalLLMProfileId) {
            const firstEnabled = localLLMProfiles.find(p => p.enabled);
            if (firstEnabled) resolvedLocalLLMProfileId = firstEnabled.id;
        }
        // Fix model: if LMStudio+profile is set but model is empty, fall back to profile.detectedModel
        const rawModel = instanceConfig?.model || prototypeConfig.model || '';
        const resolvedModel = (!rawModel && isLMStudio(resolvedLLMProvider) && resolvedLocalLLMProfileId)
            ? (localLLMProfiles.find(p => p.id === resolvedLocalLLMProfileId)?.detectedModel || '')
            : rawModel;

        const currentConfig = {
            role: instanceConfig?.role || prototypeConfig.role || '',
            model: resolvedModel,
            llmProvider: resolvedLLMProvider,
            systemPrompt: instanceConfig?.systemPrompt || prototypeConfig.systemPrompt || '',
            tools: JSON.parse(JSON.stringify(instanceConfig?.tools || prototypeConfig.tools || [])),
            outputConfig: instanceConfig?.outputConfig
                ? JSON.parse(JSON.stringify(instanceConfig.outputConfig))
                : (prototypeConfig.outputConfig ? JSON.parse(JSON.stringify(prototypeConfig.outputConfig)) : undefined),
            capabilities: instanceConfig?.capabilities
                ? [...instanceConfig.capabilities]
                : (prototypeConfig.capabilities ? [...prototypeConfig.capabilities] : []),
            // historyConfig always initialized with smart defaults
            historyConfig: historyConfigValue,
            localLLMProfileId: resolvedLocalLLMProfileId,
            position: currentResolved.instance.position,
            links: instanceConfig?.links || [],
            tasks: instanceConfig?.tasks || [],
            logs: instanceConfig?.logs || [],
            errors: instanceConfig?.errors || []
        };

        setEditedConfig(currentConfig);
        setEditedName(currentResolved.instance.name);
        
        const instancePersistence = currentResolved.instance.persistenceConfig;
        const prototypePersistence = prototypeConfig.persistenceConfig;
        setEditedPersistenceConfig({
            ...defaultPersistenceConfig,
            ...(prototypePersistence || {}),
            ...(instancePersistence || {})
        });

        // J6: Load function inheritance state
        const fi = instanceConfig?.functionInheritance;
        setInheritFromPrototype(fi?.inheritFromPrototype !== false);
        setOverrideFunctionIds(fi?.overrideFunctionIds || []);

        setHasChanges(false);
    }, [configModalInstanceId, getResolvedInstance, localLLMProfiles]);

    // Recalculate capabilities when LLM provider or model changes
    // This ensures buttons show/hide correctly when user changes LLM in the modal
    useEffect(() => {
        if (!editedConfig.llmProvider || !editedConfig.model) return;
        
        const newCapabilities = getCapabilitiesForLLM(
            editedConfig.llmProvider as LLMProvider,
            editedConfig.model
        );
        
        // Only update if capabilities actually changed
        const currentCaps = JSON.stringify(editedConfig.capabilities?.sort());
        const newCaps = JSON.stringify(newCapabilities.sort());
        
        if (currentCaps !== newCaps) {
            setEditedConfig(prev => ({
                ...prev,
                capabilities: newCapabilities
            }));
            setHasChanges(true);
        }
    }, [editedConfig.llmProvider, editedConfig.model]);

    // Early returns APRÈS tous les hooks
    if (!configModalInstanceId) return null;

    if (!resolved) {
        return (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
                <div className="bg-gray-800 p-6 rounded-lg">
                    <p className="text-red-400">{t('agentConfig_instanceNotFound')}</p>
                    <Button onClick={() => setConfigModalInstanceId(null)} className="mt-4">{t('agentConfig_closeButton')}</Button>
                </div>
            </div>
        );
    }

    const { instance, prototype } = resolved;

    const handleSave = async () => {
        // 1. Sauvegarder le nom de l'agent (niveau instance, pas config)
        if (editedName !== instance.name) {
            updateAgentInstance(configModalInstanceId, { name: editedName });
        }
        
        updateAgentInstance(configModalInstanceId, { persistenceConfig: editedPersistenceConfig });

        // Prepare configuration to save (preserve runtime data and validate history settings)
        const enabledProvidersList = llmConfigs
          .filter(c => c.enabled)
          .map(c => c.provider) as any[];
        
        const configToSave = {
            ...editedConfig,
            historyConfig: prepareHistoryConfigForSave(editedConfig.historyConfig || {}, enabledProvidersList),
            // J6: Function inheritance
            functionInheritance: {
                inheritFromPrototype,
                overrideFunctionIds: inheritFromPrototype ? [] : overrideFunctionIds,
            },
            // Preserve runtime data (logs, errors, tasks, links)
            logs: instance.configuration_json?.logs || [],
            errors: instance.configuration_json?.errors || [],
            tasks: instance.configuration_json?.tasks || [],
            links: instance.configuration_json?.links || [],
        };
        
        // Update local store
        updateInstanceConfig(configModalInstanceId, configToSave);
        
        // Sync changes to backend
        if (user && instance.id && accessToken) {
            try {
                const response = await fetch(`${API_BASE_URL}/api/agent-instances/${instance.id}`, {
                    method: 'PUT',
                    headers: buildGovernanceHeaders(accessToken, {
                        'Content-Type': 'application/json'
                    }),
                    body: JSON.stringify({
                        configuration_json: configToSave,
                        name: editedName,
                        persistenceConfig: editedPersistenceConfig
                    })
                });

                if (!response.ok) {
                    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
                    addNotification({
                        type: 'error',
                        title: 'Erreur de sauvegarde',
                        message: error.error || 'Impossible de synchroniser avec le serveur'
                    });
                } else {
                    // Read backend response and sync store with validated data
                    const updatedInstance = await response.json();
                    if (updatedInstance?.configuration_json) {
                        updateInstanceConfig(configModalInstanceId, updatedInstance.configuration_json);
                    }
                    
                    addNotification({
                        type: 'success',
                        title: 'Configuration sauvegardée',
                        message: 'Les changements ont été synchronisés avec le serveur'
                    });
                }
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Unknown error';
                addNotification({
                    type: 'error',
                    title: 'Erreur réseau',
                    message: `Impossible de joindre le serveur: ${errorMsg}`
                });
                console.error('[AgentConfigurationModal] Sync error:', err);
            }
        }
        
        setHasChanges(false);
        setConfigModalInstanceId(null); // Fermer le modal
    };

    const handleCancel = () => {
        if (hasChanges) {
            setShowCancelConfirm(true);
        } else {
            setConfigModalInstanceId(null); // Fermer le modal
        }
    };

    const handleConfirmCancel = () => {
        setShowCancelConfirm(false);
        setConfigModalInstanceId(null);
    };

    const handleDenyCancel = () => {
        setShowCancelConfirm(false);
    };

    const handleConfigChange = (field: string, value: any) => {
        setEditedConfig(prev => ({ ...prev, [field]: value }));
        setHasChanges(true);
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="w-full h-full max-w-6xl bg-gray-800 rounded-lg shadow-2xl flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-900/50 rounded-t-lg">
                    <div className="flex items-center space-x-3">
                        <div className={`w-3 h-3 rounded-full ${hasChanges ? 'bg-yellow-400 animate-pulse' : 'bg-cyan-400'}`}></div>
                        <h2 className="text-xl font-semibold text-white">
                            ⚙️ {editedName || instance.name}
                        </h2>
                        <span className="text-sm text-gray-400">
                            ({editedConfig.model} • {editedConfig.llmProvider})
                        </span>
                    </div>

                    <Button
                        variant="ghost"
                        onClick={handleCancel}
                        className="p-2 h-10 w-10 text-gray-400 hover:text-white hover:bg-gray-700"
                    >
                        <CloseIcon width={20} height={20} />
                    </Button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-700 bg-gray-900/30">
                    <TabButton
                        active={activeTab === 'config'}
                        onClick={() => setActiveTab('config')}
                    >
                        {t('agentConfig_tab_config')}
                    </TabButton>
                    <TabButton
                        active={activeTab === 'historique'}
                        onClick={() => setActiveTab('historique')}
                    >
                        {t('agentConfig_tab_history')}
                    </TabButton>
                    <TabButton
                        active={activeTab === 'fonctions'}
                        onClick={() => setActiveTab('fonctions')}
                        badge={inheritFromPrototype ? (prototype.functionIds?.length || undefined) : (overrideFunctionIds.length || undefined)}
                    >
                        {t('agentConfig_tab_functions')}
                    </TabButton>
                    <TabButton
                        active={activeTab === 'formatage'}
                        onClick={() => setActiveTab('formatage')}
                    >
                        {t('agentConfig_tab_formatting')}
                    </TabButton>
                    <TabButton
                        active={activeTab === 'persistence'}
                        onClick={() => setActiveTab('persistence')}
                    >
                        {t('agentConfig_tab_persistence')}
                    </TabButton>
                    <TabButton
                        active={activeTab === 'links'}
                        onClick={() => setActiveTab('links')}
                        badge={editedConfig.links?.length}
                    >
                        {t('agentConfig_tab_links')}
                    </TabButton>
                    <TabButton
                        active={activeTab === 'tasks'}
                        onClick={() => setActiveTab('tasks')}
                        badge={editedConfig.tasks?.length}
                    >
                        {t('agentConfig_tab_tasks')}
                    </TabButton>
                    <TabButton
                        active={activeTab === 'logs'}
                        onClick={() => setActiveTab('logs')}
                        badge={editedConfig.logs?.length}
                    >
                        {t('agentConfig_tab_logs')}
                    </TabButton>
                    <TabButton
                        active={activeTab === 'errors'}
                        onClick={() => setActiveTab('errors')}
                        badge={editedConfig.errors?.length}
                    >
                        {t('agentConfig_tab_errors')}
                    </TabButton>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === 'config' && (
                        <ConfigurationTab
                            config={editedConfig}
                            onChange={handleConfigChange}
                            llmConfigs={llmConfigs}
                            localLLMProfiles={localLLMProfiles}
                            agentName={editedName}
                            onNameChange={(name) => {
                                setEditedName(name);
                                setHasChanges(true);
                            }}
                            t={t}
                        />
                    )}

                    {activeTab === 'historique' && (
                        <HistoryTab
                            config={editedConfig}
                            onChange={handleConfigChange}
                            llmConfigs={llmConfigs}
                            t={t}
                        />
                    )}

                    {activeTab === 'fonctions' && (
                        <FunctionsTab
                            inheritFromPrototype={inheritFromPrototype}
                            overrideFunctionIds={overrideFunctionIds}
                            prototypeFunctionIds={prototype.functionIds || []}
                            onInheritChange={(val) => { setInheritFromPrototype(val); setHasChanges(true); }}
                            onOverrideChange={(ids) => { setOverrideFunctionIds(ids); setHasChanges(true); }}
                            t={t}
                        />
                    )}

                    {activeTab === 'formatage' && (
                        <FormattingTab
                            config={editedConfig}
                            onChange={handleConfigChange}
                            t={t}
                        />
                    )}
                    
                    {activeTab === 'persistence' && (
                        <div className="space-y-4">
                            <div className="bg-gray-700/50 p-3 rounded-lg mb-4">
                                <p className="text-gray-300 text-sm">
                                    <span className="text-cyan-400 font-medium">💾 Configuration de sauvegarde</span>
                                    <br />
                                    Ces paramètres contrôlent ce qui sera automatiquement sauvegardé pour cette instance d'agent,
                                    y compris les images générées et les médias uploadés.
                                </p>
                            </div>
                            
                            <AgentPersistenceForm
                                config={editedPersistenceConfig}
                                onChange={(newConfig) => {
                                    setEditedPersistenceConfig(newConfig);
                                    setHasChanges(true);
                                }}
                                disabled={false}
                            />
                        </div>
                    )}

                    {activeTab === 'links' && (
                        <PlaceholderTab
                            title={t('agentConfig_placeholder_links_title')}
                            description={t('agentConfig_placeholder_links_desc')}
                            icon="🔗"
                        />
                    )}

                    {activeTab === 'tasks' && (
                        <PlaceholderTab
                            title={t('agentConfig_placeholder_tasks_title')}
                            description={t('agentConfig_placeholder_tasks_desc')}
                            icon="✅"
                        />
                    )}

                    {activeTab === 'logs' && (
                        <PlaceholderTab
                            title={t('agentConfig_placeholder_logs_title')}
                            description={t('agentConfig_placeholder_logs_desc')}
                            icon="📋"
                            items={editedConfig.logs}
                        />
                    )}

                    {activeTab === 'errors' && (
                        <PlaceholderTab
                            title={t('agentConfig_placeholder_errors_title')}
                            description={t('agentConfig_placeholder_errors_desc')}
                            icon="❌"
                            items={editedConfig.errors}
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-gray-700 bg-gray-900/30 p-4 flex justify-between items-center">
                    <div className="text-sm text-gray-400">
                        Prototype source : <span className="text-cyan-400 font-mono">{prototype.name}</span>
                    </div>

                    <div className="flex space-x-2">
                        <Button
                            variant="ghost"
                            onClick={handleCancel}
                            className="px-6 py-2"
                        >
                            {t('agentConfig_cancelButton')}
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={!hasChanges || (isLMStudio(editedConfig.llmProvider as LLMProvider) && !!editedConfig.localLLMProfileId && !editedConfig.model)}
                            className="px-6 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t('agentConfig_saveButton')}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Modal de confirmation d'abandon */}
            {showCancelConfirm && (
                <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center">
                    <div className="bg-gray-800 rounded-lg shadow-2xl border border-gray-700 p-6 max-w-md">
                        <h3 className="text-lg font-semibold text-white mb-4">
                            {t('agentConfig_confirmCancel_title')}
                        </h3>
                        <div className="flex justify-end space-x-3 mt-6">
                            <Button
                                variant="ghost"
                                onClick={handleDenyCancel}
                                className="px-4 py-2"
                            >
                                {t('agentConfig_confirmCancel_no')}
                            </Button>
                            <Button
                                onClick={handleConfirmCancel}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700"
                            >
                                {t('agentConfig_confirmCancel_yes')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Tab Button Component
const TabButton: React.FC<{
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    badge?: number;
}> = ({ active, onClick, children, badge }) => (
    <button
        onClick={onClick}
        className={`
      px-6 py-3 font-medium transition-colors relative
      ${active
                ? 'text-cyan-400 border-b-2 border-cyan-400 bg-gray-800/50'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/30'
            }
    `}
    >
        {children}
        {badge !== undefined && badge > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-cyan-600 text-white rounded-full">
                {badge}
            </span>
        )}
    </button>
);

// Configuration Tab Component
const ConfigurationTab: React.FC<{
    config: any;
    onChange: (field: string, value: any) => void;
    llmConfigs: LLMConfig[];
    localLLMProfiles: LocalLLMProfile[];
    agentName: string;
    onNameChange: (name: string) => void;
    t: (key: string) => string;
}> = ({ config, onChange, llmConfigs, localLLMProfiles, agentName, onNameChange, t }) => {

    const { user, accessToken } = useAuth();

    // Transient detection states for inline model detection
    const [isDetectingLocalModel, setIsDetectingLocalModel] = useState(false);
    const [inlineDetectionError, setInlineDetectionError] = useState<string | null>(null);

    // Cloud providers only — local profiles are listed separately in the dropdown
    const availableProviders = useMemo(() =>
        llmConfigs.filter(c => c.enabled && !isLocalProvider(c.provider)).map(c => c.provider),
        [llmConfigs]
    );

    // Composite select value: 'local:<id>' for local profiles, provider enum for cloud
    const providerSelectValue = isLMStudio(config.llmProvider) && config.localLLMProfileId
        ? `local:${config.localLLMProfileId}`
        : (config.llmProvider || '');

    // LMStudio uses localEndpoint (plaintext URL); apiKey fallback for legacy records
    const lmStudioConfig = llmConfigs.find(c => c.provider === LLMProvider.LMStudio);
    const lmStudioEndpoint = lmStudioConfig?.localEndpoint || lmStudioConfig?.apiKey;
    // useMemo ensures originalCapabilities tracks the current config (not stale from first mount)
    const originalCapabilities = useMemo(() => config.capabilities || [], [config.capabilities]);
    const [endpointChanged, setEndpointChanged] = useState(false);

    const [lmStudioDynamicModels, setLmStudioDynamicModels] = useState<any[]>([]);
    const [isLoadingLMStudioModels, setIsLoadingLMStudioModels] = useState(false);

    const { detection: lmStudioDetection, isDetecting: isDetectingLMStudio, redetect: redetectLMStudio } = useLMStudioDetection({
        // Legacy endpoint only when no local profile is selected — profiles use inline detection
        endpoint: config.llmProvider === LLMProvider.LMStudio && !config.localLLMProfileId ? lmStudioEndpoint : undefined,
        autoDetect: false, // Ne pas auto-détecter au mount (agent déjà configuré)
        onSuccess: (detection) => {
            // Auto-update capabilities
            onChange('capabilities', detection.capabilities);
            setEndpointChanged(false);
        }
    });

    useEffect(() => {
        if (config.llmProvider === LLMProvider.LMStudio && lmStudioEndpoint && !config.localLLMProfileId) {
            setIsLoadingLMStudioModels(true);
            getLMStudioMergedModels(lmStudioEndpoint)
                .then(models => {
                    setLmStudioDynamicModels(models);
                })
                .catch(() => {
                    setLmStudioDynamicModels([]);
                })
                .finally(() => setIsLoadingLMStudioModels(false));
        } else {
            setLmStudioDynamicModels([]);
        }
    }, [config.llmProvider, config.localLLMProfileId, lmStudioEndpoint]);

    // Détecter changement d'endpoint
    useEffect(() => {
        if (config.llmProvider === LLMProvider.LMStudio && !config.localLLMProfileId) {
            // Comparer endpoint actuel vs celui stocké dans config (si disponible)
            // Pour simplifier, on détecte si l'utilisateur change le provider vers LMStudio
            const hasDetection = !!lmStudioDetection;
            if (lmStudioEndpoint && !hasDetection) {
                setEndpointChanged(true);
            }
        } else {
            setEndpointChanged(false);
        }
    }, [config.llmProvider, config.localLLMProfileId, lmStudioEndpoint, lmStudioDetection]);

    // Comparer capabilities before/after
    const capabilityChanges = useMemo(() => {
        if (!lmStudioDetection) return { added: [], removed: [] };

        const newCaps = lmStudioDetection.capabilities;
        const oldCaps = originalCapabilities;

        return {
            added: newCaps.filter(cap => !oldCaps.includes(cap)),
            removed: oldCaps.filter(cap => !newCaps.includes(cap))
        };
    }, [lmStudioDetection, originalCapabilities]);

    const hasCapabilityChanges = capabilityChanges.added.length > 0 || capabilityChanges.removed.length > 0;

    // Obtenir les modèles disponibles pour le provider sélectionné
    const availableModels = useMemo(() => {
        if (!config.llmProvider) return [];

        if (config.llmProvider === LLMProvider.LMStudio && lmStudioDynamicModels.length > 0) {
            return lmStudioDynamicModels;
        }

        // Fallback: Modèles statiques
        const staticModels = LLM_MODELS[config.llmProvider as LLMProvider] || [];
        return staticModels.map(id => ({ id, name: id }));
    }, [config.llmProvider, lmStudioDynamicModels]);

    // Obtenir les capacités disponibles pour le modèle sélectionné
    const modelCapabilities = useMemo(() => {
        if (!config.llmProvider || !config.model) return [];
        return getModelCapabilities(config.llmProvider as LLMProvider, config.model);
    }, [config.llmProvider, config.model]);

    const handleProviderChange = (value: string) => {
        if (value.startsWith('local:')) {
            const profileId = value.replace('local:', '');
            const profile = localLLMProfiles.find(p => p.id === profileId);
            if (profile) {
                onChange('llmProvider', LLMProvider.LMStudio);
                onChange('localLLMProfileId', profileId);
                onChange('model', profile.detectedModel ?? '');
                setInlineDetectionError(null);
            }
            return;
        }
        // Cloud provider path
        const provider = value as LLMProvider;
        onChange('llmProvider', provider);
        onChange('localLLMProfileId', '');
        setInlineDetectionError(null);
        let models: any[] = [];
        if (provider === LLMProvider.LMStudio && lmStudioDynamicModels.length > 0) {
            models = lmStudioDynamicModels;
        } else {
            models = (LLM_MODELS[provider] || []).map((id: string) => ({ id }));
        }
        const modelIds = models.map((m: any) => typeof m === 'string' ? m : m.id);
        if (models.length > 0 && !modelIds.includes(config.model)) {
            onChange('model', modelIds[0]);
        }
    };

    // Inline model detection for local profiles
    const handleInlineDetect = async () => {
        const profile = localLLMProfiles.find(p => p.id === config.localLLMProfileId);
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
            onChange('model', result.modelId);
            if (accessToken) {
                void localLLMProfileService.updateProfile(
                    profile.id,
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

    const toggleCapability = (cap: LLMCapability) => {
        // Chat is mandatory and cannot be disabled
        if (cap === LLMCapability.Chat) return;
        
        const current = config.capabilities || [];
        const updated = current.includes(cap)
            ? current.filter((c: LLMCapability) => c !== cap)
            : [...current, cap];
        onChange('capabilities', updated);
    };

    // Ensure Chat is always present in displayed capability list
    const displayCapabilities = useMemo(() => {
        const caps = [...modelCapabilities];
        if (!caps.includes(LLMCapability.Chat)) {
            caps.unshift(LLMCapability.Chat); // Add Chat at start
        }
        return caps;
    }, [modelCapabilities]);

    return (
        <div className="space-y-6">
            {/* Identité de l'Agent */}
            <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-4">{t('agentConfig_identity_title')}</h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            {t('agentConfig_identity_nameLabel')}
                        </label>
                        <input
                            type="text"
                            value={agentName}
                            onChange={(e) => onNameChange(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-cyan-500 focus:outline-none"
                            placeholder={t('agentConfig_identity_namePlaceholder')}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            {t('agentConfig_identity_roleLabel')}
                        </label>
                        <input
                            type="text"
                            value={config.role || ''}
                            onChange={(e) => onChange('role', e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-cyan-500 focus:outline-none"
                            placeholder={t('agentConfig_identity_rolePlaceholder')}
                        />
                    </div>
                </div>
            </div>

            {/* Configuration LLM */}
            <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-4">{t('agentConfig_llm_title')}</h3>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            {t('agentConfig_llm_providerLabel')}
                        </label>
                        <select
                            value={providerSelectValue}
                            onChange={(e) => handleProviderChange(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-cyan-500 focus:outline-none"
                        >
                            {!providerSelectValue && <option value="">{t('agentConfig_llm_providerPlaceholder')}</option>}
                            {/* Cloud providers */}
                            {availableProviders.map(provider => (
                                <option key={provider} value={provider}>{provider}</option>
                            ))}
                            {/* Local LLM profiles */}
                            {localLLMProfiles.filter(p => p.enabled).map(profile => (
                                <option key={profile.id} value={`local:${profile.id}`}>{profile.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            {t('agentConfig_llm_modelLabel')}
                            {config.llmProvider === LLMProvider.LMStudio && isLoadingLMStudioModels && !config.localLLMProfileId && (
                                <span className="ml-2 text-xs text-cyan-400">⌛ Chargement modèles...</span>
                            )}
                        </label>
                        {/* Local profile selected: show detectedModel or inline detection button */}
                        {isLMStudio(config.llmProvider) && config.localLLMProfileId ? (
                            <div className="space-y-2">
                                {config.model ? (
                                    <div className="w-full px-3 py-2 bg-gray-700 border border-green-600/50 rounded text-green-400 text-sm flex items-center gap-2">
                                        ✅ <span className="font-mono truncate">{config.model}</span>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="w-full px-3 py-2 bg-gray-900/50 border border-red-500/50 rounded text-red-400 text-xs">
                                            {t('agentForm_localModel_notDetected')}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleInlineDetect}
                                            disabled={isDetectingLocalModel}
                                            className="w-full px-3 py-1.5 rounded text-sm font-medium transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
                                            style={{
                                                background: isDetectingLocalModel
                                                    ? 'linear-gradient(90deg,rgba(6,182,212,0.3),rgba(59,130,246,0.3))'
                                                    : 'linear-gradient(90deg,#06b6d4,#3b82f6)'
                                            }}
                                        >
                                            {isDetectingLocalModel ? `🔍 ${t('agentForm_localModel_detecting')}` : `🔍 ${t('agentForm_localModel_detect')}`}
                                        </button>
                                    </div>
                                )}
                                {config.model && (
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
                                value={config.model || ''}
                                onChange={(e) => onChange('model', e.target.value)}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-cyan-500 focus:outline-none"
                                disabled={!config.llmProvider || availableModels.length === 0 || isLoadingLMStudioModels}
                            >
                                {!config.model && <option value="">{t('agentConfig_llm_modelPlaceholder')}</option>}
                                {availableModels.map((model: any) => {
                                    const modelId = typeof model === 'string' ? model : model.id;
                                    const modelName = typeof model === 'string' ? model : model.name;
                                    const isDynamic = typeof model === 'object' && model.isDynamic;
                                    return (
                                        <option key={modelId} value={modelId}>
                                            {modelName} {!isDynamic && config.llmProvider === LLMProvider.LMStudio ? '(Statique)' : ''}
                                        </option>
                                    );
                                })}
                            </select>
                        )}
                    </div>
                </div>

                <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        {t('agentConfig_llm_systemPromptLabel')}
                    </label>
                    <textarea
                        value={config.systemPrompt || ''}
                        onChange={(e) => onChange('systemPrompt', e.target.value)}
                        rows={8}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white font-mono text-sm resize-vertical focus:border-cyan-500 focus:outline-none"
                        placeholder={t('agentConfig_llm_systemPromptPlaceholder')}
                    />
                </div>
            </div>

            {/* LMStudio Auto-Detection Panel — legacy mode only */}
            {config.llmProvider === LLMProvider.LMStudio && lmStudioEndpoint && (
                <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                    <h3 className="text-lg font-semibold text-white mb-4">🤖 Détection LMStudio</h3>

                    {/* Alert: Endpoint Modifié ou Re-détection recommandée */}
                    {endpointChanged && !lmStudioDetection && (
                        <div className="mb-4 p-3 rounded-md" style={{
                            background: 'rgba(251, 191, 36, 0.15)',
                            border: '1px solid rgba(251, 191, 36, 0.5)',
                            animation: 'pulse-warning 2s ease-in-out infinite'
                        }}>
                            <div className="flex items-center gap-2">
                                <span className="text-yellow-400 text-xl">⚠️</span>
                                <span className="text-yellow-300 font-semibold">Endpoint modifié ou modèle changé</span>
                            </div>
                            <p className="text-yellow-200 text-sm mt-1">
                                Les capacités doivent être re-détectées pour garantir la compatibilité
                            </p>
                            <button
                                onClick={redetectLMStudio}
                                disabled={isDetectingLMStudio}
                                className="mt-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-300"
                                style={{
                                    background: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                                    border: '1px solid #fbbf24',
                                    color: '#1f2937',
                                    fontWeight: 'bold',
                                    boxShadow: '0 0 15px rgba(251, 191, 36, 0.5)',
                                    animation: 'laser-pulse 2s ease-in-out infinite',
                                    cursor: isDetectingLMStudio ? 'not-allowed' : 'pointer',
                                    opacity: isDetectingLMStudio ? 0.6 : 1
                                }}
                            >
                                🔄 Re-détecter maintenant
                            </button>
                        </div>
                    )}

                    {/* Skeleton UI pendant détection */}
                    {isDetectingLMStudio && (
                        <div className="space-y-3 relative">
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
                        </div>
                    )}

                    {/* Comparaison Before/After si changements détectés */}
                    {lmStudioDetection && hasCapabilityChanges && (
                        <div className="mb-4 p-4 rounded-lg" style={{
                            background: 'rgba(147, 51, 234, 0.1)',
                            border: '1px solid rgba(147, 51, 234, 0.4)'
                        }}>
                            <h4 className="text-purple-400 mb-3 font-semibold">🔄 Changements Détectés</h4>

                            <div className="grid grid-cols-2 gap-4">
                                {/* Before (Removed Capabilities) */}
                                {capabilityChanges.removed.length > 0 && (
                                    <div>
                                        <h5 className="text-red-400 text-sm mb-2">❌ Anciennes</h5>
                                        <div className="space-y-1">
                                            {capabilityChanges.removed.map(cap => (
                                                <div key={cap} className="px-2 py-1 rounded text-xs" style={{
                                                    background: 'rgba(239, 68, 68, 0.1)',
                                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                                    color: '#fca5a5',
                                                    textDecoration: 'line-through'
                                                }}>
                                                    {cap}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* After (Added Capabilities) */}
                                {capabilityChanges.added.length > 0 && (
                                    <div>
                                        <h5 className="text-green-400 text-sm mb-2">✅ Nouvelles</h5>
                                        <div className="space-y-1">
                                            {capabilityChanges.added.map(cap => (
                                                <div key={cap} className="px-2 py-1 rounded text-xs" style={{
                                                    background: 'rgba(34, 197, 94, 0.1)',
                                                    border: '1px solid rgba(34, 197, 94, 0.3)',
                                                    color: '#86efac',
                                                    animation: 'flash-green 1s ease-in-out 3'
                                                }}>
                                                    {cap}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Detected capabilities (same as AgentFormModal) */}
                    {lmStudioDetection && !hasCapabilityChanges && (
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
                                    <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center" style={{
                                        background: 'rgba(34, 197, 94, 0.3)',
                                        border: '2px solid #4ade80'
                                    }}>
                                        <span className="text-green-400 text-xs font-bold">✓</span>
                                    </span>
                                    <span className="text-cyan-300 text-sm font-medium">
                                        {cap === LLMCapability.Chat && '💬 Chat'}
                                        {cap === LLMCapability.FunctionCalling && '🛠️ Functions'}
                                        {cap === LLMCapability.OutputFormatting && '📋 JSON'}
                                        {cap === LLMCapability.Embedding && '🧮 Embed'}
                                        {cap === LLMCapability.ImageGeneration && '🎨 Images'}
                                        {cap === LLMCapability.OCR && '🔍 OCR'}
                                        {!Object.values(LLMCapability).includes(cap) && cap}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Re-detect button (always visible) */}
                    {lmStudioDetection && (
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
                    )}
                </div>
            )}

            {/* Capacités (pour non-LMStudio providers) */}
            {config.llmProvider !== LLMProvider.LMStudio && (
                <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                    <h3 className="text-lg font-semibold text-white mb-4">{t('agentConfig_capabilities_title')}</h3>
                    <div className="grid grid-cols-2 gap-3">
                        {displayCapabilities.map((cap) => (
                            <label key={cap} className={`flex items-center space-x-2 p-2 rounded ${
                                cap === LLMCapability.Chat 
                                    ? 'cursor-not-allowed bg-gray-800/30' 
                                    : 'cursor-pointer hover:bg-gray-800'
                            }`}>
                                <input
                                    type="checkbox"
                                    checked={config.capabilities?.includes(cap) || cap === LLMCapability.Chat || false}
                                    onChange={() => toggleCapability(cap)}
                                    disabled={cap === LLMCapability.Chat}
                                    className={`w-4 h-4 rounded focus:ring-cyan-500 ${
                                        cap === LLMCapability.Chat
                                            ? 'text-green-600 border-green-600 cursor-not-allowed'
                                            : 'text-cyan-600 border-gray-600'
                                    }`}
                                />
                                <span className={`text-sm ${
                                    cap === LLMCapability.Chat
                                        ? 'text-green-400 font-semibold'
                                        : 'text-gray-300'
                                }`}>
                                    {cap}
                                    {cap === LLMCapability.Chat && ' (obligatoire)'}
                                </span>
                            </label>
                        ))}
                    </div>
                    {displayCapabilities.length === 0 && (
                        <p className="text-sm text-gray-500">{t('agentConfig_capabilities_empty')}</p>
                    )}
                </div>
            )}

        </div>
    );
};

// History Tab Component
const HistoryTab: React.FC<{
    config: any;
    onChange: (field: string, value: any) => void;
    llmConfigs: LLMConfig[];
    t: (key: string) => string;
}> = ({ config, onChange, llmConfigs, t }) => {
    const availableProviders = llmConfigs.filter(c => c.enabled).map(c => c.provider);

    const [lmStudioDynamicModelsHistory, setLmStudioDynamicModelsHistory] = useState<any[]>([]);
    const [isLoadingLMStudioModelsHistory, setIsLoadingLMStudioModelsHistory] = useState(false);
    // LMStudio uses localEndpoint (plaintext URL); apiKey fallback for legacy records
    const lmStudioHistoryConfig = llmConfigs.find(c => c.provider === LLMProvider.LMStudio);
    const lmStudioEndpoint = lmStudioHistoryConfig?.localEndpoint || lmStudioHistoryConfig?.apiKey;

    // Fetch modèles LMStudio si history provider est LMStudio
    useEffect(() => {
        if (config.historyConfig?.llmProvider === LLMProvider.LMStudio && lmStudioEndpoint) {
            setIsLoadingLMStudioModelsHistory(true);
            getLMStudioMergedModels(lmStudioEndpoint)
                .then(models => setLmStudioDynamicModelsHistory(models))
                .catch(() => setLmStudioDynamicModelsHistory([]))
                .finally(() => setIsLoadingLMStudioModelsHistory(false));
        } else {
            setLmStudioDynamicModelsHistory([]);
        }
    }, [config.historyConfig?.llmProvider, lmStudioEndpoint]);

    const availableModels = useMemo(() => {
        if (!config.historyConfig?.llmProvider) return [];

        if (config.historyConfig.llmProvider === LLMProvider.LMStudio && lmStudioDynamicModelsHistory.length > 0) {
            return lmStudioDynamicModelsHistory;
        }

        const staticModels = LLM_MODELS[config.historyConfig.llmProvider as LLMProvider] || [];
        return staticModels.map(id => ({ id, name: id }));
    }, [config.historyConfig?.llmProvider, lmStudioDynamicModelsHistory]);

    const handleProviderChange = (provider: LLMProvider) => {
        let models: any[] = [];

        if (provider === LLMProvider.LMStudio && lmStudioDynamicModelsHistory.length > 0) {
            models = lmStudioDynamicModelsHistory;
        } else {
            models = (LLM_MODELS[provider] || []).map(id => ({ id }));
        }

        const modelIds = models.map(m => typeof m === 'string' ? m : m.id);
        // Preserve existing history config when changing LLM provider
        onChange('historyConfig', {
            ...config.historyConfig,
            llmProvider: provider,
            model: modelIds[0] || ''
        });
    };

    return (
        <div className="space-y-6">
            <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <ToggleSwitch
                    label={t('agentConfig_history_enableLabel')}
                    checked={config.historyConfig?.enabled || false}
                    onChange={(checked) => onChange('historyConfig', { ...config.historyConfig, enabled: checked })}
                />
                {config.historyConfig?.enabled && (
                    <div className="mt-4 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">{t('agentConfig_history_limitsLabel')}</label>
                            <div className="grid grid-cols-2 gap-4">
                                {Object.keys(config.historyConfig?.limits || {}).map(key => (
                                    <div key={key}>
                                        <label className="text-xs text-gray-400 capitalize">{key}</label>
                                        <input
                                            type="number"
                                            value={config.historyConfig.limits[key]}
                                            onChange={(e) => onChange('historyConfig', {
                                                ...config.historyConfig,
                                                limits: { ...config.historyConfig.limits, [key]: parseInt(e.target.value) || 0 }
                                            })}
                                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm mt-1"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">{t('agentConfig_history_synthesisLabel')}</label>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-gray-400">{t('agentConfig_history_llmProviderLabel')}</label>
                                    <select
                                        value={config.historyConfig?.llmProvider || 'gemini'}
                                        onChange={(e) => handleProviderChange(e.target.value as LLMProvider)}
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm mt-1"
                                    >
                                        {availableProviders.map(provider => (
                                            <option key={provider} value={provider}>{provider}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-400">
                                        {t('agentConfig_history_llmModelLabel')}
                                        {config.historyConfig?.llmProvider === LLMProvider.LMStudio && isLoadingLMStudioModelsHistory && (
                                            <span className="ml-2 text-cyan-400">⌛</span>
                                        )}
                                    </label>
                                    <select
                                        value={config.historyConfig?.model || ''}
                                        onChange={(e) => onChange('historyConfig', { ...config.historyConfig, model: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm mt-1"
                                        disabled={isLoadingLMStudioModelsHistory}
                                    >
                                        {availableModels.map(model => {
                                            const modelId = typeof model === 'string' ? model : model.id;
                                            const modelName = typeof model === 'string' ? model : model.name;
                                            const isDynamic = typeof model === 'object' && model.isDynamic;
                                            return (
                                                <option key={modelId} value={modelId}>
                                                    {modelName} {!isDynamic && config.historyConfig?.llmProvider === LLMProvider.LMStudio ? '(Statique)' : ''}
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">{t('agentConfig_history_systemPromptLabel')}</label>
                            <textarea
                                value={config.historyConfig?.systemPrompt || ''}
                                onChange={(e) => onChange('historyConfig', { ...config.historyConfig, systemPrompt: e.target.value })}
                                rows={4}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                                placeholder="Résume la conversation de manière factuelle..."
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Functions Tab Component
const FunctionsTab: React.FC<{
    inheritFromPrototype: boolean;
    overrideFunctionIds: string[];
    prototypeFunctionIds: string[];
    onInheritChange: (val: boolean) => void;
    onOverrideChange: (ids: string[]) => void;
    t: (key: string) => string;
}> = ({ inheritFromPrototype, overrideFunctionIds, prototypeFunctionIds, onInheritChange, onOverrideChange }) => {
    return (
        <div className="space-y-4">
            {/* Toggle héritage */}
            <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <ToggleSwitch
                    label="Hériter les fonctions du prototype"
                    checked={inheritFromPrototype}
                    onChange={onInheritChange}
                />
                <p className="mt-2 text-xs text-gray-400">
                    {inheritFromPrototype
                        ? `Les fonctions définies sur le prototype sont utilisées automatiquement (${prototypeFunctionIds.length} fonction(s)).`
                        : 'Personnalisez les fonctions pour cette instance en ignorant le prototype.'}
                </p>
            </div>

            {/* Sélecteur ou affichage hérité */}
            {inheritFromPrototype ? (
                prototypeFunctionIds.length > 0 ? (
                    <FunctionSelector
                        selectedIds={prototypeFunctionIds}
                        onChange={() => {}}
                        readOnly
                    />
                ) : (
                    <div className="bg-gray-900/50 p-6 rounded-lg border border-gray-700 text-center">
                        <p className="text-sm text-gray-400">Aucune fonction définie sur le prototype.</p>
                        <p className="text-xs text-gray-500 mt-1">Désactivez l'héritage pour personnaliser les fonctions de cette instance.</p>
                    </div>
                )
            ) : (
                <FunctionSelector
                    selectedIds={overrideFunctionIds}
                    onChange={onOverrideChange}
                />
            )}
        </div>
    );
};

// Formatting Tab Component
const FormattingTab: React.FC<{
    config: any;
    onChange: (field: string, value: any) => void;
    t: (key: string) => string;
}> = ({ config, onChange, t }) => {
    const outputFormats: OutputFormat[] = ['json', 'xml', 'yaml', 'shell', 'powershell', 'python', 'html', 'css', 'javascript', 'typescript', 'php', 'sql', 'mysql', 'mongodb'];

    return (
        <div className="space-y-6">
            <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <ToggleSwitch
                    label={t('agentConfig_formatting_enableLabel')}
                    checked={config.outputConfig?.enabled || false}
                    onChange={(checked) => onChange('outputConfig', { ...config.outputConfig, enabled: checked })}
                />
                {config.outputConfig?.enabled && (
                    <div className="mt-4 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">{t('agentConfig_formatting_formatLabel')}</label>
                            <select
                                value={config.outputConfig?.format || 'json'}
                                onChange={(e) => onChange('outputConfig', { ...config.outputConfig, format: e.target.value as OutputFormat })}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                            >
                                {outputFormats.map(fmt => (
                                    <option key={fmt} value={fmt}>{fmt.toUpperCase()}</option>
                                ))}
                            </select>
                        </div>
                        <div className="bg-gray-800/50 p-3 rounded">
                            <p className="text-xs text-gray-400">
                                💡 La sortie structurée force le LLM à générer du contenu dans le format spécifié.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Placeholder Tab Component
const PlaceholderTab: React.FC<{
    title: string;
    description: string;
    icon: string;
    items?: any[];
}> = ({ title, description, icon, items }) => (
    <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <div className="text-6xl mb-4">{icon}</div>
        <h3 className="text-xl font-semibold text-white mb-2">{title}</h3>
        <p className="text-center max-w-md mb-4">{description}</p>
        {items && items.length > 0 && (
            <div className="mt-4 text-sm">
                {items.length} élément(s) disponible(s)
            </div>
        )}
        <div className="mt-6 px-4 py-2 bg-gray-700/50 rounded text-sm">
            🚧 Fonctionnalité à venir
        </div>
    </div>
);
