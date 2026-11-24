import React, { useState } from 'react';
import { RobotId } from '../../types';
import { Button } from '../UI';
import {
  WrenchIcon,
  AntennaIcon,
  FileAnalysisIcon,
  ClockIcon,
  MonitoringIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '../Icons';

interface NodeTemplate {
  id: string;
  name: string;
  description: string;
  robotId: RobotId;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  defaultConfig: Record<string, unknown>;
}

interface NodePaletteProps {
  onNodeAdd: (template: NodeTemplate) => void;
  currentRobot?: RobotId;
  isOpen: boolean;
  onToggle: () => void;
}

const NODE_TEMPLATES: NodeTemplate[] = [
  // Archi Nodes
  {
    id: 'archi-agent',
    name: 'Agent LLM',
    description: 'Agent intelligent avec configuration LLM',
    robotId: RobotId.Archi,
    icon: WrenchIcon,
    defaultConfig: {
      llmProvider: 'Gemini',
      model: 'gemini-pro',
      systemPrompt: 'Tu es un assistant IA intelligent et utile.',
    },
  },
  {
    id: 'archi-orchestrator',
    name: 'Orchestrateur',
    description: "Coordonne l'exécution de plusieurs agents",
    robotId: RobotId.Archi,
    icon: WrenchIcon,
    defaultConfig: {
      orchestrationType: 'sequential',
      maxConcurrency: 3,
    },
  },

  // Com Nodes
  {
    id: 'com-api-call',
    name: 'Appel API',
    description: 'Effectue un appel vers une API externe',
    robotId: RobotId.Com,
    icon: AntennaIcon,
    defaultConfig: {
      method: 'GET',
      url: '',
      headers: {},
      timeout: 30000,
    },
  },
  {
    id: 'com-webhook',
    name: 'Webhook',
    description: 'Reçoit des données via webhook',
    robotId: RobotId.Com,
    icon: AntennaIcon,
    defaultConfig: {
      path: '/webhook',
      method: 'POST',
      authentication: 'none',
    },
  },

  // Phil Nodes
  {
    id: 'phil-transform',
    name: 'Transformation',
    description: 'Transforme et valide les données',
    robotId: RobotId.Phil,
    icon: FileAnalysisIcon,
    defaultConfig: {
      inputFormat: 'json',
      outputFormat: 'json',
      validationRules: {},
    },
  },
  {
    id: 'phil-file-processor',
    name: 'Traitement Fichier',
    description: 'Traite et analyse les fichiers uploadés',
    robotId: RobotId.Phil,
    icon: FileAnalysisIcon,
    defaultConfig: {
      supportedFormats: ['pdf', 'txt', 'csv', 'json'],
      maxFileSize: '10MB',
    },
  },

  // Tim Nodes
  {
    id: 'tim-scheduler',
    name: 'Planificateur',
    description: 'Exécute des tâches selon un planning',
    robotId: RobotId.Tim,
    icon: ClockIcon,
    defaultConfig: {
      cronExpression: '0 9 * * *',
      timezone: 'Europe/Paris',
    },
  },
  {
    id: 'tim-delay',
    name: 'Délai',
    description: 'Ajoute un délai dans le workflow',
    robotId: RobotId.Tim,
    icon: ClockIcon,
    defaultConfig: {
      delaySeconds: 5,
      delayType: 'fixed',
    },
  },

  // Bos Nodes
  {
    id: 'bos-monitor',
    name: 'Monitoring',
    description: "Surveille l'exécution du workflow",
    robotId: RobotId.Bos,
    icon: MonitoringIcon,
    defaultConfig: {
      metrics: ['execution_time', 'error_rate', 'cost'],
      alertThresholds: {},
    },
  },
  {
    id: 'bos-error-handler',
    name: 'Gestion Erreurs',
    description: 'Gère les erreurs et les reprises',
    robotId: RobotId.Bos,
    icon: MonitoringIcon,
    defaultConfig: {
      retryAttempts: 3,
      retryDelay: 1000,
      fallbackAction: 'log',
    },
  },
];

const getRobotColor = (robotId: RobotId): string => {
  switch (robotId) {
    case RobotId.Archi:
      return 'border-cyan-500 text-cyan-400';
    case RobotId.Com:
      return 'border-orange-500 text-orange-400';
    case RobotId.Phil:
      return 'border-green-500 text-green-400';
    case RobotId.Tim:
      return 'border-yellow-500 text-yellow-400';
    case RobotId.Bos:
      return 'border-purple-500 text-purple-400';
    default:
      return 'border-gray-500 text-gray-400';
  }
};

const getRobotIcon = (robotId: RobotId) => {
  switch (robotId) {
    case RobotId.Archi:
      return WrenchIcon;
    case RobotId.Com:
      return AntennaIcon;
    case RobotId.Phil:
      return FileAnalysisIcon;
    case RobotId.Tim:
      return ClockIcon;
    case RobotId.Bos:
      return MonitoringIcon;
    default:
      return PlusIcon;
  }
};

export const NodePalette: React.FC<NodePaletteProps> = ({ onNodeAdd, currentRobot: _currentRobot, isOpen, onToggle }) => {
  const [expandedRobots, setExpandedRobots] = useState<Set<RobotId>>(
    new Set([RobotId.Archi]), // Archi expanded by default
  );

  const toggleRobotExpansion = (robotId: RobotId) => {
    const newExpanded = new Set(expandedRobots);
    if (newExpanded.has(robotId)) {
      newExpanded.delete(robotId);
    } else {
      newExpanded.add(robotId);
    }
    setExpandedRobots(newExpanded);
  };

  const groupedTemplates = NODE_TEMPLATES.reduce(
    (acc, template) => {
      if (!acc[template.robotId]) {
        acc[template.robotId] = [];
      }
      acc[template.robotId].push(template);
      return acc;
    },
    {} as Record<RobotId, NodeTemplate[]>,
  );

  const handleDragStart = (event: React.DragEvent, template: NodeTemplate) => {
    event.dataTransfer.setData(
      'application/reactflow',
      JSON.stringify({
        type: 'nodeTemplate',
        template,
      }),
    );
    event.dataTransfer.effectAllowed = 'move';
  };

  if (!isOpen) {
    return (
      <div className="fixed left-4 top-20 z-50">
        <Button onClick={onToggle} className="bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700 p-2">
          <PlusIcon className="w-5 h-5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed left-4 top-20 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 max-h-[70vh] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-white font-semibold">Palette de Nodes</h3>
        <Button onClick={onToggle} variant="secondary" className="p-1 text-gray-400 hover:text-white">
          <ChevronRightIcon className="w-4 h-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {Object.entries(groupedTemplates).map(([robotId, templates]) => {
          const RobotIcon = getRobotIcon(robotId as RobotId);
          const robotColor = getRobotColor(robotId as RobotId);
          const isExpanded = expandedRobots.has(robotId as RobotId);

          return (
            <div key={robotId} className="border-b border-gray-700 last:border-b-0">
              {/* Robot Header */}
              <button
                onClick={() => toggleRobotExpansion(robotId as RobotId)}
                className={`w-full p-3 flex items-center justify-between hover:bg-gray-800 transition-colors ${robotColor}`}
              >
                <div className="flex items-center space-x-2">
                  <RobotIcon className="w-5 h-5" />
                  <span className="font-medium">{robotId}</span>
                  <span className="text-xs text-gray-500">({templates.length})</span>
                </div>
                {isExpanded ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
              </button>

              {/* Robot Nodes */}
              {isExpanded && (
                <div className="bg-gray-800/50">
                  {templates.map((template) => {
                    const TemplateIcon = template.icon;
                    return (
                      <div
                        key={template.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, template)}
                        className={`p-3 border-l-2 ${robotColor} cursor-move hover:bg-gray-700/50 transition-colors`}
                        onClick={() => onNodeAdd(template)}
                      >
                        <div className="flex items-start space-x-3">
                          <TemplateIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-sm font-medium truncate">{template.name}</div>
                            <div className="text-gray-400 text-xs mt-1 leading-relaxed">{template.description}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-700 text-xs text-gray-500 text-center">
        Glissez les nodes sur le canvas ou cliquez pour ajouter
      </div>
    </div>
  );
};
