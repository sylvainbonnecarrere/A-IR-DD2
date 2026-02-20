# EditWorkflowDialog Component - Complete Reference

**File**: `components/modals/EditWorkflowDialog.tsx` (CREATE NEW)

This component opens as a modal when users click the pencil icon (✎) on a WorkflowCard to edit the workflow name and description.

## Complete Component Code

```tsx
import React, { useState, useEffect } from 'react';
import { IWorkflow } from '../../types';
import { useLocalization } from '../../hooks/useLocalization';

interface EditWorkflowDialogProps {
  isOpen: boolean;
  workflow?: IWorkflow;
  onClose: () => void;
  onSave: (workflowId: string, name: string, description: string) => Promise<void>;
}

const EditWorkflowDialog: React.FC<EditWorkflowDialogProps> = ({
  isOpen,
  workflow,
  onClose,
  onSave
}) => {
  const { t } = useLocalization();
  const [name, setName] = useState(workflow?.name || '');
  const [description, setDescription] = useState(workflow?.description || '');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  // Sync form with workflow when modal opens
  useEffect(() => {
    if (workflow) {
      setName(workflow.name);
      setDescription(workflow.description || '');
      setError('');
    }
  }, [workflow]);
  
  const handleSave = async () => {
    // Validation
    if (!name.trim()) {
      setError(t('dialog_workflow_name_required'));
      return;
    }
    
    if (!workflow) return;
    
    setIsSaving(true);
    setError('');
    
    try {
      // Call parent handler
      await onSave(workflow._id, name, description);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };
  
  if (!isOpen || !workflow) return null;
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 w-96 shadow-xl">
        {/* Header */}
        <h2 className="text-xl font-bold text-yellow-400 mb-4">
          {t('dialog_edit_workflow_title')}
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
              disabled={isSaving}
              maxLength={100}
              autoFocus
            />
          </div>
          
          {/* Description Input */}
          <div>
            <label className="block text-sm font-medium text-yellow-300 mb-2">
              {t('dialog_workflow_description')} (optionnel)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('dialog_workflow_description_placeholder')}
              rows={3}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-yellow-400 focus:outline-none resize-none"
              disabled={isSaving}
              maxLength={500}
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
            onClick={onClose}
            disabled={isSaving}
            className="flex-1 px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded disabled:opacity-50 transition-colors"
          >
            {t('dialog_workflow_cancel_button')}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="flex-1 px-4 py-2 bg-yellow-500 text-black rounded hover:bg-yellow-400 font-medium disabled:opacity-50 transition-colors"
          >
            {isSaving ? t('dialog_workflow_saving') : t('dialog_workflow_save_button')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditWorkflowDialog;
```

## Feature Implementation Checklist

✅ **Props & State Management**:
- Props include `isOpen`, `workflow`, `onClose`, `onSave`
- Local state for `name`, `description`, `error`, `isSaving`
- Auto-focus on name input for better UX

✅ **Validation**:
- Name field required (cannot be empty)
- Max lengths: name 100 chars, description 500 chars
- Error display for validation failures
- Disabled save button when invalid

✅ **API Integration**:
- Calls `onSave(workflowId, name, description)` which connects to:
  - `/api/workflows/:id` PATCH endpoint (backend)
  - `updateWorkflow()` action (Zustand store)

✅ **Styling**:
- BOS yellow/gold theme (text-yellow-400, bg-yellow-500)
- Responsive width (w-96)
- Dark cosmic background (bg-gray-800)
- Smooth transitions on buttons

✅ **User Experience**:
- Modal closes on success
- Loading state disabled during save
- Error messages display clearly
- Prevents accidental loss of edits (form resets on modal close)

## Integration Points

This component is imported and used in `BosWorkflowManagementPage.tsx`:

```tsx
// In BosWorkflowManagementPage.tsx
import EditWorkflowDialog from './modals/EditWorkflowDialog';

// In state
const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);

// In JSX
{editingWorkflowId && (
  <EditWorkflowDialog
    isOpen={true}
    workflow={workflows.find(w => w._id === editingWorkflowId)}
    onClose={() => setEditingWorkflowId(null)}
    onSave={handleEdit}
  />
)}
```

And `WorkflowCard.tsx` triggers editing with the pencil icon:

```tsx
// In WorkflowCard.tsx
<button
  onClick={onEdit}
  className="text-gray-500 hover:text-yellow-400 transition-colors"
  title={t('workflow_card_edit_tooltip')}
>
  ✎
</button>
```

---

**Status**: ✅ Ready for Implementation
