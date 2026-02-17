import React, { useMemo } from 'react';
import { useLocalization } from '../hooks/useLocalization';

interface JsonTableViewerProps {
  data: any;
}

export const JsonTableViewer: React.FC<JsonTableViewerProps> = ({ data }) => {
  const { t } = useLocalization();
  const { isArray, rows, columns } = useMemo(() => {
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;

      if (!Array.isArray(parsed)) {
        return { isArray: false, rows: [], columns: [] };
      }

      if (parsed.length === 0) {
        return { isArray: true, rows: [], columns: [] };
      }

      // Assume first element is object to infer columns
      const firstRow = parsed[0];
      if (typeof firstRow !== 'object' || firstRow === null) {
        return { isArray: true, rows: parsed.map((v, i) => ({ index: i, value: String(v) })), columns: [t('json_table_index'), t('json_table_value')] };
      }

      const cols = Object.keys(firstRow);
      const tableRows = parsed.map((row, idx) =>
        cols.reduce((acc, col) => ({ ...acc, [col]: row[col] }), {})
      );

      return { isArray: true, rows: tableRows, columns: cols };
    } catch (error) {
      return { isArray: false, rows: [], columns: [] };
    }
  }, [data]);

  if (!isArray) {
    return (
      <div className="text-gray-400 text-sm p-4 text-center">
        ⚠️ Ce n'est pas un tableau - c'est un objet unique ou une valeur scalaire
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-gray-400 text-sm p-4 text-center">
        📊 Tableau vide
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-gray-800/50 rounded p-4 max-h-96">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-700">
            {columns.map((col) => (
              <th key={col} className="text-left px-3 py-2 font-semibold text-green-400 text-xs whitespace-nowrap bg-gray-900/50">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-b border-gray-700/50 hover:bg-gray-700/30">
              {columns.map((col) => (
                <td key={`${idx}-${col}`} className="px-3 py-2 text-gray-300 text-xs break-all max-w-xs">
                  {typeof row[col] === 'object' ? JSON.stringify(row[col], null, 2) : String(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default JsonTableViewer;
