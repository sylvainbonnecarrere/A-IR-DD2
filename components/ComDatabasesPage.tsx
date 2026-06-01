import React, { useState } from 'react';
import { useNotifications } from '../contexts/NotificationContext';
import { useLocalization } from '../hooks/useLocalization';
import { CheckCircleIcon, ChevronDownIcon, LoaderIcon, DatabaseIcon, XIcon, PlusIcon } from './Icons';
import ConnectionListItem, { IConnectionItem } from './com/ConnectionListItem';
import DatabaseExplorer from './com/DatabaseExplorer';
import { ProvisionalSurfaceNotice } from './ProvisionalSurfaceNotice';

// ============== TYPES & CONSTANTS ==============

interface DatabaseFormData {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
}

interface DatabaseProvider {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  glowColor: string;
  defaultPort: number;
  description: string;
}

interface DatabaseNode extends IConnectionItem {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  host: string;
  status: 'connected' | 'disconnected' | 'testing';
  createdAt: string;
}

const DATABASE_PROVIDERS: DatabaseProvider[] = [
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    icon: '🐘',
    color: 'from-blue-600 to-blue-500',
    glowColor: 'cyan-500',
    defaultPort: 5432,
    description: 'Base de données relationnelle open-source'
  },
  {
    id: 'mysql',
    name: 'MySQL',
    icon: '🐬',
    color: 'from-orange-600 to-orange-500',
    glowColor: 'orange-500',
    defaultPort: 3306,
    description: 'SGBD relationnel populaire'
  },
  {
    id: 'mongodb',
    name: 'MongoDB',
    icon: '🍃',
    color: 'from-green-600 to-green-500',
    glowColor: 'green-500',
    defaultPort: 27017,
    description: 'Base de données NoSQL orientée documents'
  },
  {
    id: 'oracle',
    name: 'Oracle',
    icon: '📊',
    color: 'from-red-600 to-red-500',
    glowColor: 'red-500',
    defaultPort: 1521,
    description: 'SGBD relationnelle entreprise'
  },
  {
    id: 'mssql',
    name: 'SQL Server',
    icon: '🔷',
    color: 'from-slate-600 to-slate-500',
    glowColor: 'blue-500',
    defaultPort: 1433,
    description: 'Base de données Microsoft'
  },
  {
    id: 'redis',
    name: 'Redis',
    icon: '⚡',
    color: 'from-red-700 to-red-600',
    glowColor: 'red-500',
    defaultPort: 6379,
    description: 'Cache et stockage en mémoire'
  },
  {
    id: 'elasticsearch',
    name: 'ElasticSearch',
    icon: '🔍',
    color: 'from-yellow-600 to-yellow-500',
    glowColor: 'yellow-500',
    defaultPort: 9200,
    description: 'Moteur de recherche et analytique'
  },
  {
    id: 'cassandra',
    name: 'Cassandra',
    icon: '🗄️',
    color: 'from-indigo-600 to-indigo-500',
    glowColor: 'indigo-500',
    defaultPort: 9042,
    description: 'Base NoSQL distribuée'
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    icon: '📁',
    color: 'from-cyan-600 to-cyan-500',
    glowColor: 'cyan-500',
    defaultPort: 0,
    description: 'Base de données fichier embarquée'
  },
  {
    id: 'mariadb',
    name: 'MariaDB',
    icon: '🌸',
    color: 'from-pink-600 to-pink-500',
    glowColor: 'pink-500',
    defaultPort: 3306,
    description: 'Fork open-source de MySQL'
  }
];

// ============== SUB-COMPONENTS ==============

interface DatabaseCardProps {
  provider: DatabaseProvider;
  isSelected: boolean;
  onClick: () => void;
}

const DatabaseCard: React.FC<DatabaseCardProps> = ({ provider, isSelected, onClick }) => {
  const borderMap: { [key: string]: string } = {
    'green-500': 'border-green-500',
    'orange-500': 'border-orange-500',
    'red-500': 'border-red-500',
    'blue-500': 'border-blue-500',
    'yellow-500': 'border-yellow-500',
    'indigo-500': 'border-indigo-500',
    'pink-500': 'border-pink-500'
  };

  const shadowMap: { [key: string]: string } = {
    'green-500': 'shadow-green-500/50',
    'orange-500': 'shadow-orange-500/50',
    'red-500': 'shadow-red-500/50',
    'blue-500': 'shadow-blue-500/50',
    'yellow-500': 'shadow-yellow-500/50',
    'indigo-500': 'shadow-indigo-500/50',
    'pink-500': 'shadow-pink-500/50'
  };

  return (
    <div
      onClick={onClick}
      className={`
        relative p-3 rounded-lg cursor-pointer transition-all duration-300
        transform hover:scale-110 active:scale-95 aspect-square flex flex-col items-center justify-center
        ${isSelected
          ? `bg-gradient-to-br ${provider.color} ${borderMap[provider.glowColor] || 'border-green-500'} border-2 shadow-lg ${shadowMap[provider.glowColor] || 'shadow-green-500/50'}`
          : 'bg-gray-800 border-2 border-gray-700 opacity-60 hover:opacity-80'
        }
      `}
    >
      <div className={`text-3xl mb-1 transition-transform duration-300 ${isSelected ? 'scale-125' : 'scale-100'}`}>
        {provider.icon}
      </div>
      <h3 className="font-semibold text-white text-xs text-center">{provider.name}</h3>
      
      {isSelected && (
        <div className="absolute top-1 right-1">
          <CheckCircleIcon className="w-4 h-4 text-white drop-shadow-lg" />
        </div>
      )}
    </div>
  );
};

interface FormFieldProps {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}

const FormField: React.FC<FormFieldProps> = ({
  label,
  name,
  type = 'text',
  placeholder,
  error,
  value,
  onChange,
  required = false
}) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-gray-300 mb-2">
      {label} {required && <span className="text-green-500">*</span>}
    </label>
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`
        w-full px-4 py-2 rounded-lg bg-gray-700 border
        text-white placeholder-gray-500 transition-all
        ${error ? 'border-red-500 focus:border-red-500' : 'border-gray-600 focus:border-green-500'}
        focus:outline-none focus:ring-2
        ${error ? 'focus:ring-red-500/30' : 'focus:ring-green-500/30'}
      `}
    />
    {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
  </div>
);

const AdvancedOptions: React.FC = () => {
  const { t } = useLocalization();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-6 border-t border-gray-700 pt-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full p-4 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors"
      >
        <span className="font-semibold text-gray-200">{t('com_advanced_settings')}</span>
        <div className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
          <ChevronDownIcon className="w-5 h-5 text-gray-400" />
        </div>
      </button>

      {isOpen && (
        <div className="mt-4 p-4 bg-gray-800/50 rounded-lg space-y-4 animate-in fade-in duration-200">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              label={t('com_db_adv_min_connections')}
              name="poolMinSize"
              type="number"
              placeholder="5"
              value="5"
              onChange={() => {}}
            />
            <FormField
              label={t('com_db_adv_max_connections')}
              name="poolMaxSize"
              type="number"
              placeholder="20"
              value="20"
              onChange={() => {}}
            />
            <FormField
              label={t('com_db_adv_connect_timeout')}
              name="connectTimeout"
              type="number"
              placeholder="5000"
              value="5000"
              onChange={() => {}}
            />
            <FormField
              label={t('com_db_adv_query_timeout')}
              name="queryTimeout"
              type="number"
              placeholder="30000"
              value="30000"
              onChange={() => {}}
            />
          </div>

          <div className="border-t border-gray-700 pt-4">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-green-500" />
              <span className="text-sm text-gray-300">{t('com_db_adv_ssh_tunneling')}</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

// ============== MAIN COMPONENT ==============

export const ComDatabasesPage: React.FC = () => {
  const { t } = useLocalization();
  const { addNotification } = useNotifications();

  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [workflowNodeName, setWorkflowNodeName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState<DatabaseFormData>({
    name: '',
    host: '',
    port: 0,
    username: '',
    password: ''
  });

  // ============== NEW STATE: DATABASE NODES LIST ==============
  const [databaseNodes, setDatabaseNodes] = useState<DatabaseNode[]>([
    {
      id: '1',
      name: 'Prod Users DB',
      provider: 'postgresql',
      providerName: 'PostgreSQL',
      host: 'prod-postgres.example.com',
      status: 'connected',
      createdAt: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: '2',
      name: 'Cache Redis',
      provider: 'redis',
      providerName: 'Redis',
      host: 'redis.example.com:6379',
      status: 'connected',
      createdAt: new Date(Date.now() - 3600000).toISOString()
    },
    {
      id: '3',
      name: 'Analytics DB',
      provider: 'elasticsearch',
      providerName: 'ElasticSearch',
      host: 'elastic.example.com',
      status: 'disconnected',
      createdAt: new Date(Date.now() - 172800000).toISOString()
    }
  ]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectedProviderData = DATABASE_PROVIDERS.find(p => p.id === selectedProvider);

  // ============== HANDLERS ==============

  const handleProviderChange = (providerId: string) => {
    setSelectedProvider(providerId);
    const provider = DATABASE_PROVIDERS.find(p => p.id === providerId);
    setFormData({
      name: '',
      host: '',
      port: provider?.defaultPort || 0,
      username: '',
      password: ''
    });
  };

  const handleFormChange = (key: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [key]: key === 'port' ? parseInt(value) || 0 : value
    }));
  };

  const onTestConnection = async () => {
    setIsTesting(true);
    await new Promise(resolve => setTimeout(resolve, 2000));
    setIsTesting(false);
    addNotification({
      type: 'success',
      title: '✅ Succès',
      message: `Connexion établie • Ping: ${Math.floor(Math.random() * 100) + 10}ms`,
      duration: 4000
    });
  };

  const onSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedProvider) {
      addNotification({
        type: 'error',
        title: '❌ Erreur',
        message: 'Veuillez sélectionner un type de base de données',
        duration: 3000
      });
      return;
    }

    if (!formData.name) {
      addNotification({
        type: 'error',
        title: '❌ Erreur',
        message: 'Le nom de la connexion est requis',
        duration: 3000
      });
      return;
    }

    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsSaving(false);

    if (editingNodeId) {
      // Update existing connection
      setDatabaseNodes(databaseNodes.map(n =>
        n.id === editingNodeId
          ? { ...n, name: formData.name, host: formData.host }
          : n
      ));
      addNotification({
        type: 'success',
        title: '✏️ Mise à jour',
        message: `Connexion "${formData.name}" mise à jour avec succès`,
        duration: 3000
      });
    } else {
      // Create new connection
      const newNode: DatabaseNode = {
        id: Date.now().toString(),
        name: formData.name,
        provider: selectedProvider,
        providerName: selectedProviderData?.name || 'Unknown',
        host: formData.host,
        status: 'disconnected',
        createdAt: new Date().toISOString()
      };
      setDatabaseNodes([...databaseNodes, newNode]);
      addNotification({
        type: 'success',
        title: '💾 Sauvegardé',
        message: `Connexion "${formData.name}" créée avec succès`,
        duration: 3000
      });
    }
    
    setFormData({
      name: '',
      host: '',
      port: 0,
      username: '',
      password: ''
    });
    setSelectedProvider(null);
    setEditingNodeId(null);
    setShowCreateForm(false);
  };

  const onAddToWorkflow = async () => {
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

  const handleDeleteNode = (id: string) => {
    setDatabaseNodes(databaseNodes.filter(n => n.id !== id));
    if (selectedNodeId === id) {
      setSelectedNodeId(null);
    }
    addNotification({
      type: 'success',
      title: '🗑️ Base supprimée',
      message: 'La base de données a été supprimée avec succès',
      duration: 3000
    });
  };

  const handleEditNode = (id: string) => {
    const nodeToEdit = databaseNodes.find(n => n.id === id);
    if (!nodeToEdit) return;

    // Reset explorer view and set edit mode
    setSelectedNodeId(null);
    setEditingNodeId(id);
    setSelectedProvider(nodeToEdit.provider);
    setFormData({
      name: nodeToEdit.name,
      host: nodeToEdit.host,
      port: 5432,
      username: 'user',
      password: 'pass'
    });
    setShowCreateForm(true);
  };

  const handleOpenExplorer = (id: string) => {
    setShowCreateForm(false);
    setSelectedProvider(null);
    setSelectedNodeId(id);
  };

  // ============== RENDER ==============

  return (
    <div className="h-full w-full bg-slate-900 text-white overflow-y-auto flex flex-col">
      {/* Animated Background Grid */}
      <div className="fixed inset-0 opacity-10 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(0deg,transparent_24%,rgba(120,119,198,.05)_25%,rgba(120,119,198,.05)_26%,transparent_27%,transparent_74%,rgba(120,119,198,.05)_75%,rgba(120,119,198,.05)_76%,transparent_77%,transparent),linear-gradient(90deg,transparent_24%,rgba(120,119,198,.05)_25%,rgba(120,119,198,.05)_26%,transparent_27%,transparent_74%,rgba(120,119,198,.05)_75%,rgba(120,119,198,.05)_76%,transparent_77%,transparent)] bg-[50px_50px]" />
      </div>

      <div className="relative z-0 flex flex-col h-full">
        {/* Header - Harmonized with ARCHI style */}
        <div className="flex-shrink-0 p-4 border-b border-gray-700 bg-gray-800/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 text-green-400">
                <DatabaseIcon />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">{t('com_databases_title')}</h1>
                <p className="text-gray-400 text-sm">{t('com_db_subtitle')}</p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => {
                  setSelectedNodeId(null);
                  setShowCreateForm(true);
                }}
                className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-500 hover:to-emerald-500 transition-all shadow-lg shadow-green-500/50"
              >
                <PlusIcon className="w-4 h-4" />
                <span>{t('com_db_button_add')}</span>
              </button>

              {/* Governance Indicator - COM Green */}
              <div className="bg-green-500/20 border border-green-500/30 rounded-lg px-3 py-1.5 whitespace-nowrap">
                <div className="text-xs text-green-300 font-medium">{t('current_robot_label')}</div>
                <div className="text-sm text-green-100 font-bold">COM</div>
              </div>
            </div>
          </div>
        </div>

        {/* Content - Two Column Layout */}
        <div className="flex-1 overflow-hidden flex">
        {/* Left Column - Database Nodes List */}
        <div className="w-72 border-r border-gray-700 bg-gray-800/20 overflow-y-auto p-4 flex flex-col">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-200 mb-3">{t('com_databases_your_bases')}</h2>
            {databaseNodes.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 text-sm">{t('com_no_database_created')}</p>
                <p className="text-gray-600 text-xs mt-1">{t('com_create_new_connection')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {databaseNodes.map((node) => (
                  <ConnectionListItem
                    key={node.id}
                    item={{
                      id: node.id,
                      name: node.name,
                      provider: node.providerName,
                      host: node.host,
                      status: node.status
                    }}
                    isSelected={selectedNodeId === node.id}
                    onSelect={() => handleOpenExplorer(node.id)}
                    onEdit={() => handleEditNode(node.id)}
                    onDelete={() => handleDeleteNode(node.id)}
                    onOpen={() => handleOpenExplorer(node.id)}
                    onAddToWorkflow={() => {
                      setWorkflowNodeName(node.name);
                      setShowWorkflowModal(true);
                    }}
                    type="database"
                  />
                ))}
              </div>
            )}
          </div>
        </div>

          {/* Right Column - Provider Selection & Explorer */}
          <div className="flex-1 overflow-y-auto p-8 flex flex-col">
            <div className="mb-6">
              <ProvisionalSurfaceNotice
                description={t(
                  'com_databases_provisional_notice',
                  'Cette surface COM reste en mode atelier local. Les bases affichees, les tests de connexion et l exploration restent pilotes par des donnees provisoires ou de demonstration.'
                )}
              />
            </div>
            <style>{`
              div::-webkit-scrollbar {
                width: 8px;
              }
              div::-webkit-scrollbar-track {
                background: rgba(31, 41, 55, 0.5);
              }
              div::-webkit-scrollbar-thumb {
                background: rgba(75, 85, 99, 0.7);
                border-radius: 4px;
              }
              div::-webkit-scrollbar-thumb:hover {
                background: rgba(107, 114, 128, 0.9);
              }
            `}</style>
            {showCreateForm ? (
              // Provider Selection + Creation Form - Full Page Layout
              <div className="flex flex-col h-full space-y-6">
                <div className="flex items-center justify-between flex-shrink-0">
                  <h2 className="text-xl font-bold text-white">
                    {editingNodeId
                      ? `${t('com_db_form_edit_title')} ${formData.name}`
                      : t('com_db_form_new_title')
                    }
                  </h2>
                  <button
                    onClick={() => {
                      setShowCreateForm(false);
                      setSelectedProvider(null);
                      setEditingNodeId(null);
                      setFormData({
                        name: '',
                        host: '',
                        port: 0,
                        username: '',
                        password: ''
                      });
                    }}
                    className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200"
                  >
                    <XIcon className="w-5 h-5" />
                  </button>
                </div>

                {/* Provider Grid - Always Visible - Single Row with Horizontal Scroll */}
                <div className="flex-shrink-0 space-y-2">
                  <p className="text-gray-400 text-sm font-medium">{t('com_db_form_select_provider')}</p>
                  <div className="flex gap-2 overflow-x-auto pb-2 scroll-smooth" style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#4b5563 #1f2937'
                  }}>
                    <style>{`
                      .provider-grid::-webkit-scrollbar {
                        height: 6px;
                      }
                      .provider-grid::-webkit-scrollbar-track {
                        background: #1f2937;
                        border-radius: 3px;
                      }
                      .provider-grid::-webkit-scrollbar-thumb {
                        background: #4b5563;
                        border-radius: 3px;
                      }
                      .provider-grid::-webkit-scrollbar-thumb:hover {
                        background: #6b7280;
                      }
                    `}</style>
                    <div className="flex gap-2 min-w-max provider-grid">
                      {DATABASE_PROVIDERS.map(provider => (
                        <div key={provider.id} className="flex-shrink-0 w-24 h-24">
                          <DatabaseCard
                            provider={provider}
                            isSelected={selectedProvider === provider.id}
                            onClick={() => handleProviderChange(provider.id)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Connection Form - Shows Below Grid After Selection */}
                {selectedProvider && (
                  <div className="flex-1 overflow-y-auto border-t border-gray-700 pt-6">
                    <form onSubmit={onSaveConnection} className="space-y-4 max-w-2xl">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <label className="text-sm font-semibold text-gray-300">
                            {t('com_db_form_selected_provider')} <span className="text-green-400">{selectedProviderData?.name}</span>
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedProvider(null)}
                          className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-all"
                        >
                          {t('com_db_form_change_provider')}
                        </button>
                      </div>

                      <FormField
                        label={t('com_db_form_name_label')}
                        name="name"
                        placeholder={t('com_db_form_name_placeholder')}
                        value={formData.name}
                        onChange={(val) => handleFormChange('name', val)}
                        required
                      />

                      <FormField
                        label={t('com_db_form_host_label')}
                        name="host"
                        placeholder={t('com_db_form_host_placeholder')}
                        value={formData.host}
                        onChange={(val) => handleFormChange('host', val)}
                        required
                      />

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          label={t('com_db_form_port_label')}
                          name="port"
                          type="number"
                          placeholder={String(selectedProviderData?.defaultPort)}
                          value={String(formData.port)}
                          onChange={(val) => handleFormChange('port', val)}
                        />
                        <FormField
                          label={t('com_db_form_database_label')}
                          name="database"
                          placeholder={t('com_db_form_database_placeholder')}
                          value=""
                          onChange={() => {}}
                        />
                      </div>

                      <FormField
                        label={t('com_db_form_username_label')}
                        name="username"
                        placeholder={t('com_db_form_username_placeholder')}
                        value={formData.username}
                        onChange={(val) => handleFormChange('username', val)}
                      />

                      <FormField
                        label={t('com_db_form_password_label')}
                        name="password"
                        type="password"
                        placeholder={t('com_db_form_password_placeholder')}
                        value={formData.password}
                        onChange={(val) => handleFormChange('password', val)}
                      />

                      <AdvancedOptions />

                      <div className="flex gap-2 mt-6 pt-4 border-t border-gray-700">
                        <button
                          type="button"
                          onClick={() => {
                            setShowCreateForm(false);
                            setSelectedProvider(null);
                            setEditingNodeId(null);
                            setFormData({
                              name: '',
                              host: '',
                              port: 0,
                              username: '',
                              password: ''
                            });
                          }}
                          className="flex-1 px-4 py-2 rounded-lg bg-gray-700 text-gray-300 font-semibold hover:bg-gray-600 transition-all"
                        >
                          {t('cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={onTestConnection}
                          disabled={isTesting}
                          className={`flex-1 px-4 py-2 rounded-lg font-semibold transition-all ${
                            isTesting
                              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                              : 'bg-blue-600 text-white hover:bg-blue-500'
                          }`}
                        >
                          {isTesting ? t('com_db_button_test_loading') : t('com_db_button_test')}
                        </button>
                        <button
                          type="submit"
                          disabled={isSaving}
                          className={`flex-1 px-4 py-2 rounded-lg font-semibold transition-all ${
                            isSaving
                              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                              : 'bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-500 hover:to-emerald-500 shadow-lg shadow-green-500/50'
                          }`}
                        >
                          {isSaving
                            ? editingNodeId
                              ? t('com_db_button_update_loading')
                              : t('com_db_button_save_loading')
                            : editingNodeId
                            ? t('com_db_button_update')
                            : t('com_db_button_save')
                          }
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            ) : selectedNodeId ? (
              // Explorer View
              (() => {
                const node = databaseNodes.find(n => n.id === selectedNodeId);
                return node ? (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold text-white">{t('com_database_explorer')}</h2>
                      <button
                        onClick={() => setSelectedNodeId(null)}
                        className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200"
                      >
                        <XIcon className="w-5 h-5" />
                      </button>
                    </div>
                    <DatabaseExplorer
                      databaseName={node.name}
                      provider={node.providerName}
                      host={node.host}
                      status={node.status}
                      onRefresh={() => {
                        // Stub
                      }}
                    />
                  </div>
                ) : null;
              })()
            ) : (
              // Empty State
              <div className="text-center py-16 fade-in flex flex-col items-center justify-center">
                <div className="text-6xl mb-4">🗄️</div>
                <p className="text-gray-400 text-lg">
                  {t('com_select_database_explore')}
                </p>
              </div>
            )}
          </div>
        {/* End of Right Column */}
      </div>
      {/* End of Two Column Layout */}
      </div>
    </div>
  );
};

export default ComDatabasesPage;
