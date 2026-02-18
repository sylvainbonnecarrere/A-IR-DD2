import React, { useState, useMemo, useEffect } from 'react';
import { AgentTemplate, AGENT_TEMPLATES, getTemplatesByRobot, getCompatibleTemplates, getCompatibleTemplatesByCategory, createAgentFromTemplate } from '../../data/agentTemplates';
import { RobotId, LLMConfig } from '../../types';
import { Button } from '../UI';
import { CloseIcon } from '../Icons';
import { loadAllTemplatesHybrid, deleteTemplateHybrid, CustomTemplate } from '../../services/templateService';
import { useAuth } from '../../hooks/useAuth';
import { ConfirmationModal } from './ConfirmationModal';

interface TemplateSelectionModalProps {
  isOpen: boolean;
  robotId?: RobotId;
  llmConfigs: LLMConfig[]; // Ajout des configs LLM
  onSelectTemplate: (template: AgentTemplate) => void;
  onCancel: () => void;
}

export const TemplateSelectionModal: React.FC<TemplateSelectionModalProps> = ({
  isOpen,
  robotId,
  llmConfigs,
  onSelectTemplate,
  onCancel
}) => {
  const { accessToken } = useAuth();
  
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);
  
  // State pour charger les templates hybrides
  const [allTemplates, setAllTemplates] = useState<AgentTemplate[]>(AGENT_TEMPLATES);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  // État pour la modale de confirmation de suppression
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Charger tous les templates (prédéfinis + personnalisés) au démarrage et quand accessToken change
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        setIsLoadingTemplates(true);
        const templates = await loadAllTemplatesHybrid(accessToken, AGENT_TEMPLATES);
        setAllTemplates(templates);
      } catch (error) {
        console.error('[TemplateSelectionModal] Error loading templates:', error);
        // Fallback to predefined templates
        setAllTemplates(AGENT_TEMPLATES);
      } finally {
        setIsLoadingTemplates(false);
      }
    };

    if (isOpen) {
      loadTemplates();
      setSelectedTemplate(null);
      setSelectedCategory('all');
      setSearchQuery('');
    }
  }, [isOpen, accessToken]);

  if (!isOpen) return null;

  // Local helper functions using props instead of localStorage
  const getLocalCompatibleTemplates = (): AgentTemplate[] => {
    const enabledProviders = llmConfigs
      .filter(c => c.enabled)
      .map(c => c.provider);

    // Si aucun provider n'est activé, afficher tous les templates
    if (enabledProviders.length === 0) {
      return allTemplates;
    }

    return allTemplates.filter(template => {
      // Si le template n'a pas de capabilities, l'accepter (compatible)
      if (!template.template.capabilities || template.template.capabilities.length === 0) {
        return true;
      }

      // Check if the template's LLM provider matches an enabled provider
      const templateProvider = template.template.llmProvider;
      if (templateProvider && enabledProviders.includes(templateProvider)) {
        // Template uses a specific enabled provider, accept it
        return true;
      }

      // Fallback: Check if ANY enabled provider can support the template's capabilities
      return enabledProviders.some(provider => {
        const config = llmConfigs.find(c => c.provider === provider);
        if (!config) return false;

        const providerCapabilities = Object.keys(config.capabilities)
          .filter(cap => config.capabilities[cap as any])
          .map(cap => cap as any);

        // Template is compatible if it has no capabilities or all its capabilities are supported
        return template.template.capabilities.every(cap =>
          providerCapabilities.includes(cap)
        );
      });
    });
  };

  // Filtrer les templates selon le robot sélectionné ET la compatibilité LLM
  let availableTemplates = robotId
    ? getLocalCompatibleTemplates().filter(template => template.robotId === robotId)
    : getLocalCompatibleTemplates(); // Only show compatible templates

  // Filtrer par catégorie
  if (selectedCategory !== 'all') {
    availableTemplates = availableTemplates.filter(template => template.category === selectedCategory);
  }

  // Filtrer par recherche
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    availableTemplates = availableTemplates.filter(template =>
      template.name.toLowerCase().includes(query) ||
      template.description.toLowerCase().includes(query)
    );
  }

  const baseTemplates = robotId
    ? getLocalCompatibleTemplates().filter(template => template.robotId === robotId)
    : getLocalCompatibleTemplates();

  const categories = [
    { key: 'all', label: 'Tous', count: baseTemplates.length },
    { key: 'assistant', label: 'Assistants', count: baseTemplates.filter(t => t.category === 'assistant').length },
    { key: 'specialist', label: 'Spécialistes', count: baseTemplates.filter(t => t.category === 'specialist').length },
    { key: 'automation', label: 'Automatisation', count: baseTemplates.filter(t => t.category === 'automation').length },
    { key: 'analysis', label: 'Analyse', count: baseTemplates.filter(t => t.category === 'analysis').length }
  ].filter(cat => cat.count > 0);

  const getRobotColor = (robotId: RobotId) => {
    switch (robotId) {
      case RobotId.Archi: return 'text-purple-400 bg-purple-900/30 border-purple-500';
      case RobotId.Bos: return 'text-blue-400 bg-blue-900/30 border-blue-500';
      case RobotId.Com: return 'text-green-400 bg-green-900/30 border-green-500';
      case RobotId.Phil: return 'text-yellow-400 bg-yellow-900/30 border-yellow-500';
      case RobotId.Tim: return 'text-red-400 bg-red-900/30 border-red-500';
      default: return 'text-gray-400 bg-gray-900/30 border-gray-500';
    }
  };

  const handleDeleteTemplate = (e: React.MouseEvent, templateId: string) => {
    e.stopPropagation();

    const template = allTemplates.find(t => t.id === templateId);
    const templateName = template?.name || 'ce template';

    // Ouvrir la modale de confirmation
    setTemplateToDelete({ id: templateId, name: templateName });
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!templateToDelete) return;

    try {
      setIsDeleting(true);
      const success = await deleteTemplateHybrid(templateToDelete.id, accessToken);

      if (success) {
        // Désélectionner si c'était le template sélectionné
        if (selectedTemplate?.id === templateToDelete.id) {
          setSelectedTemplate(null);
        }

        // Recharger les templates après suppression
        const updatedTemplates = await loadAllTemplatesHybrid(accessToken, AGENT_TEMPLATES);
        setAllTemplates(updatedTemplates);

        // Fermer la modale
        setDeleteConfirmOpen(false);
        setTemplateToDelete(null);
      } else {
        console.error(`Échec de la suppression du template ${templateToDelete.id}`);
        setDeleteConfirmOpen(false);
        setTemplateToDelete(null);
      }
    } catch (error) {
      console.error('[handleConfirmDelete] Error:', error);
      setDeleteConfirmOpen(false);
      setTemplateToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmOpen(false);
    setTemplateToDelete(null);
  };

  const handleTemplateClick = (template: AgentTemplate) => {
    setSelectedTemplate(template);
  };

  const handleConfirmSelection = () => {
    if (selectedTemplate) {
      onSelectTemplate(selectedTemplate);
      setSelectedTemplate(null);
    }
  };

  const handleCancel = () => {
    setSelectedTemplate(null);
    onCancel();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={(e) => {
        // Fermer si click sur le backdrop
        if (e.target === e.currentTarget) {
          handleCancel();
        }
      }}
    >
      <div
        className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-6 w-full max-w-4xl max-h-[90vh] mx-4 shadow-2xl border border-gray-700/50 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-700/50">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <span className="text-indigo-400">📋</span>
              Choisir un template de prototype
            </h2>
            {robotId && (
              <p className="text-gray-400 mt-1 text-sm">Catalogue pour le robot <span className="text-indigo-400 font-semibold">{robotId}</span></p>
            )}
          </div>
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-white transition-all duration-200 hover:scale-110 p-2 rounded-lg hover:bg-gray-700/50"
            aria-label="Fermer"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <div className="flex-1 relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              🔍
            </div>
            <input
              type="text"
              placeholder="Rechercher par nom ou description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
              autoComplete="off"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {categories.map((category) => (
              <button
                key={category.key}
                onClick={() => setSelectedCategory(category.key)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${selectedCategory === category.key
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600 hover:text-white'
                  }`}
              >
                {category.label} <span className="text-xs opacity-75">({category.count})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Compatibility Info */}
        {(() => {
          const totalTemplates = robotId ? allTemplates.filter(t => t.robotId === robotId).length : allTemplates.length;
          const compatibleCount = baseTemplates.length;
          const filteredCount = totalTemplates - compatibleCount;

          if (filteredCount > 0) {
            return (
              <div className="mb-4 p-3 bg-amber-900/30 border border-amber-500/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 text-amber-400">⚠️</div>
                  <span className="text-amber-300 text-sm">
                    {filteredCount} template(s) masqué(s) car incompatible(s) avec vos fournisseurs LLM configurés
                  </span>
                </div>
              </div>
            );
          }
          return null;
        })()}

        {/* Templates Grid */}
        <div className="flex-1 overflow-y-auto">
          {availableTemplates.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 text-lg">Aucun template trouvé</div>
              <p className="text-gray-500 mt-2">Essayez de modifier vos critères de recherche</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {availableTemplates.map((template) => {
                const isSelected = selectedTemplate?.id === template.id;
                const isCustom = (template as CustomTemplate).isCustom;

                return (
                  <div
                    key={template.id}
                    className={`relative bg-gray-700 rounded-lg p-4 border-2 transition-all cursor-pointer group ${isSelected
                      ? 'border-indigo-500 shadow-lg shadow-indigo-500/50 ring-2 ring-indigo-400/30'
                      : 'border-gray-600 hover:border-indigo-400/50'
                      }`}
                    onClick={() => handleTemplateClick(template)}
                  >
                    {/* Delete Button - Only for custom templates */}
                    {isCustom && (
                      <button
                        onClick={(e) => handleDeleteTemplate(e, template.id)}
                        className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center bg-red-600/90 hover:bg-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 z-10 hover:scale-110 shadow-lg"
                        aria-label="Supprimer ce template personnalisé"
                      >
                        <CloseIcon width={12} height={12} className="text-white" />
                      </button>
                    )}

                    {/* Selection indicator */}
                    {isSelected && (
                      <div className="absolute top-2 left-2 w-7 h-7 flex items-center justify-center bg-indigo-600 rounded-full shadow-lg shadow-indigo-500/50 animate-pulse">
                        <span className="text-white text-sm font-bold">✓</span>
                      </div>
                    )}

                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl flex-shrink-0">{template.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className={`font-semibold transition-colors truncate ${isSelected ? 'text-indigo-300' : 'text-white group-hover:text-indigo-400'
                              }`}>
                              {template.name}
                            </h3>
                            {isCustom && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r from-purple-600 to-purple-700 text-white border border-purple-400 shadow-sm flex-shrink-0">
                                💾 Personnalisé
                              </span>
                            )}
                          </div>
                          <div className={`inline-flex items-center px-2 py-0.5 mt-1 rounded-full text-xs font-medium border ${getRobotColor(template.robotId)}`}>
                            {template.robotId}
                          </div>
                        </div>
                      </div>
                    </div>

                    <p className="text-gray-300 text-sm mb-4 line-clamp-2 leading-relaxed">
                      {template.description}
                    </p>

                    <div className="flex items-center justify-between pt-3 border-t border-gray-600/50">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${template.category === 'assistant' ? 'bg-blue-900/40 text-blue-300 border border-blue-500/30' :
                        template.category === 'specialist' ? 'bg-purple-900/40 text-purple-300 border border-purple-500/30' :
                          template.category === 'automation' ? 'bg-orange-900/40 text-orange-300 border border-orange-500/30' :
                            'bg-green-900/40 text-green-300 border border-green-500/30'
                        }`}>
                        {template.category === 'assistant' ? '🤝 Assistant' :
                          template.category === 'specialist' ? '🎯 Spécialiste' :
                            template.category === 'automation' ? '⚙️ Automatisation' :
                              '📊 Analyse'}
                      </span>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 font-medium px-2 py-1 bg-gray-800/50 rounded">
                          {template.template.llmProvider}
                        </span>
                        {template.template.tools && template.template.tools.length > 0 && (
                          <span className="text-xs text-indigo-400 font-medium px-2 py-1 bg-indigo-900/20 border border-indigo-500/30 rounded">
                            🛠️ {template.template.tools.length}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-700/50">
          {/* Selection info */}
          <div className="text-sm">
            {selectedTemplate ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-indigo-900/30 border border-indigo-500/30 rounded-lg">
                <span className="text-indigo-400 text-lg">✓</span>
                <span className="text-gray-300">
                  Template : <span className="text-white font-semibold">{selectedTemplate.name}</span>
                </span>
              </div>
            ) : (
              <span className="text-gray-400 px-3 py-2">💡 Cliquez sur un template pour le sélectionner</span>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              onClick={handleCancel}
              variant="secondary"
              className="hover:scale-105 transition-transform"
            >
              Annuler
            </Button>
            <Button
              onClick={handleConfirmSelection}
              disabled={!selectedTemplate}
              className={`transition-all duration-200 ${selectedTemplate
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white hover:scale-105 hover:shadow-lg hover:shadow-indigo-500/30'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-50'
                }`}
            >
              <span className="flex items-center gap-2">
                {selectedTemplate && '✨'}
                Créer le Prototype
              </span>
            </Button>
          </div>
        </div>
      </div>

      {/* Modale de confirmation de suppression */}
      <ConfirmationModal
        isOpen={deleteConfirmOpen}
        title="Supprimer le template"
        message={`Êtes-vous sûr de vouloir supprimer le template "${templateToDelete?.name}" ?\n\nCette action est irréversible et le template sera définitivement supprimé de votre collection.`}
        confirmText="Supprimer"
        cancelText="Annuler"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
};