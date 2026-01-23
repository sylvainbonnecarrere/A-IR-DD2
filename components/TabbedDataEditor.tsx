import React, { useState } from 'react';
import JsonTreeViewer from './JsonTreeViewer';
import JsonTableViewer from './JsonTableViewer';
import JsonSchemaViewer from './JsonSchemaViewer';

interface TabbedDataEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

type TabType = 'editor' | 'table' | 'schema';

export const TabbedDataEditor: React.FC<TabbedDataEditorProps> = ({
  value,
  onChange,
  placeholder = '{}',
  readOnly = false
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('editor');

  const isValidJson = (() => {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  })();

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

  return (
    <div className="border border-gray-600 rounded-lg overflow-hidden bg-gray-800/50">
      {/* Tabs */}
      <div className="border-b border-gray-700 px-4 bg-gray-900/30">
        <div className="flex gap-2">
          <TabButton id="editor" label="Éditeur" icon="✏️" />
          {isValidJson && (
            <>
              <TabButton id="table" label="Tableau" icon="📊" />
              <TabButton id="schema" label="Schéma" icon="📋" />
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {activeTab === 'editor' && (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            readOnly={readOnly}
            className={`
              w-full h-32 px-4 py-3 rounded-lg bg-gray-700 border
              text-gray-200 placeholder-gray-500 text-sm font-mono
              transition-all resize-none
              focus:outline-none
              ${isValidJson
                ? 'border-green-500 focus:border-green-400'
                : 'border-red-500 focus:border-red-400'
              }
              ${readOnly ? 'opacity-75 cursor-not-allowed' : 'cursor-text'}
            `}
          />
        )}
        {activeTab === 'table' && isValidJson && <JsonTableViewer data={value} />}
        {activeTab === 'schema' && isValidJson && <JsonSchemaViewer data={value} />}
      </div>

      {/* Validation indicator */}
      {value && !isValidJson && (
        <div className="px-4 py-2 bg-red-900/20 border-t border-red-700 text-xs text-red-400">
          ⚠️ JSON invalide - Corrigez le format
        </div>
      )}
    </div>
  );
};

export default TabbedDataEditor;
