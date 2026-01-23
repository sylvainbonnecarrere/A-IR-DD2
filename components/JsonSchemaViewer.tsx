import React, { useMemo } from 'react';

interface JsonSchemaViewerProps {
  data: any;
}

const inferType = (value: any): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Array';
    const elementType = inferType(value[0]);
    return `Array<${elementType}>`;
  }
  if (typeof value === 'object') return 'Object';
  if (typeof value === 'boolean') return 'Boolean';
  if (typeof value === 'number') return value % 1 === 0 ? 'Integer' : 'Float';
  if (typeof value === 'string') return 'String';
  return 'Unknown';
};

const SchemaField: React.FC<{ name: string; type: string; level: number }> = ({ name, type, level }) => {
  const paddingLeft = `${level * 16}px`;
  return (
    <div style={{ paddingLeft }} className="flex items-center justify-between py-2 text-sm border-b border-gray-700/30">
      <span className="text-gray-300 font-mono">{name}</span>
      <span className="text-green-400 font-semibold text-xs">{type}</span>
    </div>
  );
};

const SchemaObject: React.FC<{ data: Record<string, any>; level: number }> = ({ data, level }) => {
  return (
    <>
      {Object.entries(data).map(([key, value]) => {
        const type = inferType(value);
        return (
          <div key={key}>
            <SchemaField name={key} type={type} level={level} />
            {typeof value === 'object' && value !== null && !Array.isArray(value) && (
              <SchemaObject data={value} level={level + 1} />
            )}
          </div>
        );
      })}
    </>
  );
};

export const JsonSchemaViewer: React.FC<JsonSchemaViewerProps> = ({ data }) => {
  const schema = useMemo(() => {
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      return parsed;
    } catch (error) {
      return null;
    }
  }, [data]);

  if (!schema) {
    return (
      <div className="text-red-400 text-sm p-4">
        ❌ Erreur: JSON invalide
      </div>
    );
  }

  if (typeof schema !== 'object' || schema === null) {
    return (
      <div className="bg-gray-800/50 rounded p-4 text-sm">
        <SchemaField name="root" type={inferType(schema)} level={0} />
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 rounded p-4 max-h-96 overflow-y-auto">
      <div className="text-xs text-gray-500 mb-4">📋 Structure des types:</div>
      {Array.isArray(schema) ? (
        <SchemaField name="root" type={inferType(schema)} level={0} />
      ) : (
        <SchemaObject data={schema} level={0} />
      )}
    </div>
  );
};

export default JsonSchemaViewer;
