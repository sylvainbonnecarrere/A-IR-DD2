/**
 * @file WorkflowValidationModal.tsx
 * @description Modal de validation et configuration avant ajout d'un agent au workflow
 * @domain Design Domain - Workflow UI
 * 
 * ⭐ CORRECTION_PLAN_PERSISTANCE: Transformation en modal à onglets
 * 
 * TABS:
 * - Général: Nom de l'instance, validation des prérequis LLM
 * - Sauvegarde: Configuration de persistance (AgentPersistenceForm)
 * 
 * CALLBACK SIGNATURE:
 * onConfirm(instanceName: string, persistenceConfig?: PersistenceConfig)
 */

import React, { useState } from 'react';
import { Agent, LLMConfig, PersistenceConfig, defaultPersistenceConfig } from '../../types';
import { Button } from '../UI';
import { CloseIcon } from '../Icons';
import { AgentPersistenceForm } from './AgentPersistenceForm';
import { useAuth } from '../../hooks/useAuth';

interface WorkflowValidationModalProps {
  isOpen: boolean;
  agent: Agent | null;
  llmConfigs: LLMConfig[];
  onConfirm: (instanceName: string, persistenceConfig?: PersistenceConfig) => void;
  onCancel: () => void;
}

// ============================================
// ICONS
// ============================================

const CheckIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const XIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <path d="M18 6 6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

const AlertTriangleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="m12 17 .01 0" />
  </svg>
);

const SettingsIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const SaveIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17,21 17,13 7,13 7,21" />
    <polyline points="7,3 7,8 15,8" />
  </svg>
);

// ============================================
// COMPONENT
// ============================================

type TabId = 'general' | 'persistence';

export const WorkflowValidationModal: React.FC<WorkflowValidationModalProps> = ({
  isOpen,
  agent,
  llmConfigs,
  onConfirm,
  onCancel
}) => {
  const { user } = useAuth();
  const isAuthenticated = user !== null;
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [instanceName, setInstanceName] = useState('');
  
  // ⭐ Persistence config: hérite du prototype si disponible
  const [persistenceConfig, setPersistenceConfig] = useState<PersistenceConfig>(() => {
    if (agent?.persistenceConfig) {
      return { ...agent.persistenceConfig };
    }
    return { ...defaultPersistenceConfig };
  });

  // Reset state when agent changes
  React.useEffect(() => {
    if (agent) {
      setInstanceName('');
      setActiveTab('general');
      setPersistenceConfig(
        agent.persistenceConfig 
          ? { ...agent.persistenceConfig }
          : { ...defaultPersistenceConfig }
      );
    }
  }, [agent]);

  if (!isOpen || !agent) return null;

  // Validation des prérequis
  const hasEnabledLLM = llmConfigs.some(config => config.enabled);
  const compatibleLLMs = llmConfigs.filter(config =>
    config.enabled &&
    (!agent.llmProvider || agent.llmProvider === config.provider)
  );

  const hasCompatibleLLM = compatibleLLMs.length > 0;
  const hasTools = agent.tools && agent.tools.length > 0;
  const isReady = hasEnabledLLM && hasCompatibleLLM;

  const handleConfirm = () => {
    const finalName = instanceName.trim() || agent.name;
    onConfirm(finalName, persistenceConfig);
    setInstanceName('');
    setActiveTab('general');
  };

  const handleCancel = () => {
    setInstanceName('');
    setActiveTab('general');
    onCancel();
  };

  // ============================================
  // TAB DEFINITIONS
  // ============================================

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'Général', icon: <SettingsIcon className="w-4 h-4" /> },
    ...(isAuthenticated ? [{ id: 'persistence' as const, label: 'Sauvegarde', icon: <SaveIcon className="w-4 h-4" /> }] : [])
  ];

  // ============================================
  // RENDER TABS CONTENT
  // ============================================

  const renderGeneralTab = () => (
    <>
      {/* Instance Name Form */}
      <div className="mb-6">
        <label htmlFor="instanceName" className="block text-white font-semibold mb-2">
          Nom de l'instance
        </label>
        <input
          id="instanceName"
          type="text"
          value={instanceName}
          onChange={(e) => setInstanceName(e.target.value)}
          placeholder={agent.name}
          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        />
        <p className="text-gray-400 text-xs mt-1">
          Laissez vide pour utiliser le nom du prototype
        </p>
      </div>

      {/* Agent Info */}
      <div className="bg-gray-700 p-3 rounded-lg mb-4">
        <p className="text-gray-300 text-sm">{agent.role || agent.description || 'Pas de description'}</p>
      </div>

      {/* Validation Checks */}
      <div className="space-y-3 mb-6">
        <h3 className="text-white font-semibold mb-3">Vérification des prérequis :</h3>

        {/* LLM Configuration */}
        <div className="flex items-start space-x-3">
          {hasEnabledLLM ? (
            <CheckIcon className="w-5 h-5 text-green-400 mt-0.5" />
          ) : (
            <XIcon className="w-5 h-5 text-red-400 mt-0.5" />
          )}
          <div className="flex-1">
            <p className={`font-medium ${hasEnabledLLM ? 'text-green-400' : 'text-red-400'}`}>
              Configuration LLM
            </p>
            <p className="text-gray-400 text-sm">
              {hasEnabledLLM
                ? `${llmConfigs.filter(c => c.enabled).length} provider(s) configuré(s)`
                : 'Aucun provider LLM configuré'
              }
            </p>
          </div>
        </div>

        {/* Provider Compatibility */}
        <div className="flex items-start space-x-3">
          {hasCompatibleLLM ? (
            <CheckIcon className="w-5 h-5 text-green-400 mt-0.5" />
          ) : (
            <XIcon className="w-5 h-5 text-red-400 mt-0.5" />
          )}
          <div className="flex-1">
            <p className={`font-medium ${hasCompatibleLLM ? 'text-green-400' : 'text-red-400'}`}>
              Compatibilité provider
            </p>
            <p className="text-gray-400 text-sm">
              {hasCompatibleLLM
                ? `Compatible avec ${compatibleLLMs.map(c => c.provider).join(', ')}`
                : !agent.llmProvider
                  ? 'Compatible avec tous les providers disponibles'
                  : `Provider requis: ${agent.llmProvider} (non configuré)`
              }
            </p>
          </div>
        </div>

        {/* Tools */}
        <div className="flex items-start space-x-3">
          <CheckIcon className="w-5 h-5 text-blue-400 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-blue-400">Outils disponibles</p>
            <p className="text-gray-400 text-sm">
              {hasTools
                ? `${agent.tools!.length} outil(s) configuré(s)`
                : 'Agent de conversation simple (aucun outil)'
              }
            </p>
            {/* DEBUG: Show hint if no tools configured but capabilities suggest function calling */}
            {!hasTools && agent.capabilities?.includes('FunctionCalling') && (
              <p className="text-xs text-yellow-300 mt-1">💡 Ajoutez des outils dans l'onglet 'Fonctions' du template pour utiliser les appels de fonction</p>
            )}
          </div>
        </div>

        {/* Capacités */}
        <div className="flex items-start space-x-3">
          <CheckIcon className="w-5 h-5 text-purple-400 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-purple-400">Capacités du template</p>
            {agent.capabilities && agent.capabilities.length > 0 ? (
              <div className="flex flex-wrap gap-2 mt-2">
                {agent.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-900/40 text-purple-300 border border-purple-700/50"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Chat uniquement (aucune capacité supplémentaire)</p>
            )}
          </div>
        </div>
      </div>

      {/* Warning/Success message */}
      {!isReady ? (
        <div className="bg-red-900/30 border border-red-500/50 p-3 rounded-lg">
          <div className="flex items-center space-x-2">
            <AlertTriangleIcon className="w-5 h-5 text-red-400" />
            <span className="text-red-400 font-semibold">Configuration incomplète</span>
          </div>
          <p className="text-red-300 text-sm mt-1">
            Veuillez configurer au moins un provider LLM compatible dans les paramètres avant d'ajouter cet agent au workflow.
          </p>
        </div>
      ) : (
        <div className="bg-green-900/30 border border-green-500/50 p-3 rounded-lg">
          <div className="flex items-center space-x-2">
            <CheckIcon className="w-5 h-5 text-green-400" />
            <span className="text-green-400 font-semibold">Prêt pour le workflow</span>
          </div>
          <p className="text-green-300 text-sm mt-1">
            Cet agent peut être ajouté au workflow et sera opérationnel immédiatement.
          </p>
        </div>
      )}
    </>
  );

  const renderPersistenceTab = () => (
    <div className="space-y-4">
      <div className="bg-gray-700/50 p-3 rounded-lg mb-4">
        <p className="text-gray-300 text-sm">
          <span className="text-indigo-400 font-medium">💡 Configuration de sauvegarde</span>
          <br />
          Ces paramètres contrôlent ce qui sera automatiquement sauvegardé pour cette instance d'agent.
          Les valeurs par défaut héritent du prototype.
        </p>
      </div>
      
      <AgentPersistenceForm
        config={persistenceConfig}
        onChange={setPersistenceConfig}
        disabled={false}
      />
    </div>
  );

  // ============================================
  // MAIN RENDER
  // ============================================

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl w-full max-w-lg mx-4 shadow-2xl border border-gray-600 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-0">
          <h2 className="text-xl font-bold text-white">Ajouter au workflow</h2>
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Prototype Info */}
        <p className="text-gray-400 text-sm px-6 mt-2">
          Prototype : <span className="text-white font-semibold">{agent.name}</span>
        </p>

        {/* Tabs Navigation */}
        <div className="flex border-b border-gray-700 px-6 mt-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative
                ${activeTab === tab.id
                  ? 'text-indigo-400'
                  : 'text-gray-400 hover:text-gray-200'
                }
              `}
            >
              {tab.icon}
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500" />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {activeTab === 'general' && renderGeneralTab()}
          {activeTab === 'persistence' && renderPersistenceTab()}
        </div>

        {/* Actions - Fixed at bottom */}
        <div className="flex space-x-3 p-6 pt-4 border-t border-gray-700 bg-gray-800">
          <Button
            onClick={handleCancel}
            variant="secondary"
            className="flex-1"
          >
            Annuler
          </Button>
          <Button
            onClick={handleConfirm}
            variant={isReady ? "primary" : "secondary"}
            disabled={!isReady}
            className="flex-1"
          >
            {isReady ? 'Ajouter au workflow' : 'Configuration requise'}
          </Button>
        </div>
      </div>
    </div>
  );
};