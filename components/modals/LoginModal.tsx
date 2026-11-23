/**
 * @file LoginModal.tsx
 * @description Login modal with email/password form
 * @domain Design Domain - Authentication UI
 */

import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useLocalization } from '../../hooks/useLocalization';
import { Button } from '../UI';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onSwitchToRegister?: () => void;
}

/**
 * LoginModal - Displays login form with email & password
 *
 * ARCHITECTURE:
 * - Local state for form inputs + loading + error
 * - useAuth hook for login action
 * - Error displayed in banner above form
 * - Non-blocking: modal can be closed at any time
 *
 * NON-RÉGRESSION: Closing modal doesn't affect Guest mode
 */
export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, onSuccess, onSwitchToRegister }) => {
  const { login, isLoading } = useAuth();
  const { t } = useLocalization();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError(t('login_error_required_fields'));
      return;
    }

    try {
      await login(email, password);
      setEmail('');
      setPassword('');
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : t('login_error_message'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full border border-gray-700">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">{t('login_modal_title')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition text-2xl leading-none" aria-label="Close">
            ×
          </button>
        </div>

        {/* Error Banner */}
        {error && <div className="mb-4 p-3 bg-red-900/50 border border-red-600 rounded text-red-200 text-sm">{error}</div>}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email Input */}
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-300 mb-1">
              {t('login_email_label')}
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="votre@email.com"
              autoComplete="email"
              disabled={isLoading}
            />
          </div>

          {/* Password Input */}
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-300 mb-1">
              {t('login_password_label')}
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={isLoading}
              minLength={8}
            />
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isLoading || !email || !password}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-600 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition"
          >
            {isLoading ? t('login_button_loading') : t('login_button_text')}
          </Button>
        </form>

        {/* Footer */}
        <div className="mt-4 text-center text-sm text-gray-400">
          {t('login_footer_text')}{' '}
          <button
            onClick={() => {
              onClose();
              onSwitchToRegister?.();
            }}
            className="text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
          >
            {t('login_footer_link')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginModal;
