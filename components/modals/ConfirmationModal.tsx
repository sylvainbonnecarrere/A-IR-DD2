import React from 'react';
import { Button } from '../UI';
import { useLocalization } from '../../hooks/useLocalization';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'danger';
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText,
  cancelText,
  variant = 'primary',
}) => {
  const { t } = useLocalization();

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60]"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl border border-gray-700/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          {variant === 'danger' ? (
            <div className="w-10 h-10 rounded-full bg-red-900/30 border border-red-500/50 flex items-center justify-center flex-shrink-0">
              <span className="text-red-400 text-xl">⚠️</span>
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full bg-indigo-900/30 border border-indigo-500/50 flex items-center justify-center flex-shrink-0">
              <span className="text-indigo-400 text-xl">💬</span>
            </div>
          )}
          <h3 className="text-xl font-bold text-white">{title}</h3>
        </div>

        {/* Message */}
        <div
          className={`p-4 rounded-lg mb-6 ${
            variant === 'danger' ? 'bg-red-900/20 border border-red-500/30' : 'bg-gray-700/50 border border-gray-600/50'
          }`}
        >
          <p className="text-gray-200 whitespace-pre-wrap leading-relaxed">{message}</p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} className="hover:scale-105 transition-transform">
            {cancelText || t('cancel')}
          </Button>
          <Button
            variant={variant}
            onClick={onConfirm}
            className={`transition-all duration-200 ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-700 hover:scale-105 hover:shadow-lg hover:shadow-red-500/30'
                : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-105 hover:shadow-lg hover:shadow-indigo-500/30'
            }`}
          >
            {confirmText || t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
};
