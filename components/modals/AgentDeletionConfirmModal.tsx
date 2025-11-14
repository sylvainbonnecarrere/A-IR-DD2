import React from 'react';
import { Agent, AgentInstance } from '../../types';
import { Button } from '../UI';
import { CloseIcon } from '../Icons';
import { useDesignStore } from '../../stores/useDesignStore';
import { useNotifications } from '../../contexts/NotificationContext';

interface AgentDeletionConfirmModalProps {
  isOpen: boolean;
  agent: Agent | null;
  onConfirm: () => void;
  onCancel: () => void;
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
  onConfirm,
  onCancel
}) => {
  const { getInstancesOfPrototype, deleteAgent } = useDesignStore();
  const { addNotification } = useNotifications();

  if (!isOpen || !agent) return null;

  // Analyse d'impact
  const affectedInstances = getInstancesOfPrototype(agent.id);
  const hasActiveInstances = affectedInstances.length > 0;

  const handleDeletePrototypeOnly = () => {
    // Supprimer uniquement le prototype, garder les instances orphelines
    const result = deleteAgent(agent.id, { deleteInstances: false });
    if (result.success) {
      addNotification({
        type: 'success',
        title: 'Prototype supprimé',
        message: hasActiveInstances
          ? `"${agent.name}" supprimé. ${affectedInstances.length} instance(s) orpheline(s) restent dans le workflow.`
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

  const handleDeletePrototypeAndInstances = () => {
    // Supprimer le prototype ET toutes ses instances
    const result = deleteAgent(agent.id, { deleteInstances: true });
    if (result.success) {
      addNotification({
        type: 'success',
        title: 'Suppression complète',
        message: `"${agent.name}" et ses ${affectedInstances.length} instance(s) ont été supprimés du workflow.`,
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
            <p className="text-gray-300 text-sm">{agent.description || 'Aucune description'}</p>
          </div>

          {/* Impact analysis */}
          {hasActiveInstances ? (
            <div className="bg-orange-900/30 border border-orange-500/50 p-3 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <AlertIcon2 className="w-4 h-4 text-orange-400" />
                <span className="text-orange-400 font-semibold">Impact détecté</span>
              </div>
              <p className="text-orange-300 text-sm mb-2">
                Ce prototype a <strong>{affectedInstances.length} instance(s)</strong> active(s) dans le workflow :
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
                    Les {affectedInstances.length} instance(s) du workflow resteront actives (orphelines)
                  </span>
                </div>
              </Button>

              {/* Option 2: Supprimer prototype + instances */}
              <Button
                onClick={handleDeletePrototypeAndInstances}
                variant="danger"
                className="w-full justify-start text-left"
              >
                <div className="flex flex-col items-start">
                  <span className="font-semibold">Supprimer le prototype ET ses instances</span>
                  <span className="text-xs text-red-200 mt-0.5">
                    ⚠️ {affectedInstances.length + 1} élément(s) supprimé(s) (prototype + {affectedInstances.length} instance(s))
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