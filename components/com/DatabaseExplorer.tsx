import React, { useState } from 'react';
import { ChevronRightIcon, RefreshCcwIcon, PlayIcon } from '../Icons';
import { useLocalization } from '../../hooks/useLocalization';

interface DatabaseExplorerProps {
  databaseName: string;
  provider: string;
  host: string;
  status: 'connected' | 'disconnected' | 'testing';
  tables?: string[];
  isLoading?: boolean;
  onExecuteQuery?: (query: string) => void;
  onRefresh?: () => void;
}

export const DatabaseExplorer: React.FC<DatabaseExplorerProps> = ({
  databaseName,
  provider,
  host,
  status,
  tables = [
    'users',
    'orders',
    'products',
    'transactions',
    'analytics'
  ],
  isLoading = false,
  onExecuteQuery,
  onRefresh
}) => {
  const { t } = useLocalization();
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [queryMode, setQueryMode] = useState<'sql' | 'json'>('sql');
  const [query, setQuery] = useState('SELECT * FROM users LIMIT 10;');
  const [queryResult, setQueryResult] = useState<any[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);

  const handleExecuteQuery = async () => {
    setIsExecuting(true);
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Mock results
    setQueryResult([
      { id: 1, name: 'Alice', email: 'alice@example.com', created_at: '2024-01-01' },
      { id: 2, name: 'Bob', email: 'bob@example.com', created_at: '2024-01-02' },
      { id: 3, name: 'Charlie', email: 'charlie@example.com', created_at: '2024-01-03' }
    ]);

    setIsExecuting(false);
    onExecuteQuery?.(query);
  };

  const isConnected = status === 'connected';

  return (
    <div className="h-full flex flex-col space-y-4">
      {/* Header Info */}
      <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white">{databaseName}</h3>
            <p className="text-xs text-gray-400">{provider} • {host}</p>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                isConnected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-xs font-medium text-gray-300">
              {isConnected ? 'Connecté' : 'Indisponible'}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onRefresh}
            disabled={!isConnected || isLoading}
            className="flex-1 px-3 py-1.5 text-xs font-medium rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 transition-colors flex items-center justify-center gap-1"
          >
            <RefreshCcwIcon className="w-3 h-3" />
            Actualiser
          </button>
        </div>
      </div>

      {/* Split View: Tables | Query Editor & Results */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Left: Table List */}
        <div className="w-48 flex flex-col">
          <h4 className="text-xs font-semibold text-gray-300 mb-2 uppercase">📋 Tables</h4>
          <div className="flex-1 overflow-y-auto space-y-1 bg-gray-800/30 rounded-lg border border-gray-700 p-2">
            {tables.map(table => (
              <button
                key={table}
                onClick={() => setSelectedTable(table)}
                className={`
                  w-full text-left px-3 py-2 text-xs rounded transition-colors
                  ${
                    selectedTable === table
                      ? 'bg-green-600/20 text-green-300 border-l-2 border-green-500'
                      : 'text-gray-400 hover:bg-gray-700 hover:text-gray-300'
                  }
                `}
              >
                <ChevronRightIcon className="w-3 h-3 inline-block mr-1" />
                {table}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Query Editor & Results */}
        <div className="flex-1 flex flex-col space-y-4 min-w-0">
          {/* Query Editor */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-gray-300 uppercase">✏️ Requête</h4>
              <div className="flex gap-1">
                <button
                  onClick={() => setQueryMode('sql')}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    queryMode === 'sql'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  SQL
                </button>
                <button
                  onClick={() => setQueryMode('json')}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    queryMode === 'json'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  JSON
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={!isConnected}
                placeholder={
                  queryMode === 'sql'
                    ? 'SELECT * FROM users WHERE id = 1;'
                    : '{"collection": "users", "query": {}}'
                }
                className="flex-1 px-3 py-2 text-xs rounded bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-green-500 font-mono disabled:opacity-50"
                rows={4}
              />
              <button
                onClick={handleExecuteQuery}
                disabled={!isConnected || isExecuting || !query.trim()}
                className="px-4 py-2 rounded bg-gradient-to-r from-green-600 to-emerald-600 text-white font-semibold hover:from-green-500 hover:to-emerald-500 transition-all shadow-lg shadow-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center justify-center"
              >
                <PlayIcon className="w-4 h-4 mb-1" />
                <span className="text-xs">Exécuter</span>
              </button>
            </div>
          </div>

          {/* Results Table */}
          {queryResult.length > 0 && (
            <div className="flex-1 flex flex-col min-h-0">
              <h4 className="text-xs font-semibold text-gray-300 mb-2 uppercase">
                📊 Résultats ({queryResult.length})
              </h4>
              <div className="flex-1 overflow-auto bg-gray-800/30 rounded-lg border border-gray-700 p-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-700 bg-gray-800 sticky top-0">
                      {queryResult[0] &&
                        Object.keys(queryResult[0]).map(col => (
                          <th key={col} className="px-2 py-2 text-left text-gray-300 font-semibold truncate">
                            {col}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResult.map((row, idx) => (
                      <tr key={idx} className="border-b border-gray-700/50 hover:bg-gray-800/50">
                        {Object.values(row).map((val, i) => (
                          <td key={i} className="px-2 py-1.5 text-gray-400 truncate max-w-xs">
                            {String(val)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {queryResult.length === 0 && !isExecuting && (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <div className="text-4xl mb-2 opacity-30">📊</div>
                <p className="text-gray-400 text-sm">Exécutez une requête pour voir les résultats</p>
              </div>
            </div>
          )}

          {isExecuting && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin text-2xl mb-2">⟳</div>
                <p className="text-gray-400 text-sm">Exécution de la requête...</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DatabaseExplorer;
