/**
 * 🎯 COMPONENT: LLMConfigModal
 * 
 * Directive SOLID: Checklist de conformité
 * ✅ Importe useLLMConfigs (JAMAIS fetch ou localStorage)
 * ✅ Récupère données du hook (getConfig)
 * ✅ Appelle actions du hook (updateConfig, deleteConfig)
 * ✅ Utilise isLoading du hook pour UX
 * ✅ Aucune logique de persistance dans ce composant
 */

import React, { useState, useEffect } from 'react';
import { useLLMConfigs } from '../../hooks/useLLMConfigs';
import { useLocalization } from '../../hooks/useLocalization';
import type { ILLMConfigUI } from '../../types';

interface LLMConfigModalProps {
  provider: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const LLM_PROVIDERS = [
  'OpenAI',
  'Anthropic',
  'Gemini',
  'Mistral',
  'DeepSeek',
  'Grok',
  'Perplexity',
  'Qwen',
  'Kimi',
  'LLM local (on premise)'
];

export const LLMConfigModal: React.FC<LLMConfigModalProps> = ({
  provider,
  onClose,
  onSuccess
}) => {
  // 📌 DIRECTIVE SOLID: Utiliser le hook
  const { getConfig, updateConfig, deleteConfig, loading, error, clearError } =
    useLLMConfigs();
  const { t } = useLocalization();

  // Form state
  const [formData, setFormData] = useState({
    apiKey: '',
    apiKeyConfirm: '',
    enabled: true,
    capabilities: {} as Record<string, boolean>
  });
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Charger la config existante (si modification)
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await getConfig(provider);
        if (config) {
          setFormData({
            apiKey: '', // ⚠️ Ne jamais afficher l'API key existante
            apiKeyConfirm: '',
            enabled: config.enabled,
            capabilities: config.capabilities
          });
        }
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : 'Erreur chargement config'
        );
      }
    };

    loadConfig();
  }, [provider, getConfig]);

  // Validation
  const validateForm = (): boolean => {
    if (!formData.apiKey.trim()) {
      setFormError('API key requise');
      return false;
    }

    if (formData.apiKey !== formData.apiKeyConfirm) {
      setFormError('Les API keys ne correspondent pas');
      return false;
    }

    if (formData.apiKey.length < 10) {
      setFormError('API key invalide (trop courte)');
      return false;
    }

    return true;
  };

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      // 📌 DIRECTIVE SOLID: Appeler l'action du hook (JAMAIS fetch direct)
      await updateConfig(provider, {
        apiKey: formData.apiKey,
        enabled: formData.enabled,
        capabilities: formData.capabilities
      });

      // Succès
      setFormData({
        apiKey: '',
        apiKeyConfirm: '',
        enabled: true,
        capabilities: {}
      });

      onSuccess?.();
      onClose();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Erreur sauvegarde config'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!window.confirm(`Supprimer la configuration ${provider} ?`)) {
      return;
    }

    setIsLoading(true);

    try {
      // 📌 DIRECTIVE SOLID: Appeler l'action du hook
      await deleteConfig(provider);
      onSuccess?.();
      onClose();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Erreur suppression config'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const combinedLoading = isLoading || loading;
  const displayError = formError || error;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">
            Configuration {provider}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {/* Error Message */}
        {displayError && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">
            <p className="text-sm">{displayError}</p>
            <button
              onClick={clearError}
              className="text-xs underline mt-1"
            >
              Effacer
            </button>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* API Key Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Clé API
            </label>
            <input
              type="password"
              value={formData.apiKey}
              onChange={(e) =>
                setFormData({ ...formData, apiKey: e.target.value })
              }
              placeholder="sk-..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={combinedLoading}
            />
          </div>

          {/* API Key Confirmation */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirmer la clé API
            </label>
            <input
              type="password"
              value={formData.apiKeyConfirm}
              onChange={(e) =>
                setFormData({ ...formData, apiKeyConfirm: e.target.value })
              }
              placeholder="sk-..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={combinedLoading}
            />
          </div>

          {/* Enabled Checkbox */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="enabled"
              checked={formData.enabled}
              onChange={(e) =>
                setFormData({ ...formData, enabled: e.target.checked })
              }
              disabled={combinedLoading}
              className="h-4 w-4 text-blue-600"
            />
            <label htmlFor="enabled" className="ml-2 text-sm text-gray-700">
              Activer ce provider
            </label>
          </div>

          {/* Buttons */}
          <div className="flex gap-2 pt-4">
            <button
              type="submit"
              disabled={combinedLoading}
              className="flex-1 bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              {combinedLoading ? t('button_save_loading') : t('save')}
            </button>

            <button
              type="button"
              onClick={handleDelete}
              disabled={combinedLoading}
              className="flex-1 bg-red-600 text-white py-2 rounded-md hover:bg-red-700 disabled:bg-gray-400"
            >
              {combinedLoading ? '...' : 'Supprimer'}
            </button>

            <button
              type="button"
              onClick={onClose}
              disabled={combinedLoading}
              className="flex-1 bg-gray-300 text-gray-800 py-2 rounded-md hover:bg-gray-400 disabled:bg-gray-200"
            >
              Annuler
            </button>
          </div>
        </form>

        {/* Info */}
        <div className="mt-4 p-3 bg-blue-50 rounded text-sm text-blue-700">
          <p>
            🔒 Votre clé API est chiffrée côté serveur (AES-256-GCM).
          </p>
        </div>
      </div>
    </div>
  );
};
