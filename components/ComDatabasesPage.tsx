import React, { useState } from 'react';
import { useNotifications } from '../contexts/NotificationContext';
import { useLocalization } from '../hooks/useLocalization';
import { CheckCircleIcon, ChevronDownIcon, LoaderIcon, DatabaseIcon } from './Icons';

// ============== TYPES & CONSTANTS ==============

interface DatabaseProvider {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  glowColor: string;
  defaultPort: number;
  description: string;
}

interface DatabaseFormData {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  [key: string]: any;
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
    'cyan-500': 'border-cyan-500',
    'orange-500': 'border-orange-500',
    'green-500': 'border-green-500',
    'red-500': 'border-red-500',
    'blue-500': 'border-blue-500',
    'yellow-500': 'border-yellow-500',
    'indigo-500': 'border-indigo-500',
    'pink-500': 'border-pink-500'
  };

  const shadowMap: { [key: string]: string } = {
    'cyan-500': 'shadow-cyan-500/50',
    'orange-500': 'shadow-orange-500/50',
    'green-500': 'shadow-green-500/50',
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
        relative p-4 rounded-lg cursor-pointer transition-all duration-300
        transform hover:scale-105 active:scale-95
        ${
          isSelected
            ? `bg-gradient-to-br ${provider.color} ${borderMap[provider.glowColor] || 'border-cyan-500'} border-2 shadow-lg ${shadowMap[provider.glowColor] || 'shadow-cyan-500/50'}`
            : 'bg-gray-800 border-2 border-gray-700 opacity-60 hover:opacity-80'
        }
      `}
    >
      <div className={`text-4xl mb-2 transition-transform duration-300 ${isSelected ? 'scale-110' : 'scale-90'}`}>
        {provider.icon}
      </div>
      <h3 className="font-semibold text-white text-sm">{provider.name}</h3>
      <p className="text-xs text-gray-300 mt-1">{provider.description}</p>
      
      {isSelected && (
        <div className="absolute top-2 right-2 animate-pulse">
          <CheckCircleIcon className="w-5 h-5 text-white drop-shadow-lg" />
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
      {label} {required && <span className="text-cyan-500">*</span>}
    </label>
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`
        w-full px-4 py-2 rounded-lg bg-gray-700 border
        text-white placeholder-gray-500 transition-all
        ${error ? 'border-red-500 focus:border-red-500' : 'border-gray-600 focus:border-cyan-500'}
        focus:outline-none focus:ring-2
        ${error ? 'focus:ring-red-500/30' : 'focus:ring-cyan-500/30'}
      `}
    />
    {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
  </div>
);

const AdvancedOptions: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-6 border-t border-gray-700 pt-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full p-4 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors"
      >
        <span className="font-semibold text-gray-200">⚙️ Paramètres Avancés</span>
        <div className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
          <ChevronDownIcon className="w-5 h-5 text-gray-400" />
        </div>
      </button>

      {isOpen && (
        <div className="mt-4 p-4 bg-gray-800/50 rounded-lg space-y-4 animate-in fade-in duration-200">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="Min Connections"
              name="poolMinSize"
              type="number"
              placeholder="5"
              value="5"
              onChange={() => {}}
            />
            <FormField
              label="Max Connections"
              name="poolMaxSize"
              type="number"
              placeholder="20"
              value="20"
              onChange={() => {}}
            />
            <FormField
              label="Connect Timeout (ms)"
              name="connectTimeout"
              type="number"
              placeholder="5000"
              value="5000"
              onChange={() => {}}
            />
            <FormField
              label="Query Timeout (ms)"
              name="queryTimeout"
              type="number"
              placeholder="30000"
              value="30000"
              onChange={() => {}}
            />
          </div>

          <div className="border-t border-gray-700 pt-4">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-cyan-500" />
              <span className="text-sm text-gray-300">Activer SSH Tunneling</span>
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
  
  // Form state
  const [formData, setFormData] = useState<DatabaseFormData>({
    name: '',
    host: '',
    port: 0,
    username: '',
    password: ''
  });

  // ============== NEW STATE: DATABASE NODES LIST ==============
  const [databaseNodes, setDatabaseNodes] = useState<Array<{
    id: string;
    name: string;
    provider: string;
    providerName: string;
    host: string;
    status: 'connected' | 'disconnected' | 'testing';
    createdAt: string;
  }>>([
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

    addNotification({
      type: 'success',
      title: '💾 Sauvegardé',
      message: `Connexion "${formData.name}" créée avec succès`,
      duration: 3000
    });
    
    setFormData({
      name: '',
      host: '',
      port: 0,
      username: '',
      password: ''
    });
    setSelectedProvider(null);
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
                <h1 className="text-xl font-bold text-white">Bases de Données</h1>
                <p className="text-gray-400 text-sm">Connectez vos sources de données SQL, NoSQL et Vectorielles</p>
              </div>
            </div>

            {/* Governance Indicator - COM Green */}
            <div className="bg-green-500/20 border border-green-500/30 rounded-lg px-3 py-1.5 whitespace-nowrap">
              <div className="text-xs text-green-300 font-medium">{t('current_robot_label')}</div>
              <div className="text-sm text-green-100 font-bold">COM</div>
            </div>
          </div>
        </div>

        {/* Content - Two Column Layout */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left Column - Database Nodes List */}
          <div className="w-64 border-r border-gray-700 bg-gray-800/20 overflow-y-auto p-4">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-200 mb-4">📊 Vos Bases de Données</h2>
              {databaseNodes.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 text-sm">Aucune base créée</p>
                  <p className="text-gray-600 text-xs mt-1">Créez une nouvelle connexion</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {databaseNodes.map((node) => (
                    <div
                      key={node.id}
                      onClick={() => setSelectedNodeId(node.id)}
                      className={`
                        p-3 rounded-lg cursor-pointer transition-all border
                        ${selectedNodeId === node.id
                          ? 'bg-green-600/20 border-green-500 text-white'
                          : 'bg-gray-800/50 border-gray-700 text-gray-300 hover:bg-gray-800/80'
                        }
                      `}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-sm">{node.name}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          node.status === 'connected' ? 'bg-green-600 text-green-200' :
                          node.status === 'testing' ? 'bg-yellow-600 text-yellow-200' :
                          'bg-red-600 text-red-200'
                        }`}>
                          {node.status === 'connected' ? '✓' : node.status === 'testing' ? '⟳' : '✗'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">{node.providerName}</p>
                      <p className="text-xs text-gray-600 truncate">{node.host}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Provider Selection & Form */}
          <div className="flex-1 overflow-y-auto p-8">
            {/* Providers Grid */}
            <div className="mb-12">
              <h2 className="text-2xl font-semibold mb-6 text-gray-200">
                📦 Sélectionnez votre base de données
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {DATABASE_PROVIDERS.map((provider) => (
                  <div key={provider.id} className="fade-in">
                    <DatabaseCard
                      provider={provider}
                      isSelected={selectedProvider === provider.id}
                      onClick={() => handleProviderChange(provider.id)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Dynamic Form */}
            {selectedProviderData && (
              <div className="mb-12 p-8 rounded-xl border border-gray-700 bg-gray-800/50 backdrop-blur-md fade-in">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-semibold text-gray-100">
                    🔗 Configurer {selectedProviderData.name}
                  </h2>
                  <button
                    onClick={() => setShowWorkflowModal(true)}
                    className="px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white text-sm font-semibold rounded-lg hover:from-green-500 hover:to-emerald-500 transition-all shadow-lg shadow-green-500/50"
                  >
                    ➕ Ajouter au Workflow
                  </button>
                </div>

                <form onSubmit={onSaveConnection}>
                  <div className="grid grid-cols-2 gap-6 mb-6">
                    <FormField
                      label="Nom de la connexion"
                      name="name"
                      placeholder={`Ma connexion ${selectedProviderData.name}`}
                      value={formData.name}
                      onChange={(val) => handleFormChange('name', val)}
                      required
                    />
                    {selectedProvider !== 'sqlite' && (
                      <FormField
                        label="Host / IP"
                        name="host"
                        placeholder="localhost"
                        value={formData.host}
                        onChange={(val) => handleFormChange('host', val)}
                        required
                      />
                    )}

                    {selectedProvider !== 'sqlite' && (
                      <FormField
                        label="Port"
                        name="port"
                        type="number"
                        placeholder={String(selectedProviderData.defaultPort)}
                        value={String(formData.port || selectedProviderData.defaultPort)}
                        onChange={(val) => handleFormChange('port', val)}
                        required
                      />
                    )}

                    <FormField
                      label="Nom d'utilisateur"
                      name="username"
                      placeholder="admin"
                      value={formData.username}
                      onChange={(val) => handleFormChange('username', val)}
                      required
                    />

                  <FormField
                    label="Mot de passe"
                    name="password"
                    type="password"
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(val) => handleFormChange('password', val)}
                    required
                  />
                </div>

                {/* Specific Fields per Provider */}
                {selectedProvider === 'postgresql' && (
                  <div className="grid grid-cols-2 gap-6 mb-6 p-4 bg-blue-900/20 rounded-lg border border-blue-700/30">
                    <FormField
                      label="Nom de la base de données"
                      name="database"
                      placeholder="postgres"
                      value={formData.password || ''}
                      onChange={() => {}}
                    />
                    <FormField
                      label="Schema (défaut: public)"
                      name="schema"
                      placeholder="public"
                      value="public"
                      onChange={() => {}}
                    />
                  </div>
                )}

                {selectedProvider === 'mongodb' && (
                  <div className="grid grid-cols-2 gap-6 mb-6 p-4 bg-green-900/20 rounded-lg border border-green-700/30">
                    <FormField
                      label="Auth Source"
                      name="authSource"
                      placeholder="admin"
                      value="admin"
                      onChange={() => {}}
                    />
                    <FormField
                      label="Database"
                      name="database"
                      placeholder="test"
                      value=""
                      onChange={() => {}}
                    />
                  </div>
                )}

                {selectedProvider === 'elasticsearch' && (
                  <div className="grid grid-cols-2 gap-6 mb-6 p-4 bg-yellow-900/20 rounded-lg border border-yellow-700/30">
                    <FormField
                      label="API Key"
                      name="apiKey"
                      type="password"
                      placeholder="••••••••"
                      value=""
                      onChange={() => {}}
                    />
                    <FormField
                      label="Cloud ID (optionnel)"
                      name="cloudId"
                      placeholder="deployment:region"
                      value=""
                      onChange={() => {}}
                    />
                  </div>
                )}

                {/* Advanced Options */}
                <AdvancedOptions />

                {/* Action Buttons */}
                <div className="flex gap-4 mt-8">
                  <button
                    type="button"
                    onClick={onTestConnection}
                    disabled={isTesting}
                    className={`
                      flex-1 py-3 rounded-lg font-semibold transition-all
                      ${
                        isTesting
                          ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }
                    `}
                  >
                    {isTesting ? (
                      <span className="flex items-center justify-center space-x-2">
                        <LoaderIcon className="w-4 h-4 animate-spin" />
                        <span>Test en cours...</span>
                      </span>
                    ) : (
                      '🧪 Tester la connexion'
                    )}
                  </button>

                  <button
                    type="submit"
                    disabled={isSaving}
                    className={`
                      flex-1 py-3 rounded-lg font-semibold transition-all
                      relative overflow-hidden
                      ${
                        isSaving
                          ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-500 hover:to-emerald-500 shadow-lg shadow-green-500/50'
                      }
                    `}
                  >
                    {isSaving ? (
                      <span className="flex items-center justify-center space-x-2">
                        <LoaderIcon className="w-4 h-4 animate-spin" />
                        <span>Sauvegarde...</span>
                      </span>
                    ) : (
                      '💾 Sauvegarder la connexion'
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Empty State */}
          {!selectedProvider && (
            <div className="text-center py-16 fade-in">
              <div className="text-6xl mb-4">🗄️</div>
              <p className="text-gray-400 text-lg">
                Sélectionnez une base de données pour commencer la configuration
              </p>
            </div>
          )}
        </div>
        {/* End of Right Column */}
      </div>
      {/* End of Two Column Layout */}
      </div>

      {/* Workflow Modal */}
      {showWorkflowModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 w-96 shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-6">⚙️ Configurer le Nœud BDD</h2>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Nom du Nœud <span className="text-cyan-500">*</span>
              </label>
              <input
                type="text"
                placeholder={`ex: ${selectedProviderData?.name} Prod`}
                value={workflowNodeName}
                onChange={(e) => setWorkflowNodeName(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white placeholder-gray-500 transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500"
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
                onClick={onAddToWorkflow}
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

export default ComDatabasesPage;
