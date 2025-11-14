import React, { useState } from 'react';
import { Agent, LLMConfig, RobotId } from '../types';
import { useDesignStore } from '../stores/useDesignStore';
import { AgentFormModal } from './modals/AgentFormModal';
import { AgentDeletionConfirmModal } from './modals/AgentDeletionConfirmModal';
import { WorkflowValidationModal } from './modals/WorkflowValidationModal';
import { TemplateSelectionModal } from './modals/TemplateSelectionModal';
import { PrototypeImpactModal } from './modals/PrototypeImpactModal';
import { Button, Card } from './UI';
import { PlusIcon, EditIcon, CloseIcon, WrenchIcon } from './Icons';
import { useLocalization } from '../hooks/useLocalization';
import { useNotifications } from '../contexts/NotificationContext';
import { AgentTemplate, createAgentFromTemplate } from '../data/agentTemplates';
import { GovernanceTestModal } from './modals/GovernanceTestModal';
import { TodoModal } from './modals/TodoModal';

interface ArchiPrototypingPageProps {
  llmConfigs: LLMConfig[];
  onNavigateToWorkflow?: () => void;
  onAddToWorkflow?: (agent: Agent) => void;
}

export const ArchiPrototypingPage: React.FC<ArchiPrototypingPageProps> = ({
  llmConfigs,
  onNavigateToWorkflow,
  onAddToWorkflow
}) => {
  const { t } = useLocalization();
  const { addNotification } = useNotifications();
  const {
    agents,
    currentRobotId,
    setCurrentRobot,
    addAgent,
    updateAgent,
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

  const handleCreateAgent = () => {
    setEditingAgent(null);
    setAgentModalOpen(true);
  };

  // PHASE 2B: Template-based agent creation
  const handleCreateFromTemplate = () => {
    setTemplateSelectionOpen(true);
  };

  const handleTemplateSelected = (template: AgentTemplate) => {
    const agentData = createAgentFromTemplate(template.id, undefined, llmConfigs);

    if (agentData) {
      setEditingAgent({ ...agentData, id: 'temp' } as Agent);
      setTemplateSelectionOpen(false);
      setAgentModalOpen(true);

      addNotification({
        type: 'info',
        title: 'Template chargé',
        message: `Template "${template.name}" prêt à personnaliser.`,
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

  const confirmAddToWorkflow = () => {
    if (!agentToAdd) return;

    // Use the global onAddToWorkflow prop instead of local store
    if (onAddToWorkflow) {
      onAddToWorkflow(agentToAdd);

      // Show success notification
      addNotification({
        type: 'success',
        title: 'Agent ajouté au workflow',
        message: `${agentToAdd.name} a été ajouté au workflow global`,
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

  const handleSaveAgent = (agentData: Omit<Agent, 'id' | 'creator_id' | 'created_at' | 'updated_at'>, agentId?: string) => {
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
        proceedWithUpdate(agentId, agentData);
      }
    } else {
      // Create new with governance (includes templates with id: 'temp')
      const result = addAgent(agentData); if (result.success) {
        addNotification({
          type: 'success',
          title: 'Agent créé',
          message: `"${agentData.name}" a été créé avec succès.`,
          duration: 3000
        });
      } else {
        addNotification({
          type: 'error',
          title: 'Création refusée',
          message: result.error || 'Erreur de gouvernance',
          duration: 5000
        });
        return; // Don't close modal on error
      }
    }
    setAgentModalOpen(false);
    setEditingAgent(null);
  };

  const proceedWithUpdate = (agentId: string, agentData: Omit<Agent, 'id' | 'creator_id' | 'created_at' | 'updated_at'>) => {
    const result = updateAgent(agentId, agentData);

    if (result.success) {
      addNotification({
        type: 'success',
        title: 'Agent modifié',
        message: `Les modifications ont été appliquées avec succès.`,
        duration: 3000
      });
    } else {
      addNotification({
        type: 'error',
        title: 'Modification refusée',
        message: result.error || 'Erreur de gouvernance',
        duration: 5000
      });
    }
  };

  const handleConfirmImpactUpdate = () => {
    if (pendingUpdate) {
      proceedWithUpdate(pendingUpdate.agentId, pendingUpdate.agentData);
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

  return (
    <div className="h-full bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <WrenchIcon className="w-6 h-6 text-indigo-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Prototypage d'Agents</h1>
              <p className="text-gray-400 text-sm">Créez et configurez les agents IA pour votre workflow</p>
            </div>
          </div>

          {/* Governance Indicator */}
          <div className="bg-indigo-500/20 border border-indigo-500/30 rounded-lg px-3 py-1.5">
            <div className="text-xs text-indigo-300 font-medium">Robot Actuel</div>
            <div className="text-sm text-indigo-100 font-bold">{currentRobotId}</div>
            <div className="text-xs text-indigo-400">Créateur autorisé</div>
          </div>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="p-6 border-b border-gray-700/50">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-400">
            {agents.length} prototype(s) créé(s)
          </div>
          <div className="flex space-x-3">
            <Button
              onClick={() => setTodoModalOpen(true)}
              className="flex items-center space-x-2"
              variant="secondary"
            >
              <span>📝</span>
              <span>Tâches</span>
            </Button>
            <Button
              onClick={() => setGovernanceTestOpen(true)}
              className="flex items-center space-x-2"
              variant="secondary"
            >
              <span>🔒</span>
              <span>Test Gouvernance</span>
            </Button>
            <Button
              onClick={handleCreateFromTemplate}
              className="flex items-center space-x-2"
              variant="secondary"
            >
              <span>📋</span>
              <span>Template</span>
            </Button>
            <Button
              onClick={handleCreateAgent}
              className="flex items-center space-x-2"
              variant="primary"
            >
              <PlusIcon className="w-4 h-4" />
              <span>Nouvel Agent</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Prototypes Grid */}
      <div className="flex-1 p-6 overflow-y-auto">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <WrenchIcon className="w-16 h-16 text-gray-600 mb-4" />
            <h3 className="text-xl font-semibold text-gray-400 mb-2">Aucun prototype d'agent</h3>
            <p className="text-gray-500 mb-6 max-w-md">
              Commencez par créer votre premier agent. Définissez son rôle, ses capacités
              et les outils qu'il peut utiliser.
            </p>
            <div className="flex space-x-3">
              <Button onClick={handleCreateFromTemplate} className="flex items-center space-x-2" variant="secondary">
                <span>📋</span>
                <span>Partir d'un Template</span>
              </Button>
              <Button onClick={handleCreateAgent} className="flex items-center space-x-2">
                <PlusIcon className="w-4 h-4" />
                <span>Créer le Premier Agent</span>
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
                      <span className="text-gray-500">Fournisseur</span>
                      <span className="text-gray-300">{agent.llmProvider}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Modèle</span>
                      <span className="text-gray-300">{agent.model}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Capacités</span>
                      <span className="text-gray-300">{agent.capabilities.length}</span>
                    </div>
                  </div>

                  {/* Action Button */}
                  <Button
                    variant="secondary"
                    className="w-full text-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddToWorkflow(agent);
                    }}
                  >
                    Ajouter au Workflow
                  </Button>
                </div>
              </Card>
            ))}
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
    </div>
  );
};