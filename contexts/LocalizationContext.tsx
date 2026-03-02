import React, { createContext, useState, useCallback, useEffect } from 'react';
import { Locale, locales, defaultLocale } from '../i18n/locales';
import { useLocalizationStore } from '../stores/useLocalizationStore';

// Import all languages statically to avoid race conditions
import fr from '../i18n/fr';
import en from '../i18n/en';
import de from '../i18n/de';
import es from '../i18n/es';
import pt from '../i18n/pt';
import ua from '../i18n/ua';

// Type récursif pour supporter les traductions imbriquées (ex: workflow.current)
type TranslationValue = string | { [key: string]: TranslationValue };
type Translations = Record<string, TranslationValue>;

// Cast explicite car les fichiers i18n ont des structures mixtes
const allTranslations: Record<Locale, Translations> = { 
    fr: fr as unknown as Translations, 
    en: en as unknown as Translations, 
    de: de as unknown as Translations, 
    es: es as unknown as Translations, 
    pt: pt as unknown as Translations, 
    ua: ua as unknown as Translations 
};

interface LocalizationContextType {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (key: string, fallbackOrParams?: string | Record<string, string | number>, params?: Record<string, string | number>) => string;
}

export const LocalizationContext = createContext<LocalizationContextType>({
    locale: defaultLocale,
    setLocale: () => null,
    t: (key) => key,
});

const getInitialLocale = (): Locale => {
    const savedLocale = localStorage.getItem('app-locale');
    if (savedLocale && locales[savedLocale as Locale]) {
        return savedLocale as Locale;
    }
    return defaultLocale;
};

export const LocalizationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [locale, setLocaleState] = useState<Locale>(getInitialLocale());
    
    // Zustand store for global state
    const { setLocale: setStoreLocale } = useLocalizationStore();

    const setLocale = useCallback((newLocale: Locale) => {
        localStorage.setItem('app-locale', newLocale);
        setLocaleState(newLocale);
        
        // ⭐ Synchronize with Zustand store
        setStoreLocale(newLocale);
    }, [setStoreLocale]);

    const t = useCallback((
        key: string, 
        fallbackOrParams?: string | Record<string, string | number>,
        params: Record<string, string | number> = {}
    ) => {
        const translations = allTranslations[locale] || allTranslations[defaultLocale];
        
        // Déterminer fallback et params selon le type du 2e argument
        let fallback: string | undefined;
        let interpolationParams = params;
        
        if (typeof fallbackOrParams === 'string') {
            fallback = fallbackOrParams;
        } else if (typeof fallbackOrParams === 'object' && fallbackOrParams !== null) {
            interpolationParams = fallbackOrParams;
        }
        
        // Support pour les clés imbriquées (ex: "workflow.current")
        const keys = key.split('.');
        let value: TranslationValue | undefined = translations;
        
        for (const k of keys) {
            if (value && typeof value === 'object' && !Array.isArray(value) && k in value) {
                value = (value as Record<string, TranslationValue>)[k];
            } else {
                value = undefined;
                break;
            }
        }

        // Si la valeur n'est pas une string, tenter de chercher directement avec la clé complète
        if (typeof value !== 'string') {
            value = translations[key];
        }

        if (typeof value !== 'string') {
            // Utiliser le fallback si fourni, sinon la clé
            if (fallback) {
                return fallback;
            }
            console.warn(`Translation key '${key}' not found for locale '${locale}'.`);
            return key;
        }

        let translation = value;
        Object.keys(interpolationParams).forEach(paramKey => {
            const regex = new RegExp(`{${paramKey}}`, 'g');
            translation = translation.replace(regex, String(interpolationParams[paramKey]));
        });

        return translation;
    }, [locale]);

    return (
        <LocalizationContext.Provider value={{ locale, setLocale, t }}>
            {children}
        </LocalizationContext.Provider>
    );
};

/**
 * useLocalization hook - Access localization context
 * 
 * Usage:
 * const { locale, setLocale, t } = useLocalization();
 * const translated = t('key');
 */
export const useLocalization = (): LocalizationContextType => {
    const context = React.useContext(LocalizationContext);
    if (!context) {
        throw new Error('useLocalization must be used within LocalizationProvider');
    }
    return context;
};
