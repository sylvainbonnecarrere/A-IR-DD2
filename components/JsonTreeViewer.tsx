import React, { useState } from 'react';
import { ChevronDownIcon } from './Icons';

interface JsonTreeNode {
  key: string;
  value: any;
  type: string;
}

interface JsonTreeViewerProps {
  data: any;
  defaultExpanded?: boolean;
}

const TreeNode: React.FC<{ node: JsonTreeNode; level: number }> = ({ node, level }) => {
  const [isExpanded, setIsExpanded] = useState(node.type !== 'string' && node.type !== 'number' && node.type !== 'boolean');

  const isExpandable = ['object', 'array'].includes(node.type);
  const isArray = Array.isArray(node.value);
  const entries = isExpandable ? (isArray ? node.value.map((v, i) => ({ key: `[${i}]`, value: v, type: typeof v })) : Object.entries(node.value).map(([k, v]) => ({ key: k, value: v, type: typeof v }))) : [];

  const getValueColor = (type: string): string => {
    switch (type) {
      case 'string':
        return 'text-green-400';
      case 'number':
        return 'text-cyan-400';
      case 'boolean':
        return 'text-purple-400';
      case 'null':
        return 'text-gray-500';
      default:
        return 'text-gray-300';
    }
  };

  const getDisplayValue = (type: string, value: any): string => {
    if (type === 'string') return `"${value}"`;
    if (type === 'boolean') return value ? 'true' : 'false';
    if (value === null) return 'null';
    if (type === 'object' || type === 'array') return isArray ? `Array(${value.length})` : 'Object';
    return String(value);
  };

  const paddingLeft = `${level * 16}px`;

  return (
    <div>
      <div
        style={{ paddingLeft }}
        className="flex items-center gap-2 py-1 hover:bg-gray-800/50 text-sm"
      >
        {isExpandable && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center justify-center w-4 h-4 flex-shrink-0 hover:bg-gray-700 rounded"
          >
            <ChevronDownIcon className={`w-3 h-3 text-gray-400 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
          </button>
        )}
        {!isExpandable && <div className="w-4" />}

        <span className="text-gray-400">{node.key}:</span>
        <span className={getValueColor(node.type)}>
          {getDisplayValue(node.type, node.value)}
        </span>
      </div>

      {isExpandable && isExpanded && (
        <div>
          {entries.map((entry, idx) => (
            <TreeNode key={`${level}-${entry.key}`} node={entry} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const JsonTreeViewer: React.FC<JsonTreeViewerProps> = ({ data, defaultExpanded = true }) => {
  let rootNode: JsonTreeNode;

  try {
    if (typeof data === 'string') {
      rootNode = { key: 'root', value: JSON.parse(data), type: 'object' };
    } else {
      rootNode = { key: 'root', value: data, type: typeof data };
    }
  } catch (error) {
    return (
      <div className="text-red-400 text-sm p-4">
        ❌ Erreur JSON: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="text-sm font-mono bg-gray-800/50 rounded p-4 max-h-96 overflow-y-auto">
      <TreeNode node={rootNode} level={0} />
    </div>
  );
};

export default JsonTreeViewer;
