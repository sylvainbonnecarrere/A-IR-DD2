import React, { useState } from 'react';
import { FilePrototype, LLMConfig, RobotId } from '../types';
import { useDesignStore } from '../stores/useDesignStore';
import { Button, Card } from './UI';
import { PlusIcon, FileAnalysisIcon, SettingsIcon, CloseIcon } from './Icons';
import { useNotifications } from '../contexts/NotificationContext';
import { useLocalization } from '../hooks/useLocalization';

interface PhilDataPageProps {
  llmConfigs: LLMConfig[];
  onNavigateToWorkflow?: () => void;
}

// Mock store for file prototypes - à remplacer par un vrai store plus tard
const useFilesStore = () => {
  const [files, setFiles] = useState<FilePrototype[]>([]);

  const addFile = (file: Omit<FilePrototype, 'id' | 'creator_id' | 'created_at' | 'updated_at'>) => {
    const newFile: FilePrototype = {
      ...file,
      id: `file-${Date.now()}`,
      creator_id: RobotId.Phil,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    setFiles(prev => [...prev, newFile]);
    return { success: true, fileId: newFile.id };
  };

  const deleteFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    return { success: true };
  };

  return { files, addFile, deleteFile };
};

export const PhilDataPage: React.FC<PhilDataPageProps> = ({
  llmConfigs,
  onNavigateToWorkflow
}) => {
  const { t } = useLocalization();
  const { addNotification } = useNotifications();
  const { files, addFile, deleteFile } = useFilesStore();
  const { currentRobotId } = useDesignStore();

  const [isCreating, setIsCreating] = useState(false);
  const [newFile, setNewFile] = useState({
    name: '',
    type: 'upload' as const,
    format: 'json',
    validationRules: {}
  });

  const handleCreateFile = () => {
    if (!newFile.name.trim()) {
      addNotification({
        type: 'error',
        title: t('validation_error'),
        message: t('phil_file_name_required'),
        duration: 3000
      });
      return;
    }

    const result = addFile({
      name: newFile.name,
      type: newFile.type,
      format: newFile.format,
      validation_rules: newFile.validationRules,
      transformation_config: newFile.type === 'transformation' ? {} : undefined
    });

    if (result.success) {
      addNotification({
        type: 'success',
        title: t('phil_file_prototype_created'),
        message: t('phil_file_created_success', { name: newFile.name }),
        duration: 3000
      });
      setNewFile({ name: '', type: 'upload', format: 'json', validationRules: {} });
      setIsCreating(false);
    }
  };

  const handleDeleteFile = (id: string, name: string) => {
    const result = deleteFile(id);
    if (result.success) {
      addNotification({
        type: 'success',
        title: t('prototype_deleted'),
        message: t('phil_file_deleted_success', { name }),
        duration: 3000
      });
    }
  };

  const getFileTypeColor = (type: string) => {
    switch (type) {
      case 'upload': return 'bg-green-500/20 text-green-300 border-green-500/30';
      case 'transformation': return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case 'validation': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case 'output': return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
      default: return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
    }
  };

  const getFormatIcon = (format: string) => {
    switch (format.toLowerCase()) {
      case 'json': return '📄';
      case 'csv': return '📊';
      case 'pdf': return '📋';
      case 'xml': return '🗂️';
      case 'txt': return '📝';
      case 'image': return '🖼️';
      default: return '📁';
    }
  };

  const getFileTypeIcon = (type: string) => {
    switch (type) {
      case 'upload': return '⬆️';
      case 'transformation': return '🔄';
      case 'validation': return '✅';
      case 'output': return '⬇️';
      default: return '📄';
    }
  };

  return (
    <div className="h-full bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <FileAnalysisIcon className="w-6 h-6 text-green-400" />
            <div>
              <h1 className="text-xl font-bold text-white">{t('phil_data_management')}</h1>
              <p className="text-gray-400 text-sm">{t('phil_data_management_desc')}</p>
            </div>
          </div>

          {/* Robot Indicator */}
          <div className="bg-green-500/20 border border-green-500/30 rounded-lg px-3 py-1.5">
            <div className="text-xs text-green-300 font-medium">{t('current_robot')}</div>
            <div className="text-sm text-green-100 font-bold">{currentRobotId}</div>
            <div className="text-xs text-green-400">{t('data_specialist')}</div>
          </div>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="p-6 border-b border-gray-700/50">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-400">
            {t('phil_file_prototypes_count', { count: files.length })}
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
              <span>{t('phil_new_prototype')}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6 space-y-6">

        {/* Create New File Prototype */}
        {isCreating && (
          <Card className="p-6 border border-green-500/30 bg-green-500/5">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center space-x-2">
              <PlusIcon className="w-5 h-5" />
              <span>{t('phil_new_file_prototype')}</span>
            </h3>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('name')}</label>
                <input
                  type="text"
                  value={newFile.name}
                  onChange={(e) => setNewFile({ ...newFile, name: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                  placeholder={t('phil_file_name_placeholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('phil_processing_type')}</label>
                <select
                  value={newFile.type}
                  onChange={(e) => setNewFile({ ...newFile, type: e.target.value as any })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-green-500"
                >
                  <option value="upload">{t('phil_upload_import')}</option>
                  <option value="transformation">{t('phil_transformation')}</option>
                  <option value="validation">{t('phil_validation')}</option>
                  <option value="output">{t('phil_export_output')}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('format')}</label>
                <select
                  value={newFile.format}
                  onChange={(e) => setNewFile({ ...newFile, format: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-green-500"
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                  <option value="pdf">PDF</option>
                  <option value="xml">XML</option>
                  <option value="txt">{t('phil_text')}</option>
                  <option value="image">{t('phil_image')}</option>
                  <option value="binary">{t('phil_binary')}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('phil_validation_rules')}</label>
                <select
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-green-500"
                >
                  <option value="">{t('phil_none')}</option>
                  <option value="schema">{t('phil_schema_validation')}</option>
                  <option value="format">{t('phil_format_validation')}</option>
                  <option value="custom">{t('phil_custom_rules')}</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end space-x-3">
              <Button variant="secondary" onClick={() => setIsCreating(false)}>
                {t('cancel')}
              </Button>
              <Button onClick={handleCreateFile} className="bg-green-600 hover:bg-green-700">
                {t('phil_create_prototype')}
              </Button>
            </div>
          </Card>
        )}

        {/* Files List */}
        {files.length === 0 && !isCreating ? (
          <Card className="p-8 text-center text-gray-400">
            <FileAnalysisIcon className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <h3 className="text-lg font-medium text-gray-300 mb-2">{t('phil_no_file_prototype')}</h3>
            <p className="mb-4">{t('phil_create_first_prototype')}</p>
            <Button
              onClick={() => setIsCreating(true)}
              className="bg-green-600 hover:bg-green-700"
            >
              <PlusIcon className="w-4 h-4 mr-2" />
              {t('phil_first_prototype')}
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {files.map((file) => (
              <Card key={file.id} className="p-4 border-l-4 border-green-500 hover:bg-gray-800/50 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <span className="text-2xl">{getFormatIcon(file.format)}</span>
                    <div>
                      <h3 className="font-medium text-white">{file.name}</h3>
                      <p className="text-xs text-gray-400 uppercase">{file.format}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteFile(file.id, file.name)}
                    className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                    title={t('delete')}
                  >
                    <CloseIcon className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">{t('type')}:</span>
                    <div className="flex items-center space-x-1">
                      <span>{getFileTypeIcon(file.type)}</span>
                      <span className={`px-2 py-1 rounded text-xs font-medium border ${getFileTypeColor(file.type)}`}>
                        {t(`phil_${file.type}`)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">{t('format')}:</span>
                    <span className="text-gray-300 font-mono text-xs uppercase">{file.format}</span>
                  </div>

                  {file.transformation_config && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">{t('phil_transform')}:</span>
                      <span className="text-purple-300 text-xs">{t('configured')}</span>
                    </div>
                  )}

                  <div className="text-xs text-gray-500 pt-2 border-t border-gray-700">
                    {t('created_on', { date: new Date(file.created_at).toLocaleDateString() })}
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