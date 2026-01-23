import React from 'react';
import { EditIcon } from './Icons';

interface DatabaseNode {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  host: string;
  status: 'connected' | 'disconnected' | 'testing';
  createdAt: string;
}

interface DatabaseListItemProps {
  node: DatabaseNode;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const getStatusColor = (status: string): { bg: string; text: string } => {
  switch (status) {
    case 'connected':
      return { bg: 'bg-green-600', text: 'text-green-200' };
    case 'disconnected':
      return { bg: 'bg-red-600', text: 'text-red-200' };
    case 'testing':
      return { bg: 'bg-yellow-600', text: 'text-yellow-200' };
    default:
      return { bg: 'bg-gray-600', text: 'text-gray-200' };
  }
};

const getStatusIcon = (status: string): string => {
  switch (status) {
    case 'connected':
      return '✓';
    case 'disconnected':
      return '✗';
    case 'testing':
      return '⟳';
    default:
      return '?';
  }
};

export const DatabaseListItem: React.FC<DatabaseListItemProps> = ({
  node,
  isSelected,
  onSelect,
  onEdit,
  onDelete
}) => {
  const statusColors = getStatusColor(node.status);

  return (
    <div
      onClick={onSelect}
      className={`
        p-3 rounded-lg cursor-pointer transition-all border group
        ${isSelected
          ? 'bg-green-600/20 border-green-500 text-white'
          : 'bg-gray-800/50 border-gray-700 text-gray-300 hover:bg-gray-800/80'
        }
      `}
    >
      {/* Header with name and edit button */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-sm truncate">{node.name}</span>
        <div className="flex gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="p-1 text-gray-400 hover:text-green-400 transition-colors opacity-0 group-hover:opacity-100"
            title="Modifier"
          >
            <EditIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Provider and Status */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400">{node.providerName}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${statusColors.bg} ${statusColors.text}`}>
          {getStatusIcon(node.status)}
        </span>
      </div>

      {/* Host */}
      <p className="text-xs text-gray-500 truncate mb-2" title={node.host}>
        {node.host}
      </p>

      {/* Footer info */}
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>{new Date(node.createdAt).toLocaleDateString()}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="px-2 py-0.5 bg-red-600/20 text-red-400 hover:bg-red-600/40 rounded transition-all opacity-0 group-hover:opacity-100"
        >
          Supprimer
        </button>
      </div>
    </div>
  );
};

export default DatabaseListItem;
