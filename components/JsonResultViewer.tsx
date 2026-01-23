import React, { useState } from 'react';
import JsonTreeViewer from './JsonTreeViewer';
import JsonTableViewer from './JsonTableViewer';
import JsonSchemaViewer from './JsonSchemaViewer';

interface JsonResultViewerProps {
  data: any;
  status?: number;
  statusText?: string;
  time?: number;
  size?: string;
  isLoading?: boolean;
  error?: string;
}

type TabType = 'tree' | 'table' | 'schema';

export const JsonResultViewer: React.FC<JsonResultViewerProps> = ({
  data,
  status = 200,
  statusText = 'OK',
  time = 0,
  size = '0',
  isLoading = false,
  error
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('tree');

  const statusColor =
    status >= 200 && status < 300 ? 'text-green-400 bg-green-900/20'
      : status >= 300 && status < 400 ? 'text-yellow-400 bg-yellow-900/20'
        : status >= 400 ? 'text-red-400 bg-red-900/20'
          : 'text-gray-400 bg-gray-900/20';

  const TabButton: React.FC<{ id: TabType; label: string; icon: string }> = ({ id, label, icon }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`
        px-3 py-2 text-sm font-medium rounded-t-lg transition-all border-b-2
        ${activeTab === id
          ? 'bg-green-600 text-white border-b-green-400'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600 border-b-transparent'
        }
      `}
    >
      {icon} {label}
    </button>
  );

  if (isLoading) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-4 animate-pulse">
        <div className="h-32 bg-gray-700 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-600 rounded-lg p-4">
        <p className="text-red-400 text-sm font-semibold">❌ Erreur</p>
        <p className="text-red-300 text-xs mt-2">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-4 text-center">
        <p className="text-gray-400 text-sm">Aucune donnée à afficher</p>
      </div>
    );
  }

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden bg-gray-800/50">
      {/* Header avec Badges */}
      <div className="p-4 border-b border-gray-700 bg-gray-900/30">
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className={`p-2 rounded text-xs font-semibold text-center ${statusColor}`}>
            <div className="text-xs text-gray-400">Status</div>
            <div className="font-bold">{status}</div>
          </div>
          <div className="p-2 rounded text-xs font-semibold text-center bg-blue-900/20 text-blue-400">
            <div className="text-xs text-gray-400">Temps</div>
            <div className="font-bold">{time}ms</div>
          </div>
          <div className="p-2 rounded text-xs font-semibold text-center bg-purple-900/20 text-purple-400">
            <div className="text-xs text-gray-400">Taille</div>
            <div className="font-bold">{size}KB</div>
          </div>
          <div className="p-2 rounded text-xs font-semibold text-center bg-gray-700/50 text-gray-300">
            <div className="text-xs text-gray-400">Message</div>
            <div className="font-bold truncate">{statusText}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-700 px-4">
        <div className="flex gap-2">
          <TabButton id="tree" label="Objet" icon="🌳" />
          <TabButton id="table" label="Tableau" icon="📊" />
          <TabButton id="schema" label="Schéma" icon="📋" />
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {activeTab === 'tree' && <JsonTreeViewer data={data} />}
        {activeTab === 'table' && <JsonTableViewer data={data} />}
        {activeTab === 'schema' && <JsonSchemaViewer data={data} />}
      </div>
    </div>
  );
};

export default JsonResultViewer;
