import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { RobotId } from '../../types';

export interface NodeHandle {
  id: string;
  type: 'source' | 'target';
  dataType: 'string' | 'object' | 'array' | 'any';
  label: string;
  required?: boolean;
  position: Position;
}

export interface BaseWorkflowNodeData {
  label: string;
  robotId: RobotId;
  config: Record<string, unknown>;
  status: 'idle' | 'running' | 'success' | 'error' | 'warning';
  handles: {
    inputs: NodeHandle[];
    outputs: NodeHandle[];
  };
  description?: string;
}

interface BaseWorkflowNodeProps extends NodeProps {
  data: BaseWorkflowNodeData;
}

export const getRobotColor = (robotId: RobotId): { primary: string; secondary: string; accent: string } => {
  switch (robotId) {
    case RobotId.Archi:
      return { primary: '#06b6d4', secondary: '#0891b2', accent: '#67e8f9' }; // Cyan
    case RobotId.Com:
      return { primary: '#f97316', secondary: '#ea580c', accent: '#fed7aa' }; // Orange
    case RobotId.Phil:
      return { primary: '#10b981', secondary: '#059669', accent: '#6ee7b7' }; // Emerald
    case RobotId.Tim:
      return { primary: '#f59e0b', secondary: '#d97706', accent: '#fde68a' }; // Amber
    case RobotId.Bos:
      return { primary: '#8b5cf6', secondary: '#7c3aed', accent: '#c4b5fd' }; // Violet
    default:
      return { primary: '#6b7280', secondary: '#4b5563', accent: '#d1d5db' }; // Gray
  }
};

const getStatusStyles = (status: BaseWorkflowNodeData['status'], _colors: { primary: string; secondary: string; accent: string }) => {
  const baseStyles = `border-2 transition-all duration-300 backdrop-blur-sm`;

  switch (status) {
    case 'running':
      return `${baseStyles} border-blue-400 bg-gradient-to-br from-blue-500/20 to-blue-600/10 shadow-lg shadow-blue-400/30 animate-pulse`;
    case 'success':
      return `${baseStyles} border-green-400 bg-gradient-to-br from-green-500/20 to-green-600/10 shadow-lg shadow-green-400/30`;
    case 'error':
      return `${baseStyles} border-red-400 bg-gradient-to-br from-red-500/20 to-red-600/10 shadow-lg shadow-red-400/30`;
    case 'warning':
      return `${baseStyles} border-yellow-400 bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 shadow-lg shadow-yellow-400/30`;
    default: // idle
      return `${baseStyles} bg-gradient-to-br from-gray-800/90 to-gray-900/80 shadow-lg shadow-black/20`;
  }
};

const getStatusIcon = (status: BaseWorkflowNodeData['status']) => {
  switch (status) {
    case 'running':
      return <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse"></div>;
    case 'success':
      return <div className="w-3 h-3 bg-green-400 rounded-full"></div>;
    case 'error':
      return <div className="w-3 h-3 bg-red-400 rounded-full"></div>;
    case 'warning':
      return <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>;
    default:
      return <div className="w-3 h-3 bg-gray-400 rounded-full"></div>;
  }
};

export const BaseWorkflowNode: React.FC<BaseWorkflowNodeProps> = memo(({ data, selected }) => {
  const colors = getRobotColor(data.robotId);
  const statusStyles = getStatusStyles(data.status, colors);

  return (
    <div
      className={`
        min-w-[240px] rounded-lg p-4 text-white font-sans
        ${statusStyles}
        ${selected ? `ring-2 ring-${colors.accent} ring-opacity-50` : ''}
      `}
      style={{
        borderColor: selected ? colors.accent : colors.primary,
        background: selected ? `linear-gradient(135deg, ${colors.primary}20, ${colors.secondary}10)` : undefined,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ backgroundColor: colors.primary, color: '#000' }}
          >
            {data.robotId.charAt(0).toUpperCase()}
          </div>
          <span className="font-semibold text-sm text-gray-100">{data.robotId}</span>
        </div>
        {getStatusIcon(data.status)}
      </div>

      {/* Title */}
      <h3 className="text-white font-semibold mb-2 text-lg leading-tight">{data.label}</h3>

      {/* Description */}
      {data.description && <p className="text-gray-300 text-sm mb-3 leading-relaxed">{data.description}</p>}

      {/* Config Preview */}
      {Object.keys(data.config).length > 0 && (
        <div className="text-xs text-gray-400 mb-2">
          <span className="opacity-75">Config: </span>
          <span className="text-gray-300">{Object.keys(data.config).length} parameter(s)</span>
        </div>
      )}

      {/* Input Handles */}
      {data.handles.inputs.map((handle, index) => (
        <Handle
          key={`input-${handle.id}`}
          type="target"
          position={handle.position}
          id={handle.id}
          className="w-3 h-3 border-2 border-white bg-gray-700 hover:bg-gray-600 transition-colors"
          style={{
            top: `${30 + index * 25}px`,
            borderColor: colors.primary,
          }}
        />
      ))}

      {/* Output Handles */}
      {data.handles.outputs.map((handle, index) => (
        <Handle
          key={`output-${handle.id}`}
          type="source"
          position={handle.position}
          id={handle.id}
          className="w-3 h-3 border-2 border-white bg-gray-700 hover:bg-gray-600 transition-colors"
          style={{
            top: `${30 + index * 25}px`,
            borderColor: colors.primary,
          }}
        />
      ))}

      {/* Status Text */}
      <div className="text-xs text-gray-400 mt-2 capitalize">
        Status: <span style={{ color: colors.accent }}>{data.status}</span>
      </div>
    </div>
  );
});
