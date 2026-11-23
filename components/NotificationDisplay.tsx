import React from 'react';
import { useNotifications } from '../contexts/NotificationContext';
import { CloseIcon } from './Icons';

const CheckIcon = () => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
  </svg>
);

const ExclamationIcon = () => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
  </svg>
);

const XCircleIcon = () => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
  </svg>
);

const InfoIcon = () => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
  </svg>
);

export const NotificationDisplay: React.FC = () => {
  const { notifications, removeNotification } = useNotifications();

  if (notifications.length === 0) return null;

  const getNotificationStyles = (type: string) => {
    switch (type) {
      case 'success':
        return {
          container: 'bg-green-900 border-green-500 text-green-100',
          icon: 'text-green-400',
          IconComponent: CheckIcon
        };
      case 'warning':
        return {
          container: 'bg-yellow-900 border-yellow-500 text-yellow-100',
          icon: 'text-yellow-400',
          IconComponent: ExclamationIcon
        };
      case 'error':
        return {
          container: 'bg-red-900 border-red-500 text-red-100',
          icon: 'text-red-400',
          IconComponent: XCircleIcon
        };
      case 'info':
      default:
        return {
          container: 'bg-blue-900 border-blue-500 text-blue-100',
          icon: 'text-blue-400',
          IconComponent: InfoIcon
        };
    }
  };

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {notifications.map((notification) => {
        const styles = getNotificationStyles(notification.type);
        const IconComponent = styles.IconComponent;

        return (
          <div
            key={notification.id}
            role="alert"
            data-testid="notification-toast"
            data-type={notification.type}
            className={`
              ${styles.container}
              border rounded-lg p-4 shadow-lg
              animate-in slide-in-from-right-5 duration-300
              backdrop-blur-sm
            `}
          >
            <div className="flex items-start space-x-3">
              <div className={`${styles.icon} mt-0.5`}>
                <IconComponent />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-sm">{notification.title}</h4>
                <p className="text-sm opacity-90 mt-1 whitespace-pre-line">{notification.message}</p>
              </div>
              <button
                onClick={() => removeNotification(notification.id)}
                className="text-current opacity-70 hover:opacity-100 transition-opacity ml-2"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};