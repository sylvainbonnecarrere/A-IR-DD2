import React, { useState, useEffect } from 'react';
import { LLMConfig, LLMCapability, LLMProvider, LMStudioModelDetection } from '../../types';
import { Button, Modal, ToggleSwitch } from '../UI';
import { CloseIcon } from '../Icons';
import { useLocalization } from '../../hooks/useLocalization';
import { useAuth } from '../../hooks/useAuth';
import { useLLMConfigs } from '../../hooks/useLLMConfigs';
import { useSaveMode } from '../../hooks/useSaveMode';
import { locales, Locale } from '../../i18n/locales';
import { detectLMStudioModel } from '../../services/routeDetectionService';
import { invalidateLMStudioCache } from '../../llmModels';
import { API_BASE_URL } from '../../config/api.config';

interface SettingsModalProps {
  llmConfigs: LLMConfig[];
  onClose: () => void;
  onSave: (llmConfigs: LLMConfig[]) => void;
}

interface LLMConfigWithHasKey extends LLMConfig {
  hasApiKey?: boolean; // For authenticated mode - indicates if key exists without showing it
}

export const SettingsModal = ({ llmConfigs: propConfigs, onClose, onSave }: SettingsModalProps) => {
  const [currentLLMConfigs, setCurrentLLMConfigs] = useState<LLMConfigWithHasKey[]>(JSON.parse(JSON.stringify(propConfigs)));
  const { t, locale, setLocale } = useLocalization();
  const { user, isAuthenticated, refreshLLMApiKeys } = useAuth();
  const { configs: hookConfigs, loading: hookLoading, updateConfig, deleteConfig } = useLLMConfigs();
  const { saveMode, setSaveMode, isLoading: saveModeLoading } = useSaveMode();
  const [activeTab, setActiveTab] = useState<'llms' | 'save' | 'language'>('llms');
  const [isSaving, setIsSaving] = useState(false);

  // 🔴 J4.4 CRITICAL: Load authenticated user's configs from hook on auth state change
  // When user logs in, hookConfigs will have their saved configs from API
  // IMPORTANT: Must merge with defaults for missing providers!
  useEffect(() => {
    if (isAuthenticated && !hookLoading) {
      // ⭐ MERGE: Combine API configs with defaults to show all 10 providers
      // Map API configs by provider for quick lookup
      const apiConfigsMap = new Map(hookConfigs.map(hc => [hc.provider, hc]));
      
      // Start with defaults, then override with user's saved configs
      const mergedConfigs: LLMConfigWithHasKey[] = propConfigs.map(defaultConfig => {
        const userConfig = apiConfigsMap.get(defaultConfig.provider);
        
        if (!userConfig) {
          // Provider not in API response - use default as-is
          return defaultConfig;
        }
        
        // Provider in API - merge with user's settings
        return {
          provider: defaultConfig.provider,
          enabled: userConfig.enabled, // User's enabled state
          apiKey: userConfig.apiKey || '', // ⭐ J4.4: Backend returns masked apiKey (•••) if key exists
          capabilities: userConfig.capabilities || defaultConfig.capabilities, // User's capabilities (or defaults)
          hasApiKey: userConfig.hasApiKey // Indicator that a key exists in DB
        } as LLMConfigWithHasKey;
      });
      
      setCurrentLLMConfigs(mergedConfigs);
    }
  }, [isAuthenticated, hookConfigs, hookLoading, propConfigs]);

  // LMStudio Detection State
  const [lmStudioDetection, setLmStudioDetection] = useState<LMStudioModelDetection | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [detectionProgress, setDetectionProgress] = useState(0);

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

  const handleProviderToggle = (provider: LLMProvider, enabled: boolean) => {
    setCurrentLLMConfigs(prev =>
      prev.map(c => (c.provider === provider ? { ...c, enabled } : c))
    );
  };

  const handleCapabilityToggle = (provider: LLMProvider, capability: LLMCapability, enabled: boolean) => {
    setCurrentLLMConfigs(prev =>
      prev.map(c =>
        c.provider === provider
          ? { ...c, capabilities: { ...c.capabilities, [capability]: enabled } }
          : c
      )
    );
  }

  const handleApiKeyChange = (provider: LLMProvider, apiKey: string) => {
    setCurrentLLMConfigs(prev =>
      prev.map(c => (c.provider === provider ? { ...c, apiKey } : c))
    );
  };

  const handleDetectLMStudio = async () => {
    const lmStudioConfig = currentLLMConfigs.find(c => c.provider === LLMProvider.LMStudio);
    if (!lmStudioConfig?.apiKey) {
      setDetectionError('Veuillez configurer l\'endpoint LLM local');
      return;
    }

    setIsDetecting(true);
    setDetectionError(null);
    setDetectionProgress(0);

    try {
      // Simuler progression pour UX
      const progressInterval = setInterval(() => {
        setDetectionProgress(prev => Math.min(prev + 15, 90));
      }, 200);

      // JALON 5: Appel unique au backend proxy (Option C Hybride)
      // URL endpoint est passée en query param
      const apiUrl = `${API_BASE_URL}/api/local-llm/detect-capabilities?endpoint=${encodeURIComponent(lmStudioConfig.apiKey)}`;
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000)
      });

      const result = await response.json();

      clearInterval(progressInterval);
      setDetectionProgress(100);

      if (!result.healthy) {
        setDetectionError(result.error || 'Endpoint non accessible');
        setDetectionProgress(0);
        return;
      }

      // Stocker la détection
      setLmStudioDetection({
        modelId: result.modelId,
        routes: {},
        capabilities: (result.capabilities as string[])
          .filter(cap => cap)
          .map(cap => {
            const enumValue = Object.values(LLMCapability).find(v => v === cap);
            return enumValue as LLMCapability;
          })
          .filter((cap): cap is LLMCapability => cap !== undefined),
        detectedAt: result.detectedAt
      });

      // Mettre à jour les capacités automatiquement
      setCurrentLLMConfigs(prev =>
        prev.map(c => {
          if (c.provider === LLMProvider.LMStudio) {
            const newCapabilities = { ...c.capabilities };
            result.capabilities.forEach((cap: string) => {
              newCapabilities[cap] = true;
            });
            return { ...c, capabilities: newCapabilities };
          }
          return c;
        })
      );

      setTimeout(() => setDetectionProgress(0), 1000);
    } catch (error: any) {
      setDetectionError(error.message || 'Erreur lors de la détection');
      setDetectionProgress(0);
    } finally {
      setIsDetecting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    
    try {
      // ⭐ FIX J4.7: Save configs that EITHER have a new key OR have changed enabled state
      // Previous bug: configs with masked keys (•••) were never saved, so toggling
      // enabled/disabled on an existing config was ignored
      
      // Build a map of original (API) configs for comparison
      const originalConfigsMap = new Map(hookConfigs.map(hc => [hc.provider, hc]));
      
      const configsToSave = currentLLMConfigs.filter(config => {
        const hasNewKey = config.apiKey 
          && config.apiKey.trim().length > 0 
          && !config.apiKey.includes('•');
          
        // Check if enabled state changed from original
        const originalConfig = originalConfigsMap.get(config.provider);
        const enabledChanged = originalConfig && originalConfig.enabled !== config.enabled;
        
        // Save if:
        // 1. Has a NEW (non-masked) API key, OR
        // 2. enabled state changed AND has an existing key (hasApiKey)
        return hasNewKey || (enabledChanged && config.hasApiKey);
      });
      
      // ⭐ CRITICAL: Detect deleted configs (user explicitly erased a key)
      // A config is deleted if:
      // - It had a key before (hasApiKey was true OR had masked key)
      // - Now it's COMPLETELY EMPTY (user erased it)
      const configsToDelete = currentLLMConfigs.filter(config => {
        const hadKey = config.hasApiKey || (config.apiKey && config.apiKey.includes('•'));
        const isNowEmpty = !config.apiKey || config.apiKey.trim().length === 0;
        const wasErased = hadKey && isNowEmpty;
        return wasErased;
      });

      console.log('[SettingsModal] Saving:', configsToSave.map(c => c.provider));
      console.log('[SettingsModal] Deleting:', configsToDelete.map(c => c.provider));

      // Save new/updated configs
      for (const config of configsToSave) {
        const hasNewKey = config.apiKey 
          && config.apiKey.trim().length > 0 
          && !config.apiKey.includes('•');
          
        // If hasApiKey but no new key entered, send the masked key
        // Backend will detect masked key and only update enabled/capabilities
        const apiKeyToSend = hasNewKey ? config.apiKey : (config.hasApiKey ? '•••masked•••' : config.apiKey);
        
        await updateConfig(config.provider, {
          apiKey: apiKeyToSend,
          enabled: config.enabled,
          capabilities: config.capabilities
        });
      }
      
      // Delete removed configs (user explicitly erased them)
      for (const config of configsToDelete) {
        try {
          await deleteConfig(config.provider);
        } catch (err) {
          console.error(`Failed to delete config for ${config.provider}:`, err);
        }
      }
      
      // ⭐ J4.6 FIX: Refetch ALL LLM API keys from backend after saving
      // This ensures new/updated/deleted configs are reflected in AuthContext
      if (isAuthenticated && refreshLLMApiKeys) {
        await refreshLLMApiKeys();
      }
    } catch (err) {
      console.error('[SettingsModal] Failed to save configs:', err);
      alert(`Erreur: ${err instanceof Error ? err.message : 'Impossible de sauvegarder les configurations'}`);
      setIsSaving(false);
      return;
    }

    // Also update local state and parent
    setIsSaving(false);
    // ⭐ CRITICAL: Notify parent component of saved configs
    // This ensures App.tsx updates its llmConfigs state
    onSave(currentLLMConfigs);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm" aria-modal="true" role="dialog">
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl w-full max-w-md m-4">
        {/* Custom Header with User Info */}
        <div className="flex flex-col p-4 border-b border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-gray-100">{t('settings_title')}</h2>
            <Button variant="ghost" onClick={onClose} className="p-2">
              <CloseIcon />
            </Button>
          </div>
          {isAuthenticated && user ? (
            <p className="text-sm text-gray-400">
              pour l'utilisateur <span className="text-yellow-400 font-semibold">{user.email}</span>
            </p>
          ) : (
            <p className="text-sm text-gray-400">
              Mode <span className="text-indigo-400 font-semibold">Invité</span> - Paramètres en localStorage
            </p>
          )}
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="border-b border-gray-700">
            <nav className="-mb-px flex space-x-6" aria-label="Tabs">
              <button type="button" onClick={() => setActiveTab('llms')} className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'llms' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}>{t('settings_llms_tab')}</button>
              {isAuthenticated && (
                <button type="button" onClick={() => setActiveTab('save')} className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'save' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}>Enregistrement</button>
              )}
              <button type="button" onClick={() => setActiveTab('language')} className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'language' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}>{t('settings_language_tab')}</button>
            </nav>
          </div>
          <div className="pt-4 max-h-[60vh] overflow-y-auto pr-2">
            {activeTab === 'language' && (
              <div className="space-y-4">
                <div className="bg-indigo-900/20 border border-indigo-600/30 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-indigo-400 mb-3">{t('settings_language_title')}</h4>
                  <p className="text-sm text-gray-400 mb-4">
                    {t('settings_language_desc')}
                  </p>
                  
                  <div className="grid grid-cols-1 gap-3">
                    {Object.entries(locales).map(([localeCode, localeName]) => (
                      <label 
                        key={localeCode}
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                          locale === localeCode 
                            ? 'bg-indigo-900/40 border-2 border-indigo-500' 
                            : 'bg-gray-800 border-2 border-transparent hover:border-gray-600'
                        }`}
                      >
                        <input
                          type="radio"
                          name="language"
                          value={localeCode}
                          checked={locale === localeCode}
                          onChange={async () => {
                            try {
                              await setLocale(localeCode as Locale);
                            } catch (err) {
                              console.error('Failed to set language:', err);
                            }
                          }}
                          className="w-4 h-4 accent-indigo-500"
                        />
                        <div className="flex-1">
                          <span className="text-sm font-medium text-gray-200">{localeName}</span>
                        </div>
                        {locale === localeCode && (
                          <span className="text-xs bg-indigo-500/30 text-indigo-300 px-2 py-1 rounded">
                            Actuelle
                          </span>
                        )}
                      </label>
                    ))}
                  </div>

                  {/* Info supplémentaire */}
                  <div className="text-xs text-gray-500 bg-gray-800/50 rounded-lg p-3 mt-4">
                    {t('settings_language_saved')} {isAuthenticated ? t('settings_language_profile') : t('settings_language_localstorage')}.
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'save' && (
              <div className="space-y-6">
                <div className="bg-indigo-900/20 border border-indigo-600/30 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-indigo-400 mb-3">Mode d'enregistrement</h4>
                  <p className="text-sm text-gray-400 mb-4">
                    Choisissez comment sauvegarder votre travail sur le workflow.
                  </p>
                  
                  <div className="space-y-3">
                    {/* Option Manuel */}
                    <label 
                      className={`flex items-start gap-3 p-4 rounded-lg cursor-pointer transition-all ${
                        saveMode === 'manual' 
                          ? 'bg-indigo-900/40 border-2 border-indigo-500' 
                          : 'bg-gray-800 border-2 border-transparent hover:border-gray-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="saveMode"
                        value="manual"
                        checked={saveMode === 'manual'}
                        onChange={() => setSaveMode('manual')}
                        className="mt-1 w-4 h-4 accent-indigo-500"
                        disabled={saveModeLoading}
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-200 block">Manuel</span>
                        <span className="text-xs text-gray-400 mt-1 block">
                          Un bouton de sauvegarde apparaît sur le workflow. Cliquez dessus ou utilisez Ctrl+S pour enregistrer vos modifications.
                        </span>
                      </div>
                      {saveMode === 'manual' && (
                        <span className="text-xs bg-indigo-500/30 text-indigo-300 px-2 py-1 rounded">Actif</span>
                      )}
                    </label>

                    {/* Option Automatique */}
                    <label 
                      className={`flex items-start gap-3 p-4 rounded-lg cursor-pointer transition-all ${
                        saveMode === 'auto' 
                          ? 'bg-indigo-900/40 border-2 border-indigo-500' 
                          : 'bg-gray-800 border-2 border-transparent hover:border-gray-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="saveMode"
                        value="auto"
                        checked={saveMode === 'auto'}
                        onChange={() => setSaveMode('auto')}
                        className="mt-1 w-4 h-4 accent-indigo-500"
                        disabled={saveModeLoading}
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-200 block">Automatique</span>
                        <span className="text-xs text-gray-400 mt-1 block">
                          Vos modifications sont enregistrées automatiquement après chaque action. Le bouton de sauvegarde n'apparaît pas.
                        </span>
                      </div>
                      {saveMode === 'auto' && (
                        <span className="text-xs bg-indigo-500/30 text-indigo-300 px-2 py-1 rounded">Actif</span>
                      )}
                    </label>
                  </div>

                  {saveModeLoading && (
                    <p className="text-xs text-gray-500 mt-3 animate-pulse">Chargement du mode...</p>
                  )}
                </div>

                {/* Info supplémentaire */}
                <div className="text-xs text-gray-500 bg-gray-800/50 rounded-lg p-3">
                  💡 <strong>Conseil :</strong> Le mode manuel est recommandé pour les workflows complexes. 
                  Il vous permet de contrôler précisément quand vos modifications sont persistées.
                </div>
              </div>
            )}
            {activeTab === 'llms' && (
              <div className="space-y-6">
                {!isAuthenticated && (
                  <div className="p-3 rounded-md bg-amber-900/30 border border-amber-700/50">
                    <p className="text-sm text-amber-400">
                      {t('settings_guest_mode_warning')}
                    </p>
                  </div>
                )}
                {currentLLMConfigs.map(({ provider, enabled, capabilities, apiKey, hasApiKey }) => (
                  <div key={provider}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-gray-200">{provider}</h3>
                      <ToggleSwitch checked={enabled} onChange={(checked) => handleProviderToggle(provider, checked)} />
                    </div>
                    {enabled && (
                      <div className="pl-4 mt-4 space-y-4 border-l-2 border-gray-700">
                        <div>
                          <label htmlFor={`${provider}-apikey`} className="block text-sm font-medium text-gray-400 mb-1">
                            {provider === LLMProvider.LMStudio ? t('settings_endpoint') : t('settings_apiKey')}
                          </label>
                          {/* ⭐ J4.4: apiKey can be:
                              - Empty string (no key configured)
                              - Points (••••••••) masked key from authenticated user
                              - User input (being typed)
                          */}
                          <input
                            id={`${provider}-apikey`}
                            type={provider === LLMProvider.LMStudio ? "text" : "password"}
                            value={apiKey}
                            onChange={(e) => handleApiKeyChange(provider, e.target.value)}
                            placeholder={provider === LLMProvider.LMStudio ? "http://localhost:3928" : t('settings_apiKey_placeholder')}
                            className="w-full p-2 text-sm bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          {provider === LLMProvider.LMStudio && (
                            <>
                              <p className="text-xs text-gray-500 mt-1">
                                Auto-detects Jan (3928), LM Studio (1234), Ollama (11434)
                              </p>

                              {/* Bouton Détection LMStudio */}
                              <button
                                onClick={handleDetectLMStudio}
                                disabled={isDetecting || !apiKey}
                                className="mt-3 px-4 py-2 rounded-md font-medium text-sm transition-all duration-300"
                                style={{
                                  background: isDetecting ? 'linear-gradient(90deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3))' : 'linear-gradient(90deg, #06b6d4, #3b82f6)',
                                  boxShadow: isDetecting ? 'none' : '0 0 15px rgba(6, 182, 212, 0.5)',
                                  animation: isDetecting ? 'none' : 'laser-pulse 2s ease-in-out infinite',
                                  cursor: isDetecting || !apiKey ? 'not-allowed' : 'pointer',
                                  opacity: isDetecting || !apiKey ? 0.6 : 1
                                }}
                              >
                                {isDetecting ? '🔍 Détection en cours...' : '🔍 Détecter les capacités'}
                              </button>

                              {/* Progress Bar */}
                              {isDetecting && (
                                <div className="mt-3 relative w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className="absolute h-full transition-all duration-300"
                                    style={{
                                      width: `${detectionProgress}%`,
                                      background: 'linear-gradient(90deg, #06b6d4, #3b82f6, #9333ea)',
                                      boxShadow: '0 0 10px rgba(6, 182, 212, 0.8)'
                                    }}
                                  >
                                    <div
                                      className="absolute right-0 w-5 h-full"
                                      style={{
                                        background: 'linear-gradient(90deg, transparent, white)',
                                        opacity: 0.6
                                      }}
                                    />
                                  </div>
                                </div>
                              )}

                              {/* Success State - Routes Badges */}
                              {lmStudioDetection && !isDetecting && (
                                <div className="mt-4 p-4 rounded-lg" style={{
                                  background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%)',
                                  border: '1px solid rgba(6, 182, 212, 0.3)'
                                }}>
                                  <h4 className="text-green-400 font-semibold mb-2 flex items-center gap-2">
                                    ✅ Modèle détecté: <span className="font-bold">{lmStudioDetection.modelId}</span>
                                  </h4>

                                  <div className="grid grid-cols-2 gap-2 mt-3">
                                    {Object.entries(lmStudioDetection.routes).map(([route, available], index) => (
                                      <div
                                        key={route}
                                        className="px-3 py-2 rounded-full text-xs font-bold text-center"
                                        style={{
                                          border: available ? '2px solid rgba(6, 182, 212, 0.6)' : '2px solid rgba(100, 100, 100, 0.3)',
                                          background: available ? 'rgba(6, 182, 212, 0.15)' : 'rgba(50, 50, 50, 0.2)',
                                          color: available ? '#06b6d4' : '#666',
                                          animation: available ? `badge-appear 0.5s ease-out ${index * 0.1}s both` : 'none',
                                          boxShadow: available ? '0 0 10px rgba(6, 182, 212, 0.4)' : 'none'
                                        }}
                                      >
                                        {route === 'chatCompletions' && '💬 Chat'}
                                        {route === 'embeddings' && '🧮 Embeddings'}
                                        {route === 'images' && '🎨 Images'}
                                        {route === 'audio' && '🎵 Audio'}
                                        {route === 'completions' && '📝 Text'}
                                        {route === 'models' && '🤖 Models'}
                                      </div>
                                    ))}
                                  </div>

                                  <div className="mt-3 px-3 py-2 rounded-md" style={{
                                    background: 'rgba(34, 197, 94, 0.15)',
                                    border: '1px solid rgba(34, 197, 94, 0.5)',
                                    animation: 'fade-scale-in 0.4s ease-out'
                                  }}>
                                    <span className="text-green-400 text-sm font-semibold">⚡ Capacités détectées:</span>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {lmStudioDetection.capabilities.map((cap, index) => (
                                        <span
                                          key={cap}
                                          className="px-2 py-1 rounded text-xs font-medium"
                                          style={{
                                            background: 'rgba(34, 197, 94, 0.2)',
                                            border: '1px solid rgba(34, 197, 94, 0.4)',
                                            color: '#86efac',
                                            animation: `badge-appear 0.3s ease-out ${index * 0.05}s both`
                                          }}
                                        >
                                          {getCapabilityLabel(cap)}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Error State */}
                              {detectionError && (
                                <div className="mt-3 p-3 rounded-md" style={{
                                  background: 'rgba(239, 68, 68, 0.15)',
                                  border: '2px solid rgba(239, 68, 68, 0.6)',
                                  animation: 'laser-pulse-error 1.5s ease-in-out infinite'
                                }}>
                                  <div className="flex items-center gap-2">
                                    <span className="text-red-400 text-xl">⚠️</span>
                                    <span className="text-red-400 font-semibold">Erreur de détection</span>
                                  </div>
                                  <p className="text-red-300 text-sm mt-1">{detectionError}</p>
                                  <button
                                    onClick={handleDetectLMStudio}
                                    className="mt-2 px-4 py-1.5 rounded-md text-sm transition-all duration-300"
                                    style={{
                                      background: 'rgba(239, 68, 68, 0.2)',
                                      border: '1px solid rgba(239, 68, 68, 0.5)',
                                      color: '#fca5a5'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.6)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.boxShadow = 'none';
                                    }}
                                  >
                                    🔄 Réessayer
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        <div className="space-y-2 pt-2">
                          {Object.keys(capabilities).sort().map(capStr => {
                            const cap = capStr as LLMCapability;
                            return (
                              <div key={cap} className="flex items-center justify-between">
                                <div className="flex items-center">
                                  <span className="text-sm text-gray-400">{cap}</span>
                                  {cap === LLMCapability.WebSearch && provider === LLMProvider.Gemini && (
                                    <span className="ml-2 text-xs text-gray-500">{t('settings_gemini_optimized')}</span>
                                  )}
                                  {cap === LLMCapability.Reasoning && provider === LLMProvider.DeepSeek && (
                                    <span className="ml-2 text-xs text-green-500">R1 Reasoning</span>
                                  )}
                                  {cap === LLMCapability.CacheOptimization && provider === LLMProvider.DeepSeek && (
                                    <span className="ml-2 text-xs text-blue-500">0.014¢/1K tokens</span>
                                  )}
                                  {cap === LLMCapability.CodeSpecialization && provider === LLMProvider.LMStudio && (
                                    <span className="ml-2 text-xs text-orange-500">Qwen2.5 Coder</span>
                                  )}
                                </div>
                                <ToggleSwitch
                                  checked={capabilities[cap] || false}
                                  onChange={(checked) => handleCapabilityToggle(provider, cap, checked)}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-6 mt-4 border-t border-gray-700">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
              {t('cancel')}
            </Button>
            <Button type="button" variant="primary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Enregistrement...' : t('save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
