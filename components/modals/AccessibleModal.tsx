import React, { useEffect, useRef } from 'react';

import { CloseIcon } from '../Icons';

interface AccessibleModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** `alertdialog` pour les confirmations d'actions, `dialog` sinon. */
  role?: 'dialog' | 'alertdialog';
  labelledBy: string;
  children: React.ReactNode;
  /** Ref du bouton recevant le focus initial (ex. action sûre "Annuler"). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  maxWidthClassName?: string;
}

/**
 * Modale accessible (WCAG + clavier) : role explicite, `aria-modal`, libellé,
 * Échap ferme, focus initial contrôlé, restauration du focus à la fermeture.
 */
export const AccessibleModal: React.FC<AccessibleModalProps> = ({
  isOpen,
  onClose,
  role = 'dialog',
  labelledBy,
  children,
  initialFocusRef,
  maxWidthClassName = 'max-w-md',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      const target = initialFocusRef?.current ?? containerRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      target?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, initialFocusRef]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <div
        ref={containerRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`bg-gray-900 border border-gray-700 rounded-lg p-6 w-full mx-4 shadow-xl text-gray-100 ${maxWidthClassName}`}
      >
        {children}
      </div>
    </div>
  );
};

export const ModalCloseButton: React.FC<{ onClick: () => void; label: string }> = ({ onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className="text-gray-400 hover:text-gray-200 transition-colors p-1 rounded"
  >
    <CloseIcon className="w-4 h-4" />
  </button>
);
