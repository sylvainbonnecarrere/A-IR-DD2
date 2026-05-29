import React, { useEffect, useState } from 'react';
import { Agent, AgentBatchDeleteResult, AgentDeletionMediaPolicy } from '../../types';
import { Button } from '../UI';
import { CloseIcon } from '../Icons';
import { useDesignStore } from '../../stores/useDesignStore';
import { useNotifications } from '../../contexts/NotificationContext';
import { useAuth } from '../../hooks/useAuth';
import { deleteAgentPrototype, type AgentPrototypeImpact } from '../../services/agentPrototypeAPI';

interface AgentDeletionConfirmModalProps {
  isOpen: boolean;
  agent: Agent | null;
  impact: AgentPrototypeImpact | null;
  onConfirm: () => void;
  onCancel: () => void;
  onDeleteNodes?: (instanceIds: string[], mediaPolicy: AgentDeletionMediaPolicy) => Promise<AgentBatchDeleteResult> | AgentBatchDeleteResult; // Callback to delete nodes by instanceId
}

const AlertIcon2 = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="m12 17 .01 0" />
  </svg>
);

export const AgentDeletionConfirmModal: React.FC<AgentDeletionConfirmModalProps> = ({
  isOpen,
  agent,
  impact,
  onConfirm,
  onCancel,
  onDeleteNodes
}) => {
  const { deleteAgent } = useDesignStore();
  const { addNotification } = useNotifications();
  const { isAuthenticated, accessToken } = useAuth();
  const [mediaPolicy, setMediaPolicy] = useState<AgentDeletionMediaPolicy>('delete_media');

  useEffect(() => {
    if (isOpen) {
      setMediaPolicy('delete_media');
    }
  }, [agent?.id, isOpen]);

  if (!isOpen || !agent) return null;
  if (!isOpen || !agent || !impact) return null;

  // Analyse d'impact
  const affectedInstances = impact.instances;
  const hasActiveInstances = impact.instanceCount > 0;

  const handleDeletePrototypeOnly = async () => {
    if (isAuthenticated && accessToken) {
      const apiResult = await deleteAgentPrototype(agent.id, accessToken);
      if (!apiResult.success) {
        addNotification({
          type: 'error',
          title: 'Suppression refusée',
          message: apiResult.error || 'Erreur de gouvernance backend',
          duration: 5000
        });
        return;
      }
    }

    // Supprimer uniquement le prototype, garder les instances orphelines
    const result = deleteAgent(agent.id, { deleteInstances: false });
    if (result.success) {
      
      addNotification({
        type: 'success',
        title: 'Prototype supprimé',
        message: hasActiveInstances
          ? `"${agent.name}" supprimé. ${impact.instanceCount} instance(s) orpheline(s) restent dans le workflow.`
          : `"${agent.name}" supprimé avec succès.`,
        duration: 4000
      });
      onConfirm();
    } else {
      addNotification({
        type: 'error',
        title: 'Suppression refusée',
        message: result.error || 'Erreur de gouvernance',
        duration: 5000
      });
    }
  };

  const handleDeletePrototypeAndInstances = async () => {
    // Identify instance IDs to delete (for syncing with App.tsx workflowNodes)
    const instancesToDelete = affectedInstances.map(inst => inst.id);

    if (isAuthenticated && accessToken) {
      const apiResult = await deleteAgentPrototype(agent.id, accessToken);
      if (!apiResult.success) {
        addNotification({
          type: 'error',
          title: 'Suppression refusée',
          message: apiResult.error || 'Erreur de gouvernance backend',
          duration: 5000
        });
        return;
      }
    }

    if (onDeleteNodes && instancesToDelete.length > 0) {
      const deletionResult = await onDeleteNodes(instancesToDelete, mediaPolicy);

      if (deletionResult && !deletionResult.success) {
        const fallbackResult = deleteAgent(agent.id, { deleteInstances: false });

        if (fallbackResult.success) {
          addNotification({
            type: 'warning',
            title: 'Suppression partielle',
            message: deletionResult.error || `"${agent.name}" a ete supprime, mais certaines instances ont ete conservees avec leurs medias.`,
            duration: 6000
          });
          onConfirm();
          return;
        }

        addNotification({
          type: 'error',
          title: 'Suppression refusee',
          message: deletionResult.error || fallbackResult.error || 'Erreur de suppression des instances',
          duration: 5000
        });
        return;
      }
    }

    // Supprimer le prototype ET toutes ses instances
    const result = deleteAgent(agent.id, { deleteInstances: true });
    if (result.success) {
      addNotification({
        type: 'success',
        title: 'Suppression complète',
        message: mediaPolicy === 'orphan_media'
          ? `"${agent.name}" et ses ${impact.instanceCount} instance(s) ont ete supprimes. Les medias associes sont conserves comme orphelins.`
          : `"${agent.name}" et ses ${impact.instanceCount} instance(s) ont ete supprimes du workflow avec leurs medias.`,
        duration: 4000
      });
      onConfirm();
    } else {
      addNotification({
        type: 'error',
        title: 'Suppression refusée',
        message: result.error || 'Erreur de gouvernance',
        duration: 5000
      });
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl border border-gray-600">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <AlertIcon2 className="w-6 h-6 text-red-400" />
            <h2 className="text-xl font-bold text-white">Confirmer la suppression</h2>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          {/* Agent info */}
          <div className="bg-gray-700 p-3 rounded-lg">
            <p className="text-white font-semibold">{agent.name}</p>
            <p className="text-gray-300 text-sm">{agent.role || agent.systemPrompt || 'Aucune description'}</p>
          </div>

          {/* Impact analysis */}
          {hasActiveInstances ? (
            <div className="bg-orange-900/30 border border-orange-500/50 p-3 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <AlertIcon2 className="w-4 h-4 text-orange-400" />
                <span className="text-orange-400 font-semibold">Impact détecté</span>
              </div>
              <p className="text-orange-300 text-sm mb-2">
                Ce prototype a <strong>{impact.instanceCount} instance(s)</strong> active(s) dans le workflow :
              </p>
              <ul className="text-orange-200 text-sm space-y-1 ml-4 max-h-32 overflow-y-auto">
                {affectedInstances.map((instance) => (
                  <li key={instance.id} className="flex items-center space-x-2">
                    <span className="w-1 h-1 bg-orange-400 rounded-full"></span>
                    <span>{instance.name}</span>
                  </li>
                ))}
              </ul>
              <p className="text-orange-300 text-sm mt-3">
                💡 <strong>Que souhaitez-vous faire ?</strong>
              </p>
            </div>
          ) : (
            <div className="bg-green-900/30 border border-green-500/50 p-3 rounded-lg">
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 bg-green-400 rounded-full flex items-center justify-center">
                  <span className="text-green-900 text-xs">✓</span>
                </div>
                <span className="text-green-400">Suppression sécurisée</span>
              </div>
              <p className="text-green-300 text-sm mt-1">
                Aucune instance active détectée. La suppression n'affectera pas le workflow.
              </p>
            </div>
          )}

          {/* Warning */}
          <div className="bg-yellow-900/30 border border-yellow-500/50 p-3 rounded-lg">
            <p className="text-yellow-300 text-sm">
              ⚠️ Cette action est <strong>irréversible</strong>. Le prototype et sa configuration seront définitivement perdus.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 space-y-3">
          {hasActiveInstances ? (
            <>
              {/* Option 1: Supprimer prototype seul */}
              <Button
                onClick={handleDeletePrototypeOnly}
                variant="secondary"
                className="w-full justify-start text-left"
              >
                <div className="flex flex-col items-start">
                  <span className="font-semibold">Supprimer uniquement le prototype</span>
                  <span className="text-xs text-gray-400 mt-0.5">
                    Les {impact.instanceCount} instance(s) du workflow resteront actives (orphelines)
                  </span>
                </div>
              </Button>

              <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4 space-y-3">
                <p className="text-sm font-semibold text-white">Politique media pour les instances supprimees</p>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="agent-media-policy"
                    aria-label="Supprimer les medias lies"
                    checked={mediaPolicy === 'delete_media'}
                    onChange={() => setMediaPolicy('delete_media')}
                    className="mt-1"
                  />
                  <div>
                    <p className="text-sm text-white">Supprimer les medias lies</p>
                    <p className="text-xs text-gray-400">Efface les references cataloguees et leurs supports actuellement geres.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="agent-media-policy"
                    aria-label="Conserver les medias comme orphelins"
                    checked={mediaPolicy === 'orphan_media'}
                    onChange={() => setMediaPolicy('orphan_media')}
                    className="mt-1"
                  />
                  <div>
                    <p className="text-sm text-white">Conserver les medias comme orphelins</p>
                    <p className="text-xs text-gray-400">L'instance disparait, mais les medias restent visibles dans BOS Media avec le statut orphelin.</p>
                  </div>
                </label>
              </div>

              {/* Option 2: Supprimer prototype + instances */}
              <Button
                onClick={handleDeletePrototypeAndInstances}
                variant="danger"
                className="w-full justify-start text-left"
              >
                <div className="flex flex-col items-start">
                  <span className="font-semibold">Supprimer le prototype ET ses instances</span>
                  <span className="text-xs text-red-200 mt-0.5">
                    ⚠️ {impact.instanceCount + 1} élément(s) supprimé(s) (prototype + {impact.instanceCount} instance(s))
                  </span>
                </div>
              </Button>

              {/* Option 3: Annuler */}
              <Button
                onClick={onCancel}
                variant="ghost"
                className="w-full"
              >
                Annuler
              </Button>
            </>
          ) : (
            <>
              {/* Si pas d'instances: simple confirmation */}
              <div className="flex space-x-3">
                <Button
                  onClick={onCancel}
                  variant="secondary"
                  className="flex-1"
                >
                  Annuler
                </Button>
                <Button
                  onClick={handleDeletePrototypeOnly}
                  variant="danger"
                  className="flex-1"
                >
                  Supprimer le prototype
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};