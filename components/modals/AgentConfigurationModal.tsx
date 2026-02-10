import React, { useState, useMemo, useEffect } from 'react';
import { Button, ToggleSwitch } from '../UI';
import { CloseIcon, PlusIcon } from '../Icons';
import { useDesignStore } from '../../stores/useDesignStore';
import { useRuntimeStore } from '../../stores/useRuntimeStore';
import { useLocalization } from '../../hooks/useLocalization';
import { AgentInstance, LLMProvider, Tool, LLMCapability, LLMConfig, OutputFormat, HistoryConfig, LMStudioModelDetection } from '../../types';
import { LLM_MODELS, LLM_MODELS_DETAILED, getModelCapabilities, getLMStudioMergedModels } from '../../llmModels';
import { useLMStudioDetection } from '../../hooks/useLMStudioDetection';

type TabId = 'config' | 'historique' | 'fonctions' | 'formatage' | 'links' | 'tasks' | 'logs' | 'errors';

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
export const AgentConfigurationModal: React.FC<{ llmConfigs: LLMConfig[] }> = ({ llmConfigs }) => {
    const { t } = useLocalization();
    const { getResolvedInstance, updateInstanceConfig, updateAgentInstance } = useDesignStore();
    const { configModalInstanceId, setConfigModalInstanceId } = useRuntimeStore();

    // Tous les hooks DOIVENT être appelés avant les early returns
    const [activeTab, setActiveTab] = useState<TabId>('config');
    const [hasChanges, setHasChanges] = useState(false);
    const [editedName, setEditedName] = useState('');
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);

    // Récupérer l'instance et le prototype (peut être null)
    const resolved = configModalInstanceId ? getResolvedInstance(configModalInstanceId) : null;

    // Configuration initiale (utilisée uniquement pour l'initialisation du useState)
    const config = {
        role: '',
        model: '',
        llmProvider: 'openai' as LLMProvider,
        systemPrompt: '',
        tools: [],
        position: { x: 0, y: 0 },
        links: [],
        tasks: [],
        logs: [],
        errors: []
    };

    const [editedConfig, setEditedConfig] = useState(config);

    // Synchroniser editedConfig et editedName quand l'instance change
    useEffect(() => {
        if (!configModalInstanceId) return;

        // Récupérer l'instance à l'intérieur du useEffect pour éviter la boucle
        const currentResolved = getResolvedInstance(configModalInstanceId);
        if (!currentResolved) return;

        // ✅ ÉTAPE 2: Utiliser configuration_json du backend en priorité (enrichie depuis ÉTAPE 1)
        // Fallback vers le prototype si configuration_json n'existe pas
        const instanceConfig = currentResolved.instance.configuration_json;
        const prototypeConfig = currentResolved.prototype;
        
        const currentConfig = {
            role: instanceConfig?.role || prototypeConfig.role || '',
            model: instanceConfig?.model || prototypeConfig.model || '',
            llmProvider: (instanceConfig?.llmProvider || prototypeConfig.llmProvider || 'openai') as LLMProvider,
            systemPrompt: instanceConfig?.systemPrompt || prototypeConfig.systemPrompt || '',
            tools: JSON.parse(JSON.stringify(instanceConfig?.tools || prototypeConfig.tools || [])),
            outputConfig: instanceConfig?.outputConfig 
                ? JSON.parse(JSON.stringify(instanceConfig.outputConfig))
                : (prototypeConfig.outputConfig ? JSON.parse(JSON.stringify(prototypeConfig.outputConfig)) : undefined),
            capabilities: instanceConfig?.capabilities 
                ? [...instanceConfig.capabilities]
                : (prototypeConfig.capabilities ? [...prototypeConfig.capabilities] : []),
            historyConfig: instanceConfig?.historyConfig
                ? JSON.parse(JSON.stringify(instanceConfig.historyConfig))
                : (prototypeConfig.historyConfig ? JSON.parse(JSON.stringify(prototypeConfig.historyConfig)) : undefined),
            position: currentResolved.instance.position,
            links: instanceConfig?.links || [],
            tasks: instanceConfig?.tasks || [],
            logs: instanceConfig?.logs || [],
            errors: instanceConfig?.errors || []
        };

        setEditedConfig(currentConfig);
        setEditedName(currentResolved.instance.name);
        setHasChanges(false);
    }, [configModalInstanceId, getResolvedInstance]);

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

    const handleSave = () => {
        // 1. Sauvegarder le nom de l'agent (niveau instance, pas config)
        if (editedName !== instance.name) {
            updateAgentInstance(configModalInstanceId, { name: editedName });
        }

        // 2. CRITIQUE : Préserver les données runtime (logs, errors, tasks, links)
        const configToSave = {
            ...editedConfig,
            // Garantir que les données runtime ne sont jamais écrasées
            logs: instance.configuration_json?.logs || [],
            errors: instance.configuration_json?.errors || [],
            tasks: instance.configuration_json?.tasks || [],
            links: instance.configuration_json?.links || [],
        };
        updateInstanceConfig(configModalInstanceId, configToSave);
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
                        badge={editedConfig.tools?.length}
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
                            config={editedConfig}
                            onChange={handleConfigChange}
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
                            disabled={!hasChanges}
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
    agentName: string;
    onNameChange: (name: string) => void;
    t: (key: string) => string;
}> = ({ config, onChange, llmConfigs, agentName, onNameChange, t }) => {

    // Obtenir les providers disponibles (configurés avec apiKey)
    const availableProviders = useMemo(() =>
        llmConfigs.filter(c => c.enabled).map(c => c.provider),
        [llmConfigs]
    );

    // Jalon 4: Détection LMStudio avec comparaison Before/After
    const lmStudioEndpoint = llmConfigs.find(c => c.provider === LLMProvider.LMStudio)?.apiKey;
    const [originalCapabilities] = useState<LLMCapability[]>(config.capabilities || []);
    const [endpointChanged, setEndpointChanged] = useState(false);

    // Jalon 5: Modèles dynamiques LMStudio
    const [lmStudioDynamicModels, setLmStudioDynamicModels] = useState<any[]>([]);
    const [isLoadingLMStudioModels, setIsLoadingLMStudioModels] = useState(false);

    const { detection: lmStudioDetection, isDetecting: isDetectingLMStudio, redetect: redetectLMStudio } = useLMStudioDetection({
        endpoint: config.llmProvider === LLMProvider.LMStudio ? lmStudioEndpoint : undefined,
        autoDetect: false, // Ne pas auto-détecter au mount (agent déjà configuré)
        onSuccess: (detection) => {
            // Auto-update capabilities
            onChange('capabilities', detection.capabilities);
            setEndpointChanged(false);
        }
    });

    // Jalon 5: Fetch modèles dynamiques LMStudio
    useEffect(() => {
        if (config.llmProvider === LLMProvider.LMStudio && lmStudioEndpoint) {
            setIsLoadingLMStudioModels(true);
            getLMStudioMergedModels(lmStudioEndpoint)
                .then(models => {
                    setLmStudioDynamicModels(models);
                    console.log(`[ConfigurationTab] Loaded ${models.length} LMStudio models (${models.filter(m => m.isDynamic).length} dynamic)`);
                })
                .catch(error => {
                    console.warn('[ConfigurationTab] Failed to load LMStudio models:', error);
                    setLmStudioDynamicModels([]);
                })
                .finally(() => setIsLoadingLMStudioModels(false));
        } else {
            setLmStudioDynamicModels([]);
        }
    }, [config.llmProvider, lmStudioEndpoint]);

    // Détecter changement d'endpoint
    useEffect(() => {
        if (config.llmProvider === LLMProvider.LMStudio) {
            // Comparer endpoint actuel vs celui stocké dans config (si disponible)
            // Pour simplifier, on détecte si l'utilisateur change le provider vers LMStudio
            const hasDetection = !!lmStudioDetection;
            if (lmStudioEndpoint && !hasDetection) {
                setEndpointChanged(true);
            }
        } else {
            setEndpointChanged(false);
        }
    }, [config.llmProvider, lmStudioEndpoint, lmStudioDetection]);

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

        // Jalon 5: Utiliser modèles dynamiques pour LMStudio
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

    const handleProviderChange = (provider: LLMProvider) => {
        let models: any[] = [];

        // Jalon 5: Support modèles dynamiques LMStudio
        if (provider === LLMProvider.LMStudio && lmStudioDynamicModels.length > 0) {
            models = lmStudioDynamicModels;
        } else {
            models = (LLM_MODELS[provider] || []).map(id => ({ id }));
        }

        onChange('llmProvider', provider);
        const modelIds = models.map(m => typeof m === 'string' ? m : m.id);
        if (models.length > 0 && !modelIds.includes(config.model)) {
            onChange('model', modelIds[0]); // Auto-select first model
        }
    };

    const toggleCapability = (cap: LLMCapability) => {
        const current = config.capabilities || [];
        const updated = current.includes(cap)
            ? current.filter((c: LLMCapability) => c !== cap)
            : [...current, cap];
        onChange('capabilities', updated);
    };

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
                            value={config.llmProvider || ''}
                            onChange={(e) => handleProviderChange(e.target.value as LLMProvider)}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-cyan-500 focus:outline-none"
                        >
                            {!config.llmProvider && <option value="">{t('agentConfig_llm_providerPlaceholder')}</option>}
                            {availableProviders.map(provider => (
                                <option key={provider} value={provider}>{provider}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            {t('agentConfig_llm_modelLabel')}
                            {config.llmProvider === LLMProvider.LMStudio && isLoadingLMStudioModels && (
                                <span className="ml-2 text-xs text-cyan-400">⌛ Chargement modèles...</span>
                            )}
                        </label>
                        <select
                            value={config.model || ''}
                            onChange={(e) => onChange('model', e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-cyan-500 focus:outline-none"
                            disabled={!config.llmProvider || availableModels.length === 0 || isLoadingLMStudioModels}
                        >
                            {!config.model && <option value="">{t('agentConfig_llm_modelPlaceholder')}</option>}
                            {availableModels.map(model => {
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

            {/* Jalon 4: LMStudio Detection Panel pour Config Modal */}
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
                                        {cap === LLMCapability.OCR && '🎵 Audio'}
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
                        {modelCapabilities.map((cap) => (
                            <label key={cap} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-800 p-2 rounded">
                                <input
                                    type="checkbox"
                                    checked={config.capabilities?.includes(cap) || false}
                                    onChange={() => toggleCapability(cap)}
                                    className="w-4 h-4 text-cyan-600 border-gray-600 rounded focus:ring-cyan-500"
                                />
                                <span className="text-sm text-gray-300">{cap}</span>
                            </label>
                        ))}
                    </div>
                    {modelCapabilities.length === 0 && (
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

    // Jalon 5: State pour modèles dynamiques LMStudio dans HistoryTab
    const [lmStudioDynamicModelsHistory, setLmStudioDynamicModelsHistory] = useState<any[]>([]);
    const [isLoadingLMStudioModelsHistory, setIsLoadingLMStudioModelsHistory] = useState(false);
    const lmStudioEndpoint = llmConfigs.find(c => c.provider === LLMProvider.LMStudio)?.apiKey;

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

        // Jalon 5: Utiliser modèles dynamiques pour LMStudio
        if (config.historyConfig.llmProvider === LLMProvider.LMStudio && lmStudioDynamicModelsHistory.length > 0) {
            return lmStudioDynamicModelsHistory;
        }

        const staticModels = LLM_MODELS[config.historyConfig.llmProvider as LLMProvider] || [];
        return staticModels.map(id => ({ id, name: id }));
    }, [config.historyConfig?.llmProvider, lmStudioDynamicModelsHistory]);

    const handleProviderChange = (provider: LLMProvider) => {
        let models: any[] = [];

        // Jalon 5: Support modèles dynamiques LMStudio
        if (provider === LLMProvider.LMStudio && lmStudioDynamicModelsHistory.length > 0) {
            models = lmStudioDynamicModelsHistory;
        } else {
            models = (LLM_MODELS[provider] || []).map(id => ({ id }));
        }

        const modelIds = models.map(m => typeof m === 'string' ? m : m.id);
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
    config: any;
    onChange: (field: string, value: any) => void;
    t: (key: string) => string;
}> = ({ config, onChange, t }) => {
    const [toolsJsonInput, setToolsJsonInput] = useState(JSON.stringify(config.tools || [], null, 2));
    const [toolsError, setToolsError] = useState('');

    const handleToolsJsonChange = (value: string) => {
        setToolsJsonInput(value);
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                onChange('tools', parsed);
                setToolsError('');
            } else {
                setToolsError('Les outils doivent être un tableau JSON');
            }
        } catch (e) {
            setToolsError('JSON invalide : ' + (e as Error).message);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-4">{t('agentConfig_functions_editorLabel')}</h3>
                <p className="text-sm text-gray-400 mb-3">
                    {config.tools?.length || 0} outil(s) configuré(s)
                </p>
                <textarea
                    value={toolsJsonInput}
                    onChange={(e) => handleToolsJsonChange(e.target.value)}
                    rows={20}
                    className={`w-full px-3 py-2 bg-gray-800 border rounded text-white font-mono text-xs resize-vertical focus:outline-none ${toolsError ? 'border-red-500' : 'border-gray-600 focus:border-cyan-500'
                        }`}
                    placeholder='[{"name": "tool_name", "description": "...", "parameters": {...}}]'
                />
                {toolsError && (
                    <p className="mt-2 text-sm text-red-400">⚠️ {toolsError}</p>
                )}
                <p className="mt-3 text-xs text-gray-500">
                    💡 {t('agentConfig_functions_pythonNote')}
                </p>
            </div>
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
