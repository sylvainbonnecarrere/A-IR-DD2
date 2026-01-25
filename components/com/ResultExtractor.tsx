import React, { useState } from 'react';
import { CopyIcon } from '../Icons';

interface ResultExtractorProps {
  data: any;
  onExtract?: (selectedPath: string, value: any) => void;
}

interface JsonNode {
  path: string;
  value: any;
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  children?: JsonNode[];
  isExpanded?: boolean;
}

const buildJsonTree = (obj: any, path = 'root'): JsonNode => {
  const type = Array.isArray(obj) ? 'array' : typeof obj === 'object' ? 'object' : typeof obj;
  const node: JsonNode = {
    path,
    value: obj,
    type: type as any
  };

  if (type === 'object' || type === 'array') {
    node.children = Object.entries(obj).map(([key, val]) => 
      buildJsonTree(val, `${path}.${key}`)
    );
    node.isExpanded = path === 'root';
  }

  return node;
};

const NodeRenderer: React.FC<{
  node: JsonNode;
  onSelect: (path: string, value: any) => void;
  onToggleExpand: (path: string) => void;
  selectedPath?: string;
}> = ({ node, onSelect, onToggleExpand, selectedPath }) => {
  const isLeaf = !node.children || node.children.length === 0;
  const isSelected = selectedPath === node.path;

  return (
    <div className="font-mono text-xs">
      <div
        onClick={() => {
          if (!isLeaf) onToggleExpand(node.path);
          onSelect(node.path, node.value);
        }}
        className={`
          py-1 px-2 rounded cursor-pointer transition-colors flex items-center gap-2
          ${isSelected 
            ? 'bg-green-600/40 text-green-300 ring-1 ring-green-500/50' 
            : 'hover:bg-gray-700/50 text-gray-300'
          }
        `}
      >
        {!isLeaf && (
          <span className={`transition-transform ${node.isExpanded ? 'rotate-90' : ''}`}>
            ▶
          </span>
        )}
        {isLeaf && <span className="w-4"></span>}
        
        <span className="font-semibold text-cyan-300">
          {node.path.split('.').pop()}
        </span>
        
        <span className="text-gray-500">:</span>
        
        <span className="text-green-400">
          {node.type === 'object' ? '{}' : node.type === 'array' ? '[]' : JSON.stringify(node.value).substring(0, 30)}
        </span>
      </div>

      {node.children && node.isExpanded && (
        <div className="ml-4 border-l border-gray-600/30 pl-2">
          {node.children.map((child) => (
            <NodeRenderer
              key={child.path}
              node={child}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const ResultExtractor: React.FC<ResultExtractorProps> = ({ data, onExtract }) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['root']));
  
  const jsonTree = buildJsonTree(data);

  const handleToggleExpand = (path: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedNodes(newExpanded);

    // Update tree structure
    const updateNode = (node: JsonNode) => {
      node.isExpanded = newExpanded.has(node.path);
      node.children?.forEach(updateNode);
    };
    updateNode(jsonTree);
  };

  const handleSelect = (path: string, value: any) => {
    setSelectedPath(path);
    onExtract?.(path, value);
  };

  const handleCopyPath = () => {
    if (selectedPath) {
      navigator.clipboard.writeText(selectedPath);
    }
  };

  const handleCopyValue = () => {
    if (selectedPath) {
      const selected = jsonTree.children?.find(c => c.path === selectedPath);
      if (selected) {
        navigator.clipboard.writeText(JSON.stringify(selected.value, null, 2));
      }
    }
  };

  if (!data) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        Aucune donnée à extraire
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toggle Header */}
      <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsEnabled(!isEnabled)}
            className={`
              relative w-10 h-6 rounded-full transition-all
              ${isEnabled ? 'bg-green-600' : 'bg-gray-600'}
            `}
          >
            <div
              className={`
                absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform
                ${isEnabled ? 'translate-x-4' : ''}
              `}
            />
          </button>
          <label className="text-sm font-medium text-gray-300 cursor-pointer" onClick={() => setIsEnabled(!isEnabled)}>
            🎯 Résultat à renvoyer
          </label>
        </div>
        <span className={`text-xs font-semibold ${isEnabled ? 'text-green-400' : 'text-gray-500'}`}>
          {isEnabled ? '✓ Activé' : 'Désactivé'}
        </span>
      </div>

      {/* Information Panel - Only shown when enabled */}
      {isEnabled && (
        <div className="p-3 bg-green-900/20 border border-green-500/30 rounded-lg">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-green-300 leading-relaxed flex-1">
              💡 Ce nœud renverra systématiquement cette sélection de données au lieu du résultat complet.
            </p>
            <button
              className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold rounded bg-green-600/50 hover:bg-green-600 text-green-200 transition-all whitespace-nowrap"
              title="Configuration du résultat extrait (POC)"
            >
              ⚙️ Paramétrer
            </button>
          </div>
        </div>
      )}

      {/* Extraction Interface */}
      {isEnabled && (
        <div className="space-y-3 p-3 bg-gray-800/30 rounded-lg border border-gray-700">
          {/* Instructions */}
          <p className="text-xs text-gray-400">
            Cliquez sur un élément pour le sélectionner. Vous pouvez ensuite le copier ou l'utiliser dans le workflow.
          </p>

          {/* Tree View */}
          <div className="max-h-64 overflow-y-auto p-3 bg-gray-900/50 rounded border border-gray-700/50 space-y-1">
            <NodeRenderer
              node={jsonTree}
              onSelect={handleSelect}
              onToggleExpand={handleToggleExpand}
              selectedPath={selectedPath || undefined}
            />
          </div>

          {/* Selected Item Display */}
          {selectedPath && (
            <div className="p-3 bg-green-900/20 border border-green-500/30 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400">📍 Chemin sélectionné</p>
                  <p className="text-sm font-mono text-green-400">{selectedPath}</p>
                </div>
                <button
                  onClick={handleCopyPath}
                  className="p-2 rounded hover:bg-green-600/30 text-green-300 transition-colors"
                  title="Copier le chemin"
                >
                  <CopyIcon className="w-4 h-4" />
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleCopyValue}
                  className="flex-1 px-3 py-1.5 text-xs font-semibold rounded bg-green-600/50 hover:bg-green-600 text-green-200 transition-all flex items-center justify-center gap-1"
                >
                  <CopyIcon className="w-3 h-3" />
                  Copier valeur
                </button>
                <button
                  onClick={() => {
                    setSelectedPath(null);
                  }}
                  className="flex-1 px-3 py-1.5 text-xs font-semibold rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-all"
                >
                  Réinitialiser
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ResultExtractor;
