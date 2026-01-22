import React, { useState } from 'react';
import { useLocalization } from '../hooks/useLocalization';
import { useNotifications } from '../contexts/NotificationContext';
import { PlusIcon, CloseIcon, LoaderIcon } from './Icons';

// ============== TYPES ==============

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
type AuthType = 'none' | 'basic' | 'bearer' | 'header';
type BodyType = 'json' | 'formData' | 'raw';
type ResponseView = 'json' | 'table' | 'schema';

interface KeyValuePair {
  id: string;
  key: string;
  value: string;
}

interface ApiRequest {
  method: HttpMethod;
  url: string;
  authType: AuthType;
  basicUsername?: string;
  basicPassword?: string;
  bearerToken?: string;
  headerAuthKey?: string;
  headerAuthValue?: string;
  queryParams: KeyValuePair[];
  headers: KeyValuePair[];
  bodyType: BodyType;
  bodyContent: string;
}

interface ApiResponse {
  status: number;
  statusText: string;
  time: number; // ms
  size: string; // KB
  data: any;
}

// ============== MOCK DATA ==============

const MOCK_RESPONSE_DATA = [
  {
    id: 101,
    user: 'Agent_Smith',
    roles: ['admin', 'system'],
    metadata: { created_at: '2024-01-01', ip: '192.168.1.1' },
    active: true
  },
  {
    id: 102,
    user: 'Neo_User',
    roles: ['user'],
    metadata: { created_at: '2024-01-02', ip: '10.0.0.42' },
    active: false
  }
];

// ============== SUB-COMPONENTS ==============

const MethodDropdown: React.FC<{
  value: HttpMethod;
  onChange: (method: HttpMethod) => void;
}> = ({ value, onChange }) => {
  const methodColors: { [key in HttpMethod]: { bg: string; text: string } } = {
    GET: { bg: 'from-blue-700 to-blue-600', text: 'text-blue-200' },
    POST: { bg: 'from-green-700 to-green-600', text: 'text-green-200' },
    PUT: { bg: 'from-orange-700 to-orange-600', text: 'text-orange-200' },
    DELETE: { bg: 'from-red-700 to-red-600', text: 'text-red-200' },
    PATCH: { bg: 'from-purple-700 to-purple-600', text: 'text-purple-200' },
    HEAD: { bg: 'from-cyan-700 to-cyan-600', text: 'text-cyan-200' }
  };

  const color = methodColors[value];

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as HttpMethod)}
      className={`
        px-4 py-2 rounded-lg font-bold text-sm transition-all
        bg-gradient-to-r ${color.bg} ${color.text}
        border-2 border-${value === 'GET' ? 'blue' : value === 'POST' ? 'green' : value === 'PUT' ? 'orange' : value === 'DELETE' ? 'red' : value === 'PATCH' ? 'purple' : 'cyan'}-500/50
        cursor-pointer hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan-400/50
      `}
    >
      {['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].map(method => (
        <option key={method} value={method}>{method}</option>
      ))}
    </select>
  );
};

const KeyValueList: React.FC<{
  items: KeyValuePair[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, field: 'key' | 'value', value: string) => void;
  label?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}> = ({
  items,
  onAdd,
  onRemove,
  onChange,
  label = 'Paramètres',
  keyPlaceholder = 'Clé',
  valuePlaceholder = 'Valeur'
}) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <label className="text-sm font-semibold text-gray-300">{label}</label>
      <button
        onClick={onAdd}
        className="p-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 transition-all"
      >
        <PlusIcon className="w-4 h-4" />
      </button>
    </div>

    <div className="space-y-2 max-h-48 overflow-y-auto">
      {items.length === 0 ? (
        <p className="text-xs text-gray-500 italic">Aucun élément. Cliquez sur + pour en ajouter.</p>
      ) : (
        items.map(item => (
          <div key={item.id} className="flex gap-2">
            <input
              type="text"
              placeholder={keyPlaceholder}
              value={item.key}
              onChange={(e) => onChange(item.id, 'key', e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 text-xs transition-all focus:outline-none focus:border-cyan-500"
            />
            <input
              type="text"
              placeholder={valuePlaceholder}
              value={item.value}
              onChange={(e) => onChange(item.id, 'value', e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 text-xs transition-all focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={() => onRemove(item.id)}
              className="p-2 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 transition-all"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        ))
      )}
    </div>
  </div>
);

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`
      px-4 py-2 text-sm font-semibold transition-all relative
      ${active
        ? 'text-cyan-400 border-b-2 border-cyan-500'
        : 'text-gray-400 border-b-2 border-transparent hover:text-gray-300'
      }
    `}
  >
    {children}
  </button>
);

const JsonTreeView: React.FC<{ data: any; maxDepth?: number; currentDepth?: number }> = ({
  data,
  maxDepth = 5,
  currentDepth = 0
}) => {
  const [expanded, setExpanded] = useState<{ [key: string]: boolean }>({});

  const toggleExpand = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderValue = (value: any, key: string, depth: number) => {
    if (value === null) return <span className="text-gray-500">null</span>;
    if (typeof value === 'boolean') return <span className="text-orange-400">{String(value)}</span>;
    if (typeof value === 'number') return <span className="text-green-400">{value}</span>;
    if (typeof value === 'string') return <span className="text-cyan-300">"{value}"</span>;
    if (Array.isArray(value)) {
      const isExpandable = value.length > 0 && depth < maxDepth;
      return (
        <div>
          <button
            onClick={() => toggleExpand(key)}
            className="text-cyan-400 hover:text-cyan-300 font-bold"
          >
            {isExpandable ? (expanded[key] ? '▼' : '▶') : ''}
            {` Array[${value.length}]`}
          </button>
          {isExpandable && expanded[key] && (
            <div className="ml-4 mt-1 space-y-1">
              {value.map((item, idx) => (
                <div key={idx} className="text-gray-400">
                  <span>[{idx}]</span>
                  {renderValue(item, `${key}_${idx}`, depth + 1)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    if (typeof value === 'object') {
      const isExpandable = Object.keys(value).length > 0 && depth < maxDepth;
      return (
        <div>
          <button
            onClick={() => toggleExpand(key)}
            className="text-cyan-400 hover:text-cyan-300 font-bold"
          >
            {isExpandable ? (expanded[key] ? '▼' : '▶') : ''}
            {` Object`}
          </button>
          {isExpandable && expanded[key] && (
            <div className="ml-4 mt-1 space-y-1">
              {Object.entries(value).map(([k, v]) => (
                <div key={k} className="text-gray-400">
                  <span className="text-purple-400">{k}:</span>
                  {renderValue(v, k, depth + 1)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    return <span className="text-gray-400">{String(value)}</span>;
  };

  if (Array.isArray(data)) {
    return (
      <div className="space-y-2">
        {data.map((item, idx) => (
          <div key={idx} className="pl-2 border-l-2 border-cyan-500/30">
            {renderValue(item, `root_${idx}`, 0)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="text-sm">
          <span className="text-purple-400">{key}:</span>
          {renderValue(value, key, 0)}
        </div>
      ))}
    </div>
  );
};

const TableView: React.FC<{ data: any }> = ({ data }) => {
  if (!Array.isArray(data) || data.length === 0) {
    return <p className="text-gray-400 text-sm">Aucune donnée à afficher en tableau</p>;
  }

  const columns = Object.keys(data[0]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-800/50">
            {columns.map(col => (
              <th key={col} className="px-4 py-2 text-left font-semibold text-cyan-400">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={idx} className="border-b border-gray-700/50 hover:bg-gray-800/30 transition-colors">
              {columns.map(col => (
                <td key={`${idx}-${col}`} className="px-4 py-2 text-gray-300 text-xs">
                  {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const SchemaView: React.FC<{ data: any }> = ({ data }) => {
  const getSchema = (obj: any, depth = 0): string => {
    if (depth > 5) return 'Mixed';
    if (obj === null) return 'null';
    if (Array.isArray(obj)) {
      const itemType = obj.length > 0 ? getSchema(obj[0], depth + 1) : 'Unknown';
      return `Array<${itemType}>`;
    }
    if (typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length === 0) return 'Object';
      const entries = keys.slice(0, 3).map(k => `${k}: ${getSchema(obj[k], depth + 1)}`);
      const suffix = keys.length > 3 ? `, ... (${keys.length - 3} more)` : '';
      return `{ ${entries.join(', ')}${suffix} }`;
    }
    return typeof obj;
  };

  const renderSchema = (obj: any, depth = 0): React.ReactNode => {
    const indent = depth * 20;
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      return (
        <div>
          <span className="text-cyan-400">{'{'}</span>
          <div className="ml-4 space-y-1">
            {Object.entries(obj).map(([key, value]) => (
              <div key={key} style={{ marginLeft: `${indent}px` }} className="text-gray-300 text-sm">
                <span className="text-purple-400">{key}</span>
                <span className="text-gray-500">: </span>
                <span className="text-green-400">
                  {Array.isArray(value) ? `Array<${typeof value[0]}>` : typeof value}
                </span>
              </div>
            ))}
          </div>
          <span className="text-cyan-400">{'}'}</span>
        </div>
      );
    }
    return <span className="text-gray-400">{getSchema(obj, depth)}</span>;
  };

  return (
    <div className="text-sm font-mono space-y-2">
      <pre className="text-cyan-400">Root Schema:</pre>
      {Array.isArray(data) && data.length > 0 ? (
        <div>
          <span className="text-cyan-400">Array&lt;</span>
          {renderSchema(data[0], 1)}
          <span className="text-cyan-400">&gt;</span>
        </div>
      ) : (
        renderSchema(data, 0)
      )}
    </div>
  );
};

// ============== MAIN COMPONENT ==============

export const ComApiPage: React.FC = () => {
  const { t } = useLocalization();
  const { addNotification } = useNotifications();

  const [request, setRequest] = useState<ApiRequest>({
    method: 'GET',
    url: 'https://api.example.com/v1/users',
    authType: 'none',
    queryParams: [],
    headers: [{ id: '1', key: 'Content-Type', value: 'application/json' }],
    bodyType: 'json',
    bodyContent: '{}'
  });

  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'params' | 'headers' | 'body'>('params');
  const [responseView, setResponseView] = useState<ResponseView>('json');

  // ---- Handlers ----

  const handleExecuteRequest = async () => {
    if (!request.url.trim()) {
      addNotification({
        type: 'error',
        title: '❌ Erreur',
        message: 'Veuillez entrer une URL valide',
        duration: 3000
      });
      return;
    }

    setIsLoading(true);
    // Simulation de 1s
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsLoading(false);

    const mockResponse: ApiResponse = {
      status: 200,
      statusText: 'OK',
      time: 245,
      size: '1.2',
      data: MOCK_RESPONSE_DATA
    };

    setResponse(mockResponse);
    addNotification({
      type: 'success',
      title: '✅ Réponse reçue',
      message: `${mockResponse.status} ${mockResponse.statusText} - ${mockResponse.time}ms`,
      duration: 3000
    });
  };

  const addKeyValuePair = (type: 'params' | 'headers') => {
    const newPair: KeyValuePair = {
      id: Date.now().toString(),
      key: '',
      value: ''
    };

    if (type === 'params') {
      setRequest(prev => ({
        ...prev,
        queryParams: [...prev.queryParams, newPair]
      }));
    } else {
      setRequest(prev => ({
        ...prev,
        headers: [...prev.headers, newPair]
      }));
    }
  };

  const removeKeyValuePair = (type: 'params' | 'headers', id: string) => {
    if (type === 'params') {
      setRequest(prev => ({
        ...prev,
        queryParams: prev.queryParams.filter(p => p.id !== id)
      }));
    } else {
      setRequest(prev => ({
        ...prev,
        headers: prev.headers.filter(h => h.id !== id)
      }));
    }
  };

  const updateKeyValuePair = (
    type: 'params' | 'headers',
    id: string,
    field: 'key' | 'value',
    value: string
  ) => {
    if (type === 'params') {
      setRequest(prev => ({
        ...prev,
        queryParams: prev.queryParams.map(p =>
          p.id === id ? { ...p, [field]: value } : p
        )
      }));
    } else {
      setRequest(prev => ({
        ...prev,
        headers: prev.headers.map(h =>
          h.id === id ? { ...h, [field]: value } : h
        )
      }));
    }
  };

  return (
    <div className="h-full w-full bg-slate-900 text-white overflow-hidden flex flex-col">
      {/* Fixed Background Grid */}
      <div className="fixed inset-0 opacity-10 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(0deg,transparent_24%,rgba(120,119,198,.05)_25%,rgba(120,119,198,.05)_26%,transparent_27%,transparent_74%,rgba(120,119,198,.05)_75%,rgba(120,119,198,.05)_76%,transparent_77%,transparent),linear-gradient(90deg,transparent_24%,rgba(120,119,198,.05)_25%,rgba(120,119,198,.05)_26%,transparent_27%,transparent_74%,rgba(120,119,198,.05)_75%,rgba(120,119,198,.05)_76%,transparent_77%,transparent)] bg-[50px_50px]" />
      </div>

      {/* Header */}
      <div className="relative z-10 p-6 border-b border-gray-700 bg-gray-800/30">
        <div className="flex items-center space-x-2 mb-4 text-sm text-gray-400">
          <span>COM</span>
          <span>•</span>
          <span className="text-cyan-500">Connexions API</span>
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
          Configuration Requête HTTP
        </h1>
      </div>

      {/* Content - Split View */}
      <div className="relative z-0 flex-1 overflow-hidden flex">
        {/* Left Panel - Request Configuration */}
        <div className="w-1/2 border-r border-gray-700 overflow-y-auto p-6 space-y-6">
          {/* Method & URL */}
          <div className="space-y-4">
            <div className="flex gap-3">
              <MethodDropdown
                value={request.method}
                onChange={(method) => setRequest(prev => ({ ...prev, method }))}
              />
              <input
                type="text"
                placeholder="https://api.example.com/v1/resource"
                value={request.url}
                onChange={(e) => setRequest(prev => ({ ...prev, url: e.target.value }))}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 text-sm transition-all focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Authentication */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-gray-300">🔐 Authentification</label>
            <select
              value={request.authType}
              onChange={(e) => setRequest(prev => ({ ...prev, authType: e.target.value as AuthType }))}
              className="w-full px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 text-sm transition-all focus:outline-none focus:border-cyan-500"
            >
              <option value="none">Aucune</option>
              <option value="basic">Basic Auth</option>
              <option value="bearer">Bearer Token</option>
              <option value="header">Header Auth</option>
            </select>

            {request.authType === 'basic' && (
              <div className="space-y-2 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                <input
                  type="text"
                  placeholder="Nom d'utilisateur"
                  value={request.basicUsername || ''}
                  onChange={(e) => setRequest(prev => ({ ...prev, basicUsername: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 text-sm transition-all focus:outline-none focus:border-cyan-500"
                />
                <input
                  type="password"
                  placeholder="Mot de passe"
                  value={request.basicPassword || ''}
                  onChange={(e) => setRequest(prev => ({ ...prev, basicPassword: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 text-sm transition-all focus:outline-none focus:border-cyan-500"
                />
              </div>
            )}

            {request.authType === 'bearer' && (
              <input
                type="text"
                placeholder="Token Bearer"
                value={request.bearerToken || ''}
                onChange={(e) => setRequest(prev => ({ ...prev, bearerToken: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 text-sm transition-all focus:outline-none focus:border-cyan-500"
              />
            )}

            {request.authType === 'header' && (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Clé (ex: X-API-Key)"
                  value={request.headerAuthKey || ''}
                  onChange={(e) => setRequest(prev => ({ ...prev, headerAuthKey: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 text-sm transition-all focus:outline-none focus:border-cyan-500"
                />
                <input
                  type="text"
                  placeholder="Valeur"
                  value={request.headerAuthValue || ''}
                  onChange={(e) => setRequest(prev => ({ ...prev, headerAuthValue: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 text-sm transition-all focus:outline-none focus:border-cyan-500"
                />
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-700">
            <div className="flex space-x-4">
              <TabButton
                active={activeTab === 'params'}
                onClick={() => setActiveTab('params')}
              >
                📋 Paramètres
              </TabButton>
              <TabButton
                active={activeTab === 'headers'}
                onClick={() => setActiveTab('headers')}
              >
                📝 En-têtes
              </TabButton>
              <TabButton
                active={activeTab === 'body'}
                onClick={() => setActiveTab('body')}
              >
                💾 Corps
              </TabButton>
            </div>
          </div>

          {/* Tab Content */}
          <div>
            {activeTab === 'params' && (
              <KeyValueList
                items={request.queryParams}
                onAdd={() => addKeyValuePair('params')}
                onRemove={(id) => removeKeyValuePair('params', id)}
                onChange={(id, field, value) => updateKeyValuePair('params', id, field, value)}
                label="Paramètres Query (URL)"
                keyPlaceholder="Paramètre"
                valuePlaceholder="Valeur"
              />
            )}

            {activeTab === 'headers' && (
              <KeyValueList
                items={request.headers}
                onAdd={() => addKeyValuePair('headers')}
                onRemove={(id) => removeKeyValuePair('headers', id)}
                onChange={(id, field, value) => updateKeyValuePair('headers', id, field, value)}
                label="En-têtes HTTP"
                keyPlaceholder="Clé (ex: Content-Type)"
                valuePlaceholder="Valeur"
              />
            )}

            {activeTab === 'body' && (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-semibold text-gray-300 block mb-2">Type de corps</label>
                  <select
                    value={request.bodyType}
                    onChange={(e) => setRequest(prev => ({ ...prev, bodyType: e.target.value as BodyType }))}
                    className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 text-sm transition-all focus:outline-none focus:border-cyan-500"
                  >
                    <option value="json">JSON</option>
                    <option value="formData">Form Data</option>
                    <option value="raw">Raw</option>
                  </select>
                </div>

                <textarea
                  placeholder='{"key": "value"}'
                  value={request.bodyContent}
                  onChange={(e) => setRequest(prev => ({ ...prev, bodyContent: e.target.value }))}
                  className="w-full h-40 px-4 py-3 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 text-sm font-mono transition-all focus:outline-none focus:border-cyan-500 resize-none"
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Response */}
        <div className="w-1/2 overflow-y-auto p-6 space-y-6 bg-gray-800/20">
          {/* Status Bar */}
          <div className="space-y-4">
            {response ? (
              <div className="p-4 rounded-lg border border-green-600/50 bg-green-900/20">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-xs text-gray-400">Status</p>
                    <p className="text-lg font-bold text-green-400">
                      {response.status} {response.statusText}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Temps</p>
                    <p className="text-lg font-bold text-blue-400">{response.time}ms</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Taille</p>
                    <p className="text-lg font-bold text-purple-400">{response.size}KB</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50">
                <p className="text-sm text-gray-400">Aucune réponse. Cliquez sur Exécuter pour envoyer la requête.</p>
              </div>
            )}

            {/* Execute Button */}
            <button
              onClick={handleExecuteRequest}
              disabled={isLoading}
              className={`
                w-full px-6 py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2
                ${isLoading
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-green-600 to-green-500 text-white hover:from-green-500 hover:to-green-400 shadow-lg shadow-green-500/50'
                }
              `}
            >
              {isLoading ? (
                <>
                  <LoaderIcon className="w-5 h-5 animate-spin" />
                  <span>Exécution...</span>
                </>
              ) : (
                <>
                  <span>▶</span>
                  <span>Exécuter la requête</span>
                </>
              )}
            </button>
          </div>

          {/* Response View Selector */}
          {response && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setResponseView('json')}
                  className={`
                    flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all
                    ${responseView === 'json'
                      ? 'bg-cyan-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }
                  `}
                >
                  📄 JSON
                </button>
                <button
                  onClick={() => setResponseView('table')}
                  className={`
                    flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all
                    ${responseView === 'table'
                      ? 'bg-cyan-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }
                  `}
                >
                  📊 Tableau
                </button>
                <button
                  onClick={() => setResponseView('schema')}
                  className={`
                    flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all
                    ${responseView === 'schema'
                      ? 'bg-cyan-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }
                  `}
                >
                  🗂️ Schéma
                </button>
              </div>

              {/* Response Content */}
              <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 font-mono text-xs overflow-x-auto max-h-96 overflow-y-auto">
                {responseView === 'json' && (
                  <JsonTreeView data={response.data} />
                )}
                {responseView === 'table' && (
                  <TableView data={response.data} />
                )}
                {responseView === 'schema' && (
                  <SchemaView data={response.data} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ComApiPage;
