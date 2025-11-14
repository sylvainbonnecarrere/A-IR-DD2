import React, { useState } from 'react';
import { ConnectionPrototype, LLMConfig, RobotId } from '../types';
import { useDesignStore } from '../stores/useDesignStore';
import { Button, Card } from './UI';
import { PlusIcon, AntennaIcon, SettingsIcon, CloseIcon } from './Icons';
import { useNotifications } from '../contexts/NotificationContext';
import { useLocalization } from '../hooks/useLocalization';

interface ComConnectionsPageProps {
  llmConfigs: LLMConfig[];
  onNavigateToWorkflow?: () => void;
}

// Mock store for connections - à remplacer par un vrai store plus tard
const useConnectionsStore = () => {
  const [connections, setConnections] = useState<ConnectionPrototype[]>([]);

  const addConnection = (connection: Omit<ConnectionPrototype, 'id' | 'creator_id' | 'created_at' | 'updated_at'>) => {
    const newConnection: ConnectionPrototype = {
      ...connection,
      id: `conn-${Date.now()}`,
      creator_id: RobotId.Com,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    setConnections(prev => [...prev, newConnection]);
    return { success: true, connectionId: newConnection.id };
  };

  const deleteConnection = (id: string) => {
    setConnections(prev => prev.filter(c => c.id !== id));
    return { success: true };
  };

  return { connections, addConnection, deleteConnection };
};

export const ComConnectionsPage: React.FC<ComConnectionsPageProps> = ({
  llmConfigs,
  onNavigateToWorkflow
}) => {
  const { t } = useLocalization();
  const { addNotification } = useNotifications();
  const { connections, addConnection, deleteConnection } = useConnectionsStore();
  const { currentRobotId } = useDesignStore();

  const [isCreating, setIsCreating] = useState(false);
  const [newConnection, setNewConnection] = useState({
    name: '',
    type: 'api' as const,
    endpoint: '',
    authType: 'bearer' as const
  });

  const handleCreateConnection = () => {
    if (!newConnection.name.trim() || !newConnection.endpoint.trim()) {
      addNotification({
        type: 'error',
        title: t('validation_error'),
        message: t('com_name_endpoint_required'),
        duration: 3000
      });
      return;
    }

    const result = addConnection({
      name: newConnection.name,
      type: newConnection.type,
      endpoint: newConnection.endpoint,
      authentication: {
        type: newConnection.authType,
        credentials: {}
      },
      configuration: {}
    });

    if (result.success) {
      addNotification({
        type: 'success',
        title: t('com_connection_created'),
        message: t('com_connection_created_success', { name: newConnection.name }),
        duration: 3000
      });
      setNewConnection({ name: '', type: 'api', endpoint: '', authType: 'bearer' });
      setIsCreating(false);
    }
  };

  const handleDeleteConnection = (id: string, name: string) => {
    const result = deleteConnection(id);
    if (result.success) {
      addNotification({
        type: 'success',
        title: t('com_connection_deleted'),
        message: t('com_connection_deleted_success', { name }),
        duration: 3000
      });
    }
  };

  const getAuthTypeColor = (type: string) => {
    switch (type) {
      case 'bearer': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case 'api_key': return 'bg-green-500/20 text-green-300 border-green-500/30';
      case 'oauth': return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case 'basic': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
      default: return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
    }
  };

  const getConnectionTypeIcon = (type: string) => {
    switch (type) {
      case 'api': return '🔌';
      case 'webhook': return '🪝';
      case 'database': return '🗄️';
      case 'external_service': return '🌐';
      default: return '🔗';
    }
  };

  return (
    <div className="h-full bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <AntennaIcon className="w-6 h-6 text-blue-400" />
            <div>
              <h1 className="text-xl font-bold text-white">{t('com_connections_api')}</h1>
              <p className="text-gray-400 text-sm">{t('com_connections_api_desc')}</p>
            </div>
          </div>

          {/* Robot Indicator */}
          <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg px-3 py-1.5">
            <div className="text-xs text-blue-300 font-medium">{t('current_robot')}</div>
            <div className="text-sm text-blue-100 font-bold">{currentRobotId}</div>
            <div className="text-xs text-blue-400">{t('com_connection_specialist')}</div>
          </div>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="p-6 border-b border-gray-700/50">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-400">
            {t('com_connections_count', { count: connections.length })}
          </div>
          <div className="flex space-x-3">
            {onNavigateToWorkflow && (
              <Button
                onClick={onNavigateToWorkflow}
                className="flex items-center space-x-2"
                variant="secondary"
              >
                <span>🗺️</span>
                <span>{t('view_workflows')}</span>
              </Button>
            )}
            <Button
              onClick={() => setIsCreating(true)}
              className="flex items-center space-x-2"
              variant="primary"
            >
              <PlusIcon className="w-4 h-4" />
              <span>{t('com_new_connection')}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6 space-y-6">

        {/* Create New Connection */}
        {isCreating && (
          <Card className="p-6 border border-blue-500/30 bg-blue-500/5">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center space-x-2">
              <PlusIcon className="w-5 h-5" />
              <span>{t('com_new_connection')}</span>
            </h3>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('name')}</label>
                <input
                  type="text"
                  value={newConnection.name}
                  onChange={(e) => setNewConnection({ ...newConnection, name: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder={t('com_connection_name_placeholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('type')}</label>
                <select
                  value={newConnection.type}
                  onChange={(e) => setNewConnection({ ...newConnection, type: e.target.value as any })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="api">{t('com_api_rest')}</option>
                  <option value="webhook">{t('com_webhook')}</option>
                  <option value="database">{t('com_database')}</option>
                  <option value="external_service">{t('com_external_service')}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('com_endpoint')}</label>
                <input
                  type="url"
                  value={newConnection.endpoint}
                  onChange={(e) => setNewConnection({ ...newConnection, endpoint: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder={t('com_endpoint_placeholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('com_authentication')}</label>
                <select
                  value={newConnection.authType}
                  onChange={(e) => setNewConnection({ ...newConnection, authType: e.target.value as any })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="bearer">{t('com_bearer_token')}</option>
                  <option value="api_key">{t('com_api_key')}</option>
                  <option value="oauth">{t('com_oauth')}</option>
                  <option value="basic">{t('com_basic_auth')}</option>
                  <option value="none">{t('com_no_auth')}</option>
                </select>
              </div>
            </div>            <div className="flex justify-end space-x-3">
              <Button variant="secondary" onClick={() => setIsCreating(false)}>
                {t('cancel')}
              </Button>
              <Button onClick={handleCreateConnection} className="bg-blue-600 hover:bg-blue-700">
                {t('com_create_connection')}
              </Button>
            </div>
          </Card>
        )}

        {/* Connections List */}
        {connections.length === 0 && !isCreating ? (
          <Card className="p-8 text-center text-gray-400">
            <AntennaIcon className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <h3 className="text-lg font-medium text-gray-300 mb-2">{t('com_no_connection_configured')}</h3>
            <p className="mb-4">{t('com_create_first_api_connection')}</p>
            <Button
              onClick={() => setIsCreating(true)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <PlusIcon className="w-4 h-4 mr-2" />
              {t('com_first_connection')}
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {connections.map((connection) => (
              <Card key={connection.id} className="p-4 border-l-4 border-blue-500 hover:bg-gray-800/50 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <span className="text-2xl">{getConnectionTypeIcon(connection.type)}</span>
                    <div>
                      <h3 className="font-medium text-white">{connection.name}</h3>
                      <p className="text-xs text-gray-400 capitalize">{connection.type}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteConnection(connection.id, connection.name)}
                    className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                    title={t('delete')}
                  >
                    <CloseIcon className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-gray-400">{t('com_endpoint')}:</span>
                    <p className="text-gray-300 truncate font-mono text-xs">{connection.endpoint}</p>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">{t('com_auth')}:</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium border ${getAuthTypeColor(connection.authentication.type)}`}>
                      {t(`com_${connection.authentication.type}_auth`) || t(`com_${connection.authentication.type}`)}
                    </span>
                  </div>

                  <div className="text-xs text-gray-500 pt-2 border-t border-gray-700">
                    {t('created_on', { date: new Date(connection.created_at).toLocaleDateString() })}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};