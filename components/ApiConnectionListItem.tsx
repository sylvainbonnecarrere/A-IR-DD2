import React from 'react';
import { EditIcon } from './Icons';

interface ApiConnection {
  id: string;
  name: string;
  method: string;
  url: string;
  authType: string;
  createdAt: string;
  lastUsed?: string;
}

interface ApiConnectionListItemProps {
  connection: ApiConnection;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const getMethodColor = (method: string): string => {
  switch (method) {
    case 'GET':
      return 'bg-blue-600 text-blue-200';
    case 'POST':
      return 'bg-green-600 text-green-200';
    case 'PUT':
      return 'bg-orange-600 text-orange-200';
    case 'DELETE':
      return 'bg-red-600 text-red-200';
    case 'PATCH':
      return 'bg-purple-600 text-purple-200';
    default:
      return 'bg-gray-600 text-gray-200';
  }
};

export const ApiConnectionListItem: React.FC<ApiConnectionListItemProps> = ({
  connection,
  isSelected,
  onSelect,
  onEdit,
  onDelete
}) => {
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
        <span className="font-semibold text-sm truncate">{connection.name}</span>
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

      {/* Method badge */}
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${getMethodColor(connection.method)}`}>
          {connection.method}
        </span>
      </div>

      {/* URL */}
      <p className="text-xs text-gray-400 truncate mb-2" title={connection.url}>
        {connection.url}
      </p>

      {/* Footer info */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{new Date(connection.createdAt).toLocaleDateString()}</span>
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

export default ApiConnectionListItem;
