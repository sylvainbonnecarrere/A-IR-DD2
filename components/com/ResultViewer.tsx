import React, { useState } from 'react';
import { ChevronRightIcon, CopyIcon } from '../Icons';
import { useLocalization } from '../../hooks/useLocalization';

interface JsonNode {
  key: string;
  value: any;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  expanded: boolean;
}

interface ResultViewerProps {
  data: any;
  status?: number;
  statusText?: string;
  time?: number;
  size?: string;
  format?: 'json' | 'xml' | 'csv' | 'raw';
  isLoading?: boolean;
}

const TreeNode: React.FC<{
  node: JsonNode;
  onToggle: (key: string) => void;
  onSelectValue: (path: string, value: any) => void;
  path: string;
}> = ({ node, onToggle, onSelectValue, path }) => {
  const isExpandable = node.type === 'object' || node.type === 'array';
  const entries = isExpandable && typeof node.value === 'object'
    ? Object.entries(node.value).slice(0, 10)
    : [];

  return (
    <div className="font-mono text-sm">
      <div
        className="flex items-center gap-2 py-1 px-2 hover:bg-gray-700/50 rounded cursor-pointer transition-colors"
        onClick={() => isExpandable && onToggle(node.key)}
      >
        {isExpandable && (
          <ChevronRightIcon
            className={`w-4 h-4 text-gray-500 transition-transform ${node.expanded ? 'rotate-90' : ''}`}
          />
        )}
        {!isExpandable && <span className="w-4 h-4" />}

        <span className="text-blue-400">{node.key}</span>
        <span className="text-gray-500">:</span>

        {!isExpandable ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelectValue(path, node.value);
            }}
            className="ml-auto text-gray-500 hover:text-green-400 transition-colors"
            title="Sélectionner cette valeur"
          >
            <CopyIcon className="w-4 h-4" />
          </button>
        ) : (
          <span className="text-gray-500 ml-auto text-xs">
            {node.type === 'array' ? `[${Object.keys(node.value).length}]` : '{...}'}
          </span>
        )}
      </div>

      {isExpandable && node.expanded && (
        <div className="pl-4 border-l border-gray-700">
          {entries.map(([key, value]) => (
            <TreeNode
              key={key}
              node={{
                key,
                value,
                type: Array.isArray(value) ? 'array' : typeof value === 'object' && value !== null ? 'object' : typeof value as any,
                expanded: false
              }}
              onToggle={onToggle}
              onSelectValue={onSelectValue}
              path={`${path}.${key}`}
            />
          ))}
          {Object.keys(node.value).length > 10 && (
            <div className="text-xs text-gray-600 py-1 px-2 italic">
              ... et {Object.keys(node.value).length - 10} autres
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const ResultViewer: React.FC<ResultViewerProps> = ({
  data,
  status = 200,
  statusText = 'OK',
  time = 0,
  size = '0',
  format = 'json',
  isLoading = false
}) => {
  const { t } = useLocalization();
  const [viewMode, setViewMode] = useState<'tree' | 'table' | 'raw'>('tree');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedValues, setSelectedValues] = useState<Array<{ path: string; value: any }>>([]);

  const handleToggle = (key: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedNodes(newExpanded);
  };

  const handleSelectValue = (path: string, value: any) => {
    setSelectedValues(prev => {
      const exists = prev.find(v => v.path === path);
      if (exists) {
        return prev.filter(v => v.path !== path);
      }
      return [...prev, { path, value }];
    });
  };

  const isArray = Array.isArray(data);

  return (
    <div className="space-y-4 p-4 rounded-lg border border-gray-700 bg-gray-800/30">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`px-3 py-1 rounded-full text-sm font-bold ${
              status >= 200 && status < 300
                ? 'bg-green-600/30 text-green-300'
                : status >= 400
                  ? 'bg-red-600/30 text-red-300'
                  : 'bg-yellow-600/30 text-yellow-300'
            }`}
          >
            {status} {statusText}
          </div>
          <div className="text-xs text-gray-500">
            {time}ms • {size} KB
          </div>
        </div>

        {/* View Mode Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('tree')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              viewMode === 'tree'
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            🌳 Arborescence
          </button>
          <button
            onClick={() => setViewMode('table')}
            disabled={!isArray && typeof data !== 'object'}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              viewMode === 'table'
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            📊 Tableau
          </button>
          <button
            onClick={() => setViewMode('raw')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              viewMode === 'raw'
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            💾 Brut
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-y-auto bg-gray-900/50 rounded border border-gray-700">
        {viewMode === 'tree' && (
          <div className="p-3 space-y-1">
            {typeof data === 'object' && data !== null ? (
              <TreeNode
                node={{
                  key: 'root',
                  value: data,
                  type: Array.isArray(data) ? 'array' : 'object',
                  expanded: true
                }}
                onToggle={handleToggle}
                onSelectValue={handleSelectValue}
                path="$"
              />
            ) : (
              <div className="text-gray-400 text-sm">{String(data)}</div>
            )}
          </div>
        )}

        {viewMode === 'table' && isArray && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-800">
                  {data.length > 0 &&
                    typeof data[0] === 'object' &&
                    Object.keys(data[0]).map(key => (
                      <th key={key} className="px-3 py-2 text-left text-gray-300 font-semibold">
                        {key}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, idx) => (
                  <tr key={idx} className="border-b border-gray-700 hover:bg-gray-800/50">
                    {typeof row === 'object' &&
                      Object.values(row).map((val, i) => (
                        <td key={i} className="px-3 py-2 text-gray-400 truncate max-w-xs">
                          {String(val)}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {viewMode === 'raw' && (
          <div className="p-3 font-mono text-xs text-gray-300 whitespace-pre-wrap break-words">
            {JSON.stringify(data, null, 2)}
          </div>
        )}
      </div>

      {/* Drag & Drop hint */}
      {selectedValues.length > 0 && viewMode === 'tree' && (
        <div className="text-xs text-green-400 bg-green-900/20 p-2 rounded border border-green-700/30">
          {selectedValues.length} valeur(s) sélectionnée(s) - 🎯 Prêt pour drag & drop
        </div>
      )}
    </div>
  );
};

export default ResultViewer;
