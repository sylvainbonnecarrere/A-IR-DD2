import React, { useState } from 'react';
import { useLocalization } from '../../hooks/useLocalization';

interface CreerWorkflowDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
}

/**
 * Dialog for creating a new workflow
 * PHASE 2: Multiple Workflows Feature
 */
const CreerWorkflowDialog: React.FC<CreerWorkflowDialogProps> = ({
  isOpen,
  onClose,
  onCreate
}) => {
  const { t } = useLocalization();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  
  const handleCreate = async () => {
    if (!name.trim()) {
      setError(t('dialog_workflow_name_required'));
      return;
    }
    
    setIsCreating(true);
    setError('');
    
    try {
      await onCreate(name, description);
      setName('');
      setDescription('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notification_workflow_error'));
    } finally {
      setIsCreating(false);
    }
  };
  
  const handleClose = () => {
    setName('');
    setDescription('');
    setError('');
    onClose();
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 w-96 shadow-xl">
        {/* Header */}
        <h2 className="text-xl font-bold text-yellow-400 mb-4">
          {t('dialog_create_workflow_title')}
        </h2>
        
        {/* Form */}
        <div className="space-y-4">
          {/* Name Input */}
          <div>
            <label className="block text-sm font-medium text-yellow-300 mb-2">
              {t('dialog_workflow_name')} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('dialog_workflow_name_placeholder')}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-yellow-400 focus:outline-none"
              disabled={isCreating}
              autoFocus
            />
          </div>
          
          {/* Description Input */}
          <div>
            <label className="block text-sm font-medium text-yellow-300 mb-2">
              {t('dialog_workflow_description')} ({t('optional')})
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('dialog_workflow_description_placeholder')}
              rows={3}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-yellow-400 focus:outline-none resize-none"
              disabled={isCreating}
            />
          </div>
          
          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-500 rounded text-red-200 text-sm">
              {error}
            </div>
          )}
        </div>
        
        {/* Buttons */}
        <div className="flex gap-2 mt-6">
          <button
            onClick={handleClose}
            disabled={isCreating}
            className="flex-1 px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded disabled:opacity-50 transition-colors"
          >
            {t('dialog_workflow_cancel_button')}
          </button>
          <button
            onClick={handleCreate}
            disabled={isCreating || !name.trim()}
            className="flex-1 px-4 py-2 bg-yellow-500 text-black rounded hover:bg-yellow-400 font-medium disabled:opacity-50 transition-colors"
          >
            {isCreating ? t('dialog_workflow_creating') : t('dialog_workflow_create_button')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreerWorkflowDialog;
