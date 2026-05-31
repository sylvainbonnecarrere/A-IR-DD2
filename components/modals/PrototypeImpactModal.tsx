import React from 'react';
import { Button } from '../UI';
import { CloseIcon, ErrorIcon as WarningIcon } from '../Icons';
import { Agent } from '../../types';
import type { AgentPrototypeImpact } from '../../services/agentPrototypeAPI';

interface PrototypeImpactModalProps {
  isOpen: boolean;
  prototype: Agent | null;
  impact: AgentPrototypeImpact | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const PrototypeImpactModal: React.FC<PrototypeImpactModalProps> = ({
  isOpen,
  prototype,
  impact,
  onConfirm,
  onCancel
}) => {
  if (!isOpen || !prototype || !impact) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 border border-gray-600">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <WarningIcon className="text-orange-400" width={24} height={24} />
            <h2 className="text-xl font-semibold text-white">
              Impact de la modification
            </h2>
          </div>
          <Button
            variant="ghost"
            onClick={onCancel}
            className="p-2 h-8 w-8 text-gray-400 hover:text-white"
          >
            <CloseIcon width={16} height={16} />
          </Button>
        </div>

        {/* Content */}
        <div className="space-y-4 mb-6">
          <div className="bg-orange-900/20 border border-orange-600/30 rounded-lg p-4">
            <p className="text-orange-200 mb-3">
              <strong>Attention :</strong> Vous vous apprêtez à modifier le prototype <strong>"{prototype.name}"</strong>.
            </p>

            <div className="text-gray-300 space-y-2">
              <p>
                <strong>Instances déployées actuellement :</strong> {impact.instanceCount} instance(s) active(s)
              </p>
              <p>
                <strong>Nœuds de workflow :</strong> {impact.nodeCount} nœud(s) dans le canvas
              </p>
            </div>
          </div>

          {/* Avertissement de non-affectation */}
          <div className="bg-red-900/20 border border-red-600/30 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <WarningIcon className="text-red-400 flex-shrink-0 mt-0.5" width={20} height={20} />
              <div>
                <h3 className="font-semibold text-red-200 mb-2">⚠️ Avertissement Important</h3>
                <p className="text-red-200 text-sm">
                  <strong>Les {impact.instanceCount} instance(s) existante(s) ne seront PAS affectées par ces changements.</strong>
                  {' '}Seules les <strong>futures instances</strong> de ce prototype bénéficieront des modifications.
                </p>
              </div>
            </div>
          </div>

          {impact.instances.length > 0 && (
            <div className="bg-gray-700/50 rounded-lg p-4">
              <h3 className="font-semibold text-white mb-3">Instances concernées :</h3>
              <div className="space-y-2">
                {impact.instances.map((instance) => (
                  <div key={instance.id} className="flex items-center space-x-3 text-sm">
                    <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                    <span className="text-gray-300">
                      {instance.name} <span className="text-gray-500">(Position: {Math.round(instance.position.x)}, {Math.round(instance.position.y)})</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-blue-900/20 border border-blue-600/30 rounded-lg p-4">
            <h3 className="font-semibold text-blue-200 mb-2">Que va-t-il se passer ?</h3>
            <ul className="text-blue-200 text-sm space-y-1">
              <li>• <strong>Seule la définition du prototype sera modifiée</strong></li>
              <li>• Les instances existantes <strong>conserveront leurs configurations actuelles</strong></li>
              <li>• Les nouvelles instances créées après cette modification utiliseront la nouvelle définition</li>
              <li>• Les conversations et historiques des instances existantes restent intacts</li>
              <li>• Les positions sur le canvas ne changeront pas</li>
            </ul>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3">
          <Button
            variant="outline"
            onClick={onCancel}
            className="px-4 py-2 text-gray-300 border-gray-600 hover:bg-gray-700"
          >
            Annuler
          </Button>
          <Button
            onClick={onConfirm}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white"
          >
            Confirmer la modification
          </Button>
        </div>
      </div>
    </div>
  );
};