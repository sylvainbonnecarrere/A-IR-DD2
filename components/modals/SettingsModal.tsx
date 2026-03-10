import React, { useState, useEffect } from 'react';
import { LLMConfig, LLMCapability, LLMProvider, LocalLLMProfile, ILLMConfigUI } from '../../types';
import { Button, ToggleSwitch } from '../UI';
import { CloseIcon, PlusIcon } from '../Icons';
import { useLocalization } from '../../hooks/useLocalization';
import { useAuth } from '../../hooks/useAuth';
import { useLLMConfigs } from '../../hooks/useLLMConfigs';
import { useSaveMode } from '../../hooks/useSaveMode';
import { useLocalLLMProfiles } from '../../hooks/useLocalLLMProfiles';
import { locales, Locale } from '../../i18n/locales';
import { isLocalProvider, getInputLabel, getInputPlaceholder, getInputType, getProviderHelperText } from '../../utils/llmProviderUtils';
import { LocalLLMProfileCard } from '../settings/LocalLLMProfileCard';

interface SettingsModalProps {
  llmConfigs: LLMConfig[];
  onClose: () => void;
  onSave: (llmConfigs: LLMConfig[]) => void;
}

interface LLMConfigWithHasKey extends LLMConfig {
  hasApiKey?: boolean; // For authenticated mode - indicates if key exists without showing it
  hasLocalEndpoint?: boolean; // For authenticated mode - indicates if endpoint exists
}


export const SettingsModal = ({ llmConfigs: propConfigs, onClose, onSave }: SettingsModalProps) => {
  const [currentLLMConfigs, setCurrentLLMConfigs] = useState<LLMConfigWithHasKey[]>(JSON.parse(JSON.stringify(propConfigs)));
  const { t, locale, setLocale } = useLocalization();
  const { user, isAuthenticated, refreshLLMApiKeys } = useAuth();
  const { configs: hookConfigs, loading: hookLoading, updateConfig, deleteConfig } = useLLMConfigs();
  const { saveMode, setSaveMode, isLoading: saveModeLoading } = useSaveMode();
  const {
    profiles: hookProfiles,
    loading: hookProfilesLoading,
    createProfile: createLLMProfile,
    updateProfile: updateLLMProfile,
    deleteProfile: deleteLLMProfile
  } = useLocalLLMProfiles();

  // Draft state for local LLM profiles (edited in-modal, saved on "Enregistrer")
  const [localProfiles, setLocalProfiles] = useState<LocalLLMProfile[]>([]);
  // Track IDs that existed at open time, to detect deletions on save
  const [originalProfileIds, setOriginalProfileIds] = useState<Set<string>>(new Set());

  const [activeTab, setActiveTab] = useState<'llms' | 'save' | 'language'>('llms');
  const [isSaving, setIsSaving] = useState(false);

  // Load authenticated user's configs from hook on auth state change
  // When user logs in, hookConfigs will have their saved configs from API
  // ALSO: In guest mode, hookConfigs contains localStorage configs
  // ⭐ NEW: Merge for BOTH authenticated AND guest mode
  useEffect(() => {
    if (!hookLoading) {
      const apiConfigsMap = new Map(
        hookConfigs.map(hc => [hc.provider?.trim() || '', hc])
      );
      
      const mergedConfigs: LLMConfigWithHasKey[] = propConfigs.map(defaultConfig => {
        const userConfig = apiConfigsMap.get(defaultConfig.provider?.trim() || '');
        
        if (!userConfig) {
          return defaultConfig;
        }
        
        return {
          provider: defaultConfig.provider,
          enabled: userConfig.enabled,
          apiKey: userConfig.apiKey || '',
          localEndpoint: userConfig.localEndpoint || '',
          capabilities: userConfig.capabilities || defaultConfig.capabilities,
          hasApiKey: userConfig.hasApiKey,
          hasLocalEndpoint: userConfig.hasLocalEndpoint
        } as LLMConfigWithHasKey;
      });
      
      setCurrentLLMConfigs(mergedConfigs);
    }
  }, [hookLoading, hookConfigs, propConfigs]);

  // Initialise/migrate local profiles draft when hook finishes loading
  useEffect(() => {
    if (hookProfilesLoading) return;

    if (hookProfiles.length > 0) {
      // Normal case: use loaded profiles as draft
      setLocalProfiles(hookProfiles);
      setOriginalProfileIds(new Set(hookProfiles.map(p => p.id)));
    } else {
      // Cold start OR migration: check if legacy single endpoint exists
      const localConfig = currentLLMConfigs.find(c => isLocalProvider(c.provider));
      const legacyEndpoint = localConfig?.localEndpoint;
      if (legacyEndpoint && !legacyEndpoint.includes('•')) {
        // Idempotent migration: show legacy endpoint as "Premier LLM"
        setLocalProfiles([{
          id: '',
          name: 'Premier LLM',
          endpoint: legacyEndpoint,
          capabilities: {} as LocalLLMProfile['capabilities'],
          enabled: true
        }]);
      } else {
        setLocalProfiles([]);
      }
      setOriginalProfileIds(new Set());
    }
  }, [hookProfiles, hookProfilesLoading]);

  // --- Local profile handlers (draft mutations, persisted on Save) ---
  const handleAddProfile = () => {
    setLocalProfiles(prev => [...prev, {
      id: '',
      name: '',
      endpoint: 'http://localhost:11434',
      capabilities: {} as LocalLLMProfile['capabilities'],
      enabled: true
    }]);
  };

  const handleDeleteProfile = (index: number) => {
    setLocalProfiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleProfileChange = (index: number, updated: LocalLLMProfile) => {
    setLocalProfiles(prev => prev.map((p, i) => i === index ? updated : p));
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

  const handleSave = async () => {
    setIsSaving(true);
    let finalConfigs = currentLLMConfigs;
    
    try {
      // Build a map of original (API) configs for comparison
      const originalConfigsMap = new Map(hookConfigs.map(hc => [hc.provider, hc]));
      
      // Track all saves to get responses
      const savePromises: Promise<ILLMConfigUI>[] = [];
      
      // STEP 1: Iterate all configs and save those that changed
      for (const config of currentLLMConfigs) {
        const originalConfig = originalConfigsMap.get(config.provider);
        
        // Determine if config changed - FIXED: Don't require endpoint to be non-empty
        const enabledChanged = !originalConfig || originalConfig.enabled !== config.enabled;
        const apiKeyChanged = config.apiKey && !config.apiKey.includes('•') && config.apiKey !== originalConfig?.apiKey;
        const endpointChanged = !originalConfig || (config.localEndpoint !== originalConfig?.localEndpoint && !config.localEndpoint?.includes('•'));
        const capabilitiesChanged = JSON.stringify(config.capabilities) !== JSON.stringify(originalConfig?.capabilities);
        
        // Save if ANY field changed
        if (enabledChanged || apiKeyChanged || endpointChanged || capabilitiesChanged) {
          console.log(`[SettingsModal] Saving ${config.provider}`);
          
          // Send both fields - backend will use the appropriate one based on provider type
          savePromises.push(
            updateConfig(config.provider, {
              apiKey: config.apiKey,
              localEndpoint: config.localEndpoint,
              enabled: config.enabled,
              capabilities: config.capabilities
            })
          );
        }
      }
      
      // STEP 2: Wait for all saves to complete and get responses
      if (savePromises.length > 0) {
        const savedConfigs = await Promise.all(savePromises);
        
        // STEP 3: Build final configs with server responses merged in
        finalConfigs = currentLLMConfigs.map(config => {
          const savedResponse = savedConfigs.find(sc => sc.provider === config.provider);
          if (savedResponse) {
            return {
              ...config,
              ...savedResponse,
              localEndpoint: savedResponse.localEndpoint || '',
              apiKey: savedResponse.apiKey || '',
              hasApiKey: savedResponse.hasApiKey,
              hasLocalEndpoint: savedResponse.hasLocalEndpoint
            };
          }
          return config;
        });
      }
      
      // STEP 4: Update UI state with final configs
      setCurrentLLMConfigs(finalConfigs);
      
      // J4.6 FIX: Refetch ALL LLM API keys from backend after saving
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
    // Save local LLM profiles: create new, update modified, delete removed
    try {
      // 1. Create or update profiles in draft
      for (const profile of localProfiles) {
        const data = {
          name: profile.name || 'LLM local',
          endpoint: profile.endpoint,
          capabilities: profile.capabilities as Record<string, boolean>,
          enabled: profile.enabled,
          detectedModel: profile.detectedModel ?? null
        };
        if (!profile.id) {
          // New profile (no persisted id yet) — skip if both name and endpoint are empty
          if (profile.name.trim() || profile.endpoint.trim()) {
            await createLLMProfile(data);
          }
        } else {
          // Existing profile
          await updateLLMProfile(profile.id, data);
        }
      }
      // 2. Delete profiles that were removed during the session
      for (const id of originalProfileIds) {
        if (!localProfiles.some(p => p.id === id)) {
          await deleteLLMProfile(id);
        }
      }
    } catch (profileErr) {
      console.error('[SettingsModal] Failed to save local LLM profiles:', profileErr);
      alert(`Erreur profils LLM local: ${profileErr instanceof Error ? profileErr.message : 'Sauvegarde échouée'}`);
    }

    setIsSaving(false);
    // CRITICAL: Notify parent component of saved configs
    // This ensures App.tsx updates its llmConfigs state with final values
    onSave(finalConfigs);
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
                {currentLLMConfigs.map(({ provider, enabled, capabilities, apiKey }) => (
                  <div key={provider}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-gray-200">{provider}</h3>
                      <ToggleSwitch checked={enabled} onChange={(checked) => handleProviderToggle(provider, checked)} />
                    </div>
                    {enabled && (
                      <div className="pl-4 mt-4 space-y-4 border-l-2 border-gray-700">
                        {!isLocalProvider(provider) ? (
                          <>
                            {/* Cloud provider: credentials input */}
                            <div>
                              <label htmlFor={`${provider}-credentials`} className="block text-sm font-medium text-gray-400 mb-1">
                                {getInputLabel(provider)}
                              </label>
                              <input
                                id={`${provider}-credentials`}
                                type={getInputType(provider)}
                                value={apiKey || ''}
                                onChange={(e) => handleApiKeyChange(provider as LLMProvider, e.target.value)}
                                placeholder={getInputPlaceholder(provider)}
                                className="w-full p-2 text-sm bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                              {getProviderHelperText(provider) && (
                                <p className="text-xs text-gray-500 mt-1">
                                  {getProviderHelperText(provider)}
                                </p>
                              )}
                            </div>

                            {/* Cloud provider: capabilities toggles */}
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
                                    </div>
                                    <ToggleSwitch
                                      checked={capabilities[cap] || false}
                                      onChange={(checked) => handleCapabilityToggle(provider, cap, checked)}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        ) : (
                          /* Local provider: profile cards */
                          <div className="space-y-3">
                            {hookProfilesLoading ? (
                              <p className="text-xs text-gray-400 animate-pulse">Chargement des profils...</p>
                            ) : (
                              <>
                                {localProfiles.length === 0 && (
                                  <p className="text-xs text-gray-500 italic">
                                    Aucun LLM local configuré.
                                  </p>
                                )}
                                {localProfiles.map((profile, index) => (
                                  <LocalLLMProfileCard
                                    key={profile.id || `new-${index}`}
                                    profile={profile}
                                    onChange={(updated) => handleProfileChange(index, updated)}
                                    onDelete={() => handleDeleteProfile(index)}
                                  />
                                ))}
                              </>
                            )}
                            <button
                              type="button"
                              onClick={handleAddProfile}
                              className="flex items-center gap-2 px-3 py-2 text-sm text-indigo-400 hover:text-indigo-300 hover:bg-gray-700/50 rounded-md border border-dashed border-indigo-600/50 hover:border-indigo-400 transition-colors w-full justify-center"
                            >
                              <PlusIcon width={14} height={14} />
                              Ajouter un LLM local
                            </button>
                          </div>
                        )}
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
