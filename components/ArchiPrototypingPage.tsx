import React, { useState, useRef, useEffect } from 'react';
import { Agent, LLMConfig, RobotId, PersistenceConfig } from '../types';
import { useDesignStore } from '../stores/useDesignStore';
import { useAuth } from '../contexts/AuthContext';
import { AgentFormModal } from './modals/AgentFormModal';
import { AgentDeletionConfirmModal } from './modals/AgentDeletionConfirmModal';
import { WorkflowValidationModal } from './modals/WorkflowValidationModal';
import { TemplateSelectionModal } from './modals/TemplateSelectionModal';
import { PrototypeImpactModal } from './modals/PrototypeImpactModal';
import { Button, Card } from './UI';
import { PlusIcon, EditIcon, CloseIcon, WrenchIcon } from './Icons';
import { useLocalization } from '../hooks/useLocalization';
import { useNotifications } from '../contexts/NotificationContext';
import { AgentTemplate, createAgentFromTemplate, createAgentFromTemplateObject } from '../data/agentTemplates';
import { GovernanceTestModal } from './modals/GovernanceTestModal';
import { TodoModal } from './modals/TodoModal';
import { addPrototypeToTemplates, loadCustomTemplates } from '../services/templateService';
import { createAgentPrototype, updateAgentPrototype, fetchAgentPrototypes, mapAPIResponseToAgent } from '../services/agentPrototypeAPI';

interface ArchiPrototypingPageProps {
  llmConfigs: LLMConfig[];
  onNavigateToWorkflow?: () => void;
  onAddToWorkflow?: (agent: Agent) => void;
  onDeleteNodes?: (instanceIds: string[]) => void; // Callback to delete nodes by instanceId
}

export const ArchiPrototypingPage: React.FC<ArchiPrototypingPageProps> = ({
  llmConfigs,
  onNavigateToWorkflow,
  onAddToWorkflow,
  onDeleteNodes
}) => {
  const { t } = useLocalization();
  const { addNotification } = useNotifications();
  
  // ⭐ Auth context pour persistence MongoDB (users connectés uniquement)
  const { isAuthenticated, accessToken } = useAuth();
  
  const {
    agents,
    currentRobotId,
    setCurrentRobot,
    setAgents,
    addAgent,
    updateAgent,
    updateAgentId,
    deleteAgent,
    selectAgent,
    selectedAgentId,
    addNode,
    addAgentInstance,
    getPrototypeImpact
  } = useDesignStore();

  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [addedAgentPopup, setAddedAgentPopup] = useState<{ agent: Agent; nodeId: string } | null>(null);

  // PHASE 2A: Confirmation modals
  const [deletionConfirmOpen, setDeletionConfirmOpen] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);

  // PHASE 2A: Workflow validation
  const [workflowValidationOpen, setWorkflowValidationOpen] = useState(false);
  const [agentToAdd, setAgentToAdd] = useState<Agent | null>(null);

  // PHASE 2B: Template selection
  const [templateSelectionOpen, setTemplateSelectionOpen] = useState(false);

  // Prototype Impact Confirmation
  const [impactConfirmOpen, setImpactConfirmOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{ agentId: string; agentData: Omit<Agent, 'id'> } | null>(null);

  // Governance Test Modal
  const [governanceTestOpen, setGovernanceTestOpen] = useState(false);

  // Todo Modal
  const [todoModalOpen, setTodoModalOpen] = useState(false);

  // Add to Templates Modal
  const [addToTemplatesOpen, setAddToTemplatesOpen] = useState(false);
  const [agentToAddAsTemplate, setAgentToAddAsTemplate] = useState<Agent | null>(null);

  // Scroll indicator
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);

  // Check if content is scrollable
  useEffect(() => {
    const checkScroll = () => {
      if (scrollContainerRef.current) {
        const { scrollHeight, clientHeight, scrollTop } = scrollContainerRef.current;
        const isScrollable = scrollHeight > clientHeight;
        const isAtBottom = scrollHeight - scrollTop <= clientHeight + 10; // 10px tolerance
        setShowScrollIndicator(isScrollable && !isAtBottom);
      }
    };

    checkScroll();
    window.addEventListener('resize', checkScroll);

    const container = scrollContainerRef.current;
    container?.addEventListener('scroll', checkScroll);

    return () => {
      window.removeEventListener('resize', checkScroll);
      container?.removeEventListener('scroll', checkScroll);
    };
  }, [agents.length]);

  // ⭐ J4.5: Charger les prototypes persistés au montage (users authentifiés uniquement)
  useEffect(() => {
    const loadPersistedPrototypes = async () => {
      if (!isAuthenticated || !accessToken) {
        return;
      }

      const result = await fetchAgentPrototypes(accessToken);
      
      if (result.success && result.data) {
        // Convertir format backend → frontend
        const mappedAgents = result.data.map(mapAPIResponseToAgent);
        
        // Remplacer les agents locaux par les agents persistés
        setAgents(mappedAgents);
      }
    };

    loadPersistedPrototypes();
  }, [isAuthenticated, accessToken]);

  const handleCreateAgent = () => {
    setEditingAgent(null);
    setAgentModalOpen(true);
  };

  // PHASE 2B: Template-based agent creation
  const handleCreateFromTemplate = () => {
    setTemplateSelectionOpen(true);
  };

  const handleTemplateSelected = (template: AgentTemplate) => {
    // Utiliser createAgentFromTemplateObject pour supporter templates prédéfinis ET personnalisés
    const agentData = createAgentFromTemplateObject(template, undefined, llmConfigs);

    if (agentData) {
      setEditingAgent({ ...agentData, id: 'temp' } as Agent);
      setTemplateSelectionOpen(false);
      setAgentModalOpen(true);

      addNotification({
        type: 'info',
        title: t('archi_template_loaded'),
        message: `Template "${template.name}" prêt à personnaliser.`,
        duration: 3000
      });
    } else {
      addNotification({
        type: 'error',
        title: t('archi_error'),
        message: `Impossible de créer un agent depuis ce template.`,
        duration: 3000
      });
    }
  };

  const handleEditAgent = (agent: Agent) => {
    setEditingAgent(agent);
    setAgentModalOpen(true);
  };

  const handleAddToWorkflow = (agent: Agent) => {
    // PHASE 2A: Show validation modal first
    setAgentToAdd(agent);
    setWorkflowValidationOpen(true);
  };

  const confirmAddToWorkflow = (instanceName: string, persistenceConfig?: PersistenceConfig) => {
    if (!agentToAdd) return;

    // Create an agent instance with custom name and persistence config if provided
    const agentWithInstanceData = {
      ...agentToAdd,
      instanceName: instanceName || agentToAdd.name,
      // ⭐ Include persistenceConfig override if provided from modal
      ...(persistenceConfig && { persistenceConfig })
    };

    // Use the global onAddToWorkflow prop instead of local store
    if (onAddToWorkflow) {
      onAddToWorkflow(agentWithInstanceData);

      // Show success notification
      addNotification({
        type: 'success',
        title: t('archi_agent_added_workflow'),
        message: `${instanceName || agentToAdd.name} a été ajouté au workflow global`,
        duration: 3000
      });

      // Auto-navigate to workflow to show the newly added agent
      if (onNavigateToWorkflow) {
        onNavigateToWorkflow();
      }
    }

    setWorkflowValidationOpen(false);
    setAgentToAdd(null);
  };

  const handleSaveAgent = async (agentData: Omit<Agent, 'id' | 'creator_id' | 'created_at' | 'updated_at'>, agentId?: string) => {
    if (agentId && agentId !== 'temp') { // Exclure l'ID temporaire des templates
      // Check impact before updating existing agent
      const impact = getPrototypeImpact(agentId);

      if (impact.instanceCount > 0) {
        // There are instances affected, show confirmation
        setPendingUpdate({ agentId, agentData });
        setImpactConfirmOpen(true);
        return;
      } else {
        // No instances affected, proceed directly
        await proceedWithUpdate(agentId, agentData);
      }
    } else {
      // Create new with governance (includes templates with id: 'temp')
      const result = addAgent(agentData);
      
      if (result.success && result.agentId) {
        // ⭐ PERSISTENCE: Si user connecté, sauvegarder aussi dans MongoDB
        if (isAuthenticated && accessToken) {
          const apiResult = await createAgentPrototype(agentData, accessToken, currentRobotId);
          if (apiResult.success && apiResult.data) {
            // ⭐ CRITICAL FIX: Capture ObjectId from backend and update local store
            const backendObjectId = apiResult.data._id || apiResult.data.id;
            if (backendObjectId && backendObjectId !== result.agentId) {
              console.log('[ArchiPrototypingPage] Updating agent ID:', {
                tempId: result.agentId,
                objectId: backendObjectId
              });
              updateAgentId(result.agentId, backendObjectId);
            }
          } else {
            console.warn('[ArchiPrototypingPage] API creation failed, using local ID:', apiResult.error);
          }
        }
        
        addNotification({
          type: 'success',
          title: t('archi_agent_created'),
          message: `"${agentData.name}" a été créé avec succès.`,
          duration: 3000
        });
      } else {
        addNotification({
          type: 'error',
          title: t('archi_creation_refused'),
          message: result.error || 'Erreur de gouvernance',
          duration: 5000
        });
        return; // Don't close modal on error
      }
    }
    setAgentModalOpen(false);
    setEditingAgent(null);
  };

  const proceedWithUpdate = async (agentId: string, agentData: Omit<Agent, 'id' | 'creator_id' | 'created_at' | 'updated_at'>) => {
    const result = updateAgent(agentId, agentData);

    if (result.success) {
      // ⭐ PERSISTENCE: Si user connecté, mettre à jour aussi dans MongoDB
      if (isAuthenticated && accessToken) {
        const apiResult = await updateAgentPrototype(agentId, agentData, accessToken, currentRobotId);
        if (!apiResult.success) {
          // Note: On ne bloque pas - le prototype est mis à jour localement
        }
      }
      
      addNotification({
        type: 'success',
        title: t('archi_prototype_modified'),
        message: `Les modifications ont été appliquées avec succès. Seules les nouvelles instances de ce prototype seront concernées.`,
        duration: 4000
      });
    } else {
      addNotification({
        type: 'error',
        title: t('archi_modification_refused'),
        message: result.error || 'Erreur de gouvernance',
        duration: 5000
      });
    }
  };

  const handleConfirmImpactUpdate = async () => {
    if (pendingUpdate) {
      await proceedWithUpdate(pendingUpdate.agentId, pendingUpdate.agentData);
      setPendingUpdate(null);
      setImpactConfirmOpen(false);
      setAgentModalOpen(false);
      setEditingAgent(null);
    }
  };

  const handleCancelImpactUpdate = () => {
    setPendingUpdate(null);
    setImpactConfirmOpen(false);
  };

  // PHASE 2A: Enhanced deletion with confirmation
  const handleDeleteAgent = (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (agent) {
      setAgentToDelete(agent);
      setDeletionConfirmOpen(true);
    }
  };

  const confirmDeletion = () => {
    // La modale gère maintenant tout : options de suppression + notifications
    // Cette fonction sert juste à fermer la modale après l'action
    setDeletionConfirmOpen(false);
    setAgentToDelete(null);
  };

  const cancelDeletion = () => {
    setDeletionConfirmOpen(false);
    setAgentToDelete(null);
  };

  const cancelWorkflowValidation = () => {
    setWorkflowValidationOpen(false);
    setAgentToAdd(null);
  };

  const cancelTemplateSelection = () => {
    setTemplateSelectionOpen(false);
  };

  // Handler pour ajouter un prototype aux templates
  const handleAddToTemplates = (agent: Agent) => {
    setAgentToAddAsTemplate(agent);
    setAddToTemplatesOpen(true);
  };

  const confirmAddToTemplates = () => {
    if (!agentToAddAsTemplate) return;

    const result = addPrototypeToTemplates(
      agentToAddAsTemplate,
      undefined, // Utiliser le nom par défaut
      undefined  // Utiliser la description par défaut
    );

    if (result) {
      addNotification({
        type: 'success',
        title: t('archi_template_created'),
        message: `Le prototype "${agentToAddAsTemplate.name}" a été ajouté aux templates avec succès.`,
        duration: 3000
      });
    } else {
      // Vérifier si c'est un doublon
      const existingTemplates = loadCustomTemplates();
      const isDuplicate = existingTemplates.some(t => t.sourcePrototypeId === agentToAddAsTemplate.id);

      addNotification({
        type: isDuplicate ? 'warning' : 'error',
        title: isDuplicate ? t('archi_template_existing') : t('archi_creation_failed'),
        message: isDuplicate
          ? `Un template existe déjà pour ce prototype.`
          : `Impossible de créer le template.`,
        duration: 4000
      });
    }

    setAddToTemplatesOpen(false);
    setAgentToAddAsTemplate(null);
  };

  const cancelAddToTemplates = () => {
    setAddToTemplatesOpen(false);
    setAgentToAddAsTemplate(null);
  };

  return (
    <div className="h-full bg-gray-900 text-gray-100 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <WrenchIcon className="w-6 h-6 text-indigo-400" />
            <div>
              <h1 className="text-xl font-bold text-white">{t('page_prototyping_title')}</h1>
              <p className="text-gray-400 text-sm">{t('page_prototyping_description')}</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {/* Action Buttons */}
            <div className="flex space-x-2">
              <Button
                onClick={() => setTodoModalOpen(true)}
                className="flex items-center space-x-2 text-xs"
                variant="secondary"
              >
                <span>📝</span>
                <span>Tâches</span>
              </Button>
              <Button
                onClick={() => setGovernanceTestOpen(true)}
                className="flex items-center space-x-2 text-xs"
                variant="secondary"
              >
                <span>🔒</span>
                <span>Gouvernance</span>
              </Button>
              <Button
                onClick={handleCreateFromTemplate}
                className="flex items-center space-x-2 text-xs"
                variant="secondary"
              >
                <span>📋</span>
                <span>Template</span>
              </Button>
              <Button
                onClick={handleCreateAgent}
                className="flex items-center space-x-2 text-xs"
                variant="primary"
              >
                <PlusIcon className="w-4 h-4" />
                <span>Créer</span>
              </Button>
            </div>

            {/* Governance Indicator - Simplified */}
            <div className="bg-indigo-500/20 border border-indigo-500/30 rounded-lg px-3 py-1.5 whitespace-nowrap">
              <div className="text-xs text-indigo-300 font-medium">{t('current_robot_label')}</div>
              <div className="text-sm text-indigo-100 font-bold">ARCHI</div>
            </div>
          </div>
        </div>
      </div>

      {/* Prototypes Grid - Scrollable Container */}
      <div className="relative flex-1">
        <div
          ref={scrollContainerRef}
          className="absolute inset-0 overflow-y-auto"
        >
          <div className="p-6 min-h-full">
            {agents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <WrenchIcon className="w-16 h-16 text-gray-600 mb-4" />
                <h3 className="text-xl font-semibold text-gray-400 mb-2">{t('no_prototype_empty_title')}</h3>
                <p className="text-gray-500 mb-6 max-w-md">
                  {t('no_prototype_empty_description')}
                </p>
                <div className="flex space-x-3">
                  <Button onClick={handleCreateFromTemplate} className="flex items-center space-x-2" variant="secondary">
                    <span>📋</span>
                    <span>{t('button_create_from_template')}</span>
                  </Button>
                  <Button onClick={handleCreateAgent} className="flex items-center space-x-2">
                    <PlusIcon className="w-4 h-4" />
                    <span>{t('button_create_prototype')}</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {agents.map((agent) => (
                  <Card
                    key={agent.id}
                    className={`p-4 hover:border-indigo-500/50 transition-colors cursor-pointer relative ${selectedAgentId === agent.id ? 'border-indigo-500 bg-indigo-900/20' : ''
                      }`}
                    onClick={() => selectAgent(agent.id)}
                  >
                    {/* Actions */}
                    <div className="absolute top-2 right-2 flex space-x-1">
                      <Button
                        variant="ghost"
                        className="p-1 h-6 w-6 text-gray-400 hover:text-indigo-400"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditAgent(agent);
                        }}
                      >
                        <EditIcon width={14} height={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        className="p-1 h-6 w-6 text-gray-400 hover:text-red-400"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteAgent(agent.id);
                        }}
                      >
                        <CloseIcon width={14} height={14} />
                      </Button>
                    </div>

                    {/* Content */}
                    <div className="pr-12">
                      <h3 className="font-semibold text-lg text-indigo-400 mb-1 truncate">
                        {agent.name}
                      </h3>
                      <p className="text-xs text-gray-400 mb-3 truncate">
                        {agent.role}
                      </p>
                      <p className="text-sm text-gray-300 line-clamp-3 mb-4">
                        {agent.systemPrompt}
                      </p>

                      {/* Metadata */}
                      <div className="space-y-2 mb-4">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">{t('provider_label')}</span>
                          <span className="text-gray-300">{agent.llmProvider}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">{t('model_label')}</span>
                          <span className="text-gray-300">{agent.model}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">{t('capabilities_label')}</span>
                          <span className="text-gray-300">{agent.capabilities.length}</span>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="space-y-2">
                        <Button
                          variant="secondary"
                          className="w-full text-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddToWorkflow(agent);
                          }}
                        >
                          {t('button_add_to_workflow')}
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full text-sm border-purple-600 text-purple-400 hover:bg-purple-500/20"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddToTemplates(agent);
                          }}
                        >
                          {t('button_add_to_templates')}
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Scroll Indicator - Gradient fade at bottom */}
        {showScrollIndicator && (
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-gray-900 via-gray-900/80 to-transparent pointer-events-none flex items-end justify-center pb-2">
            <div className="text-indigo-400 text-xs animate-bounce">
              ⬇ Défilez pour voir plus
            </div>
          </div>
        )}
      </div>

      {/* Agent Form Modal */}
      {agentModalOpen && (
        <AgentFormModal
          onClose={() => {
            setAgentModalOpen(false);
            setEditingAgent(null);
          }}
          onSave={handleSaveAgent}
          llmConfigs={llmConfigs}
          existingAgent={editingAgent}
        />
      )}

      {/* Popup de confirmation d'ajout au workflow */}
      {addedAgentPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold text-white mb-3">
              ✅ Agent ajouté au workflow
            </h3>
            <p className="text-gray-300 mb-4">
              L'agent <span className="font-semibold text-indigo-400">"{addedAgentPopup.agent.name}"</span> a été
              ajouté au workflow avec succès !
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setAddedAgentPopup(null)}
                className="flex-1"
              >
                Continuer ici
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setAddedAgentPopup(null);
                  if (onNavigateToWorkflow) {
                    onNavigateToWorkflow();
                  }
                }}
                className="flex-1"
              >
                Voir sur workflow
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* PHASE 2A: Agent Deletion Confirmation Modal */}
      <AgentDeletionConfirmModal
        isOpen={deletionConfirmOpen}
        agent={agentToDelete}
        onConfirm={confirmDeletion}
        onCancel={cancelDeletion}
        onDeleteNodes={onDeleteNodes}
      />

      {/* PHASE 2A: Workflow Validation Modal */}
      <WorkflowValidationModal
        isOpen={workflowValidationOpen}
        agent={agentToAdd}
        llmConfigs={llmConfigs}
        onConfirm={confirmAddToWorkflow}
        onCancel={cancelWorkflowValidation}
      />

      {/* PHASE 2B: Template Selection Modal */}
      <TemplateSelectionModal
        isOpen={templateSelectionOpen}
        robotId={RobotId.Archi}
        llmConfigs={llmConfigs}
        onSelectTemplate={handleTemplateSelected}
        onCancel={cancelTemplateSelection}
      />

      {/* Prototype Impact Confirmation Modal */}
      <PrototypeImpactModal
        isOpen={impactConfirmOpen}
        prototype={pendingUpdate ? agents.find(a => a.id === pendingUpdate.agentId) : null}
        impact={pendingUpdate ? getPrototypeImpact(pendingUpdate.agentId) : null}
        onConfirm={handleConfirmImpactUpdate}
        onCancel={handleCancelImpactUpdate}
      />

      {/* Governance Test Modal */}
      <GovernanceTestModal
        isOpen={governanceTestOpen}
        onClose={() => setGovernanceTestOpen(false)}
      />

      {/* Todo Modal */}
      <TodoModal
        isOpen={todoModalOpen}
        onClose={() => setTodoModalOpen(false)}
      />

      {/* Add to Templates Confirmation Modal */}
      {addToTemplatesOpen && agentToAddAsTemplate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 border border-purple-600/30">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <span className="text-3xl">💾</span>
                <h2 className="text-xl font-semibold text-white">
                  Ajouter aux Templates
                </h2>
              </div>
              <Button
                variant="ghost"
                onClick={cancelAddToTemplates}
                className="p-2 h-8 w-8 text-gray-400 hover:text-white"
              >
                <CloseIcon width={16} height={16} />
              </Button>
            </div>

            {/* Content */}
            <div className="space-y-4 mb-6">
              <div className="bg-purple-900/20 border border-purple-600/30 rounded-lg p-4">
                <p className="text-purple-200 mb-3">
                  <strong>Prototype :</strong> {agentToAddAsTemplate.name}
                </p>
                <p className="text-gray-300 text-sm">
                  Ce prototype sera converti en template réutilisable.
                </p>
              </div>

              <div className="bg-blue-900/20 border border-blue-600/30 rounded-lg p-4">
                <h3 className="font-semibold text-blue-200 mb-2">Avantages :</h3>
                <ul className="text-blue-200 text-sm space-y-1">
                  <li>• Réutilisation rapide pour de nouveaux projets</li>
                  <li>• Copie indépendante du prototype original</li>
                  <li>• Disponible dans le menu Templates (📋)</li>
                  <li>• Partage possible via export JSON</li>
                </ul>
              </div>

              <div className="bg-gray-700/50 rounded-lg p-3 text-xs text-gray-400">
                💡 <strong>Note :</strong> Le template sera une copie complète de ce prototype.
                Les modifications futures du prototype n'affecteront pas le template.
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={cancelAddToTemplates}
                className="px-4 py-2 text-gray-300 border-gray-600 hover:bg-gray-700"
              >
                Annuler
              </Button>
              <Button
                onClick={confirmAddToTemplates}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white"
              >
                Créer le Template
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};