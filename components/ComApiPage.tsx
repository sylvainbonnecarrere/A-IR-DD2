import React, { useState } from 'react';
import { useLocalization } from '../hooks/useLocalization';
import { useNotifications } from '../contexts/NotificationContext';
import { PlusIcon, CloseIcon, LoaderIcon, ElectricPlugIcon, XIcon } from './Icons';
import JsonResultViewer from './JsonResultViewer';
import TabbedDataEditor from './TabbedDataEditor';
import ConnectionListItem, { IConnectionItem } from './com/ConnectionListItem';
import ResultViewer from './com/ResultViewer';
import ResultExtractor from './com/ResultExtractor';

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

interface ApiConnection extends IConnectionItem {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  format?: string;
  authType: AuthType;
  createdAt: string;
  status?: 'tested' | 'error' | 'disconnected';
  lastTestDate?: string;
}

interface ApiRequest {
  connectionName: string;
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
  time: number;
  size: string;
  data: any;
}

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
    <>
      <style>{`
        select option {
          background-color: #1f2937;
          color: #f3f4f6;
          padding: 8px;
        }
        select option:checked {
          background: linear-gradient(#10b981, #10b981);
          background-color: #10b981 !important;
          color: white !important;
        }
      `}</style>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as HttpMethod)}
        className={`px-4 py-2 rounded-lg font-bold text-sm transition-all bg-gradient-to-r ${color.bg} ${color.text} border-2 border-${value === 'GET' ? 'blue' : value === 'POST' ? 'green' : value === 'PUT' ? 'orange' : value === 'DELETE' ? 'red' : value === 'PATCH' ? 'purple' : 'green'}-500/50 cursor-pointer hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-green-400/50`}
      >
        {['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].map(method => (
          <option key={method} value={method}>{method}</option>
        ))}
      </select>
    </>
  );
};

const KeyValueList: React.FC<{
  items: KeyValuePair[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, field: 'key' | 'value', value: string) => void;
  label: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}> = ({ items, onAdd, onRemove, onChange, label, keyPlaceholder, valuePlaceholder }) => {
  const { t } = useLocalization();
  const finalKeyPlaceholder = keyPlaceholder || t('com_api_key_placeholder');
  const finalValuePlaceholder = valuePlaceholder || t('com_api_value_placeholder');
  
  return (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <label className="text-sm font-semibold text-gray-300">{label}</label>
      <button
        type="button"
        onClick={onAdd}
        className="text-xs px-2 py-1 bg-green-600/50 hover:bg-green-600 text-green-200 rounded transition-all"
      >
        + Ajouter
      </button>
    </div>

    <div className="space-y-2 max-h-40 overflow-y-auto">
      {items.length === 0 ? (
        <p className="text-xs text-gray-500 italic">Aucun élément</p>
      ) : (
        items.map(item => (
          <div key={item.id} className="flex gap-2 flex-wrap">
            <input
              type="text"
              placeholder={finalKeyPlaceholder}
              value={item.key}
              onChange={(e) => onChange(item.id, 'key', e.target.value)}
              className="flex-1 min-w-[80px] px-3 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-green-500"
            />
            <input
              type="text"
              placeholder={finalValuePlaceholder}
              value={item.value}
              onChange={(e) => onChange(item.id, 'value', e.target.value)}
              className="flex-1 min-w-[80px] px-3 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-green-500"
            />
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="p-1 text-gray-400 hover:text-red-400 transition-colors"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        ))
      )}
    </div>
  </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`
      px-3 py-2 text-sm font-medium rounded-t-lg transition-all
      ${active 
        ? 'bg-green-600 text-white border-b-2 border-green-400' 
        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      }
    `}
  >
    {children}
  </button>
);

// Connection List Component
interface ConnectionListProps {
  connections: ApiConnection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddToWorkflow: (id: string) => void;
}

const ConnectionList: React.FC<ConnectionListProps> = ({
  connections,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onAddToWorkflow
}) => {
  const { t } = useLocalization();

  if (connections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-12">
        <ElectricPlugIcon className="w-16 h-16 text-gray-600 mb-4 opacity-50" />
        <p className="text-gray-400 text-sm">{t('no_connections')}</p>
        <p className="text-gray-500 text-xs mt-1">{t('create_first_connection')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 overflow-y-auto">
      {connections.map((conn) => (
        <ConnectionListItem
          key={conn.id}
          item={{
            id: conn.id,
            name: conn.name,
            method: conn.method,
            url: conn.url,
            format: conn.format,
            status: conn.status || 'disconnected',
            lastTestDate: conn.lastTestDate
          }}
          isSelected={selectedId === conn.id}
          onSelect={() => onSelect(conn.id)}
          onEdit={() => onEdit(conn.id)}
          onDelete={() => onDelete(conn.id)}
          onAddToWorkflow={() => onAddToWorkflow(conn.id)}
          type="api"
        />
      ))}
    </div>
  );
};

// ============== MAIN COMPONENT ==============

export const ComApiPage: React.FC = () => {
  const { t } = useLocalization();
  const { addNotification } = useNotifications();

  // State: Connections list
  const [connections, setConnections] = useState<ApiConnection[]>([
    {
      id: '1',
      name: 'API Utilisateurs',
      method: 'GET',
      url: 'https://api.example.com/v1/users',
      format: 'JSON',
      authType: 'bearer',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      status: 'tested',
      lastTestDate: new Date(Date.now() - 3600000).toISOString()
    },
    {
      id: '2',
      name: 'Créer Commande',
      method: 'POST',
      url: 'https://api.example.com/v1/orders',
      format: 'JSON',
      authType: 'bearer',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      status: 'tested',
      lastTestDate: new Date(Date.now() - 1800000).toISOString()
    },
    {
      id: '3',
      name: 'Export CSV',
      method: 'GET',
      url: 'https://api.example.com/v1/export',
      format: 'CSV',
      authType: 'bearer',
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      status: 'error'
    }
  ]);

  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [workflowNodeName, setWorkflowNodeName] = useState('');

  // State: Form
  const [request, setRequest] = useState<ApiRequest>({
    connectionName: '',
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
  const [extractedResult, setExtractedResult] = useState<{ path: string; value: any } | null>(null);

  // ============== HANDLERS ==============

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
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsLoading(false);

    const mockResponse: ApiResponse = {
      status: 200,
      statusText: 'OK',
      time: 245,
      size: '1.2',
      data: [
        { id: 101, user: 'Agent_Smith', roles: ['admin', 'system'], metadata: { created_at: '2024-01-01', ip: '192.168.1.1' }, active: true },
        { id: 102, user: 'Neo_User', roles: ['user'], metadata: { created_at: '2024-01-02', ip: '10.0.0.42' }, active: false }
      ]
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
    const newPair: KeyValuePair = { id: Date.now().toString(), key: '', value: '' };
    if (type === 'params') {
      setRequest(prev => ({ ...prev, queryParams: [...prev.queryParams, newPair] }));
    } else {
      setRequest(prev => ({ ...prev, headers: [...prev.headers, newPair] }));
    }
  };

  const removeKeyValuePair = (type: 'params' | 'headers', id: string) => {
    if (type === 'params') {
      setRequest(prev => ({ ...prev, queryParams: prev.queryParams.filter(p => p.id !== id) }));
    } else {
      setRequest(prev => ({ ...prev, headers: prev.headers.filter(h => h.id !== id) }));
    }
  };

  const updateKeyValuePair = (type: 'params' | 'headers', id: string, field: 'key' | 'value', value: string) => {
    if (type === 'params') {
      setRequest(prev => ({
        ...prev,
        queryParams: prev.queryParams.map(p => p.id === id ? { ...p, [field]: value } : p)
      }));
    } else {
      setRequest(prev => ({
        ...prev,
        headers: prev.headers.map(h => h.id === id ? { ...h, [field]: value } : h)
      }));
    }
  };

  const handleSaveConnection = () => {
    if (!request.url.trim()) {
      addNotification({
        type: 'error',
        title: '❌ Erreur',
        message: 'L\'URL ne peut pas être vide',
        duration: 3000
      });
      return;
    }

    if (!request.connectionName.trim()) {
      addNotification({
        type: 'error',
        title: '❌ Erreur',
        message: 'Le nom de la connexion ne peut pas être vide',
        duration: 3000
      });
      return;
    }

    const newConnection: ApiConnection = {
      id: Date.now().toString(),
      name: request.connectionName,
      method: request.method,
      url: request.url,
      authType: request.authType,
      createdAt: new Date().toISOString()
    };

    setConnections([newConnection, ...connections]);
    setShowForm(false);
    setRequest({
      connectionName: '',
      method: 'GET',
      url: '',
      authType: 'none',
      queryParams: [],
      headers: [{ id: '1', key: 'Content-Type', value: 'application/json' }],
      bodyType: 'json',
      bodyContent: '{}'
    });

    addNotification({
      type: 'success',
      title: '✅ Connexion créée',
      message: 'Votre nouvelle connexion a été sauvegardée',
      duration: 3000
    });
  };

  const handleDeleteConnection = (id: string) => {
    setConnections(connections.filter(c => c.id !== id));
    if (selectedConnectionId === id) {
      setSelectedConnectionId(null);
    }
    addNotification({
      type: 'success',
      title: '🗑️ Connexion supprimée',
      message: 'La connexion a été supprimée avec succès',
      duration: 3000
    });
  };

  const handleEditConnection = (id: string) => {
    const conn = connections.find(c => c.id === id);
    if (conn) {
      setRequest({
        connectionName: conn.name,
        method: conn.method,
        url: conn.url,
        authType: conn.authType,
        queryParams: [],
        headers: [{ id: '1', key: 'Content-Type', value: 'application/json' }],
        bodyType: 'json',
        bodyContent: '{}'
      });
      setShowForm(true);
    }
  };

  const handleAddToWorkflow = (id: string) => {
    const conn = connections.find(c => c.id === id);
    if (conn) {
      setWorkflowNodeName(conn.name);
      setShowWorkflowModal(true);
    }
  };

  const handleConfirmWorkflow = async () => {
    if (!workflowNodeName.trim()) {
      addNotification({
        type: 'error',
        title: '❌ Erreur',
        message: 'Le nom du nœud ne peut pas être vide',
        duration: 3000
      });
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    addNotification({
      type: 'success',
      title: '✨ Nœud ajouté',
      message: `Nœud "${workflowNodeName}" ajouté au workflow (Simulation)`,
      duration: 3000
    });

    setShowWorkflowModal(false);
    setWorkflowNodeName('');
  };

  // ============== RENDER ==============

  return (
    <div className="h-full w-full bg-slate-900 text-white overflow-hidden flex flex-col">
      {/* Background Grid */}
      <div className="fixed inset-0 opacity-10 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(0deg,transparent_24%,rgba(120,119,198,.05)_25%,rgba(120,119,198,.05)_26%,transparent_27%,transparent_74%,rgba(120,119,198,.05)_75%,rgba(120,119,198,.05)_76%,transparent_77%,transparent),linear-gradient(90deg,transparent_24%,rgba(120,119,198,.05)_25%,rgba(120,119,198,.05)_26%,transparent_27%,transparent_74%,rgba(120,119,198,.05)_75%,rgba(120,119,198,.05)_76%,transparent_77%,transparent)] bg-[50px_50px]" />
      </div>

      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-700 bg-gray-800/30 relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <ElectricPlugIcon className="w-6 h-6 text-green-400" />
            <div>
              <h1 className="text-xl font-bold text-white">{t('api_connections_title')}</h1>
              <p className="text-gray-400 text-sm">{t('api_connections_description')}</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-500 hover:to-emerald-500 transition-all shadow-lg shadow-green-500/50"
            >
              <PlusIcon className="w-4 h-4" />
              <span>{t('create_api_connection')}</span>
            </button>

            <div className="bg-green-500/20 border border-green-500/30 rounded-lg px-3 py-1.5">
              <div className="text-xs text-green-300 font-medium">{t('current_robot_label')}</div>
              <div className="text-sm text-green-100 font-bold">COM</div>
            </div>
          </div>
        </div>
      </div>

      {/* Three Column Layout */}
      <div className="relative z-0 flex-1 overflow-hidden flex">
        {/* Column 1: Connections List (Left) */}
        <div className="w-72 border-r border-gray-700 bg-gray-800/20 overflow-y-auto p-4 flex flex-col">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-200 mb-3">📋 Vos Connexions</h2>
            <ConnectionList
              connections={connections}
              selectedId={selectedConnectionId}
              onSelect={setSelectedConnectionId}
              onEdit={handleEditConnection}
              onDelete={handleDeleteConnection}
              onAddToWorkflow={handleAddToWorkflow}
            />
          </div>
        </div>

        {/* Column 2: Form (Center) */}
        <div className="w-full max-w-2xl border-r border-gray-700 bg-gray-800/10 overflow-y-auto p-6 flex flex-col">
          {!showForm && !selectedConnectionId && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-6xl mb-4 opacity-30">⚙️</div>
              <p className="text-gray-400 text-base mb-2">Aucune sélection</p>
              <p className="text-gray-500 text-sm">Sélectionnez une connexion ou en créez une</p>
            </div>
          )}

          {showForm && (
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-white">🔗 Configuration</h2>
                <button
                  onClick={() => setShowForm(false)}
                  className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200"
                >
                  <XIcon className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">📝 Nom de la connexion <span className="text-green-400">*</span></label>
                  <input
                    type="text"
                    placeholder="ex: API Utilisateurs"
                    value={request.connectionName}
                    onChange={(e) => setRequest(prev => ({ ...prev, connectionName: e.target.value }))}
                    className="w-full px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 text-sm transition-all focus:outline-none focus:border-green-500"
                  />
                </div>

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
                    className="flex-1 px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 text-sm transition-all focus:outline-none focus:border-green-500"
                  />
                </div>

                {/* Authentication */}
                <div className="space-y-3">
                  <label className="text-sm font-semibold text-gray-300">🔐 Authentification</label>
                  <select
                    value={request.authType}
                    onChange={(e) => setRequest(prev => ({ ...prev, authType: e.target.value as AuthType }))}
                    className="w-full px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 text-sm transition-all focus:outline-none focus:border-green-500"
                  >
                    <option value="none">Aucune</option>
                    <option value="basic">Basic Auth</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="header">Header Auth</option>
                  </select>

                  {request.authType === 'bearer' && (
                    <input
                      type="password"
                      placeholder="Token Bearer"
                      value={request.bearerToken || ''}
                      onChange={(e) => setRequest(prev => ({ ...prev, bearerToken: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 text-sm transition-all focus:outline-none focus:border-green-500"
                    />
                  )}
                </div>

                {/* Tabs */}
                <div className="border-b border-gray-700">
                  <div className="flex space-x-2">
                    <TabButton active={activeTab === 'params'} onClick={() => setActiveTab('params')}>
                      📋 Paramètres
                    </TabButton>
                    <TabButton active={activeTab === 'headers'} onClick={() => setActiveTab('headers')}>
                      📝 En-têtes
                    </TabButton>
                    <TabButton active={activeTab === 'body'} onClick={() => setActiveTab('body')}>
                      💾 Corps
                    </TabButton>
                  </div>
                </div>

                {/* Tab Content */}
                <div className="min-h-32 max-h-48 overflow-y-auto">
                  {activeTab === 'params' && (
                    <KeyValueList
                      items={request.queryParams}
                      onAdd={() => addKeyValuePair('params')}
                      onRemove={(id) => removeKeyValuePair('params', id)}
                      onChange={(id, field, value) => updateKeyValuePair('params', id, field, value)}
                      label="Paramètres Query"
                    />
                  )}
                  {activeTab === 'headers' && (
                    <KeyValueList
                      items={request.headers}
                      onAdd={() => addKeyValuePair('headers')}
                      onRemove={(id) => removeKeyValuePair('headers', id)}
                      onChange={(id, field, value) => updateKeyValuePair('headers', id, field, value)}
                      label="En-têtes HTTP"
                    />
                  )}
                  {activeTab === 'body' && (
                    <TabbedDataEditor
                      value={request.bodyContent}
                      onChange={(value) => setRequest(prev => ({ ...prev, bodyContent: value }))}
                      placeholder='{"key": "value"}'
                    />
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 mt-6 pt-4 border-t border-gray-700">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2 rounded-lg bg-gray-700 text-gray-300 font-semibold hover:bg-gray-600 transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={handleExecuteRequest}
                  disabled={isLoading}
                  className={`flex-1 px-4 py-2 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
                    isLoading
                      ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-500'
                  }`}
                >
                  {isLoading ? <LoaderIcon className="w-4 h-4 animate-spin" /> : '▶'}
                  {isLoading ? t('test_loading') : t('com_api_button_test')}
                </button>
                <button
                  onClick={handleSaveConnection}
                  className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 text-white font-semibold hover:from-green-500 hover:to-emerald-500 transition-all shadow-lg shadow-green-500/50"
                >
                  💾 Sauvegarder
                </button>
              </div>
            </div>
          )}

          {selectedConnectionId && !showForm && (
            <div className="space-y-4">
              {(() => {
                const conn = connections.find(c => c.id === selectedConnectionId);
                return conn ? (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold text-white">📌 Détails</h2>
                      <button
                        onClick={() => setSelectedConnectionId(null)}
                        className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200"
                      >
                        <XIcon className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="space-y-3 bg-gray-800/50 p-4 rounded-lg">
                      <div>
                        <p className="text-xs text-gray-400 uppercase">Nom</p>
                        <p className="text-white font-semibold">{conn.name}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 uppercase">Méthode</p>
                        <p className={`font-bold text-sm inline-block px-2 py-1 rounded ${
                          conn.method === 'GET' ? 'bg-blue-600 text-blue-200' :
                          conn.method === 'POST' ? 'bg-green-600 text-green-200' :
                          'bg-gray-600 text-gray-200'
                        }`}>{conn.method}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 uppercase">URL</p>
                        <p className="text-gray-300 text-xs truncate break-all">{conn.url}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 uppercase">Format</p>
                        <p className="text-gray-300">{conn.format || 'JSON'}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleEditConnection(conn.id)}
                      className="w-full px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-500 transition-all"
                    >
                      ✏️ Modifier
                    </button>
                  </>
                ) : null;
              })()}
            </div>
          )}
        </div>

        {/* Column 3: Results (Right) */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col space-y-6">
          {response ? (
            <>
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-white">📊 Résultat</h2>
                <ResultViewer
                  data={response.data}
                  status={response.status}
                  statusText={response.statusText}
                  time={response.time}
                  size={response.size}
                  format="json"
                />
              </div>

              <div className="border-t border-gray-700 pt-6">
                <ResultExtractor
                  data={response.data}
                  onExtract={(path, value) => {
                    setExtractedResult({ path, value });
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-6xl mb-4 opacity-30">📊</div>
              <p className="text-gray-400 text-lg mb-2">Aucun résultat</p>
              <p className="text-gray-500 text-sm">Testez une requête pour voir la réponse</p>
            </div>
          )}
        </div>
      </div>

      {/* Workflow Modal */}
      {showWorkflowModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 w-96 shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-6">⚙️ Ajouter au Workflow</h2>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Nom du Nœud <span className="text-green-400">*</span>
              </label>
              <input
                type="text"
                placeholder="ex: Requête Utilisateurs"
                value={workflowNodeName}
                onChange={(e) => setWorkflowNodeName(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-500 transition-all focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowWorkflowModal(false);
                  setWorkflowNodeName('');
                }}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-700 text-gray-300 font-semibold hover:bg-gray-600 transition-all"
              >
                Annuler
              </button>
              <button
                onClick={handleConfirmWorkflow}
                className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 text-white font-semibold hover:from-green-500 hover:to-emerald-500 transition-all shadow-lg shadow-green-500/50"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ComApiPage;
