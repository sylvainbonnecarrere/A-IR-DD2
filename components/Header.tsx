import React from 'react';
import { SettingsIcon, LogoIcon } from './Icons';
import { Button } from './UI';
import { useLocalization } from '../hooks/useLocalization';

interface HeaderProps {
  onOpenSettings: () => void;
}

export const Header = ({ onOpenSettings }: HeaderProps) => {
  const { t } = useLocalization();
  return (
    <header className="flex items-center justify-between p-3 border-b border-gray-800 bg-black/80 backdrop-blur-sm">
      <LogoIcon />
      <div className="flex items-center space-x-3">
        <Button variant="ghost" onClick={onOpenSettings} className="flex items-center px-4 py-2 font-semibold text-sm">
          <SettingsIcon className="text-gray-400" />
          <span className="ml-2">{t('header_settings')}</span>
        </Button>
      </div>
    </header>
  );
};