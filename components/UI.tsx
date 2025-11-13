import React, { useEffect, useRef } from 'react';
import { CloseIcon } from './Icons';

// --- Button ---
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
};
export const Button = ({ children, className = '', variant = 'primary', ...props }: ButtonProps) => {
  const baseClasses = 'rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center';
  const variantClasses = {
    primary: 'bg-indigo-600 hover:bg-indigo-700 text-white focus:ring-indigo-500 px-4 py-2 font-semibold text-sm',
    secondary: 'bg-gray-700 hover:bg-gray-600 text-gray-200 focus:ring-gray-500 px-4 py-2 font-semibold text-sm',
    ghost: 'bg-transparent hover:bg-gray-700 text-gray-200 focus:ring-gray-500',
    danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500 px-4 py-2 font-semibold text-sm',
  };
  return (
    <button className={`${baseClasses} ${variantClasses[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

// --- Modal ---
type ModalProps = React.HTMLAttributes<HTMLDivElement> & {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
};
export const Modal = ({ title, isOpen, onClose, children, ...props }: ModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Sauvegarder l'élément actuellement focus
      previousActiveElement.current = document.activeElement as HTMLElement;

      // Focus sur le modal après un court délai pour assurer le rendu
      setTimeout(() => {
        modalRef.current?.focus();
      }, 10);

      // Bloquer le scroll du body
      document.body.style.overflow = 'hidden';
    } else {
      // Restaurer le focus à l'élément précédent
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }

      // Restaurer le scroll
      document.body.style.overflow = '';
    }

    return () => {
      // Cleanup : toujours restaurer le scroll
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Gestion de la touche ESC
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Click sur backdrop pour fermer
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm"
      aria-modal="true"
      role="dialog"
      onClick={handleBackdropClick}
      {...props}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl w-full max-w-md m-4 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close modal" className="p-2">
            <CloseIcon />
          </Button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

// --- SlideOver ---
type SlideOverProps = React.HTMLAttributes<HTMLDivElement> & {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
};
export const SlideOver = ({ title, isOpen, onClose, children, ...props }: SlideOverProps) => {
  return (
    <div
      className={`fixed inset-0 z-50 overflow-hidden transition-all duration-500 ${isOpen ? '' : 'pointer-events-none'}`}
      aria-modal="true"
      role="dialog"
      onClick={onClose}
      {...props}
    >
      <div className={`absolute inset-0 bg-black bg-opacity-60 backdrop-blur-sm transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0'}`}></div>
      <div
        className={`absolute inset-y-0 right-0 w-full max-w-md bg-gray-800 border-l border-gray-700 shadow-xl flex flex-col transform transition-transform ease-in-out duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close panel" className="p-2">
            <CloseIcon />
          </Button>
        </div>
        <div className="flex-1 p-6 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
};


// --- Card ---
type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};
export const Card = ({ children, className = '', ...props }: CardProps) => {
  return (
    <div className={`bg-gray-800 border border-gray-700 rounded-lg shadow-lg ${className}`} {...props}>
      {children}
    </div>
  );
};


// --- ToggleSwitch ---
interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}
export const ToggleSwitch = ({ checked, onChange, label }: ToggleSwitchProps) => {
  return (
    <label className="flex items-center cursor-pointer">
      <div className="relative">
        <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <div className={`block w-10 h-6 rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-gray-600'}`}></div>
        <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${checked ? 'transform translate-x-4' : ''}`}></div>
      </div>
      {label && <span className="ml-3 text-sm font-medium text-gray-300">{label}</span>}
    </label>
  );
};