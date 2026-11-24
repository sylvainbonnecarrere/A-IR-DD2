/**
 * 🎯 COMPONENT: LLMConfigsList
 *
 * Affiche la liste des configurations LLM avec actions
 * Directive SOLID: Utilise useLLMConfigs, jamais fetch direct
 */

import React, { useState } from 'react';
import { useLLMConfigs } from '../hooks/useLLMConfigs';
import type { ILLMConfigUI } from '../types';
import { LLMConfigModal } from './modals/LLMConfigModal';

interface LLMConfigsListProps {
  onConfigAdded?: () => void;
}

export const LLMConfigsList: React.FC<LLMConfigsListProps> = ({ onConfigAdded }) => {
  // 📌 DIRECTIVE SOLID: Utiliser le hook
  const { configs, loading, error, validateProvider } = useLLMConfigs();

  // State
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [validationCache, setValidationCache] = useState<Record<string, { valid: boolean; enabled: boolean }>>({});

  // Valider un provider
  const _checkProvider = async (provider: string) => {
    if (validationCache[provider]) {
      return validationCache[provider];
    }

    try {
      const result = await validateProvider(provider);
      setValidationCache((prev) => ({
        ...prev,
        [provider]: {
          valid: result.valid,
          enabled: result.enabled,
        },
      }));
      return result;
    } catch {
      return { valid: false, enabled: false };
    }
  };

  // Rendu de chaque config
  const renderConfig = (config: ILLMConfigUI) => (
    <div key={config.provider} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
      {/* Provider info */}
      <div className="flex-1">
        <h3 className="font-medium text-gray-800">{config.provider}</h3>
        <p className="text-sm text-gray-500">{config.enabled ? '✅ Actif' : '⏸️ Inactif'}</p>
        {config.capabilities && Object.keys(config.capabilities).length > 0 && (
          <p className="text-xs text-gray-400 mt-1">{Object.keys(config.capabilities).length} capability(ies)</p>
        )}
      </div>

      {/* API Key Badge */}
      <div className="mx-4">
        {config.hasApiKey ? (
          <span className="inline-block px-2 py-1 bg-green-100 text-green-700 text-xs rounded">🔑 Configurée</span>
        ) : (
          <span className="inline-block px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded">⚠️ Manquante</span>
        )}
      </div>

      {/* Actions */}
      <button
        onClick={() => setSelectedProvider(config.provider)}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
      >
        Éditer
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-gray-800">Configurations LLM</h2>
        <span className="text-sm text-gray-500">{configs.length} configurée(s)</span>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-3 bg-red-100 text-red-700 rounded">
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="p-4 bg-gray-100 rounded text-center">
          <p className="text-gray-600">Chargement des configurations...</p>
        </div>
      )}

      {/* Configs List */}
      {!loading && configs.length > 0 ? (
        <div className="space-y-2">{configs.map(renderConfig)}</div>
      ) : !loading ? (
        <div className="p-4 bg-gray-50 rounded text-center border-2 border-dashed border-gray-300">
          <p className="text-gray-500">Aucune configuration LLM. Ajoutez une première config pour commencer.</p>
        </div>
      ) : null}

      {/* Add New Config Button */}
      <div className="pt-2">
        <button
          onClick={() => setSelectedProvider('OpenAI')}
          className="w-full py-2 px-4 bg-green-600 text-white rounded hover:bg-green-700 font-medium"
        >
          ➕ Ajouter une configuration
        </button>
      </div>

      {/* Modal */}
      {selectedProvider && (
        <LLMConfigModal
          provider={selectedProvider}
          onClose={() => setSelectedProvider(null)}
          onSuccess={() => {
            onConfigAdded?.();
            setSelectedProvider(null);
          }}
        />
      )}

      {/* Security Note */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
        <p className="font-medium mb-2">🔒 Sécurité</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Vos clés API sont chiffrées côté serveur (AES-256-GCM)</li>
          <li>Jamais stockées en clair dans votre navigateur</li>
          <li>Accès contrôlé par JWT authentication</li>
          <li>À usage uniquement authentifié</li>
        </ul>
      </div>
    </div>
  );
};
