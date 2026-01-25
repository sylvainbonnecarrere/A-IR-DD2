import React from 'react';
import { TrashIcon, EditIcon, CheckCircleIcon, AlertCircleIcon, ClockIcon } from '../Icons';
import { useLocalization } from '../../hooks/useLocalization';

export interface IConnectionItem {
  id: string;
  name: string;
  method?: string; // For APIs
  url?: string;
  provider?: string; // For Databases
  host?: string;
  status?: 'connected' | 'disconnected' | 'testing' | 'tested' | 'error';
  lastTestDate?: string;
  format?: string; // For APIs (JSON, XML, CSV, etc.)
}

interface ConnectionListItemProps {
  item: IConnectionItem;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddToWorkflow?: () => void;
  onOpen?: () => void;
  type: 'api' | 'database';
}

const getStatusIndicator = (
  status?: string
): { icon: React.ReactNode; label: string; bgColor: string; textColor: string } => {
  const statusMap: {
    [key: string]: { icon: string; label: string; bgColor: string; textColor: string };
  } = {
    connected: {
      icon: '✓',
      label: 'Disponible',
      bgColor: 'bg-green-600',
      textColor: 'text-green-200'
    },
    tested: {
      icon: '✓',
      label: 'Disponible',
      bgColor: 'bg-green-600',
      textColor: 'text-green-200'
    },
    disconnected: {
      icon: '✗',
      label: 'Indisponible',
      bgColor: 'bg-red-600',
      textColor: 'text-red-200'
    },
    error: {
      icon: '⚠',
      label: 'Erreur',
      bgColor: 'bg-red-600',
      textColor: 'text-red-200'
    },
    testing: {
      icon: '⟳',
      label: 'Test...',
      bgColor: 'bg-yellow-600',
      textColor: 'text-yellow-200'
    }
  };

  return (
    statusMap[status || 'disconnected'] || statusMap['disconnected']
  );
};

const getMethodColor = (method?: string): string => {
  const colors: { [key: string]: string } = {
    GET: 'bg-blue-600 text-blue-200',
    POST: 'bg-green-600 text-green-200',
    PUT: 'bg-orange-600 text-orange-200',
    DELETE: 'bg-red-600 text-red-200',
    PATCH: 'bg-purple-600 text-purple-200',
    HEAD: 'bg-cyan-600 text-cyan-200'
  };
  return colors[method || 'GET'] || colors['GET'];
};

export const ConnectionListItem: React.FC<ConnectionListItemProps> = ({
  item,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  onAddToWorkflow,
  onOpen,
  type
}) => {
  const { t } = useLocalization();
  const statusInfo = getStatusIndicator(item.status);

  return (
    <div
      onClick={onSelect}
      className={`
        p-4 rounded-lg cursor-pointer transition-all border
        ${
          isSelected
            ? 'bg-green-600/20 border-green-500 text-white ring-1 ring-green-500/50'
            : 'bg-gray-800/50 border-gray-700 text-gray-300 hover:bg-gray-800/80 hover:border-gray-600'
        }
      `}
    >
      {/* Header: Name + Action Buttons */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm truncate flex-1">{item.name}</h3>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="p-1.5 rounded hover:bg-gray-700 transition-colors text-gray-400 hover:text-gray-200"
            title="Modifier"
          >
            <EditIcon className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1.5 rounded hover:bg-red-900/30 transition-colors text-gray-400 hover:text-red-400"
            title="Supprimer"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content: Type-specific info */}
      {type === 'api' && item.method && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${getMethodColor(item.method)}`}>
              {item.method}
            </span>
            <span className="text-xs text-gray-400 font-medium">
              {item.format ? `• ${item.format}` : ''}
            </span>
          </div>
          <p className="text-xs text-gray-500 truncate line-clamp-2 break-all">{item.url}</p>
        </div>
      )}

      {type === 'database' && item.provider && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 font-medium">{item.provider}</p>
          <p className="text-xs text-gray-500 truncate">{item.host}</p>
        </div>
      )}

      {/* Status & Date */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-700">
        <div className="flex items-center gap-1">
          <span className={`inline-flex items-center justify-center w-3 h-3 rounded-full ${statusInfo.bgColor}`}>
            {statusInfo.icon === '✓' && <CheckCircleIcon className="w-2 h-2" />}
            {statusInfo.icon === '✗' && <AlertCircleIcon className="w-2 h-2" />}
            {statusInfo.icon === '⚠' && <AlertCircleIcon className="w-2 h-2" />}
            {statusInfo.icon === '⟳' && (
              <span className="text-xs animate-spin">⟳</span>
            )}
          </span>
          <span className={`text-xs font-medium ${statusInfo.textColor}`}>
            {statusInfo.label}
          </span>
        </div>
        {item.lastTestDate && (
          <span className="text-xs text-gray-600 flex items-center gap-1">
            <ClockIcon className="w-3 h-3" />
            {new Date(item.lastTestDate).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Footer: Action Buttons */}
      <div className="mt-3 flex flex-col gap-2">
        {type === 'database' && onOpen && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="w-full py-1.5 text-xs font-semibold rounded bg-green-600/50 hover:bg-green-600/70 text-white transition-all"
          >
            Ouvrir
          </button>
        )}
        {onAddToWorkflow && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddToWorkflow();
            }}
            className="w-full py-1.5 text-xs font-semibold rounded bg-green-600/30 hover:bg-green-600/50 text-green-300 transition-all"
          >
            ➕ Ajouter au workflow
          </button>
        )}
      </div>
    </div>
  );
};

export default ConnectionListItem;
