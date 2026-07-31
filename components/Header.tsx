import React, { Suspense, lazy, useState } from 'react';
import { SettingsIcon, LogoIcon } from './Icons';
import { Button } from './UI';
import { useLocalization } from '../hooks/useLocalization';
import { useAuth } from '../hooks/useAuth';
// RestoreTraceButton removed after QA; export UI cleaned up.

const LazyLoginModal = lazy(async () => {
  const module = await import('./modals/LoginModal');
  return { default: module.LoginModal };
});
const LazyRegisterModal = lazy(async () => {
  const module = await import('./modals/RegisterModal');
  return { default: module.RegisterModal };
});

interface HeaderProps {
  onOpenSettings: () => void;
}

/**
 * Header component with authentication UI
 * 
 * MODES:
 * - Guest Mode: Shows "Mode Invité" + Login/Register buttons
 * - Authenticated Mode: Shows user email + Logout button
 * 
 * NON-RÉGRESSION: Guest mode buttons don't block or freeze app
 */
export const Header = ({ onOpenSettings }: HeaderProps) => {
  const { t } = useLocalization();
  const { user, isAuthenticated, logout } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);

  return (
    <>
      <header className="flex items-center justify-between p-3 border-b border-gray-800 bg-black/80 backdrop-blur-sm">
        <LogoIcon />

        <div className="flex items-center space-x-3">
          {/* Settings Button - Always visible (Guest: localStorage, Auth: API) */}
          <Button
            variant="ghost"
            onClick={onOpenSettings}
            className="flex items-center px-4 py-2 font-semibold text-sm hover:bg-gray-800 transition"
            title={t('header_settings')}
          >
            <SettingsIcon className="text-gray-400" />
            <span className="ml-2">{t('header_settings')}</span>
          </Button>

          {/* dev trace export removed */}

          {/* Authentication UI */}
          <div className="border-l border-gray-700 pl-3 flex items-center space-x-2">
            {!isAuthenticated ? (
              // GUEST MODE
              <>
                <span className="text-gray-400 text-xs px-2 py-1 bg-gray-900 rounded">
                  {t('header_guest_mode')}
                </span>
                <Button
                  onClick={() => setShowLoginModal(true)}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 rounded text-white text-sm transition"
                >
                  {t('header_login')}
                </Button>
                <Button
                  onClick={() => setShowRegisterModal(true)}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm transition"
                >
                  {t('header_register')}
                </Button>
              </>
            ) : (
              // AUTHENTICATED MODE
              <>
                <span className="text-gray-300 text-sm px-2 py-1 bg-indigo-900/30 rounded">
                  {user?.email}
                </span>
                <Button
                  onClick={logout}
                  className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-white text-sm transition"
                >
                  {t('header_logout')}
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Auth Modals */}
      <Suspense fallback={null}>
        <LazyLoginModal
          isOpen={showLoginModal}
          onClose={() => setShowLoginModal(false)}
          onSuccess={() => {
            // Optional: Show notification on successful login
          }}
          onSwitchToRegister={() => {
            setShowLoginModal(false);
            setShowRegisterModal(true);
          }}
        />
        <LazyRegisterModal
          isOpen={showRegisterModal}
          onClose={() => setShowRegisterModal(false)}
          onSuccess={() => {
            // Optional: Show notification on successful registration
          }}
          onSwitchToLogin={() => {
            setShowRegisterModal(false);
            setShowLoginModal(true);
          }}
        />
      </Suspense>
    </>
  );
};