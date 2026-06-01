import React, { useState } from 'react';
import { RobotId, PrototypeType } from '../../types';
import { useGovernance } from '../../services/governanceService';
import { Button, Card, Modal } from '../UI';

interface GovernanceTestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GovernanceTestModal: React.FC<GovernanceTestModalProps> = ({ 
  isOpen, 
  onClose 
}) => {
  const [selectedRobot, setSelectedRobot] = useState<RobotId>(RobotId.Archi);
  const [selectedType, setSelectedType] = useState<PrototypeType>('agent');
  const [selectedOperation, setSelectedOperation] = useState<'create' | 'modify' | 'delete'>('create');
  const [testResult, setTestResult] = useState<{ isValid: boolean; message: string } | null>(null);
  
  const { validateOperation, canCreate, canModify, canDelete, getErrorMessage } = useGovernance();
  
  const handleTest = () => {
    const result = validateOperation(selectedRobot, selectedType, selectedOperation);
    
    if (result.isValid) {
      setTestResult({
        isValid: true,
        message: `✅ AUTORISÉ: Robot ${selectedRobot} peut ${selectedOperation} les prototypes de type ${selectedType}`
      });
    } else {
      setTestResult({
        isValid: false,
        message: `❌ REFUSÉ: ${getErrorMessage(selectedRobot, selectedType, selectedOperation)}`
      });
    }
  };
  
  const handleReset = () => {
    setTestResult(null);
    setSelectedRobot(RobotId.Archi);
    setSelectedType('agent');
    setSelectedOperation('create');
  };
  
  if (!isOpen) return null;
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Test de Gouvernance V2 - Interne" size="xl">
      <div className="space-y-4">

        <Card className="border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="text-sm font-medium text-amber-200">Outil interne / surface provisoire</div>
          <div className="mt-1 text-xs text-amber-100/80">
            Ce modal sert a qualifier les regles de gouvernance avant industrialisation produit. Il ne constitue pas un flux utilisateur final.
          </div>
        </Card>
        
        <div className="text-sm text-gray-400">
          Testez les règles de gouvernance du système selon les mandats des robots spécialisés.
        </div>
        
        {/* Configuration Row - Horizontal Layout */}
        <div className="grid grid-cols-3 gap-4">
          
          {/* Robot Selection */}
          <Card className="p-3">
            <h3 className="text-xs font-semibold text-white mb-2">Robot Testeur</h3>
            <div className="grid grid-cols-1 gap-1">
              {Object.values(RobotId).map((robotId) => (
                <button
                  key={robotId}
                  onClick={() => setSelectedRobot(robotId)}
                  className={`p-2 rounded border text-xs font-medium transition-colors ${
                    selectedRobot === robotId
                      ? 'bg-indigo-500/30 border-indigo-400 text-indigo-300'
                      : 'bg-gray-700/50 border-gray-600 text-gray-300 hover:bg-gray-600/50'
                  }`}
                >
                  {robotId}
                </button>
              ))}
            </div>
          </Card>
          
          {/* Prototype Type Selection */}
          <Card className="p-3">
            <h3 className="text-xs font-semibold text-white mb-2">Type de Prototype</h3>
            <div className="grid grid-cols-1 gap-1">
              {(['agent', 'connection', 'file', 'event'] as PrototypeType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={`p-2 rounded border text-xs font-medium transition-colors ${
                    selectedType === type
                      ? 'bg-green-500/30 border-green-400 text-green-300'
                      : 'bg-gray-700/50 border-gray-600 text-gray-300 hover:bg-gray-600/50'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </Card>
          
          {/* Operation Selection */}
          <Card className="p-3">
            <h3 className="text-xs font-semibold text-white mb-2">Opération</h3>
            <div className="grid grid-cols-1 gap-1">
              {(['create', 'modify', 'delete'] as const).map((operation) => (
                <button
                  key={operation}
                  onClick={() => setSelectedOperation(operation)}
                  className={`p-2 rounded border text-xs font-medium transition-colors ${
                    selectedOperation === operation
                      ? 'bg-yellow-500/30 border-yellow-400 text-yellow-300'
                      : 'bg-gray-700/50 border-gray-600 text-gray-300 hover:bg-gray-600/50'
                  }`}
                >
                  {operation}
                </button>
              ))}
            </div>
          </Card>
        </div>
        
        {/* Quick Validation Display - Horizontal */}
        <Card className="p-3 bg-gray-800/50">
          <h3 className="text-sm font-semibold text-white mb-2">Aperçu des Permissions</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className={`flex justify-between ${canCreate(selectedRobot, selectedType) ? 'text-green-400' : 'text-red-400'}`}>
              <span>Créer:</span>
              <span>{canCreate(selectedRobot, selectedType) ? '✅' : '❌'}</span>
            </div>
            <div className={`flex justify-between ${canModify(selectedRobot, selectedType) ? 'text-green-400' : 'text-red-400'}`}>
              <span>Modifier:</span>
              <span>{canModify(selectedRobot, selectedType) ? '✅' : '❌'}</span>
            </div>
            <div className={`flex justify-between ${canDelete(selectedRobot, selectedType) ? 'text-green-400' : 'text-red-400'}`}>
              <span>Supprimer:</span>
              <span>{canDelete(selectedRobot, selectedType) ? '✅' : '❌'}</span>
            </div>
          </div>
        </Card>
        
        {/* Test Result Display - Compact */}
        {testResult && (
          <Card className={`p-3 border ${testResult.isValid ? 'border-green-500 bg-green-500/10' : 'border-red-500 bg-red-500/10'}`}>
            <div className={`text-sm ${testResult.isValid ? 'text-green-300' : 'text-red-300'}`}>
              {testResult.message}
            </div>
          </Card>
        )}
        
        {/* Actions - Compact Footer */}
        <div className="flex justify-between items-center pt-2 border-t border-gray-700">
          <div className="flex space-x-2">
            <Button variant="secondary" onClick={handleReset} className="text-sm px-3 py-1">
              🔄 Reset
            </Button>
            <Button onClick={handleTest} className="bg-indigo-600 hover:bg-indigo-700 text-sm px-3 py-1">
              🧪 Tester
            </Button>
          </div>
          <Button variant="secondary" onClick={onClose} className="text-sm px-4 py-1">
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  );
};